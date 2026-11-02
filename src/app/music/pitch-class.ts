/**
 * Spelled pitch classes — a letter and an alteration, so E♯ is not F and B𝄫 is not A — and
 * the keys, scale degrees and chord shapes built from them. Used wherever harmony must be
 * spelled correctly: chorales (chorale.ts) and the Chopin style (chopin/).
 */
import { Key, LETTERS, Mode, Pitch, accidentalSymbol, midi, mod } from './theory';

/** A spelled pitch class: letter index (0 = C … 6 = B) and alteration (+1 sharp, −1 flat). */
export interface PC {
  l: number;
  a: number;
}

const NATURAL = [0, 2, 4, 5, 7, 9, 11];
export const pcSemis = (p: PC) => mod(NATURAL[p.l] + p.a, 12);
export const samePc = (x: PC, y: PC) => x.l === y.l && x.a === y.a;
export const pcOf = (p: Pitch): PC => ({ l: LETTERS.indexOf(p.letter), a: p.alter });
export const pcName = (p: PC) => `${LETTERS[p.l]}${accidentalSymbol(p.a)}`;

/** The pitch class `steps` letters and `semis` semitones above `p`, correctly spelled. */
export function pcAbove(p: PC, steps: number, semis: number): PC {
  const l = mod(p.l + steps, 7);
  let a = mod(pcSemis(p) + semis - NATURAL[l], 12);
  if (a > 6) a -= 12;
  return { l, a };
}

/** Every pitch of a pitch class within a MIDI range. */
export function pitchesOf(pc: PC, lo: number, hi: number): Pitch[] {
  const out: Pitch[] = [];
  for (let octave = 1; octave <= 6; octave++) {
    const p: Pitch = { letter: LETTERS[pc.l], alter: pc.a, octave };
    const m = midi(p);
    if (m >= lo && m <= hi) out.push(p);
  }
  return out;
}

/** A key as a spelled tonic and a mode (the home key, or one the music moves to). */
export interface TonalKey {
  tonic: PC;
  mode: Mode;
}

export function homeKey(k: Key): TonalKey {
  return { tonic: { l: LETTERS.indexOf(k.tonic), a: k.tonicAlter }, mode: k.mode };
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** Scale degree `deg` (0–6) of a key: natural minor in minor keys; `raise` gives the raised 6th/7th. */
export function scaleDegreePc(k: TonalKey, deg: number, raise = false): PC {
  const d = mod(deg, 7);
  let semis = (k.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS)[d];
  if (raise && k.mode === 'minor' && (d === 5 || d === 6)) semis += 1;
  return pcAbove(k.tonic, d, semis);
}

/** Scale degree (0–6) of a letter in a key. */
export const degreeOfLetter = (k: TonalKey, l: number) => mod(l - k.tonic.l, 7);

/**
 * True for pitch classes outside the key: not in its key signature, and (in minor) not the
 * raised 6th or 7th of melodic and harmonic minor.
 */
export function isChromatic(k: TonalKey, pc: PC): boolean {
  const deg = degreeOfLetter(k, pc.l);
  if (samePc(pc, scaleDegreePc(k, deg))) return false;
  return !(k.mode === 'minor' && (deg === 5 || deg === 6) && samePc(pc, scaleDegreePc(k, deg, true)));
}

/** Triads (major, minor, diminished) and sevenths (dominant, minor, half- and fully diminished). */
export type ChordQuality = 'M' | 'm' | 'd' | 'D7' | 'm7' | 'h7' | 'd7';

/** Tonic, subdominant (predominant) or dominant function. */
export type HarmonicFunction = 'T' | 'S' | 'D';

/** Each chord tone above the root as [letter steps, semitones]. */
export const CHORD_SHAPES: Readonly<Record<ChordQuality, readonly (readonly [number, number])[]>> = {
  M: [[0, 0], [2, 4], [4, 7]],
  m: [[0, 0], [2, 3], [4, 7]],
  d: [[0, 0], [2, 3], [4, 6]],
  D7: [[0, 0], [2, 4], [4, 7], [6, 10]],
  m7: [[0, 0], [2, 3], [4, 7], [6, 10]],
  h7: [[0, 0], [2, 3], [4, 6], [6, 10]],
  d7: [[0, 0], [2, 3], [4, 6], [6, 9]],
};
