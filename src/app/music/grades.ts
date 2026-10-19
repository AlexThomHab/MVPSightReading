/**
 * Per-grade limits and time signatures.
 *
 * These limits are our own approximation of a Grade 1–5 sight-reading progression.
 * Check them against the current exam-board syllabus before claiming alignment.
 *
 * Durations are counted in ticks, where one semiquaver = 1 tick:
 * semibreve 16, dotted minim 12, minim 8, dotted crotchet 6, crotchet 4,
 * dotted quaver 3, quaver 2, semiquaver 1.
 */

export type Grade = 1 | 2 | 3 | 4 | 5;
export const GRADES: readonly Grade[] = [1, 2, 3, 4, 5];

export const TICKS = {
  semibreve: 16,
  dottedMinim: 12,
  minim: 8,
  dottedCrotchet: 6,
  crotchet: 4,
  dottedQuaver: 3,
  quaver: 2,
  semiquaver: 1,
} as const;

export type TimeSignatureId = '2/4' | '3/4' | '4/4' | '6/8' | '3/8' | '9/8';

export interface TimeSignature {
  id: TimeSignatureId;
  num: number;
  den: number;
  barTicks: number;
  /** Ticks per counted beat: a crotchet in simple time, a dotted crotchet in 6/8 and 9/8, a quaver in 3/8. */
  beatTicks: number;
  beatsPerBar: number;
  compound: boolean;
  /** Accented bar positions (ticks). The downbeat melody note must be a chord tone; later accents prefer one. */
  strongTicks: readonly number[];
}

export const TIME_SIGNATURES: Readonly<Record<TimeSignatureId, TimeSignature>> = {
  '2/4': { id: '2/4', num: 2, den: 4, barTicks: 8, beatTicks: 4, beatsPerBar: 2, compound: false, strongTicks: [0] },
  '3/4': { id: '3/4', num: 3, den: 4, barTicks: 12, beatTicks: 4, beatsPerBar: 3, compound: false, strongTicks: [0] },
  '4/4': { id: '4/4', num: 4, den: 4, barTicks: 16, beatTicks: 4, beatsPerBar: 4, compound: false, strongTicks: [0, 8] },
  '6/8': { id: '6/8', num: 6, den: 8, barTicks: 12, beatTicks: 6, beatsPerBar: 2, compound: true, strongTicks: [0] },
  '3/8': { id: '3/8', num: 3, den: 8, barTicks: 6, beatTicks: 2, beatsPerBar: 3, compound: false, strongTicks: [0] },
  '9/8': { id: '9/8', num: 9, den: 8, barTicks: 18, beatTicks: 6, beatsPerBar: 3, compound: true, strongTicks: [0] },
};

export interface GradeSpec {
  grade: Grade;
  /** Key ids (see theory.ts KEYS). */
  keys: readonly string[];
  times: readonly TimeSignatureId[];
  /** Note and rest durations (ticks) that may appear. */
  durations: readonly number[];
  /** Possible piece lengths in bars. */
  bars: readonly number[];
  /** Largest right-hand melodic leap, in diatonic steps (2 = a third, 7 = an octave). */
  maxLeap: number;
  /** Largest left-hand leap between bass notes, in diatonic steps. */
  maxBassLeap: number;
  /** Right-hand range as scale degrees from the tonic (0..4 = five-finger position). */
  rhRange: readonly [number, number];
  /** Left-hand range as scale degrees from the bass tonic. */
  lhRange: readonly [number, number];
  /** Chords available beyond I, IV and V. */
  extraChords: readonly ('ii' | 'vi' | 'VI' | 'V/V')[];
  /** Whether notes outside the key (other than the minor leading note) may appear. */
  chromatic: boolean;
}

const G1_KEYS = ['C', 'G', 'F', 'Am'];
const G2_KEYS = [...G1_KEYS, 'D', 'Dm', 'Em'];
const G3_KEYS = [...G2_KEYS, 'Bb', 'Bm', 'Gm'];
const G4_KEYS = [...G3_KEYS, 'A', 'Eb', 'F#m', 'Cm'];
const G5_KEYS = [...G4_KEYS, 'E', 'Ab', 'C#m', 'Fm'];

const G1_DURATIONS = [TICKS.semibreve, TICKS.dottedMinim, TICKS.minim, TICKS.crotchet];

export const GRADE_SPECS: Readonly<Record<Grade, GradeSpec>> = {
  1: {
    grade: 1,
    keys: G1_KEYS,
    times: ['2/4', '3/4', '4/4'],
    durations: G1_DURATIONS,
    bars: [4],
    maxLeap: 2,
    maxBassLeap: 4,
    rhRange: [0, 4],
    lhRange: [0, 4],
    extraChords: [],
    chromatic: false,
  },
  2: {
    grade: 2,
    keys: G2_KEYS,
    times: ['2/4', '3/4', '4/4'],
    durations: [...G1_DURATIONS, TICKS.quaver],
    bars: [8],
    maxLeap: 3,
    maxBassLeap: 4,
    rhRange: [-1, 5],
    lhRange: [-3, 4],
    extraChords: [],
    chromatic: false,
  },
  3: {
    grade: 3,
    keys: G3_KEYS,
    times: ['2/4', '3/4', '4/4', '6/8'],
    durations: [...G1_DURATIONS, TICKS.quaver, TICKS.dottedCrotchet],
    bars: [8],
    maxLeap: 4,
    maxBassLeap: 5,
    rhRange: [-2, 7],
    lhRange: [-4, 5],
    extraChords: ['vi', 'VI', 'ii'],
    chromatic: false,
  },
  4: {
    grade: 4,
    keys: G4_KEYS,
    times: ['2/4', '3/4', '4/4', '6/8', '3/8'],
    durations: [...G1_DURATIONS, TICKS.quaver, TICKS.dottedCrotchet, TICKS.semiquaver],
    bars: [8, 12],
    maxLeap: 5,
    maxBassLeap: 7,
    rhRange: [-3, 7],
    lhRange: [-4, 5],
    extraChords: ['vi', 'VI', 'ii', 'V/V'],
    chromatic: true,
  },
  5: {
    grade: 5,
    keys: G5_KEYS,
    times: ['2/4', '3/4', '4/4', '6/8', '3/8', '9/8'],
    durations: [
      ...G1_DURATIONS,
      TICKS.quaver,
      TICKS.dottedCrotchet,
      TICKS.semiquaver,
      TICKS.dottedQuaver,
    ],
    bars: [12],
    maxLeap: 7,
    maxBassLeap: 7,
    rhRange: [-3, 9],
    lhRange: [-5, 6],
    extraChords: ['vi', 'VI', 'ii', 'V/V'],
    chromatic: true,
  },
};
