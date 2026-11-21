/**
 * Turns a Piece (or a range of its bars) into timed playback events.
 *
 * Pure and independent of Tone.js, so the exact boundaries of a bar or range can be
 * unit-tested. Times are in seconds from the start of playback.
 */
import { DynamicMark, Note, Piece } from '../music/model';
import { midi } from '../music/theory';
import { totalTicks } from '../music/durations';

export interface PlayOptions {
  /** First bar to play (0-based). Defaults to the first bar. */
  fromBar?: number;
  /** Last bar to play, inclusive (0-based). Defaults to the last bar. */
  toBar?: number;
  /** Click a bar's worth of beats before the music. Defaults to true. */
  countIn?: boolean;
}

export interface ScheduledNote {
  time: number;
  duration: number;
  midis: number[];
  velocity: number;
  bar: number;
}

export interface Schedule {
  clicks: { time: number; accent: boolean }[];
  notes: ScheduledNote[];
  /** When each played bar starts, for the current-bar indicator. */
  bars: { bar: number; time: number }[];
  /** When the last note of the range ends. */
  end: number;
}

type VoiceName = 's' | 'a' | 't' | 'b' | 'rh' | 'lh';

/** Bar lengths in ticks (a chorale's upbeat and final bar are shorter than the time signature). */
export function barLengths(piece: Piece): number[] {
  return piece.bars.map((b) => totalTicks(b.rh));
}

export function buildSchedule(piece: Piece, bpm: number, options: PlayOptions = {}): Schedule {
  const n = piece.bars.length;
  const from = Math.max(0, Math.min(options.fromBar ?? 0, n - 1));
  const to = Math.max(from, Math.min(options.toBar ?? n - 1, n - 1));
  const countIn = options.countIn ?? true;

  const secondsPerTick = 60 / bpm / piece.time.beatTicks;
  const beatSeconds = secondsPerTick * piece.time.beatTicks;
  const lengths = barLengths(piece);
  const barStarts: number[] = [];
  lengths.reduce((start, ticks, i) => ((barStarts[i] = start), start + ticks), 0);
  const startTick = barStarts[from];
  const endTick = barStarts[to] + lengths[to];

  // Count in from the rest of the bar when the music starts on an upbeat.
  let clickCount = 0;
  if (countIn) {
    const short = from === 0 && lengths[0] < piece.time.barTicks;
    clickCount = short ? (piece.time.barTicks - lengths[0]) / piece.time.beatTicks : piece.time.beatsPerBar;
  }
  const countInSeconds = clickCount * beatSeconds;
  const clicks = Array.from({ length: clickCount }, (_, beat) => ({ time: beat * beatSeconds, accent: beat === 0 }));

  // Fermatas hold the chord for longer and delay everything after them.
  const fermataHold = beatSeconds * 0.9;
  const fermataEnds: number[] = [];
  let t = 0;
  for (const bar of piece.bars) {
    for (const note of bar.rh) {
      if (note.fermata) fermataEnds.push(t + note.ticks);
      t += note.ticks;
    }
  }
  // The written tempo changes: rit. and accel. glide to their factor by the next mark (or the
  // end); Più mosso, a tempo… change it at once. Time is the integral of 1 / factor.
  const total = barStarts[n - 1] + lengths[n - 1];
  const tickOfRh = (bar: number, index: number) => barStarts[bar] + totalTicks(piece.bars[bar].rh.slice(0, index));
  const tempoMarks = (piece.expression?.tempos ?? []).map((m) => ({ ...m, tick: tickOfRh(m.at.bar, m.at.index) })).sort((a, b) => a.tick - b.tick);
  const factorAt = (tick: number): number => {
    let factor = 1;
    for (let k = 0; k < tempoMarks.length; k++) {
      const m = tempoMarks[k];
      if (m.tick > tick) break;
      if (m.kind === 'set') factor = m.factor;
      else {
        const end = tempoMarks[k + 1]?.tick ?? total;
        const t = end > m.tick ? Math.min(1, (tick - m.tick) / (end - m.tick)) : 1;
        factor = factor + (m.factor - factor) * t;
        if (tick >= end) factor = m.factor;
      }
    }
    return factor;
  };
  const GRID = 6;
  const elapsed: number[] = [0];
  for (let i = 1; i <= Math.ceil(total * GRID); i++) elapsed[i] = elapsed[i - 1] + secondsPerTick / GRID / factorAt((i - 0.5) / GRID);
  const at = (tick: number) => {
    const x = Math.max(0, Math.min(tick * GRID, elapsed.length - 1));
    const i = Math.floor(x);
    return elapsed[i] + (elapsed[Math.min(i + 1, elapsed.length - 1)] - elapsed[i]) * (x - i);
  };
  const timeOf = (tick: number) => countInSeconds + (at(tick) - at(startTick)) + fermataHold * fermataEnds.filter((e) => e > startTick && e <= tick).length;

  // The right pedal holds every note struck while it is down until it lifts; una corda softens.
  const tickOfLh = (bar: number, index: number) => barStarts[bar] + totalTicks(piece.bars[bar].lh.slice(0, index));
  const pedalSpans = (piece.expression?.pedals ?? []).map((p) => [tickOfLh(p.from.bar, p.from.index), tickOfLh(p.to.bar, p.to.index) + (piece.bars[p.to.bar].lh[p.to.index]?.ticks ?? 0)] as const);
  const softSpans = (piece.expression?.unaCorda ?? []).map((u) => [tickOfRh(u.from.bar, u.from.index), tickOfRh(u.to.bar, u.to.index) + (piece.bars[u.to.bar].rh[u.to.index]?.ticks ?? 0)] as const);
  const inside = (spans: readonly (readonly [number, number])[], tick: number) => spans.find(([a, z]) => tick >= a - 1e-6 && tick < z - 1e-6);

  const loudness = piece.expression ? dynamicCurve(piece, barStarts) : null;

  // Each voice: chorales have four, piano music two (right and left hand).
  const voices: [VoiceName, number][] = piece.bars[0].voices
    ? [['s', 0.72], ['a', 0.5], ['t', 0.5], ['b', 0.62]]
    : [['rh', 0.75], ['lh', 0.55]];
  const notes: ScheduledNote[] = [];
  for (const [name, velocity] of voices) {
    const line: { note: Note; start: number; bar: number }[] = piece.bars.flatMap((bar, i) => {
      const list = name === 'rh' || name === 'lh' ? bar[name] : bar.voices![name];
      let tick = barStarts[i];
      return list.map((note) => ({ note, start: (tick += note.ticks) - note.ticks, bar: i }));
    });
    for (let i = 0; i < line.length; i++) {
      const { note, start, bar } = line[i];
      if (start < startTick || start >= endTick) continue;
      // A tied note sounds once, for the combined length — but never past the range.
      let last = line[i];
      while (last.note.tie && line[i + 1] && line[i + 1].start < endTick) last = line[++i];
      if (note.rest) continue;
      // With written dynamics, loudness follows them (the left hand a little under the melody).
      const shaped = loudness ? loudness(start) * (velocity / voices[0][1]) : velocity;
      const accent = note.articulation === 'accent' ? 1.18 : 1;
      const soft = inside(softSpans, start) ? 0.72 : 1;
      const length = note.articulation === 'staccato' ? 0.45 : 0.95;
      const pedalled = inside(pedalSpans, start);
      const ends = Math.min(endTick, Math.max(last.start + last.note.ticks, pedalled ? pedalled[1] : 0));
      const event = {
        time: timeOf(start),
        // timeOf() already adds the fermata's hold at the end of a fermata note.
        duration: (timeOf(ends) - timeOf(start)) * (pedalled ? 1 : length),
        midis: note.pitches.map(midi),
        velocity: Math.min(1, shaped * accent * soft),
        bar,
      };
      if (note.grace || note.ornament) notes.push(...ornamented(event, note, beatSeconds));
      else if (note.spread && event.midis.length > 1) {
        // A spread chord rolls up from the bottom note.
        [...event.midis].sort((a, b) => a - b).forEach((m, k) => notes.push({ ...event, time: event.time + k * 0.035, duration: Math.max(0.05, event.duration - k * 0.035), midis: [m] }));
      } else notes.push(event);
    }
  }
  notes.sort((a, b) => a.time - b.time);

  const bars = Array.from({ length: to - from + 1 }, (_, k) => ({ bar: from + k, time: timeOf(barStarts[from + k]) }));
  return { clicks, notes, bars, end: timeOf(endTick) };
}

/**
 * A note with its grace notes and ornament played out: grace notes crushed in on the beat;
 * a turn as upper–main–lower–main, then the note held; a trill alternating with the note
 * above, ending on the note.
 */
export function ornamented(event: ScheduledNote, note: Note, beatSeconds: number): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  let t = event.time;
  let left = event.duration;
  const play = (duration: number, pitch: number) => {
    out.push({ ...event, time: t, duration, midis: [pitch] });
    t += duration;
    left -= duration;
  };
  const main = event.midis[0];
  for (const g of note.grace ?? []) play(Math.min(0.07, left * 0.2), midi(g));
  const o = note.ornament;
  if (o?.type === 'turn') {
    const step = Math.min(beatSeconds / 4, left / 6);
    for (const p of [midi(o.upper), main, o.lower ? midi(o.lower) : main]) play(step, p);
  } else if (o?.type === 'trill') {
    const step = Math.max(0.06, Math.min(beatSeconds / 8, 0.11));
    for (let k = 0; left > step * 2.5; k++) play(step, k % 2 ? midi(o.upper) : main);
  }
  out.push({ ...event, time: t, duration: left, midis: event.midis });
  return out;
}

const LEVEL: Record<DynamicMark, number> = { pp: 0.3, p: 0.4, mp: 0.52, mf: 0.63, f: 0.76, ff: 0.88 };

/**
 * Loudness (0–1) at any tick, from the written dynamics and hairpins: each dynamic holds until
 * the next, and a hairpin glides from the level at its start to the next written dynamic
 * (or one step up or down if none follows soon).
 */
function dynamicCurve(piece: Piece, barStarts: number[]): (tick: number) => number {
  const expression = piece.expression!;
  const tickOf = (bar: number, index: number) =>
    barStarts[bar] + totalTicks(piece.bars[bar].rh.slice(0, index));
  const marks = expression.dynamics
    .map((d) => ({ tick: tickOf(d.at.bar, d.at.index), level: LEVEL[d.mark] }))
    .sort((a, b) => a.tick - b.tick);
  const steady = (tick: number) => {
    let level = marks[0]?.level ?? LEVEL.mf;
    for (const m of marks) if (m.tick <= tick) level = m.level;
    return level;
  };
  const ramps = expression.hairpins.map((h) => {
    const from = tickOf(h.from.bar, h.from.index);
    const to = tickOf(h.to.bar, h.to.index);
    const start = steady(from);
    const next = marks.find((m) => m.tick > from && m.tick <= to + 8);
    const end = next ? next.level : start + (h.type === 'cresc' ? 0.12 : -0.12);
    return { from, to, start, end };
  });
  return (tick) => {
    const ramp = ramps.find((r) => tick >= r.from && tick <= r.to);
    if (!ramp) return steady(tick);
    const t = ramp.to > ramp.from ? (tick - ramp.from) / (ramp.to - ramp.from) : 1;
    return ramp.start + (ramp.end - ramp.start) * t;
  };
}
