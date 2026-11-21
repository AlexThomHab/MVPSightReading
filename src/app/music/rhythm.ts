/**
 * Rhythm building blocks shared by the generators: rhythm cells (one beat's worth of note
 * values, or a longer note spanning beats), the rules that keep them aligned with the metre,
 * and where a bar's harmony may change.
 *
 * Each cell arrives at the grade where the syllabus introduces its note values (see grades.ts):
 * pairs of quavers at Grade 1, semibreves and dotted crotchet–quaver at Grade 2, semiquaver
 * patterns and dotted quaver–semiquaver at Grade 3, syncopation at Grade 5. (Triplets, Grade 6,
 * are written into finished lines by finishing.ts, so the generators keep whole-tick positions.)
 *
 * Durations are in ticks (semiquaver = 1; a triplet quaver 4/3).
 */
import { GRADE_SPECS, Grade, TimeSignature } from './grades';
import { Random } from './random';

export interface RhythmCell {
  /** e.g. "6-2" for dotted crotchet + quaver; "t" for a triplet. */
  name: string;
  ticks: readonly number[];
  /** Length in units: crotchet beats in simple time, dotted-crotchet beats in compound time, quavers in 5/8 and 7/8. */
  units: number;
  /** Off the beat: written only when syncopation is allowed (Grade 5). */
  syncopated?: boolean;
  /** Three quavers in the time of two (Grade 6). */
  triplet?: boolean;
}

function cell(ticks: number[], unit: number, extra: Partial<RhythmCell> = {}): RhythmCell {
  const total = ticks.reduce((a, b) => a + b, 0);
  return { name: extra.triplet ? 't' : ticks.join('-'), ticks, units: Math.round(total / unit), ...extra };
}

/** A triplet quaver. */
export const TRIPLET_QUAVER = 4 / 3;

/** Building blocks for simple time (unit = crotchet, 4 ticks). */
const SIMPLE_CELLS: readonly RhythmCell[] = [
  cell([4], 4),
  cell([8], 4),
  cell([12], 4),
  cell([16], 4),
  cell([2, 2], 4),
  cell([6, 2], 4),
  cell([1, 1, 2], 4),
  cell([2, 1, 1], 4),
  cell([1, 1, 1, 1], 4),
  cell([3, 1], 4),
];

/** Simple syncopation: quaver–crotchet–quaver across two beats, crotchet–minim–crotchet across a 4/4 bar. */
const SYNCOPATED_CELLS: readonly RhythmCell[] = [cell([2, 4, 2], 4, { syncopated: true }), cell([4, 8, 4], 4, { syncopated: true })];

/** Building blocks for compound time and 3/8 (unit = dotted crotchet, 6 ticks). */
const COMPOUND_CELLS: readonly RhythmCell[] = [
  cell([6], 6),
  cell([12], 6),
  cell([4, 2], 6),
  cell([2, 2, 2], 6),
  cell([2, 4], 6),
  cell([2, 1, 1, 2], 6),
  cell([1, 1, 2, 2], 6),
  cell([2, 2, 1, 1], 6),
  cell([3, 1, 2], 6),
];

/** Building blocks for 5/8 and 7/8 (unit = quaver, 2 ticks), each kept within a group of two or three quavers. */
const QUAVER_CELLS: readonly RhythmCell[] = [
  cell([2], 2),
  cell([1, 1], 2),
  cell([4], 2),
  cell([2, 2], 2),
  cell([3, 1], 2),
  cell([1, 1, 2], 2),
  cell([2, 1, 1], 2),
  cell([6], 2),
  cell([4, 2], 2),
  cell([2, 4], 2),
  cell([2, 2, 2], 2),
  cell([3, 1, 2], 2),
];

/** Ticks in one rhythm-cell unit: a crotchet in simple time, a dotted crotchet in compound time and 3/8, a quaver in 5/8 and 7/8. */
export function cellUnit(time: TimeSignature): number {
  if (time.compound || time.id === '3/8') return 6;
  return time.id === '5/8' || time.id === '7/8' ? 2 : 4;
}

export function cellsFor(time: TimeSignature): readonly RhythmCell[] {
  const unit = cellUnit(time);
  return unit === 6 ? COMPOUND_CELLS : unit === 2 ? QUAVER_CELLS : SIMPLE_CELLS;
}

/** Keeps long notes aligned with the metre (no minim across the middle of a 4/4 bar; within a group in 5/4 and 7/8). */
export function cellFitsMetre(c: RhythmCell, pos: number, time: TimeSignature): boolean {
  if (time.compound) return true;
  if (time.irregular) {
    // Each group of the bar, in units: a cell stays inside one.
    const unit = cellUnit(time);
    let start = 0;
    for (const g of time.groups) {
      const end = start + g / unit;
      if (pos >= start && pos < end) return pos + c.units <= end;
      start = end;
    }
    return false;
  }
  if (c.units === 2) return pos % 2 === 0 || time.id === '3/4';
  if (c.units === 3) return pos === 0 || (time.id === '4/4' && pos === 1);
  if (c.units === 4) return pos === 0;
  return true;
}

/** The user's rhythmic customisation (absent: the grade decides everything). */
export interface RhythmPreferences {
  /** The note values were chosen by the user: they replace the grade's vocabulary. */
  customVocabulary: boolean;
  difficulty: 'easy' | 'medium' | 'difficult';
  syncopation: boolean;
  triplets: boolean;
}

/** The rhythmic preferences in a customisation (undefined when there is none). */
export function rhythmPreferences(
  c: { customRhythm: boolean; rhythmicDifficulty: RhythmPreferences['difficulty']; syncopation: boolean; triplets: boolean } | null,
): RhythmPreferences | undefined {
  return c ? { customVocabulary: c.customRhythm, difficulty: c.rhythmicDifficulty, syncopation: c.syncopation, triplets: c.triplets } : undefined;
}

/**
 * How busy a cell is: notes per beat, plus a little for dotted, syncopated and triplet figures.
 * Rhythmic difficulty weights cells by it — never by adding note values the user has not allowed.
 */
function complexity(c: RhythmCell): number {
  const dotted = c.ticks.some((t) => t === 3 || t === 6 || t === 12) && c.ticks.length > 1;
  return c.ticks.length / c.units + (dotted ? 0.75 : 0) + (c.syncopated ? 1 : 0) + (c.triplet ? 1 : 0);
}

const DIFFICULTY_BIAS: Record<RhythmPreferences['difficulty'], (complexity: number) => number> = {
  easy: (x) => 1 / (1 + x) ** 2.5,
  medium: () => 1,
  difficult: (x) => (1 + x) ** 2,
};

/**
 * Fills units [startPos, endPos) of a bar with rhythm cells the grade allows, each chosen at
 * random by `weight` (the form's taste for that cell at that position), adjusted by the
 * user's rhythmic preferences when there are any. Syncopation (Grade 5) and triplets (Grade 6)
 * are occasional: a grade allows them, it does not ask for them in every bar.
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
  const features = GRADE_SPECS[grade].features;
  const syncopation = prefs ? prefs.syncopation : features.syncopation;
  const out: number[] = [];
  let pos = startPos;
  const simple = cellUnit(time) === 4;
  const pool = syncopation && simple && !time.irregular ? [...cellsFor(time), ...SYNCOPATED_CELLS] : cellsFor(time);
  while (pos < endPos) {
    const options = pool.filter(
      (c) =>
        c.units <= endPos - pos &&
        (c.syncopated ? pos % 2 === 0 && (c.units < 4 || time.id === '4/4') : cellFitsMetre(c, pos, time)) &&
        c.ticks.every((t) => durations.includes(t)),
    );
    if (!options.length) {
      // Nothing fits the vocabulary here (a customisation that allows only long notes): one unit's worth.
      const unit = cellUnit(time);
      out.push(unit);
      pos += 1;
      continue;
    }
    const at = pos;
    const bias = prefs ? DIFFICULTY_BIAS[prefs.difficulty] : null;
    const chosen = rng.weighted(options, (c) => {
      const custom = prefs?.syncopation || prefs?.triplets;
      const rare = c.syncopated || c.triplet ? (custom ? 1.5 : 0.35) : 1;
      return weight(c, at) * (bias ? bias(complexity(c)) : 1) * rare;
    });
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
    case '5/8':
      return 6;
    case '9/8':
    case '12/8':
    case '5/4':
      return 12;
    case '7/8':
      return 8;
    case '7/4':
      return 16;
    case '3/8':
      return null;
  }
}
