/**
 * The melody's frame: its range, how a scale degree is spelled over a chord, and the interval
 * tests (steps, singable leaps, runs) the melody is written with.
 */
import { melodicIntervalAllowed, pitchWindow } from '../constraints';
import { PC, degreeOfLetter, pcOf, samePc, scaleDegreePc } from '../pitch-class';
import { LETTERS, Pitch, diatonicIndex, isSingableInterval, midi, mod } from '../theory';
import { RChord } from './chords';
import { Ctx } from './context';

/** A melody note: its degree (scale steps from the tonic) and its spelled pitch. */
export interface MP {
  d: number;
  pitch: Pitch;
}

export interface Frame {
  lo: number;
  hi: number;
  /** Diatonic index of the lowest note the melody may use. */
  lowIndex: number;
  /** A degree spelled with a given pitch class (whose letter must match). */
  at(d: number, pc: PC): MP;
  /** Spellings of a degree over a chord: its chord tone, or the key's note(s). */
  spellings(d: number, chord: RChord): MP[];
  isCT(p: MP, chord: RChord): boolean;
  /** Whether the user's interval settings allow moving from `a` to `b` (always, without them). */
  allows(a: MP, b: MP): boolean;
}

export function melodyFrame(ctx: Ctx): Frame {
  const { spec, key, hkey, minor, cons } = ctx;
  // The treble stave's comfortable span (A3–A5) — or the user's melody range.
  const window = pitchWindow(key, spec.rhRange, { letter: 'A', alter: 0, octave: 3 }, { letter: 'A', alter: 0, octave: 5 }, cons?.melodyRange ?? null);
  if (!window) throw new Error('The melody range does not contain the tonic');
  const { lo, hi, tonicOctave } = window;
  const tonicIndex = diatonicIndex({ letter: key.tonic, alter: 0, octave: tonicOctave });
  const at = (d: number, pc: PC): MP => ({ d, pitch: { letter: LETTERS[pc.l], alter: pc.a, octave: Math.floor((tonicIndex + d) / 7) } });
  return {
    lo,
    hi,
    lowIndex: tonicIndex + lo,
    at,
    spellings(d, chord) {
      const l = mod(tonicIndex + d, 7);
      const tone = chord.tones.find((t) => t.l === l);
      if (tone) return [at(d, tone)];
      const deg = degreeOfLetter(hkey, l);
      // In minor the 6th and 7th come in two forms (melodic minor).
      if (minor && (deg === 5 || deg === 6)) return [at(d, scaleDegreePc(hkey, deg)), at(d, scaleDegreePc(hkey, deg, true))];
      return [at(d, scaleDegreePc(hkey, deg))];
    },
    isCT: (p, chord) => chord.tones.some((t) => samePc(t, pcOf(p.pitch))),
    allows: (a, b) => !cons || melodicIntervalAllowed(cons, a.pitch, b.pitch),
  };
}

export const steps = (a: MP, b: MP) => Math.abs(b.d - a.d);

/** How many steps in one direction end the line. */
export function runLength(line: MP[]): number {
  let run = 0;
  const last = line.length > 1 ? line[line.length - 1].d - line[line.length - 2].d : 0;
  for (let x = line.length - 1; x > 0; x--) {
    const step = line[x].d - line[x - 1].d;
    if (Math.abs(step) !== 1 || step !== last) break;
    run++;
  }
  return run;
}

export const semis = (a: MP, b: MP) => midi(b.pitch) - midi(a.pitch);

export const samePitch = (a: MP, b: MP) => a.d === b.d && a.pitch.alter === b.pitch.alter;

/** A step: a diatonic second, or a chromatic semitone on the same letter. */
export const isStep = (a: MP, b: MP) => (steps(a, b) === 1 && [1, 2].includes(Math.abs(semis(a, b)))) || (steps(a, b) === 0 && Math.abs(semis(a, b)) === 1);

export function melodicOk(a: MP, b: MP, maxLeap: number): boolean {
  if (steps(a, b) === 0) return Math.abs(semis(a, b)) <= 1;
  return steps(a, b) <= maxLeap && isSingableInterval(a.pitch, b.pitch);
}
