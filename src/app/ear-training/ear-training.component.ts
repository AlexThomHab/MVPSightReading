import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Piece } from '../music/generator';
import { keyName } from '../music/theory';
import { PlaybackService } from '../playback/playback.service';
import { ScoreComponent } from '../score/score.component';
import { PlaybackScope, nextReveal, selectionRange, validateSelection, withRevealed } from './ear-training';

/**
 * Ear Training mode: the current piece with its notation concealed. Play the whole piece,
 * one bar or a range, transcribe it elsewhere, then reveal bars one at a time to check.
 * Uses the same Piece, renderer and playback as the normal view; nothing is regenerated.
 */
@Component({
  selector: 'app-ear-training',
  imports: [ScoreComponent],
  templateUrl: './ear-training.component.html',
  styleUrl: './ear-training.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EarTrainingComponent {
  readonly piece = input.required<Piece>();
  readonly exit = output<void>();

  protected readonly playback = inject(PlaybackService);

  // Hints, off by default so nothing is given away.
  protected readonly showKey = signal(false);
  protected readonly showTime = signal(false);

  // Playback selection (bar numbers as the user sees them, 1-based).
  protected readonly scope = signal<PlaybackScope>('full');
  protected readonly start = signal(1);
  protected readonly end = signal(1);
  protected readonly loop = signal(false);
  protected readonly countIn = signal(true);
  protected readonly bpm = linkedSignal(() => this.piece().tempo.bpm);

  // Revealed bars (0-based) and where "Reveal next bar" continues from.
  protected readonly revealed = signal<number[]>([]);
  private readonly cursor = signal<number | null>(null);

  protected readonly barCount = computed(() => this.piece().bars.length);
  protected readonly error = computed(() => validateSelection(this.scope(), this.start(), this.end(), this.barCount()));
  protected readonly selection = computed(() =>
    this.error() ? null : selectionRange(this.scope(), this.start(), this.end(), this.barCount()),
  );
  /** The bar "Reveal bar" uncovers: the selected (start) bar. */
  protected readonly selectedBar = computed(() => Math.min(Math.max(this.start(), 1), this.barCount()) - 1);
  protected readonly next = computed(() => nextReveal(this.revealed(), this.cursor(), this.selectedBar(), this.barCount()));
  protected readonly keyLabel = computed(() => keyName(this.piece().key));
  protected readonly tempoRange = computed(() => {
    const bpm = this.piece().tempo.bpm;
    return { min: Math.round(bpm * 0.4), max: Math.round(bpm * 1.5) };
  });
  /** The beat symbol would hint at the metre (♩. means compound time), so it needs the time signature shown. */
  protected readonly beatLabel = computed(() => {
    if (!this.showTime()) return 'beats per minute';
    const unit = this.piece().tempo.beatUnit;
    return unit === 'qd' ? '♩. per minute' : unit === '8' ? '♪ per minute' : '♩ per minute';
  });
  protected readonly status = computed(() => {
    if (this.playback.loading()) return 'Loading piano…';
    if (!this.playback.playing()) return 'Stopped';
    const bar = this.playback.currentBar();
    const where =
      bar !== null ? `Bar ${bar + 1} of ${this.barCount()}` : this.playback.countingIn() ? 'Counting in…' : 'Starting…';
    return this.playback.paused() ? `Paused · ${where}` : where;
  });

  constructor() {
    this.playback.stop();
  }

  protected setScope(scope: PlaybackScope): void {
    this.scope.set(scope);
    if (scope === 'range' && this.end() < this.start()) this.end.set(this.start());
  }

  protected setStart(value: string): void {
    this.start.set(Number(value));
  }

  protected setEnd(value: string): void {
    this.end.set(Number(value));
  }

  /** Clicking a bar selects it; Shift-click extends the selection to a range. */
  protected onBarSelect({ bar, extend }: { bar: number; extend: boolean }): void {
    const n = bar + 1;
    if (extend && this.scope() !== 'full') {
      this.scope.set('range');
      if (n < this.start()) {
        this.end.set(this.start());
        this.start.set(n);
      } else {
        this.end.set(n);
      }
      return;
    }
    if (this.scope() === 'full') this.scope.set('single');
    this.start.set(n);
    if (this.end() < n || this.scope() === 'single') this.end.set(n);
  }

  protected play(): void {
    const selection = this.selection();
    if (!selection) return;
    void this.playback.play(this.piece(), this.bpm(), {
      fromBar: selection.from,
      toBar: selection.to,
      loop: this.loop(),
      countIn: this.countIn(),
    });
  }

  protected togglePause(): void {
    if (this.playback.paused()) this.playback.resume();
    else this.playback.pause();
  }

  protected stop(): void {
    this.playback.stop();
  }

  protected revealSelected(): void {
    const bar = this.selectedBar();
    this.revealed.update((r) => withRevealed(r, bar));
    this.cursor.set(bar);
  }

  protected revealNext(): void {
    const bar = this.next();
    if (bar === null) return;
    this.revealed.update((r) => withRevealed(r, bar));
    this.cursor.set(bar);
  }

  protected revealAll(): void {
    this.revealed.set(Array.from({ length: this.barCount() }, (_, i) => i));
  }

  protected hideAll(): void {
    this.revealed.set([]);
    this.cursor.set(null);
  }

  protected leave(): void {
    this.playback.stop();
    this.exit.emit();
  }
}
