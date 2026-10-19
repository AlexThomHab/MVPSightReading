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
  alterFor,
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

export interface Bar {
  /** Roman numeral of the bar's harmony. */
  chord: string;
  rh: Note[];
  lh: Note[];
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

  const phrases = planPhrases(rng, barCount, key.mode, spec, style);
  const chordSymbols = phrases.flatMap((p) => p.chords);
  const chords = chordSymbols.map((s) => chordFor(s, key.mode));

  const ctx: Ctx = { rng, spec, style, key, time, grade };
  const rhythms = planRhythms(ctx, phrases);
  const rh = buildMelody(ctx, phrases, chords, rhythms);
  const lh = buildLeftHand(ctx, chords);

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
    bars: chordSymbols.map((chord, i) => ({ chord, rh: rh[i], lh: lh[i] })),
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
// Harmony: 4-bar phrases with cadences
// ---------------------------------------------------------------------------

type PhraseKind = 'single' | 'antecedent' | 'contrast' | 'consequent';

interface Phrase {
  kind: PhraseKind;
  startBar: number;
  chords: string[];
  /** The phrase opens with an exact repeat of the piece's first two bars. */
  repeatsOpening: boolean;
}

interface PlanOption {
  chords: string[];
  weight: number;
  needs?: string[];
}

const PLANS: Record<'single' | 'antecedent' | 'contrast', Record<Mode, PlanOption[]>> = {
  single: {
    major: [
      { chords: ['I', 'IV', 'V', 'I'], weight: 3 },
      { chords: ['I', 'V', 'V', 'I'], weight: 1 },
      { chords: ['I', 'I', 'V', 'I'], weight: 1 },
    ],
    minor: [
      { chords: ['i', 'iv', 'V', 'i'], weight: 3 },
      { chords: ['i', 'V', 'V', 'i'], weight: 1 },
      { chords: ['i', 'i', 'V', 'i'], weight: 1 },
    ],
  },
  // Ends on a half cadence (V).
  antecedent: {
    major: [
      { chords: ['I', 'IV', 'V', 'V'], weight: 3 },
      { chords: ['I', 'IV', 'I', 'V'], weight: 3 },
      { chords: ['I', 'V', 'I', 'V'], weight: 2 },
      { chords: ['I', 'vi', 'IV', 'V'], weight: 2, needs: ['vi'] },
      { chords: ['I', 'IV', 'ii', 'V'], weight: 1.5, needs: ['ii'] },
      { chords: ['I', 'IV', 'V/V', 'V'], weight: 1.5, needs: ['V/V'] },
    ],
    minor: [
      { chords: ['i', 'iv', 'V', 'V'], weight: 3 },
      { chords: ['i', 'iv', 'i', 'V'], weight: 3 },
      { chords: ['i', 'V', 'i', 'V'], weight: 2 },
      { chords: ['i', 'VI', 'iv', 'V'], weight: 2, needs: ['VI'] },
    ],
  },
  // Middle phrase of a 12-bar piece: moves away from the tonic, ends on V.
  contrast: {
    major: [
      { chords: ['IV', 'I', 'IV', 'V'], weight: 2 },
      { chords: ['IV', 'V', 'I', 'V'], weight: 2 },
      { chords: ['vi', 'IV', 'V', 'V'], weight: 2, needs: ['vi'] },
      { chords: ['vi', 'ii', 'V', 'V'], weight: 1, needs: ['vi', 'ii'] },
      { chords: ['IV', 'I', 'V/V', 'V'], weight: 1.5, needs: ['V/V'] },
    ],
    minor: [
      { chords: ['iv', 'i', 'iv', 'V'], weight: 2 },
      { chords: ['iv', 'V', 'i', 'V'], weight: 2 },
      { chords: ['VI', 'iv', 'V', 'V'], weight: 2, needs: ['VI'] },
    ],
  },
};

const MODE_CHORDS: Record<Mode, string[]> = { major: ['ii', 'vi', 'V/V'], minor: ['VI'] };

function choosePlan(rng: Random, options: PlanOption[], available: string[]): string[] {
  const usable = options.filter((o) => (o.needs ?? []).every((n) => available.includes(n)));
  return [...rng.weighted(usable, (o) => o.weight).chords];
}

function planPhrases(rng: Random, barCount: number, mode: Mode, spec: GradeSpec, style: StyleSpec): Phrase[] {
  const available = spec.extraChords.filter(
    (c) => style.extraChords.includes(c) && MODE_CHORDS[mode].includes(c),
  );
  if (barCount === 4) {
    return [{ kind: 'single', startBar: 0, chords: choosePlan(rng, PLANS.single[mode], available), repeatsOpening: false }];
  }
  const antecedent = choosePlan(rng, PLANS.antecedent[mode], available);
  // Parallel period: the answering phrase repeats the opening two bars, then cadences V–I.
  const consequent = [antecedent[0], antecedent[1], 'V', tonicSymbol(mode)];
  const phrases: Phrase[] = [{ kind: 'antecedent', startBar: 0, chords: antecedent, repeatsOpening: false }];
  if (barCount === 12) {
    phrases.push({ kind: 'contrast', startBar: 4, chords: choosePlan(rng, PLANS.contrast[mode], available), repeatsOpening: false });
  }
  phrases.push({ kind: 'consequent', startBar: barCount - 4, chords: consequent, repeatsOpening: true });
  return phrases;
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

function barRhythm(ctx: Ctx, minNotes: number): number[] {
  const units = ctx.time.barTicks / cellUnit(ctx.time);
  // Keep the texture readable: at most three notes per beat on average (plus one).
  const maxNotes = units * (ctx.grade <= 2 ? 2 : 3) + (ctx.grade >= 4 ? 1 : 0);
  let best = fillUnits(ctx, 0, units);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (best.length >= minNotes && best.length <= maxNotes) break;
    best = fillUnits(ctx, 0, units);
  }
  return best;
}

/**
 * A cadence bar: a short head followed by a long note that ends the bar.
 * In the final bar, the note before the tonic must fall on a weak position, because it
 * is a step away from the tonic and so is not a tonic-chord tone.
 */
function cadenceRhythm(ctx: Ctx, final: boolean): number[] {
  const { rng, time, spec } = ctx;
  const unit = cellUnit(time);
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

function planRhythms(ctx: Ctx, phrases: Phrase[]): number[][] {
  const rhythms: number[][] = [];
  for (const phrase of phrases) {
    const isLast = phrase === phrases[phrases.length - 1];
    let r1: number[];
    let r2: number[];
    if (phrase.repeatsOpening) {
      r1 = rhythms[0];
      r2 = rhythms[1];
    } else {
      r1 = barRhythm(ctx, 2);
      r2 = barRhythm(ctx, 1);
    }
    // Bar 3 often echoes bar 1's rhythm, which helps the piece sound like it has an idea.
    const r3 = ctx.rng.chance(0.55) ? r1 : barRhythm(ctx, 2);
    rhythms.push(r1, r2, r3, cadenceRhythm(ctx, isLast));
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
  /** Last note of bar 2 when the opening is repeated later, before a different chord. */
  endsRepeatedOpening?: boolean;
  /** Must be one step from this degree (the note before the final tonic). */
  stepTo?: number;
  halfCadence?: boolean;
}

interface MelodyNote {
  deg: number;
  pitch: Pitch;
  nct: boolean;
}

const LEAP_WEIGHTS = [0.35, 1, 0.7, 0.35, 0.25, 0.15, 0.1, 0.12];

function buildMelody(ctx: Ctx, phrases: Phrase[], chords: Chord[], rhythms: number[][]): Note[][] {
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
  phrases.forEach((phrase) => {
    for (let b = phrase.startBar; b < phrase.startBar + 4; b++) {
      barStart[b] = slots.length;
      let onset = 0;
      rhythms[b].forEach((ticks, i) => {
        const isPhraseEnd = b === phrase.startBar + 3 && i === rhythms[b].length - 1;
        // The opening's second bar is reused before a different chord, so it must end on a chord tone.
        const endsRepeatedOpening = repeats && b === 1 && i === rhythms[b].length - 1;
        const longNote = ticks >= (time.compound ? 12 : 8);
        slots.push({
          bar: b,
          onset,
          ticks,
          chord: chords[b],
          strong: onset === 0 || longNote || isPhraseEnd || endsRepeatedOpening,
          endsRepeatedOpening,
          secondary: onset !== 0 && time.strongTicks.includes(onset),
          t: ((b - phrase.startBar) * time.barTicks + onset) / phraseTicks,
          prevDownbeat: onset === 0 && b > 0 ? barStart[b - 1] : undefined,
          halfCadence: isPhraseEnd && phrase.kind !== 'consequent' && phrase.kind !== 'single',
        });
        onset += ticks;
      });
    }
  });
  const last = slots.length - 1;
  slots[last].fixed = 0;
  slots[last - 1].stepTo = 0;

  const spell = (slot: Slot, deg: number): MelodyNote => ({
    deg,
    pitch: degreeToPitch(key, tonicOctave, deg, alterFor(slot.chord, deg)),
    nct: !isChordTone(slot.chord, deg),
  });

  const allowed = (slot: Slot, deg: number): boolean => {
    // In minor, the 7th degree only appears raised, over V.
    if (minor && mod(deg, 7) === 6 && slot.chord.alters[6] === undefined) return false;
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
    if (slot.halfCadence) {
      const d = mod(c.deg, 7);
      if (d === 1 || d === 6) w *= 1.8;
    }
    return w;
  };

  const candidates = (slot: Slot): MelodyNote[] => {
    if (slot.fixed !== undefined) return [spell(slot, slot.fixed)];
    const out: MelodyNote[] = [];
    for (let d = lo; d <= hi; d++) {
      if (!allowed(slot, d)) continue;
      if (slot.strong && !isChordTone(slot.chord, d)) continue;
      if (slot.stepTo !== undefined && Math.abs(d - slot.stepTo) !== 1) continue;
      out.push(spell(slot, d));
    }
    return out;
  };

  // Forward checking. complete() answers "can slots i..end-1 be filled after p2, p1 and
  // still lead into `tail`?", memoised, so the main search below never walks into a dead
  // end (for example a repeated opening bar that cannot reach the final cadence).
  const lastPhrase = phrases[phrases.length - 1];
  /** First freely generated slot of the final phrase, after its repeated opening. */
  const repeatStart = lastPhrase.repeatsOpening ? barStart[lastPhrase.startBar + 2] : -1;
  const contrast = phrases.find((p) => p.kind === 'contrast');
  const contrastFrom = contrast ? barStart[contrast.startBar] : -1;
  const contrastTo = contrast ? barStart[contrast.startBar + 4] : -1;
  const openingTail = (): MelodyNote[] => [notes[0], notes[1]].filter(Boolean);

  let relax = 0;
  const memo = new Map<string, boolean>();

  const tailOk = (p2: MelodyNote | undefined, p1: MelodyNote | undefined, tail: MelodyNote[]) =>
    !tail.length ||
    (transitionOk(p2, p1, tail[0], relax) && (tail.length < 2 || transitionOk(p1, tail[0], tail[1], relax)));

  const complete = (i: number, end: number, p2: MelodyNote | undefined, p1: MelodyNote, tail: MelodyNote[]): boolean => {
    if (i === end) return tailOk(p2, p1, tail);
    const memoKey = [i, end, p2?.deg, p1.deg, tail.map((t) => t.deg).join(','), notes[0]?.deg, notes[1]?.deg, relax].join('|');
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    const ok = options(i, p2, p1).some((c) => complete(i + 1, end, p1, c, tail));
    memo.set(memoKey, ok);
    return ok;
  };

  /** Candidates for slot i after p2, p1 that keep the later fixed material reachable. */
  const options = (i: number, p2: MelodyNote | undefined, p1: MelodyNote | undefined): MelodyNote[] => {
    const slot = slots[i];
    return candidates(slot).filter((c) => {
      if (!transitionOk(p2, p1, c, relax)) return false;
      // The repeat of bar 2 is followed by V and the final cadence, not by the opening's bar 3.
      if (slot.endsRepeatedOpening && repeatStart >= 0 && !complete(repeatStart, slots.length, p1, c, [])) return false;
      // The first phrase must be able to lead into the contrasting middle phrase.
      if (i === contrastFrom - 1 && !complete(contrastFrom, contrastTo, p1, c, openingTail())) return false;
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
  const contourFor = (kind: PhraseKind): ((t: number) => number) => {
    const rng = ctx.rng;
    const shapes: Record<PhraseKind, [number, number, number, number]> = {
      // start, peak, peak position, end
      single: [at(0.35), at(0.8), 0.5, 0],
      antecedent: [at(0.3), at(0.75), 0.4 + rng.next() * 0.25, at(0.35)],
      contrast: [at(0.5), hi - 0.5, 0.3 + rng.next() * 0.3, at(0.45)],
      consequent: [at(0.3), at(0.9), 0.55 + rng.next() * 0.15, 0],
    };
    const [start, peak, tp, end] = shapes[kind];
    return (t) => (t < tp ? start + ((peak - start) * t) / tp : peak + ((end - peak) * (t - tp)) / (1 - tp));
  };

  phrases.forEach((phrase, pi) => {
    let from = barStart[phrase.startBar];
    const to = pi + 1 < phrases.length ? barStart[phrases[pi + 1].startBar] : slots.length;
    if (phrase.repeatsOpening) {
      const copyLen = barStart[2] - barStart[0];
      for (let k = 0; k < copyLen; k++) notes[from + k] = notes[k];
      from += copyLen;
    }
    // If the next phrase repeats the opening, this phrase must lead smoothly into it.
    // (For the first phrase the opening is generated during the same search.)
    const leadsIntoOpening = phrases[pi + 1]?.repeatsOpening ?? false;
    fill(from, to, contourFor(phrase.kind), leadsIntoOpening ? openingTail : () => []);
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
  /** Degrees relative to the bar's bass root. */
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

function lhEvents(kind: LhKind, time: TimeSignature, rng: Random): LhEvent[] {
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

function buildLeftHand(ctx: Ctx, chords: Chord[]): Note[][] {
  const { key, spec, time, rng, style } = ctx;
  const [lo, hi] = spec.lhRange;
  // Bass stave comfort zone: E2 (one ledger line below) to D4 (two above).
  const tonicOctave = tonicOctaveFor(key, lo, hi, { letter: 'E', alter: 0, octave: 2 }, { letter: 'D', alter: 0, octave: 4 });
  const minor = key.mode === 'minor';
  const n = chords.length;
  const kinds = chords.map(() => chooseLhKind(ctx, time));
  const drone = (k: LhKind) => k === 'drone' || k === 'droneSplit' || k === 'droneRhythm' || (style.id === 'folk' && k === 'long');

  const inRange = (d: number) => d >= lo && d <= hi;
  const allowed = (chord: Chord, d: number) => !(minor && mod(d, 7) === 6 && chord.alters[6] === undefined);
  const spell = (chord: Chord, d: number) => degreeToPitch(key, tonicOctave, d, alterFor(chord, d));
  /** Moves a degree by octaves into range, or null. */
  const fit = (d: number) => {
    let x = d;
    while (x > hi) x -= 7;
    while (x < lo) x += 7;
    return inRange(x) ? x : null;
  };

  const roots: number[] = [];
  const bars: number[][][] = []; // per bar: list of chords as absolute degrees
  const durations: number[][] = [];

  const chooseRoot = (i: number, ref: number | undefined): number => {
    const chord = chords[i];
    const final = i === n - 1;
    const base = final ? 0 : drone(kinds[i]) ? (chord.symbol === 'V' ? 4 : 0) : chord.root;
    const span = kinds[i] === 'long' || kinds[i] === 'split' ? 0 : 4;
    const options: number[] = [];
    for (let k = -2; k <= 2; k++) {
      const d = base + 7 * k;
      if (d >= lo && d + span <= hi) options.push(d);
    }
    if (!options.length) for (let k = -2; k <= 2; k++) if (inRange(base + 7 * k)) options.push(base + 7 * k);
    if (ref === undefined) return options.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b));
    const within = options.filter((d) => Math.abs(d - ref) <= spec.maxBassLeap);
    const pool = within.length ? within : options;
    return pool.reduce((a, b) => (Math.abs(a - ref) <= Math.abs(b - ref) ? a : b));
  };

  const realise = (i: number) => {
    const chord = chords[i];
    const r = roots[i];
    const nextRoot = roots[i + 1] ?? r;
    if (i === n - 1) {
      // Final bar: the tonic, held (with its fifth in folk style).
      const tonic = style.id === 'folk' && ctx.grade >= 2 ? [r, r + 4].filter(inRange) : [r];
      bars[i] = wholeBar(time).map((_, k) => (k === 0 ? tonic : []));
      durations[i] = wholeBar(time);
      return;
    }
    if (kinds[i] === 'walking') {
      bars[i] = walkingBass(i).map((d) => [d]);
      durations[i] = bars[i].map(() => 4);
      return;
    }
    const events = lhEvents(kinds[i], time, rng);
    const realised: number[][] = [];
    events.forEach((e, k) => {
      const ds = e.offs
        .map((o) => (k === 0 && o === 0 ? r : fit(r + o)))
        .filter((d): d is number => d !== null && allowed(chord, d));
      let notes = [...new Set(ds)].sort((a, b) => a - b);
      if (!notes.length) notes = [r];
      // Octave-shifting into range can create a jump, within the bar or into the next
      // bar's root; move the whole shape an octave, or fall back to the root.
      if (k > 0) {
        const prevLow = realised[k - 1][0];
        const isLast = k === events.length - 1;
        const fits = (ns: number[]) =>
          ns.every(inRange) &&
          Math.abs(ns[0] - prevLow) <= spec.maxBassLeap &&
          (!isLast || Math.abs(nextRoot - ns[0]) <= spec.maxBassLeap);
        notes = [notes, notes.map((d) => d + 7), notes.map((d) => d - 7), [r]].find(fits) ?? [r];
      }
      realised.push(notes);
    });
    bars[i] = realised;
    durations[i] = events.map((e) => e.ticks);
  };

  /** Crotchet bass line: root, chord tones heading towards the next root, then a step into it. */
  const walkingBass = (i: number): number[] => {
    const chord = chords[i];
    const beats = time.barTicks / 4;
    const r = roots[i];
    const target = roots[i + 1] ?? r;
    // Approach the next root by step from the side we are coming from.
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

  // The bass line first (roots move as little as possible), then each bar's pattern,
  // which may need to know where the next bar's root lies.
  for (let i = 0; i < n; i++) roots[i] = chooseRoot(i, roots[i - 1]);
  for (let i = 0; i < n; i++) realise(i);

  return bars.map((events, i) =>
    events.map((ds, k) => {
      if (!ds.length) return { pitches: [], ticks: durations[i][k], rest: true };
      const chord = chords[i];
      return {
        pitches: ds.map((d) => spell(chord, d)).sort((a, b) => diatonicIndex(a) - diatonicIndex(b)),
        ticks: durations[i][k],
        chromatic: chord.chromatic && ds.some((d) => alterFor(chord, d) !== 0) ? true : undefined,
      };
    }),
  );
}
