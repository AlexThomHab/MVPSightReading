/**
 * The Chopin generator's shared context: the characters (nocturne, prelude, waltz, mazurka)
 * with their tempi, rhythms and appetites, the metres they suit, and the per-piece context
 * every stage reads.
 */
import type { GenerationConstraints } from '../constraints';
import { Grade, GradeSpec, TimeSignature, TimeSignatureId } from '../grades';
import type { DynamicMark } from '../model';
import { TonalKey } from '../pitch-class';
import { Random } from '../random';
import { Key } from '../theory';

export type Character = 'nocturne' | 'prelude' | 'waltz' | 'mazurka';

/**
 * The left hand's accompaniment. One pattern is chosen for each piece and kept throughout
 * (only the final chord is held); its pitches follow the harmony, its shape never changes.
 *  - broken:    flowing broken-chord notes (quavers; crotchets at Grade 1), one note at a time:
 *               bass, middle, top, middle...
 *  - arpeggio:  wide arpeggios, one note at a time: bass, fifth, tenth (or octave), fifth -
 *               e.g. C3 G3 E-flat4 G3 under C minor.
 *  - bassChord: the bass, then the chord above it, as in the left-hand studies of Chopin
 *               Fingering.pdf: the bass alone on the beat, then two-note chords (a sixth: the
 *               outer pair of the upper voices), with a three-note chord only on the third beat
 *               of a 4/4 bar (Grade 3+). Waltzes and mazurkas use it (a mazurka's downbeat is an
 *               open fifth), and nocturnes in compound time (bass, chord, chord: Op. 9 No. 2).
 *  - final:     the last bar's held chord.
 * Invariants: never more than three notes at once; never three-note chords on consecutive
 * beats; the bass is always the lowest note and sounds at every change of harmony.
 */
export type Texture = 'broken' | 'arpeggio' | 'bassChord' | 'final';

interface CharacterSpec {
  title: string;
  tempo: { marking: string; slow: number; fast: number };
  start: DynamicMark;
  climax: DynamicMark;
  minGrade: Grade;
  /** Where the melody's main (structural) notes fall in the bar; harmony changes add more. */
  structural: Partial<Record<TimeSignatureId, number[]>>;
  /** Rhythm cells within a structural span. */
  cellWeights: Record<string, number>;
  /** Notes per beat the melody tends towards (before grade and role adjust it). */
  density: number;
  /** Appetite for ornament: turns, runs, grace notes. */
  ornament: number;
  /** Appetite for appoggiaturas and suspensions onto the main notes. */
  appoggiatura: number;
  /** Appetite for expressive leaps up to important notes. */
  leap: number;
}

export const CHARACTERS: Record<Character, CharacterSpec> = {
  nocturne: {
    title: 'Nocturne',
    tempo: { marking: 'Lento sostenuto', slow: 52, fast: 66 },
    start: 'p',
    climax: 'f',
    minGrade: 1,
    structural: { '4/4': [0, 8], '3/4': [0], '2/4': [0], '6/8': [0, 6], '9/8': [0, 6, 12], '3/8': [0] },
    cellWeights: {
      '8': 3, '12': 2.5, '16': 1, '6-2': 3.5, '4': 2.5, '2-2': 2, '3-1': 2, '1-1-2': 1.2, '2-1-1': 1.3, '1-1-1-1': 1,
      '6': 3, '4-2': 3, '2-2-2': 1.5, '2-4': 0.6, '3-1-2': 1.5, '2-1-1-2': 1, '1-1-2-2': 0.8, '2-2-1-1': 1,
    },
    density: 1.15,
    ornament: 1.3,
    appoggiatura: 1,
    leap: 1.4,
  },
  prelude: {
    title: 'Prelude',
    tempo: { marking: 'Largo', slow: 50, fast: 64 },
    start: 'p',
    climax: 'f',
    minGrade: 1,
    structural: { '4/4': [0, 8], '2/4': [0], '3/4': [0], '6/8': [0, 6] },
    cellWeights: {
      '8': 3.5, '12': 3, '16': 2.5, '4': 3, '6-2': 2.2, '2-2': 1.2, '3-1': 1, '1-1-2': 0.4, '2-1-1': 0.5, '1-1-1-1': 0.2,
      '6': 3, '4-2': 2.5, '2-2-2': 1, '3-1-2': 1, '2-4': 0.5,
    },
    density: 0.75,
    ornament: 0.45,
    appoggiatura: 1.5,
    leap: 0.9,
  },
  waltz: {
    title: 'Valse',
    tempo: { marking: 'Tempo di valse', slow: 96, fast: 126 },
    start: 'mp',
    climax: 'f',
    minGrade: 1,
    structural: { '3/4': [0], '3/8': [0] },
    cellWeights: {
      '8': 3, '4': 3, '2-2': 3, '12': 1.5, '6-2': 2.5, '3-1': 1.5, '1-1-2': 1, '2-1-1': 1, '1-1-1-1': 0.8,
      '6': 2, '4-2': 2, '2-2-2': 2,
    },
    density: 1,
    ornament: 1,
    appoggiatura: 1.3,
    leap: 1.7,
  },
  mazurka: {
    title: 'Mazurka',
    tempo: { marking: 'Moderato', slow: 96, fast: 120 },
    start: 'p',
    climax: 'f',
    minGrade: 2,
    structural: { '3/4': [0] },
    cellWeights: { '3-1': 6, '2-2': 3.5, '4': 3, '8': 1.2, '6-2': 2.5, '1-1-2': 1.5, '2-1-1': 2.5, '12': 0.5, '1-1-1-1': 0.5 },
    density: 1.25,
    ornament: 1.1,
    appoggiatura: 0.7,
    leap: 1.1,
  },
};

/** The metres Chopin pieces are written in, the most typical first. */
export const CHOPIN_TIMES: readonly TimeSignatureId[] = ['3/4', '4/4', '6/8', '2/4', '9/8', '3/8'];

/** Which characters suit a metre. */
export const CHARACTERS_FOR: Record<TimeSignatureId, [Character, number][]> = {
  '2/4': [['prelude', 3], ['nocturne', 1]],
  '3/4': [['waltz', 3], ['mazurka', 2.5], ['nocturne', 1.5]],
  '4/4': [['nocturne', 3], ['prelude', 2.5]],
  '6/8': [['nocturne', 3], ['prelude', 1]],
  '9/8': [['nocturne', 1]],
  '3/8': [['waltz', 1]],
};

export interface Ctx {
  rng: Random;
  spec: GradeSpec;
  grade: Grade;
  key: Key;
  hkey: TonalKey;
  time: TimeSignature;
  character: Character;
  ch: CharacterSpec;
  minor: boolean;
  /** Where the harmony may change within a bar (null: once a bar). */
  split: number | null;
  /** Two chords a bar are allowed (Grade 3+, in metres that divide). */
  twoChords: boolean;
  /** The left hand's accompaniment pattern, kept for the whole piece. */
  pattern: Texture;
  /** The user's customisation, resolved (null: the grade decides). */
  cons: GenerationConstraints | null;
}

/** Semitones the melody keeps above the bass, so the left hand's pattern fits between. */
export function roomAbove(ctx: Ctx): number {
  // (Grades 1–2 have narrow ranges: a fifth is all they can spare.)
  if (ctx.grade <= 2) return 7;
  return ctx.pattern === 'broken' ? 8 : 10;
}
