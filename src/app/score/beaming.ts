/**
 * Beam groups for one bar of one voice, following the metre:
 *   - compound time (6/8, 9/8): each dotted-crotchet beat is a group (3 + 3 quavers);
 *   - 3/8: the whole bar; 5/8 and 7/8: each group of two or three quavers; 5/4 and 7/4: each beat;
 *   - simple time: plain quavers are beamed by the half bar — four together in 2/4 and 4/4
 *     (4 + 4), and in 3/4 the first two beats then the third (4 + 2); a half bar that holds
 *     anything else (semiquavers, dotted figures, a crotchet) is beamed beat by beat.
 * Only notes shorter than a crotchet are beamed; rests, longer notes and the edges of a group
 * break a beam; a beam never crosses a bar line (each bar is grouped on its own).
 *
 * Durations are in ticks (semiquaver = 1). Returns the indices of the notes in each beam.
 */
import { onsets, snapTicks } from '../music/durations';
import { TimeSignature } from '../music/grades';

export interface BeamableNote {
  ticks: number;
  rest?: boolean;
}

const CROTCHET = 4;
const QUAVER = 2;

/** The spans [start, end) of the bar that a beam may cover. */
function windows(time: TimeSignature, notes: readonly BeamableNote[]): [number, number][] {
  const bar = time.barTicks;
  if (time.id === '3/8') return [[0, bar]];
  // Irregular metres: 5/8 and 7/8 by their groups of quavers (3 + 2, 2 + 2 + 3); 5/4 and 7/4 beat by beat.
  if (time.irregular) {
    if (time.beatTicks === 2) {
      let at = 0;
      return time.groups.map((g): [number, number] => [at, (at += g)]);
    }
    return Array.from({ length: bar / CROTCHET }, (_, i): [number, number] => [i * CROTCHET, (i + 1) * CROTCHET]);
  }
  if (time.compound) return Array.from({ length: bar / 6 }, (_, i) => [i * 6, i * 6 + 6]);
  const halves: [number, number][] =
    time.id === '3/4' ? [[0, 8], [8, 12]] : Array.from({ length: Math.ceil(bar / 8) }, (_, i) => [i * 8, Math.min(bar, i * 8 + 8)]);
  const starts = onsets(notes);
  return halves.flatMap(([a, b]): [number, number][] => {
    const inside = notes.map((n, i) => ({ n, at: starts[i] })).filter(({ at }) => at >= a && at < b);
    const plainQuavers = inside.length > 0 && inside.every(({ n, at }) => n.ticks === QUAVER && !n.rest && at + n.ticks <= b);
    if (plainQuavers) return [[a, b]];
    // Otherwise beat by beat.
    return Array.from({ length: (b - a) / CROTCHET }, (_, i): [number, number] => [a + i * CROTCHET, a + (i + 1) * CROTCHET]);
  });
}

export function beamGroups(notes: readonly BeamableNote[], time: TimeSignature): number[][] {
  const groups: number[][] = [];
  let at = 0;
  let current: number[] = [];
  let window: [number, number] | null = null;
  const spans = windows(time, notes);
  const flush = () => {
    if (current.length >= 2) groups.push(current);
    current = [];
  };
  notes.forEach((n, i) => {
    const span = spans.find(([a, b]) => at >= a - 1e-6 && at < b - 1e-6) ?? null;
    // (Ticks are snapped: three triplet quavers fill a beat exactly.)
    const fits = span !== null && snapTicks(at + n.ticks) <= span[1];
    const beamable = !n.rest && n.ticks < CROTCHET && fits;
    if (!beamable || span !== window) flush();
    window = span;
    if (beamable) current.push(i);
    at = snapTicks(at + n.ticks);
  });
  flush();
  return groups;
}
