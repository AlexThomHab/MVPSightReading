/**
 * Ear training: which bars to play and which to reveal. Pure functions, so the rules can be
 * tested without rendering or audio. Bar numbers shown to the user are 1-based; indices
 * passed to the score and playback are 0-based.
 */

export type PlaybackScope = 'full' | 'single' | 'range';

/** Bars to play, 0-based and inclusive. */
export interface BarSelection {
  from: number;
  to: number;
}

/** Explains what is wrong with the chosen bars, or returns null when they are valid. */
export function validateSelection(scope: PlaybackScope, start: number, end: number, barCount: number): string | null {
  if (scope === 'full') return null;
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= barCount;
  if (!valid(start)) return `Choose a bar from 1 to ${barCount}.`;
  if (scope === 'range') {
    if (!valid(end)) return `Choose an end bar from 1 to ${barCount}.`;
    if (end < start) return 'The end bar must be the same as or after the start bar.';
  }
  return null;
}

/** The bars a valid selection covers. */
export function selectionRange(scope: PlaybackScope, start: number, end: number, barCount: number): BarSelection {
  if (scope === 'full') return { from: 0, to: barCount - 1 };
  if (scope === 'single') return { from: start - 1, to: start - 1 };
  return { from: start - 1, to: end - 1 };
}

/**
 * The bar "Reveal next bar" uncovers: the one after the last bar revealed this way (or the
 * selected bar if nothing has been revealed yet), skipping bars already showing. Null when
 * every later bar is already revealed.
 */
export function nextReveal(revealed: readonly number[], cursor: number | null, selected: number, barCount: number): number | null {
  let bar = cursor === null ? selected : cursor + 1;
  while (bar < barCount && revealed.includes(bar)) bar++;
  return bar < barCount ? bar : null;
}

/** Adds a bar to the revealed set, keeping it sorted and free of duplicates. */
export function withRevealed(revealed: readonly number[], bar: number): number[] {
  return revealed.includes(bar) ? [...revealed] : [...revealed, bar].sort((a, b) => a - b);
}
