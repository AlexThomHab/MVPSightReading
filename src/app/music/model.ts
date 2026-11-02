/**
 * The musical model shared by every generator, the score and playback: a piece is bars of
 * right- and left-hand notes (four voices for a chorale), with harmony, phrasing, tempo and
 * expression. Durations are in ticks (semiquaver = 1).
 */
import { Grade, TimeSignature, TimeSignatureId } from './grades';
import type { Customisation } from './constraints';
import { StyleId } from './styles';
import { Key, Mode, Pitch } from './theory';

export interface Note {
  /** Empty for a rest. Chords (left hand) are sorted low to high. */
  pitches: Pitch[];
  ticks: number;
  rest?: boolean;
  /** True when the note deliberately uses a chromatic pitch (Grade 4+ secondary dominant). */
  chromatic?: boolean;
  /** Tied to the next note of the same voice (a suspension). */
  tie?: boolean;
  /** Held under a fermata (the end of a chorale phrase). */
  fermata?: boolean;
  articulation?: 'staccato' | 'accent' | 'tenuto';
  /** Grace notes (acciaccaturas) crushed in just before the note. */
  grace?: Pitch[];
  /** An ornament sign over the note, with the neighbouring notes it uses when played. */
  ornament?: Ornament;
}

export interface Ornament {
  type: 'turn' | 'trill';
  /** The note above (spelled, so the sign can carry an accidental). */
  upper: Pitch;
  /** The note below (turns only). */
  lower?: Pitch;
}

/** A right-hand note: its bar and its index within that bar's right-hand notes. */
export interface NoteRef {
  bar: number;
  index: number;
}

export type DynamicMark = 'pp' | 'p' | 'mp' | 'mf' | 'f';

/** Expressive markings attached to right-hand notes (used by the Chopin style). */
export interface Expression {
  dynamics: { at: NoteRef; mark: DynamicMark }[];
  hairpins: { from: NoteRef; to: NoteRef; type: 'cresc' | 'dim' }[];
  slurs: { from: NoteRef; to: NoteRef }[];
}

/** The four voices of a chorale: soprano and alto on the treble stave, tenor and bass on the bass stave. */
export interface ChoraleVoices {
  s: Note[];
  a: Note[];
  t: Note[];
  b: Note[];
}

/** A chord sounding from `at` (ticks from the start of the bar) to the next chord or the bar line. */
export interface Harmony {
  symbol: string;
  at: number;
  /** Chorales: the chord's notes as pitch-class names, root first (then 3rd, 5th, 7th). */
  tones?: string[];
}

export interface Bar {
  /** One chord, or two when the harmony changes at the half bar (one per beat in a chorale). */
  harmony: Harmony[];
  /** Right hand (in a chorale: the soprano). */
  rh: Note[];
  /** Left hand (in a chorale: the bass). */
  lh: Note[];
  /** Present for chorales: all four voices. Bars may be shorter than the time signature (upbeat, final bar). */
  voices?: ChoraleVoices;
}

/**
 * Phrase endings. PAC: V–I with the tonic in the melody. IAC: V–I with the 3rd or 5th
 * on top. HC: ends on V. PC: IV–I ("Amen"). DC: V–vi, a deflected ending.
 */
export type Cadence = 'PAC' | 'IAC' | 'HC' | 'PC' | 'DC';

export type SequenceName = 'romanesca' | 'descending-fifths' | 'ascending-5-6';

export interface PhraseInfo {
  startBar: number;
  bars: number;
  cadence: Cadence;
  /** Opens with a harmonic and melodic sequence of this type. */
  sequence?: SequenceName;
  /** Opens with an exact repeat of the piece's first two bars. */
  repeatsOpening: boolean;
  /** The key the phrase cadences in, when it modulates (chorales), e.g. "D major". */
  key?: string;
}

export interface Tempo {
  bpm: number;
  /** VexFlow duration of the counted beat: crotchet, dotted crotchet or quaver. */
  beatUnit: 'q' | 'qd' | '8';
  marking: string;
}

export interface Piece {
  title: string;
  seed: string;
  grade: Grade;
  style: StyleId;
  key: Key;
  mode: Mode;
  time: TimeSignature;
  tempo: Tempo;
  dynamic: string;
  bars: Bar[];
  phrases: PhraseInfo[];
  /** Dynamics, hairpins and slurs, when the style writes them (otherwise `dynamic` alone). */
  expression?: Expression;
  /** How the style adapted to the user's customisation, if it had to. */
  notices?: string[];
}

export interface Settings {
  seed: string;
  grade: Grade;
  style: StyleId;
  /** Optional override; otherwise a random key allowed by the grade and style. */
  keyId?: string;
  /** Optional override; otherwise a random time signature allowed by the grade and style. */
  timeId?: TimeSignatureId;
  /** The user's customisation, overriding the grade's defaults where set (see constraints.ts). */
  custom?: Customisation;
}
