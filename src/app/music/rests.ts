/**
 * Rests in the values a grade writes: the syllabus introduces rests gradually (crotchet and
 * minim rests at Grade 1, quaver rests at Grade 3), so a bar's silence is spelled from the
 * grade's own rest values — a minim and a crotchet rest for a 3/4 bar at Grade 1.
 */

/** `ticks` of silence as the fewest of the given rest values (longest first), or null if they cannot make it. */
export function restsFor(ticks: number, rests: readonly number[]): number[] | null {
  const out: number[] = [];
  let left = ticks;
  const values = [...rests].sort((a, b) => b - a);
  while (left > 1e-6) {
    const r = values.find((x) => x <= left + 1e-6);
    if (!r) return null;
    out.push(r);
    left -= r;
  }
  return out;
}
