/**
 * Beam groups for one bar of one voice, following the metre:
 *   - compound time (6/8, 9/8): each dotted-crotchet beat is a group (3 + 3 quavers);
 *   - 3/8: the whole bar;
 *   - simple time: plain quavers are beamed by the half bar — four together in 2/4 and 4/4
 *     (4 + 4), and in 3/4 the first two beats then the third (4 + 2); a half bar that holds
 *     anything else (semiquavers, dotted figures, a crotchet) is beamed beat by beat.
 * Only notes shorter than a crotchet are beamed; rests, longer notes and the edges of a group
 * break a beam; a beam never crosses a bar line (each bar is grouped on its own).
 *
 * Durations are in ticks (semiquaver = 1). Returns the indices of the notes in each beam.
 */
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
  if (time.compound) return Array.from({ length: bar / 6 }, (_, i) => [i * 6, i * 6 + 6]);
  const halves: [number, number][] =
    time.id === '3/4' ? [[0, 8], [8, 12]] : Array.from({ length: Math.ceil(bar / 8) }, (_, i) => [i * 8, Math.min(bar, i * 8 + 8)]);
  const onsets = notes.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1] + notes[i - 1].ticks], []);
  return halves.flatMap(([a, b]): [number, number][] => {
    const inside = notes.map((n, i) => ({ n, at: onsets[i] })).filter(({ at }) => at >= a && at < b);
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
    const span = spans.find(([a, b]) => at >= a && at < b) ?? null;
    const fits = span !== null && at + n.ticks <= span[1];
    const beamable = !n.rest && n.ticks < CROTCHET && fits;
    if (!beamable || span !== window) flush();
    window = span;
    if (beamable) current.push(i);
    at += n.ticks;
  });
  flush();
  return groups;
}
