/**
 * Checking a transcription against the original, stave by stave and bar by bar. Only the
 * bars and staves the listener has attempted are checked; an untouched one never counts.
 *
 * Notes are compared as events (a pitch sounding from a tick for a length), not by their
 * place in the bar's list, so one missing or extra note does not throw out every note after
 * it. Events are paired in three passes — same beat and pitch, then same beat, then same
 * pitch nearest in time — and each expected note is worth one point, split equally between
 * pitch, length and position. An extra note adds a point that cannot be earned, so entering
 * one right note in a busy bar, or every note on the keyboard, cannot score 100%.
 */
import { lengthName } from '../music/durations';
import { Note, Piece } from '../music/model';
import { TimeSignature } from '../music/grades';
import { Pitch, midi, pitchName } from '../music/theory';
import { Staff, Transcription } from './transcription';

/** A pitch sounding in a bar: where it starts and how long it is written. */
interface NoteEvent {
  tick: number;
  ticks: number;
  pitch: Pitch;
  /** The listener's events: which element and notehead drew it. */
  index?: number;
  key?: number;
}

export type Verdict = 'correct' | 'wrong' | 'extra';

/** How one of the listener's noteheads was judged, with what to tell them. */
export interface NoteMark {
  index: number;
  key: number;
  verdict: Verdict;
  /** What is wrong, without giving the answer away (e.g. "Wrong pitch"). */
  hint: string;
  /** The answer, for Review Mistakes (e.g. "Expected: G4 crotchet · Your answer: A4 crotchet"). */
  detail: string;
}

/** An expected note the listener left out (shown only when reviewing mistakes). */
export interface MissingNote {
  tick: number;
  ticks: number;
  pitch: Pitch;
}

export interface StaffResult {
  bar: number;
  staff: Staff;
  /** Points earned and available (one per expected note, plus one per extra note). */
  earned: number;
  possible: number;
  /** 0–100. */
  percent: number;
  /** The original was already showing: the score is not a fair test. */
  revealed: boolean;
  marks: NoteMark[];
  missing: MissingNote[];
}

export interface CheckResult {
  /** Attempted bar/stave pairs, in bar order (treble before bass). */
  staves: StaffResult[];
  /** Weighted across every attempted, unrevealed stave by its notes; null when nothing counts. */
  percent: number | null;
  barCount: number;
}

const EPS = 1e-6;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;


/** "beat 2", "beat 2½" — where a tick falls in the bar, counted in the time signature's beats. */
export function beatName(tick: number, time: TimeSignature): string {
  const beat = tick / time.beatTicks + 1;
  const whole = Math.floor(beat + EPS);
  const part = beat - whole;
  const fraction = same(part, 0) ? '' : same(part, 0.5) ? '½' : same(part, 0.25) ? '¼' : same(part, 0.75) ? '¾' : same(part, 1 / 3) ? '⅓' : same(part, 2 / 3) ? '⅔' : `.${Math.round(part * 100)}`;
  return `beat ${whole}${fraction}`;
}

function eventsOf(voices: readonly (readonly Note[])[], withRefs: boolean): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const voice of voices) {
    let tick = 0;
    voice.forEach((n, index) => {
      if (!n.rest) n.pitches.forEach((pitch, key) => out.push({ tick, ticks: n.ticks, pitch, ...(withRefs ? { index, key } : {}) }));
      tick += n.ticks;
    });
  }
  return out;
}

/** The original's notes on one stave of one bar (a chorale's two voices per stave together). */
function expectedEvents(piece: Piece, bar: number, staff: Staff): NoteEvent[] {
  const b = piece.bars[bar];
  if (b.voices) return eventsOf(staff === 'rh' ? [b.voices.s, b.voices.a] : [b.voices.t, b.voices.b], false);
  return eventsOf([b[staff]], false);
}

interface Pair {
  expected: NoteEvent;
  answer: NoteEvent;
}

/** Pairs expected and entered events: same beat and pitch, then same beat, then same pitch. */
function match(expected: NoteEvent[], answer: NoteEvent[]): { pairs: Pair[]; missing: NoteEvent[]; extra: NoteEvent[] } {
  const e = new Set(expected);
  const a = new Set(answer);
  const pairs: Pair[] = [];
  const take = (x: NoteEvent, y: NoteEvent) => {
    pairs.push({ expected: x, answer: y });
    e.delete(x);
    a.delete(y);
  };
  // 1. Same beat, same pitch (the right length first).
  for (const x of [...e]) {
    const candidates = [...a].filter((y) => same(y.tick, x.tick) && midi(y.pitch) === midi(x.pitch));
    const best = candidates.find((y) => same(y.ticks, x.ticks)) ?? candidates[0];
    if (best) take(x, best);
  }
  // 2. Same beat, another pitch: low to high, note for note.
  const ticks = [...new Set([...e].map((x) => x.tick))];
  for (const t of ticks) {
    const xs = [...e].filter((x) => same(x.tick, t)).sort((p, q) => midi(p.pitch) - midi(q.pitch));
    const ys = [...a].filter((y) => same(y.tick, t)).sort((p, q) => midi(p.pitch) - midi(q.pitch));
    xs.slice(0, ys.length).forEach((x, i) => take(x, ys[i]));
  }
  // 3. Same pitch, another beat: the nearest.
  for (const x of [...e]) {
    const candidates = [...a].filter((y) => midi(y.pitch) === midi(x.pitch)).sort((p, q) => Math.abs(p.tick - x.tick) - Math.abs(q.tick - x.tick));
    if (candidates[0]) take(x, candidates[0]);
  }
  return { pairs, missing: [...e], extra: [...a] };
}

const describe = (ev: NoteEvent) => `${pitchName(ev.pitch)} ${lengthName(ev.ticks)}`;

function judge(pair: Pair, time: TimeSignature): { credit: number; mark: NoteMark } {
  const { expected: x, answer: y } = pair;
  const pitch = midi(x.pitch) === midi(y.pitch);
  const length = same(x.ticks, y.ticks);
  const place = same(x.tick, y.tick);
  const credit = ((pitch ? 1 : 0) + (length ? 1 : 0) + (place ? 1 : 0)) / 3;
  const base = { index: y.index!, key: y.key! };
  if (pitch && length && place) return { credit, mark: { ...base, verdict: 'correct', hint: 'Correct', detail: 'Correct' } };
  let hint: string;
  if (!place) hint = pitch ? 'Right note, in the wrong place' : 'Wrong note, in the wrong place';
  else if (!pitch && !length) hint = 'Wrong pitch and length';
  else if (!pitch) hint = 'Wrong pitch';
  else hint = 'Right pitch, wrong length';
  const detail = !place
    ? `Expected: ${describe(x)} on ${beatName(x.tick, time)} · Your answer: ${describe(y)} on ${beatName(y.tick, time)}`
    : pitch
      ? `Correct pitch, wrong length · Expected: ${lengthName(x.ticks)} · Entered: ${lengthName(y.ticks)}`
      : `Expected: ${describe(x)} · Your answer: ${describe(y)}`;
  return { credit, mark: { ...base, verdict: 'wrong', hint, detail } };
}

/** Checks one bar of one stave. */
export function checkStaff(piece: Piece, t: Transcription, bar: number, staff: Staff, revealed: boolean): StaffResult {
  const expected = expectedEvents(piece, bar, staff);
  const answer = eventsOf([t.bars[bar][staff]], true);
  const { pairs, missing, extra } = match(expected, answer);
  const marks: NoteMark[] = [];
  let earned = 0;
  for (const p of pairs) {
    const { credit, mark } = judge(p, piece.time);
    earned += credit;
    marks.push(mark);
  }
  for (const y of extra) {
    marks.push({ index: y.index!, key: y.key!, verdict: 'extra', hint: 'Not in the original', detail: `Not in the original: ${describe(y)} on ${beatName(y.tick, piece.time)}` });
  }
  // A bar of rest answered with rests is right; anything else is out of the notes expected and entered.
  let possible = expected.length + extra.length;
  if (possible === 0) {
    possible = 1;
    earned = 1;
  }
  return {
    bar,
    staff,
    earned,
    possible,
    percent: Math.round((earned / possible) * 100),
    revealed,
    marks,
    missing: missing.map((m) => ({ tick: m.tick, ticks: m.ticks, pitch: m.pitch })),
  };
}

export const staffKey = (bar: number, staff: Staff) => `${bar}:${staff}`;

/**
 * Checks every attempted bar/stave. The overall score is weighted by notes (not an average
 * of bar scores) and leaves out bars whose answer was already revealed.
 */
export function checkAnswers(piece: Piece, t: Transcription, attempted: ReadonlySet<string>, revealed: ReadonlySet<number>): CheckResult {
  const staves: StaffResult[] = [];
  piece.bars.forEach((_, bar) => {
    for (const staff of ['rh', 'lh'] as const) {
      if (attempted.has(staffKey(bar, staff))) staves.push(checkStaff(piece, t, bar, staff, revealed.has(bar)));
    }
  });
  const counted = staves.filter((s) => !s.revealed);
  const possible = counted.reduce((a, s) => a + s.possible, 0);
  const earned = counted.reduce((a, s) => a + s.earned, 0);
  return { staves, percent: possible ? Math.round((earned / possible) * 100) : null, barCount: piece.bars.length };
}

/** "2 of 8 bars attempted · Treble clef only". */
export function summarise(result: CheckResult): string {
  const bars = new Set(result.staves.map((s) => s.bar)).size;
  const rh = result.staves.some((s) => s.staff === 'rh');
  const lh = result.staves.some((s) => s.staff === 'lh');
  const clefs = rh && lh ? 'Both clefs' : rh ? 'Treble clef only' : 'Bass clef only';
  return `${bars} of ${result.barCount} bar${result.barCount === 1 ? '' : 's'} attempted · ${clefs}`;
}

/** One row of the breakdown: an attempted bar/stave, or a run of untouched bars on a stave. */
export interface BreakdownRow {
  bars: string;
  staff: Staff;
  /** Absent for a run of untouched bars. */
  result?: StaffResult;
}

/** Per stave: each attempted bar on its own row, untouched bars gathered into runs ("1–3"). */
export function breakdown(result: CheckResult): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  for (const staff of ['rh', 'lh'] as const) {
    let run: number[] = [];
    const flush = () => {
      if (run.length) rows.push({ bars: run.length === 1 ? `${run[0] + 1}` : `${run[0] + 1}–${run[run.length - 1] + 1}`, staff });
      run = [];
    };
    for (let bar = 0; bar < result.barCount; bar++) {
      const r = result.staves.find((s) => s.bar === bar && s.staff === staff);
      if (r) {
        flush();
        rows.push({ bars: `${bar + 1}`, staff, result: r });
      } else {
        run.push(bar);
      }
    }
    flush();
  }
  return rows;
}
