/**
 * The Classical / Galant era's generator (Minuet, Trio, Waltz, Polonaise, Gavotte): schemata →
 * harmony → rhythm → melody → left hand → Piece.
 *
 * Each phrase is a chain of galant schemata (see below), which fix both the bass line (as
 * chords) and the melody's notes over them; the melody search fills in everything between.
 * The form brings its own rhythm, accompaniment, articulation and (the Gavotte) an upbeat.
 *
 * Pure TypeScript with no Angular dependencies. Fully deterministic: the same settings
 * (including the seed) always produce the same piece.
 */
import {
  Grade,
  GradeSpec,
  TIME_SIGNATURES,
  TimeSignature,
  TimeSignatureId,
  lengthsFor,
} from './grades';
import type { Bar, Cadence, Harmony, Note, Piece, SequenceName, Settings, Tempo } from './model';
import { Random } from './random';
import { GenerationConstraints, constraintsOf, effectiveSpec, melodicIntervalAllowed, pitchWindow } from './constraints';
import { GALANT_FORMS, GalantFormSpec, isGalantForm } from './galant-forms';
import { cellUnit, fillWithCells, harmonySplit, rhythmPreferences } from './rhythm';
import { formTimes } from './forms';
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
  keyName,
  mod,
  tonicSymbol,
} from './theory';
import { snapTicks, splitTicks, starts } from './durations';

export function generateGalant(settings: Settings): Piece {
  const { seed, grade, form: formId } = settings;
  if (!isGalantForm(formId)) throw new Error(`${formId} is not a galant form`);
  const cons = constraintsOf(settings);
  const spec = effectiveSpec(grade, cons);
  const style = GALANT_FORMS[formId];
  const rng = new Random(`${seed}|g${grade}|${formId}|${settings.keyId ?? ''}|${settings.timeId ?? ''}`);

  const key = chooseKey(rng, spec, settings.keyId);
  const time = TIME_SIGNATURES[settings.timeId ?? chooseTime(rng, formTimes(formId, spec.times))];
  // Four-bar phrases, as many as the grade's length asks for.
  const barCount = rng.pick(lengthsFor(spec, 4));

  const ctx: Ctx = { rng, spec, style, key, time, grade, cons };
  const phrases = planPhrases(ctx, barCount);
  const segments = phrases.flatMap((p) => p.harmony).map((bar) => toSegments(bar, time, key.mode));
  const rhythms = planRhythms(ctx, phrases, segments);
  const rh = buildMelody(ctx, phrases, segments, rhythms);
  const lh = buildLeftHand(ctx, segments);
  articulate(ctx, rh);

  const bars: Bar[] = segments.map((segs, i) => ({
    harmony: segs.map((s): Harmony => ({ symbol: s.pedal ? `${s.chord.symbol} (pedal)` : s.chord.symbol, at: s.at, melody: s.goal === undefined ? undefined : s.goal + 1 })),
    rh: rh[i],
    lh: lh[i],
  }));
  const upbeat = style.upbeat ? time.barTicks / 2 : undefined;

  return {
    title: `${style.titleWord} in ${keyName(key)}`,
    seed,
    grade,
    form: formId,
    key,
    mode: key.mode,
    time,
    tempo: chooseTempo(rng, grade, style, time),
    dynamic: style.dynamic,
    bars: upbeat ? withUpbeat(bars, time, upbeat) : bars,
    ...(upbeat ? { upbeat } : {}),
    phrases: phrases.map(({ startBar, cadence, sequence, repeatsOpening, schemas }) => ({
      startBar,
      bars: 4,
      cadence,
      sequence: sequence?.name,
      repeatsOpening,
      schemas,
    })),
  };
}

interface Ctx {
  rng: Random;
  spec: GradeSpec;
  style: GalantFormSpec;
  key: Key;
  time: TimeSignature;
  grade: Grade;
  /** The user's customisation, resolved (null: the grade decides). */
  cons: GenerationConstraints | null;
}

/** A stretch of a bar with one chord. */
interface Segment {
  chord: Chord;
  /** Ticks from the start of the bar. */
  at: number;
  ticks: number;
  /** The melody's schema note (0-based scale degree) where this chord begins. */
  goal?: number;
  /** Over a tonic pedal. */
  pedal?: boolean;
}

function toSegments(bar: PlannedChord[], time: TimeSignature, mode: Mode): Segment[] {
  const seg = (c: PlannedChord, at: number, ticks: number): Segment => ({ chord: chordFor(c.symbol, mode), at, ticks, goal: c.goal, pedal: c.pedal });
  if (bar.length === 1) return [seg(bar[0], 0, time.barTicks)];
  const split = harmonySplit(time)!;
  return [seg(bar[0], 0, split), seg(bar[1], split, time.barTicks - split)];
}

// ---------------------------------------------------------------------------
// Key, time, tempo
// ---------------------------------------------------------------------------

function chooseKey(rng: Random, spec: GradeSpec, keyId?: string): Key {
  const chosen = keyId ? KEYS.find((k) => k.id === keyId) : undefined;
  return chosen ?? rng.pick(KEYS.filter((k) => spec.keys.includes(k.id)));
}

/** The form's most typical metre is the likeliest. */
function chooseTime(rng: Random, metres: readonly TimeSignatureId[]): TimeSignatureId {
  return rng.weighted(metres, (t) => (t === metres[0] ? 2 : 1));
}

function chooseTempo(rng: Random, grade: Grade, style: GalantFormSpec, time: TimeSignature): Tempo {
  const [slow, fast] = style.crotchetBpm;
  const crotchet = slow + ((fast - slow) * (grade - 1)) / 7 + rng.int(-4, 4);
  const even = (n: number) => Math.round(n / 2) * 2;
  const marking = style.tempoMarking;
  if (time.compound) return { bpm: even(crotchet * 0.58), beatUnit: 'qd', marking };
  if (time.id === '3/8') return { bpm: even(crotchet * 1.5), beatUnit: '8', marking };
  return { bpm: even(crotchet), beatUnit: 'q', marking };
}

// ---------------------------------------------------------------------------
// The form's character: articulation, and the Gavotte's upbeat
// ---------------------------------------------------------------------------

/**
 * A Gavotte's crotchets are detached (staccato on the weak beats, Grade 2+); a Polonaise
 * accents its first beat (Grade 3+). Cadence bars and the final bar are left plain.
 */
function articulate(ctx: Ctx, rh: Note[][]): void {
  const { style, grade, time } = ctx;
  rh.forEach((bar, b) => {
    if (b === rh.length - 1) return;
    starts(bar.map((n) => n.ticks)).forEach((at, i) => {
      const n = bar[i];
      if (n.rest || n.articulation) return;
      // (Not in a phrase's cadence bar, nor on a note tied over.)
      if (style.articulation === 'detached' && grade >= 2 && n.ticks === 4 && !time.strongTicks.includes(at) && b % 4 !== 3 && !n.tie) n.articulation = 'staccato';
      if (style.articulation === 'accented' && grade >= 3 && at === 0 && b % 2 === 0) n.articulation = 'accent';
    });
  });
}

/**
 * Re-bars the piece to begin with an upbeat of `upbeat` ticks: every bar line moves that much
 * later, so the first bar holds the upbeat, each phrase (and each cadence) falls in the middle
 * of a bar, and the last bar holds the rest. Notes across a moved bar line are split and tied.
 */
function withUpbeat(bars: Bar[], time: TimeSignature, upbeat: number): Bar[] {
  const B = time.barTicks;
  const total = bars.length * B;
  /** New bar of an absolute tick, and the tick within it. */
  const place = (t: number): [number, number] => (t < upbeat ? [0, t] : [Math.floor((t - upbeat) / B) + 1, (t - upbeat) % B]);
  const bounds = (k: number): [number, number] => (k === 0 ? [0, upbeat] : [upbeat + (k - 1) * B, Math.min(total, upbeat + k * B)]);
  const count = place(total - 1)[0] + 1;
  const out: Bar[] = Array.from({ length: count }, () => ({ harmony: [], rh: [], lh: [] }));
  for (const hand of ['rh', 'lh'] as const) {
    let t = 0;
    bars.forEach((bar) =>
      bar[hand].forEach((n) => {
        let at = t;
        const end = snapTicks(t + n.ticks);
        while (at < end) {
          const [k] = place(at);
          const piece = snapTicks(Math.min(end, bounds(k)[1]) - at);
          if (piece <= 0) throw new Error('A bar is longer than its time signature');
          // (A note that is not split keeps its length — a triplet quaver has no single value of its own.)
          const parts = Math.abs(piece - n.ticks) < 1e-6 ? [n.ticks] : splitTicks(piece);
          parts.forEach((ticks, j) => {
            const last = at + piece >= end && j === parts.length - 1;
            out[k][hand].push(n.rest ? { pitches: [], ticks, rest: true } : { ...n, pitches: n.pitches.map((p) => ({ ...p })), ticks, tie: last ? n.tie : true });
          });
          at = snapTicks(at + piece);
        }
        t = end;
      }),
    );
  }
  bars.forEach((bar, i) =>
    bar.harmony.forEach((h) => {
      const [k, at] = place(i * B + h.at);
      out[k].harmony.push({ ...h, at });
    }),
  );
  // Each new bar sounds the harmony carried over from the one before, if none starts on its first beat.
  out.forEach((bar, k) => {
    if (k > 0 && !bar.harmony.some((h) => h.at === 0)) {
      const carried = out[k - 1].harmony[out[k - 1].harmony.length - 1];
      if (carried) bar.harmony.unshift({ ...carried, at: 0, melody: undefined });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Harmony: phrases built from galant schemata
// ---------------------------------------------------------------------------
//
// Galant composers built phrases from stock patterns — schemata — each a bass line with a
// melody line above it (Gjerdingen, Music in the Galant Style). Here every phrase is a chain
// of schemata, written as chords with the melody's scale degree over each (`IV:6` is IV with
// la on top), and the melody search below must put exactly those notes there. The schemata:
//   Do–Re–Mi     melody 1–2–3 over bass 1–7–1 (I, V6, I): an opening gambit.
//   Meyer        melody 1–7 … 4–3 over bass 1–2 … 7–1: an opening of two matched halves.
//   Romanesca    melody falling by step in tenths over a bass falling 1–7–6–5 (a sequence).
//   Prinner      melody 6–5–4–3 over bass 4–3–2–1: the riposte that answers an opening.
//   Fonte        a step down: ♯1–2 over V/ii–ii, then 7–1 over V–I (a sequence).
//   Monte        a step up: 3–4 over I–IV, then ♯4–5 over V/V–V (a sequence).
//   Quiescenza   1–6–7–1 over a held tonic in the bass: a close after the final cadence.
//   Ponte        the melody climbing over the dominant, held: a bridge back to the opening.
// with the cadences that end phrases: a complete cadence (…–2–1 over V–I), a half cadence
// (on V), a converging half cadence (ii6–V) and a Phrygian half cadence (iv6–V, minor).

type PhraseKind = 'single' | 'antecedent' | 'contrast' | 'consequent' | 'continuation';

/** A sequence: `units` bars, each a copy of the first moved `step` scale degrees. */
interface SequenceSpec {
  name: SequenceName;
  units: number;
  step: number;
}

/** A chord in a phrase plan, with the melody's schema note over it and whether the bass holds the tonic. */
interface PlannedChord {
  symbol: string;
  /** Scale degree, 0-based (do = 0), that the melody must sound when this chord begins. */
  goal?: number;
  /** Over a tonic pedal (the Quiescenza). */
  pedal?: boolean;
}

interface Phrase {
  kind: PhraseKind;
  startBar: number;
  /** Four bars of one or two chords each. */
  harmony: PlannedChord[][];
  cadence: Cadence;
  sequence?: SequenceSpec;
  repeatsOpening: boolean;
  /** The schemata the phrase is built from, in order. */
  schemas: string[];
}

interface Template {
  harmony: PlannedChord[][];
  cadence: Cadence;
  weight: number;
  schemas: string[];
  sequence?: SequenceSpec;
  minGrade?: Grade;
  /** May keep two chords in a bar in any metre (not only duple), as a cadence's ii6–V does. */
  paired?: boolean;
}

/**
 * Builds a template from "I:1,V6:2 | I:3 | V:2" notation: bars split by "|", chords by ",";
 * after a chord, ":n" is the melody's scale degree (1–7) and "^" a tonic pedal under it.
 */
function tpl(schemas: string[], bars: string, cadence: Cadence, weight: number, extra: Partial<Template> = {}): Template {
  const chord = (token: string): PlannedChord => {
    const m = /^([^:^]+)(?::(\d))?(\^)?$/.exec(token.trim());
    if (!m) throw new Error(`Bad chord ${token}`);
    return { symbol: m[1], goal: m[2] ? Number(m[2]) - 1 : undefined, pedal: m[3] ? true : undefined };
  };
  return { schemas, harmony: bars.split('|').map((b) => b.split(',').map(chord)), cadence, weight, ...extra };
}

const ROMANESCA: SequenceSpec = { name: 'romanesca', units: 3, step: -2 };
const FIFTHS: SequenceSpec = { name: 'descending-fifths', units: 2, step: -1 };
const FONTE: SequenceSpec = { name: 'fonte', units: 2, step: -1 };
const MONTE: SequenceSpec = { name: 'monte', units: 2, step: 1 };

/** A whole piece of four bars (Grade 1): an opening gesture closed by a complete cadence. */
const SINGLE: Record<Mode, Template[]> = {
  major: [
    tpl(['Complete cadence'], 'I:3 | IV:4 | V:2 | I:1', 'PAC', 3),
    tpl(['Do–Re–Mi', 'Complete cadence'], 'I:1 | V:2 | I:3,V:2 | I:1', 'PAC', 2, { paired: true }),
    tpl(['Quiescenza line', 'Complete cadence'], 'I:1 | IV:6 | V:7 | I:1', 'PAC', 2),
  ],
  minor: [
    tpl(['Complete cadence'], 'i:3 | iv:4 | V:2 | i:1', 'PAC', 3),
    tpl(['Do–Re–Mi', 'Complete cadence'], 'i:1 | V:2 | i:3,V:2 | i:1', 'PAC', 2, { paired: true }),
    tpl(['Quiescenza line', 'Complete cadence'], 'i:1 | iv:6 | V:7 | i:1', 'PAC', 2),
  ],
};

/** The first phrase: an opening schema, ending with a weaker cadence (HC or IAC). */
const OPENING: Record<Mode, Template[]> = {
  major: [
    tpl(['Do–Re–Mi', 'Half cadence'], 'I:1 | V:2 | I:3 | V:2', 'HC', 2),
    tpl(['Do–Re–Mi', 'Half cadence'], 'I:1 | V6:2 | I:3 | V:2', 'HC', 3, { minGrade: 3 }),
    tpl(['Do–Re–Mi', 'Converging half cadence'], 'I:1 | V6:2 | I:3 | ii6:4,V:2', 'HC', 2.5, { minGrade: 3, paired: true }),
    tpl(['Do–Re–Mi', 'Half cadence'], 'I:1 | V:2 | I:3 | V:5', 'HC', 1),
    tpl(['Complete cadence'], 'I:3 | IV:4 | V:2 | I:3', 'IAC', 1.5),
    tpl(['Meyer'], 'I:1 | vii°6:7 | vii°:4 | I:3', 'IAC', 2.5, { minGrade: 4 }),
    tpl(['Romanesca', 'Converging half cadence'], 'I:3,V6:2 | vi:1,iii6:7 | IV:6,I6:5 | ii6:4,V:2', 'HC', 3, { sequence: ROMANESCA, minGrade: 3 }),
  ],
  minor: [
    tpl(['Do–Re–Mi', 'Half cadence'], 'i:1 | V:2 | i:3 | V:2', 'HC', 2),
    tpl(['Do–Re–Mi', 'Half cadence'], 'i:1 | V6:2 | i:3 | V:2', 'HC', 3, { minGrade: 3 }),
    tpl(['Do–Re–Mi', 'Phrygian half cadence'], 'i:1 | V6:2 | i:3 | iv6:4,V:2', 'HC', 2.5, { minGrade: 3, paired: true }),
    tpl(['Complete cadence'], 'i:3 | iv:4 | V:2 | i:3', 'IAC', 1.5),
    tpl(['Meyer'], 'i:1 | vii°6:7 | vii°:4 | i:3', 'IAC', 2.5, { minGrade: 4 }),
    tpl(['Romanesca', 'Phrygian half cadence'], 'i:3,v6:2 | VI:1,III6:7 | iv:6,i6:5 | iv6:4,V:2', 'HC', 3, { sequence: ROMANESCA, minGrade: 3 }),
  ],
};

/** The middle phrase of a twelve-bar piece: a sequence away from the tonic, ending on V. */
const CONTRAST: Record<Mode, Template[]> = {
  major: [
    tpl(['Monte', 'Converging half cadence'], 'I:3,IV:4 | ii:4,V:5 | IV:6,I6:5 | ii6:4,V:2', 'HC', 2.5, { sequence: MONTE, minGrade: 3, paired: true }),
    tpl(['Monte', 'Converging half cadence'], 'I:3,IV:4 | V/V:4,V:5 | IV:6,I6:5 | ii6:4,V:2', 'HC', 3, { sequence: MONTE, minGrade: 4, paired: true }),
    tpl(['Fonte', 'Converging half cadence'], 'V/ii:1,ii:2 | V:7,I:1 | IV:6,I6:5 | ii6:4,V:2', 'HC', 3, { sequence: FONTE, minGrade: 4, paired: true }),
    tpl(['Romanesca', 'Converging half cadence'], 'I:3,V6:2 | vi:1,iii6:7 | IV:6,I6:5 | ii6:4,V:2', 'HC', 2, { sequence: ROMANESCA, minGrade: 3 }),
    // Without a sequence (a bar too short for two chords): a Prinner to the dominant, or a Ponte on it.
    tpl(['Prinner', 'Half cadence'], 'IV:6 | I6:5 | ii6:4 | V:2', 'HC', 0.6, { minGrade: 3 }),
    tpl(['Ponte'], 'V:5 | V:7 | V:2 | V:5', 'HC', 0.4),
  ],
  minor: [
    tpl(['Romanesca', 'Phrygian half cadence'], 'i:3,v6:2 | VI:1,III6:7 | iv:6,i6:5 | iv6:4,V:2', 'HC', 2.5, { sequence: ROMANESCA, minGrade: 3 }),
    tpl(['Ponte'], 'V:5 | V:7 | V:2 | V:5', 'HC', 0.4),
    tpl(['Prinner', 'Phrygian half cadence'], 'iv:6 | i6:5 | vii°6:4 | iv6:4,V:2', 'HC', 2, { minGrade: 4, paired: true }),
    tpl(['Descending fifths', 'Half cadence'], 'i:3,iv:6 | VII:2,III:5 | iv:6,i6:5 | V:2', 'HC', 1.5, { sequence: FIFTHS, minGrade: 4, paired: true }),
  ],
};

/** The last phrase after a deceptive cadence (or in place of a repeat): a riposte and a cadence. */
const CONTINUATION: Record<Mode, Template[]> = {
  major: [
    tpl(['Prinner', 'Complete cadence'], 'IV:6,I6:5 | ii:4,I:3 | ii6:4,V:2 | I:1', 'PAC', 3, { minGrade: 3, paired: true }),
    tpl(['Prinner', 'Complete cadence'], 'IV:6,I6:5 | vii°6:4,I:3 | ii6:4,V:2 | I:1', 'PAC', 3, { minGrade: 4, paired: true }),
    tpl(['Descending fifths', 'Complete cadence'], 'vi:1,ii:4 | V:7,I:3 | IV:6,V:2 | I:1', 'PAC', 2, { sequence: FIFTHS, minGrade: 3, paired: true }),
    tpl(['Complete cadence', 'Quiescenza'], 'IV:4,V:2 | I:1 | I:1,IV:6^ | V:7^,I:1', 'PAC', 2, { minGrade: 3, paired: true }),
  ],
  minor: [
    tpl(['Prinner', 'Complete cadence'], 'iv:6,i6:5 | vii°6:4,i:3 | iv:4,V:2 | i:1', 'PAC', 3, { minGrade: 4, paired: true }),
    tpl(['Descending fifths', 'Complete cadence'], 'VI:1,ii°6:4 | V:7,i:3 | iv:6,V:2 | i:1', 'PAC', 2, { sequence: FIFTHS, minGrade: 4, paired: true }),
    tpl(['Complete cadence', 'Quiescenza'], 'iv:4,V:2 | i:1 | i:1,iv:6^ | V:7^,i:1', 'PAC', 2.5, { minGrade: 3, paired: true }),
  ],
};

/** The bar before a consequent's last bar: the approach to V. */
const APPROACH: Record<Mode, Template[]> = {
  major: [
    tpl(['Complete cadence'], 'V:2', 'PAC', 2),
    tpl(['Complete cadence'], 'IV:4,V:2', 'PAC', 2, { paired: true }),
    tpl(['Complete cadence'], 'ii6:4,V:2', 'PAC', 2, { paired: true }),
  ],
  minor: [
    tpl(['Complete cadence'], 'V:2', 'PAC', 2),
    tpl(['Complete cadence'], 'iv:4,V:2', 'PAC', 2, { paired: true }),
    tpl(['Complete cadence'], 'iv6:4,V:2', 'PAC', 1.5, { paired: true }),
    tpl(['Complete cadence'], 'ii°6:4,V:2', 'PAC', 1.5, { paired: true }),
  ],
};

const CORE_CHORDS = ['I', 'i', 'IV', 'iv', 'V'];
const DUPLE = ['2/4', '4/4', '6/8'];

function planPhrases(ctx: Ctx, barCount: number): Phrase[] {
  const { rng, spec, style, time, grade, key } = ctx;
  const mode = key.mode;
  const extras: readonly string[] = spec.extraChords.filter((c) => style.extraChords.includes(c));
  const twoChordBars = spec.inversions && harmonySplit(time) !== null;
  const baseOf = (symbol: string) => (symbol.endsWith('6') ? symbol.slice(0, -1) : symbol);
  // The melody's range (scale degrees from the tonic): a schema whose notes lie outside it is not used.
  const window = pitchWindow(key, spec.rhRange, { letter: 'A', alter: 0, octave: 3 }, { letter: 'A', alter: 0, octave: 5 }, ctx.cons?.melodyRange ?? null);
  const reachable = (goal: number | undefined) => goal === undefined || !window || Array.from({ length: window.hi - window.lo + 1 }, (_, i) => window.lo + i).some((d) => mod(d, 7) === goal);
  const available = (c: PlannedChord) =>
    reachable(c.goal) &&
    (CORE_CHORDS.includes(baseOf(c.symbol)) || extras.includes(baseOf(c.symbol))) && (!c.symbol.endsWith('6') || spec.inversions);

  /** Adapts a template to this grade and metre, or returns null if it cannot be used. */
  const adapt = (t: Template): Template | null => {
    if ((t.minGrade ?? 1) > grade) return null;
    if (t.sequence && !twoChordBars) return null;
    const harmony = t.harmony.map((bar, i) => {
      const inSequence = t.sequence !== undefined && i < t.sequence.units;
      // Two chords in a bar need a split of the bar: always for a sequence or a paired
      // (cadential) template, and otherwise only in duple metres; else keep the second.
      const keep = inSequence || (twoChordBars && (t.paired || DUPLE.includes(time.id)));
      return bar.length === 2 && !keep ? [bar[1]] : bar;
    });
    if (!harmony.flat().every(available)) return null;
    // A sequence copies its model a step away each unit, so its notes must all fit the range in one octave.
    if (t.sequence && window) {
      const { units, step } = t.sequence;
      const model = harmony[0].flatMap((c) => (c.goal === undefined ? [] : [c.goal]));
      const fits = [-2, -1, 0, 1, 2].some((o) =>
        model.every((g) => Array.from({ length: units }, (_, k) => g + 7 * o + step * k).every((d) => d >= window.lo && d <= window.hi)),
      );
      if (!fits) return null;
    }
    // A phrase that lost its dominant to the bar split no longer cadences (a 3/8 Quiescenza would end IV–I).
    if (t.harmony.length === 4 && t.cadence !== 'HC') {
      const chords = harmony.flat();
      if (!/^(V|vii°)/.test(chords[chords.length - 2]?.symbol ?? 'V')) return null;
    }
    // A schema that lost one of its notes to the bar split is no longer itself.
    const lost = t.harmony.flat().length !== harmony.flat().length;
    return { ...t, harmony, schemas: lost ? t.schemas.filter((s) => s.includes('cadence')) : t.schemas };
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
    schemas: t.schemas,
  });

  if (barCount === 4) return [phrase('single', 0, choose(SINGLE[mode]))];

  const opening = phrase('antecedent', 0, choose(OPENING[mode]));
  /** Repeats the opening two bars, then cadences: PAC to finish, or DC to keep going. */
  const answer = (startBar: number, cadence: 'PAC' | 'DC'): Phrase => {
    const approach = choose(APPROACH[mode]).harmony[0];
    const goal: PlannedChord = cadence === 'PAC' ? { symbol: tonicSymbol(mode), goal: 0 } : { symbol: mode === 'major' ? 'vi' : 'VI', goal: 0 };
    return {
      kind: 'consequent',
      startBar,
      harmony: [opening.harmony[0], opening.harmony[1], approach, [goal]],
      cadence,
      repeatsOpening: true,
      schemas: [...opening.schemas.filter((s) => !s.includes('cadence')), cadence === 'PAC' ? 'Complete cadence' : 'Deceptive cadence'],
    };
  };

  if (barCount === 8) return [opening, answer(4, 'PAC')];

  /** A contrasting phrase (a sequence, or a Prinner or Ponte) unlike the opening and the last contrast. */
  let lastContrast: SequenceName | undefined = opening.sequence?.name;
  const contrast = (startBar: number): Phrase => {
    const options = CONTRAST[mode].filter((t) => !t.sequence || t.sequence.name !== lastContrast);
    const usable = options.map(adapt).some(Boolean) ? options : CONTRAST[mode];
    const p = phrase('contrast', startBar, choose(usable));
    lastContrast = p.sequence?.name ?? lastContrast;
    return p;
  };

  // The first section: A – A' (deceptive cadence) – a riposte to the final cadence (12 bars),
  // or A – B (a sequence) – A', or (an even number of phrases) A – A'.
  const phrases: Phrase[] = [];
  const count = barCount / 4;
  if (count % 2 === 1) {
    const continuation = CONTINUATION[mode].map(adapt).some(Boolean);
    if (continuation && available({ symbol: mode === 'major' ? 'vi' : 'VI' }) && rng.chance(0.5)) {
      phrases.push(opening, answer(4, 'DC'), phrase('continuation', 8, choose(CONTINUATION[mode])));
    } else {
      phrases.push(opening, contrast(4), answer(8, 'PAC'));
    }
  } else {
    phrases.push(opening, answer(4, 'PAC'));
  }
  // Longer pieces (Grades 5–8) go on in rounded binary: a contrast, then the opening's return,
  // as often as the length asks — A A' | B A' | B' A' …
  while (phrases.length < count) phrases.push(contrast(phrases.length * 4), answer((phrases.length + 1) * 4, 'PAC'));
  return phrases;
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

/** Fills units of a bar with rhythm cells, weighted by the style's taste (and its downbeat preferences). */
function fillUnits(ctx: Ctx, startPos: number, endPos: number): number[] {
  const { rng, time, spec, style, grade, cons } = ctx;
  return fillWithCells(
    rng,
    time,
    grade,
    spec.durations,
    startPos,
    endPos,
    (c, pos) => {
      const w = style.cellWeights[c.name] ?? 1;
      return pos === 0 ? w * (style.downbeatWeights?.[c.name] ?? 1) : w;
    },
    rhythmPreferences(cons),
  );
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
      const echo = b === 2 && ctx.rng.chance(0.55) && (split === undefined || starts(bars[0]).includes(split));
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
  /** The schema's note here (0-based scale degree), where a chord begins. */
  goal?: number;
}

interface MelodyNote {
  deg: number;
  pitch: Pitch;
  nct: boolean;
}

const LEAP_WEIGHTS = [0.35, 1, 0.7, 0.35, 0.25, 0.15, 0.1, 0.12];

function buildMelody(ctx: Ctx, phrases: Phrase[], segments: Segment[][], rhythms: number[][]): Note[][] {
  const { key, spec, time, cons } = ctx;
  // Treble stave comfort zone: A3 (two ledger lines below) to A5 (one above) — or the user's range.
  const window = pitchWindow(key, spec.rhRange, { letter: 'A', alter: 0, octave: 3 }, { letter: 'A', alter: 0, octave: 5 }, cons?.melodyRange ?? null);
  if (!window) throw new Error('The melody range does not contain the tonic');
  const { lo, hi, tonicOctave } = window;
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
      starts(rhythms[b]).forEach((onset, i) => {
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
          goal: segments[b].find((s) => s.at === onset)?.goal,
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
    if (cons && !melodicIntervalAllowed(cons, p1.pitch, c.pitch)) return false;
    // (Level 3 gives up a schema note before level 4 gives up these.)
    if (relax < 4) {
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
    // The schema's note, where it asks for one (relaxed only as a last resort).
    (slot.goal === undefined || (relax >= 3 && !slot.cadence) || relax >= 4 || mod(d, 7) === slot.goal) &&
    // An imperfect authentic cadence ends on mi or sol, not do; a perfect one on do (also
    // mid-piece, where a rounded binary form's sections close).
    (slot.cadence !== 'IAC' || [2, 4].includes(mod(d, 7))) &&
    (slot.cadence !== 'PAC' || mod(d, 7) === 0);

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
  /** Each phrase that repeats the opening: its first freely generated slot (after the copied opening) and its end. */
  const repeatSpans = phrases.flatMap((p, pi) => (p.repeatsOpening ? [{ start: barStart[p.startBar + 2], end: phraseEnd[pi] }] : []));
  const openingTail = (): MelodyNote[] => [notes[0], notes[1]].filter(Boolean);
  /** Phrase-final slot → the following freshly generated phrase it must be able to lead into. */
  const leadsInto = new Map<number, { from: number; to: number; tail: () => MelodyNote[] }>();
  phrases.forEach((_, pi) => {
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
  /** Lookahead steps left for this attempt: an unreachable schema note must not search forever. */
  let work = 0;

  const tailOk = (p2: MelodyNote | undefined, p1: MelodyNote | undefined, tail: MelodyNote[]) =>
    !tail.length ||
    (transitionOk(p2, p1, tail[0], relax) && (tail.length < 2 || transitionOk(p1, tail[0], tail[1], relax)));

  const complete = (i: number, end: number, p2: MelodyNote | undefined, p1: MelodyNote, tail: MelodyNote[]): boolean => {
    if (i === end) return tailOk(p2, p1, tail);
    if (--work < 0) return false;
    const models = modelSlots.filter((m) => m < i).map((m) => notes[m]?.deg);
    const memoKey = [i, end, p2?.deg, p1.deg, tail.map((t) => t.deg).join(','), notes[0]?.deg, notes[1]?.deg, models.join(','), relax].join('|');
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    const ok = options(i, p2, p1).some((c) => {
      notes[i] = c;
      return complete(i + 1, end, p1, c, tail);
    });
    if (work >= 0) memo.set(memoKey, ok);
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
      if (slot.endsRepeatedOpening && !repeatSpans.every((r) => complete(r.start, r.end, p1, c, []))) return false;
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
    for (relax = 0; relax <= 4; relax++) {
      memo.clear();
      for (let attempt = 0; attempt < 3; attempt++) {
        budget = 6000;
        work = 60000;
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

type LhKind = 'long' | 'split' | 'dyad' | 'dyadSplit' | 'alberti' | 'broken' | 'oompah' | 'walking' | 'march' | 'polonaise';

interface LhEvent {
  /** Degrees relative to the bass note, written for a root-position chord. */
  offs: number[];
  ticks: number;
}

/** Two roughly equal halves of a bar, as representable durations. */
function halves(time: TimeSignature): [number, number] {
  switch (time.id) {
    case '3/8': return [4, 2];
    case '9/8': return [12, 6];
    default: {
      const h = harmonySplit(time)!;
      return [h, time.barTicks - h];
    }
  }
}

/**
 * One long note filling the bar where the grade has such a note (a semibreve only from Grade 2;
 * 9/8 needs two), else the longest the grade allows and what is left (rests, or tied).
 */
function wholeBar(time: TimeSignature, durations: readonly number[]): number[] {
  if (durations.includes(time.barTicks)) return [time.barTicks];
  const out: number[] = [];
  let left = time.barTicks;
  while (left > 0) {
    const d = [...durations].sort((a, b) => b - a).find((x) => x <= left) ?? left;
    out.push(d);
    left -= d;
  }
  return out;
}

function chooseLhKind(ctx: Ctx, time: TimeSignature): LhKind {
  const { rng, grade, style, cons, spec } = ctx;
  const simpleCrotchet = !time.compound && time.beatTicks === 4;
  // Fully independent hands: a moving accompaniment at every grade.
  if (cons?.independence === 'full' && grade < 4) {
    const quavers = cons.noteTicks.includes(2);
    if (quavers) return simpleCrotchet ? 'alberti' : 'broken';
    return time.id === '3/4' ? 'oompah' : 'march';
  }
  if (grade === 1) return rng.chance(0.75) ? 'long' : 'split';
  if (grade === 2) return rng.chance(0.5) ? 'long' : 'split';
  if (grade === 3) return rng.chance(0.5) ? 'dyad' : 'dyadSplit';
  switch (style.accompaniment) {
    case 'walking': return simpleCrotchet ? 'walking' : 'broken';
    // A Trio's thinner texture: held intervals rather than a moving bass.
    case 'light': return rng.chance(0.6) ? 'dyad' : 'dyadSplit';
    case 'oompah': return time.id === '3/4' ? 'oompah' : simpleCrotchet ? 'alberti' : 'broken';
    case 'polonaise': return time.id === '3/4' && spec.durations.includes(1) ? 'polonaise' : 'oompah';
  }
}

/** The accompaniment pattern for a whole bar with one chord. */
function barEvents(kind: LhKind, time: TimeSignature, rng: Random, durations: readonly number[]): LhEvent[] {
  const [h1, h2] = halves(time);
  const repeat = (pattern: LhEvent[], times: number) => Array.from({ length: times }, () => pattern).flat();
  const quavers = (cycle: number[]) =>
    Array.from({ length: time.barTicks / 2 }, (_, i) => ({ offs: [cycle[i % cycle.length]], ticks: 2 }));
  const other = rng.pick([4, 2, -3]);
  switch (kind) {
    case 'long':
      return wholeBar(time, durations).map((ticks, i) => ({ offs: [i === 0 ? 0 : 4], ticks }));
    case 'split':
      return [{ offs: [0], ticks: h1 }, { offs: [other], ticks: h2 }];
    case 'dyad':
      return wholeBar(time, durations).map((ticks) => ({ offs: [0, rng.chance(0.6) ? 4 : 2], ticks }));
    case 'dyadSplit':
      return [{ offs: [0, 4], ticks: h1 }, { offs: rng.pick([[2, 4], [0, 2]]), ticks: h2 }];
    case 'polonaise':
      // The polonaise rhythm: a quaver and two semiquavers, then quavers — bass, then the chord.
      return [
        { offs: [0], ticks: 2 },
        { offs: [2, 4], ticks: 1 },
        { offs: [2, 4], ticks: 1 },
        ...repeat([{ offs: [2, 4], ticks: 2 }], 4),
      ];
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
    case 'polonaise':
      return [{ offs: [0], ticks: 2 }, ...repeat([{ offs: [2, 4], ticks: 2 }], ticks / 2 - 1)];
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
  const { key, spec, time, rng, cons } = ctx;
  // Bass stave comfort zone: E2 (one ledger line below) to D4 (two above) — or the user's range.
  const window = pitchWindow(key, spec.lhRange, { letter: 'E', alter: 0, octave: 2 }, { letter: 'D', alter: 0, octave: 4 }, cons?.bassRange ?? null);
  if (!window) throw new Error('The left-hand range does not contain the tonic');
  const { lo, hi, tonicOctave } = window;
  const minor = key.mode === 'minor';
  const n = segmentsByBar.length;
  const kinds = segmentsByBar.map(() => chooseLhKind(ctx, time));

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
    // (The Quiescenza holds the tonic in the bass under its chords.)
    const base = seg.bar === n - 1 || seg.pedal ? 0 : bassDegree(seg.chord);
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
      // Final bar: the tonic, held (once, under both chords of a closing Quiescenza).
      if (seg.at === 0) wholeBar(time, ctx.spec.durations).forEach((ticks, k) => bars[seg.bar].push(note(k === 0 ? [r] : [], ticks)));
      return;
    }
    if (seg.pedal) {
      // Over the pedal: the held tonic, with the chord's nearest two notes above it.
      const above: number[] = [];
      for (let d = r + 1; d <= hi && above.length < ctx.spec.features.chordNotes - 1; d++) if (chordTones(chord).includes(mod(d, 7)) && allowed(chord, d)) above.push(d);
      bars[seg.bar].push(note([r, ...above], seg.ticks));
      return;
    }
    if (seg.kind === 'walking') {
      for (const d of walkingBass(i, seg.ticks / 4)) bars[seg.bar].push(note([d], 4));
      return;
    }
    const events = seg.whole ? barEvents(seg.kind, time, rng, ctx.spec.durations) : halfBarEvents(seg.kind, seg.ticks, time, rng);
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
