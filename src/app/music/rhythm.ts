/**
 * Rhythm building blocks shared by the generators: rhythm cells (one beat's worth of note
 * values, or a longer note spanning beats), the rules that keep them aligned with the metre,
 * and where a bar's harmony may change.
 *
 * Durations are in ticks (semiquaver = 1).
 */
import { Grade, TimeSignature } from './grades';
import { Random } from './random';

export interface RhythmCell {
  /** e.g. "6-2" for dotted crotchet + quaver. */
  name: string;
  ticks: readonly number[];
  /** Length in units: crotchet beats in simple time, dotted-crotchet beats in compound time. */
  units: number;
  /** The first grade at which the cell may appear. */
  minGrade: Grade;
  /** Off the beat: written only when syncopation is allowed. */
  syncopated?: boolean;
}

function cell(ticks: number[], unit: number, minGrade: Grade, syncopated = false): RhythmCell {
  const total = ticks.reduce((a, b) => a + b, 0);
  return { name: ticks.join('-'), ticks, units: total / unit, minGrade, ...(syncopated ? { syncopated } : {}) };
}

/** Building blocks for simple time (unit = crotchet, 4 ticks). */
export const SIMPLE_CELLS: readonly RhythmCell[] = [
  cell([4], 4, 1),
  cell([8], 4, 1),
  cell([12], 4, 1),
  cell([16], 4, 1),
  cell([2, 2], 4, 2),
  cell([6, 2], 4, 3),
  cell([1, 1, 2], 4, 4),
  cell([2, 1, 1], 4, 4),
  cell([1, 1, 1, 1], 4, 4),
  cell([3, 1], 4, 5),
];

/**
 * Syncopations, offered only when the user allows them: quaver–crotchet–quaver across two
 * beats, and crotchet–minim–crotchet across a 4/4 bar.
 */
const SYNCOPATED_CELLS: readonly RhythmCell[] = [cell([2, 4, 2], 4, 2, true), cell([4, 8, 4], 4, 2, true)];

/** Building blocks for compound time and 3/8 (unit = dotted crotchet, 6 ticks). */
export const COMPOUND_CELLS: readonly RhythmCell[] = [
  cell([6], 6, 3),
  cell([12], 6, 3),
  cell([4, 2], 6, 3),
  cell([2, 2, 2], 6, 3),
  cell([2, 4], 6, 3),
  cell([2, 1, 1, 2], 6, 4),
  cell([1, 1, 2, 2], 6, 4),
  cell([2, 2, 1, 1], 6, 4),
  cell([3, 1, 2], 6, 5),
];

/** Ticks in one rhythm-cell unit: a crotchet in simple time, a dotted crotchet in compound time and 3/8. */
export function cellUnit(time: TimeSignature): number {
  return time.compound || time.id === '3/8' ? 6 : 4;
}

export function cellsFor(time: TimeSignature): readonly RhythmCell[] {
  return cellUnit(time) === 6 ? COMPOUND_CELLS : SIMPLE_CELLS;
}

/** Keeps long notes aligned with the metre (no minim across the middle of a 4/4 bar). */
export function cellFitsMetre(c: RhythmCell, pos: number, time: TimeSignature): boolean {
  if (time.compound) return true;
  if (c.units === 2) return pos % 2 === 0 || time.id === '3/4';
  if (c.units === 3) return pos === 0 || (time.id === '4/4' && pos === 1);
  if (c.units === 4) return pos === 0;
  return true;
}

/** The user's rhythmic customisation (absent: the grade decides everything). */
export interface RhythmPreferences {
  /** The note values were chosen by the user: they replace the grade's gradual introduction of cells. */
  customVocabulary: boolean;
  difficulty: 'easy' | 'medium' | 'difficult';
  syncopation: boolean;
}

/** The rhythmic preferences in a customisation (undefined when there is none). */
export function rhythmPreferences(
  c: { customRhythm: boolean; rhythmicDifficulty: RhythmPreferences['difficulty']; syncopation: boolean } | null,
): RhythmPreferences | undefined {
  return c ? { customVocabulary: c.customRhythm, difficulty: c.rhythmicDifficulty, syncopation: c.syncopation } : undefined;
}

/**
 * How busy a cell is: notes per beat, plus a little for dotted and syncopated figures. Rhythmic
 * difficulty weights cells by it — never by adding note values the user has not allowed.
 */
function complexity(c: RhythmCell): number {
  const dotted = c.ticks.some((t) => t === 3 || t === 6 || t === 12) && c.ticks.length > 1;
  return c.ticks.length / c.units + (dotted ? 0.75 : 0) + (c.syncopated ? 1 : 0);
}

const DIFFICULTY_BIAS: Record<RhythmPreferences['difficulty'], (complexity: number) => number> = {
  easy: (x) => 1 / (1 + x) ** 2.5,
  medium: () => 1,
  difficult: (x) => (1 + x) ** 2,
};

/**
 * Fills units [startPos, endPos) of a bar with rhythm cells the grade allows, each chosen at
 * random by `weight` (the style's taste for that cell at that position), adjusted by the
 * user's rhythmic preferences when there are any.
 */
export function fillWithCells(
  rng: Random,
  time: TimeSignature,
  grade: Grade,
  durations: readonly number[],
  startPos: number,
  endPos: number,
  weight: (c: RhythmCell, pos: number) => number,
  prefs?: RhythmPreferences,
): number[] {
  const out: number[] = [];
  let pos = startPos;
  const pool = prefs?.syncopation && !time.compound && time.id !== '3/8' ? [...cellsFor(time), ...SYNCOPATED_CELLS] : cellsFor(time);
  while (pos < endPos) {
    const options = pool.filter(
      (c) =>
        (prefs?.customVocabulary || c.minGrade <= grade) &&
        c.units <= endPos - pos &&
        (c.syncopated ? pos % 2 === 0 && (c.units < 4 || time.id === '4/4') : cellFitsMetre(c, pos, time)) &&
        c.ticks.every((t) => durations.includes(t)),
    );
    const at = pos;
    const bias = prefs ? DIFFICULTY_BIAS[prefs.difficulty] : null;
    const chosen = rng.weighted(options, (c) => weight(c, at) * (bias ? bias(complexity(c)) : 1) * (c.syncopated ? 1.5 : 1));
    out.push(...chosen.ticks);
    pos += chosen.units;
  }
  return out;
}

/** Where a bar's harmony may change (two chords to the bar), or null if it cannot (3/8). */
export function harmonySplit(time: TimeSignature): number | null {
  switch (time.id) {
    case '2/4':
      return 4;
    case '3/4':
    case '4/4':
      return 8;
    case '6/8':
      return 6;
    case '9/8':
      return 12;
    case '3/8':
      return null;
  }
}
