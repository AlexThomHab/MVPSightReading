import { generatePiece } from '../music/generator';
import { Piece } from '../music/model';
import { midi } from '../music/theory';
import { barLengths, buildSchedule, ornamented } from './schedule';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** A piece at one steady tempo (no rit., accel. or tempo change), so bar timings can be counted. */
const steady = (p: Piece): Piece => ({ ...p, expression: p.expression && { ...p.expression, tempos: undefined } });

const pieces: Piece[] = [
  generatePiece({ seed: 'sched-1', grade: 5, form: 'trio' }),
  generatePiece({ seed: 'sched-2', grade: 3, form: 'nocturne', timeId: '6/8' }),
  generatePiece({ seed: 'sched-3', grade: 4, form: 'gavotte' }),
  generatePiece({ seed: 'sched-4', grade: 5, form: 'chorale' }),
].map(steady);

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
  it('slows through a rit., quickens through an accel., and changes at once at a new tempo word', () => {
    const p = steady(generatePiece({ seed: 'tempo', grade: 5, form: 'trio' }));
    const n = p.bars.length;
    const lastBar = (piece: Piece) => {
      const s = buildSchedule(piece, 90, { countIn: false });
      return s.end - s.bars[n - 1].time;
    };
    const rit: Piece = { ...p, expression: { ...p.expression!, tempos: [{ at: { bar: n - 2, index: 0 }, text: 'rit.', kind: 'rit', factor: 0.75 }] } };
    expect(lastBar(rit)).toBeGreaterThan(lastBar(p) * 1.15);
    const quicker: Piece = { ...p, expression: { ...p.expression!, tempos: [{ at: { bar: 1, index: 0 }, text: 'Più mosso', kind: 'set', factor: 1.25 }] } };
    const bar = (piece: Piece, b: number) => buildSchedule(piece, 90, { countIn: false }).bars[b + 1].time - buildSchedule(piece, 90, { countIn: false }).bars[b].time;
    expect(bar(quicker, 0)).toBeCloseTo(bar(p, 0));
    expect(bar(quicker, 2)).toBeCloseTo(bar(p, 2) / 1.25);
  });

  it('holds notes under the right pedal, rolls a spread chord, and softens una corda', () => {
    const p = steady(generatePiece({ seed: 'pedal', grade: 5, form: 'trio' }));
    const plain = buildSchedule(p, 90, { countIn: false, fromBar: 0, toBar: 0 });
    const lh = p.bars[0].lh;
    const pedalled: Piece = { ...p, expression: { ...p.expression!, pedals: [{ from: { bar: 0, index: 0 }, to: { bar: 0, index: lh.length - 1 } }] } };
    const held = buildSchedule(pedalled, 90, { countIn: false, fromBar: 0, toBar: 0 });
    const first = (s: typeof plain) => s.notes.find((x) => x.midis.includes(midi(lh[0].pitches[0])))!;
    expect(first(held).duration).toBeGreaterThan(first(plain).duration);
    const soft: Piece = { ...p, expression: { ...p.expression!, unaCorda: [{ from: { bar: 0, index: 0 }, to: { bar: 0, index: p.bars[0].rh.length - 1 } }] } };
    expect(Math.max(...buildSchedule(soft, 90, { countIn: false, fromBar: 0, toBar: 0 }).notes.map((x) => x.velocity))).toBeLessThan(Math.max(...plain.notes.map((x) => x.velocity)));
    const chord = { ...p, bars: p.bars.map((b, i) => (i === 0 ? { ...b, rh: [{ pitches: [{ letter: 'C', alter: 0, octave: 4 }, { letter: 'E', alter: 0, octave: 4 }, { letter: 'G', alter: 0, octave: 4 }], ticks: b.rh.reduce((a, x) => a + x.ticks, 0), spread: true }] } : b)) } as Piece;
    const rolled = buildSchedule(chord, 90, { countIn: false, fromBar: 0, toBar: 0 }).notes.filter((x) => x.midis.length === 1 && [60, 64, 67].includes(x.midis[0]));
    expect(rolled.map((x) => x.midis[0])).toEqual([60, 64, 67]);
    expect(rolled[2].time).toBeGreaterThan(rolled[0].time);
  });

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
      // (A tie may cross a bar line inside the range: the Gavotte's upbeat moves every bar line.)
      const voices = p.bars[0].voices ? (['s', 'a', 't', 'b'] as const) : (['rh', 'lh'] as const);
      const expected = voices
        .map((v) => p.bars.slice(from, to + 1).flatMap((b) => (b.voices ? b.voices[v as 's'] : b[v as 'rh'])))
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

describe('ornaments in playback', () => {
  const base = { time: 1, duration: 1, midis: [72], velocity: 0.5, bar: 0 };
  const c5 = { letter: 'C' as const, alter: 0, octave: 5 };
  const d5 = { letter: 'D' as const, alter: 0, octave: 5 };
  const b4 = { letter: 'B' as const, alter: 0, octave: 4 };

  it('crushes a grace note in on the beat, before the note', () => {
    const out = ornamented(base, { pitches: [c5], ticks: 4, grace: [b4] }, 0.5);
    expect(out.map((e) => e.midis[0])).toEqual([71, 72]);
    expect(out[0].time).toBe(1);
    expect(out[0].duration).toBeLessThanOrEqual(0.07);
    expect(out[1].time + out[1].duration).toBeCloseTo(2);
  });

  it('plays a turn as upper, main, lower, main, then holds the note', () => {
    const out = ornamented(base, { pitches: [c5], ticks: 8, ornament: { type: 'turn', upper: d5, lower: b4 } }, 0.5);
    expect(out.map((e) => e.midis[0])).toEqual([74, 72, 71, 72]);
    expect(out[3].duration).toBeGreaterThan(out[0].duration);
  });

  it('trills with the note above and ends on the note, filling its length', () => {
    const out = ornamented(base, { pitches: [c5], ticks: 8, ornament: { type: 'trill', upper: d5 } }, 0.5);
    expect(out.length).toBeGreaterThan(4);
    expect(out[0].midis[0]).toBe(72);
    expect(out[1].midis[0]).toBe(74);
    expect(out[out.length - 1].midis[0]).toBe(72);
    const end = out[out.length - 1].time + out[out.length - 1].duration;
    expect(end).toBeCloseTo(2);
  });
});
