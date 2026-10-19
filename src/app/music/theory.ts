/**
 * Pitch spelling, keys, scale degrees and chords.
 *
 * Pitches are stored as letter + alteration + octave rather than MIDI numbers, so a
 * note is always spelled the way the key implies (F♯ in G major, never G♭).
 * Melodies are generated as diatonic scale degrees relative to the tonic, then spelled.
 */

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

export interface Pitch {
  letter: Letter;
  /** -1 flat, 0 natural, +1 sharp. */
  alter: number;
  /** Scientific octave: C4 is middle C. */
  octave: number;
}

export type Mode = 'major' | 'minor';

export interface Key {
  /** Stable identifier, also used in URLs: "G", "Bb", "F#m". */
  id: string;
  tonic: Letter;
  tonicAlter: number;
  mode: Mode;
  /** Sharps (positive) or flats (negative) in the key signature. */
  fifths: number;
}

const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

function key(id: string, tonic: Letter, tonicAlter: number, mode: Mode, fifths: number): Key {
  return { id, tonic, tonicAlter, mode, fifths };
}

export const KEYS: readonly Key[] = [
  key('C', 'C', 0, 'major', 0),
  key('G', 'G', 0, 'major', 1),
  key('D', 'D', 0, 'major', 2),
  key('A', 'A', 0, 'major', 3),
  key('E', 'E', 0, 'major', 4),
  key('F', 'F', 0, 'major', -1),
  key('Bb', 'B', -1, 'major', -2),
  key('Eb', 'E', -1, 'major', -3),
  key('Ab', 'A', -1, 'major', -4),
  key('Am', 'A', 0, 'minor', 0),
  key('Em', 'E', 0, 'minor', 1),
  key('Bm', 'B', 0, 'minor', 2),
  key('F#m', 'F', 1, 'minor', 3),
  key('C#m', 'C', 1, 'minor', 4),
  key('Dm', 'D', 0, 'minor', -1),
  key('Gm', 'G', 0, 'minor', -2),
  key('Cm', 'C', 0, 'minor', -3),
  key('Fm', 'F', 0, 'minor', -4),
];

export function keyById(id: string): Key | undefined {
  return KEYS.find((k) => k.id === id);
}

export function accidentalSymbol(alter: number): string {
  return alter > 0 ? '♯'.repeat(alter) : alter < 0 ? '♭'.repeat(-alter) : '';
}

/** "G major", "F♯ minor". */
export function keyName(k: Key): string {
  return `${k.tonic}${accidentalSymbol(k.tonicAlter)} ${k.mode}`;
}

/** The key spec VexFlow expects for key signatures and accidentals: "G", "F#m", "Bb". */
export function vexKeySpec(k: Key): string {
  return k.id;
}

/** The alteration the key signature gives a letter. */
export function keySignatureAlter(k: Key, letter: Letter): number {
  if (k.fifths > 0) return SHARP_ORDER.slice(0, k.fifths).includes(letter) ? 1 : 0;
  if (k.fifths < 0) return FLAT_ORDER.slice(0, -k.fifths).includes(letter) ? -1 : 0;
  return 0;
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Diatonic position counting letters from C0, so steps and leaps can be measured. */
export function diatonicIndex(p: Pitch): number {
  return p.octave * 7 + LETTERS.indexOf(p.letter);
}

export function midi(p: Pitch): number {
  return 12 * (p.octave + 1) + NATURAL_SEMITONES[LETTERS.indexOf(p.letter)] + p.alter;
}

export function samePitchClass(a: Pitch, b: Pitch): boolean {
  return a.letter === b.letter && a.alter === b.alter;
}

/** "F♯4" — for display and debugging. */
export function pitchName(p: Pitch): string {
  return `${p.letter}${accidentalSymbol(p.alter)}${p.octave}`;
}

/**
 * Spells scale degree `degree` (0 = tonic, 7 = tonic an octave up, -1 = leading note below)
 * in `k`, measured from a tonic in `tonicOctave`. `alterAdjust` raises or lowers the
 * degree relative to the key signature, e.g. +1 for the raised leading note in minor.
 */
export function degreeToPitch(k: Key, tonicOctave: number, degree: number, alterAdjust = 0): Pitch {
  const abs = LETTERS.indexOf(k.tonic) + degree;
  const letter = LETTERS[mod(abs, 7)];
  return {
    letter,
    alter: keySignatureAlter(k, letter) + alterAdjust,
    octave: tonicOctave + Math.floor(abs / 7),
  };
}

/**
 * Picks the octave for the tonic so that a degree range [lo, hi] fits between two
 * pitches (e.g. the comfortable span of a stave), or overshoots them as little as possible.
 * Ties go to the octave whose range is centred closest to the middle of that span.
 */
export function tonicOctaveFor(k: Key, lo: number, hi: number, lowest: Pitch, highest: Pitch): number {
  const min = diatonicIndex(lowest);
  const max = diatonicIndex(highest);
  let best = 4;
  let bestScore = Infinity;
  for (let oct = 1; oct <= 6; oct++) {
    const tonic = diatonicIndex({ letter: k.tonic, alter: 0, octave: oct });
    const overflow = Math.max(0, min - (tonic + lo)) + Math.max(0, tonic + hi - max);
    const offCentre = Math.abs(tonic + (lo + hi) / 2 - (min + max) / 2);
    const score = overflow * 100 + offCentre;
    if (score < bestScore) {
      best = oct;
      bestScore = score;
    }
  }
  return best;
}

/**
 * True for melodic intervals that are easy to read and sing: perfect, major and minor
 * intervals up to an octave, excluding sevenths. Rejects augmented and diminished
 * intervals such as the tritone or the augmented second in harmonic minor.
 */
export function isSingableInterval(a: Pitch, b: Pitch): boolean {
  const steps = Math.abs(diatonicIndex(b) - diatonicIndex(a));
  const semis = Math.abs(midi(b) - midi(a));
  if (steps > 7) return false;
  if (steps === 7) return semis === 12;
  const allowed: Record<number, number[]> = {
    0: [0],
    1: [1, 2],
    2: [3, 4],
    3: [5],
    4: [7],
    5: [8, 9],
  };
  return (allowed[steps] ?? []).includes(semis);
}

/** A chord as scale degrees, with any chromatic alterations it requires. */
export interface Chord {
  /** Roman numeral: "I", "ii", "IV", "V", "vi", "i", "iv", "VI", "V/V". */
  symbol: string;
  /** Root as a scale degree, 0–6. */
  root: number;
  /**
   * Alterations applied to degrees (mod 7) while this chord sounds, relative to the key
   * signature. Minor-key V raises degree 6 (the leading note); V/V raises degree 3.
   */
  alters: Readonly<Record<number, number>>;
  /** True when the chord uses notes outside both the key signature and harmonic minor. */
  chromatic: boolean;
}

/** Degrees (mod 7) of the chord's root, third and fifth. */
export function chordTones(c: Chord): number[] {
  return [c.root, mod(c.root + 2, 7), mod(c.root + 4, 7)];
}

export function isChordTone(c: Chord, degree: number): boolean {
  return chordTones(c).includes(mod(degree, 7));
}

export function alterFor(c: Chord, degree: number): number {
  return c.alters[mod(degree, 7)] ?? 0;
}

export function chordFor(symbol: string, mode: Mode): Chord {
  const plain = (root: number): Chord => ({ symbol, root, alters: {}, chromatic: false });
  switch (symbol) {
    case 'I':
    case 'i':
      return plain(0);
    case 'ii':
      return plain(1);
    case 'IV':
    case 'iv':
      return plain(3);
    case 'vi':
    case 'VI':
      return plain(5);
    case 'V':
      // Minor keys take a major V: raise the leading note.
      return { symbol, root: 4, alters: mode === 'minor' ? { 6: 1 } : {}, chromatic: false };
    case 'V/V':
      // Secondary dominant (major keys, Grade 4+): raises the fourth degree.
      return { symbol, root: 1, alters: { 3: 1 }, chromatic: true };
    default:
      throw new Error(`Unknown chord ${symbol}`);
  }
}

/** Tonic chord symbol for the mode. */
export function tonicSymbol(mode: Mode): string {
  return mode === 'major' ? 'I' : 'i';
}
