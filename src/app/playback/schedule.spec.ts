import { generatePiece, Piece } from '../music/generator';
import { midi } from '../music/theory';
import { barLengths, buildSchedule } from './schedule';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const pieces: Piece[] = [
  generatePiece({ seed: 'sched-1', grade: 5, style: 'classical' }),
  generatePiece({ seed: 'sched-2', grade: 4, style: 'waltz', timeId: '6/8' }),
  generatePiece({ seed: 'sched-3', grade: 2, style: 'march' }),
  generatePiece({ seed: 'sched-4', grade: 5, style: 'chorale' }),
];

/** Seconds a run of bars lasts at a tempo, counting fermata holds. */
function seconds(p: Piece, bpm: number, from: number, to: number): number {
  const spt = 60 / bpm / p.time.beatTicks;
  const lengths = barLengths(p);
  let ticks = 0;
  let fermatas = 0;
  for (let b = from; b <= to; b++) {
    ticks += lengths[b];
    fermatas += p.bars[b].rh.filter((n) => n.fermata).length;
  }
  return ticks * spt + fermatas * spt * p.time.beatTicks * 0.9;
}

describe('buildSchedule', () => {
  it('plays only the notes of a single selected bar, starting after the count-in', () => {
    for (const p of pieces) {
      for (let bar = 0; bar < p.bars.length; bar++) {
        const s = buildSchedule(p, 90, { fromBar: bar, toBar: bar });
        const countIn = s.clicks.length * (60 / 90);
        expect(s.notes.every((n) => n.bar === bar), p.title).toBe(true);
        expect(s.bars.map((b) => b.bar)).toEqual([bar]);
        expect(close(s.notes[0].time, countIn), `${p.title} bar ${bar + 1}`).toBe(true);
        expect(close(s.end - countIn, seconds(p, 90, bar, bar)), `${p.title} bar ${bar + 1}`).toBe(true);
        // Nothing sounds past the end of the bar.
        for (const n of s.notes) expect(n.time + n.duration).toBeLessThanOrEqual(s.end + 1e-9);
      }
    }
  });

  it('plays exactly the notes of a bar range, with every pitch of those bars', () => {
    for (const p of pieces) {
      const from = 1;
      const to = Math.min(4, p.bars.length - 1);
      const s = buildSchedule(p, 100, { fromBar: from, toBar: to, countIn: false });
      expect(s.notes.every((n) => n.bar >= from && n.bar <= to)).toBe(true);
      expect(s.bars.map((b) => b.bar)).toEqual(Array.from({ length: to - from + 1 }, (_, k) => from + k));
      expect(close(s.end, seconds(p, 100, from, to))).toBe(true);
      // Every struck note in those bars is scheduled (tied continuations excepted).
      const expected = p.bars
        .slice(from, to + 1)
        .flatMap((b) => (b.voices ? [b.voices.s, b.voices.a, b.voices.t, b.voices.b] : [b.rh, b.lh]))
        .flatMap((voice) => voice.filter((n, i) => !n.rest && !(i > 0 && voice[i - 1].tie)))
        .flatMap((n) => n.pitches.map(midi))
        .sort((a, b) => a - b);
      expect(s.notes.flatMap((n) => n.midis).sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it('plays the whole piece by default, with a full count-in (or the rest of the upbeat bar)', () => {
    for (const p of pieces) {
      const s = buildSchedule(p, 80);
      expect(s.bars.length).toBe(p.bars.length);
      const upbeat = barLengths(p)[0] < p.time.barTicks;
      const expectedClicks = upbeat ? (p.time.barTicks - barLengths(p)[0]) / p.time.beatTicks : p.time.beatsPerBar;
      expect(s.clicks.length, p.title).toBe(expectedClicks);
      expect(s.clicks[0].accent).toBe(true);
    }
  });

  it('starts at once without a count-in, and clamps out-of-range bars', () => {
    const p = pieces[0];
    const s = buildSchedule(p, 90, { fromBar: 2, toBar: 2, countIn: false });
    expect(s.clicks).toEqual([]);
    expect(s.notes[0].time).toBe(0);
    const clamped = buildSchedule(p, 90, { fromBar: -3, toBar: 999 });
    expect(clamped.bars.length).toBe(p.bars.length);
  });

  it('keeps the music identical whichever bars are played', () => {
    const p = pieces[3];
    const whole = buildSchedule(p, 72, { countIn: false });
    const lengths = barLengths(p);
    for (let bar = 0; bar < p.bars.length; bar++) {
      const one = buildSchedule(p, 72, { fromBar: bar, toBar: bar, countIn: false });
      const sameBar = whole.notes.filter((n) => n.bar === bar);
      const offset = sameBar.length ? sameBar[0].time - one.notes[0].time : 0;
      expect(one.notes.map((n) => n.midis)).toEqual(sameBar.map((n) => n.midis));
      one.notes.forEach((n, i) => expect(close(n.time + offset, sameBar[i].time)).toBe(true));
      expect(lengths[bar]).toBeGreaterThan(0);
    }
  });
});
