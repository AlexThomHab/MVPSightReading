import { Cadence, generatePiece, keysFor, Note, Piece, SequenceName, timesFor } from './generator';
import { GRADES, GRADE_SPECS } from './grades';
import { STYLE_IDS } from './styles';
import {
  LETTERS,
  bassDegree,
  chordFor,
  diatonicIndex,
  isSingableInterval,
  keySignatureAlter,
  pitchName,
  samePitchClass,
  tonicSymbol,
} from './theory';

const SEEDS_PER_COMBINATION = 200;

// 200 seeds for every grade × style, with the key and time signature left random.
const pieces: Piece[] = [];
for (const grade of GRADES) {
  for (const style of STYLE_IDS) {
    for (let s = 0; s < SEEDS_PER_COMBINATION; s++) {
      pieces.push(generatePiece({ seed: `test-${s}`, grade, style }));
    }
  }
}

// Every key and time signature the page lets a user pick, a few seeds each.
const overridePieces: Piece[] = [];
for (const grade of GRADES) {
  for (const style of STYLE_IDS) {
    for (const key of keysFor(grade, style)) {
      for (const timeId of timesFor(grade)) {
        for (let s = 0; s < 3; s++) {
          overridePieces.push(generatePiece({ seed: `o-${s}`, grade, style, keyId: key.id, timeId }));
        }
      }
    }
  }
}

const all = [...pieces, ...overridePieces];

const label = (p: Piece) => `seed=${p.seed} grade=${p.grade} style=${p.style} key=${p.key.id} time=${p.time.id}`;
const sounding = (notes: Note[]) => notes.filter((n) => !n.rest);
const sum = (notes: Note[]) => notes.reduce((a, n) => a + n.ticks, 0);
const lowest = (n: Note) => n.pitches[0];
const firstChord = (p: Piece, bar: number) => p.bars[bar].harmony[0].symbol;
const lastChord = (p: Piece, bar: number) => p.bars[bar].harmony[p.bars[bar].harmony.length - 1].symbol;
/** Scale-degree number (0 = tonic, 2 = mediant, 4 = dominant) of a pitch's letter in the piece's key. */
const degreeOf = (p: Piece, letter: string) => (LETTERS.indexOf(letter as never) - LETTERS.indexOf(p.key.tonic) + 7) % 7;

/** Runs `check` on every piece and returns the first few violations, so failures read clearly. */
function violations(list: Piece[], check: (p: Piece, fail: (msg: string) => void) => void): string[] {
  const out: string[] = [];
  for (const p of list) check(p, (msg) => out.push(`${label(p)}: ${msg}`));
  return out.slice(0, 10);
}

describe('generatePiece', () => {
  it('generates the full test set', () => {
    expect(pieces.length).toBe(GRADES.length * STYLE_IDS.length * SEEDS_PER_COMBINATION);
    expect(overridePieces.length).toBeGreaterThan(1000);
  });

  it('1. every bar in both hands adds up exactly to the time signature', () => {
    const found = violations(all, (p, fail) =>
      p.bars.forEach((bar, i) => {
        if (sum(bar.rh) !== p.time.barTicks) fail(`bar ${i + 1} RH has ${sum(bar.rh)} ticks`);
        if (sum(bar.lh) !== p.time.barTicks) fail(`bar ${i + 1} LH has ${sum(bar.lh)} ticks`);
      }),
    );
    expect(found).toEqual([]);
  });

  it('2. every note uses the key signature, except the minor leading note and Grade 4+ chromatic notes', () => {
    const found = violations(all, (p, fail) => {
      const leading = LETTERS[(LETTERS.indexOf(p.key.tonic) + 6) % 7];
      p.bars.forEach((bar, i) => {
        for (const note of [...bar.rh, ...bar.lh]) {
          if (note.chromatic && p.grade < 4) fail(`bar ${i + 1} chromatic note below Grade 4`);
          for (const pitch of note.pitches) {
            const sig = keySignatureAlter(p.key, pitch.letter);
            const ok =
              pitch.alter === sig ||
              (p.mode === 'minor' && pitch.letter === leading && pitch.alter === sig + 1) ||
              (note.chromatic === true && p.grade >= 4);
            if (!ok) fail(`bar ${i + 1} ${pitchName(pitch)} is outside the key`);
          }
        }
      });
    });
    expect(found).toEqual([]);
  });

  it("3. rhythms, keys, time signatures, lengths and leaps stay within the grade's limits", () => {
    const defaults = new Set(pieces);
    const found = violations(all, (p, fail) => {
      const spec = GRADE_SPECS[p.grade];
      if (!spec.keys.includes(p.key.id)) fail(`key ${p.key.id} not in grade`);
      if (!spec.times.includes(p.time.id)) fail(`time ${p.time.id} not in grade`);
      if (defaults.has(p) && !spec.bars.includes(p.bars.length)) fail(`${p.bars.length} bars`);

      const rh = p.bars.flatMap((b) => b.rh);
      const lhAll = p.bars.flatMap((b) => b.lh);
      for (const n of [...rh, ...lhAll]) {
        if (!spec.durations.includes(n.ticks)) fail(`duration ${n.ticks} not in grade`);
      }
      for (let i = 1; i < rh.length; i++) {
        const leap = Math.abs(diatonicIndex(rh[i].pitches[0]) - diatonicIndex(rh[i - 1].pitches[0]));
        if (leap > spec.maxLeap) fail(`RH leap of ${leap} steps at note ${i}`);
      }
      const lh = sounding(lhAll);
      for (let i = 1; i < lh.length; i++) {
        const leap = Math.abs(diatonicIndex(lowest(lh[i])) - diatonicIndex(lowest(lh[i - 1])));
        if (leap > spec.maxBassLeap) fail(`LH leap of ${leap} steps at note ${i}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('4. ends on the tonic in both hands, with a V–I cadence and the tonic approached by step', () => {
    const found = violations(all, (p, fail) => {
      const tonic = { letter: p.key.tonic, alter: p.key.tonicAlter, octave: 0 };
      const rh = p.bars.flatMap((b) => b.rh);
      const lh = sounding(p.bars.flatMap((b) => b.lh));
      const last = rh[rh.length - 1].pitches[0];
      const before = rh[rh.length - 2].pitches[0];
      if (!samePitchClass(last, tonic)) fail(`RH ends on ${pitchName(last)}`);
      if (Math.abs(diatonicIndex(last) - diatonicIndex(before)) !== 1) fail(`RH tonic approached from ${pitchName(before)}`);
      if (!samePitchClass(lowest(lh[lh.length - 1]), tonic)) fail(`LH ends on ${pitchName(lowest(lh[lh.length - 1]))}`);
      if (lastChord(p, p.bars.length - 2) !== 'V') fail('penultimate bar does not end on V');
      if (firstChord(p, p.bars.length - 1) !== tonicSymbol(p.mode)) fail('final bar is not I');
      if (p.phrases[p.phrases.length - 1].cadence !== 'PAC') fail('final cadence is not a PAC');
    });
    expect(found).toEqual([]);
  });

  it('5. the same seed and settings always produce the same piece', () => {
    for (const grade of GRADES) {
      for (const style of STYLE_IDS) {
        for (let s = 0; s < 20; s++) {
          const settings = { seed: `test-${s}`, grade, style };
          expect(generatePiece(settings)).toEqual(generatePiece(settings));
        }
      }
    }
    expect(generatePiece({ seed: 'a', grade: 3, style: 'waltz' })).not.toEqual(
      generatePiece({ seed: 'b', grade: 3, style: 'waltz' }),
    );
  });

  it('uses only singable melodic intervals (no augmented or diminished leaps, no sevenths)', () => {
    const found = violations(all, (p, fail) => {
      const rh = p.bars.flatMap((b) => b.rh).map((n) => n.pitches[0]);
      for (let i = 1; i < rh.length; i++) {
        if (!isSingableInterval(rh[i - 1], rh[i])) fail(`${pitchName(rh[i - 1])} → ${pitchName(rh[i])}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('repeats the opening two bars at the start of a later phrase', () => {
    for (const p of pieces.filter((x) => x.bars.length >= 8)) {
      const repeat = p.phrases.find((ph) => ph.repeatsOpening);
      expect(repeat, label(p)).toBeDefined();
      expect(p.bars[repeat!.startBar].rh, label(p)).toEqual(p.bars[0].rh);
      expect(p.bars[repeat!.startBar + 1].rh, label(p)).toEqual(p.bars[1].rh);
    }
  });

  it('ends every phrase with the harmony and melody its cadence requires', () => {
    const found = violations(all, (p, fail) => {
      const I = tonicSymbol(p.mode);
      for (const ph of p.phrases) {
        const end = ph.startBar + ph.bars - 1;
        const goal = lastChord(p, end);
        // The chord before the goal: earlier in the same bar, or at the end of the bar before.
        const before = p.bars[end].harmony.length > 1 ? p.bars[end].harmony[0].symbol : lastChord(p, end - 1);
        const top = p.bars[end].rh[p.bars[end].rh.length - 1].pitches[0];
        const where = `phrase at bar ${ph.startBar + 1} (${ph.cadence})`;
        const expected: Record<Cadence, [string[], string[]]> = {
          PAC: [['V'], [I]],
          IAC: [['V'], [I]],
          HC: [[], ['V']],
          PC: [['IV', 'iv'], [I]],
          DC: [['V'], ['vi', 'VI']],
        };
        const [from, to] = expected[ph.cadence];
        if (!to.includes(goal)) fail(`${where} ends on ${goal}`);
        if (from.length && !from.includes(before)) fail(`${where} approaches from ${before}`);
        if (ph.cadence === 'PAC' && degreeOf(p, top.letter) !== 0) fail(`${where} melody ends on ${pitchName(top)}`);
        if (ph.cadence === 'IAC' && ![2, 4].includes(degreeOf(p, top.letter))) fail(`${where} melody ends on ${pitchName(top)}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('puts the right bass note under every chord, including first inversions', () => {
    const found = violations(
      all.filter((p) => p.style !== 'folk'), // folk uses a tonic/dominant drone instead
      (p, fail) => {
        p.bars.forEach((bar, b) => {
          for (const h of bar.harmony) {
            let t = 0;
            const lhNote = bar.lh.find((n) => (t += n.ticks) - n.ticks === h.at);
            const expected = bassDegree(chordFor(h.symbol, p.mode));
            const bass = lhNote && !lhNote.rest ? degreeOf(p, lowest(lhNote).letter) : -1;
            if (bass !== expected) fail(`bar ${b + 1} ${h.symbol} has bass ${lhNote ? pitchName(lowest(lhNote)) : 'none'}`);
          }
        });
      },
    );
    expect(found).toEqual([]);
  });

  it('uses every kind of cadence', () => {
    const counts: Record<string, number> = {};
    for (const p of pieces) for (const ph of p.phrases) counts[ph.cadence] = (counts[ph.cadence] ?? 0) + 1;
    for (const c of ['PAC', 'IAC', 'HC', 'PC', 'DC'] as Cadence[]) expect(counts[c] ?? 0, c).toBeGreaterThan(50);
  });

  it('includes romanesca, descending-fifths and ascending 5–6 sequences from Grade 3', () => {
    const counts: Record<string, number> = {};
    for (const p of pieces) {
      for (const ph of p.phrases) {
        if (!ph.sequence) continue;
        expect(p.grade, label(p)).toBeGreaterThanOrEqual(3);
        counts[ph.sequence] = (counts[ph.sequence] ?? 0) + 1;
      }
    }
    for (const name of ['romanesca', 'descending-fifths', 'ascending-5-6'] as SequenceName[]) {
      expect(counts[name] ?? 0, name).toBeGreaterThan(50);
    }
    // A healthy amount, but not every piece.
    const withSequence = pieces.filter((p) => p.grade >= 3 && p.phrases.some((ph) => ph.sequence)).length;
    const eligible = pieces.filter((p) => p.grade >= 3).length;
    expect(withSequence / eligible).toBeGreaterThan(0.25);
    expect(withSequence / eligible).toBeLessThan(0.75);
  });

  it('repeats the sequence model bar a fixed step higher or lower in each unit, in both hands of the harmony', () => {
    const steps: Record<SequenceName, number> = { romanesca: -2, 'descending-fifths': -1, 'ascending-5-6': 1 };
    const found = violations(all, (p, fail) => {
      for (const ph of p.phrases) {
        if (!ph.sequence) continue;
        const step = steps[ph.sequence];
        const model = p.bars[ph.startBar];
        const units = ph.sequence === 'descending-fifths' && ph.cadence === 'PAC' ? 2 : 3;
        for (let k = 1; k < units; k++) {
          const copy = p.bars[ph.startBar + k];
          if (copy.rh.length !== model.rh.length) {
            fail(`unit ${k + 1} has a different rhythm`);
            continue;
          }
          copy.rh.forEach((n, j) => {
            const moved = diatonicIndex(n.pitches[0]) - diatonicIndex(model.rh[j].pitches[0]);
            if (moved !== step * k || n.ticks !== model.rh[j].ticks) fail(`unit ${k + 1} note ${j + 1} moved ${moved}`);
          });
        }
      }
    });
    expect(found).toEqual([]);
  });

  it('keeps the style character: waltz and minuet in 3/4, march in a major key', () => {
    const found = violations(pieces, (p, fail) => {
      if ((p.style === 'waltz' || p.style === 'minuet') && p.time.id !== '3/4') fail('not in 3/4');
      if (p.style === 'march' && p.mode !== 'major') fail('march in minor');
    });
    expect(found).toEqual([]);
  });
});
