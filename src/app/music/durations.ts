/**
 * Note values: how long each lasts (in ticks — a semiquaver is 1), what it is called, and how
 * VexFlow writes it. Everything that names, draws, splits or snaps a length reads this table.
 */
export interface NoteValue {
  ticks: number;
  /** "dotted crotchet", as the app says it. */
  name: string;
  /** "dotted quarter note". */
  american: string;
  /** The undotted value it is built on. */
  base: number;
  dotted: boolean;
  /** VexFlow's duration code. */
  vex: string;
}

const PLAIN: [number, string, string, string][] = [
  [16, 'semibreve', 'whole note', 'w'],
  [8, 'minim', 'half note', 'h'],
  [4, 'crotchet', 'quarter note', 'q'],
  [2, 'quaver', 'eighth note', '8'],
  [1, 'semiquaver', 'sixteenth note', '16'],
  [0.5, 'demisemiquaver', 'thirty-second note', '32'],
];

/** Every value, plain and dotted, longest first (a dotted semibreve down to a demisemiquaver). */
export const NOTE_VALUES: readonly NoteValue[] = PLAIN.flatMap(([ticks, name, american, vex]) => [
  { ticks: ticks * 1.5, name: `dotted ${name}`, american: `dotted ${american}`, base: ticks, dotted: true, vex },
  { ticks, name, american, base: ticks, dotted: false, vex },
]);

const EPS = 1e-6;

export const valueOf = (ticks: number): NoteValue | undefined => NOTE_VALUES.find((v) => Math.abs(v.ticks - ticks) < EPS);

/** An undotted value (semibreve … demisemiquaver). */
export const isPlain = (ticks: number) => valueOf(ticks)?.dotted === false;

/** "dotted crotchet" (or "1.25 beats" for a length that is no single value). */
export const lengthName = (ticks: number) => valueOf(ticks)?.name ?? `${ticks / 4} beats`;

/** "Dotted crotchet (dotted quarter note)", for labels and screen readers. */
export function fullName(ticks: number): string {
  const v = valueOf(ticks);
  return v ? `${v.name[0].toUpperCase()}${v.name.slice(1)} (${v.american})` : lengthName(ticks);
}

/** A length as the fewest note values, longest first: 5 → [4, 1]. */
export function splitTicks(total: number): number[] {
  const out: number[] = [];
  let left = total;
  while (left > EPS) {
    const value = NOTE_VALUES.find((v) => v.ticks <= left + EPS);
    if (!value) break;
    out.push(value.ticks);
    left -= value.ticks;
  }
  return out;
}

/** The total length of some notes. */
export const totalTicks = (notes: readonly { ticks: number }[]) => notes.reduce((a, n) => a + n.ticks, 0);

/** Where each length starts, from 0: [4, 2, 2] → [0, 4, 6]. */
export function starts(lengths: readonly number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const t of lengths) {
    out.push(at);
    at += t;
  }
  return out;
}

/** Where each note of a voice starts in its bar. */
export const onsets = (notes: readonly { ticks: number }[]) => starts(notes.map((n) => n.ticks));
