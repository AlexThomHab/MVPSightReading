/**
 * Turns a Piece (or a range of its bars) into timed playback events.
 *
 * Pure and independent of Tone.js, so the exact boundaries of a bar or range can be
 * unit-tested. Times are in seconds from the start of playback.
 */
import { Note, Piece } from '../music/generator';
import { midi } from '../music/theory';

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
  return piece.bars.map((b) => b.rh.reduce((a, n) => a + n.ticks, 0));
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
  const timeOf = (tick: number) =>
    countInSeconds +
    (tick - startTick) * secondsPerTick +
    fermataHold * fermataEnds.filter((e) => e > startTick && e <= tick).length;

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
      notes.push({
        time: timeOf(start),
        // timeOf() already adds the fermata's hold at the end of a fermata note.
        duration: (timeOf(last.start + last.note.ticks) - timeOf(start)) * 0.95,
        midis: note.pitches.map(midi),
        velocity,
        bar,
      });
    }
  }
  notes.sort((a, b) => a.time - b.time);

  const bars = Array.from({ length: to - from + 1 }, (_, k) => ({ bar: from + k, time: timeOf(barStarts[from + k]) }));
  return { clicks, notes, bars, end: timeOf(endTick) };
}
