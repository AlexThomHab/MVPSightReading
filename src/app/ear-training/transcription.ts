/**
 * The listener's transcription in Ear Training: their own notes and rests, bar by bar, one
 * voice per stave. Pure functions over immutable data, so editing can be tested without a
 * score and undo is just keeping the previous value.
 *
 * Every voice always fills its bar exactly. Writing works like MuseScore's note input: a new
 * note or rest overwrites whatever stood where it goes (the remainder of a note it cuts short
 * becomes rests), and a note longer than the room left in the bar carries on, tied, into the
 * next bar. Durations are in ticks (semiquaver = 1, so a demisemiquaver is 0.5).
 */
import { Bar, Expression, Note, Piece } from '../music/model';
import { Key, LETTERS, Letter, Pitch, diatonicIndex, keySignatureAlter, midi, naturalAt } from '../music/theory';

export type Staff = 'rh' | 'lh';

export interface TranscribedBar {
  rh: Note[];
  lh: Note[];
}

export interface Transcription {
  bars: TranscribedBar[];
  /** Each bar's length in ticks (a chorale's upbeat and last bar are short). */
  lengths: number[];
  /** Compound time (6/8, 9/8): rests may be dotted, a dotted crotchet to a beat. */
  compound: boolean;
}

/** A note or rest in the transcription. */
export interface ElementRef {
  bar: number;
  staff: Staff;
  index: number;
}

/** A point in time on one stave: where the next note will go. */
export interface Position {
  bar: number;
  staff: Staff;
  tick: number;
}

/** The note values the editor writes, longest first: whole to demisemiquaver, plain and dotted. */
export const NOTE_TICKS: readonly number[] = [16, 12, 8, 6, 4, 3, 2, 1.5, 1, 0.75, 0.5];
const EPS = 1e-6;

/** A length as the fewest note values (longest first), e.g. 5 → [4, 1]. */
export function splitTicks(total: number): number[] {
  const out: number[] = [];
  let left = total;
  while (left > EPS) {
    const value = NOTE_TICKS.find((t) => t <= left + EPS);
    if (value === undefined) break;
    out.push(value);
    left -= value;
  }
  return out;
}

const PLAIN = [16, 8, 4, 2, 1, 0.5];
const multiple = (a: number, b: number) => Math.abs(a / b - Math.round(a / b)) < EPS;

/**
 * Rests filling [from, to) of a bar as they are written: a rest stays inside its beat (in
 * simple time starting on a multiple of its own length; in compound time on the quaver grid),
 * and crosses beats only to cover whole beats from a beat (a minim on beat 1 or 3 of 4/4, a
 * dotted crotchet per beat of 6/8). A whole bar is one rest where a value fits (a dotted minim
 * in 3/4).
 */
export function restsBetween(from: number, to: number, compound: boolean): Note[] {
  const beat = compound ? 6 : 4;
  const out: Note[] = [];
  let at = from;
  while (to - at > EPS) {
    const allowed = (v: number) => {
      if (at + v > to + EPS) return false;
      if (at < EPS && Math.abs(v - to) < EPS) return true;
      const plain = PLAIN.includes(v);
      const oneBeat = Math.floor(at / beat + EPS) === Math.floor((at + v) / beat - EPS);
      if (oneBeat) {
        if (multiple(at, beat) && Math.abs(v - beat) < EPS) return true;
        return plain && (compound && v >= 2 ? multiple(at, 2) : multiple(at, v));
      }
      return multiple(at, beat) && multiple(v, beat) && (compound ? multiple(v, 6) : plain && multiple(at, v));
    };
    const value = NOTE_TICKS.find(allowed) ?? splitTicks(to - at)[0];
    out.push({ pitches: [], ticks: value, rest: true });
    at += value;
  }
  return out;
}

/** Every bar of the piece, empty (rests) on both staves. */
export function emptyTranscription(piece: Piece): Transcription {
  const lengths = piece.bars.map((b) => b.rh.reduce((a, n) => a + n.ticks, 0));
  const compound = piece.time.compound;
  return { lengths, compound, bars: lengths.map((len) => ({ rh: restsBetween(0, len, compound), lh: restsBetween(0, len, compound) })) };
}

/** Where each element of a voice starts. */
export function onsets(voice: readonly Note[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const n of voice) {
    out.push(at);
    at += n.ticks;
  }
  return out;
}

export function elementOf(t: Transcription, ref: ElementRef): Note | undefined {
  return t.bars[ref.bar]?.[ref.staff][ref.index];
}

/** The element starting at (or, failing that, sounding at) a position. */
export function indexAt(t: Transcription, pos: Position): number {
  const voice = t.bars[pos.bar][pos.staff];
  const starts = onsets(voice);
  const exact = starts.findIndex((s) => Math.abs(s - pos.tick) < EPS);
  if (exact >= 0) return exact;
  let last = 0;
  starts.forEach((s, i) => {
    if (s < pos.tick) last = i;
  });
  return last;
}

export function positionOf(t: Transcription, ref: ElementRef): Position {
  return { bar: ref.bar, staff: ref.staff, tick: onsets(t.bars[ref.bar][ref.staff])[ref.index] ?? 0 };
}

/** A position moved past the end of its bar becomes the start of the next; null past the last bar. */
export function normalise(t: Transcription, pos: Position): Position | null {
  let { bar, tick } = pos;
  while (bar < t.lengths.length && tick >= t.lengths[bar] - EPS) {
    tick -= t.lengths[bar];
    bar++;
  }
  return bar < t.lengths.length ? { bar, staff: pos.staff, tick: Math.max(0, tick) } : null;
}

/**
 * Replaces [start, start + length) of a voice with `fill`: elements wholly inside go, one cut
 * at the start keeps its head, one cut at the end leaves rests for the rest of its length.
 */
function overwrite(voice: readonly Note[], start: number, length: number, fill: Note[], compound: boolean): Note[] {
  const end = start + length;
  const out: Note[] = [];
  let at = 0;
  let placed = false;
  const place = () => {
    if (!placed) out.push(...fill);
    placed = true;
  };
  for (const n of voice) {
    const s = at;
    const e = at + n.ticks;
    at = e;
    if (e <= start + EPS) {
      out.push(n);
      continue;
    }
    if (s >= end - EPS) {
      place();
      out.push(n);
      continue;
    }
    if (s < start - EPS) {
      const head = splitTicks(start - s);
      out.push(...head.map((ticks, i): Note => (n.rest ? { pitches: [], ticks, rest: true } : { ...n, ticks, tie: i < head.length - 1 })));
    }
    place();
    if (e > end + EPS) out.push(...restsBetween(end, e, compound));
  }
  place();
  return out;
}

/** Drops ties that no longer lead to the same notes (after an edit changed what follows). */
function tidyTies(t: Transcription): Transcription {
  for (const staff of ['rh', 'lh'] as const) {
    const all = t.bars.flatMap((b) => b[staff]);
    all.forEach((n, i) => {
      if (!n.tie) return;
      const next = all[i + 1];
      const same = next && !next.rest && !n.rest && next.pitches.length === n.pitches.length && next.pitches.every((p, k) => midi(p) === midi(n.pitches[k]));
      if (!same) delete n.tie;
    });
  }
  return t;
}

const copy = (t: Transcription): Transcription => structuredClone(t);

export interface WriteResult {
  transcription: Transcription;
  /** The first element written (where the selection goes). */
  placed: ElementRef;
  /** Where the next note goes, or null at the end of the piece. */
  next: Position | null;
}

/**
 * Writes a note (or a rest, when `pitches` is null) of `ticks` at a position, overwriting
 * what was there; across a bar line it is split and tied. Past the last bar it is cut short.
 */
export function write(t: Transcription, pos: Position, ticks: number, pitches: readonly Pitch[] | null): WriteResult {
  const out = copy(t);
  const sorted = pitches ? [...pitches].sort((a, b) => midi(a) - midi(b)) : null;
  const written: ElementRef[] = [];
  let left = ticks;
  let at: Position | null = { ...pos };
  while (left > EPS && at) {
    const room = out.lengths[at.bar] - at.tick;
    const take = Math.min(left, room);
    const fill = splitTicks(take).map((d): Note => (sorted ? { pitches: sorted.map((p) => ({ ...p })), ticks: d } : { pitches: [], ticks: d, rest: true }));
    const voice = overwrite(out.bars[at.bar][at.staff], at.tick, take, fill, out.compound);
    out.bars[at.bar][at.staff] = voice;
    const tick = at.tick;
    const first = onsets(voice).findIndex((s) => Math.abs(s - tick) < EPS);
    const { bar, staff } = at;
    fill.forEach((_, k) => written.push({ bar, staff, index: first + k }));
    left -= take;
    at = normalise(out, { ...at, tick: at.tick + take });
  }
  // A note split into pieces (or carried over the bar line) is tied piece to piece.
  if (sorted) written.slice(0, -1).forEach((r) => (out.bars[r.bar][r.staff][r.index].tie = true));
  return { transcription: tidyTies(out), placed: written[0], next: at };
}

/** Adds a note to the chord at `ref` (a rest there becomes that note). */
export function addToChord(t: Transcription, ref: ElementRef, pitch: Pitch): Transcription {
  const out = copy(t);
  const n = out.bars[ref.bar][ref.staff][ref.index];
  if (!n) return t;
  if (n.rest) {
    out.bars[ref.bar][ref.staff][ref.index] = { pitches: [{ ...pitch }], ticks: n.ticks };
  } else if (!n.pitches.some((p) => midi(p) === midi(pitch))) {
    n.pitches = [...n.pitches, { ...pitch }].sort((a, b) => midi(a) - midi(b));
  }
  return tidyTies(out);
}

/** Changes every pitch of a note (a rest is left alone). */
export function mapPitches(t: Transcription, ref: ElementRef, change: (p: Pitch) => Pitch): Transcription {
  const n = elementOf(t, ref);
  if (!n || n.rest) return t;
  const out = copy(t);
  const target = out.bars[ref.bar][ref.staff][ref.index];
  target.pitches = target.pitches.map(change).sort((a, b) => midi(a) - midi(b));
  return tidyTies(out);
}

/** Gives a note or rest a new length from where it starts, overwriting what follows (or leaving rests). */
export function setDuration(t: Transcription, ref: ElementRef, ticks: number): WriteResult | null {
  const n = elementOf(t, ref);
  if (!n) return null;
  return write(t, positionOf(t, ref), ticks, n.rest ? null : n.pitches);
}

/** Turns a note into a rest of the same length. */
export function clearElement(t: Transcription, ref: ElementRef): Transcription {
  const n = elementOf(t, ref);
  if (!n || n.rest) return t;
  const out = copy(t);
  const from = positionOf(t, ref).tick;
  out.bars[ref.bar][ref.staff].splice(ref.index, 1, ...restsBetween(from, from + n.ticks, t.compound));
  return tidyTies(out);
}

/** The element before or after, across bar lines (null at either end). */
export function step(t: Transcription, ref: ElementRef, by: 1 | -1): ElementRef | null {
  const voice = t.bars[ref.bar][ref.staff];
  const index = ref.index + by;
  if (index >= 0 && index < voice.length) return { ...ref, index };
  const bar = ref.bar + by;
  if (bar < 0 || bar >= t.bars.length) return null;
  return { bar, staff: ref.staff, index: by > 0 ? 0 : t.bars[bar][ref.staff].length - 1 };
}

// ---------------------------------------------------------------------------
// Pitches
// ---------------------------------------------------------------------------

const SHARP_NAMES: [Letter, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_NAMES: [Letter, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** A MIDI note spelled with sharps (rising) or flats (falling). */
export function spell(m: number, sharps: boolean): Pitch {
  const [letter, alter] = (sharps ? SHARP_NAMES : FLAT_NAMES)[((m % 12) + 12) % 12];
  return { letter, alter, octave: Math.floor(m / 12) - 1 };
}

/** Up or down by semitones, spelled the way the move goes (as MuseScore's arrow keys do). */
export function transpose(p: Pitch, semitones: number): Pitch {
  if (semitones % 12 === 0) return { ...p, octave: p.octave + semitones / 12 };
  return spell(midi(p) + semitones, semitones > 0);
}

/**
 * The pitch written on a line or space: natural, or as the key signature has it when the key
 * signature is shown (a note on the F line in G major is F♯).
 */
export function pitchAt(diatonic: number, key: Key | null): Pitch {
  const natural = naturalAt(diatonic);
  return { ...natural, alter: key ? keySignatureAlter(key, natural.letter) : 0 };
}

/** The octave of a letter nearest the previous note (or the middle of the stave), as MuseScore picks it. */
export function nearestLetter(letter: Letter, near: Pitch | null, staff: Staff): number {
  const centre = near ? diatonicIndex(near) : staff === 'rh' ? diatonicIndex({ letter: 'B', alter: 0, octave: 4 }) : diatonicIndex({ letter: 'D', alter: 0, octave: 3 });
  const step = LETTERS.indexOf(letter);
  const base = Math.floor(centre / 7) * 7 + step;
  return [base - 7, base, base + 7].reduce((best, d) => (Math.abs(d - centre) < Math.abs(best - centre) ? d : best));
}

// ---------------------------------------------------------------------------
// Into pieces: for the score and for playback
// ---------------------------------------------------------------------------

/** The transcription as a piece of its own (same key, metre and tempo), to play back. */
export function transcriptionPiece(piece: Piece, t: Transcription): Piece {
  return {
    ...piece,
    bars: t.bars.map((b): Bar => ({ harmony: [], rh: b.rh, lh: b.lh })),
    expression: undefined,
    dynamic: '',
  };
}

/**
 * What the Ear Training score shows: the original in revealed bars, the listener's own notes
 * everywhere else. Expression marks stay only where every bar they touch is revealed.
 */
export function displayPiece(piece: Piece, t: Transcription, revealed: ReadonlySet<number>): Piece {
  const shown = (from: number, to: number) => {
    for (let b = from; b <= to; b++) if (!revealed.has(b)) return false;
    return true;
  };
  const e = piece.expression;
  const expression: Expression | undefined = e && {
    dynamics: e.dynamics.filter((d) => revealed.has(d.at.bar)),
    hairpins: e.hairpins.filter((h) => shown(h.from.bar, h.to.bar)),
    slurs: e.slurs.filter((s) => shown(s.from.bar, s.to.bar)),
  };
  return {
    ...piece,
    bars: piece.bars.map((b, i): Bar => (revealed.has(i) ? b : { harmony: b.harmony, rh: t.bars[i].rh, lh: t.bars[i].lh })),
    expression,
    dynamic: revealed.has(0) ? piece.dynamic : '',
  };
}
