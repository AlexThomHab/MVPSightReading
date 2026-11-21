/**
 * The Baroque era's contrapuntal forms: the two-part Invention and the Fugue (a fughetta for
 * two voices, one in each hand). Both grow from a one-bar subject:
 *
 *   Subject      alone in one hand, the other resting;
 *   Answer       the other hand takes it up against a countersubject — a fugue's answer at the
 *                fifth (in the dominant from Grade 4, where its leading note needs a sharp), an
 *                invention's imitation at the octave;
 *   Episodes     sequences on the subject's head: a bar of two-part counterpoint, then copies of
 *                it a step lower each bar, falling towards the next entry;
 *   Entries      the subject again (8 bars and more): in the relative key and the dominant from
 *                Grade 4, otherwise in the tonic, the countersubject following where it can;
 *   Cadence      IV–V–I, with a 4–3 suspension from Grade 3.
 *
 * Every free line is found by a search, note by note, under the rules of two-part counterpoint:
 * consonance on every beat (a dissonance between beats only as a passing or neighbouring note,
 * or as a prepared suspension), no consecutive perfect fifths or octaves, no crossing of the
 * parts, chord tones where the harmony changes, and leaps within the grade, recovered by step.
 *
 * Pure TypeScript with no Angular dependencies. Fully deterministic from the settings.
 */
import { Grade, GradeSpec, TIME_SIGNATURES, TimeSignature, TimeSignatureId } from './grades';
import type { Bar, Harmony, Note, PhraseInfo, Piece, Settings, Tempo } from './model';
import { Random } from './random';
import { GenerationConstraints, constraintsOf, effectiveSpec, melodicIntervalAllowed, pitchWindow } from './constraints';
import { cellUnit, fillWithCells, harmonySplit, rhythmPreferences } from './rhythm';
import { formTimes } from './forms';
import { KEYS, Key, Pitch, degreeToPitch, isSingableInterval, keyName, keySignatureAlter, midi, mod } from './theory';
import { splitTicks, starts } from './durations';

export type BaroqueFormId = 'invention' | 'fugue';
export const isBaroqueForm = (id: string): id is BaroqueFormId => id === 'invention' || id === 'fugue';

type Hand = 'rh' | 'lh';
const otherHand = (h: Hand): Hand => (h === 'rh' ? 'lh' : 'rh');

/**
 * Notes are absolute scale degrees of the home key: 0 is its tonic in octave 0, 7 the tonic an
 * octave up (so the tonic in octave 4 is 28). A rest is null.
 */
interface Ev {
  abs: number | null;
  ticks: number;
  tie?: boolean;
}

/** The key a bar is in: the home key, or (Grade 4+) the dominant or relative. */
interface Local {
  key: Key;
  /** Its tonic, as a degree of the home key. */
  shift: number;
}

type SectionKind = 'subject' | 'answer' | 'episode' | 'entry' | 'final' | 'cadence';

interface Section {
  kind: SectionKind;
  label: string;
  bars: number;
  local: Local;
  /** The hand with the subject (entries) or the motif (episodes). */
  lead: Hand | null;
  /** Entries: the subject's transposition, as a degree (0 subject, 4 answer at the fifth, …). */
  degree: number;
}

interface Chord {
  at: number;
  /** Root, as a degree of the home key (0–6). */
  root: number;
}

interface BarPlan {
  section: number;
  kind: SectionKind;
  local: Local;
  chords: Chord[];
  lead: Hand | null;
  /** An entry's transposition of the subject (see Section.degree); absent elsewhere. */
  degree?: number;
}

interface Ctx {
  rng: Random;
  spec: GradeSpec;
  grade: Grade;
  key: Key;
  time: TimeSignature;
  cons: GenerationConstraints | null;
  form: BaroqueFormId;
  /** Each hand's range, in absolute degrees. */
  win: Record<Hand, [number, number]>;
  /** Accidentals outside the key may be written (modulating entries). */
  chromatic: boolean;
  /** Whole-bar rests may be written (a customisation may not allow them). */
  restOk: boolean;
  plan: BarPlan[];
}

class Stuck extends Error {}

export function generateBaroque(settings: Settings): Piece {
  if (!isBaroqueForm(settings.form)) throw new Error(`${settings.form} is not a Baroque contrapuntal form`);
  // Counterpoint is a search; a rare dead end starts again from a related seed.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return compose(settings, attempt);
    } catch (e) {
      if (!(e instanceof Stuck)) throw e;
    }
  }
  throw new Error('Could not write the counterpoint');
}

function compose(settings: Settings, attempt: number): Piece {
  const { seed, grade } = settings;
  const form = settings.form as BaroqueFormId;
  const cons = constraintsOf(settings);
  const spec = effectiveSpec(grade, cons);
  const rng = new Random(`${seed}|g${grade}|${form}|${settings.keyId ?? ''}|${settings.timeId ?? ''}${attempt ? `|${attempt}` : ''}`);
  const key = settings.keyId ? (KEYS.find((k) => k.id === settings.keyId) ?? pickKey(rng, spec)) : pickKey(rng, spec);
  const metres = formTimes(form, spec.times);
  const time = TIME_SIGNATURES[settings.timeId ?? rng.weighted(metres, (t: TimeSignatureId) => (t === metres[0] ? 2 : 1))];
  const barCount = rng.pick(spec.bars);

  const rhWin = pitchWindow(key, spec.rhRange, { letter: 'A', alter: 0, octave: 3 }, { letter: 'A', alter: 0, octave: 5 }, cons?.melodyRange ?? null);
  const lhWin = pitchWindow(key, spec.lhRange, { letter: 'E', alter: 0, octave: 2 }, { letter: 'D', alter: 0, octave: 4 }, cons?.bassRange ?? null);
  if (!rhWin || !lhWin) throw new Error('The ranges do not contain the tonic');
  const abs = (w: { tonicOctave: number; lo: number; hi: number }): [number, number] => [7 * w.tonicOctave + w.lo, 7 * w.tonicOctave + w.hi];
  const restTicks = splitTicks(time.barTicks);
  const ctx: Ctx = {
    rng,
    spec,
    grade,
    key,
    time,
    cons,
    form,
    win: { rh: abs(rhWin), lh: abs(lhWin) },
    chromatic: spec.chromatic,
    restOk: !cons || restTicks.every((t) => cons.restTicks.includes(t)),
    plan: [],
  };
  // The hands must not share their whole range, or the parts could not stay apart.
  if (ctx.win.rh[1] <= ctx.win.lh[0] + 2) throw new Error('The right-hand range lies below the left hand');

  const sections = planSections(ctx, barCount);
  const subject = makeSubject(ctx, sections[0].lead!);
  fitEntries(ctx, sections, subject);
  const parts = writeParts(ctx, sections, subject);
  return toPiece(ctx, settings, sections, parts);
}

function pickKey(rng: Random, spec: GradeSpec): Key {
  return rng.pick(KEYS.filter((k) => spec.keys.includes(k.id)));
}

// ---------------------------------------------------------------------------
// The plan: sections, keys and chords
// ---------------------------------------------------------------------------

/** A key related to the home key: its tonic `shift` degrees above, in `mode`. */
function related(home: Key, shift: number, mode: Key['mode']): Local {
  if (shift === 0) return { key: home, shift };
  const tonic = degreeToPitch(home, 4, shift);
  // The dominant has one more sharp; the relative shares the key signature.
  const fifths = home.fifths + (mod(shift, 7) === 4 ? 1 : 0);
  return { key: { id: '', tonic: tonic.letter, tonicAlter: tonic.alter, mode, fifths }, shift };
}

function planSections(ctx: Ctx, n: number): Section[] {
  const { rng, grade, key, form, chromatic } = ctx;
  const home: Local = { key, shift: 0 };
  const minor = key.mode === 'minor';
  const dominant = related(key, 4, key.mode);
  const relative = minor ? related(key, 2, 'major') : related(key, 5, 'minor');
  const fugue = form === 'fugue';
  // Inventions mostly begin in the right hand; from Grade 4 either hand may.
  const h0: Hand = grade >= 4 && rng.chance(0.3) ? 'lh' : 'rh';
  const h1 = otherHand(h0);
  const entry = (kind: SectionKind, label: string, local: Local, lead: Hand, degree: number): Section => ({ kind, label, bars: 1, local, lead, degree });
  const episode = (bars: number, lead: Hand): Section => ({ kind: 'episode', label: 'Episode', bars, local: home, lead, degree: 0 });
  const cadence: Section = { kind: 'cadence', label: 'Cadence', bars: 2, local: home, lead: null, degree: 0 };

  const out: Section[] = [
    entry('subject', 'Subject', home, h0, 0),
    fugue
      ? entry('answer', 'Answer', chromatic ? dominant : home, h1, 4)
      : entry('answer', 'Imitation', home, h1, 0),
  ];
  // Middle entries modulate once accidentals are allowed; before that they stay at home.
  const middle = (local: Local, lead: Hand): Section =>
    local.shift === 0
      ? // At home: an invention's middle entry on the dominant; a fugue's as subject or answer.
        fugue
        ? entry('entry', 'Entry', home, lead, lead === h1 ? 4 : 0)
        : entry('entry', 'Entry (on the dominant)', home, lead, 4)
      : entry('entry', `Middle entry (${keyName(local.key)})`, local, lead, local.shift);
  if (n === 8) {
    out.push(episode(2, h0), middle(chromatic ? relative : home, h0), entry('final', 'Final entry', home, h1, 0));
  } else if (n >= 12) {
    out.push(
      episode(2, h0),
      middle(chromatic ? relative : home, h0),
      middle(chromatic ? dominant : home, h1),
      episode(n - 9, h0),
      entry('final', 'Final entry', home, h0, 0),
    );
  }
  out.push(cadence);

  const split = harmonySplit(ctx.time);
  const subjectChords: Chord[] = grade >= 3 && split !== null && rng.chance(0.5) ? [{ at: 0, root: 0 }, { at: split, root: 4 }] : [{ at: 0, root: 0 }];
  assignChords(ctx, out, subjectChords);
  return out;
}

/** Chords: an entry's follow the subject's; an episode's fall by step to the next entry; then IV–V–I. */
function assignChords(ctx: Ctx, out: Section[], subjectChords: Chord[]): void {
  const split = harmonySplit(ctx.time);
  ctx.plan = [];
  out.forEach((s, i) => {
    for (let k = 0; k < s.bars; k++) {
      let chords: Chord[];
      if (s.kind === 'episode') {
        const next = out[i + 1];
        chords = [{ at: 0, root: mod(next.degree + s.bars - k, 7) }];
      } else if (s.kind === 'cadence') {
        chords = k === 1 ? [{ at: 0, root: 0 }] : split !== null ? [{ at: 0, root: 3 }, { at: split, root: 4 }] : [{ at: 0, root: 4 }];
      } else {
        chords = subjectChords.map((c) => ({ at: c.at, root: mod(c.root + s.degree, 7) }));
      }
      const entry = s.kind !== 'episode' && s.kind !== 'cadence';
      ctx.plan.push({ section: i, kind: s.kind, local: s.local, chords, lead: s.lead, ...(entry ? { degree: s.degree } : {}) });
    }
  });
}

/**
 * Settles where each entry lies. An answer at the fifth that cannot fit the other hand's range
 * (a five-finger position) is given at the octave instead.
 */
function fitEntries(ctx: Ctx, sections: Section[], subject: Ev[]): void {
  let changed = false;
  for (const s of sections) {
    if (!s.lead || s.kind === 'episode' || fitShift(ctx, subject, s.lead, s.degree) !== null) continue;
    if (s.degree === 0) throw new Stuck();
    s.degree = 0;
    s.local = { key: ctx.key, shift: 0 };
    s.label = s.kind === 'answer' ? 'Answer (at the octave)' : 'Entry';
    changed = true;
  }
  if (changed) assignChords(ctx, sections, ctx.plan[0].chords);
}

const chordAt = (plan: BarPlan, t: number): Chord => [...plan.chords].reverse().find((c) => c.at <= t) ?? plan.chords[0];

/**
 * A degree spelled in its bar's key: the local key signature, and in a minor key the leading
 * note raised under the dominant chord. An entry mirrors the subject: its leading note is
 * raised only where it has truly moved into that key (an answer in the home key keeps the
 * minor dominant, v, as a tonal answer does).
 */
function spell(ctx: Ctx, b: number, abs: number, t: number): Pitch {
  const plan = ctx.plan[b];
  const p = degreeToPitch(ctx.key, 0, abs);
  const { key, shift } = plan.local;
  const transposedHere = plan.degree === undefined || mod(plan.degree, 7) === mod(shift, 7);
  const raise = transposedHere && key.mode === 'minor' && mod(abs - shift, 7) === 6 && mod(chordAt(plan, t).root - shift, 7) === 4 ? 1 : 0;
  return { ...p, alter: keySignatureAlter(key, p.letter) + raise };
}

// ---------------------------------------------------------------------------
// Counterpoint: one voice against another
// ---------------------------------------------------------------------------

/** A note of the other voice, placed in the bar. */
interface Placed {
  abs: number | null;
  midi: number;
  at: number;
  end: number;
  /** Approached and left by step: a passing or neighbouring note, which may be dissonant off the beat. */
  passing: boolean;
}

interface Prev {
  abs: number;
  pitch: Pitch;
  /** Its own melodic move, in degrees (0 if unknown). */
  move: number;
}

/** The last two notes sounding together: the hands' MIDI numbers. */
interface Pair {
  me: number;
  other: number;
}

interface Fill {
  b: number;
  hand: Hand;
  rhythm: number[];
  /** The other hand's notes in this bar (null: there is none yet, or it rests). */
  against: Ev[] | null;
  /** The other hand's last note before the bar and first after it, if known. */
  againstPrev?: number | null;
  againstNext?: number | null;
  prev: Prev | null;
  pair: Pair | null;
  /** Fixed notes, by index. */
  fixed?: (number | undefined)[];
  /** Required degrees (mod 7), by index. */
  residue?: (number | undefined)[];
  /** The note this voice moves to next (the following bar's first), when known. */
  next?: number;
  nextPitch?: Pitch;
  window?: [number, number];
  /** 0 strict; 1 without leap recovery; 2 also any chord tone in the bass. */
  relax?: number;
}

const consonant = (x: number, y: number) => {
  const s = Math.abs(x - y);
  return s !== 0 && [0, 3, 4, 7, 8, 9].includes(s % 12);
};
const perfectClass = (p: Pair): number | null => {
  const ic = Math.abs(p.me - p.other) % 12;
  return ic === 0 || ic === 7 ? ic : null;
};
const STEP_WEIGHT = [0.15, 6, 3, 1.2, 1, 0.6, 0.5, 0.5];

function placed(ctx: Ctx, b: number, evs: Ev[], prev: number | null | undefined, next: number | null | undefined): Placed[] {
  const at = starts(evs.map((e) => e.ticks));
  return evs.map((e, i) => {
    const before = i > 0 ? evs[i - 1].abs : prev;
    const after = i < evs.length - 1 ? evs[i + 1].abs : next;
    const passing =
      e.abs !== null && before != null && after != null && Math.abs(e.abs - before) === 1 && Math.abs(after - e.abs) === 1 && !evs[i - 1]?.tie;
    return { abs: e.abs, midi: e.abs === null ? 0 : midi(spell(ctx, b, e.abs, at[i])), at: at[i], end: at[i] + e.ticks, passing };
  });
}

/**
 * Finds pitches for a rhythm: a depth-first search over the scale, likeliest first (steps,
 * contrary motion, imperfect consonances, chord tones on the beat), under the rules above.
 */
function fill(ctx: Ctx, f: Fill): number[] | null {
  const { time, rng, spec, cons } = ctx;
  const plan = ctx.plan[f.b];
  const at = starts(f.rhythm);
  const n = f.rhythm.length;
  const [lo, hi] = f.window ?? ctx.win[f.hand];
  const relax = f.relax ?? 0;
  const beat = time.beatTicks;
  const leap = f.hand === 'rh' ? spec.maxLeap : spec.maxBassLeap;
  const against = f.against ? placed(ctx, f.b, f.against, f.againstPrev, f.againstNext) : null;
  const otherAt = (t: number) => against?.find((o) => o.at <= t && t < o.end) ?? null;
  const centre = (lo + hi) / 2;
  const span = hi - lo + 1;
  const bassTones = relax >= 2 ? [0, 2, 4] : spec.inversions ? [0, 2] : [0];
  const out: number[] = [];
  let nodes = 0;

  interface Option {
    abs: number;
    weight: number;
    prev: Prev;
    pair: Pair | null;
    dissonant: boolean;
  }

  const options = (i: number, prev: Prev | null, pair: Pair | null, dissonant: boolean): Option[] => {
    const t = at[i];
    const end = t + f.rhythm[i];
    const strong = t % beat === 0;
    const last = i === n - 1;
    const fixed = f.fixed?.[i];
    const residue = f.residue?.[i];
    const found: Option[] = [];
    for (let a = fixed ?? lo; a <= (fixed ?? hi); a++) {
      if (a < lo || a > hi) continue;
      if (residue !== undefined && mod(a, 7) !== residue) continue;
      const pitch = spell(ctx, f.b, a, t);
      const m = midi(pitch);
      let weight = 1;
      let move = 0;
      if (prev) {
        move = a - prev.abs;
        const size = Math.abs(move);
        if (size > leap || !isSingableInterval(prev.pitch, pitch)) continue;
        if (f.hand === 'rh' && cons && !melodicIntervalAllowed(cons, prev.pitch, pitch)) continue;
        // A dissonance resolves by step; a leap of a fourth or more turns back by step or third.
        if (dissonant && size !== 1) continue;
        if (relax < 1 && Math.abs(prev.move) >= 3 && (size > 2 || Math.sign(move) === Math.sign(prev.move))) continue;
        weight *= STEP_WEIGHT[size] ?? 0.3;
        if (size === 1 && Math.abs(prev.move) === 1 && Math.sign(move) === Math.sign(prev.move)) weight *= 1.4;
        // Not turning round and round one note.
        if (i >= 2 && a === out[i - 2] && Math.abs(move) === 1) weight *= 0.4;
      }
      let isDissonant = false;
      let next = pair;
      let ok = true;
      const sounding = otherAt(t);
      if (against) {
        const samples = [t, ...against.filter((o) => o.at > t && o.at < end).map((o) => o.at)];
        for (const s of samples) {
          const o = otherAt(s);
          if (!o || o.abs === null) {
            next = null;
            continue;
          }
          // The parts never cross or meet.
          if (f.hand === 'rh' ? a <= o.abs : a >= o.abs) {
            ok = false;
            break;
          }
          if (!consonant(m, o.midi)) {
            if (s === t) {
              if (strong) {
                ok = false;
                break;
              }
              isDissonant = true;
            } else if (s % beat === 0 || !o.passing) {
              // Held against the other part's new note: consonant on the beat, or its passing note.
              ok = false;
              break;
            }
          } else if (s === t && strong && perfectClass({ me: m, other: o.midi }) === null) weight *= 1.5;
          const cur: Pair = { me: m, other: o.midi };
          if (next) {
            const pc = perfectClass(cur);
            if (pc !== null && pc === perfectClass(next) && next.me !== cur.me && next.other !== cur.other) {
              ok = false;
              break;
            }
            if (s === t) {
              const mine = Math.sign(cur.me - next.me);
              const theirs = Math.sign(cur.other - next.other);
              if (mine && theirs && mine !== theirs) weight *= 1.5;
            }
          }
          next = cur;
        }
        if (!ok) continue;
        if (sounding && sounding.abs !== null && Math.abs(a - sounding.abs) > 11) weight *= 0.3;
      }
      // The harmony: chord tones where a chord begins (in the bass, its root or third).
      for (const c of plan.chords) {
        if (c.at < t || c.at >= end) continue;
        const tone = mod(a - c.root, 7);
        if (!(f.hand === 'lh' ? bassTones : [0, 2, 4]).includes(tone)) ok = false;
        else if (f.hand === 'lh' && tone === 0) weight *= 2;
      }
      if (!ok) continue;
      // Alone, the chord judges the line: chord tones on the beat, passing notes between.
      if (!sounding || sounding.abs === null) {
        const chordTone = [0, 2, 4].includes(mod(a - chordAt(plan, t).root, 7));
        if (!chordTone) {
          if (strong) continue;
          if (!prev || Math.abs(move) !== 1) continue;
          isDissonant = true;
        } else if (strong) weight *= 1.5;
      }
      if (last && f.next !== undefined) {
        const size = Math.abs(f.next - a);
        if (isDissonant && size !== 1) continue;
        if (size > leap || (f.nextPitch && !isSingableInterval(pitch, f.nextPitch))) continue;
        if (relax < 1 && Math.abs(move) >= 3 && (size > 2 || Math.sign(f.next - a) === Math.sign(move))) continue;
      } else if (last && isDissonant) continue;
      weight /= 1 + 3 * ((a - centre) / span) ** 2;
      found.push({ abs: a, weight, prev: { abs: a, pitch, move }, pair: next, dissonant: isDissonant });
    }
    return found;
  };

  const search = (i: number, prev: Prev | null, pair: Pair | null, dissonant: boolean): boolean => {
    if (i === n) return true;
    if (++nodes > 3000) return false;
    for (const o of rng.weightedOrder(options(i, prev, pair, dissonant), (x) => x.weight)) {
      out[i] = o.abs;
      if (search(i + 1, o.prev, o.pair, o.dissonant)) return true;
    }
    return false;
  };
  return search(0, f.prev, f.pair, false) ? out : null;
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

/** Notes per beat across both hands that each grade reads comfortably. */
const DENSITY: Record<Grade, number> = { 1: 1.7, 2: 2.2, 3: 2.8, 4: 3.4, 5: 3.9 };

/**
 * A rhythm from `from` to `to` (ticks, on beat boundaries). A subject is lively; a free part
 * complements the other: long notes against its runs, running notes against its long ones.
 */
function rhythm(ctx: Ctx, role: 'subject' | 'free', against: Ev[] | null, from: number, to: number): number[] {
  const { rng, time, grade, spec, cons } = ctx;
  const unit = cellUnit(time);
  const onsets = against ? starts(against.map((e) => e.ticks)).filter((_, i) => against[i].abs !== null) : [];
  const busy = (pos: number, units: number) => onsets.filter((t) => t >= pos * unit && t < (pos + units) * unit).length / units;
  return fillWithCells(
    rng,
    time,
    grade,
    spec.durations,
    from / unit,
    to / unit,
    (c, pos) => {
      const density = c.ticks.length / c.units;
      const want = role === 'subject' ? DENSITY[grade] * 0.62 : Math.max(1, DENSITY[grade] - busy(pos, c.units));
      // Counterpoint keeps moving: long held notes are rare.
      const held = c.ticks.some((t) => t > unit * 2) ? (role === 'free' ? 0.15 : 0.35) : 1;
      return held * Math.exp(-1.5 * (density - want) ** 2);
    },
    rhythmPreferences(cons),
  );
}

/** One note a beat: the plainest rhythm, a last resort for the search. */
function beats(ctx: Ctx, from: number, to: number): number[] {
  const unit = cellUnit(ctx.time);
  const ok = ctx.spec.durations.includes(unit);
  return ok ? Array.from({ length: (to - from) / unit }, () => unit) : splitTicks(to - from);
}

// ---------------------------------------------------------------------------
// Writing the parts
// ---------------------------------------------------------------------------

type Parts = Record<Hand, Ev[][]>;

const lastNote = (bar: Ev[] | undefined) => {
  const e = bar?.[bar.length - 1];
  return e && e.abs !== null ? e : null;
};

function makeSubject(ctx: Ctx, hand: Hand): Ev[] {
  const { rng, grade, win } = ctx;
  const [lo, hi] = win[hand];
  // Begin on the tonic (or, from Grade 3, the fifth or third) in the lower half of the range.
  const degree = grade >= 3 ? rng.weighted([0, 4, 2], (d) => (d === 0 ? 3 : d === 4 ? 1.5 : 1)) : 0;
  const aim = lo + (hi - lo) * (hand === 'rh' ? 0.3 : 0.45);
  let start = lo;
  for (let a = lo; a <= hi; a++) if (mod(a, 7) === degree && Math.abs(a - aim) < Math.abs(start - aim)) start = a;
  if (mod(start, 7) !== degree) throw new Stuck();
  // A subject spans at most a sixth, so it can be answered in the other hand.
  const window: [number, number] = [Math.max(lo, start - 2), Math.min(hi, start + 5)];
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = rhythm(ctx, 'subject', null, 0, ctx.time.barTicks);
    if (r.length < Math.min(3, ctx.time.beatsPerBar) || (grade >= 2 && new Set(r).size < 2 && attempt < 20)) continue;
    const residue: (number | undefined)[] = [mod(start, 7)];
    const notes = fill(ctx, { b: 0, hand, rhythm: r, against: null, prev: null, pair: null, residue, window });
    // A subject with a shape: it should not just turn around one note.
    if (notes && (new Set(notes).size >= Math.min(4, notes.length - 1) || attempt > 20)) return notes.map((abs, i) => ({ abs, ticks: r[i] }));
  }
  throw new Stuck();
}

/** The transposition (≡ `degree`, mod 7) that puts the notes in a hand's range nearest its centre, or null. */
function fitShift(ctx: Ctx, notes: Ev[], hand: Hand, degree: number, window?: [number, number], near?: number): number | null {
  const [lo, hi] = window ?? ctx.win[hand];
  const pitched = notes.filter((e) => e.abs !== null).map((e) => e.abs!);
  if (!pitched.length) return degree;
  const min = Math.min(...pitched);
  const max = Math.max(...pitched);
  const target = near ?? (lo + hi) / 2 - (min + max) / 2 + min;
  let best: number | null = null;
  for (let s = lo - max - 7; s <= hi - min + 7; s++) {
    if (mod(s, 7) !== mod(degree, 7) || min + s < lo || max + s > hi) continue;
    if (best === null || Math.abs(pitched[0] + s - target) < Math.abs(pitched[0] + best - target)) best = s;
  }
  return best;
}

const shifted = (notes: Ev[], s: number): Ev[] => notes.map((e) => ({ ...e, abs: e.abs === null ? null : e.abs + s }));

function writeParts(ctx: Ctx, sections: Section[], subject: Ev[]): Parts {
  const { plan, time } = ctx;
  const n = plan.length;
  const parts: Parts = { rh: [], lh: [] };
  const B = time.barTicks;

  // Every entry's subject, fixed first, so the bars before can lead into it.
  const entries = new Map<number, { hand: Hand; notes: Ev[] }>();
  let bar = 0;
  for (const s of sections) {
    if (s.lead && s.kind !== 'episode') {
      const shift = fitShift(ctx, subject, s.lead, s.degree);
      if (shift === null) throw new Stuck();
      entries.set(bar, { hand: s.lead, notes: shifted(subject, shift) });
    }
    bar += s.bars;
  }

  const prevOf = (b: number, hand: Hand): Prev | null => {
    const e = lastNote(parts[hand][b - 1]);
    if (!e) return null;
    const evs = parts[hand][b - 1];
    const at = B - e.ticks;
    const before = evs.length > 1 ? evs[evs.length - 2].abs : null;
    return { abs: e.abs!, pitch: spell(ctx, b - 1, e.abs!, at), move: before === null ? 0 : e.abs! - before };
  };
  /** The previous bar's last sonority, seen from `hand`. */
  const pairFor = (b: number, hand: Hand): Pair | null => {
    const sound = (h: Hand) => {
      const e = lastNote(parts[h][b - 1]);
      return e ? midi(spell(ctx, b - 1, e.abs!, B - e.ticks)) : null;
    };
    const me = sound(hand);
    const other = sound(otherHand(hand));
    return me === null || other === null ? null : { me, other };
  };
  const nextOf = (b: number, hand: Hand) => {
    const e = entries.get(b + 1);
    if (!e || e.hand !== hand || e.notes[0].abs === null) return {};
    return { next: e.notes[0].abs, nextPitch: spell(ctx, b + 1, e.notes[0].abs, 0) };
  };

  /** A free part against `against`, retried with new rhythms, then with the rules eased. */
  const free = (b: number, hand: Hand, against: Ev[] | null, opts: { prefix?: Ev[]; window?: [number, number]; residue?: (number | undefined)[]; noNext?: boolean } = {}): Ev[] | null => {
    const prefix = opts.prefix ?? [];
    const from = prefix.reduce((a, e) => a + e.ticks, 0);
    for (let attempt = 0; attempt < 12; attempt++) {
      const relax = attempt < 6 ? 0 : attempt < 10 ? 1 : 2;
      const tail = from >= B ? [] : attempt < 9 ? rhythm(ctx, against ? 'free' : 'subject', against, from, B) : beats(ctx, from, B);
      const r = [...prefix.map((e) => e.ticks), ...tail];
      const fixed = prefix.map((e) => e.abs ?? undefined);
      const notes = fill(ctx, {
        b,
        hand,
        rhythm: r,
        against,
        againstPrev: lastNote(parts[otherHand(hand)][b - 1])?.abs ?? null,
        againstNext: entries.get(b + 1)?.hand === otherHand(hand) ? entries.get(b + 1)!.notes[0].abs : null,
        prev: prevOf(b, hand),
        pair: against ? pairFor(b, hand) : null,
        fixed,
        residue: opts.residue,
        window: opts.window,
        relax,
        ...(opts.noNext ? {} : nextOf(b, hand)),
      });
      if (notes) return notes.map((abs, i) => ({ abs, ticks: r[i] }));
    }
    return null;
  };
  /** Whether fixed notes obey the rules (a copied bar of a sequence, a reused countersubject). */
  const valid = (b: number, hand: Hand, notes: Ev[], against: Ev[] | null): boolean =>
    notes.every((e) => e.abs !== null) &&
    fill(ctx, {
      b,
      hand,
      rhythm: notes.map((e) => e.ticks),
      against,
      againstPrev: lastNote(parts[otherHand(hand)][b - 1])?.abs ?? null,
      prev: prevOf(b, hand),
      pair: against ? pairFor(b, hand) : null,
      fixed: notes.map((e) => e.abs!),
      ...nextOf(b, hand),
    }) !== null;
  const must = <T>(x: T | null): T => {
    if (x === null) throw new Stuck();
    return x;
  };

  let countersubject: { notes: Ev[]; shift: number; hand: Hand } | null = null;
  const answerShift = (b: number) => {
    const e = entries.get(b)!;
    return (e.notes[0].abs ?? 0) - (subject[0].abs ?? 0);
  };

  for (let b = 0; b < n; ) {
    const p = plan[b];
    const section = sections[p.section];
    if (p.kind === 'episode') {
      writeEpisode(b, section.bars, section.lead!);
      b += section.bars;
      continue;
    }
    if (p.kind === 'cadence') {
      writeCadence(b);
      b += 2;
      continue;
    }
    const { hand, notes } = entries.get(b)!;
    const other = otherHand(hand);
    // Transposed, the subject must still sing (no augmented step), and follow from the bar before.
    if (!valid(b, hand, notes, null)) throw new Stuck();
    parts[hand][b] = notes;
    if (p.kind === 'subject') {
      parts[other][b] = ctx.restOk ? splitTicks(B).map((ticks) => ({ abs: null, ticks })) : must(free(b, other, notes, { prefix: [] }));
    } else {
      // The countersubject returns (transposed, perhaps an octave away) where it still fits the rules.
      let cs: Ev[] | null = null;
      // (Not where it would only repeat the answer's bar.)
      if (countersubject && (answerShift(b) !== countersubject.shift || other !== countersubject.hand)) {
        const base = shifted(countersubject.notes, answerShift(b) - countersubject.shift);
        const [lo, hi] = ctx.win[other];
        for (const k of [0, -7, 7, -14, 14]) {
          const candidate = shifted(base, k);
          if (candidate.every((e) => e.abs! >= lo && e.abs! <= hi) && valid(b, other, candidate, notes)) {
            cs = candidate;
            break;
          }
        }
      }
      parts[other][b] = cs ?? must(free(b, other, notes));
      if (p.kind === 'answer') countersubject = { notes: parts[other][b], shift: answerShift(b), hand: other };
    }
    b++;
  }
  return parts;

  /** A sequence: a model bar on the subject's head, then copies a step lower each bar. */
  function writeEpisode(b0: number, length: number, lead: Hand): void {
    const other = otherHand(lead);
    const root = plan[b0].chords[0].root;
    const [lo, hi] = ctx.win[lead];
    const [olo, ohi] = ctx.win[other];
    // Room for the sequence to fall.
    const room = (w: [number, number]): [number, number] => [Math.min(w[0] + length - 1, w[1] - 4), w[1]];
    const headTicks = harmonySplit(time) ?? B;
    const unit = cellUnit(time);
    const head: Ev[] = [];
    let sum = 0;
    for (const e of subject) {
      if (sum + e.ticks > headTicks) break;
      head.push(e);
      sum += e.ticks;
    }
    while (head.length && head.reduce((a, e) => a + e.ticks, 0) % unit !== 0) head.pop();
    const previous = prevOf(b0, lead)?.abs;
    const headShift = head.length ? fitShift(ctx, head, lead, root, room([lo, hi]), previous) : null;
    let modelLead: Ev[] | null = null;
    let modelOther: Ev[] | null = null;
    for (let attempt = 0; attempt < 4 && !modelOther; attempt++) {
      const prefix = headShift !== null && attempt < 3 ? shifted(head, headShift) : [];
      modelLead = free(b0, lead, null, { prefix, window: room([lo, hi]), noNext: length > 1 });
      if (!modelLead) continue;
      parts[lead][b0] = modelLead;
      modelOther = free(b0, other, modelLead, { window: room([olo, ohi]) });
    }
    parts[lead][b0] = must(modelLead);
    parts[other][b0] = must(modelOther);
    for (let k = 1; k < length; k++) {
      const b = b0 + k;
      const l = shifted(modelLead!, -k);
      const o = shifted(modelOther!, -k);
      const fits = (notes: Ev[], h: Hand) => notes.every((e) => e.abs! >= ctx.win[h][0] && e.abs! <= ctx.win[h][1]);
      if (fits(l, lead) && valid(b, lead, l, null)) {
        parts[lead][b] = l;
        parts[other][b] = fits(o, other) && valid(b, other, o, l) ? o : must(free(b, other, l));
      } else {
        parts[lead][b] = must(free(b, lead, null));
        parts[other][b] = must(free(b, other, parts[lead][b]));
      }
    }
  }

  /** IV–V–I: the bass moves by root, the treble to the tonic — through a 4–3 suspension from Grade 3. */
  function writeCadence(P: number): void {
    const C = P + 1;
    const split = harmonySplit(time);
    const chords = plan[P].chords;
    const durations = ctx.spec.durations;
    const second = split === null ? 0 : B - split;
    const sus = second >= 8 ? 4 : second === 6 ? 4 : 2;
    const useSus =
      ctx.grade >= 3 && split !== null && durations.includes(sus) && durations.includes(second - sus) && second > sus && (!ctx.cons || ctx.cons.ties);
    // The bass: the chords' roots, one note each at Grades 1–2, moving within them later.
    const simple = ctx.grade <= 2 || (useSus && ctx.grade <= 3);
    let lhRhythm: number[];
    if (split === null) lhRhythm = simple ? splitTicks(B) : rhythm(ctx, 'free', parts.rh[P - 1] ?? null, 0, B);
    else if (useSus) lhRhythm = [...(simple ? splitTicks(split) : rhythm(ctx, 'free', null, 0, split)), ...splitTicks(second)];
    else lhRhythm = simple ? [...splitTicks(split), ...splitTicks(second)] : rhythm(ctx, 'free', null, 0, B);
    const lhAt = starts(lhRhythm);
    if (split !== null && !lhAt.includes(split)) lhRhythm = [...splitTicks(split), ...splitTicks(second)];
    const residue = starts(lhRhythm).map((t) => chords.find((c) => c.at === t)?.root);
    let lh: Ev[] | null = null;
    for (let attempt = 0; attempt < 8 && !lh; attempt++) {
      const notes = fill(ctx, { b: P, hand: 'lh', rhythm: lhRhythm, against: null, prev: prevOf(P, 'lh'), pair: null, residue, relax: attempt < 4 ? 0 : 1 });
      // With a suspension, the bass holds the dominant under it.
      if (notes) lh = notes.map((abs, i) => ({ abs, ticks: lhRhythm[i] }));
    }
    parts.lh[P] = must(lh);
    const lhBass = lh!;
    const vBass = lhBass[lhBass.length - 1].abs!;

    // The treble: to the leading note or the supertonic, which step to the tonic.
    let rh: Ev[] | null = null;
    if (useSus) {
      const firstHalf = lhBass.slice(0, starts(lhRhythm).indexOf(split!));
      for (let attempt = 0; attempt < 10 && !rh; attempt++) {
        const r = attempt < 8 ? rhythm(ctx, 'free', firstHalf, 0, split!) : beats(ctx, 0, split!);
        const res = [...Array(r.length - 1).fill(undefined), 0];
        const notes = fill(ctx, {
          b: P,
          hand: 'rh',
          rhythm: r,
          against: firstHalf,
          prev: prevOf(P, 'rh'),
          pair: pairFor(P, 'rh'),
          residue: res,
          relax: attempt < 6 ? 0 : 1,
        });
        if (!notes) continue;
        const prep = notes[notes.length - 1];
        // The resolution (the leading note) stays above the bass.
        if (prep - 1 <= vBass) continue;
        rh = [
          ...notes.map((abs, i) => ({ abs, ticks: r[i], tie: i === notes.length - 1 ? true : undefined })),
          { abs: prep, ticks: sus },
          { abs: prep - 1, ticks: second - sus },
        ];
      }
    }
    if (!rh) {
      for (let attempt = 0; attempt < 12 && !rh; attempt++) {
        const r = attempt < 9 ? rhythm(ctx, 'free', lhBass, 0, B) : beats(ctx, 0, B);
        const res = [...Array(r.length - 1).fill(undefined), undefined];
        const notes = fill(ctx, {
          b: P,
          hand: 'rh',
          rhythm: r,
          against: lhBass,
          prev: prevOf(P, 'rh'),
          pair: pairFor(P, 'rh'),
          residue: res,
          relax: attempt < 6 ? 0 : 1,
        });
        if (notes && [6, 1].includes(mod(notes[notes.length - 1], 7))) rh = notes.map((abs, i) => ({ abs, ticks: r[i] }));
      }
    }
    parts.rh[P] = must(rh);

    // The final chord: the tonic in both hands, a step from the treble's last note.
    const rhLast = lastNote(parts.rh[P])!.abs!;
    const rhTonic = rhLast + (mod(rhLast, 7) === 6 ? 1 : mod(rhLast, 7) === 1 ? -1 : 0);
    if (mod(rhTonic, 7) !== 0) throw new Stuck();
    const [llo, lhi] = ctx.win.lh;
    let lhTonic: number | null = null;
    for (let a = llo; a <= lhi; a++) {
      if (mod(a, 7) !== 0 || a >= rhTonic || Math.abs(a - vBass) > ctx.spec.maxBassLeap) continue;
      if (lhTonic === null || Math.abs(a - vBass) < Math.abs(lhTonic - vBass)) lhTonic = a;
    }
    if (lhTonic === null) throw new Stuck();
    const whole = (abs: number): Ev[] => {
      const ticks = splitTicks(B);
      return ticks.map((t, i) => ({ abs, ticks: t, tie: i < ticks.length - 1 ? true : undefined }));
    };
    parts.rh[C] = whole(rhTonic);
    parts.lh[C] = whole(lhTonic);
  }
}

// ---------------------------------------------------------------------------
// The piece
// ---------------------------------------------------------------------------

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** A chord's numeral from its spelling: upper case major, lower minor, ° diminished. */
function numeral(ctx: Ctx, b: number, root: number, at: number): string {
  const [r, third, fifth] = [0, 2, 4].map((d) => midi(spell(ctx, b, 28 + root + d, at)));
  const t = mod(third - r, 12);
  const f = mod(fifth - r, 12);
  const name = ROMAN[mod(root - ctx.plan[b].local.shift, 7)];
  if (t === 4) return f === 8 ? `${name}+` : name;
  return f === 6 ? `${name.toLowerCase()}°` : name.toLowerCase();
}

function chordSymbol(ctx: Ctx, b: number, c: Chord): string {
  const { local } = ctx.plan[b];
  const here = numeral(ctx, b, c.root, c.at);
  if (local.shift === 0) return here;
  // In another key: its tonic chord named in the home key, any other chord as of it ("V/V").
  const homeRoman = ROMAN[mod(local.shift, 7)];
  const tonic = local.key.mode === 'major' ? homeRoman : homeRoman.toLowerCase();
  return mod(c.root - local.shift, 7) === 0 ? tonic : `${here}/${tonic}`;
}

function chooseTempo(ctx: Ctx): Tempo {
  const { rng, grade, form, time } = ctx;
  const [slow, fast] = form === 'invention' ? [72, 100] : [66, 92];
  const crotchet = slow + ((fast - slow) * (grade - 1)) / 4 + rng.int(-4, 4);
  const even = (x: number) => Math.round(x / 2) * 2;
  const marking = form === 'invention' ? (grade <= 2 ? 'Moderato' : 'Allegretto') : grade <= 2 ? 'Andante' : 'Moderato';
  return time.compound ? { bpm: even(crotchet * 0.6), beatUnit: 'qd', marking } : { bpm: even(crotchet), beatUnit: 'q', marking };
}

function toPiece(ctx: Ctx, settings: Settings, sections: Section[], parts: Parts): Piece {
  const { key, time, plan } = ctx;
  const home = (abs: number) => degreeToPitch(key, 0, abs);
  const notes = (b: number, evs: Ev[]): Note[] => {
    const at = starts(evs.map((e) => e.ticks));
    return evs.map((e, i): Note => {
      if (e.abs === null) return { pitches: [], ticks: e.ticks, rest: true };
      const p = spell(ctx, b, e.abs, at[i]);
      const expected = home(e.abs).alter + (key.mode === 'minor' && mod(e.abs, 7) === 6 ? 1 : 0);
      const chromatic = p.alter !== home(e.abs).alter && p.alter !== expected;
      return { pitches: [p], ticks: e.ticks, ...(e.tie ? { tie: true } : {}), ...(chromatic ? { chromatic: true } : {}) };
    });
  };
  const bars: Bar[] = plan.map((p, b) => ({
    harmony: p.chords.map((c): Harmony => ({ symbol: chordSymbol(ctx, b, c), at: c.at })),
    rh: notes(b, parts.rh[b]),
    lh: notes(b, parts.lh[b]),
  }));
  const phrases: PhraseInfo[] = [];
  let startBar = 0;
  sections.forEach((s, i) => {
    phrases.push({
      startBar,
      bars: s.bars,
      ...(i === sections.length - 1 ? { cadence: 'PAC' as const } : {}),
      repeatsOpening: false,
      section: s.label,
      ...(s.local.shift !== 0 ? { key: keyName(s.local.key) } : {}),
    });
    startBar += s.bars;
  });
  const word = ctx.form === 'invention' ? 'Invention' : 'Fugue';
  return {
    title: `${word} in ${keyName(key)}`,
    seed: settings.seed,
    grade: settings.grade,
    form: ctx.form,
    key,
    mode: key.mode,
    time,
    tempo: chooseTempo(ctx),
    dynamic: 'mf',
    bars,
    phrases,
  };
}
