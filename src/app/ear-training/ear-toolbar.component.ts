import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal } from '@angular/core';
import { PlaybackService } from '../playback/playback.service';
import { AnswerCheckState } from './answer-check.state';
import { EarTrainingState } from './ear-training.state';
import { fullName, lengthName } from '../music/durations';
import { ACCIDENTAL, DOT, NOTE, REST } from '../score/glyphs';
import { DURATION_KEYS, NoteInputState } from './note-input.state';

/** The note values on the toolbar, longest first, with MuseScore's shortcut keys. */
const DURATIONS = Object.entries(DURATION_KEYS)
  .map(([key, ticks]) => ({ ticks, key, glyph: NOTE[ticks], name: fullName(ticks) }))
  .sort((a, b) => b.ticks - a.ticks);

/** Every shortcut, for the Shortcuts popover. */
const SHORTCUTS: [string, string][] = [
  ['N', 'Start or stop writing notes'],
  ['Click the stave · A–G', 'Write a note'],
  ['Shift + click · Shift + A–G', 'Add a note to the chord'],
  ['0', 'Write a rest'],
  ['7 6 5 4 3 2', 'Whole note … thirty-second note'],
  ['.', 'Dotted'],
  ['↑ ↓', 'Pitch up or down a semitone (Ctrl/⌘: an octave)'],
  ['← →', 'Previous or next note'],
  ['Delete', 'Turn the selected note into a rest'],
  ['Ctrl/⌘ + Z · Ctrl + Y', 'Undo · redo'],
  ['Space', 'Play or pause'],
  ['M', 'Hear notes as you write them, or not (off at first)'],
  ['Esc', 'Stop writing, or deselect'],
];

/**
 * Ear Training's controls, in three groups by what the listener is doing: writing notes,
 * listening (one Play button for the selected bars), and checking or revealing the answer.
 * The less used settings live in small menus, and one line of help changes with the task.
 */
@Component({
  selector: 'app-ear-toolbar',
  templateUrl: './ear-toolbar.component.html',
  styleUrl: './ear-toolbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'closeMenus($event)' },
})
export class EarToolbarComponent {
  protected readonly ear = inject(EarTrainingState);
  protected readonly playback = inject(PlaybackService);
  protected readonly input = inject(NoteInputState);
  protected readonly check = inject(AnswerCheckState);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly durations = DURATIONS;
  protected readonly shortcuts = SHORTCUTS;
  protected readonly glyph = { dot: DOT, rest: REST[4], ...ACCIDENTAL };
  protected readonly showShortcuts = signal(false);

  /** Play, pause or resume the selected bars (the app decides what plays). */
  readonly togglePlay = output<void>();

  /** The Play button says exactly what it will do. */
  protected readonly playLabel = computed(() => {
    if (this.playback.loading()) return 'Loading piano…';
    if (this.playback.playing()) return this.playback.paused() ? '▶ Resume' : '❚❚ Pause';
    const s = this.ear.selection();
    return `▶ Play ${s ? this.ear.selectionLabel().toLowerCase() : 'the whole piece'}`;
  });

  protected readonly status = computed(() => {
    if (!this.playback.playing() || this.playback.loading()) return '';
    const bar = this.playback.currentBar();
    if (this.playback.paused()) return `Paused at bar ${(bar ?? 0) + 1}`;
    return bar !== null ? `Bar ${bar + 1}` : this.playback.countingIn() ? 'Counting in…' : '';
  });

  /** One line of help for what the listener is doing now (or why something did not happen). */
  protected readonly hint = computed(() => {
    const message = this.input.message();
    if (message) return { text: message, warning: this.input.messageIsWarning() };
    if (this.input.active()) {
      const what = this.input.restMode() ? `${lengthName(this.input.ticks())} rest` : lengthName(this.input.ticks());
      return { text: `Click the stave to place a ${what}, or type A–G. Press Esc when you're done.`, warning: false };
    }
    if (this.input.selected()) return { text: 'Note selected: ↑ ↓ change its pitch, 2–7 its length, Delete removes it.', warning: false };
    if (this.input.hasNotes()) return { text: 'Check your answers whenever you like — only the bars you’ve written in are marked.', warning: false };
    return { text: 'Listen, then press Write notes (N) and click the stave to write what you hear. Select bars on the score to play just those.', warning: false };
  });

  protected readonly revealedCount = computed(() => this.ear.revealed().length);

  protected stop(): void {
    this.playback.stop();
  }

  protected setSource(source: 'original' | 'mine'): void {
    this.playback.stop();
    this.ear.source.set(source);
  }

  /** Runs a menu item and closes its menu. */
  protected pick(menu: HTMLDetailsElement, action: () => void): void {
    action();
    menu.open = false;
  }

  /** A click anywhere else closes an open menu. */
  protected closeMenus(event: MouseEvent): void {
    const target = event.target as Node | null;
    this.element.nativeElement.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((d) => {
      if (!target || !d.contains(target)) d.open = false;
    });
  }
}
