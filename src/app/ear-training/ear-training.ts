/**
 * Ear training: which bars are selected and which are revealed. Pure functions, so the
 * rules can be tested without rendering or audio. All bar indices are 0-based.
 *
 * A selection is always one continuous run of bars (a musical passage), never scattered
 * bars stitched together.
 */

/** Selected bars, inclusive. */
export interface BarSelection {
  from: number;
  to: number;
}

/**
 * Clicking a bar, in the manner of selecting photos, but keeping the selection continuous:
 * - nothing selected: select the bar;
 * - a bar outside the selection: extend the selection to it, taking in the bars between;
 * - an end of a multi-bar selection: shrink the selection by that bar;
 * - the only selected bar: clear the selection;
 * - a bar inside the selection: start a new selection there (removing it would leave a gap).
 */
export function clickBar(selection: BarSelection | null, bar: number): BarSelection | null {
  if (!selection) return { from: bar, to: bar };
  const { from, to } = selection;
  if (bar < from) return { from: bar, to };
  if (bar > to) return { from, to: bar };
  if (from === to) return null;
  if (bar === from) return { from: from + 1, to };
  if (bar === to) return { from, to: to - 1 };
  return { from: bar, to: bar };
}

/** Dragging from one bar to another selects every bar between them. */
export function dragBars(anchor: number, bar: number): BarSelection {
  return { from: Math.min(anchor, bar), to: Math.max(anchor, bar) };
}

/** What to play: the selection, or the whole piece when nothing is selected. */
export function playRange(selection: BarSelection | null, barCount: number): BarSelection {
  return selection ?? { from: 0, to: barCount - 1 };
}

/**
 * The bar "Reveal next bar" uncovers: the first concealed bar after the last one revealed
 * (or from the start of the selection, or of the piece), wrapping round to the beginning.
 * Null when every bar is revealed.
 */
export function nextReveal(revealed: readonly number[], cursor: number | null, start: number, barCount: number): number | null {
  const first = cursor === null ? start : cursor + 1;
  for (let k = 0; k < barCount; k++) {
    const bar = (first + k) % barCount;
    if (!revealed.includes(bar)) return bar;
  }
  return null;
}

/** Adds bars to the revealed set, keeping it sorted and free of duplicates. */
export function withRevealed(revealed: readonly number[], ...bars: number[]): number[] {
  return [...new Set([...revealed, ...bars])].sort((a, b) => a - b);
}

/** "Bars 13–17", "Bar 3", or "Whole piece" when nothing is selected. */
export function describeSelection(selection: BarSelection | null): string {
  if (!selection) return 'Whole piece';
  return selection.from === selection.to ? `Bar ${selection.from + 1}` : `Bars ${selection.from + 1}–${selection.to + 1}`;
}
