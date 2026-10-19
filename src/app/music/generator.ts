/**
 * Sight-reading piece generator: harmony → rhythm → melody → left hand → Piece.
 *
 * Pure TypeScript with no Angular dependencies. Fully deterministic: the same
 * settings (including the seed) always produce the same piece.
 */
import {
  GRADE_SPECS,
  Grade,
  GradeSpec,
  TIME_SIGNATURES,
  TimeSignature,
  TimeSignatureId,
} from './grades';
import { Random } from './random';
import {
  COMPOUND_CELLS,
  RhythmCell,
  SIMPLE_CELLS,
  STYLES,
  StyleId,
  StyleSpec,
} from './styles';
import {
  Chord,
  KEYS,
  Key,
  Mode,
  Pitch,
  allowsNaturalSeventh,
  alterFor,
  bassDegree,
  chordFor,
  chordTones,
  degreeToPitch,
  diatonicIndex,
  isChordTone,
  isSingableInterval,
  keyById,
  keyName,
  mod,
  tonicOctaveFor,
  tonicSymbol,
} from './theory';

export interface Note {
  /** Empty for a rest. Chords (left hand) are sorted low to high. */
  pitches: Pitch[];
  ticks: number;
  rest?: boolean;
  /** True when the note deliberately uses a chromatic pitch (Grade 4+ secondary dominant). */
  chromatic?: boolean;
}

/** A chord sounding from `at` (ticks from the start of the bar) to the next chord or the bar line. */
export interface Harmony {
  symbol: string;
  at: number;
}

export interface Bar {
  /** One chord, or two when the harmony changes at the half bar. */
  harmony: Harmony[];
  rh: Note[];
  lh: Note[];
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
}

export interface Settings {
  seed: string;
  grade: Grade;
  style: StyleId;
  /** Optional override; otherwise a random key allowed by the grade and style. */
  keyId?: string;
  /** Optional override; otherwise a random time signature allowed by the grade and style. */
  timeId?: TimeSignatureId;
}

/** Keys offered for a grade and style (March is major-only). */
export function keysFor(grade: Grade, style: StyleId): Key[] {
  const spec = GRADE_SPECS[grade];
  return KEYS.filter((k) => spec.keys.includes(k.id) && !(STYLES[style].majorOnly && k.mode === 'minor'));
}

export function timesFor(grade: Grade): TimeSignatureId[] {
  return [...GRADE_SPECS[grade].times];
}

export function generatePiece(settings: Settings): Piece {
  const { seed, grade, style: styleId } = settings;
  const spec = GRADE_SPECS[grade];
  const style = STYLES[styleId];
  const rng = new Random(
    `${seed}|g${grade}|${styleId}|${settings.keyId ?? ''}|${settings.timeId ?? ''}`,
  );

  const key = chooseKey(rng, grade, styleId, settings.keyId);
  const time = TIME_SIGNATURES[chooseTime(rng, spec, style, settings.timeId)];
  const barCount = rng.pick(spec.bars);

  const ctx: Ctx = { rng, spec, style, key, time, grade };
  const phrases = planPhrases(ctx, barCount);
  const segments = phrases.flatMap((p) => p.harmony).map((bar) => toSegments(bar, time, key.mode));
  const rhythms = planRhythms(ctx, phrases, segments);
  const rh = buildMelody(ctx, phrases, segments, rhythms);
  const lh = buildLeftHand(ctx, segments);

  return {
    title: `${style.titleWord} in ${keyName(key)}`,
    seed,
    grade,
    style: styleId,
    key,
    mode: key.mode,
    time,
    tempo: chooseTempo(rng, grade, style, time),
    dynamic: style.dynamic,
    bars: segments.map((segs, i) => ({
      harmony: segs.map((s) => ({ symbol: s.chord.symbol, at: s.at })),
      rh: rh[i],
      lh: lh[i],
    })),
    phrases: phrases.map(({ startBar, cadence, sequence, repeatsOpening }) => ({
      startBar,
      bars: 4,
      cadence,
      sequence: sequence?.name,
      repeatsOpening,
    })),
  };
}

interface Ctx {
  rng: Random;
  spec: GradeSpec;
  style: StyleSpec;
  key: Key;
  time: TimeSignature;
  grade: Grade;
}

/** A stretch of a bar with one chord. */
interface Segment {
  chord: Chord;
  /** Ticks from the start of the bar. */
  at: number;
  ticks: number;
}

/** Where the harmony may change mid-bar, or null if it cannot (3/8). */
function splitTicks(time: TimeSignature): number | null {
  switch (time.id) {
    case '2/4': return 4;
    case '3/4': return 8;
    case '4/4': return 8;
    case '6/8': return 6;
    case '9/8': return 12;
    case '3/8': return null;
  }
}

function toSegments(bar: string[], time: TimeSignature, mode: Mode): Segment[] {
  if (bar.length === 1) return [{ chord: chordFor(bar[0], mode), at: 0, ticks: time.barTicks }];
  const split = splitTicks(time)!;
  return [
    { chord: chordFor(bar[0], mode), at: 0, ticks: split },
    { chord: chordFor(bar[1], mode), at: split, ticks: time.barTicks - split },
  ];
}

// ---------------------------------------------------------------------------
// Key, time, tempo
// ---------------------------------------------------------------------------

function chooseKey(rng: Random, grade: Grade, style: StyleId, keyId?: string): Key {
  const override = keyId ? keyById(keyId) : undefined;
  if (override) return override;
  // Major keys are more common in early-grade sight-reading.
  return rng.weighted(keysFor(grade, style), (k) => (k.mode === 'major' ? 2 : 1));
}

function chooseTime(rng: Random, spec: GradeSpec, style: StyleSpec, timeId?: TimeSignatureId): TimeSignatureId {
  if (timeId && TIME_SIGNATURES[timeId]) return timeId;
  const preferred = style.times.filter((t) => spec.times.includes(t));
  const pool = preferred.length ? preferred : spec.times.filter((t) => !TIME_SIGNATURES[t].compound);
  // The style's first-listed metre is its most typical (e.g. 6/8 for Folk once Grade 3 allows it).
  return rng.weighted(pool, (t) => (t === style.times[0] ? 2 : 1));
}

function chooseTempo(rng: Random, grade: Grade, style: StyleSpec, time: TimeSignature): Tempo {
  const [slow, fast] = style.crotchetBpm;
  const crotchet = slow + ((fast - slow) * (grade - 1)) / 4 + rng.int(-4, 4);
  const even = (n: number) => Math.round(n / 2) * 2;
  const marking = style.id === 'classical' && grade >= 4 ? 'Allegretto' : style.tempoMarking;
  if (time.compound) return { bpm: even(crotchet * 0.58), beatUnit: 'qd', marking };
  if (time.id === '3/8') return { bpm: even(crotchet * 1.5), beatUnit: '8', marking };
  return { bpm: even(crotchet), beatUnit: 'q', marking };
}

// ---------------------------------------------------------------------------
// Harmony: 4-bar phrases, each ending in a cadence, some opening with a sequence
// ---------------------------------------------------------------------------

type PhraseKind = 'single' | 'antecedent' | 'contrast' | 'consequent' | 'continuation';

/** A sequence: `units` bars, each a copy of the first moved `step` scale degrees. */
interface SequenceSpec {
  name: SequenceName;
  units: number;
  step: number;
}

interface Phrase {
  kind: PhraseKind;
  startBar: number;
  /** Four bars of one or two chord symbols each. */
  harmony: string[][];
  cadence: Cadence;
  sequence?: SequenceSpec;
  repeatsOpening: boolean;
}

interface Template {
  harmony: string[][];
  cadence: Cadence;
  weight: number;
  sequence?: SequenceSpec;
  minGrade?: Grade;
}

/** Builds a template from "I,V6 | vi,iii6 | IV | V" notation. */
function tpl(bars: string, cadence: Cadence, weight: number, extra: Partial<Template> = {}): Template {
  return { harmony: bars.split('|').map((b) => b.trim().split(',').map((c) => c.trim())), cadence, weight, ...extra };
}

const ROMANESCA: SequenceSpec = { name: 'romanesca', units: 3, step: -2 };
const FIFTHS: SequenceSpec = { name: 'descending-fifths', units: 3, step: -1 };
const FIFTHS_SHORT: SequenceSpec = { name: 'descending-fifths', units: 2, step: -1 };
const FIVE_SIX: SequenceSpec = { name: 'ascending-5-6', units: 3, step: 1 };

/** Sequences that end on a half cadence, usable to open a piece or as a middle phrase. */
const SEQUENCES_HC: Record<Mode, Template[]> = {
  major: [
    // Romanesca: a bass falling by step under alternating root-position and 6 chords.
    tpl('I,V6 | vi,iii6 | IV,I6 | ii6,V', 'HC', 3, { sequence: ROMANESCA, minGrade: 3 }),
    // Circle of fifths: roots fall a 5th within each bar; each bar falls a step.
    tpl('I,IV | vii°,iii | vi,ii | V', 'HC', 2.5, { sequence: FIFTHS, minGrade: 4 }),
    // Ascending 5–6: the 5th above each bass moves to a 6th, and the pattern climbs by step.
    tpl('I,vi6 | ii,vii°6 | iii,I6 | IV,V', 'HC', 2.5, { sequence: FIVE_SIX, minGrade: 4 }),
  ],
  minor: [
    tpl('i,v6 | VI,III6 | iv,i6 | iv6,V', 'HC', 3, { sequence: ROMANESCA, minGrade: 3 }),
    tpl('i,iv | VII,III | VI,ii°6 | V', 'HC', 2.5, { sequence: FIFTHS, minGrade: 4 }),
  ],
};

const SINGLE: Record<Mode, Template[]> = {
  major: [tpl('I | IV | V | I', 'PAC', 3), tpl('I | V | V | I', 'PAC', 1), tpl('I | I | V | I', 'PAC', 1)],
  minor: [tpl('i | iv | V | i', 'PAC', 3), tpl('i | V | V | i', 'PAC', 1), tpl('i | i | V | i', 'PAC', 1)],
};

/** First phrase: starts on the tonic and ends with a weaker cadence (HC, IAC or PC). */
const OPENING: Record<Mode, Template[]> = {
  major: [
    tpl('I | IV | V | V', 'HC', 3),
    tpl('I | IV | I | V', 'HC', 2.5),
    tpl('I | V | I | V', 'HC', 1.5),
    tpl('I | vi | IV | V', 'HC', 2),
    tpl('I | IV | V/V | V', 'HC', 1.5),
    tpl('I | IV | V | I', 'IAC', 2),
    tpl('I | V | V | I', 'IAC', 1),
    tpl('I | V | IV | I', 'PC', 1.5),
    tpl('I | vi | IV | I', 'PC', 1),
    ...SEQUENCES_HC.major,
  ],
  minor: [
    tpl('i | iv | V | V', 'HC', 3),
    tpl('i | iv | i | V', 'HC', 2.5),
    tpl('i | V | i | V', 'HC', 1.5),
    tpl('i | VI | iv | V', 'HC', 2),
    tpl('i | iv | V | i', 'IAC', 2),
    tpl('i | V | iv | i', 'PC', 1.5),
    ...SEQUENCES_HC.minor,
  ],
};

/** Middle phrase of a 12-bar piece: away from the tonic, ending HC or PC. */
const CONTRAST: Record<Mode, Template[]> = {
  major: [
    tpl('IV | I | IV | V', 'HC', 2),
    tpl('IV | V | I | V', 'HC', 2),
    tpl('vi | IV | V | V', 'HC', 2),
    tpl('vi | ii | V | V', 'HC', 1),
    tpl('IV | I | V/V | V', 'HC', 1.5),
    tpl('IV | V | IV | I', 'PC', 1.5),
    tpl('vi | V | IV | I', 'PC', 1),
    ...SEQUENCES_HC.major.map((t) => ({ ...t, weight: t.weight + 0.5 })),
  ],
  minor: [
    tpl('iv | i | iv | V', 'HC', 2),
    tpl('iv | V | i | V', 'HC', 2),
    tpl('VI | iv | V | V', 'HC', 2),
    tpl('iv | V | iv | i', 'PC', 1.5),
    ...SEQUENCES_HC.minor.map((t) => ({ ...t, weight: t.weight + 0.5 })),
  ],
};

/** Final phrase after a deceptive cadence: picks up from vi and closes with a PAC. */
const CONTINUATION: Record<Mode, Template[]> = {
  major: [
    tpl('vi,ii | V,I | IV,V | I', 'PAC', 3, { sequence: FIFTHS_SHORT, minGrade: 3 }),
    tpl('IV | I | ii6,V | I', 'PAC', 1.5),
    tpl('IV | ii | V | I', 'PAC', 1.5),
    tpl('vi | IV | V | I', 'PAC', 1),
  ],
  minor: [
    tpl('VI,ii°6 | V,i | iv,V | i', 'PAC', 2.5, { sequence: FIFTHS_SHORT, minGrade: 4 }),
    tpl('VI | iv | V | i', 'PAC', 2),
    tpl('iv | i | V | i', 'PAC', 1.5),
  ],
};

/** The bar before a consequent's last bar: the approach to V. */
const APPROACH: Record<Mode, Template[]> = {
  major: [tpl('V', 'PAC', 2), tpl('IV,V', 'PAC', 2), tpl('ii6,V', 'PAC', 2)],
  minor: [tpl('V', 'PAC', 2), tpl('iv,V', 'PAC', 2), tpl('iv6,V', 'PAC', 1.5), tpl('ii°6,V', 'PAC', 1.5)],
};

const CORE_CHORDS = ['I', 'i', 'IV', 'iv', 'V'];
const DUPLE = ['2/4', '4/4', '6/8'];

function planPhrases(ctx: Ctx, barCount: number): Phrase[] {
  const { rng, spec, style, time, grade, key } = ctx;
  const mode = key.mode;
  const extras: readonly string[] = spec.extraChords.filter((c) => style.extraChords.includes(c));
  const twoChordBars = spec.inversions && splitTicks(time) !== null && style.id !== 'folk';
  const baseOf = (symbol: string) => (symbol.endsWith('6') ? symbol.slice(0, -1) : symbol);
  const available = (symbol: string) =>
    (CORE_CHORDS.includes(baseOf(symbol)) || extras.includes(baseOf(symbol))) &&
    (!symbol.endsWith('6') || spec.inversions);

  /** Adapts a template to this grade and metre, or returns null if it cannot be used. */
  const adapt = (t: Template): Template | null => {
    if ((t.minGrade ?? 1) > grade) return null;
    if (t.sequence && !twoChordBars) return null;
    const harmony = t.harmony.map((bar, i) => {
      const inSequence = t.sequence !== undefined && i < t.sequence.units;
      // Outside a sequence, two chords in a bar need a duple metre; otherwise keep the second.
      if (bar.length === 2 && !inSequence && !(twoChordBars && DUPLE.includes(time.id))) return [bar[1]];
      return bar;
    });
    if (!harmony.flat().every(available)) return null;
    return { ...t, harmony };
  };
  const choose = (options: Template[]): Template => {
    const usable = options.map(adapt).filter((t): t is Template => t !== null);
    return rng.weighted(usable, (t) => t.weight);
  };
  const phrase = (kind: PhraseKind, startBar: number, t: Template): Phrase => ({
    kind,
    startBar,
    harmony: t.harmony,
    cadence: t.cadence,
    sequence: t.sequence,
    repeatsOpening: false,
  });

  if (barCount === 4) return [phrase('single', 0, choose(SINGLE[mode]))];

  const opening = phrase('antecedent', 0, choose(OPENING[mode]));
  /** Repeats the opening two bars, then cadences: PAC to finish, or DC to keep going. */
  const answer = (startBar: number, cadence: 'PAC' | 'DC'): Phrase => {
    const approach = choose(APPROACH[mode]).harmony[0];
    const goal = cadence === 'PAC' ? tonicSymbol(mode) : mode === 'major' ? 'vi' : 'VI';
    return {
      kind: 'consequent',
      startBar,
      harmony: [opening.harmony[0], opening.harmony[1], approach, [goal]],
      cadence,
      repeatsOpening: true,
    };
  };

  if (barCount === 8) return [opening, answer(4, 'PAC')];

  // 12 bars: A – B (contrast) – A', or A – A' (deceptive cadence) – continuation to a PAC.
  if (available(mode === 'major' ? 'vi' : 'VI') && rng.chance(0.5)) {
    return [opening, answer(4, 'DC'), phrase('continuation', 8, choose(CONTINUATION[mode]))];
  }
  // The middle phrase should not reuse the opening's sequence.
  const contrast = CONTRAST[mode].filter((t) => !t.sequence || t.sequence.name !== opening.sequence?.name);
  return [opening, phrase('contrast', 4, choose(contrast)), answer(8, 'PAC')];
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

function cellUnit(time: TimeSignature): number {
  return time.compound || time.id === '3/8' ? 6 : 4;
}

function cellsFor(time: TimeSignature): readonly RhythmCell[] {
  return cellUnit(time) === 6 ? COMPOUND_CELLS : SIMPLE_CELLS;
}

/** Keeps long notes aligned with the metre (no minim across the middle of a 4/4 bar). */
function positionOk(c: RhythmCell, pos: number, time: TimeSignature): boolean {
  if (time.compound) return true;
  if (c.units === 2) return pos % 2 === 0 || time.id === '3/4';
  if (c.units === 3) return pos === 0 || (time.id === '4/4' && pos === 1);
  if (c.units === 4) return pos === 0;
  return true;
}

function fillUnits(ctx: Ctx, startPos: number, endPos: number): number[] {
  const { rng, time, spec, style } = ctx;
  const out: number[] = [];
  let pos = startPos;
  while (pos < endPos) {
    const options = cellsFor(time).filter(
      (c) =>
        c.minGrade <= ctx.grade &&
        c.units <= endPos - pos &&
        positionOk(c, pos, time) &&
        c.ticks.every((t) => spec.durations.includes(t)),
    );
    const chosen = rng.weighted(options, (c) => {
      const w = style.cellWeights[c.name] ?? 1;
      return pos === 0 ? w * (style.downbeatWeights?.[c.name] ?? 1) : w;
    });
    out.push(...chosen.ticks);
    pos += chosen.units;
  }
  return out;
}

/** A bar's rhythm. With `split`, a note always starts where the second chord does. */
function barRhythm(ctx: Ctx, minNotes: number, split?: number, cap?: number): number[] {
  const unit = cellUnit(ctx.time);
  const units = ctx.time.barTicks / unit;
  const fill = () =>
    split === undefined ? fillUnits(ctx, 0, units) : [...fillUnits(ctx, 0, split / unit), ...fillUnits(ctx, split / unit, units)];
  // Keep the texture readable: at most three notes per beat on average (plus one).
  const maxNotes = cap ?? units * (ctx.grade <= 2 ? 2 : 3) + (ctx.grade >= 4 ? 1 : 0);
  let best = fill();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (best.length >= minNotes && best.length <= maxNotes) break;
    best = fill();
  }
  return best;
}

/**
 * A cadence bar: a short head followed by a long note that ends the bar.
 * In the final bar, the note before the tonic must fall on a weak position, because it
 * is a step away from the tonic and so is not a tonic-chord tone.
 * With `split` (e.g. ii6–V in one bar), the long note starts on the second chord.
 */
function cadenceRhythm(ctx: Ctx, final: boolean, split?: number): number[] {
  const { rng, time, spec } = ctx;
  const unit = cellUnit(time);
  if (split !== undefined) return [...fillUnits(ctx, 0, split / unit), time.barTicks - split];
  const tails = spec.durations.filter((tail) => {
    const head = time.barTicks - tail;
    if (head < 0 || tail < 4) return false;
    if (time.id === '3/8') return tail === 6 || tail === 4;
    if (tail * 2 < time.barTicks) return false;
    return head % unit === 0;
  });
  const build = (): number[] => {
    const tail = rng.weighted(tails, (t) => (t === time.barTicks ? (final ? 2 : 1) : 3));
    const head = time.barTicks - tail;
    if (head === 0) return [tail];
    if (time.id === '3/8') return [head, tail];
    return [...fillUnits(ctx, 0, head / unit), tail];
  };
  const weakApproach = (r: number[]) => {
    if (r.length < 2) return true;
    const onset = r.slice(0, -2).reduce((a, b) => a + b, 0);
    return !time.strongTicks.includes(onset) && r[r.length - 2] < (time.compound ? 12 : 8);
  };
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = build();
    if (!final || weakApproach(r)) return r;
  }
  return tails.includes(time.barTicks) ? [time.barTicks] : [4, 2, 12];
}

function onsets(rhythm: number[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const d of rhythm) {
    out.push(t);
    t += d;
  }
  return out;
}

function planRhythms(ctx: Ctx, phrases: Phrase[], segments: Segment[][]): number[][] {
  const rhythms: number[][] = [];
  const splitOf = (bar: number) => segments[bar][1]?.at;
  for (const phrase of phrases) {
    const s = phrase.startBar;
    const isLast = phrase === phrases[phrases.length - 1];
    const bars: number[][] = [];
    if (phrase.repeatsOpening) {
      bars[0] = rhythms[0];
      bars[1] = rhythms[1];
    }
    if (phrase.sequence) {
      // The sequence repeats one bar's rhythm (its motif) in each unit. Keep the motif
      // simple — at most two notes a beat — so it is recognisable when it recurs.
      const model = barRhythm(ctx, 3, splitOf(s), 2 * ctx.time.beatsPerBar);
      for (let k = 0; k < phrase.sequence.units; k++) bars[k] = model;
    }
    for (let b = 0; b < 3; b++) {
      if (bars[b]) continue;
      const split = splitOf(s + b);
      // Bar 3 often echoes bar 1's rhythm, which helps the piece sound like it has an idea.
      const echo = b === 2 && ctx.rng.chance(0.55) && (split === undefined || onsets(bars[0]).includes(split));
      bars[b] = echo ? bars[0] : barRhythm(ctx, b === 1 ? 1 : 2, split);
    }
    bars[3] = cadenceRhythm(ctx, isLast, splitOf(s + 3));
    rhythms.push(...bars);
  }
  return rhythms;
}

// ---------------------------------------------------------------------------
// Melody
// ---------------------------------------------------------------------------

interface Slot {
  bar: number;
  onset: number;
  ticks: number;
  chord: Chord;
  /** Must be a chord tone. */
  strong: boolean;
  /** A secondary accent (beat 3 in 4/4): chord tones preferred but passing notes allowed. */
  secondary: boolean;
  /** Position within the phrase, 0..1, for the contour. */
  t: number;
  /** Index of the previous bar's downbeat slot, to avoid parallel octaves with the bass. */
  prevDownbeat?: number;
  fixed?: number;
  /** In a sequence: this note is the model note at `from`, moved `shift` scale degrees. */
  derived?: { from: number; shift: number };
  /** Last note of bar 2 when the opening is repeated later, before a different chord. */
  endsRepeatedOpening?: boolean;
  /** Must be one step from this degree (the note before the final tonic). */
  stepTo?: number;
  /** The phrase's last note, and the cadence it ends. */
  cadence?: Cadence;
}

interface MelodyNote {
  deg: number;
  pitch: Pitch;
  nct: boolean;
}

const LEAP_WEIGHTS = [0.35, 1, 0.7, 0.35, 0.25, 0.15, 0.1, 0.12];

function buildMelody(ctx: Ctx, phrases: Phrase[], segments: Segment[][], rhythms: number[][]): Note[][] {
  const { key, spec, time } = ctx;
  const [lo, hi] = spec.rhRange;
  // Treble stave comfort zone: A3 (two ledger lines below) to A5 (one above).
  const tonicOctave = tonicOctaveFor(key, lo, hi, { letter: 'A', alter: 0, octave: 3 }, { letter: 'A', alter: 0, octave: 5 });
  const minor = key.mode === 'minor';
  const phraseTicks = 4 * time.barTicks;
  const repeats = phrases.some((p) => p.repeatsOpening);

  // Lay out every note slot in the piece.
  const slots: Slot[] = [];
  const barStart: number[] = [];
  const phraseEnd: number[] = [];
  phrases.forEach((phrase) => {
    for (let b = phrase.startBar; b < phrase.startBar + 4; b++) {
      barStart[b] = slots.length;
      onsets(rhythms[b]).forEach((onset, i) => {
        const ticks = rhythms[b][i];
        const isPhraseEnd = b === phrase.startBar + 3 && i === rhythms[b].length - 1;
        // The opening's second bar is reused before a different chord, so it must end on a chord tone.
        const endsRepeatedOpening = repeats && b === 1 && i === rhythms[b].length - 1;
        const longNote = ticks >= (time.compound ? 12 : 8);
        const chordStart = segments[b].some((s) => s.at === onset);
        const strong = chordStart || longNote || isPhraseEnd || endsRepeatedOpening;
        slots.push({
          bar: b,
          onset,
          ticks,
          chord: [...segments[b]].reverse().find((s) => s.at <= onset)!.chord,
          strong,
          endsRepeatedOpening,
          secondary: !strong && time.strongTicks.includes(onset),
          t: ((b - phrase.startBar) * time.barTicks + onset) / phraseTicks,
          prevDownbeat: onset === 0 && b > 0 ? barStart[b - 1] : undefined,
          cadence: isPhraseEnd ? phrase.cadence : undefined,
        });
      });
    }
    phraseEnd.push(slots.length);
  });
  const last = slots.length - 1;
  slots[last].fixed = 0;
  slots[last - 1].stepTo = 0;

  // Sequences: every later unit repeats the model bar's notes, moved by the unit's step.
  const modelSlots: number[] = [];
  /** Model slot → its position in the model bar and the sequence it drives. */
  const modelOf = new Map<number, { j: number; start: number; len: number; units: number; step: number; unitStarts: number[] }>();
  for (const phrase of phrases) {
    if (!phrase.sequence) continue;
    const model = barStart[phrase.startBar];
    for (let k = 1; k < phrase.sequence.units; k++) {
      rhythms[phrase.startBar + k].forEach((_, j) => {
        slots[barStart[phrase.startBar + k] + j].derived = { from: model + j, shift: phrase.sequence!.step * k };
      });
    }
    const len = rhythms[phrase.startBar].length;
    const unitStarts = Array.from({ length: phrase.sequence.units }, (_, k) => barStart[phrase.startBar + k]);
    for (let j = 0; j < len; j++) {
      modelSlots.push(model + j);
      modelOf.set(model + j, { j, start: model, len, units: phrase.sequence.units, step: phrase.sequence.step, unitStarts });
    }
  }

  const spell = (slot: Slot, deg: number): MelodyNote => ({
    deg,
    pitch: degreeToPitch(key, tonicOctave, deg, alterFor(slot.chord, deg)),
    nct: !isChordTone(slot.chord, deg),
  });

  const allowed = (slot: Slot, deg: number): boolean => {
    // In minor, the 7th degree appears raised over V and vii°, and unraised only where
    // it belongs to the chord (v, III, VII).
    if (minor && mod(deg, 7) === 6 && slot.chord.alters[6] === undefined && !allowsNaturalSeventh(slot.chord)) return false;
    return true;
  };

  const notes: MelodyNote[] = [];

  const transitionOk = (p2: MelodyNote | undefined, p1: MelodyNote | undefined, c: MelodyNote, relax: number) => {
    if (!p1) return true;
    const leap = c.deg - p1.deg;
    const size = Math.abs(leap);
    if (size > spec.maxLeap) return false;
    if (relax < 3) {
      if (!isSingableInterval(p1.pitch, c.pitch)) return false;
      // Non-chord tones are approached and left by step.
      if ((p1.nct || c.nct) && size !== 1) return false;
    }
    if (p2) {
      const prevLeap = p1.deg - p2.deg;
      // After a leap of a 5th or more, step back the other way. (After a 4th, the
      // consecutive-leap rule below already stops a further leap the same way.)
      if (relax < 1 && Math.abs(prevLeap) >= 4 && !(size === 1 && Math.sign(leap) === -Math.sign(prevLeap))) {
        return false;
      }
      if (relax < 2) {
        if (size === 0 && prevLeap === 0) return false;
        if (Math.abs(prevLeap) >= 2 && size >= 2 && Math.sign(leap) === Math.sign(prevLeap) && Math.abs(prevLeap) + size > 4) {
          return false;
        }
      }
    }
    return true;
  };

  /** Preferred melody degrees (mod 7) on each kind of cadence's last note. */
  const CADENCE_GOALS: Record<Cadence, Record<number, number>> = {
    HC: { 1: 1.8, 6: 1.8 }, // re or ti over V
    IAC: { 2: 1.3 }, // mi (or sol) over I
    PAC: { 0: 1 },
    PC: { 0: 1.8, 2: 1.3 }, // "A–men": do or mi over I
    DC: { 0: 2.5 }, // the expected tonic, harmonised by vi
  };

  const weight = (slot: Slot, c: MelodyNote, contour: (t: number) => number, p2?: MelodyNote, p1?: MelodyNote) => {
    let w = 1;
    if (p1) {
      const size = Math.abs(c.deg - p1.deg);
      w *= LEAP_WEIGHTS[Math.min(size, LEAP_WEIGHTS.length - 1)];
      if (p2 && size === 1 && Math.abs(p1.deg - p2.deg) === 1 && Math.sign(c.deg - p1.deg) === Math.sign(p1.deg - p2.deg)) {
        w *= 1.5; // keep a scale run going
      }
    }
    w *= Math.exp(-0.45 * Math.abs(c.deg - contour(slot.t)));
    if (slot.strong) {
      const member = mod(c.deg - slot.chord.root, 7);
      w *= member === 0 ? 0.9 : member === 2 ? 1.3 : 1;
      // Avoid doubling the bass root on consecutive downbeats (parallel octaves).
      if (member === 0 && slot.prevDownbeat !== undefined && notes[slot.prevDownbeat]) {
        const prevSlot = slots[slot.prevDownbeat];
        const prev = notes[slot.prevDownbeat];
        if (prevSlot.chord.root !== slot.chord.root && mod(prev.deg - prevSlot.chord.root, 7) === 0) w *= 0.35;
      }
    } else if (slot.secondary) {
      w *= c.nct ? 0.5 : 1.2;
    } else if (!c.nct) {
      w *= 0.85;
    }
    if (slot.cadence) w *= CADENCE_GOALS[slot.cadence][mod(c.deg, 7)] ?? 1;
    return w;
  };

  const fits = (slot: Slot, d: number) =>
    d >= lo &&
    d <= hi &&
    allowed(slot, d) &&
    (!slot.strong || isChordTone(slot.chord, d)) &&
    (slot.stepTo === undefined || Math.abs(d - slot.stepTo) === 1) &&
    // An imperfect authentic cadence ends on mi or sol, not do.
    (slot.cadence !== 'IAC' || [2, 4].includes(mod(d, 7)));

  const candidates = (slot: Slot): MelodyNote[] => {
    if (slot.fixed !== undefined) return [spell(slot, slot.fixed)];
    if (slot.derived) {
      const model = notes[slot.derived.from];
      const d = model ? model.deg + slot.derived.shift : NaN;
      return model && fits(slot, d) ? [spell(slot, d)] : [];
    }
    const out: MelodyNote[] = [];
    for (let d = lo; d <= hi; d++) if (fits(slot, d)) out.push(spell(slot, d));
    return out;
  };

  // Forward checking. complete() answers "can slots i..end-1 be filled after p2, p1 and
  // still lead into `tail`?", memoised, so the main search below never walks into a dead
  // end (for example a repeated opening bar that cannot reach the final cadence). It
  // writes trial notes into `notes` so that sequence copies can read their model notes.
  const repeated = phrases.find((p) => p.repeatsOpening);
  /** First freely generated slot of the repeated phrase, after its copied opening, and its end. */
  const repeatStart = repeated ? barStart[repeated.startBar + 2] : -1;
  const repeatEnd = repeated ? phraseEnd[phrases.indexOf(repeated)] : -1;
  const openingTail = (): MelodyNote[] => [notes[0], notes[1]].filter(Boolean);
  /** Phrase-final slot → the following freshly generated phrase it must be able to lead into. */
  const leadsInto = new Map<number, { from: number; to: number; tail: () => MelodyNote[] }>();
  phrases.forEach((phrase, pi) => {
    const next = phrases[pi + 1];
    if (!next || next.repeatsOpening) return;
    const afterNext = phrases[pi + 2];
    leadsInto.set(phraseEnd[pi] - 1, {
      from: phraseEnd[pi],
      to: phraseEnd[pi + 1],
      tail: afterNext?.repeatsOpening ? openingTail : () => [],
    });
  });

  let relax = 0;
  const memo = new Map<string, boolean>();

  const tailOk = (p2: MelodyNote | undefined, p1: MelodyNote | undefined, tail: MelodyNote[]) =>
    !tail.length ||
    (transitionOk(p2, p1, tail[0], relax) && (tail.length < 2 || transitionOk(p1, tail[0], tail[1], relax)));

  const complete = (i: number, end: number, p2: MelodyNote | undefined, p1: MelodyNote, tail: MelodyNote[]): boolean => {
    if (i === end) return tailOk(p2, p1, tail);
    const models = modelSlots.filter((m) => m < i).map((m) => notes[m]?.deg);
    const memoKey = [i, end, p2?.deg, p1.deg, tail.map((t) => t.deg).join(','), notes[0]?.deg, notes[1]?.deg, models.join(','), relax].join('|');
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    const ok = options(i, p2, p1).some((c) => {
      notes[i] = c;
      return complete(i + 1, end, p1, c, tail);
    });
    memo.set(memoKey, ok);
    return ok;
  };

  /**
   * For a sequence's model note, checks its transposed copies straight away: each must
   * fit its own chord and range, and move from the copy before it as the model does.
   * Without this, a bad model is only found out bars later.
   */
  const copiesWork = (i: number, c: MelodyNote): boolean => {
    const m = modelOf.get(i);
    if (!m) return true;
    const copy = (j: number, k: number, deg: number) => spell(slots[m.unitStarts[k] + j], deg + m.step * k);
    for (let k = 1; k < m.units; k++) {
      if (!fits(slots[m.unitStarts[k] + m.j], c.deg + m.step * k)) return false;
      const cur = copy(m.j, k, c.deg);
      if (m.j >= 1) {
        const prev1 = copy(m.j - 1, k, notes[i - 1].deg);
        const prev2 = m.j >= 2 ? copy(m.j - 2, k, notes[i - 2].deg) : undefined;
        if (!transitionOk(prev2, prev1, cur, relax)) return false;
      }
      if (m.j === m.len - 1) {
        // The join from one unit into the next.
        const last = m.len === 1 ? c : notes[i - 1];
        const endPrev = copy(m.len - 1, k - 1, c.deg);
        const endPrev2 = m.len >= 2 ? copy(m.len - 2, k - 1, last.deg) : undefined;
        const first = copy(0, k, notes[m.start]?.deg ?? c.deg);
        if (!transitionOk(endPrev2, endPrev, first, relax)) return false;
      }
    }
    return true;
  };

  /** Candidates for slot i after p2, p1 that keep the later fixed material reachable. */
  const options = (i: number, p2: MelodyNote | undefined, p1: MelodyNote | undefined): MelodyNote[] => {
    const slot = slots[i];
    const next = leadsInto.get(i);
    return candidates(slot).filter((c) => {
      if (!transitionOk(p2, p1, c, relax)) return false;
      if (!copiesWork(i, c)) return false;
      // The repeat of bar 2 is followed by a different chord and cadence than in the opening.
      if (slot.endsRepeatedOpening && repeatStart >= 0 && !complete(repeatStart, repeatEnd, p1, c, [])) return false;
      // A phrase must be able to lead into the freshly generated phrase after it.
      if (next && !complete(next.from, next.to, p1, c, next.tail())) return false;
      return true;
    });
  };

  /** Weighted random depth-first search over slots [from, to). */
  const fill = (from: number, to: number, contour: (t: number) => number, tail: () => MelodyNote[]) => {
    let budget = 6000;
    const search = (i: number): boolean => {
      if (--budget < 0) return false;
      if (i === to) return tailOk(notes[i - 2], notes[i - 1], tail());
      const slot = slots[i];
      const p1 = notes[i - 1];
      const p2 = notes[i - 2];
      const viable = options(i, p2, p1).filter((c) => {
        if (i < 2) return true; // the opening itself is part of some tails; check once it exists
        notes[i] = c;
        return complete(i + 1, to, p1, c, tail());
      });
      for (const c of ctx.rng.weightedOrder(viable, (c) => weight(slot, c, contour, p2, p1))) {
        notes[i] = c;
        if (search(i + 1)) return true;
      }
      notes.length = i;
      return false;
    };
    // Relax the voice-leading rules only if the strict ones cannot be met.
    for (relax = 0; relax <= 3; relax++) {
      memo.clear();
      for (let attempt = 0; attempt < 3; attempt++) {
        budget = 6000;
        notes.length = from;
        if (search(from)) return;
      }
    }
    throw new Error('Melody search failed');
  };

  const span = hi - lo;
  const at = (fraction: number) => lo + fraction * span;
  const contourFor = (phrase: Phrase): ((t: number) => number) => {
    const rng = ctx.rng;
    const shapes: Record<PhraseKind, [number, number, number, number]> = {
      // start, peak, peak position, end
      single: [at(0.35), at(0.8), 0.5, 0],
      antecedent: [at(0.3), at(0.75), 0.4 + rng.next() * 0.25, at(0.35)],
      contrast: [at(0.5), hi - 0.5, 0.3 + rng.next() * 0.3, at(0.45)],
      consequent: [at(0.3), at(0.9), 0.55 + rng.next() * 0.15, phrase.cadence === 'DC' ? at(0.3) : 0],
      continuation: [at(0.55), at(0.9), 0.3 + rng.next() * 0.2, 0],
    };
    const [start, peak, tp, end] = shapes[phrase.kind];
    return (t) => (t < tp ? start + ((peak - start) * t) / tp : peak + ((end - peak) * (t - tp)) / (1 - tp));
  };

  phrases.forEach((phrase, pi) => {
    let from = barStart[phrase.startBar];
    if (phrase.repeatsOpening) {
      const copyLen = barStart[2] - barStart[0];
      for (let k = 0; k < copyLen; k++) notes[from + k] = notes[k];
      from += copyLen;
    }
    // If the next phrase repeats the opening, this phrase must lead smoothly into it.
    // (For the first phrase the opening is generated during the same search.)
    const leadsIntoOpening = phrases[pi + 1]?.repeatsOpening ?? false;
    fill(from, phraseEnd[pi], contourFor(phrase), leadsIntoOpening ? openingTail : () => []);
  });

  // Convert to Notes, bar by bar.
  return rhythms.map((r, b) =>
    r.map((ticks, i) => {
      const slot = slots[barStart[b] + i];
      const n = notes[barStart[b] + i];
      return {
        pitches: [n.pitch],
        ticks,
        chromatic: slot.chord.chromatic && alterFor(slot.chord, n.deg) !== 0 ? true : undefined,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Left hand
// ---------------------------------------------------------------------------

type LhKind =
  | 'long'
  | 'split'
  | 'dyad'
  | 'dyadSplit'
  | 'alberti'
  | 'broken'
  | 'oompah'
  | 'walking'
  | 'march'
  | 'drone'
  | 'droneSplit'
  | 'droneRhythm';

interface LhEvent {
  /** Degrees relative to the bass note, written for a root-position chord. */
  offs: number[];
  ticks: number;
}

/** Two roughly equal halves of a bar, as representable durations. */
function halves(time: TimeSignature): [number, number] {
  switch (time.id) {
    case '4/4': return [8, 8];
    case '3/4': return [8, 4];
    case '2/4': return [4, 4];
    case '6/8': return [6, 6];
    case '3/8': return [4, 2];
    case '9/8': return [12, 6];
  }
}

/** One long note filling the bar where possible (9/8 needs two). */
function wholeBar(time: TimeSignature): number[] {
  return time.id === '9/8' ? [12, 6] : [time.barTicks];
}

function chooseLhKind(ctx: Ctx, time: TimeSignature): LhKind {
  const { rng, grade, style } = ctx;
  const folk = style.id === 'folk';
  if (grade === 1) return folk ? 'long' : rng.chance(0.75) ? 'long' : 'split';
  if (grade === 2) return folk ? 'drone' : rng.chance(0.5) ? 'long' : 'split';
  if (grade === 3) return folk ? 'droneSplit' : rng.chance(0.5) ? 'dyad' : 'dyadSplit';
  const simpleCrotchet = !time.compound && time.beatTicks === 4;
  switch (style.accompaniment) {
    case 'alberti': return simpleCrotchet ? 'alberti' : 'broken';
    case 'oompah': return time.id === '3/4' ? 'oompah' : simpleCrotchet ? 'alberti' : 'broken';
    case 'walking': return simpleCrotchet ? 'walking' : 'broken';
    case 'march': return 'march';
    case 'drone': return 'droneRhythm';
  }
}

/** The accompaniment pattern for a whole bar with one chord. */
function barEvents(kind: LhKind, time: TimeSignature, rng: Random): LhEvent[] {
  const [h1, h2] = halves(time);
  const repeat = (pattern: LhEvent[], times: number) => Array.from({ length: times }, () => pattern).flat();
  const quavers = (cycle: number[]) =>
    Array.from({ length: time.barTicks / 2 }, (_, i) => ({ offs: [cycle[i % cycle.length]], ticks: 2 }));
  const other = rng.pick([4, 2, -3]);
  switch (kind) {
    case 'long':
      return wholeBar(time).map((ticks, i) => ({ offs: [i === 0 ? 0 : 4], ticks }));
    case 'split':
      return [{ offs: [0], ticks: h1 }, { offs: [other], ticks: h2 }];
    case 'dyad':
      return wholeBar(time).map((ticks) => ({ offs: [0, rng.chance(0.6) ? 4 : 2], ticks }));
    case 'dyadSplit':
      return [{ offs: [0, 4], ticks: h1 }, { offs: rng.pick([[2, 4], [0, 2]]), ticks: h2 }];
    case 'drone':
      return wholeBar(time).map((ticks) => ({ offs: [0, 4], ticks }));
    case 'droneSplit':
      return [{ offs: [0, 4], ticks: h1 }, { offs: [0, 4], ticks: h2 }];
    case 'droneRhythm':
      if (time.compound || time.id === '3/8') {
        return repeat([{ offs: [0, 4], ticks: 4 }, { offs: [0, 4], ticks: 2 }], time.barTicks / 6);
      }
      return repeat([{ offs: [0, 4], ticks: 4 }], time.barTicks / 4);
    case 'alberti':
      return time.id === '3/8' ? quavers([0, 4, 2]) : quavers([0, 4, 2, 4]);
    case 'broken':
      return quavers(time.compound || time.id === '3/8' ? [0, 4, 2] : [0, 2, 4, 2]);
    case 'oompah':
      return [{ offs: [0], ticks: 4 }, { offs: [2, 4], ticks: 4 }, { offs: [2, 4], ticks: 4 }];
    case 'march':
      if (time.compound || time.id === '3/8') {
        return repeat([{ offs: [0], ticks: 4 }, { offs: [2, 4], ticks: 2 }], time.barTicks / 6);
      }
      if (time.id === '4/4') {
        return [{ offs: [0], ticks: 4 }, { offs: [2, 4], ticks: 4 }, { offs: [-3], ticks: 4 }, { offs: [2, 4], ticks: 4 }];
      }
      return [{ offs: [0], ticks: 4 }, ...repeat([{ offs: [2, 4], ticks: 4 }], time.barTicks / 4 - 1)];
    case 'walking':
      // Filled in by walkingBass(); placeholder durations only.
      return repeat([{ offs: [0], ticks: 4 }], time.barTicks / 4);
  }
}

/** The accompaniment pattern for half a bar, when the harmony changes mid-bar (Grade 3+). */
function halfBarEvents(kind: LhKind, ticks: number, time: TimeSignature, rng: Random): LhEvent[] {
  const repeat = (pattern: LhEvent[], times: number) => Array.from({ length: times }, () => pattern).flat();
  const quavers = (cycle: number[]) =>
    Array.from({ length: ticks / 2 }, (_, i) => ({ offs: [cycle[i % cycle.length]], ticks: 2 }));
  // A single beat: bass plus the note a 5th (or, inverted, a 6th) above, so that motions
  // like the 5–6 sequence's are heard.
  if (ticks === time.beatTicks && kind !== 'alberti' && kind !== 'broken') return [{ offs: [0, 4], ticks }];
  switch (kind) {
    case 'alberti':
      return quavers([0, 4, 2, 4]);
    case 'broken':
      return quavers(time.compound ? [0, 4, 2] : [0, 2, 4, 2]);
    case 'oompah':
      return [{ offs: [0], ticks: 4 }, ...repeat([{ offs: [2, 4], ticks: 4 }], ticks / 4 - 1)];
    case 'march':
      if (time.compound) return repeat([{ offs: [0], ticks: 4 }, { offs: [2, 4], ticks: 2 }], ticks / 6);
      return [{ offs: [0], ticks: 4 }, ...repeat([{ offs: [2, 4], ticks: 4 }], ticks / 4 - 1)];
    case 'walking':
      return repeat([{ offs: [0], ticks: 4 }], ticks / 4);
    case 'dyad':
    case 'dyadSplit':
      return [{ offs: [0, rng.chance(0.6) ? 4 : 2], ticks }];
    case 'drone':
    case 'droneSplit':
    case 'droneRhythm':
      return [{ offs: [0, 4], ticks }];
    case 'long':
    case 'split':
      return [{ offs: [0], ticks }];
  }
}

/**
 * Re-voices a root-position offset for the chord's inversion. With the third in the bass,
 * the chord's fifth is a 3rd above the bass and its root a 6th above (or a 3rd below).
 */
function voice(offset: number, inversion: 0 | 1): number {
  if (inversion === 0) return offset;
  if (offset === 4) return 5;
  if (offset === -3) return -2;
  return offset;
}

function buildLeftHand(ctx: Ctx, segmentsByBar: Segment[][]): Note[][] {
  const { key, spec, time, rng, style } = ctx;
  const [lo, hi] = spec.lhRange;
  // Bass stave comfort zone: E2 (one ledger line below) to D4 (two above).
  const tonicOctave = tonicOctaveFor(key, lo, hi, { letter: 'E', alter: 0, octave: 2 }, { letter: 'D', alter: 0, octave: 4 });
  const minor = key.mode === 'minor';
  const n = segmentsByBar.length;
  const kinds = segmentsByBar.map(() => chooseLhKind(ctx, time));
  const drone = (k: LhKind) => k === 'drone' || k === 'droneSplit' || k === 'droneRhythm' || (style.id === 'folk' && k === 'long');

  // Every chord change in the piece, in order.
  const segs = segmentsByBar.flatMap((bar, b) => bar.map((seg) => ({ ...seg, bar: b, kind: kinds[b], whole: bar.length === 1 })));

  const inRange = (d: number) => d >= lo && d <= hi;
  const allowed = (chord: Chord, d: number) =>
    !(minor && mod(d, 7) === 6 && chord.alters[6] === undefined && !allowsNaturalSeventh(chord));
  const spell = (chord: Chord, d: number) => degreeToPitch(key, tonicOctave, d, alterFor(chord, d));
  /** Moves a degree by octaves into range, or null. */
  const fit = (d: number) => {
    let x = d;
    while (x > hi) x -= 7;
    while (x < lo) x += 7;
    return inRange(x) ? x : null;
  };

  // The bass line first (moving as little as possible), then each pattern, which may need
  // to know where the next bass note lies.
  /** Possible bass notes for a chord change, each with a cost if its pattern would not fit above it. */
  const optionsFor = (seg: (typeof segs)[number]): { d: number; cost: number }[] => {
    const base = seg.bar === n - 1 ? 0 : drone(seg.kind) ? (seg.chord.base === 'V' ? 4 : 0) : bassDegree(seg.chord);
    const span = seg.kind === 'long' || seg.kind === 'split' ? 0 : seg.chord.inversion ? 5 : 4;
    const options: { d: number; cost: number }[] = [];
    for (let k = -3; k <= 3; k++) {
      const d = base + 7 * k;
      if (inRange(d)) options.push({ d, cost: d + span <= hi ? 0 : 1.5 });
    }
    return options;
  };
  // Choose the whole bass line at once (dynamic programming), so that no leap between
  // chords exceeds the grade's limit where that can be avoided, and the line moves little.
  const choices = segs.map(optionsFor);
  const leapCost = (a: number, b: number) => {
    const leap = Math.abs(a - b);
    // Steps are cheap, big leaps much dearer, and leaps beyond the grade's limit a last resort.
    return leap + 0.5 * Math.max(0, leap - 2) ** 2 + (leap > spec.maxBassLeap ? 100 : 0);
  };
  let costs = choices[0].map((o) => o.cost + Math.abs(o.d) * 0.1);
  const back: number[][] = [];
  for (let i = 1; i < segs.length; i++) {
    const prev = choices[i - 1];
    const prevCosts = costs;
    back[i] = [];
    costs = choices[i].map((o, j) => {
      let best = Infinity;
      prev.forEach((p, k) => {
        const c = prevCosts[k] + leapCost(p.d, o.d) + o.cost;
        if (c < best) {
          best = c;
          back[i][j] = k;
        }
      });
      return best;
    });
  }
  const basses: number[] = [];
  let pick = costs.indexOf(Math.min(...costs));
  for (let i = segs.length - 1; i >= 0; i--) {
    basses[i] = choices[i][pick].d;
    if (i > 0) pick = back[i][pick];
  }

  /** Crotchet bass line: bass, chord tones heading towards the next bass, then a step into it. */
  const walkingBass = (i: number, beats: number): number[] => {
    const chord = segs[i].chord;
    const r = basses[i];
    const target = basses[i + 1] ?? r;
    if (beats === 1) return [r];
    // Approach the next bass note by step from the side we are coming from.
    const sides = r <= target ? [target - 1, target + 1] : [target + 1, target - 1];
    const approach = sides.find((d) => inRange(d) && allowed(chord, d) && d !== r) ?? r;
    const tones = chordTones(chord);
    const seq = [r];
    for (let b = 1; b < beats - 1; b++) {
      const aim = r + ((approach - r) * b) / (beats - 1);
      const options: number[] = [];
      for (let d = lo; d <= hi; d++) {
        if (d !== seq[b - 1] && tones.includes(mod(d, 7)) && Math.abs(d - seq[b - 1]) <= 4) options.push(d);
      }
      const best = Math.min(...options.map((d) => Math.abs(d - aim)));
      const near = options.filter((d) => Math.abs(d - aim) <= best + 1);
      seq.push(near.length ? rng.pick(near) : seq[b - 1]);
    }
    seq.push(approach);
    return seq;
  };

  const bars: Note[][] = segmentsByBar.map(() => []);
  segs.forEach((seg, i) => {
    const chord = seg.chord;
    const r = basses[i];
    const nextBass = basses[i + 1] ?? r;
    const note = (ds: number[], ticks: number): Note =>
      ds.length
        ? {
            pitches: ds.map((d) => spell(chord, d)).sort((a, b) => diatonicIndex(a) - diatonicIndex(b)),
            ticks,
            chromatic: chord.chromatic && ds.some((d) => alterFor(chord, d) !== 0) ? true : undefined,
          }
        : { pitches: [], ticks, rest: true };

    if (seg.bar === n - 1) {
      // Final bar: the tonic, held (with its fifth in folk style).
      const tonic = style.id === 'folk' && ctx.grade >= 2 ? [r, r + 4].filter(inRange) : [r];
      wholeBar(time).forEach((ticks, k) => bars[seg.bar].push(note(k === 0 ? tonic : [], ticks)));
      return;
    }
    if (seg.kind === 'walking') {
      for (const d of walkingBass(i, seg.ticks / 4)) bars[seg.bar].push(note([d], 4));
      return;
    }
    const events = seg.whole ? barEvents(seg.kind, time, rng) : halfBarEvents(seg.kind, seg.ticks, time, rng);
    const realised: number[][] = [];
    events.forEach((e, k) => {
      // Notes above the bass stay above it (dropped if out of range), so inversions survive;
      // notes below it (an alternating bass) may move by octaves into range.
      const ds = e.offs
        .map((o) => voice(o, chord.inversion))
        .map((o) => (o === 0 ? r : o > 0 ? (r + o <= hi ? r + o : null) : fit(r + o)))
        .filter((d): d is number => d !== null && allowed(chord, d));
      let notes = [...new Set(ds)].sort((a, b) => a - b);
      if (!notes.length) notes = [r];
      // Octave-shifting into range can create a jump, within the pattern or into the next
      // bass note; move the whole shape an octave, or fall back to the bass note.
      if (k > 0) {
        const prevLow = realised[k - 1][0];
        const isLast = k === events.length - 1;
        const ok = (ns: number[]) =>
          ns.every(inRange) &&
          Math.abs(ns[0] - prevLow) <= spec.maxBassLeap &&
          (!isLast || Math.abs(nextBass - ns[0]) <= spec.maxBassLeap);
        notes = [notes, notes.map((d) => d + 7), notes.map((d) => d - 7), [r]].find(ok) ?? [r];
      }
      realised.push(notes);
      bars[seg.bar].push(note(notes, e.ticks));
    });
  });
  return bars;
}
