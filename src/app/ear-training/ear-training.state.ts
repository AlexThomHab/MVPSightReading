import { Injectable, computed, signal } from '@angular/core';
import { BarSelection, clickBar, describeSelection, dragBars, nextReveal, playRange, withRevealed } from './ear-training';

/**
 * Ear Training mode state, shared by the main toolbar (Play, mode switch), the ear-training
 * toolbar and the score. Bar indices are 0-based.
 */
@Injectable({ providedIn: 'root' })
export class EarTrainingState {
  readonly active = signal(false);

  /** What Play plays: the original (the exercise) or the listener's own notes. */
  readonly source = signal<'original' | 'mine'>('original');

  /** The selected passage — always continuous — or null for none. */
  readonly selection = signal<BarSelection | null>(null);
  readonly loop = signal(false);
  /** A bar of clicks before the music: off unless turned on in the playback settings (both modes use it). */
  readonly countIn = signal(false);

  // Revealed bars, and where "Reveal next bar" continues from.
  readonly revealed = signal<number[]>([]);
  private readonly cursor = signal<number | null>(null);
  readonly barCount = signal(0);

  /** What Play plays: the selection, or the whole piece when nothing is selected. */
  readonly playRange = computed(() => playRange(this.selection(), this.barCount()));
  readonly selectionLabel = computed(() => describeSelection(this.selection()));
  readonly next = computed(() =>
    nextReveal(this.revealed(), this.cursor(), this.selection()?.from ?? 0, this.barCount()),
  );

  /** A fresh start for a piece: everything concealed, nothing selected. */
  reset(barCount: number): void {
    this.barCount.set(barCount);
    this.selection.set(null);
    this.revealed.set([]);
    this.cursor.set(null);
  }

  clickBar(bar: number): void {
    this.selection.update((s) => clickBar(s, bar));
  }

  dragBars(anchor: number, bar: number): void {
    this.selection.set(dragBars(anchor, bar));
  }

  clearSelection(): void {
    this.selection.set(null);
  }

  /** Reveals every bar of the selection (revealing never changes the selection). */
  revealSelected(): void {
    const s = this.selection();
    if (!s) return;
    this.revealed.update((r) => withRevealed(r, ...Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i)));
    this.cursor.set(s.to);
  }

  /** Reveals particular bars (e.g. the ones just checked). */
  reveal(bars: readonly number[]): void {
    if (!bars.length) return;
    this.revealed.update((r) => withRevealed(r, ...bars));
    this.cursor.set(Math.max(...bars));
  }

  revealNext(): void {
    const bar = this.next();
    if (bar === null) return;
    this.revealed.update((r) => withRevealed(r, bar));
    this.cursor.set(bar);
  }

  revealAll(): void {
    this.revealed.set(Array.from({ length: this.barCount() }, (_, i) => i));
  }

  resetReveals(): void {
    this.revealed.set([]);
    this.cursor.set(null);
  }
}
