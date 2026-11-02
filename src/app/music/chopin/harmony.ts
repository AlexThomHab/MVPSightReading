/**
 * Harmony: the library of Chopinesque progressions, the rules that every chord resolves and that
 * tension builds through a phrase, and the planning of a piece's chords.
 */
import { TonalKey } from '../pitch-class';
import { RChord, chordFor, leadsTo } from './chords';
import { Ctx } from './context';
import { Form } from './form';

export interface Segment {
  chord: RChord;
  at: number;
  ticks: number;
  /** Sounds over a held tonic in the bass. */
  pedal?: boolean;
}

/** Progressions as `bar | bar`, chords within a bar separated by commas; ^ marks a tonic pedal. */
type Library = readonly (readonly [string, number])[];

type Unit = 'gesture' | 'antecedent' | 'presentation' | 'intensify1' | 'intensify2' | 'cadence' | 'contrast';

/**
 * The progressions, each with the grade it first appears at. Grade 2 is diatonic; Grade 3
 * brings applied dominants; Grade 4 diminished sevenths, mixture and chromatic basses;
 * Grade 5 the Neapolitan, augmented sixths and chains of dominants.
 */
export const HARMONY_LIBRARY: Record<Unit, { major: Library; minor: Library }> = {
  // Grade 1: a single four-bar phrase.
  gesture: {
    major: [['I | IV | V7 | I', 1], ['I | ii | V7 | I', 1], ['I | V7 | V7 | I', 1], ['I | vi | V7 | I', 1], ['I | IV | V | I', 1]],
    minor: [['i | iv | V7 | i', 1], ['i | V7 | V7 | i', 1], ['i | VI | V7 | i', 1], ['i | iv | V | i', 1]],
  },
  // Four bars to a half cadence.
  antecedent: {
    major: [
      ['I | IV | ii | V', 2],
      ['I | vi | IV | V', 2],
      ['I | V7 | I | V', 2],
      ['I | ii | IV | V', 2],
      // vi tonicised; I7 to IV; V of V to the half close.
      ['I | V7/vi | vi, IV | V', 3],
      ['I | V7/IV | IV, V7/V | V', 3],
      ['I, IV | I, V7 | vi, V7/V | V', 3],
      ['I | V7/ii | ii, V7/V | V', 3],
      // I–I7–IV–iv; a bass rising through diminished sevenths; the common-tone diminished
      // seventh over a tonic pedal; the chromatic lament bass 1–♭7–6–♭6–5.
      ['I | V7/IV | IV, iv | V', 4],
      ['I | I, vii°7/ii | ii, vii°7/V | V', 4],
      ['^I, ^vii°7/iii | ^I | IV, iv6 | V', 4],
      ['I | I, V42/IV | IV6, iv6 | V', 4],
      ['I | V7/vi | vi, It+6 | V', 5],
      ['I | V7/IV | IV, Ger+6 | V', 5],
    ],
    minor: [
      ['i | iv | i | V', 2],
      ['i | VI | iv | V', 2],
      ['i | V7 | i | V', 2],
      ['i | iv | VI | V', 2],
      ['i | V7/iv | iv, ii°6 | V', 3],
      ['i | V7/III | III, iv | V', 3],
      ['i | V65, i | iv6 | V', 3],
      ['i, VI | iv, V7 | i, iv6 | V', 3],
      // The lament: 1–7–♭7–♭6–5 under i, V6, V42/iv, iv6, V.
      ['i | i, V6 | V42/iv, iv6 | V', 4],
      ['i | V7/iv | iv, vii°7/V | V', 4],
      ['i | iv, V7/III | III, vii°7/V | V', 4],
      ['i | V7/III | III, Ger+6 | V', 5],
      ['i | V7/iv | iv, Ger+6 | V', 5],
    ],
  },
  // A sentence's first four bars: an idea and its sequence.
  presentation: {
    major: [
      ['I | V7 | V7 | I', 2],
      ['I | IV | V7 | I', 2],
      ['I | V | V7 | I', 2],
      ['I | V7, I | ii | V7/ii, ii', 3],
      ['I | V7, I | vi | V7/vi, vi', 3],
      ['^I, ^IV64 | ^I | V7/ii | ii', 4],
      // A falling sequence of tonicisations: vi, then V.
      ['I | V65/vi, vi | V65/V, V | V7, I', 4],
      ['I | I, vii°7/ii | ii | vii°7/iii, iii', 4],
    ],
    minor: [
      ['i | V7 | V7 | i', 2],
      ['i | iv | V7 | i', 2],
      ['i | V | V7 | i', 2],
      ['i | V7, i | iv | V7/iv, iv', 3],
      ['i | V7, i | III | V7/III, III', 3],
      ['^i, ^iv64 | ^i | V7/iv | iv', 4],
      // A falling sequence of tonicisations, as in the C♯ minor Waltz: iv, then III.
      ['i | V65/iv | iv, V65/III | III', 4],
      ['i | V7, i | VI | V7/VI, VI', 4],
    ],
  },
  // One bar of intensification before the cadence (a period's answer).
  intensify1: {
    major: [
      ['IV', 1],
      ['ii', 2],
      ['vi', 2],
      ['IV, ii6', 3],
      ['vi, V7/ii', 3],
      ['V7/IV, IV', 3],
      ['V7/vi, vi', 3],
      ['IV, iv', 4],
      ['I, vii°7/ii', 4],
      ['bVI', 5],
    ],
    minor: [
      ['iv', 1],
      ['VI', 2],
      ['iv, VI', 3],
      ['V7/iv, iv', 3],
      ['VI, iv6', 3],
      ['iv, vii°7/V', 4],
      ['VI, N6', 5],
    ],
  },
  // Two bars of intensification (a sentence's continuation).
  intensify2: {
    major: [
      ['IV | ii', 2],
      ['vi | IV', 2],
      ['ii | IV', 2],
      ['vi, V7/ii | ii', 3],
      ['V7/IV | IV', 3],
      ['IV, V7/vi | vi', 3],
      ['vi | V7/IV, IV', 3],
      ['vi, V65/ii | ii, iv', 4],
      ['V7/IV | IV, iv', 4],
      ['I, vii°7/ii | ii, iv', 4],
      ['V7/vi | V7/ii', 5],
      ['bVI | iv6', 5],
    ],
    minor: [
      ['iv | VI', 2],
      ['VI | iv', 2],
      ['V7/iv | iv', 3],
      ['V7/III | III, iv', 3],
      ['VI, V7/iv | iv', 3],
      ['i, V6 | V42/iv, iv6', 4],
      ['V7/iv | iv, VI', 4],
      ['VI | N6', 5],
      ['V7/III | III, N6', 5],
    ],
  },
  // The authentic cadence: the approach, then the tonic.
  cadence: {
    major: [
      ['V7 | I', 1],
      ['V | I', 1],
      ['ii6, V7 | I', 3],
      ['IV, V7 | I', 3],
      ['I64, V7 | I', 3],
      ['ii65, V7 | I', 3],
      ['V7/V, V7 | I', 3],
      ['iv6, V7 | I', 4],
      ['iiø65, V7 | I', 4],
      ['vii°7/V, V7 | I', 4],
      ['N6, V7 | I', 5],
      ['Ger+6, V7 | I', 5],
      ['It+6, V7 | I', 5],
    ],
    minor: [
      ['V7 | i', 1],
      ['V | i', 1],
      ['ii°6, V7 | i', 3],
      ['iv, V7 | i', 3],
      ['i64, V7 | i', 3],
      ['V7/V, V7 | i', 3],
      ['iv6, V7 | i', 4],
      ['iiø65, V7 | i', 4],
      ['vii°7/V, V7 | i', 4],
      ['N6, V7 | i', 5],
      ['Ger+6, V7 | i', 5],
      ['It+6, V7 | i', 5],
    ],
  },
  // The middle section: away from the tonic, back to the dominant.
  contrast: {
    major: [
      ['vi | iii | IV | V', 2],
      ['IV | I | ii | V', 2],
      ['vi | IV | ii | V', 2],
      ['V7/vi | vi | V7/V | V', 3],
      ['vi, V7/ii | ii, V7/V | V | V7', 3],
      ['V7/vi | vi, V7/ii | ii, V7/V | V', 4],
      ['vi | V7/IV | IV, vii°7/V | V', 4],
      // Falling fifths through seventh chords, each seventh resolving down a step.
      ['vi7 | ii7 | V7/V | V', 4],
      // The chain of dominants: III7–VI7–II7–V7.
      ['V7/vi | V7/ii | V7/V | V7', 5],
      ['bVI | iv | Ger+6 | V', 5],
    ],
    minor: [
      ['VI | III | iv | V', 2],
      ['III | VI | iv | V', 2],
      ['iv | i | VI | V', 2],
      ['V7/III | III | iv | V', 3],
      ['VI | iv | V7/V | V', 3],
      ['V7/III | III, V7/VI | VI, ii°6 | V', 4],
      ['VI | V7/III | III, vii°7/V | V', 4],
      ['iv7 | VII7 | III | V', 4],
      ['V7/III | III | N6 | V', 5],
      ['VI | iv6 | Ger+6 | V', 5],
    ],
  },
};

const parseBars = (t: string) => t.split('|').map((b) => b.trim().split(',').map((c) => c.trim()));

/** True when a progression uses no chord with notes outside the key. */
function isDiatonic(hkey: TonalKey, pattern: string): boolean {
  return parseBars(pattern)
    .flat()
    .every((symbol) => !chordFor(hkey, symbol.replace('^', '')).chromatic);
}

/**
 * Harmonic tension of a chord: tonic 0, subdominant 1, dominant 2, applied and borrowed
 * chords 2.5, diminished sevenths, the Neapolitan and augmented sixths 3.
 */
export function tension(c: RChord): number {
  if (c.kind === 'aug6' || c.kind === 'neapolitan' || c.symbol.includes('°7')) return 3;
  if (c.kind === 'applied' || c.kind === 'mixture') return 2.5;
  return c.fn === 'D' ? 2 : c.fn === 'S' ? 1 : 0;
}

/**
 * True when a phrase's tension builds: its most tense moment comes in the second half (before
 * the cadence resolves it), and the first half is on average calmer than the second.
 */
export function tensionBuilds(hkey: TonalKey, bars: string[][]): boolean {
  const per = bars.map((bar) => bar.map((sym) => tension(chordFor(hkey, sym.replace('^', '')))));
  const half = Math.ceil(per.length / 2);
  const first = per.slice(0, half).flat();
  const second = per.slice(half).flat();
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const [a, b] = [Math.max(...first), Math.max(...second)];
  return b > a || (b === a && avg(second) > avg(first));
}

/** True when every chord leads where it should; phrases ending on a half close may move anywhere. */
export function progressionOk(hkey: TonalKey, bars: string[][], halfCloses: Set<number> = new Set()): boolean {
  const flat = bars.flatMap((bar, b) => bar.map((symbol, k) => ({ symbol: symbol.replace('^', ''), b, last: k === bar.length - 1 })));
  for (let i = 1; i < flat.length; i++) {
    const a = flat[i - 1];
    if (a.last && halfCloses.has(a.b)) continue;
    if (!leadsTo(chordFor(hkey, a.symbol), chordFor(hkey, flat[i].symbol))) return false;
  }
  return true;
}

export function planHarmony(ctx: Ctx, form: Form): Segment[][] {
  const { rng, grade, hkey, twoChords, time } = ctx;
  const mode = ctx.minor ? 'minor' : 'major';
  const choose = (unit: Unit) => {
    const lib = HARMONY_LIBRARY[unit][mode].filter(
      ([p, g]) => g <= grade && (twoChords || !p.includes(',')) && (ctx.cons?.accidentals !== false || isDiatonic(hkey, p)),
    );
    // Favour the progressions new at this grade, so each grade sounds richer than the last.
    return parseBars(rng.weighted(lib, ([, g]) => (g === grade ? 5 : grade - g === 1 ? 1.3 : 0.6))[0]);
  };
  const build = (): string[][] => {
    switch (form.kind) {
      case 'gesture':
        return choose('gesture');
      case 'sentence':
        return [...choose('presentation'), ...choose('intensify2'), ...choose('cadence')];
      case 'period': {
        const a = choose('antecedent');
        return [...a, [...a[0]], ...choose('intensify1'), ...choose('cadence')];
      }
      case 'ternary': {
        const a = choose('antecedent');
        return [...a, ...choose('contrast'), [...a[0]], ...choose('intensify1'), ...choose('cadence')];
      }
    }
  };
  const halfCloses = new Set(form.phrases.filter((p) => p.cadence === 'HC').map((p) => p.start + p.roles.length - 1));
  // A progression must resolve every chord; from Grade 3 it tonicises something (an applied
  // dominant) at least once; and each phrase builds its tension towards the cadence rather
  // than spending it at the start.
  const resolves = (b: string[][]) => progressionOk(hkey, b, halfCloses);
  const tonicises = (b: string[][]) => grade < 3 || ctx.cons?.accidentals === false || b.flat().some((c) => c.includes('/'));
  const builds = (b: string[][]) => form.phrases.every((p) => tensionBuilds(hkey, b.slice(p.start, p.start + p.roles.length)));
  const fits = [
    (b: string[][]) => resolves(b) && tonicises(b) && builds(b),
    (b: string[][]) => resolves(b) && tonicises(b),
    resolves,
  ];
  let bars = build();
  for (const test of fits) {
    for (let i = 0; i < 120 && !test(bars); i++) bars = build();
    if (test(bars)) break;
  }

  // Now and then a minor-key piece ends in the major (Grade 4+).
  const last = bars.length - 1;
  if (ctx.minor && grade >= 4 && rng.chance(0.15) && ctx.cons?.accidentals !== false) bars[last] = ['I'];

  return bars.map((bar) =>
    bar.map((raw, k) => ({
      chord: chordFor(hkey, raw.replace('^', '')),
      pedal: raw.startsWith('^'),
      at: k === 0 ? 0 : ctx.split!,
      ticks: bar.length === 1 ? time.barTicks : k === 0 ? ctx.split! : time.barTicks - ctx.split!,
    })),
  );
}
