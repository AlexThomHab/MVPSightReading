/**
 * The grades: ABRSM Piano Grades 1–8 sight-reading, as a table of what each grade allows.
 *
 * Source: ABRSM Piano Practical Grades syllabus 2025 & 2026, "Sight-reading parameters"
 * (page 16). The syllabus lists, grade by grade, the elements each grade introduces; they are
 * cumulative — once introduced, an element may appear at every later grade. Each grade here is
 * the maximum a piece may use, not a list of things every piece must contain.
 *
 * The syllabus gives the elements; it gives no measure of melodic leaps, range or density.
 * Those (maxLeap, the ranges, `complexity`) are our own calibration, marked as such below.
 *
 * Durations are counted in ticks, where one semiquaver = 1 tick: semibreve 16, dotted minim
 * 12, minim 8, dotted crotchet 6, crotchet 4, dotted quaver 3, quaver 2, semiquaver 1; a
 * triplet quaver lasts 4/3.
 *
 * Grade-specific behaviour belongs here, in data. The generators read these flags (never
 * "grade >= 6" for a syllabus element), so a future syllabus is a change to this table.
 */
import type { DynamicMark } from './model';
import { ExtraChord } from './theory';

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6, 7, 8];

export type TimeSignatureId = '2/4' | '3/4' | '4/4' | '3/8' | '6/8' | '9/8' | '12/8' | '5/8' | '7/8' | '5/4' | '7/4';

export interface TimeSignature {
  id: TimeSignatureId;
  num: number;
  den: number;
  barTicks: number;
  /** Ticks per counted beat: a crotchet in simple time, a dotted crotchet in compound time, a quaver in 3/8, 5/8 and 7/8. */
  beatTicks: number;
  beatsPerBar: number;
  compound: boolean;
  /** Accented bar positions (ticks). The downbeat melody note must be a chord tone; later accents prefer one. */
  strongTicks: readonly number[];
  /**
   * The bar's beat groups (ticks), which beams and long notes keep within: 3 + 2 quavers in
   * 5/8, 2 + 2 + 3 in 7/8, 3 + 2 crotchets in 5/4, 4 + 3 in 7/4.
   */
  groups: readonly number[];
  /** Irregular (asymmetric) metre: 5/8, 7/8, 5/4, 7/4. */
  irregular?: boolean;
}

const ts = (id: TimeSignatureId, beatTicks: number, groups: number[], strongTicks: number[], compound = false, irregular = false): TimeSignature => {
  const [num, den] = id.split('/').map(Number);
  const barTicks = groups.reduce((a, b) => a + b, 0);
  return { id, num, den, barTicks, beatTicks, beatsPerBar: barTicks / beatTicks, compound, strongTicks, groups, ...(irregular ? { irregular } : {}) };
};

export const TIME_SIGNATURES: Readonly<Record<TimeSignatureId, TimeSignature>> = {
  '2/4': ts('2/4', 4, [4, 4], [0]),
  '3/4': ts('3/4', 4, [4, 4, 4], [0]),
  '4/4': ts('4/4', 4, [8, 8], [0, 8]),
  '3/8': ts('3/8', 2, [6], [0]),
  '6/8': ts('6/8', 6, [6, 6], [0], true),
  '9/8': ts('9/8', 6, [6, 6, 6], [0], true),
  '12/8': ts('12/8', 6, [6, 6, 6, 6], [0, 12], true),
  '5/8': ts('5/8', 2, [6, 4], [0, 6], false, true),
  '7/8': ts('7/8', 2, [4, 4, 6], [0, 8], false, true),
  '5/4': ts('5/4', 4, [12, 8], [0, 12], false, true),
  '7/4': ts('7/4', 4, [16, 12], [0, 16], false, true),
};

/** Articulation marks, as written on a note. */
export type ArticulationMark = 'staccato' | 'accent' | 'tenuto';

/** The syllabus's elements, each from the grade that introduces it (and at every grade after). */
export interface GradeFeatures {
  /** Grade 2: both hands play together (at Grade 1 each hand plays on its own). */
  handsTogether: boolean;
  /** Grades 1–2: each hand stays in one five-finger position. */
  fiveFinger: boolean;
  /** Most notes in one hand at once: single notes, 2-note chords (Grade 3), 3-note chords (Grade 8). */
  chordNotes: 1 | 2 | 3;
  /** Grade 5: four-part chords, two notes in each hand. */
  fourPart: boolean;
  /** Grade 2. */
  ties: boolean;
  /** Grade 4: an upbeat start. */
  anacrusis: boolean;
  /** Grade 4: pause signs. */
  fermata: boolean;
  /** Grade 5. */
  syncopation: boolean;
  /** Grade 5: slowing of tempo at the end (rit.). */
  ritardando: boolean;
  /** Grade 6. */
  triplets: boolean;
  /** Grade 6: a left-hand passage in the treble clef. */
  clefChanges: boolean;
  /** Grade 6: the right (sustaining) pedal. */
  sustainPedal: boolean;
  /** Grade 7: tempo changes within the piece. */
  tempoChanges: boolean;
  /** Grade 7: the 8va sign. */
  ottava: boolean;
  /** Grade 7: the una corda pedal. */
  unaCorda: boolean;
  /** Grade 8: spread (arpeggiated) chords. */
  spreadChords: boolean;
  /** Grade 8: simple ornaments. */
  ornaments: boolean;
  /** Grade 8: acceleration of tempo (accel.). */
  accelerando: boolean;
}

export interface GradeSpec {
  grade: Grade;
  /** Key ids (see theory.ts KEYS). */
  keys: readonly string[];
  times: readonly TimeSignatureId[];
  /** Note durations (ticks) that may appear (triplets are a feature of their own). */
  durations: readonly number[];
  /** Rest durations (ticks) that may appear. */
  rests: readonly number[];
  /** Piece lengths in bars, as each generator can best make them (approximate, as the syllabus is). */
  bars: readonly number[];
  /** Largest right-hand melodic leap, in diatonic steps (2 = a third, 7 = an octave). Our calibration. */
  maxLeap: number;
  /** Largest left-hand leap between bass notes, in diatonic steps. Our calibration. */
  maxBassLeap: number;
  /** Right-hand range as scale degrees from the tonic (0..4 = five-finger position). Our calibration. */
  rhRange: readonly [number, number];
  /** Left-hand range as scale degrees from the bass tonic. */
  lhRange: readonly [number, number];
  /** Chords available beyond I, IV and V. */
  extraChords: readonly ExtraChord[];
  /** First-inversion chords and two chords per bar (needed for sequences). */
  inversions: boolean;
  /** Notes outside the key (other than the minor leading note): chromatic notes, Grade 4. */
  chromatic: boolean;
  articulations: readonly ArticulationMark[];
  dynamics: readonly DynamicMark[];
  /** Crescendo and diminuendo hairpins (Grade 1). */
  hairpins: boolean;
  /** Slurs and legato phrases (Grade 1). */
  slurs: boolean;
  features: GradeFeatures;
  /**
   * How far the grade reaches, 0–1, on each axis the syllabus leaves to us: rhythmic variety,
   * melodic range and leaps, harmonic colour, independence of the hands. The generators scale
   * their appetites by these, so difficulty grows on every axis — not just by tempo.
   */
  complexity: { rhythmic: number; melodic: number; harmonic: number; handIndependence: number };
}

// ---------------------------------------------------------------------------
// The syllabus, grade by grade: what each grade adds to the one before.
// ---------------------------------------------------------------------------

const MINIM = 8;
const CROTCHET = 4;
const QUAVER = 2;

const G3_CHORDS: readonly ExtraChord[] = ['ii', 'iii', 'vi', 'v', 'III', 'VI'];
const G4_CHORDS: readonly ExtraChord[] = [...G3_CHORDS, 'vii°', 'VII', 'ii°', 'V/V', 'V/ii'];

const NO_FEATURES: GradeFeatures = {
  handsTogether: false,
  fiveFinger: true,
  chordNotes: 1,
  fourPart: false,
  ties: false,
  anacrusis: false,
  fermata: false,
  syncopation: false,
  ritardando: false,
  triplets: false,
  clefChanges: false,
  sustainPedal: false,
  tempoChanges: false,
  ottava: false,
  unaCorda: false,
  spreadChords: false,
  ornaments: false,
  accelerando: false,
};

/** One grade: the previous grade's spec with this grade's additions. */
type Additions = Partial<Omit<GradeSpec, 'features' | 'complexity'>> & {
  addKeys?: string[];
  addTimes?: TimeSignatureId[];
  addDurations?: number[];
  addRests?: number[];
  addDynamics?: DynamicMark[];
  addArticulations?: ArticulationMark[];
  features?: Partial<GradeFeatures>;
  complexity: GradeSpec['complexity'];
};

const GRADE_1: GradeSpec = {
  grade: 1,
  // Initial grade: C major, D minor; Grade 1: G and F majors, A minor.
  keys: ['C', 'G', 'F', 'Am', 'Dm'],
  times: ['4/4', '2/4', '3/4'],
  // Minims, crotchets, pairs of quavers (Initial); dotted minims and groups of quavers.
  durations: [12, MINIM, CROTCHET, QUAVER],
  rests: [MINIM, CROTCHET],
  bars: [4, 6],
  maxLeap: 3,
  maxBassLeap: 4,
  // Any five-finger position (here: tonic to dominant, in each hand).
  rhRange: [0, 4],
  lhRange: [0, 4],
  extraChords: [],
  inversions: false,
  chromatic: false,
  articulations: ['staccato', 'accent'],
  dynamics: ['p', 'mp', 'mf', 'f'],
  hairpins: true,
  slurs: true,
  features: NO_FEATURES,
  complexity: { rhythmic: 0.1, melodic: 0.1, harmonic: 0, handIndependence: 0 },
};

const ADDITIONS: Record<Exclude<Grade, 1>, Additions> = {
  // D major; E and G minors. Hands together; semibreves, dotted crotchet–quaver; ties; pp.
  2: {
    addKeys: ['D', 'Em', 'Gm'],
    addDurations: [16, 6],
    addRests: [12, 16],
    bars: [6, 8],
    maxLeap: 4,
    addDynamics: ['pp'],
    features: { handsTogether: true, ties: true },
    complexity: { rhythmic: 0.2, melodic: 0.2, harmonic: 0.1, handIndependence: 0.1 },
  },
  // A, B-flat, E-flat majors; B minor; 3/8. Up to 8 bars, outside five-finger positions,
  // 2-note chords in either hand, simple semiquaver patterns, dotted quaver–semiquaver, quaver rests.
  3: {
    addKeys: ['A', 'Bb', 'Eb', 'Bm'],
    addTimes: ['3/8'],
    addDurations: [1, 3],
    addRests: [QUAVER, 6],
    bars: [8],
    maxLeap: 5,
    maxBassLeap: 5,
    rhRange: [-2, 7],
    lhRange: [-5, 5],
    extraChords: G3_CHORDS,
    inversions: true,
    features: { fiveFinger: false, chordNotes: 2 },
    complexity: { rhythmic: 0.35, melodic: 0.35, harmonic: 0.3, handIndependence: 0.3 },
  },
  // 6/8. About 8 bars; anacrusis, chromatic notes, pause signs, tenuto.
  4: {
    addTimes: ['6/8'],
    bars: [8],
    maxBassLeap: 7,
    rhRange: [-3, 7],
    lhRange: [-5, 6],
    extraChords: G4_CHORDS,
    chromatic: true,
    addArticulations: ['tenuto'],
    features: { anacrusis: true, fermata: true },
    complexity: { rhythmic: 0.45, melodic: 0.45, harmonic: 0.45, handIndependence: 0.45 },
  },
  // E, A-flat majors; F-sharp, C minors. 8–12 bars; four-part chords (two notes a hand),
  // simple syncopation, slowing at the end, ff.
  5: {
    addKeys: ['E', 'Ab', 'F#m', 'Cm'],
    bars: [8, 12],
    maxLeap: 7,
    rhRange: [-3, 9],
    addDynamics: ['ff'],
    features: { fourPart: true, syncopation: true, ritardando: true },
    complexity: { rhythmic: 0.55, melodic: 0.55, harmonic: 0.55, handIndependence: 0.55 },
  },
  // C-sharp, F minors; 9/8, 5/8, 5/4. 12–16 bars; triplets, clef changes, the right pedal.
  6: {
    addKeys: ['C#m', 'Fm'],
    addTimes: ['9/8', '5/8', '5/4'],
    bars: [12, 16],
    rhRange: [-4, 10],
    lhRange: [-7, 7],
    features: { triplets: true, clefChanges: true, sustainPedal: true },
    complexity: { rhythmic: 0.7, melodic: 0.65, harmonic: 0.65, handIndependence: 0.65 },
  },
  // 7/8, 7/4. 16–20 bars; tempo changes, the 8va sign, una corda.
  7: {
    addTimes: ['7/8', '7/4'],
    bars: [16, 20],
    rhRange: [-5, 11],
    lhRange: [-8, 7],
    features: { tempoChanges: true, ottava: true, unaCorda: true },
    complexity: { rhythmic: 0.8, melodic: 0.75, harmonic: 0.8, handIndependence: 0.8 },
  },
  // B, D-flat majors; 12/8. About a page; 3-note chords in either hand, spread chords,
  // simple ornaments, acceleration of tempo.
  8: {
    addKeys: ['B', 'Db'],
    addTimes: ['12/8'],
    bars: [24],
    rhRange: [-5, 12],
    lhRange: [-9, 7],
    features: { chordNotes: 3, spreadChords: true, ornaments: true, accelerando: true },
    complexity: { rhythmic: 0.9, melodic: 0.85, harmonic: 0.9, handIndependence: 0.9 },
  },
};

function build(): Record<Grade, GradeSpec> {
  const out = { 1: GRADE_1 } as Record<Grade, GradeSpec>;
  for (const grade of GRADES.slice(1)) {
    const prev = out[(grade - 1) as Grade];
    const a = ADDITIONS[grade as Exclude<Grade, 1>];
    const { addKeys, addTimes, addDurations, addRests, addDynamics, addArticulations, features, complexity, ...set } = a;
    out[grade] = {
      ...prev,
      ...set,
      grade,
      keys: [...prev.keys, ...(addKeys ?? [])],
      times: [...prev.times, ...(addTimes ?? [])],
      durations: [...prev.durations, ...(addDurations ?? [])].sort((x, y) => y - x),
      rests: [...prev.rests, ...(addRests ?? [])].sort((x, y) => y - x),
      dynamics: [...prev.dynamics, ...(addDynamics ?? [])],
      articulations: [...prev.articulations, ...(addArticulations ?? [])],
      features: { ...prev.features, ...features },
      complexity,
    };
  }
  return out;
}

export const GRADE_SPECS: Readonly<Record<Grade, GradeSpec>> = build();

/**
 * The lengths a generator that builds in units of `unit` bars (four-bar phrases, two-bar
 * chorale phrases) can make within a grade's range: multiples of the unit between the grade's
 * shortest and longest — or, if none lies inside, the multiple nearest the range.
 */
export function lengthsFor(spec: GradeSpec, unit: number): number[] {
  const min = Math.min(...spec.bars);
  const max = Math.max(...spec.bars);
  const inside: number[] = [];
  for (let n = Math.ceil(min / unit) * unit; n <= max; n += unit) inside.push(n);
  if (inside.length) return inside;
  const below = Math.floor(min / unit) * unit;
  const above = Math.ceil(max / unit) * unit;
  return [below > 0 && min - below <= above - max ? below : above];
}

/** "Grade 5" — and, for the grade selector, that the grades follow ABRSM's. */
export const gradeName = (g: Grade) => `Grade ${g}`;

/** The first grade that has a feature. */
export function gradeIntroducing(feature: keyof GradeFeatures): Grade | null {
  return GRADES.find((g) => GRADE_SPECS[g].features[feature]) ?? null;
}

export function isGrade(value: number): value is Grade {
  return (GRADES as readonly number[]).includes(value);
}

export function isTimeSignatureId(value: string | null): value is TimeSignatureId {
  // (An own key: `'toString' in TIME_SIGNATURES` is true too.)
  return value !== null && Object.prototype.hasOwnProperty.call(TIME_SIGNATURES, value);
}
