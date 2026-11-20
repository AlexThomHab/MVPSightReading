/**
 * From a point on the drawn score (in score units) to music: which bar and stave it is over,
 * the nearest line or space (as a diatonic index, snapped like MuseScore's note input), the
 * rhythmic slot it falls in, and any note or rest under it. Pure, so it can be tested
 * without a browser.
 */
import { BarGeometry, ElementGeometry, STAFF_SPACE } from './engraving';
import { diatonicIndex } from '../music/theory';

export type Staff = 'rh' | 'lh';

/** What note input would act on at a point. */
export interface InputTarget {
  bar: number;
  staff: Staff;
  /** The element (note or rest) whose slot the point is in, and where it starts. */
  index: number;
  tick: number;
  /** The line or space under the point, counted in letters from C0. */
  diatonic: number;
}

/** The top line of each stave: F5 in the treble clef, A3 in the bass. */
export const TOP_LINE: Record<Staff, number> = {
  rh: diatonicIndex({ letter: 'F', alter: 0, octave: 5 }),
  lh: diatonicIndex({ letter: 'A', alter: 0, octave: 3 }),
};
const HALF = STAFF_SPACE / 2;
/** How far above or below a stave input reaches: five ledger lines. */
const LEDGER_REACH = 10;

/** The y of a line or space on a stave whose top line is at `top`. */
export function yOf(staff: Staff, top: number, diatonic: number): number {
  return top + (TOP_LINE[staff] - diatonic) * HALF;
}

/** The stave a height belongs to: the treble above the gap between the staves, the bass below. */
function staffAt(g: BarGeometry, y: number): Staff {
  return y < (g.rhTop + 4 * STAFF_SPACE + g.lhTop) / 2 ? 'rh' : 'lh';
}

/** The bar a point is over (piano bars only), within reach of its staves. */
export function barAt(bars: readonly BarGeometry[], x: number, y: number): BarGeometry | null {
  return (
    bars.find(
      (g) =>
        x >= g.left &&
        x < g.right &&
        y >= g.rhTop - (LEDGER_REACH + 2) * HALF &&
        y <= g.lhTop + 4 * STAFF_SPACE + (LEDGER_REACH + 2) * HALF,
    ) ?? null
  );
}

/** The slot a point falls in: the last element starting at or before it (the first, before any). */
function slotAt(elements: readonly ElementGeometry[], staff: Staff, x: number): ElementGeometry | null {
  const own = elements.filter((e) => e.staff === staff).sort((a, b) => a.tick - b.tick);
  if (!own.length) return null;
  let slot = own[0];
  for (const e of own) if (e.x - 6 <= x) slot = e;
  return slot;
}

/** Where a note entered at this point would go, or null if the point is not over a piano bar. */
export function inputTargetAt(bars: readonly BarGeometry[], x: number, y: number): InputTarget | null {
  const g = barAt(bars, x, y);
  if (!g) return null;
  const staff = staffAt(g, y);
  const top = staff === 'rh' ? g.rhTop : g.lhTop;
  const raw = TOP_LINE[staff] - Math.round((y - top) / HALF);
  const diatonic = Math.max(TOP_LINE[staff] - 8 - LEDGER_REACH, Math.min(TOP_LINE[staff] + LEDGER_REACH, raw));
  const slot = slotAt(g.elements, staff, x);
  if (!slot) return null;
  return { bar: g.bar, staff, index: slot.index, tick: slot.tick, diatonic };
}

/** The note or rest under a point, if any. */
export function elementAt(bars: readonly BarGeometry[], x: number, y: number): { bar: number; staff: Staff; index: number } | null {
  const g = barAt(bars, x, y);
  if (!g) return null;
  const staff = staffAt(g, y);
  const hit = g.elements.find(
    (e) => e.staff === staff && x >= e.x - 4 && x <= e.x + e.w + 4 && y >= e.ys[0] - (e.rest ? 14 : 7) && y <= e.ys[e.ys.length - 1] + (e.rest ? 14 : 7),
  );
  return hit ? { bar: g.bar, staff, index: hit.index } : null;
}

/** The geometry of one element. */
export function geometryOf(bars: readonly BarGeometry[], bar: number, staff: Staff, index: number): { g: BarGeometry; e: ElementGeometry } | null {
  const g = bars.find((b) => b.bar === bar);
  const e = g?.elements.find((el) => el.staff === staff && el.index === index);
  return g && e ? { g, e } : null;
}

/** Whether a pitch needs ledger lines, and where: the ys of each line, above or below the stave. */
export function ledgerLines(staff: Staff, top: number, diatonic: number): number[] {
  const out: number[] = [];
  const topLine = TOP_LINE[staff];
  for (let d = topLine + 2; d <= diatonic; d += 2) out.push(yOf(staff, top, d));
  for (let d = topLine - 10; d >= diatonic; d -= 2) out.push(yOf(staff, top, d));
  return out;
}
