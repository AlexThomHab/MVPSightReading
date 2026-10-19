/**
 * Four-part chorale generator in the manner of J. S. Bach's harmonised chorales.
 *
 *   1. Tune: 4/4 phrases of eight crotchets, each starting on an upbeat and ending on a
 *      fermata, in "bar form" (the first two phrases repeated) when long enough. Phrases
 *      cadence in related keys, as Bach's do (to V, vi, III, iv, …).
 *   2. Harmony and bass, chosen together by dynamic programming: functional progressions,
 *      first inversions, seventh chords, secondary dominants, and the cadence each phrase
 *      calls for; a bass line that moves well against the tune.
 *   3. Alto and tenor, by dynamic programming over voicings: complete chords, correct
 *      doubling, no parallel fifths or octaves, no crossing, close spacing, leading notes
 *      and sevenths resolved.
 *   4. Figuration: passing and neighbour quavers, mostly in the lower voices, and 4–3
 *      suspensions at cadences, checked so they create no new parallels.
 *
 * Pure TypeScript and deterministic from the seed, like the piano generator.
 */
import type { Bar, Cadence, Note, PhraseInfo, Piece, Settings } from './generator';
import { GRADE_SPECS, Grade, TIME_SIGNATURES } from './grades';
import { Random } from './random';
import { KEYS, Key, LETTERS, Mode, Pitch, accidentalSymbol, diatonicIndex, isSingableInterval, midi, mod } from './theory';

// ---------------------------------------------------------------------------
// Pitch classes and keys
// ---------------------------------------------------------------------------

/** A spelled pitch class: letter index (0 = C … 6 = B) and alteration. */
interface PC {
  l: number;
  a: number;
}

const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const pcSemis = (p: PC) => mod(NATURAL[p.l] + p.a, 12);
const samePc = (x: PC, y: PC) => x.l === y.l && x.a === y.a;
const pcOf = (p: Pitch): PC => ({ l: LETTERS.indexOf(p.letter), a: p.alter });
const pcName = (p: PC) => `${LETTERS[p.l]}${accidentalSymbol(p.a)}`;

/** The pitch class `steps` letters and `semis` semitones above `p`, correctly spelled. */
function up(p: PC, steps: number, semis: number): PC {
  const l = mod(p.l + steps, 7);
  let a = mod(pcSemis(p) + semis - NATURAL[l], 12);
  if (a > 6) a -= 12;
  return { l, a };
}

/** Every pitch of a pitch class within a MIDI range. */
function pitchesOf(pc: PC, lo: number, hi: number): Pitch[] {
  const out: Pitch[] = [];
  for (let octave = 1; octave <= 6; octave++) {
    const p: Pitch = { letter: LETTERS[pc.l], alter: pc.a, octave };
    const m = midi(p);
    if (m >= lo && m <= hi) out.push(p);
  }
  return out;
}

/** A key the music is in locally (the home key, or one a phrase modulates to). */
interface LKey {
  tonic: PC;
  mode: Mode;
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** Scale degree `deg` (0–6) of a key; in minor, `raise` gives the melodic-minor 6th/7th. */
function degreePc(k: LKey, deg: number, raise = false): PC {
  const d = mod(deg, 7);
  let semis = (k.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS)[d];
  if (raise && k.mode === 'minor' && (d === 5 || d === 6)) semis += 1;
  return up(k.tonic, d, semis);
}

const keyLabel = (k: LKey) => `${pcName(k.tonic)} ${k.mode}`;
const sameKey = (x: LKey, y: LKey) => samePc(x.tonic, y.tonic) && x.mode === y.mode;
/** Scale degree (0–6) of a letter in a key. */
const degreeOfLetter = (k: LKey, l: number) => mod(l - k.tonic.l, 7);

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

type Quality = 'M' | 'm' | 'd' | 'D7' | 'm7' | 'h7' | 'd7';
type Fn = 'T' | 'S' | 'D';

/** Intervals above the root as [letter steps, semitones]. */
const SHAPES: Record<Quality, [number, number][]> = {
  M: [[0, 0], [2, 4], [4, 7]],
  m: [[0, 0], [2, 3], [4, 7]],
  d: [[0, 0], [2, 3], [4, 6]],
  D7: [[0, 0], [2, 4], [4, 7], [6, 10]],
  m7: [[0, 0], [2, 3], [4, 7], [6, 10]],
  h7: [[0, 0], [2, 3], [4, 6], [6, 10]],
  d7: [[0, 0], [2, 3], [4, 6], [6, 9]],
};

interface HChord {
  /** Roman numeral with figures, e.g. "V65", "ii6", "V7/V", "vii°7". */
  label: string;
  /** The numeral without figures, e.g. "V" or "V/V" — equal for the same chord in any inversion. */
  base: string;
  key: LKey;
  /** Scale degree of the root in `key`. */
  rootDeg: number;
  /** Root, third, fifth and (if any) seventh. */
  tones: PC[];
  /** Index into `tones` of the bass note: 0 root position, 1 first inversion, … */
  inversion: number;
  quality: Quality;
  fn: Fn;
  /** For dominant-function chords: the scale degree whose chord they resolve to. */
  resolvesTo?: number;
  /** The leading note, which should rise a semitone when the chord resolves. */
  lt?: PC;
  seventh?: PC;
  /** True for the home key's own V or V7 (which may also move deceptively to vi). */
  dominant?: boolean;
  secondary?: boolean;
  prior: number;
}

const NUMERALS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];
const TRIAD_FIGURES = ['', '6'];
const SEVENTH_FIGURES = ['7', '65', '43', '42'];

function numeral(deg: number, q: Quality): string {
  const n = NUMERALS[deg];
  let s = q === 'M' || q === 'D7' ? n.toUpperCase() : n;
  if (q === 'd' || q === 'd7') s += '°';
  if (q === 'h7') s += 'ø';
  return s;
}

interface ChordSpec {
  deg: number;
  q: Quality;
  fn: Fn;
  inversions: number[];
  /** Raise the root (minor-key vii°: the leading note). */
  raiseRoot?: boolean;
  minGrade: Grade;
  prior: number;
  resolvesTo?: number;
}

const MAJOR_CHORDS: ChordSpec[] = [
  { deg: 0, q: 'M', fn: 'T', inversions: [0, 1], minGrade: 1, prior: 0 },
  { deg: 1, q: 'm', fn: 'S', inversions: [0, 1], minGrade: 1, prior: 0.25 },
  { deg: 2, q: 'm', fn: 'T', inversions: [0, 1], minGrade: 2, prior: 1.2 },
  { deg: 3, q: 'M', fn: 'S', inversions: [0, 1], minGrade: 1, prior: 0.2 },
  { deg: 4, q: 'M', fn: 'D', inversions: [0, 1], minGrade: 1, prior: 0, resolvesTo: 0 },
  { deg: 5, q: 'm', fn: 'T', inversions: [0, 1], minGrade: 1, prior: 0.3 },
  { deg: 6, q: 'd', fn: 'D', inversions: [1], minGrade: 2, prior: 0.5, resolvesTo: 0 },
  { deg: 4, q: 'D7', fn: 'D', inversions: [0, 1, 2, 3], minGrade: 3, prior: 0.1, resolvesTo: 0 },
  { deg: 1, q: 'm7', fn: 'S', inversions: [1], minGrade: 3, prior: 0.2 },
];

const MINOR_CHORDS: ChordSpec[] = [
  { deg: 0, q: 'm', fn: 'T', inversions: [0, 1], minGrade: 1, prior: 0 },
  { deg: 1, q: 'd', fn: 'S', inversions: [1], minGrade: 1, prior: 0.3 },
  { deg: 2, q: 'M', fn: 'T', inversions: [0, 1], minGrade: 2, prior: 0.5 },
  { deg: 3, q: 'm', fn: 'S', inversions: [0, 1], minGrade: 1, prior: 0.2 },
  // Dorian IV, with the raised 6th of melodic minor.
  { deg: 3, q: 'M', fn: 'S', inversions: [0, 1], minGrade: 4, prior: 1.0 },
  { deg: 4, q: 'M', fn: 'D', inversions: [0, 1], minGrade: 1, prior: 0, resolvesTo: 0 },
  { deg: 4, q: 'm', fn: 'T', inversions: [1], minGrade: 4, prior: 1.1 },
  { deg: 5, q: 'M', fn: 'S', inversions: [0, 1], minGrade: 1, prior: 0.35 },
  // Natural VII acts as the dominant of III.
  { deg: 6, q: 'M', fn: 'D', inversions: [0, 1], minGrade: 2, prior: 0.7, resolvesTo: 2 },
  { deg: 6, q: 'd', fn: 'D', inversions: [1], minGrade: 2, prior: 0.5, raiseRoot: true, resolvesTo: 0 },
  { deg: 4, q: 'D7', fn: 'D', inversions: [0, 1, 2, 3], minGrade: 3, prior: 0.1, resolvesTo: 0 },
  { deg: 1, q: 'h7', fn: 'S', inversions: [1], minGrade: 3, prior: 0.2 },
  { deg: 6, q: 'd7', fn: 'D', inversions: [0, 1, 2], minGrade: 4, prior: 0.45, raiseRoot: true, resolvesTo: 0 },
];

/** Degrees that can be tonicised by a secondary dominant (Grade 4+), and their triad quality. */
const SECONDARY_TARGETS: Record<Mode, { deg: number; q: Quality; triadToo: boolean }[]> = {
  major: [
    { deg: 1, q: 'm', triadToo: true },
    { deg: 3, q: 'M', triadToo: false }, // V/IV is just I: only V7/IV is distinct
    { deg: 4, q: 'M', triadToo: true },
    { deg: 5, q: 'm', triadToo: true },
  ],
  minor: [
    { deg: 2, q: 'M', triadToo: false }, // V/III is VII, already available
    { deg: 3, q: 'm', triadToo: true },
    { deg: 5, q: 'M', triadToo: false }, // V/VI is III
  ],
};

function makeChord(key: LKey, root: PC, rootDeg: number, q: Quality, fn: Fn, inversion: number, extra: Partial<HChord>): HChord {
  const tones = SHAPES[q].map(([steps, semis]) => up(root, steps, semis));
  const figure = tones.length === 4 ? SEVENTH_FIGURES[inversion] : TRIAD_FIGURES[inversion];
  const base = extra.base ?? numeral(rootDeg, q);
  const [head, ...rest] = base.split('/');
  return {
    label: rest.length ? `${head}${figure}/${rest.join('/')}` : `${base}${figure}`,
    base,
    key,
    rootDeg,
    tones,
    inversion,
    quality: q,
    fn,
    seventh: tones.length === 4 ? tones[3] : undefined,
    prior: 0,
    ...extra,
  };
}

const chordCache = new Map<string, HChord[]>();

/** Every chord (in every allowed inversion) available in a key at a grade. */
function chordsFor(key: LKey, grade: Grade): HChord[] {
  const cacheKey = `${keyLabel(key)}|${grade}`;
  const cached = chordCache.get(cacheKey);
  if (cached) return cached;
  const out: HChord[] = [];
  for (const spec of key.mode === 'major' ? MAJOR_CHORDS : MINOR_CHORDS) {
    if (spec.minGrade > grade) continue;
    const root = degreePc(key, spec.deg, spec.raiseRoot);
    for (const inversion of spec.inversions) {
      const dominantFn = spec.resolvesTo !== undefined;
      const tones = SHAPES[spec.q].map(([steps, semis]) => up(root, steps, semis));
      out.push(
        makeChord(key, root, spec.deg, spec.q, spec.fn, inversion, {
          resolvesTo: spec.resolvesTo,
          // V's leading note is its third; vii°'s is its root.
          lt: dominantFn ? (spec.deg === 4 || (spec.deg === 6 && spec.q === 'M') ? tones[1] : tones[0]) : undefined,
          dominant: spec.deg === 4 && dominantFn,
          prior: spec.prior + (inversion === 0 ? 0 : inversion === 1 ? 0.15 : 0.25),
        }),
      );
    }
  }
  if (grade >= 4) {
    for (const target of SECONDARY_TARGETS[key.mode]) {
      const targetRoot = degreePc(key, target.deg);
      const root = up(targetRoot, 4, 7);
      const name = `V/${numeral(target.deg, target.q)}`;
      const qualities: Quality[] = target.triadToo ? ['M', 'D7'] : ['D7'];
      for (const q of qualities) {
        for (const inversion of q === 'M' ? [0, 1] : [0, 1, 2, 3]) {
          const tones = SHAPES[q].map(([steps, semis]) => up(root, steps, semis));
          out.push(
            makeChord(key, root, mod(target.deg + 4, 7), q, 'D', inversion, {
              base: name,
              resolvesTo: target.deg,
              lt: tones[1],
              secondary: true,
              prior: 0.6 + (inversion === 0 ? 0 : 0.2),
            }),
          );
        }
      }
    }
  }
  chordCache.set(cacheKey, out);
  return out;
}

const isTriad = (c: HChord) => c.tones.length === 3;
const bassPc = (c: HChord) => c.tones[c.inversion];
const hasTone = (c: HChord, pc: PC) => c.tones.some((t) => samePc(t, pc));
const roleOf = (c: HChord, pc: PC) => c.tones.findIndex((t) => samePc(t, pc));

// ---------------------------------------------------------------------------
// Plan: phrases, keys and cadences
// ---------------------------------------------------------------------------

interface PhrasePlan {
  key: LKey;
  cadence: Cadence;
  /** Index of an earlier phrase this one repeats exactly (bar form), if any. */
  repeats?: number;
}

function planPhrases(rng: Random, home: LKey, grade: Grade): PhrasePlan[] {
  const count = grade === 1 ? 2 : grade === 5 ? 6 : grade === 4 ? rng.pick([4, 6]) : 4;
  const major = home.mode === 'major';
  const rel = (deg: number, mode: Mode): LKey => ({ tonic: degreePc(home, deg), mode });
  const first: PhrasePlan = { key: home, cadence: rng.weighted(['HC', 'IAC'] as Cadence[], (c) => (c === 'HC' ? 3 : 1.5)) };
  const last: PhrasePlan = { key: home, cadence: 'PAC' };
  if (count === 2) return [first, last];

  // Second phrase: modulate to the dominant (major) or relative major (minor) from Grade 3.
  const second: PhrasePlan =
    grade >= 3
      ? { key: major ? rel(4, 'major') : rel(2, 'major'), cadence: 'PAC' }
      : { key: home, cadence: rng.weighted(['IAC', 'DC', 'HC'] as Cadence[], (c) => (c === 'IAC' ? 2 : 1)) };

  // A later phrase in another related key (Grade 4+), or a half or deceptive cadence at home.
  const away: PhrasePlan[] =
    grade >= 4
      ? major
        ? [
            { key: rel(5, 'minor'), cadence: 'PAC' },
            { key: rel(3, 'major'), cadence: 'PAC' },
            { key: rel(1, 'minor'), cadence: 'PAC' },
            { key: home, cadence: 'DC' },
          ]
        : [
            { key: rel(4, 'minor'), cadence: 'PAC' },
            { key: rel(3, 'minor'), cadence: 'PAC' },
            { key: rel(5, 'major'), cadence: 'PAC' },
            { key: home, cadence: 'HC' },
          ]
      : [
          { key: home, cadence: 'HC' },
          { key: home, cadence: 'DC' },
        ];
  const third = rng.pick(away);
  if (count === 4) return [first, second, third, last];
  // Bar form: Stollen (phrases 1–2), repeated, then the Abgesang.
  return [first, second, { ...first, repeats: 0 }, { ...second, repeats: 1 }, third, last];
}

// ---------------------------------------------------------------------------
// 1. The chorale tune
// ---------------------------------------------------------------------------

const PHRASE_BEATS = 8;
const RANGE = { s: [60, 79], a: [55, 74], t: [48, 67], b: [40, 60] } as const;

interface TuneNote {
  /** Diatonic index (letters from C0). */
  d: number;
  key: LKey;
}

/**
 * Spells a tune note in its key. In minor, the 6th and 7th are raised on the way up to the
 * tonic (melodic minor) and natural otherwise.
 */
function spellTune(n: TuneNote, nextD: number | undefined, forceRaise = false): Pitch {
  const l = mod(n.d, 7);
  const deg = degreeOfLetter(n.key, l);
  const ascending = nextD !== undefined && nextD === n.d + 1;
  const raise = forceRaise || (n.key.mode === 'minor' && (deg === 5 || deg === 6) && ascending);
  const pc = degreePc(n.key, deg, raise);
  return { letter: LETTERS[pc.l], alter: pc.a, octave: Math.floor(n.d / 7) };
}

/** Cadence formulas: the tune's last note (degree of the phrase's key) and the step into it. */
const ENDINGS: Record<Cadence, { end: number; from: 1 | -1; weight: number }[]> = {
  PAC: [
    { end: 0, from: 1, weight: 3 }, // re–do
    { end: 0, from: -1, weight: 1.2 }, // ti–do
  ],
  DC: [
    { end: 0, from: 1, weight: 3 },
    { end: 0, from: -1, weight: 1 },
  ],
  IAC: [
    { end: 2, from: 1, weight: 1.5 }, // fa–mi
    { end: 2, from: -1, weight: 1.5 }, // re–mi
  ],
  HC: [
    { end: 1, from: 1, weight: 2 }, // mi–re
    { end: 1, from: -1, weight: 1 }, // do–re
    { end: -1, from: 1, weight: 1 }, // do–ti
    { end: 4, from: 1, weight: 0.8 }, // la–sol
    { end: 4, from: -1, weight: 0.8 }, // fa–sol
  ],
  PC: [{ end: 0, from: 1, weight: 1 }],
};

const TUNE_LEAPS = [0.25, 1, 0.5, 0.22, 0.08];

function composeTune(rng: Random, plans: PhrasePlan[], home: LKey): TuneNote[] | null {
  const tune: TuneNote[] = [];
  const low = diatonicIndex({ letter: 'D', alter: 0, octave: 4 });
  const high = diatonicIndex({ letter: 'E', alter: 0, octave: 5 });
  const inRange = (n: TuneNote) => {
    const m = midi(spellTune(n, undefined));
    return m >= RANGE.s[0] && m <= RANGE.s[1];
  };

  /** The note sung before `n` in the phrase being composed (for the zig-zag rule). */
  let notesBefore: (n: TuneNote) => number | undefined = () => undefined;
  const ok = (p2: TuneNote | undefined, p1: TuneNote | undefined, c: TuneNote, cEnd = false): boolean => {
    if (!inRange(c)) return false;
    if (!p1) return true;
    const step = c.d - p1.d;
    const size = Math.abs(step);
    if (size > 4) return false;
    const deg1 = degreeOfLetter(p1.key, mod(p1.d, 7));
    // In minor, the 7th leads up to the tonic or falls to the 6th.
    if (p1.key.mode === 'minor' && deg1 === 6 && size !== 1) return false;
    const a = spellTune(p1, c.d);
    const b = spellTune(c, undefined, cEnd);
    if (!isSingableInterval(a, b)) return false;
    if (p2) {
      const prev = p1.d - p2.d;
      if (!isSingableInterval(spellTune(p2, p1.d), a)) return false;
      if (Math.abs(prev) >= 3 && !(size === 1 && Math.sign(step) === -Math.sign(prev))) return false;
      if (prev === 0 && step === 0) return false;
      // No zig-zag between two notes (x–y–x–y): chorale tunes move on.
      if (p2.d === c.d && step !== 0 && notesBefore(p2) === p1.d) return false;
      if (Math.abs(prev) >= 2 && size >= 2 && Math.sign(step) === Math.sign(prev) && Math.abs(prev) + size > 4) return false;
      // Minor: once the raised 6th rises to the 7th, it must go on to the tonic.
      const deg2 = degreeOfLetter(p2.key, mod(p2.d, 7));
      if (p1.key.mode === 'minor' && deg2 === 5 && prev === 1 && step !== 1) return false;
    }
    return true;
  };

  const composed: TuneNote[][] = [];
  for (let k = 0; k < plans.length; k++) {
    const plan = plans[k];
    if (plan.repeats !== undefined) {
      composed.push(composed[plan.repeats]);
      continue;
    }
    const key = plan.key;
    const last = k === plans.length - 1;
    // Later phrases climb higher; the last one settles.
    const peak = low + 4 + Math.min(k, 3) * 0.6 + rng.next() * 1.5;
    const ending = rng.weighted(ENDINGS[plan.cadence], (e) => e.weight);
    const endLetter = mod(key.tonic.l + ending.end, 7);
    const endOptions: number[] = [];
    for (let d = low - 2; d <= high + 2; d++) {
      if (mod(d, 7) === endLetter && inRange({ d, key }) && inRange({ d: d + ending.from, key })) endOptions.push(d);
    }
    if (!endOptions.length) return null;
    const endAim = last ? low + 1 : low + 2.5;
    const endD = endOptions.reduce((a, b) => (Math.abs(a - endAim) <= Math.abs(b - endAim) ? a : b));
    const notes: TuneNote[] = [];
    notes[6] = { d: endD + ending.from, key };
    notes[7] = { d: endD, key };
    const prevPhrase = composed[composed.length - 1] ?? [];
    const before = (i: number) => (i >= 0 ? notes[i] : prevPhrase[PHRASE_BEATS + i]);
    notesBefore = (n) => {
      for (let i = 0; i < 8; i++) if (notes[i] === n) return before(i - 1)?.d;
      const j = prevPhrase.indexOf(n);
      return j > 0 ? prevPhrase[j - 1].d : undefined;
    };
    const aim = (pos: number) => {
      const start = low + 2.5;
      const tp = 0.35 + rng.next() * 0.25;
      const t = pos / 7;
      return t < tp ? start + ((peak - start) * t) / tp : peak + ((endD - peak) * (t - tp)) / (1 - tp);
    };
    const aims = Array.from({ length: 8 }, (_, i) => aim(i));
    let budget = 4000;
    const search = (i: number): boolean => {
      if (--budget < 0) return false;
      if (i === 6) return ok(before(4), before(5), notes[6]) && ok(before(5), notes[6], notes[7], true);
      const options: TuneNote[] = [];
      for (let d = low - 3; d <= high + 3; d++) {
        const c = { d, key };
        // The piece opens on a note of the tonic chord.
        if (k === 0 && i === 0 && ![0, 2, 4].includes(degreeOfLetter(key, mod(d, 7)))) continue;
        if (ok(before(i - 2), before(i - 1), c)) options.push(c);
      }
      const weight = (c: TuneNote) => {
        const p1 = before(i - 1);
        let w = p1 ? TUNE_LEAPS[Math.min(Math.abs(c.d - p1.d), 4)] : 1;
        // Turning straight back to the previous note (x–y–x) is used sparingly.
        const p2 = before(i - 2);
        if (p2 && p1 && p2.d === c.d && p1.d !== c.d) w *= 0.5;
        w *= Math.exp(-0.4 * Math.abs(c.d - aims[i]));
        const deg = degreeOfLetter(key, mod(c.d, 7));
        // Downbeats lean towards the notes of the tonic chord.
        if ((i === 1 || i === 5) && [0, 2, 4].includes(deg)) w *= 1.3;
        // The upbeat-to-downbeat rising fourth (sol–do) is a chorale hallmark.
        if (i === 1 && p1 && c.d - p1.d === 3 && deg === 0) w *= 2;
        return w;
      };
      for (const c of rng.weightedOrder(options, weight)) {
        notes[i] = c;
        if (search(i + 1)) return true;
      }
      return false;
    };
    if (!search(0)) return null;
    composed.push(notes);
  }
  for (const notes of composed) tune.push(...notes);
  void home;
  return tune;
}

// ---------------------------------------------------------------------------
// 2. Harmony and bass
// ---------------------------------------------------------------------------

interface BeatInfo {
  s: Pitch;
  key: LKey;
  phrase: number;
  pos: number;
  cadence: Cadence;
}

interface HState {
  chord: HChord;
  bass: Pitch;
}

const FORBID = 1000;

/** Parallel (or contrary) fifths or octaves between two voices moving from (a1, b1) to (a2, b2). */
function parallel(a1: number, b1: number, a2: number, b2: number): boolean {
  if (a1 === a2 || b1 === b2) return false;
  const i1 = mod(a1 - b1, 12);
  const i2 = mod(a2 - b2, 12);
  return (i1 === 7 && i2 === 7) || (i1 === 0 && i2 === 0);
}

/** A melodic interval no voice should sing: augmented or diminished, a 7th, or beyond an octave. */
function badLeap(p: Pitch, q: Pitch): boolean {
  return !isSingableInterval(p, q);
}

const steps = (p: Pitch, q: Pitch) => diatonicIndex(q) - diatonicIndex(p);

function candidatesFor(beat: BeatInfo, grade: Grade, first: boolean, picardy: boolean, finalBeat: boolean): HChord[] {
  const s = pcOf(beat.s);
  let chords = chordsFor(beat.key, grade).filter((c) => hasTone(c, s));
  const root = (c: HChord, deg: number) => c.rootDeg === deg && !c.secondary;
  const triadRoot = (c: HChord, deg: number) => root(c, deg) && isTriad(c) && c.inversion === 0;
  if (first) chords = chords.filter((c) => triadRoot(c, 0));
  if (beat.pos === PHRASE_BEATS - 1) {
    switch (beat.cadence) {
      case 'PAC':
        chords = chords.filter((c) => triadRoot(c, 0));
        break;
      case 'IAC':
        chords = chords.filter((c) => root(c, 0) && isTriad(c));
        break;
      case 'HC':
        chords = chords.filter((c) => triadRoot(c, 4) && c.quality === 'M');
        break;
      case 'DC':
        chords = chords.filter((c) => triadRoot(c, 5));
        break;
      case 'PC':
        chords = chords.filter((c) => triadRoot(c, 0));
        break;
    }
    if (finalBeat && picardy && beat.key.mode === 'minor') {
      // Tierce de Picardie: the minor chorale ends on a major chord.
      const tonic = degreePc(beat.key, 0);
      chords = [makeChord(beat.key, tonic, 0, 'M', 'T', 0, { base: 'I', prior: 0 })];
      chords[0].label = 'I';
    }
  }
  if (beat.pos === PHRASE_BEATS - 2) {
    switch (beat.cadence) {
      case 'PAC':
      case 'DC':
        chords = chords.filter((c) => c.dominant && c.inversion === 0);
        break;
      case 'IAC':
        chords = chords.filter((c) => c.dominant || (root(c, 6) && c.fn === 'D'));
        break;
      case 'HC':
        chords = chords.filter((c) => c.fn !== 'D' || (c.secondary && c.resolvesTo === 4));
        break;
    }
  }
  return chords;
}

/** Cost of moving from chord a to chord b (lower is more idiomatic). */
function progressionCost(a: HChord, b: HChord): number {
  if (!sameKey(a.key, b.key)) return 0.4;
  const same = a.base === b.base && a.rootDeg === b.rootDeg;
  if (a.resolvesTo !== undefined) {
    if (same) return 0.3; // V → V7, or a change of inversion
    if (b.rootDeg === a.resolvesTo && !b.secondary) return 0;
    if (b.secondary && b.rootDeg === mod(a.resolvesTo + 4, 7) && a.secondary) return 0.6; // chain of dominants
    if (a.dominant && b.rootDeg === 5 && !b.secondary) return 0.8; // deceptive
    return 7;
  }
  if (same) return a.inversion === b.inversion && !!a.seventh === !!b.seventh ? 2.5 : 0.35;
  let c = [0, 0.4, 1.0, 0, 0.5, 0.45, 1.3][mod(b.rootDeg - a.rootDeg, 7)];
  if (a.fn === 'S' && b.fn === 'T') c += 0.6; // plagal motion: occasional in Bach
  if (a.seventh && b.fn !== 'D') c += 4; // ii65 leads to the dominant
  return c;
}

function bassCost(p: Pitch, q: Pitch): number {
  if (badLeap(p, q) && !(Math.abs(midi(q) - midi(p)) === 12)) return FORBID;
  const st = Math.abs(steps(p, q));
  return [0.8, 0, 0.35, 0.45, 0.5, 1.4, FORBID, 0.6][Math.min(st, 7)];
}

function harmonise(rng: Random, beats: BeatInfo[], grade: Grade, picardy: boolean, noise: number): HState[] | null {
  const layers: { state: HState; cost: number; back: number }[][] = [];
  beats.forEach((beat, g) => {
    const sm = midi(beat.s);
    const finalBeat = g === beats.length - 1;
    const states: HState[] = [];
    for (const chord of candidatesFor(beat, grade, g === 0, picardy, finalBeat)) {
      for (const bass of pitchesOf(bassPc(chord), RANGE.b[0], RANGE.b[1])) {
        if (sm - midi(bass) < 12) continue;
        // Only keep outer voices that leave room for a correct alto and tenor.
        if (!canVoice(chord, beat.s, bass, finalBeat)) continue;
        states.push({ chord, bass });
      }
    }
    const layer = states.map((state) => {
      const { chord, bass } = state;
      let cost = chord.prior + rng.next() * noise;
      const s = pcOf(beat.s);
      const b = pcOf(bass);
      if (chord.lt && samePc(s, chord.lt) && samePc(b, chord.lt)) cost += FORBID; // doubled leading note
      if (chord.seventh && samePc(s, chord.seventh) && samePc(b, chord.seventh)) cost += FORBID;
      if (sm - midi(bass) < 16) cost += 0.5;
      if (beat.pos === PHRASE_BEATS - 3 && ['PAC', 'IAC', 'DC'].includes(beat.cadence)) {
        cost += chord.fn === 'S' ? -0.3 : chord.fn === 'D' ? 1.2 : 0;
      }
      if (beat.pos === PHRASE_BEATS - 2 && beat.cadence === 'HC' && chord.fn === 'S') cost -= 0.3;
      // Bach's bass favours first inversions in mid-phrase; root position at cadences.
      if (beat.pos >= PHRASE_BEATS - 2 && chord.inversion > 0) cost += 0.5;
      if (g === 0) return { state, cost, back: -1 };
      const prevBeat = beats[g - 1];
      const boundary = prevBeat.pos === PHRASE_BEATS - 1;
      let best = Infinity;
      let back = -1;
      layers[g - 1].forEach((prev, k) => {
        if (prev.cost >= FORBID) return;
        const a = prev.state;
        let t = prev.cost + bassCost(a.bass, bass);
        const s1 = midi(prevBeat.s);
        const b1 = midi(a.bass);
        const b2 = midi(bass);
        if (!boundary) {
          t += progressionCost(a.chord, chord);
          if (parallel(s1, b1, sm, b2)) t += FORBID;
          // Hidden fifths/octaves in the outer voices when the soprano leaps.
          const ic = mod(sm - b2, 12);
          if ((ic === 0 || ic === 7) && Math.sign(sm - s1) === Math.sign(b2 - b1) && sm !== s1 && Math.abs(sm - s1) > 2) t += FORBID;
          if (Math.sign(sm - s1) === Math.sign(b2 - b1) && sm !== s1) t += 0.3;
          else if (sm !== s1 && b2 !== b1) t -= 0.1;
          // Sevenths fall; leading notes rise.
          const prevS = pcOf(prevBeat.s);
          const prevB = pcOf(a.bass);
          if (a.chord.seventh && a.chord.base !== chord.base) {
            // The seventh needs a chord tone a step below it in the next chord.
            const sev = a.chord.seventh;
            if (!chord.tones.some((x) => x.l === mod(sev.l - 1, 7))) t += FORBID;
            if (samePc(prevB, sev) && steps(a.bass, bass) !== -1) t += FORBID;
            if (samePc(prevS, sev) && steps(prevBeat.s, beat.s) !== -1 && !risingSeventhOk(a.chord, chord, steps(prevBeat.s, beat.s))) {
              t += FORBID;
            }
          }
          if (a.chord.lt && chord.rootDeg === a.chord.resolvesTo) {
            if (samePc(prevB, a.chord.lt) && steps(a.bass, bass) !== 1) t += 6;
            if (samePc(prevS, a.chord.lt) && steps(prevBeat.s, beat.s) !== 1) t += 8;
          }
        } else {
          t += 0.3;
        }
        if (t < best) {
          best = t;
          back = k;
        }
      });
      return { state, cost: best + cost, back };
    });
    layers.push(layer);
  });
  const lastLayer = layers[layers.length - 1];
  if (!lastLayer?.length) return null;
  let pick = lastLayer.reduce((bi, x, i) => (x.cost < lastLayer[bi].cost ? i : bi), 0);
  if (lastLayer[pick].cost >= FORBID) return null;
  const out: HState[] = [];
  for (let g = layers.length - 1; g >= 0; g--) {
    out[g] = layers[g][pick].state;
    pick = layers[g][pick].back;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Alto and tenor
// ---------------------------------------------------------------------------

interface Voicing {
  s: Pitch;
  a: Pitch;
  t: Pitch;
  b: Pitch;
}

function voiceCost(chord: HChord, v: Voicing, finalChord: boolean): number {
  const [sm, am, tm, bm] = [v.s, v.a, v.t, v.b].map(midi);
  if (!(sm >= am && am >= tm && tm >= bm)) return FORBID;
  if (sm - am > 12 || am - tm > 12 || tm - bm > 19) return FORBID;
  let cost = 0;
  if (sm === am || am === tm || tm === bm) cost += 2.5;
  if (tm - bm > 15) cost += 1.2; // keep the left hand within reach
  const roles = [v.s, v.a, v.t, v.b].map((p) => roleOf(chord, pcOf(p)));
  if (roles.includes(-1)) return FORBID;
  const count = (r: number) => roles.filter((x) => x === r).length;
  if (!count(0) || !count(1) || (chord.seventh && !count(3))) return FORBID;
  if (chord.lt && [v.s, v.a, v.t, v.b].filter((p) => samePc(pcOf(p), chord.lt!)).length > 1) return FORBID;
  if (chord.seventh && count(3) > 1) return FORBID;
  if (!count(2)) cost += finalChord ? 0.2 : chord.seventh ? 0.3 : 0.9;
  if (isTriad(chord)) {
    if (count(1) > 1) cost += chord.inversion === 1 || chord.quality !== 'M' ? 0.35 : 1.0;
    if (count(2) > 1) cost += 0.4;
  }
  return cost;
}

/** True if some alto and tenor complete the chord correctly between this soprano and bass. */
function canVoice(chord: HChord, s: Pitch, b: Pitch, finalChord: boolean): boolean {
  const altos = chord.tones.flatMap((pc) => pitchesOf(pc, RANGE.a[0], RANGE.a[1]));
  const tenors = chord.tones.flatMap((pc) => pitchesOf(pc, RANGE.t[0], RANGE.t[1]));
  return altos.some((a) => tenors.some((t) => voiceCost(chord, { s, a, t, b }, finalChord) < FORBID));
}

function voice(rng: Random, beats: BeatInfo[], harmony: HState[]): { voicings: Voicing[]; cost: number } {
  const layers: { v: Voicing; cost: number; back: number }[][] = [];
  harmony.forEach((h, g) => {
    const chord = h.chord;
    const s = beats[g].s;
    const finalChord = g === harmony.length - 1;
    const altos = chord.tones.flatMap((pc) => pitchesOf(pc, RANGE.a[0], RANGE.a[1]));
    const tenors = chord.tones.flatMap((pc) => pitchesOf(pc, RANGE.t[0], RANGE.t[1]));
    const layer: { v: Voicing; cost: number; back: number }[] = [];
    for (const a of altos) {
      for (const t of tenors) {
        const v = { s, a, t, b: h.bass };
        const own = voiceCost(chord, v, finalChord);
        if (own >= FORBID) continue;
        const base = own + rng.next() * 0.25;
        if (g === 0) {
          layer.push({ v, cost: base, back: -1 });
          continue;
        }
        const boundary = beats[g - 1].pos === PHRASE_BEATS - 1;
        const prevChord = harmony[g - 1].chord;
        let best = Infinity;
        let back = -1;
        layers[g - 1].forEach((prev, k) => {
          const p = prev.v;
          let c = prev.cost + transitionCost(prevChord, chord, p, v, boundary);
          if (c < best) {
            best = c;
            back = k;
          }
        });
        if (back >= 0) layer.push({ v, cost: best + base, back });
      }
    }
    layers.push(layer);
  });
  const last = layers[layers.length - 1];
  if (!last.length) return { voicings: [], cost: Infinity };
  let pick = last.reduce((bi, x, i) => (x.cost < last[bi].cost ? i : bi), 0);
  const cost = last[pick].cost;
  const voicings: Voicing[] = [];
  for (let g = layers.length - 1; g >= 0; g--) {
    if (!layers[g][pick]) return { voicings: [], cost: Infinity };
    voicings[g] = layers[g][pick].v;
    pick = layers[g][pick].back;
  }
  return { voicings, cost };
}

const VOICES = ['s', 'a', 't', 'b'] as const;
type VoiceName = (typeof VOICES)[number];

/** V4/3 – I6: the seventh may rise a step, moving in tenths with the bass. */
function risingSeventhOk(a: HChord, b: HChord, st: number): boolean {
  return st === 1 && a.dominant === true && a.inversion === 2 && b.rootDeg === 0 && b.inversion === 1;
}

function transitionCost(prevChord: HChord, chord: HChord, p: Voicing, v: Voicing, boundary: boolean): number {
  let c = 0;
  for (const name of ['a', 't'] as const) {
    const from = midi(p[name]);
    const to = midi(v[name]);
    const leap = Math.abs(to - from);
    if (leap > 12 || (leap > 0 && badLeap(p[name], v[name]))) return FORBID;
    c += 0.1 * leap;
    if (leap > 7) c += 1.0;
    if (leap === 0) c -= 0.1;
  }
  // No parallel fifths or octaves between any two voices (a fermata softens this).
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const x = VOICES[i];
      const y = VOICES[j];
      if (parallel(midi(p[x]), midi(p[y]), midi(v[x]), midi(v[y]))) c += boundary ? 30 : FORBID;
    }
  }
  // Avoid overlapping: a voice should not pass where its neighbour just was.
  if (midi(v.a) < midi(p.t) || midi(v.t) > midi(p.a)) c += 1;
  if (midi(v.a) > midi(p.s) || midi(v.t) < midi(p.b)) c += 1;
  if (boundary) return c;
  for (const name of ['a', 't'] as const) {
    const pc = pcOf(p[name]);
    const st = steps(p[name], v[name]);
    // The leading note rises (inner voices may drop to the fifth, as Bach's often do).
    if (prevChord.lt && samePc(pc, prevChord.lt) && chord.rootDeg === prevChord.resolvesTo) {
      if (st !== 1) c += st === -2 ? 0.6 : 4;
    }
    // A chordal seventh falls by step (unless the same chord simply changes position).
    if (prevChord.seventh && samePc(pc, prevChord.seventh) && st !== -1) {
      const held = prevChord.base === chord.base;
      if (!held && !risingSeventhOk(prevChord, chord, st)) return FORBID;
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// 4. Figuration
// ---------------------------------------------------------------------------

interface Event {
  p: Pitch;
  ticks: number;
  tie?: boolean;
}

/** Spells the note a step between two pitches (or beside one), in the key, matching nearby chords. */
function stepBetween(d: number, key: LKey, chords: HChord[], ascendingToRaised: boolean): Pitch {
  const l = mod(d, 7);
  for (const c of chords) {
    const t = c.tones.find((x) => x.l === l);
    if (t) return { letter: LETTERS[t.l], alter: t.a, octave: Math.floor(d / 7) };
  }
  const pc = degreePc(key, degreeOfLetter(key, l), ascendingToRaised);
  return { letter: LETTERS[pc.l], alter: pc.a, octave: Math.floor(d / 7) };
}

function figurate(rng: Random, beats: BeatInfo[], harmony: HState[], voicings: Voicing[], grade: Grade): Record<VoiceName, Event[][]> {
  const events = {} as Record<VoiceName, Event[][]>;
  for (const name of VOICES) events[name] = voicings.map((v) => [{ p: v[name], ticks: 4 }]);
  if (grade < 3) return events;
  const chance: Record<VoiceName, number> =
    grade === 3 ? { s: 0, a: 0.1, t: 0.15, b: 0.35 } : grade === 4 ? { s: 0, a: 0.35, t: 0.4, b: 0.45 } : { s: 0.08, a: 0.4, t: 0.45, b: 0.5 };

  const at = (name: VoiceName, g: number, half: boolean) => {
    const e = events[name][g];
    return half && e.length > 1 ? e[1].p : e[0].p;
  };
  const moving = (name: VoiceName, g: number) => events[name][g].length > 1 && !(events[name][g][0].tie);

  /** Checks the half-beat after beat g: order, consonance between moving voices, no parallels. */
  const valid = (g: number) => {
    const onset = VOICES.map((n) => midi(at(n, g, false)));
    const half = VOICES.map((n) => midi(at(n, g, true)));
    const next = VOICES.map((n) => midi(at(n, g + 1, false)));
    for (let i = 0; i < 3; i++) if (half[i] < half[i + 1]) return false;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        if (parallel(onset[i], onset[j], half[i], half[j])) return false;
        if (parallel(half[i], half[j], next[i], next[j])) return false;
        if (moving(VOICES[i], g) && moving(VOICES[j], g)) {
          const ic = mod(half[i] - half[j], 12);
          if (![3, 4, 8, 9].includes(ic)) return false;
        }
      }
    }
    return true;
  };

  // 4–3 suspensions over the dominant at cadences (Grade 4+).
  if (grade >= 4) {
    beats.forEach((beat, g) => {
      if (beat.pos !== PHRASE_BEATS - 2 || !['PAC', 'IAC', 'DC'].includes(beat.cadence)) return;
      if (!harmony[g].chord.dominant || !rng.chance(grade === 5 ? 0.7 : 0.5)) return;
      for (const name of rng.weightedOrder(['a', 't'] as VoiceName[], () => 1)) {
        const prev = voicings[g - 1][name];
        const cur = voicings[g][name];
        if (steps(prev, cur) !== -1) continue;
        const others = VOICES.filter((n) => n !== name).map((n) => pcOf(voicings[g][n]));
        if (others.some((pc) => samePc(pc, pcOf(cur)))) continue;
        const saved = [events[name][g - 1], events[name][g]];
        events[name][g - 1] = [{ p: prev, ticks: 4, tie: true }];
        events[name][g] = [{ p: prev, ticks: 2 }, { p: cur, ticks: 2 }];
        if (valid(g) && valid(g - 1)) break;
        [events[name][g - 1], events[name][g]] = saved;
      }
    });
  }

  // Passing and neighbour notes.
  for (let g = 0; g < beats.length - 1; g++) {
    if (beats[g].pos === PHRASE_BEATS - 1) continue; // never through a fermata
    for (const name of rng.weightedOrder([...VOICES], () => 1)) {
      if (events[name][g].length > 1 || events[name][g][0].tie) continue;
      if (events[name][g + 1][0].tie || (g > 0 && events[name][g - 1][0].tie)) continue;
      if (!rng.chance(chance[name])) continue;
      const c = voicings[g][name];
      const n = voicings[g + 1][name];
      const gap = steps(c, n);
      let q: Pitch | null = null;
      const nearby = [harmony[g].chord, harmony[g + 1].chord];
      if (Math.abs(gap) === 2) {
        q = stepBetween(diatonicIndex(c) + Math.sign(gap), beats[g].key, nearby, gap > 0);
      } else if (gap === 0 && name !== 's' && rng.chance(0.35)) {
        q = stepBetween(diatonicIndex(c) - 1, beats[g].key, nearby, false); // lower neighbour
      }
      if (!q) continue;
      const m = midi(q);
      const [lo, hi] = RANGE[name];
      if (m < lo || m > hi) continue;
      const s1 = Math.abs(m - midi(c));
      const s2 = Math.abs(midi(n) - m);
      if (s1 < 1 || s1 > 2 || s2 < 1 || s2 > 2) continue;
      events[name][g] = [{ p: c, ticks: 2 }, { p: q, ticks: 2 }];
      if (!valid(g)) events[name][g] = [{ p: c, ticks: 4 }];
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function generateChorale(settings: Settings): Piece {
  const { seed, grade } = settings;
  const spec = GRADE_SPECS[grade];
  const rng = new Random(`${seed}|g${grade}|chorale|${settings.keyId ?? ''}`);
  const keys = KEYS.filter((k) => spec.keys.includes(k.id));
  const key: Key = KEYS.find((k) => k.id === settings.keyId) ?? rng.weighted(keys, (k) => (k.mode === 'major' ? 2 : 1.5));
  const home: LKey = { tonic: { l: LETTERS.indexOf(key.tonic), a: key.tonicAlter }, mode: key.mode };
  const picardy = key.mode === 'minor' && rng.chance(0.65);

  let best: {
    plans: PhrasePlan[];
    beats: BeatInfo[];
    harmony: HState[];
    events: Record<VoiceName, Event[][]>;
    cost: number;
  } | null = null;
  for (let attempt = 0; attempt < 12 && !(best && best.cost < FORBID / 2); attempt++) {
    const plans = planPhrases(rng, home, grade);
    const tune = composeTune(rng, plans, home);
    if (!tune) continue;
    const beats: BeatInfo[] = tune.map((n, g) => {
      const phrase = Math.floor(g / PHRASE_BEATS);
      const pos = g % PHRASE_BEATS;
      const next = pos < PHRASE_BEATS - 1 ? tune[g + 1].d : undefined;
      const endsOnLeadingNote = pos === PHRASE_BEATS - 1 && plans[phrase].cadence === 'HC' && degreeOfLetter(n.key, mod(n.d, 7)) === 6;
      return { s: spellTune(n, next, endsOnLeadingNote), key: n.key, phrase, pos, cadence: plans[phrase].cadence };
    });
    // Harmonise once per distinct phrase; repeated phrases (bar form) are copied afterwards.
    const order = plans.map((p, k) => (p.repeats === undefined ? k : -1)).filter((k) => k >= 0);
    const uniqueBeats = order.flatMap((k) => beats.slice(k * PHRASE_BEATS, (k + 1) * PHRASE_BEATS));
    // A few harmonisations of the same tune, until one can be voiced without breaking a rule.
    let harmonyUnique: HState[] | null = null;
    let voiced: { voicings: Voicing[]; cost: number } = { voicings: [], cost: Infinity };
    for (let tryHarmony = 0; tryHarmony < 4; tryHarmony++) {
      const h = harmonise(rng, uniqueBeats, grade, picardy, 0.6 + tryHarmony * 0.5);
      if (!h) break;
      const v = voice(rng, uniqueBeats, h);
      if (v.voicings.length && v.cost < voiced.cost) {
        harmonyUnique = h;
        voiced = v;
      }
      if (voiced.cost < FORBID / 2) break;
    }
    if (!harmonyUnique || !voiced.voicings.length) continue;
    const expand = <T>(xs: T[]): T[] =>
      plans.flatMap((p, k) => {
        const source = order.indexOf(p.repeats ?? k);
        return xs.slice(source * PHRASE_BEATS, (source + 1) * PHRASE_BEATS);
      });
    if (best && voiced.cost >= best.cost) continue;
    // Figurate each distinct phrase once, so a repeated phrase is repeated note for note.
    const figured = figurate(rng, uniqueBeats, harmonyUnique, voiced.voicings, grade);
    const events = {} as Record<VoiceName, Event[][]>;
    for (const name of VOICES) events[name] = expand(figured[name]);
    best = { plans, beats, harmony: expand(harmonyUnique), events, cost: voiced.cost };
  }
  if (!best) throw new Error('Chorale generation failed');

  const { plans, beats, harmony, events } = best;

  // Lay the beats into bars: a one-beat upbeat, full bars, and a three-beat final bar.
  const totalBeats = beats.length;
  const barOf = (g: number) => Math.floor((g + 3) / 4);
  const barCount = barOf(totalBeats - 1) + 1;
  const bars: Bar[] = Array.from({ length: barCount }, () => ({
    harmony: [],
    rh: [],
    lh: [],
    voices: { s: [], a: [], t: [], b: [] },
  }));
  beats.forEach((beat, g) => {
    const bar = bars[barOf(g)];
    const beatInBar = g === 0 ? 0 : (g + 3) % 4;
    const chord = harmony[g].chord;
    const label = beat.pos === 0 && !sameKey(beat.key, home) ? `${pcName(beat.key.tonic)}${beat.key.mode === 'minor' ? 'm' : ''}: ${chord.label}` : chord.label;
    bar.harmony.push({ symbol: label, at: beatInBar * 4, tones: chord.tones.map(pcName) });
    const fermata = beat.pos === PHRASE_BEATS - 1;
    for (const name of VOICES) {
      for (const e of events[name][g]) {
        const note: Note = { pitches: [e.p], ticks: e.ticks };
        if (e.tie) note.tie = true;
        if (fermata) note.fermata = true;
        bar.voices![name].push(note);
      }
    }
  });
  for (const bar of bars) {
    bar.rh = bar.voices!.s;
    bar.lh = bar.voices!.b;
  }

  const phrases: PhraseInfo[] = plans.map((p, k) => ({
    startBar: barOf(k * PHRASE_BEATS),
    bars: 2,
    cadence: p.cadence,
    repeatsOpening: p.repeats !== undefined,
    key: sameKey(p.key, home) ? undefined : keyLabel(p.key),
  }));

  return {
    title: `Chorale in ${keyLabel(home)}`,
    seed,
    grade,
    style: 'chorale',
    key,
    mode: key.mode,
    time: TIME_SIGNATURES['4/4'],
    tempo: { bpm: 60 + rng.int(0, 6) * 2, beatUnit: 'q', marking: '' },
    dynamic: '',
    bars,
    phrases,
  };
}
