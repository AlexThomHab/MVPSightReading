import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { PlaybackService } from '../playback/playback.service';
import { EarTrainingState } from './ear-training.state';

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

  /** Play (or stop) the selection — the same action as the main Play button. */
  readonly togglePlay = output<void>();

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
