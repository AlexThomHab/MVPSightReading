/**
 * The piano styles (Classical, Waltz, Minuet, March, Folk): each style's character for the
 * piano generator — preferred metres, rhythm-cell weights, tempo, dynamics and the left-hand
 * accompaniment used at Grades 4–5.
 */
import { TimeSignatureId } from './grades';
import { StyleId } from './styles';
import { ExtraChord } from './theory';

export type PianoStyleId = Extract<StyleId, 'classical' | 'waltz' | 'minuet' | 'march' | 'folk'>;
export const PIANO_STYLE_IDS: readonly PianoStyleId[] = ['classical', 'waltz', 'minuet', 'march', 'folk'];

/** Left-hand accompaniment at Grades 4–5. Lower grades use long notes or simple intervals. */
export type Accompaniment = 'alberti' | 'oompah' | 'walking' | 'march' | 'drone';

export interface PianoStyleSpec {
  id: PianoStyleId;
  /** Word used in the title, e.g. "Waltz in G major". */
  titleWord: string;
  /** Preferred time signatures (the first is the most typical); see chooseTime in piano.ts. */
  times: readonly TimeSignatureId[];
  /** Chords beyond I, IV and V this style may use (also subject to the grade). */
  extraChords: readonly ExtraChord[];
  accompaniment: Accompaniment;
  tempoMarking: string;
  /** Crotchet beats per minute at Grade 1 and Grade 5 (simple time). */
  crotchetBpm: readonly [number, number];
  dynamic: 'p' | 'mp' | 'mf' | 'f';
  /** Weight for a rhythm cell (by name, see rhythm.ts) starting at a given beat. Missing names weigh 1. */
  cellWeights: Readonly<Record<string, number>>;
  /** Extra weight for cells starting on the first beat of the bar. */
  downbeatWeights?: Readonly<Record<string, number>>;
}

const ALL_EXTRA_CHORDS: readonly ExtraChord[] = ['ii', 'iii', 'vi', 'vii°', 'V/V', 'v', 'ii°', 'III', 'VI', 'VII'];

export const PIANO_STYLES: Readonly<Record<PianoStyleId, PianoStyleSpec>> = {
  classical: {
    id: 'classical',
    titleWord: 'Study',
    times: ['4/4', '2/4'],
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
    titleWord: 'Waltz',
    times: ['3/4'],
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
    titleWord: 'Minuet',
    times: ['3/4'],
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'walking',
    tempoMarking: 'Tempo di minuetto',
    crotchetBpm: [88, 116],
    dynamic: 'mp',
    cellWeights: { '4': 5, '2-2': 5, '8': 1, '12': 0.4, '6-2': 1, '3-1': 0.6, '1-1-2': 0.8, '2-1-1': 0.8, '1-1-1-1': 0.3 },
  },
  march: {
    id: 'march',
    titleWord: 'March',
    times: ['2/4', '4/4'],
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
    titleWord: 'Folk Song',
    times: ['6/8', '2/4'],
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
};

export function isPianoStyle(id: StyleId): id is PianoStyleId {
  return Object.prototype.hasOwnProperty.call(PIANO_STYLES, id);
}
