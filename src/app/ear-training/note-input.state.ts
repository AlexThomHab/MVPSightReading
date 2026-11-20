import { Injectable, computed, inject, signal } from '@angular/core';
import { Piece } from '../music/model';
import { LETTERS, Letter, Pitch } from '../music/theory';
import { PlaybackService } from '../playback/playback.service';
import type { InputTarget } from '../score/hit-test';
import { EarTrainingState } from './ear-training.state';
import {
  ElementRef,
  Position,
  Transcription,
  WriteResult,
  addToChord,
  clearElement,
  elementOf,
  emptyTranscription,
  indexAt,
  mapPitches,
  nearestLetter,
  pitchAt,
  positionOf,
  setDuration,
  step,
  transpose,
  write,
} from './transcription';

/** Everything an undo restores: the notes, and where the selection and input cursor were. */
interface EditState {
  transcription: Transcription;
  selected: ElementRef | null;
  cursor: Position | null;
}

/** The note values on the toolbar and their MuseScore shortcuts (1 = 64th … 7 = whole). */
export const DURATION_KEYS: Readonly<Record<string, number>> = { '2': 0.5, '3': 1, '4': 2, '5': 4, '6': 8, '7': 16 };

const HISTORY_LIMIT = 200;

/**
 * Note input for Ear Training, modelled on MuseScore: N starts and Esc ends note input; the
 * toolbar (or keys 2–7, and . for a dot) sets the next note's value; a click on the stave, or
 * a letter A–G, writes a note at the input cursor, which then moves on by the note's length.
 * Outside note input a click selects a note; arrows change its pitch, 2–7 its length, Delete
 * turns it into a rest. Every change can be undone.
 */
@Injectable({ providedIn: 'root' })
export class NoteInputState {
  private readonly ear = inject(EarTrainingState);
  private readonly playback = inject(PlaybackService);

  /** Note input mode (N / Esc). */
  readonly active = signal(false);
  /** The next note's value, undotted (ticks), and whether it is dotted. */
  readonly base = signal(4);
  readonly dotted = signal(false);
  /** Clicks (and letters) write rests instead of notes. */
  readonly restMode = signal(false);
  readonly ticks = computed(() => this.base() * (this.dotted() ? 1.5 : 1));

  private piece: Piece | null = null;
  private readonly state = signal<EditState>({ transcription: { bars: [], lengths: [], compound: false }, selected: null, cursor: null });
  private past: EditState[] = [];
  private future: EditState[] = [];
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  readonly transcription = computed(() => this.state().transcription);
  readonly selected = computed(() => this.state().selected);
  readonly cursor = computed(() => this.state().cursor);
  readonly hasNotes = computed(() => this.transcription().bars.some((b) => [...b.rh, ...b.lh].some((n) => !n.rest)));

  /** Starts afresh for a new piece (a piece seen before keeps its notes). */
  load(piece: Piece): void {
    if (piece === this.piece) return;
    this.piece = piece;
    this.state.set({ transcription: emptyTranscription(piece), selected: null, cursor: null });
    this.past = [];
    this.future = [];
    this.syncHistory();
    this.active.set(false);
  }

  /** Bars still concealed take input; revealed bars show the original. */
  editable(bar: number): boolean {
    return bar >= 0 && bar < this.transcription().bars.length && !this.ear.revealed().includes(bar);
  }

  // Mode ---------------------------------------------------------------------

  toggle(): void {
    if (this.active()) this.exit();
    else this.enter();
  }

  enter(): void {
    const s = this.state();
    const start = s.selected ? positionOf(s.transcription, s.selected) : s.cursor;
    const cursor = start && this.editable(start.bar) ? start : this.firstEditable();
    if (!cursor) return;
    this.state.update((st) => ({ ...st, cursor }));
    this.active.set(true);
  }

  exit(): void {
    this.active.set(false);
  }

  private firstEditable(): Position | null {
    const bar = this.transcription().bars.findIndex((_, i) => this.editable(i));
    return bar < 0 ? null : { bar, staff: 'rh', tick: 0 };
  }

  // Values ------------------------------------------------------------------

  /** Picks a note value; with a note selected outside note input, changes that note (as MuseScore does). */
  setBase(ticks: number): void {
    this.base.set(ticks);
    this.applyLengthToSelection();
  }

  toggleDot(): void {
    this.dotted.update((d) => !d);
    this.applyLengthToSelection();
  }

  private applyLengthToSelection(): void {
    const s = this.state();
    if (this.active() || !s.selected || !this.editable(s.selected.bar)) return;
    const r = setDuration(s.transcription, s.selected, this.ticks());
    if (r) this.commit({ transcription: r.transcription, selected: r.placed, cursor: r.next });
  }

  toggleRest(): void {
    const s = this.state();
    // A selected note becomes a rest; otherwise the toggle decides what input writes.
    if (!this.active() && s.selected && !elementOf(s.transcription, s.selected)?.rest) {
      this.deleteSelected();
      return;
    }
    this.restMode.update((r) => !r);
  }

  // Writing -----------------------------------------------------------------

  /** A click on the stave in note input: a note (or rest) there; with Shift, added to the chord there. */
  clickAt(target: InputTarget, chord: boolean): void {
    if (!this.active() || !this.editable(target.bar)) return;
    const s = this.state();
    const pitch = pitchAt(target.diatonic, this.keyShown());
    const ref: ElementRef = { bar: target.bar, staff: target.staff, index: target.index };
    if (chord && !this.restMode()) {
      const t = addToChord(s.transcription, ref, pitch);
      this.commit({ ...s, transcription: t, selected: ref });
      this.sound(elementOf(t, ref)?.pitches ?? [pitch]);
      return;
    }
    this.writeAt({ bar: target.bar, staff: target.staff, tick: target.tick }, this.restMode() ? null : [pitch]);
  }

  /** A letter A–G in note input: at the cursor, in the octave nearest the last note; with Shift, added to the chord. */
  letter(letter: Letter, chord: boolean): void {
    const s = this.state();
    if (!this.active() || !s.cursor) return;
    const near = this.lastPitch();
    if (chord && s.selected && this.editable(s.selected.bar)) {
      const pitch = pitchAt(nearestLetter(letter, near, s.selected.staff), this.keyShown());
      const t = addToChord(s.transcription, s.selected, pitch);
      this.commit({ ...s, transcription: t });
      this.sound(elementOf(t, s.selected)?.pitches ?? [pitch]);
      return;
    }
    this.writeAt(s.cursor, [pitchAt(nearestLetter(letter, near, s.cursor.staff), this.keyShown())]);
  }

  /** 0 in note input: a rest at the cursor. */
  rest(): void {
    const s = this.state();
    if (this.active() && s.cursor) this.writeAt(s.cursor, null);
  }

  private writeAt(pos: Position, pitches: Pitch[] | null): void {
    if (!this.editable(pos.bar)) return;
    const r: WriteResult = write(this.state().transcription, pos, this.ticks(), pitches);
    this.commit({ transcription: r.transcription, selected: r.placed, cursor: r.next });
    if (pitches) this.sound(pitches);
    // At the end of the piece there is nowhere left to write.
    if (!r.next) this.exit();
  }

  // Editing the selection -------------------------------------------------------

  select(ref: ElementRef | null): void {
    this.state.update((s) => ({ ...s, selected: ref && this.editable(ref.bar) ? ref : null }));
  }

  /** Up/down a semitone (Ctrl/Cmd: an octave), spelled the way it moves. */
  transposeSelected(semitones: number): void {
    const s = this.state();
    if (!s.selected || !this.editable(s.selected.bar)) return;
    const t = mapPitches(s.transcription, s.selected, (p) => transpose(p, semitones));
    if (t === s.transcription) return;
    this.commit({ ...s, transcription: t });
    this.sound(elementOf(t, s.selected)?.pitches ?? []);
  }

  /** Sharp, flat or natural on the selected note (every note of a chord). */
  setAccidental(alter: -1 | 0 | 1): void {
    const s = this.state();
    if (!s.selected || !this.editable(s.selected.bar)) return;
    const t = mapPitches(s.transcription, s.selected, (p) => ({ ...p, alter }));
    if (t === s.transcription) return;
    this.commit({ ...s, transcription: t });
    this.sound(elementOf(t, s.selected)?.pitches ?? []);
  }

  deleteSelected(): void {
    const s = this.state();
    if (!s.selected || !this.editable(s.selected.bar)) return;
    const t = clearElement(s.transcription, s.selected);
    if (t !== s.transcription) this.commit({ ...s, transcription: t });
  }

  /** Left/right: the input cursor in note input, otherwise the selection. */
  move(by: 1 | -1): void {
    const s = this.state();
    if (this.active() && s.cursor) {
      const here: ElementRef = { bar: s.cursor.bar, staff: s.cursor.staff, index: indexAt(s.transcription, s.cursor) };
      const there = step(s.transcription, here, by);
      if (there) this.state.set({ ...s, cursor: positionOf(s.transcription, there), selected: there });
      return;
    }
    if (s.selected) {
      const there = step(s.transcription, s.selected, by);
      if (there) this.state.set({ ...s, selected: there });
    }
  }

  clearAll(): void {
    if (!this.piece || !this.hasNotes()) return;
    this.commit({ transcription: emptyTranscription(this.piece), selected: null, cursor: this.active() ? this.firstEditable() : null });
  }

  // Undo ----------------------------------------------------------------------

  private commit(next: EditState): void {
    this.past.push(this.state());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.state.set(next);
    this.syncHistory();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state());
    this.state.set(prev);
    this.syncHistory();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state());
    this.state.set(next);
    this.syncHistory();
  }

  private syncHistory(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }

  // Keyboard ------------------------------------------------------------------

  /** Handles a key press in Ear Training; true when it was a note-input shortcut. */
  handleKey(e: KeyboardEvent): boolean {
    const command = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (command && !e.altKey) {
      const k = key.toLowerCase();
      if (k === 'z') {
        if (e.shiftKey) this.redo();
        else this.undo();
        return true;
      }
      if (k === 'y') {
        this.redo();
        return true;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this.transposeSelected(key === 'ArrowUp' ? 12 : -12);
        return true;
      }
      return false;
    }
    if (e.altKey) return false;
    if (key === 'n' || key === 'N') {
      this.toggle();
      return true;
    }
    if (key === 'Escape') {
      if (this.active()) this.exit();
      else if (this.selected()) this.select(null);
      else return false;
      return true;
    }
    if (DURATION_KEYS[key] !== undefined) {
      this.setBase(DURATION_KEYS[key]);
      return true;
    }
    if (key === '.') {
      this.toggleDot();
      return true;
    }
    if (key === '0') {
      if (this.active()) this.rest();
      else this.toggleRest();
      return true;
    }
    const upper = key.toUpperCase();
    if (key.length === 1 && (LETTERS as readonly string[]).includes(upper) && this.active()) {
      this.letter(upper as Letter, e.shiftKey);
      return true;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (!this.selected()) return false;
      this.transposeSelected(key === 'ArrowUp' ? 1 : -1);
      return true;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (!this.selected() && !this.active()) return false;
      this.move(key === 'ArrowRight' ? 1 : -1);
      return true;
    }
    if (key === 'Delete' || key === 'Backspace') {
      if (!this.selected()) return false;
      this.deleteSelected();
      return true;
    }
    return false;
  }

  // Helpers -------------------------------------------------------------------

  /** Lines and spaces follow the key signature only while it is shown. */
  private keyShown() {
    return this.piece && this.ear.showKey() ? this.piece.key : null;
  }

  /** The note to pitch the next letter from: the selected (last entered) note's top note. */
  private lastPitch(): Pitch | null {
    const s = this.state();
    const n = s.selected && elementOf(s.transcription, s.selected);
    return n && !n.rest ? n.pitches[n.pitches.length - 1] : null;
  }

  /** MuseScore sounds each note as it is written or changed. */
  private sound(pitches: readonly Pitch[]): void {
    if (pitches.length) void this.playback.preview(pitches);
  }
}
