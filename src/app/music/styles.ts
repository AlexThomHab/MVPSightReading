/**
 * Per-style character: preferred time signatures, rhythm-cell weights, tempo,
 * dynamics and the left-hand accompaniment used at Grades 4–5.
 */
import { Grade, TimeSignatureId } from './grades';
import { ExtraChord } from './theory';

export type StyleId = 'classical' | 'waltz' | 'minuet' | 'march' | 'folk' | 'chorale';
/** Piano styles: a melody with a left-hand accompaniment. */
export const PIANO_STYLE_IDS: readonly StyleId[] = ['classical', 'waltz', 'minuet', 'march', 'folk'];
/** Every style, including four-part chorales in the manner of J. S. Bach. */
export const STYLE_IDS: readonly StyleId[] = [...PIANO_STYLE_IDS, 'chorale'];

/** Left-hand accompaniment at Grades 4–5. Lower grades use long notes or simple intervals. */
export type Accompaniment = 'alberti' | 'oompah' | 'walking' | 'march' | 'drone';

export interface StyleSpec {
  id: StyleId;
  name: string;
  /** Word used in the title, e.g. "Waltz in G major". */
  titleWord: string;
  /** Preferred time signatures; the first one the grade allows is a candidate, see generator. */
  times: readonly TimeSignatureId[];
  majorOnly: boolean;
  /** Chords beyond I, IV and V this style may use (also subject to the grade). */
  extraChords: readonly ExtraChord[];
  accompaniment: Accompaniment;
  tempoMarking: string;
  /** Crotchet beats per minute at Grade 1 and Grade 5 (simple time). */
  crotchetBpm: readonly [number, number];
  dynamic: 'p' | 'mp' | 'mf' | 'f';
  /** Weight for a rhythm cell (by name, see RHYTHM_CELLS) starting at a given beat. Missing names weigh 1. */
  cellWeights: Readonly<Record<string, number>>;
  /** Extra weight for cells starting on the first beat of the bar. */
  downbeatWeights?: Readonly<Record<string, number>>;
}

const ALL_EXTRA_CHORDS: readonly ExtraChord[] = ['ii', 'iii', 'vi', 'vii°', 'V/V', 'v', 'ii°', 'III', 'VI', 'VII'];

export const STYLES: Readonly<Record<StyleId, StyleSpec>> = {
  classical: {
    id: 'classical',
    name: 'Classical',
    titleWord: 'Study',
    times: ['4/4', '2/4'],
    majorOnly: false,
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'alberti',
    tempoMarking: 'Moderato',
    crotchetBpm: [80, 112],
    dynamic: 'mf',
    cellWeights: {
      '4': 5, '2-2': 4, '8': 2, '6-2': 2, '12': 0.8, '16': 0.3,
      '3-1': 0.8, '1-1-2': 1, '2-1-1': 1, '1-1-1-1': 0.6,
      '6': 3, '4-2': 4, '2-2-2': 3, '2-4': 1, '3-1-2': 1, '2-1-1-2': 0.6, '1-1-2-2': 0.6, '2-2-1-1': 0.6,
    },
  },
  waltz: {
    id: 'waltz',
    name: 'Waltz',
    titleWord: 'Waltz',
    times: ['3/4'],
    majorOnly: false,
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'oompah',
    tempoMarking: 'Tempo di valse',
    crotchetBpm: [104, 138],
    dynamic: 'mf',
    cellWeights: { '4': 4, '2-2': 3, '8': 2, '12': 1.5, '6-2': 2.5, '3-1': 1, '1-1-2': 0.6, '2-1-1': 0.6, '1-1-1-1': 0.3 },
    // A long first beat: minim + crotchet, or a dotted minim.
    downbeatWeights: { '8': 4, '12': 1.5, '6-2': 1.5 },
  },
  minuet: {
    id: 'minuet',
    name: 'Minuet',
    titleWord: 'Minuet',
    times: ['3/4'],
    majorOnly: false,
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'walking',
    tempoMarking: 'Tempo di minuetto',
    crotchetBpm: [88, 116],
    dynamic: 'mp',
    cellWeights: { '4': 5, '2-2': 5, '8': 1, '12': 0.4, '6-2': 1, '3-1': 0.6, '1-1-2': 0.8, '2-1-1': 0.8, '1-1-1-1': 0.3 },
  },
  march: {
    id: 'march',
    name: 'March',
    titleWord: 'March',
    times: ['2/4', '4/4'],
    majorOnly: true,
    extraChords: ['ii', 'iii', 'vi', 'vii°', 'V/V'],
    accompaniment: 'march',
    tempoMarking: 'Tempo di marcia',
    crotchetBpm: [88, 116],
    dynamic: 'f',
    cellWeights: {
      '4': 5, '2-2': 2, '8': 1.5, '12': 0.4, '16': 0.2, '6-2': 6, '3-1': 5,
      '1-1-2': 0.7, '2-1-1': 0.7, '1-1-1-1': 0.3,
      '6': 2, '4-2': 5, '2-2-2': 2, '3-1-2': 3,
    },
  },
  folk: {
    id: 'folk',
    name: 'Folk',
    titleWord: 'Folk Song',
    times: ['6/8', '2/4'],
    majorOnly: false,
    extraChords: [],
    accompaniment: 'drone',
    tempoMarking: 'Andantino',
    crotchetBpm: [76, 104],
    dynamic: 'mp',
    cellWeights: {
      '4': 5, '2-2': 3, '8': 2, '6-2': 1.5, '3-1': 0.6, '1-1-2': 0.5, '2-1-1': 0.5, '1-1-1-1': 0.2,
      '6': 3, '4-2': 6, '2-2-2': 3, '2-4': 1.5, '12': 1, '3-1-2': 1, '2-1-1-2': 0.4, '1-1-2-2': 0.4, '2-2-1-1': 0.4,
    },
  },
  // Four-part chorale (see chorale.ts). Only the fields used outside the piano generator matter.
  chorale: {
    id: 'chorale',
    name: 'Bach chorale',
    titleWord: 'Chorale',
    times: ['4/4'],
    majorOnly: false,
    extraChords: [],
    accompaniment: 'alberti',
    tempoMarking: 'Andante',
    crotchetBpm: [60, 72],
    dynamic: 'mf',
    cellWeights: {},
  },
};

export interface RhythmCell {
  /** e.g. "6-2" for dotted crotchet + quaver. */
  name: string;
  ticks: readonly number[];
  /** Length in units: crotchet beats in simple time, dotted-crotchet beats in compound time. */
  units: number;
  minGrade: Grade;
}

function cell(ticks: number[], unit: number, minGrade: Grade): RhythmCell {
  const total = ticks.reduce((a, b) => a + b, 0);
  return { name: ticks.join('-'), ticks, units: total / unit, minGrade };
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
