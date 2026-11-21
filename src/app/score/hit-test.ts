/**
 * From a point on the drawn score (in score units) to music: which bar and stave it is over,
 * the nearest line or space (as a diatonic index), the rhythmic position it falls on, and any
 * note or rest under it. Pure, so it can be tested without a browser.
 *
 * Engraved notes are not spaced in proportion to their length, so time is read from the bar
 * as drawn: the notes and rests already in it are anchors (each sits at its own tick), and a
 * point between two anchors falls proportionally between their ticks. The note to be written
 * then snaps to the nearest start its value allows (crotchets to crotchet beats, quavers to
 * quavers…), and the same mapping, run backwards, places the preview — so what is previewed
 * is what is written.
 */
import { BarGeometry, STAFF_SPACE } from './engraving';
import { isPlain } from '../music/durations';
import type { Staff } from '../music/model';
import { diatonicIndex } from '../music/theory';


/** What note input would write at a point. */
export interface InputTarget {
  bar: number;
  staff: Staff;
  /** Where the note would start (ticks from the start of the bar). */
  tick: number;
  /** The line or space under the point, counted in letters from C0. */
  diatonic: number;
  /** Where the preview goes, and where the note would end (score units). */
  x: number;
  endX: number;
  /** False when the note is longer than the room left in the bar from any start. */
  fits: boolean;
}

/** The top line of each stave: F5 in the treble clef, A3 in the bass. */
export const TOP_LINE: Record<Staff, number> = {
  rh: diatonicIndex({ letter: 'F', alter: 0, octave: 5 }),
  lh: diatonicIndex({ letter: 'A', alter: 0, octave: 3 }),
};
const HALF = STAFF_SPACE / 2;
/** How far above or below a stave input reaches: five ledger lines. */
const LEDGER_REACH = 10;
const EPS = 1e-6;

/** A stave's top line, by its clef: the left hand's stave may be in the treble clef (Grade 6+). */
export const topLineOf = (staff: Staff, lhClef: 'treble' | 'bass' = 'bass') => (staff === 'rh' || lhClef === 'treble' ? TOP_LINE.rh : TOP_LINE.lh);

/** The y of a line or space on a stave whose top line is at `top`. */
export function yOf(staff: Staff, top: number, diatonic: number, lhClef?: 'treble' | 'bass'): number {
  return top + (topLineOf(staff, lhClef) - diatonic) * HALF;
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

/**
 * The (x, tick) anchors a bar's time is read from: every note and rest where it is drawn (a
 * lone whole-bar rest, set in the middle of the bar, says nothing about time and is left out),
 * the start of the notes and the end of the bar. Increasing in both x and tick.
 */
export function anchors(g: BarGeometry): [number, number][] {
  const byTick = new Map<number, number[]>();
  for (const staff of ['rh', 'lh'] as const) {
    const own = g.elements.filter((e) => e.staff === staff);
    if (own.length === 1 && own[0].rest) continue;
    for (const e of own) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.x]);
  }
  const points: [number, number][] = [...byTick].map(([tick, xs]) => [xs.reduce((a, b) => a + b, 0) / xs.length, tick]);
  if (!byTick.has(0)) points.push([g.noteStart + 4, 0]);
  points.push([g.right - 16, g.length]);
  points.sort((a, b) => a[1] - b[1]);
  const out: [number, number][] = [];
  for (const p of points) if (!out.length || p[0] > out[out.length - 1][0] + EPS) out.push(p);
  return out;
}

/** The tick at a horizontal position in a bar (clamped to the bar). */
export function tickAtX(g: BarGeometry, x: number): number {
  const pts = anchors(g);
  if (x <= pts[0][0]) return 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, t0] = pts[i - 1];
    const [x1, t1] = pts[i];
    if (x <= x1) return t0 + ((x - x0) / (x1 - x0)) * (t1 - t0);
  }
  return g.length;
}

/** The horizontal position of a tick in a bar: the inverse of `tickAtX`. */
export function xAtTick(g: BarGeometry, tick: number): number {
  const pts = anchors(g);
  if (tick <= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    const [x0, t0] = pts[i - 1];
    const [x1, t1] = pts[i];
    if (tick <= t1 + EPS) return t1 === t0 ? x1 : x0 + ((tick - t0) / (t1 - t0)) * (x1 - x0);
  }
  return pts[pts.length - 1][0];
}

/**
 * The positions a note of `ticks` may start on: its own value's grid (a dotted note in simple
 * time on the grid of its undotted value, so a dotted crotchet starts on a beat; in compound
 * time on its own, so a dotted crotchet fills a beat).
 */
export function snapGrid(ticks: number, compound: boolean): number {
  return isPlain(ticks) || compound ? ticks : ticks / 1.5;
}

/**
 * Where a note of `ticks` entered at this point would go: the nearest start on its grid at
 * which it still fits in the bar (not fitting from any start, `fits` is false).
 */
export function inputTargetAt(bars: readonly BarGeometry[], x: number, y: number, ticks: number, compound: boolean): InputTarget | null {
  const g = barAt(bars, x, y);
  if (!g || g.length <= 0) return null;
  const staff = staffAt(g, y);
  const top = staff === 'rh' ? g.rhTop : g.lhTop;
  const line = topLineOf(staff, g.lhClef);
  const raw = line - Math.round((y - top) / HALF);
  const diatonic = Math.max(line - 8 - LEDGER_REACH, Math.min(line + LEDGER_REACH, raw));
  const grid = snapGrid(ticks, compound);
  const starts: number[] = [];
  for (let t = 0; t < g.length - EPS; t += grid) starts.push(t);
  const fitting = starts.filter((t) => t + ticks <= g.length + EPS);
  const pool = fitting.length ? fitting : starts.length ? starts : [0];
  const at = tickAtX(g, x);
  const tick = pool.reduce((best, t) => (Math.abs(t - at) < Math.abs(best - at) ? t : best));
  return { bar: g.bar, staff, tick, diatonic, x: xAtTick(g, tick), endX: xAtTick(g, Math.min(g.length, tick + ticks)), fits: fitting.length > 0 };
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
export function geometryOf(bars: readonly BarGeometry[], bar: number, staff: Staff, index: number) {
  const g = bars.find((b) => b.bar === bar);
  const e = g?.elements.find((el) => el.staff === staff && el.index === index);
  return g && e ? { g, e } : null;
}

/** Ledger lines a pitch needs: the ys of each line, above or below the stave. */
export function ledgerLines(staff: Staff, top: number, diatonic: number, lhClef?: 'treble' | 'bass'): number[] {
  const out: number[] = [];
  const topLine = topLineOf(staff, lhClef);
  for (let d = topLine + 2; d <= diatonic; d += 2) out.push(yOf(staff, top, d, lhClef));
  for (let d = topLine - 10; d >= diatonic; d -= 2) out.push(yOf(staff, top, d, lhClef));
  return out;
}
