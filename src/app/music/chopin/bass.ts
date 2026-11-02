/**
 * The bass line: as smooth as possible, with inversions (V65 for a chromatic bass) where they
 * help, within the left hand's compass and leaving room for its chords.
 */
import { pitchWindow } from '../constraints';
import { PC, samePc, scaleDegreePc } from '../pitch-class';
import { LETTERS, Pitch, diatonicIndex, mod, tonicOctaveFor } from '../theory';
import { chordFor } from './chords';
import { Ctx } from './context';
import { Form } from './form';
import { melodyFrame } from './frame';
import { Segment } from './harmony';

export interface BassLine {
  /** Bass pitch of each segment, by bar. */
  pitches: Pitch[][];
  /** Diatonic index of each bass, by bar. */
  D: number[][];
  loD: number;
  hiD: number;
}

/**
 * The bass line. The left hand's compass (the grade's range) may sit a step or two lower or
 * higher than centred on the tonic, wherever the progression lies best — with room above
 * each bass note for its chord.
 */
export function planBass(ctx: Ctx, form: Form, segments: Segment[][]): BassLine {
  const { spec, key, cons } = ctx;
  // The user's left-hand range fixes the hand's compass exactly.
  if (cons?.bassRange) {
    const window = pitchWindow(key, spec.lhRange, { letter: 'E', alter: 0, octave: 2 }, { letter: 'D', alter: 0, octave: 4 }, cons.bassRange);
    if (!window) throw new Error('The left-hand range does not contain the tonic');
    const tonic = diatonicIndex({ letter: key.tonic, alter: 0, octave: window.tonicOctave });
    const solved = solveBass(ctx, form, segments, tonic + window.lo, tonic + window.hi);
    solved.relabel();
    return solved.line;
  }
  const [lo, hi] = spec.lhRange;
  const lhTonicOctave = tonicOctaveFor(key, lo, hi, { letter: 'E', alter: 0, octave: 2 }, { letter: 'D', alter: 0, octave: 4 });
  const tonicIndex = diatonicIndex({ letter: key.tonic, alter: 0, octave: lhTonicOctave });
  const lowest = diatonicIndex({ letter: 'C', alter: 0, octave: 2 });
  const highest = diatonicIndex({ letter: 'E', alter: 0, octave: 4 });
  let best: { cost: number; line: BassLine; relabel: () => void } | null = null;
  // (At Grade 1 the hand stays in its five-finger position.)
  for (const shift of ctx.grade === 1 ? [0] : [0, -1, -2, 1, 2]) {
    const loD = tonicIndex + lo + shift;
    const hiD = tonicIndex + hi + shift;
    if (loD < lowest || hiD > highest) continue;
    const solved = solveBass(ctx, form, segments, loD, hiD);
    const cost = solved.cost + Math.abs(shift) * 0.5;
    if (!best || cost < best.cost) best = { ...solved, cost };
  }
  best!.relabel();
  return best!.line;
}

function solveBass(ctx: Ctx, form: Form, segments: Segment[][], loD: number, hiD: number): { cost: number; line: BassLine; relabel: () => void } {
  const { spec, hkey } = ctx;
  const flat = segments.flatMap((segs, b) => segs.map((s, k) => ({ s, b, k })));
  const cadenceBars = new Set(form.phrases.map((p) => p.start + p.roles.length - 1));
  const plainTriad = /^b?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)°?$/;
  const tonic = scaleDegreePc(hkey, 0);

  // Each segment's bass: the chord's own bass (the tonic under a pedal). Where it makes a
  // smoother line, a plain triad may take its third instead (a 6 chord), and a dominant
  // seventh — above all an applied one — its leading note (V65), so the bass rises by
  // semitone into the chord it is aimed at: Chopin's chromatic bass.
  const options = flat.map(({ s, b }, i) => {
    const final = b === form.barCount - 1;
    const choices: { pc: PC; extra: number; figure: string }[] = [{ pc: s.pedal || final ? tonic : s.chord.bass, extra: 0, figure: '' }];
    const cadential = cadenceBars.has(b) || (cadenceBars.has(b + 1) && flat[i + 1]?.b === b + 1);
    const symbol = s.chord.symbol;
    if (spec.inversions && !s.pedal && !final && i > 0) {
      if (!cadential && plainTriad.test(symbol)) choices.push({ pc: s.chord.tones[1], extra: 2.5, figure: symbol + '6' });
      if (/^V7\//.test(symbol)) choices.push({ pc: s.chord.tones[1], extra: 0.3, figure: symbol.replace('V7/', 'V65/') });
      if (symbol === 'V7' && !cadential) choices.push({ pc: s.chord.tones[1], extra: 1.5, figure: 'V65' });
    }
    const opts: { D: number; pc: PC; extra: number; figure: string }[] = [];
    for (const c of choices) for (let D = loD; D <= hiD; D++) if (mod(D, 7) === c.pc.l) opts.push({ D, ...c });
    // In a five-finger range the chord's own bass may be out of reach: take another of its notes.
    if (!opts.length) {
      for (const pc of s.chord.tones) for (let D = loD; D <= hiD; D++) if (mod(D, 7) === pc.l) opts.push({ D, pc, extra: 4, figure: '' });
    }
    return opts;
  });
  // A bass note must leave room above it, within the hand's range, for two notes of its chord
  // (the accompaniment pattern's upper voices).
  options.forEach((opts, i) => {
    const tones = flat[i].s.chord.tones;
    for (const o of opts) {
      const above = tones.filter((t) => !samePc(t, o.pc) && Array.from({ length: 7 }, (_, j) => o.D + 1 + j).some((D) => D <= hiD && mod(D, 7) === t.l));
      o.extra += Math.max(0, 2 - above.length) * 4;
    }
  });
  const cost = (a: number, b: number) => {
    const leap = Math.abs(a - b);
    return leap + 0.5 * Math.max(0, leap - 2) ** 2 + (leap > spec.maxBassLeap ? 100 : 0);
  };
  // Keep the bass low enough to leave room for the chord above it.
  // (A prelude's block chords sit in the tenor register, as in Op. 28 No. 4; a bass under
  // flowing figures may go lower.)
  // (Never so high that the melody's lowest notes would meet it: a tenth below them at least.)
  const floor = Math.min(
    diatonicIndex(ctx.character === 'prelude' ? { letter: 'A', alter: 0, octave: 2 } : { letter: 'E', alter: 0, octave: 2 }),
    melodyFrame(ctx).lowIndex - 9,
  );
  // (And at least an octave below the melody's lowest notes, so its chord fits between.)
  const ceiling = melodyFrame(ctx).lowIndex - 7;
  const high = (D: number) =>
    Math.max(0, D - (hiD - 4)) * 1.5 + (D > hiD - 2 ? 6 : 0) + Math.max(0, floor - D) * 1.5 + Math.max(0, D - ceiling) * 2;
  let costs = options[0].map((o) => Math.abs(o.D - (loD + 2)) * 0.2 + high(o.D) + o.extra);
  const back: number[][] = [];
  for (let i = 1; i < options.length; i++) {
    const prev = options[i - 1];
    const prevCosts = costs;
    back[i] = [];
    costs = options[i].map((o, j) => {
      let best = Infinity;
      prev.forEach((P, k) => {
        const c = prevCosts[k] + cost(P.D, o.D) + high(o.D) + o.extra;
        if (c < best) {
          best = c;
          back[i][j] = k;
        }
      });
      return best;
    });
  }
  const pitches: Pitch[][] = segments.map(() => []);
  const Ds: number[][] = segments.map(() => []);
  const total = Math.min(...costs);
  let pick = costs.indexOf(total);
  const inversions: [Segment, string][] = [];
  for (let i = options.length - 1; i >= 0; i--) {
    const o = options[i][pick];
    const { s, b, k } = flat[i];
    pitches[b][k] = { letter: LETTERS[o.pc.l], alter: o.pc.a, octave: Math.floor(o.D / 7) };
    Ds[b][k] = o.D;
    if (o.figure) inversions.push([s, o.figure]);
    if (i > 0) pick = back[i][pick];
  }
  // Record the inversions in the harmony itself (for the line that is chosen).
  const relabel = () => inversions.forEach(([s, symbol]) => (s.chord = chordFor(hkey, symbol)));
  return { cost: total, line: { pitches, D: Ds, loD, hiD }, relabel };
}
