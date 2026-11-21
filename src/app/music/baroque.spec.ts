import { generatePiece } from './generator';
import { Note, Piece } from './model';
import { keysFor, timesFor } from './forms';
import { GRADES, GRADE_SPECS } from './grades';
import { LETTERS, diatonicIndex, isSingableInterval, keySignatureAlter, midi, pitchName, tonicSymbol } from './theory';
import { onsets } from './durations';

const FORMS = ['invention', 'fugue'] as const;
const SEEDS = 12;

const pieces: Piece[] = [];
for (const grade of GRADES) {
  for (const form of FORMS) {
    for (const timeId of timesFor(grade, form)) {
      for (let s = 0; s < SEEDS; s++) pieces.push(generatePiece({ seed: `b-${s}`, grade, form, timeId }));
    }
    for (const key of keysFor(grade)) pieces.push(generatePiece({ seed: `k-${key.id}`, grade, form, keyId: key.id }));
  }
}

const label = (p: Piece) => `seed=${p.seed} grade=${p.grade} form=${p.form} key=${p.key.id} time=${p.time.id}`;
const sum = (notes: Note[]) => notes.reduce((a, n) => a + n.ticks, 0);
const degreeOf = (p: Piece, letter: string) => (LETTERS.indexOf(letter as never) - LETTERS.indexOf(p.key.tonic) + 7) % 7;
const noteAt = (notes: Note[], at: number) => {
  let t = 0;
  return notes.find((n) => (t += n.ticks) > at);
};

function violations(list: Piece[], check: (p: Piece, fail: (msg: string) => void) => void): string[] {
  const out: string[] = [];
  for (const p of list) check(p, (msg) => out.push(`${label(p)}: ${msg}`));
  return out.slice(0, 10);
}

/** Every moment either hand moves, with both hands' sounding notes (null in a rest). */
function sonorities(p: Piece) {
  const out: { bar: number; at: number; rh: Note | null; lh: Note | null; rhIndex: number }[] = [];
  p.bars.forEach((bar, b) => {
    const times = [...new Set([...onsets(bar.rh), ...onsets(bar.lh)])].sort((x, y) => x - y);
    for (const at of times) {
      const rh = noteAt(bar.rh, at) ?? null;
      const lh = noteAt(bar.lh, at) ?? null;
      out.push({ bar: b, at, rh: rh && !rh.rest ? rh : null, lh: lh && !lh.rest ? lh : null, rhIndex: rh ? bar.rh.indexOf(rh) : -1 });
    }
  });
  return out;
}

const CONSONANT = [0, 3, 4, 7, 8, 9];

describe('Baroque counterpoint: Invention and Fugue', { timeout: 60_000 }, () => {
  it('generates every grade, metre and key', () => {
    expect(pieces.length).toBeGreaterThan(300);
    for (const p of pieces) {
      expect(['invention', 'fugue']).toContain(p.form);
      expect(p.title, label(p)).toMatch(p.form === 'invention' ? /^Invention in / : /^Fugue in /);
    }
  });

  it('fills every bar in both hands exactly', () => {
    const found = violations(pieces, (p, fail) =>
      p.bars.forEach((bar, i) => {
        if (sum(bar.rh) !== p.time.barTicks) fail(`bar ${i + 1} RH has ${sum(bar.rh)} ticks`);
        if (sum(bar.lh) !== p.time.barTicks) fail(`bar ${i + 1} LH has ${sum(bar.lh)} ticks`);
      }),
    );
    expect(found).toEqual([]);
  });

  it("keeps note values, keys, metres, lengths and leaps within the grade's limits", () => {
    const found = violations(pieces, (p, fail) => {
      const spec = GRADE_SPECS[p.grade];
      if (!spec.keys.includes(p.key.id)) fail(`key ${p.key.id}`);
      if (!timesFor(p.grade, p.form).includes(p.time.id)) fail(`time ${p.time.id}`);
      if (!spec.bars.includes(p.bars.length)) fail(`${p.bars.length} bars`);
      for (const hand of ['rh', 'lh'] as const) {
        const notes = p.bars.flatMap((b) => b[hand]);
        for (const n of notes) if (!spec.durations.includes(n.ticks)) fail(`${hand} duration ${n.ticks}`);
        const pitched = notes.filter((n) => !n.rest);
        const limit = hand === 'rh' ? spec.maxLeap : spec.maxBassLeap;
        for (let i = 1; i < pitched.length; i++) {
          const [a, b] = [pitched[i - 1].pitches[0], pitched[i].pitches[0]];
          const leap = Math.abs(diatonicIndex(b) - diatonicIndex(a));
          if (leap > limit) fail(`${hand} leap ${pitchName(a)}–${pitchName(b)}`);
          if (!isSingableInterval(a, b)) fail(`${hand} interval ${pitchName(a)}–${pitchName(b)}`);
        }
      }
    });
    expect(found).toEqual([]);
  });

  it('writes accidentals outside the key only from Grade 4 (and the minor leading note)', () => {
    const found = violations(pieces, (p, fail) => {
      const leading = LETTERS[(LETTERS.indexOf(p.key.tonic) + 6) % 7];
      for (const n of p.bars.flatMap((b) => [...b.rh, ...b.lh])) {
        for (const x of n.pitches) {
          const sig = keySignatureAlter(p.key, x.letter);
          const ok = x.alter === sig || (p.mode === 'minor' && x.letter === leading && x.alter === sig + 1) || (n.chromatic && p.grade >= 4);
          if (!ok) fail(`${pitchName(x)}`);
        }
      }
    });
    expect(found).toEqual([]);
  });

  it('states the subject alone, then imitates it in the other hand: an invention at the octave, a fugue at the fifth', () => {
    const found = violations(pieces, (p, fail) => {
      const [first, second] = p.bars;
      const lead = first.lh.every((n) => n.rest) ? 'rh' : first.rh.every((n) => n.rest) ? 'lh' : null;
      if (!lead) return; // (a customisation without rests: the other hand holds a note)
      const follow = lead === 'rh' ? 'lh' : 'rh';
      const subject = first[lead];
      const answer = second[follow];
      if (answer.map((n) => n.ticks).join() !== subject.map((n) => n.ticks).join()) return fail('the answer has another rhythm');
      const shifts = new Set(answer.map((n, i) => diatonicIndex(n.pitches[0]) - diatonicIndex(subject[i].pitches[0])));
      if (shifts.size !== 1) return fail('the answer is not the subject transposed');
      const shift = (([...shifts][0] % 7) + 7) % 7;
      const atOctave = p.form === 'invention' || p.phrases[1].section === 'Answer (at the octave)';
      if (shift !== (atOctave ? 0 : 4)) fail(`answer transposed by ${[...shifts][0]} steps`);
      if (p.phrases[0].section !== 'Subject') fail(`first section ${p.phrases[0].section}`);
    });
    expect(found).toEqual([]);
    expect(pieces.filter((p) => p.form === 'fugue' && p.phrases[1].section === 'Answer').length).toBeGreaterThan(50);
  });

  it('is consonant on every beat — a dissonance only between beats, or as a prepared suspension', () => {
    const found = violations(pieces, (p, fail) => {
      for (const s of sonorities(p)) {
        if (!s.rh || !s.lh || s.at % p.time.beatTicks !== 0) continue;
        const interval = Math.abs(midi(s.rh.pitches[0]) - midi(s.lh.pitches[0]));
        if (CONSONANT.includes(interval % 12) && interval !== 0) continue;
        // A suspension: the treble held over (tied) from the beat before, resolving down by step.
        const bar = p.bars[s.bar].rh;
        const held = s.rhIndex > 0 && bar[s.rhIndex - 1].tie;
        const next = bar[s.rhIndex + 1];
        const resolves = next && diatonicIndex(s.rh.pitches[0]) - diatonicIndex(next.pitches[0]) === 1;
        if (!(held && resolves)) fail(`bar ${s.bar + 1} tick ${s.at}: ${pitchName(s.rh.pitches[0])} over ${pitchName(s.lh.pitches[0])}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('never moves in consecutive perfect fifths or octaves, and never crosses the parts', () => {
    const found = violations(pieces, (p, fail) => {
      let prev: { rh: number; lh: number } | null = null;
      for (const s of sonorities(p)) {
        if (!s.rh || !s.lh) {
          prev = null;
          continue;
        }
        const cur = { rh: midi(s.rh.pitches[0]), lh: midi(s.lh.pitches[0]) };
        if (diatonicIndex(s.rh.pitches[0]) <= diatonicIndex(s.lh.pitches[0])) fail(`bar ${s.bar + 1}: the parts cross or meet`);
        const perfect = (x: { rh: number; lh: number }) => {
          const ic = Math.abs(x.rh - x.lh) % 12;
          return ic === 0 || ic === 7 ? ic : null;
        };
        if (prev && perfect(prev) !== null && perfect(prev) === perfect(cur) && prev.rh !== cur.rh && prev.lh !== cur.lh) {
          fail(`bar ${s.bar + 1} tick ${s.at}: consecutive ${perfect(cur) ? 'fifths' : 'octaves'}`);
        }
        prev = cur;
      }
    });
    expect(found).toEqual([]);
  });

  it('builds episodes from sequences, falling a step each bar', () => {
    let episodes = 0;
    let sequential = 0;
    for (const p of pieces.filter((x) => x.bars.length >= 8)) {
      for (const ph of p.phrases.filter((x) => x.section === 'Episode' && x.bars >= 2)) {
        episodes++;
        const [a, b] = [p.bars[ph.startBar], p.bars[ph.startBar + 1]];
        const copies = (['rh', 'lh'] as const).some(
          (h) => a[h].length === b[h].length && a[h].every((n, i) => !n.rest && diatonicIndex(n.pitches[0]) - diatonicIndex(b[h][i].pitches[0]) === 1),
        );
        if (copies) sequential++;
      }
    }
    expect(episodes).toBeGreaterThan(100);
    expect(sequential / episodes).toBeGreaterThan(0.5);
  });

  it('modulates for its middle entries from Grade 4, and returns home for the final entry', () => {
    for (const p of pieces) {
      const middle = p.phrases.filter((ph) => ph.section?.startsWith('Middle entry'));
      if (p.grade < 4) expect(middle.length, label(p)).toBe(0);
      for (const ph of middle) expect(ph.key, label(p)).toBeDefined();
      if (p.bars.length >= 8) expect(p.phrases.some((ph) => ph.section === 'Final entry'), label(p)).toBe(true);
    }
    expect(pieces.filter((p) => p.grade >= 4 && p.phrases.some((ph) => ph.section?.startsWith('Middle entry'))).length).toBeGreaterThan(50);
  });

  it('cadences V–I on the tonic in both hands, with a 4–3 suspension often from Grade 3', () => {
    const found = violations(pieces, (p, fail) => {
      const last = p.bars.at(-1)!;
      for (const hand of ['rh', 'lh'] as const) if (degreeOf(p, last[hand][0].pitches[0].letter) !== 0) fail(`${hand} ends off the tonic`);
      const penult = p.bars.at(-2)!;
      if (penult.harmony.at(-1)!.symbol !== 'V') fail(`penultimate chord ${penult.harmony.at(-1)!.symbol}`);
      if (last.harmony[0].symbol !== tonicSymbol(p.mode)) fail(`final chord ${last.harmony[0].symbol}`);
      if (p.phrases.at(-1)!.cadence !== 'PAC') fail('no final cadence');
    });
    expect(found).toEqual([]);
    const suspended = (p: Piece) => p.bars.at(-2)!.rh.some((n) => n.tie);
    const eligible = pieces.filter((p) => p.grade >= 3);
    expect(eligible.filter(suspended).length / eligible.length).toBeGreaterThan(0.5);
    expect(pieces.filter((p) => p.grade < 3).some(suspended)).toBe(false);
  });

  it('is deterministic', () => {
    for (const form of FORMS) {
      const s = { seed: 'same', grade: 5 as const, form };
      expect(generatePiece(s)).toEqual(generatePiece(s));
    }
  });
});
