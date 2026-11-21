import { generatePiece } from './generator';
import { Cadence, Note, Piece, SequenceName } from './model';
import { FORMS, keysFor, timesFor } from './forms';
import { GRADES, GRADE_SPECS } from './grades';
import { GALANT_FORMS, GalantFormId } from './galant-forms';
import { LETTERS, Pitch, bassDegree, chordFor, diatonicIndex, isSingableInterval, keySignatureAlter, pitchName, tonicSymbol } from './theory';

const GALANT = Object.keys(GALANT_FORMS) as GalantFormId[];
const samePitchClass = (a: Pitch, b: Pitch) => a.letter === b.letter && a.alter === b.alter;

const SEEDS_PER_COMBINATION = 40;

// Seeds for every grade × form, with the key and time signature left random.
const pieces: Piece[] = [];
for (const grade of GRADES) {
  for (const form of GALANT) {
    for (let s = 0; s < SEEDS_PER_COMBINATION; s++) pieces.push(generatePiece({ seed: `test-${s}`, grade, form }));
  }
}

// Every key and time signature the menus let a user pick for each form.
const overridePieces: Piece[] = [];
for (const grade of GRADES) {
  for (const form of GALANT) {
    for (const key of keysFor(grade)) {
      for (const timeId of timesFor(grade, form)) overridePieces.push(generatePiece({ seed: `o-${key.id}`, grade, form, keyId: key.id, timeId }));
    }
  }
}

const all = [...pieces, ...overridePieces];
/** Pieces whose bars line up with their phrases (the Gavotte's upbeat moves every bar line). */
const onDownbeat = (list: Piece[]) => list.filter((p) => !p.upbeat);

const label = (p: Piece) => `seed=${p.seed} grade=${p.grade} form=${p.form} key=${p.key.id} time=${p.time.id}`;
const sounding = (notes: Note[]) => notes.filter((n) => !n.rest);
const sum = (notes: Note[]) => notes.reduce((a, n) => a + n.ticks, 0);
const lowest = (n: Note) => n.pitches[0];
const lastChord = (p: Piece, bar: number) => p.bars[bar].harmony[p.bars[bar].harmony.length - 1].symbol;
/** Scale-degree number (0 = tonic, 2 = mediant, 4 = dominant) of a pitch's letter in the piece's key. */
const degreeOf = (p: Piece, letter: string) => (LETTERS.indexOf(letter as never) - LETTERS.indexOf(p.key.tonic) + 7) % 7;
/** A bar's length: a whole bar, except an upbeat's first bar and the last bar that completes it. */
const barLength = (p: Piece, b: number) => (!p.upbeat ? p.time.barTicks : b === 0 ? p.upbeat : b === p.bars.length - 1 ? p.time.barTicks - p.upbeat : p.time.barTicks);
/** The note sounding at tick `at` of a bar's hand. */
const noteAt = (notes: Note[], at: number) => {
  let t = 0;
  return notes.find((n) => (t += n.ticks) > at);
};
/** The piece's chords in order, a chord carried over a bar line counted once. */
const progression = (p: Piece) =>
  p.bars.flatMap((b) => b.harmony.map((h) => h.symbol.replace(' (pedal)', ''))).filter((s, i, list) => i === 0 || s !== list[i - 1]);

/** Runs `check` on every piece and returns the first few violations, so failures read clearly. */
function violations(list: Piece[], check: (p: Piece, fail: (msg: string) => void) => void): string[] {
  const out: string[] = [];
  for (const p of list) check(p, (msg) => out.push(`${label(p)}: ${msg}`));
  return out.slice(0, 10);
}

describe('Galant forms', { timeout: 60_000 }, () => {
  it('generates the full test set', () => {
    expect(pieces.length).toBe(GRADES.length * GALANT.length * SEEDS_PER_COMBINATION);
    expect(overridePieces.length).toBeGreaterThan(300);
  });

  it('fills every bar in both hands exactly (an upbeat bar and the bar that completes it included)', () => {
    const found = violations(all, (p, fail) =>
      p.bars.forEach((bar, i) => {
        if (sum(bar.rh) !== barLength(p, i)) fail(`bar ${i + 1} RH has ${sum(bar.rh)} ticks`);
        if (sum(bar.lh) !== barLength(p, i)) fail(`bar ${i + 1} LH has ${sum(bar.lh)} ticks`);
      }),
    );
    expect(found).toEqual([]);
  });

  it('uses the key signature, except the minor leading note and Grade 4+ chromatic notes', () => {
    const found = violations(all, (p, fail) => {
      const leading = LETTERS[(LETTERS.indexOf(p.key.tonic) + 6) % 7];
      p.bars.forEach((bar, i) => {
        for (const note of [...bar.rh, ...bar.lh]) {
          if (note.chromatic && p.grade < 4) fail(`bar ${i + 1} chromatic note below Grade 4`);
          for (const pitch of note.pitches) {
            const sig = keySignatureAlter(p.key, pitch.letter);
            const ok = pitch.alter === sig || (p.mode === 'minor' && pitch.letter === leading && pitch.alter === sig + 1) || (note.chromatic === true && p.grade >= 4);
            if (!ok) fail(`bar ${i + 1} ${pitchName(pitch)} is outside the key`);
          }
        }
      });
    });
    expect(found).toEqual([]);
  });

  it("keeps rhythms, keys, metres, lengths and leaps within the grade's and the form's limits", () => {
    const defaults = new Set(pieces);
    const found = violations(all, (p, fail) => {
      const spec = GRADE_SPECS[p.grade];
      if (!spec.keys.includes(p.key.id)) fail(`key ${p.key.id} not in grade`);
      if (!timesFor(p.grade, p.form).includes(p.time.id)) fail(`time ${p.time.id} not offered for the form`);
      if (defaults.has(p) && !spec.bars.includes(p.bars.length - (p.upbeat ? 1 : 0))) fail(`${p.bars.length} bars`);
      const rh = p.bars.flatMap((b) => b.rh);
      const lhAll = p.bars.flatMap((b) => b.lh);
      for (const n of [...rh, ...lhAll]) if (!spec.durations.includes(n.ticks)) fail(`duration ${n.ticks} not in grade`);
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

  it('ends with V–I: the tonic in both hands, the treble reaching it by step', () => {
    const found = violations(all, (p, fail) => {
      const tonic = { letter: p.key.tonic, alter: p.key.tonicAlter, octave: 0 };
      const rh = p.bars.flatMap((b) => b.rh).filter((_, i, list) => i === 0 || !list[i - 1].tie);
      const lh = sounding(p.bars.flatMap((b) => b.lh));
      const last = rh[rh.length - 1].pitches[0];
      const before = rh[rh.length - 2].pitches[0];
      if (!samePitchClass(last, tonic)) fail(`RH ends on ${pitchName(last)}`);
      if (Math.abs(diatonicIndex(last) - diatonicIndex(before)) !== 1) fail(`RH tonic approached from ${pitchName(before)}`);
      if (!samePitchClass(lowest(lh[lh.length - 1]), tonic)) fail(`LH ends on ${pitchName(lowest(lh[lh.length - 1]))}`);
      const chords = progression(p);
      if (chords.at(-1) !== tonicSymbol(p.mode) || chords.at(-2) !== 'V') fail(`ends ${chords.slice(-2).join('–')}`);
      if (p.phrases[p.phrases.length - 1].cadence !== 'PAC') fail('final cadence is not a PAC');
    });
    expect(found).toEqual([]);
  });

  it('gives the same piece for the same seed and settings, and different music for different seeds', () => {
    for (const form of GALANT) {
      const settings = { seed: 'same', grade: 4 as const, form };
      expect(generatePiece(settings)).toEqual(generatePiece(settings));
    }
    expect(generatePiece({ seed: 'a', grade: 3, form: 'waltz' })).not.toEqual(generatePiece({ seed: 'b', grade: 3, form: 'waltz' }));
  });

  it('uses only singable melodic intervals (no augmented or diminished leaps, no sevenths)', () => {
    const found = violations(all, (p, fail) => {
      const rh = p.bars.flatMap((b) => b.rh).map((n) => n.pitches[0]);
      for (let i = 1; i < rh.length; i++) if (!isSingableInterval(rh[i - 1], rh[i])) fail(`${pitchName(rh[i - 1])} → ${pitchName(rh[i])}`);
    });
    expect(found).toEqual([]);
  });

  it('repeats the opening two bars at the start of a later phrase', () => {
    for (const p of onDownbeat(pieces).filter((x) => x.bars.length >= 8)) {
      const repeat = p.phrases.find((ph) => ph.repeatsOpening);
      expect(repeat, label(p)).toBeDefined();
      expect(p.bars[repeat!.startBar].rh, label(p)).toEqual(p.bars[0].rh);
      expect(p.bars[repeat!.startBar + 1].rh, label(p)).toEqual(p.bars[1].rh);
    }
  });

  it('ends every phrase with the harmony and melody its cadence requires', () => {
    const found = violations(onDownbeat(all), (p, fail) => {
      const I = tonicSymbol(p.mode);
      for (const ph of p.phrases) {
        const end = ph.startBar + ph.bars - 1;
        const goal = lastChord(p, end).replace(' (pedal)', '');
        const before = p.bars[end].harmony.length > 1 ? p.bars[end].harmony[0].symbol : lastChord(p, end - 1);
        const top = p.bars[end].rh[p.bars[end].rh.length - 1].pitches[0];
        const where = `phrase at bar ${ph.startBar + 1} (${ph.cadence})`;
        const expected: Record<Cadence, [string[], string[]]> = {
          PAC: [['V', 'V (pedal)'], [I]],
          IAC: [['V', 'vii°', 'vii°6'], [I]],
          HC: [[], ['V']],
          PC: [['IV', 'iv'], [I]],
          DC: [['V'], ['vi', 'VI']],
        };
        const [from, to] = expected[ph.cadence!];
        if (!to.includes(goal)) fail(`${where} ends on ${goal}`);
        if (from.length && !from.includes(before)) fail(`${where} approaches from ${before}`);
        if (ph.cadence === 'PAC' && degreeOf(p, top.letter) !== 0) fail(`${where} melody ends on ${pitchName(top)}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('puts the right bass note under every chord (the tonic under a pedal)', () => {
    const found = violations(all, (p, fail) => {
      p.bars.forEach((bar, b) => {
        for (const h of bar.harmony) {
          const pedal = h.symbol.endsWith(' (pedal)');
          // The final bar holds the tonic under both chords of a closing Quiescenza.
          if (b === p.bars.length - 1 && h.at > 0) continue;
          // After an upbeat, a bar may open on the chord carried over its moved bar line.
          if (p.upbeat && b > 0 && h.at === 0 && p.bars[b - 1].harmony.at(-1)?.symbol === h.symbol) continue;
          let t = 0;
          const lhNote = bar.lh.find((n) => (t += n.ticks) - n.ticks === h.at);
          if (!lhNote) continue; // (an upbeat's chord carried over a moved bar line)
          const expected = pedal || b === p.bars.length - 1 ? 0 : bassDegree(chordFor(h.symbol, p.mode));
          const bass = !lhNote.rest ? degreeOf(p, lowest(lhNote).letter) : -1;
          if (bass !== expected) fail(`bar ${b + 1} ${h.symbol} has bass ${lhNote.rest ? 'none' : pitchName(lowest(lhNote))}`);
        }
      });
    });
    expect(found).toEqual([]);
  });

  it('uses perfect, imperfect, half and deceptive cadences', () => {
    const counts: Record<string, number> = {};
    for (const p of pieces) for (const ph of p.phrases) counts[ph.cadence!] = (counts[ph.cadence!] ?? 0) + 1;
    for (const c of ['PAC', 'IAC', 'HC', 'DC'] as Cadence[]) expect(counts[c] ?? 0, c).toBeGreaterThan(20);
  });
});

describe('galant schemata', { timeout: 60_000 }, () => {
  it('names the schemata every phrase is built from', () => {
    const names = new Set<string>();
    for (const p of pieces) {
      for (const ph of p.phrases) {
        expect(ph.schemas?.length, label(p)).toBeGreaterThan(0);
        ph.schemas!.forEach((s) => names.add(s));
      }
    }
    for (const s of ['Do–Re–Mi', 'Meyer', 'Romanesca', 'Prinner', 'Fonte', 'Monte', 'Quiescenza', 'Complete cadence', 'Half cadence']) expect(names, s).toContain(s);
  });

  it('puts the schema’s melody note over each chord where it begins', () => {
    const tally = (list: Piece[]) => {
      let goals = 0;
      let hit = 0;
      for (const p of list) {
        for (const bar of p.bars) {
          for (const h of bar.harmony) {
            if (!h.melody) continue;
            goals++;
            const n = noteAt(bar.rh, h.at);
            if (n && !n.rest && degreeOf(p, n.pitches[0].letter) === h.melody - 1) hit++;
          }
        }
      }
      return hit / goals;
    };
    // Exactly, below Grade 4; at Grades 4–5 a phrase may rarely have to let a schema note go.
    expect(tally(pieces.filter((p) => p.grade <= 3))).toBeGreaterThan(0.98);
    expect(tally(pieces)).toBeGreaterThan(0.9);
  });

  it('uses the Romanesca, Monte, Fonte and descending fifths as sequences, from Grade 3', () => {
    const counts: Record<string, number> = {};
    for (const p of pieces) {
      for (const ph of p.phrases) {
        if (!ph.sequence) continue;
        expect(p.grade, label(p)).toBeGreaterThanOrEqual(3);
        counts[ph.sequence] = (counts[ph.sequence] ?? 0) + 1;
      }
    }
    for (const name of ['romanesca', 'descending-fifths', 'fonte', 'monte'] as SequenceName[]) expect(counts[name] ?? 0, name).toBeGreaterThan(2);
    const eligible = pieces.filter((p) => p.grade >= 3);
    const withSequence = eligible.filter((p) => p.phrases.some((ph) => ph.sequence)).length;
    expect(withSequence / eligible.length).toBeGreaterThan(0.15);
    expect(withSequence / eligible.length).toBeLessThan(0.75);
  });

  it('repeats a sequence’s model bar a fixed step higher or lower in each unit', () => {
    const shape: Record<SequenceName, [step: number, units: number]> = {
      romanesca: [-2, 3],
      'descending-fifths': [-1, 2],
      fonte: [-1, 2],
      monte: [1, 2],
      'ascending-5-6': [1, 3],
    };
    const found = violations(onDownbeat(all), (p, fail) => {
      for (const ph of p.phrases) {
        if (!ph.sequence) continue;
        const [step, units] = shape[ph.sequence];
        const model = p.bars[ph.startBar];
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
});

describe('each form’s character', { timeout: 60_000 }, () => {
  const of = (form: GalantFormId) => pieces.filter((p) => p.form === form);

  it('is written in the form’s own metres, and titled after it', () => {
    const found = violations(pieces, (p, fail) => {
      if (!FORMS[p.form].times.includes(p.time.id)) fail(`${p.form} in ${p.time.id}`);
      if (!p.title.startsWith(`${FORMS[p.form].name} in `)) fail(`title "${p.title}"`);
      if (p.tempo.marking !== GALANT_FORMS[p.form as GalantFormId].tempoMarking) fail(`marked ${p.tempo.marking}`);
    });
    expect(found).toEqual([]);
  });

  it('begins a Gavotte with a half-bar upbeat, so its phrases end mid-bar', () => {
    for (const p of of('gavotte')) {
      expect(p.upbeat, label(p)).toBe(p.time.barTicks / 2);
      expect(sum(p.bars[0].rh), label(p)).toBe(p.time.barTicks / 2);
      expect(sum(p.bars.at(-1)!.rh), label(p)).toBe(p.time.barTicks / 2);
    }
    for (const form of GALANT.filter((f) => f !== 'gavotte')) for (const p of of(form)) expect(p.upbeat, label(p)).toBeUndefined();
  });

  it('detaches a Gavotte’s weak-beat crotchets from Grade 2', () => {
    const staccato = (p: Piece) => p.bars.flatMap((b) => b.rh).filter((n) => n.articulation === 'staccato').length;
    for (const p of of('gavotte')) if (p.grade === 1) expect(staccato(p), label(p)).toBe(0);
    expect(of('gavotte').filter((p) => p.grade >= 2 && staccato(p) > 0).length).toBeGreaterThan(100);
  });

  it('gives a Polonaise its rhythm — a quaver and two semiquavers — and accents from Grade 3', () => {
    const polonaise = of('polonaise').filter((p) => p.grade >= 4);
    // The left hand's polonaise rhythm, bar after bar (a reduced texture before Grade 4).
    const lhBars = polonaise.flatMap((p) => p.bars.slice(0, -1).map((b) => b.lh.map((n) => n.ticks).join(',')));
    expect(lhBars.filter((r) => r === '2,1,1,2,2,2,2').length / lhBars.length).toBeGreaterThan(0.5);
    // The melody often opens a bar with it too.
    const downbeats = polonaise.flatMap((p) => p.bars.map((b) => b.rh.slice(0, 3).map((n) => n.ticks).join(',')));
    expect(downbeats.filter((r) => r === '2,1,1').length / downbeats.length).toBeGreaterThan(0.15);
    const accents = (p: Piece) => p.bars.flatMap((b) => b.rh).filter((n) => n.articulation === 'accent').length;
    expect(of('polonaise').filter((p) => p.grade >= 3).every((p) => accents(p) > 0)).toBe(true);
    expect(of('polonaise').filter((p) => p.grade < 3).every((p) => accents(p) === 0)).toBe(true);
  });

  it('gives a Waltz a long first beat more often than a Minuet', () => {
    const longFirst = (list: Piece[]) => {
      const bars = list.filter((p) => p.grade >= 2).flatMap((p) => p.bars.slice(0, -1));
      return bars.filter((b) => b.rh[0].ticks >= 8).length / bars.length;
    };
    expect(longFirst(of('waltz'))).toBeGreaterThan(longFirst(of('minuet')) * 1.3);
  });

  it('keeps a Trio softer and thinner than a Minuet', () => {
    expect(GALANT_FORMS.trio.dynamic).toBe('p');
    const lhNotes = (list: Piece[]) => list.filter((p) => p.grade >= 4).reduce((a, p) => a + p.bars.flatMap((b) => b.lh).length, 0);
    expect(lhNotes(of('trio'))).toBeLessThan(lhNotes(of('minuet')));
  });
});
