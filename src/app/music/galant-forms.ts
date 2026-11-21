/**
 * The Classical / Galant era's forms — Minuet, Trio, Waltz, Polonaise, Gavotte — as the galant
 * generator reads them: tempo, dynamic, the harmony each allows, its rhythmic character (which
 * rhythm cells it favours, and where), its accompaniment at Grades 4–5, its articulation, and
 * whether it begins with an upbeat. The schemata that shape every phrase are shared (galant.ts).
 */
import { ExtraChord } from './theory';

export type GalantFormId = 'minuet' | 'trio' | 'waltz' | 'polonaise' | 'gavotte';

/** Left-hand accompaniment at Grades 4–5 (lower grades use long notes or simple intervals). */
export type Accompaniment = 'walking' | 'light' | 'oompah' | 'polonaise';

export interface GalantFormSpec {
  id: GalantFormId;
  /** Word used in the title, e.g. "Minuet in G major". */
  titleWord: string;
  /** Chords beyond I, IV and V the form may use (also subject to the grade). */
  extraChords: readonly ExtraChord[];
  accompaniment: Accompaniment;
  tempoMarking: string;
  /** Crotchet beats per minute at Grade 1 and Grade 5 (simple time). */
  crotchetBpm: readonly [number, number];
  dynamic: 'p' | 'mp' | 'mf' | 'f';
  /** Weight for a rhythm cell (by name, see rhythm.ts) starting at a given beat. Missing names weigh 1. */
  cellWeights: Readonly<Record<string, number>>;
  /** Extra weight for cells starting on the first beat of the bar: the form's signature rhythm. */
  downbeatWeights?: Readonly<Record<string, number>>;
  /** Opens with a half-bar upbeat, so its phrases (and its cadences) fall in the middle of the bar. */
  upbeat?: boolean;
  /** The dance's articulation: detached crotchets (Gavotte) or an accented downbeat (Polonaise). */
  articulation?: 'detached' | 'accented';
}

const ALL_EXTRA_CHORDS: readonly ExtraChord[] = ['ii', 'iii', 'vi', 'vii°', 'V/V', 'V/ii', 'v', 'ii°', 'III', 'VI', 'VII'];

export const GALANT_FORMS: Readonly<Record<GalantFormId, GalantFormSpec>> = {
  // Elegant triple time: steady crotchets and pairs of quavers, balanced phrases, clear cadences.
  minuet: {
    id: 'minuet',
    titleWord: 'Minuet',
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'walking',
    tempoMarking: 'Tempo di minuetto',
    crotchetBpm: [88, 116],
    dynamic: 'mp',
    cellWeights: { '4': 5, '2-2': 5, '8': 1, '12': 0.4, '6-2': 1, '3-1': 0.6, '1-1-2': 0.8, '2-1-1': 0.8, '1-1-1-1': 0.3 },
  },
  // The lighter contrasting section, here on its own: a smoother line, a thinner texture, softer.
  trio: {
    id: 'trio',
    titleWord: 'Trio',
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'light',
    tempoMarking: 'Poco più tranquillo',
    crotchetBpm: [80, 108],
    dynamic: 'p',
    cellWeights: {
      '4': 5, '2-2': 4, '8': 2.5, '6-2': 2, '12': 1, '16': 0.4, '3-1': 0.5, '1-1-2': 0.5, '2-1-1': 0.5, '1-1-1-1': 0.2,
    },
  },
  // Triple time over an oom-pah-pah bass, with a long first beat — harmonically restrained.
  waltz: {
    id: 'waltz',
    titleWord: 'Waltz',
    extraChords: ['ii', 'vi', 'vii°', 'v', 'ii°', 'III', 'VI'],
    accompaniment: 'oompah',
    tempoMarking: 'Tempo di valse',
    crotchetBpm: [104, 138],
    dynamic: 'mf',
    cellWeights: { '4': 4, '2-2': 3, '8': 2, '12': 1.5, '6-2': 2.5, '3-1': 1, '1-1-2': 0.6, '2-1-1': 0.6, '1-1-1-1': 0.3 },
    // A long first beat: minim + crotchet, or a dotted minim.
    downbeatWeights: { '8': 4, '12': 1.5, '6-2': 1.5 },
  },
  // Stately triple time: the polonaise rhythm (a quaver and two semiquavers) on the first beat.
  polonaise: {
    id: 'polonaise',
    titleWord: 'Polonaise',
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'polonaise',
    tempoMarking: 'Alla polacca',
    crotchetBpm: [76, 96],
    dynamic: 'f',
    cellWeights: { '4': 4, '2-2': 4, '2-1-1': 3, '8': 1, '6-2': 1.5, '3-1': 1.5, '1-1-2': 1, '1-1-1-1': 0.5, '12': 0.3 },
    downbeatWeights: { '2-1-1': 8, '3-1': 2, '2-2': 1.5 },
    articulation: 'accented',
  },
  // Duple time with a half-bar upbeat: phrases begin and end in the middle of the bar.
  gavotte: {
    id: 'gavotte',
    titleWord: 'Gavotte',
    extraChords: ALL_EXTRA_CHORDS,
    accompaniment: 'walking',
    tempoMarking: 'Tempo di gavotta',
    crotchetBpm: [84, 112],
    dynamic: 'mf',
    cellWeights: {
      '4': 6, '2-2': 5, '8': 1.5, '6-2': 1.5, '12': 0.3, '16': 0.2, '3-1': 1, '1-1-2': 1, '2-1-1': 1, '1-1-1-1': 0.6,
    },
    upbeat: true,
    articulation: 'detached',
  },
};

export function isGalantForm(id: string): id is GalantFormId {
  return Object.prototype.hasOwnProperty.call(GALANT_FORMS, id);
}
