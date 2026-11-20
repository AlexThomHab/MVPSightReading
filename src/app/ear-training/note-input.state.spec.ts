import { TestBed } from '@angular/core/testing';
import { generatePiece } from '../music/generator';
import { keySignatureAlter } from '../music/theory';
import { PlaybackService } from '../playback/playback.service';
import { EarTrainingState } from './ear-training.state';
import { NoteInputState } from './note-input.state';

describe('NoteInputState: MuseScore-style note input', () => {
  let input: NoteInputState;
  let ear: EarTrainingState;
  let preview: ReturnType<typeof vi.spyOn>;
  const piece = generatePiece({ seed: 'input', grade: 3, style: 'classical', timeId: '4/4' });
  const key = (k: string, o: KeyboardEventInit = {}) => input.handleKey(new KeyboardEvent('keydown', { key: k, ...o }));
  const rh = (bar: number) => input.transcription().bars[bar].rh.map((n) => (n.rest ? `r${n.ticks}` : n.pitches.map((p) => `${p.letter}${p.alter > 0 ? '#' : p.alter < 0 ? 'b' : ''}${p.octave}`).join('+') + `/${n.ticks}${n.tie ? '~' : ''}`));

  beforeEach(() => {
    localStorage.removeItem('note-input-sound');
    TestBed.configureTestingModule({});
    // No audio in tests: the preview sound is a no-op.
    preview = vi.spyOn(TestBed.inject(PlaybackService), 'preview').mockResolvedValue();
    input = TestBed.inject(NoteInputState);
    ear = TestBed.inject(EarTrainingState);
    ear.reset(piece.bars.length);
    input.load(piece);
  });

  it('writes notes in silence unless hearing them is turned on (M), and remembers the choice', () => {
    expect(input.soundOn()).toBe(false);
    key('n');
    key('c');
    key('ArrowUp');
    expect(preview).not.toHaveBeenCalled();
    // Written all the same.
    expect(rh(0)[0]).toBe('C#5/4');
    expect(key('m')).toBe(true);
    expect(input.soundOn()).toBe(true);
    key('d');
    expect(preview).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('note-input-sound')).toBe('on');
    input.toggleSound();
    expect(localStorage.getItem('note-input-sound')).toBe('off');
  });

  it('toggles note input with N and leaves with Esc, the cursor at the start', () => {
    expect(key('n')).toBe(true);
    expect(input.active()).toBe(true);
    expect(input.cursor()).toEqual({ bar: 0, staff: 'rh', tick: 0 });
    key('Escape');
    expect(input.active()).toBe(false);
  });

  it('types notes with letters, in the octave nearest the last, the cursor moving on by each length', () => {
    key('n');
    key('5');
    key('c');
    key('e');
    key('4');
    key('g');
    key('f');
    expect(rh(0)).toEqual(['C5/4', 'E5/4', 'G5/2', 'F5/2', 'r4']);
    expect(input.cursor()).toEqual({ bar: 0, staff: 'rh', tick: 12 });
  });

  it('enters rests with 0, dots with ., and adds to a chord with Shift', () => {
    key('n');
    key('5');
    key('.');
    key('c');
    key('e', { shiftKey: true });
    key('.');
    key('4');
    key('0');
    expect(rh(0)).toEqual(['C5+E5/6', 'r2', 'r8']);
  });

  it('refuses a note too long for the room left in the bar, and says why', () => {
    key('n');
    key('6');
    key('.');
    key('c');
    // (The dot stays on until . is pressed again.)
    key('d');
    expect(rh(0)).toEqual(['C5/12', 'r4']);
    expect(rh(1)).toEqual(['r16']);
    expect(input.message()).toMatch(/dotted minim doesn't fit here — only a crotchet is left/);
  });

  it('writes where the stave is clicked, as the key signature has it, on the snapped beat', () => {
    key('n');
    const f5 = 5 * 7 + 3;
    const target = { bar: 1, staff: 'rh' as const, tick: 8, diatonic: f5, x: 0, endX: 0, fits: true };
    input.clickAt(target, false);
    const alter = keySignatureAlter(piece.key, 'F');
    expect(rh(1)).toEqual(['r8', `F${alter > 0 ? '#' : alter < 0 ? 'b' : ''}5/4`, 'r4']);
    expect(input.cursor()).toEqual({ bar: 1, staff: 'rh', tick: 12 });
    // Shift-click on that note adds to its chord.
    input.clickAt({ ...target, diatonic: f5 + 2 }, true);
    expect(rh(1)[1].split('/')[0].split('+').length).toBe(2);
  });

  it('edits the selected note: arrows change its pitch, 2–7 its length, Delete makes it a rest', () => {
    key('n');
    key('5');
    key('c');
    key('Escape');
    expect(input.selected()).toEqual({ bar: 0, staff: 'rh', index: 0 });
    key('ArrowUp');
    expect(rh(0)[0]).toBe('C#5/4');
    key('ArrowDown', { ctrlKey: true });
    expect(rh(0)[0]).toBe('C#4/4');
    key('6');
    expect(rh(0)[0]).toBe('C#4/8');
    input.setAccidental(-1);
    expect(rh(0)[0]).toBe('Cb4/8');
    key('Delete');
    expect(rh(0)[0]).toBe('r8');
  });

  it('undoes and redoes every change with Ctrl/Cmd+Z and Ctrl+Y', () => {
    key('n');
    key('c');
    key('d');
    expect(rh(0).slice(0, 2)).toEqual(['C5/4', 'D5/4']);
    key('z', { ctrlKey: true });
    expect(rh(0).slice(0, 2)).toEqual(['C5/4', 'r4']);
    expect(input.cursor()).toEqual({ bar: 0, staff: 'rh', tick: 4 });
    key('z', { metaKey: true });
    expect(rh(0)).toEqual(['r16']);
    key('y', { ctrlKey: true });
    key('z', { metaKey: true, shiftKey: true });
    expect(rh(0).slice(0, 2)).toEqual(['C5/4', 'D5/4']);
    expect(input.canRedo()).toBe(false);
  });

  it('leaves revealed bars alone: they show the original', () => {
    ear.revealAll();
    expect(key('n')).toBe(true);
    expect(input.active()).toBe(false);
    input.clickAt({ bar: 0, staff: 'rh', tick: 0, diatonic: 35, x: 0, endX: 0, fits: true }, false);
    expect(rh(0)).toEqual(['r16']);
  });

  it('keeps the notes for the same piece, and starts afresh for a new one', () => {
    key('n');
    key('c');
    input.load(piece);
    expect(input.hasNotes()).toBe(true);
    input.load(generatePiece({ seed: 'other', grade: 3, style: 'classical', timeId: '4/4' }));
    expect(input.hasNotes()).toBe(false);
    expect(input.canUndo()).toBe(false);
  });

  it('ignores keys that are not shortcuts', () => {
    expect(key('q')).toBe(false);
    expect(key('c')).toBe(false);
    expect(key('c', { ctrlKey: true })).toBe(false);
  });
});
