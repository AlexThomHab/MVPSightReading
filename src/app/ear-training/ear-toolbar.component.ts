import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { PlaybackService } from '../playback/playback.service';
import { EarTrainingState } from './ear-training.state';
import { NoteInputState } from './note-input.state';

/** The note values on the Write toolbar, as SMuFL (Bravura) notes, with MuseScore's shortcut keys. */
const DURATIONS = [
  { ticks: 16, glyph: '\uE1D2', name: 'Whole note (semibreve)', key: '7' },
  { ticks: 8, glyph: '\uE1D3', name: 'Half note (minim)', key: '6' },
  { ticks: 4, glyph: '\uE1D5', name: 'Quarter note (crotchet)', key: '5' },
  { ticks: 2, glyph: '\uE1D7', name: 'Eighth note (quaver)', key: '4' },
  { ticks: 1, glyph: '\uE1D9', name: 'Sixteenth note (semiquaver)', key: '3' },
  { ticks: 0.5, glyph: '\uE1DB', name: 'Thirty-second note (demisemiquaver)', key: '2' },
];

/**
 * The compact secondary toolbar shown in Ear Training mode, between the generator controls
 * and the score. Bars are chosen directly on the score; the main tempo slider remains the
 * only tempo control.
 */
@Component({
  selector: 'app-ear-toolbar',
  templateUrl: './ear-toolbar.component.html',
  styleUrl: './ear-toolbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EarToolbarComponent {
  protected readonly ear = inject(EarTrainingState);
  protected readonly playback = inject(PlaybackService);
  protected readonly input = inject(NoteInputState);
  protected readonly durations = DURATIONS;
  protected readonly glyph = { dot: '\uE1E7', rest: '\uE4E5', flat: '\uE260', natural: '\uE261', sharp: '\uE262' };

  /** Play (or stop) the selection — the same action as the main Play button. */
  readonly togglePlay = output<void>();
  /** Play (or stop) the listener's own notes over the selection. */
  readonly playMine = output<void>();

  protected readonly status = computed(() => {
    if (this.playback.loading()) return 'Loading piano…';
    if (!this.playback.playing()) return '';
    const bar = this.playback.currentBar();
    const where =
      bar !== null ? `Playing bar ${bar + 1}` : this.playback.countingIn() ? 'Counting in…' : 'Starting…';
    return this.playback.paused() ? `Paused · bar ${(bar ?? 0) + 1}` : where;
  });

  protected togglePause(): void {
    if (this.playback.paused()) this.playback.resume();
    else this.playback.pause();
  }
}
