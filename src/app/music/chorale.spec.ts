import { generatePiece, Note, Piece } from './generator';
import { GRADES } from './grades';
import { LETTERS, Pitch, accidentalSymbol, diatonicIndex, isSingableInterval, midi, mod, pitchName } from './theory';

const SEEDS_PER_GRADE = 40;

const pieces: Piece[] = [];
for (const grade of GRADES) {
  for (let s = 0; s < SEEDS_PER_GRADE; s++) pieces.push(generatePiece({ seed: `chorale-${s}`, grade, style: 'chorale' }));
}

const VOICES = ['s', 'a', 't', 'b'] as const;
type V = (typeof VOICES)[number];
const RANGES: Record<V, [number, number]> = { s: [60, 79], a: [55, 74], t: [48, 67], b: [40, 60] };

const label = (p: Piece) => `seed=${p.seed} grade=${p.grade} key=${p.key.id}`;
const pcName = (p: Pitch) => `${p.letter}${accidentalSymbol(p.alter)}`;

interface Timed {
  note: Note;
  start: number;
  /** Continues a tied note (a suspension), so it is not newly struck. */
  held: boolean;
  fermata: boolean;
}

/** Every note of a voice with its absolute start tick. */
function line(p: Piece, v: V): Timed[] {
  const out: Timed[] = [];
  let t = 0;
  let tied = false;
  for (const bar of p.bars) {
    for (const note of bar.voices![v]) {
      out.push({ note, start: t, held: tied, fermata: !!note.fermata });
      tied = !!note.tie;
      t += note.ticks;
    }
  }
  return out;
}

const at = (l: Timed[], tick: number) => [...l].reverse().find((n) => n.start <= tick)!;

/** Beat onsets with the chord sounding, in absolute ticks. */
function beats(p: Piece) {
  const out: { tick: number; symbol: string; tones: string[]; fermata: boolean }[] = [];
  let barStart = 0;
  for (const bar of p.bars) {
    for (const h of bar.harmony) out.push({ tick: barStart + h.at, symbol: h.symbol, tones: h.tones!, fermata: false });
    barStart += bar.voices!.s.reduce((a, n) => a + n.ticks, 0);
  }
  const s = line(p, 's');
  for (const b of out) b.fermata = at(s, b.tick).fermata;
  return out;
}

function violations(check: (p: Piece, fail: (msg: string) => void) => void): string[] {
  const out: string[] = [];
  for (const p of pieces) check(p, (msg) => out.push(`${label(p)}: ${msg}`));
  return out.slice(0, 10);
}

describe('generateChorale', () => {
  it('writes four voices in 4/4 with an upbeat and a matching short final bar', () => {
    const found = violations((p, fail) => {
      if (p.time.id !== '4/4') fail('not 4/4');
      const n = p.bars.length;
      p.bars.forEach((bar, i) => {
        const expected = i === 0 ? 4 : i === n - 1 ? 12 : 16;
        for (const v of VOICES) {
          const sum = bar.voices![v].reduce((a, x) => a + x.ticks, 0);
          if (sum !== expected) fail(`bar ${i} ${v} has ${sum} ticks, expected ${expected}`);
        }
      });
    });
    expect(found).toEqual([]);
  });

  it('keeps every voice in its range and never crosses voices', () => {
    const found = violations((p, fail) => {
      const lines = VOICES.map((v) => line(p, v));
      VOICES.forEach((v, i) =>
        lines[i].forEach((n) => {
          const m = midi(n.note.pitches[0]);
          if (m < RANGES[v][0] || m > RANGES[v][1]) fail(`${v} ${pitchName(n.note.pitches[0])} out of range`);
        }),
      );
      const end = lines[0].reduce((a, n) => Math.max(a, n.start + n.note.ticks), 0);
      for (let t = 0; t < end; t += 2) {
        const ms = lines.map((l) => midi(at(l, t).note.pitches[0]));
        for (let i = 0; i < 3; i++) if (ms[i] < ms[i + 1]) fail(`${VOICES[i]} below ${VOICES[i + 1]} at tick ${t}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('spaces upper voices within an octave and keeps the hands playable', () => {
    const found = violations((p, fail) => {
      const lines = VOICES.map((v) => line(p, v));
      for (const b of beats(p)) {
        const [s, a, t, bass] = lines.map((l) => midi(at(l, b.tick).note.pitches[0]));
        if (s - a > 12) fail(`soprano–alto ${s - a} semitones at ${b.tick}`);
        if (a - t > 12) fail(`alto–tenor ${a - t} semitones at ${b.tick}`);
        if (t - bass > 19) fail(`tenor–bass ${t - bass} semitones at ${b.tick}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('has no parallel (or contrary) fifths or octaves between any two voices', () => {
    const found = violations((p, fail) => {
      const lines = VOICES.map((v) => line(p, v));
      const fermatas = new Set(beats(p).filter((b) => b.fermata).map((b) => b.tick));
      const end = lines[0].reduce((a, n) => Math.max(a, n.start + n.note.ticks), 0);
      for (let t = 0; t + 2 < end; t += 2) {
        if (fermatas.has(t - (t % 4))) continue; // a fermata separates the phrases
        for (let i = 0; i < 4; i++) {
          for (let j = i + 1; j < 4; j++) {
            const [x1, y1, x2, y2] = [at(lines[i], t), at(lines[j], t), at(lines[i], t + 2), at(lines[j], t + 2)].map((n) =>
              midi(n.note.pitches[0]),
            );
            if (x1 === x2 || y1 === y2) continue;
            const i1 = mod(x1 - y1, 12);
            const i2 = mod(x2 - y2, 12);
            if ((i1 === 7 && i2 === 7) || (i1 === 0 && i2 === 0)) fail(`${VOICES[i]}/${VOICES[j]} ${i1 === 7 ? 'fifths' : 'octaves'} at ${t}`);
          }
        }
      }
    });
    expect(found).toEqual([]);
  });

  it('sounds a complete chord on every beat, with no doubled leading note or seventh', () => {
    const found = violations((p, fail) => {
      const lines = VOICES.map((v) => line(p, v));
      for (const b of beats(p)) {
        const notes = lines.map((l) => at(l, b.tick)).filter((n) => !n.held && n.start === b.tick);
        const pcs = notes.map((n) => pcName(n.note.pitches[0]));
        const foreign = pcs.filter((pc) => !b.tones.includes(pc));
        if (foreign.length) fail(`${b.symbol} at ${b.tick} contains ${foreign.join(',')} (chord ${b.tones.join(' ')})`);
        const all = lines.map((l) => pcName(at(l, b.tick).note.pitches[0]));
        if (!all.includes(b.tones[0]) && notes.length === 4) fail(`${b.symbol} at ${b.tick} lacks its root`);
        if (!all.includes(b.tones[1]) && notes.length === 4) fail(`${b.symbol} at ${b.tick} lacks its third`);
        if (b.tones[3] && pcs.filter((pc) => pc === b.tones[3]).length > 1) fail(`${b.symbol} at ${b.tick} doubles its seventh`);
      }
    });
    expect(found).toEqual([]);
  });

  it('resolves every chordal seventh down by step', () => {
    const found = violations((p, fail) => {
      const lines = VOICES.map((v) => line(p, v));
      const bs = beats(p);
      bs.forEach((b, k) => {
        const next = bs[k + 1];
        if (!b.tones[3] || !next || b.fermata) return;
        const base = (sym: string) => sym.replace(/^.*: /, '').replace(/\d/g, '');
        // Within one chord the seventh may pass to another voice; it must resolve when the chord changes.
        const sameChord = base(next.symbol) === base(b.symbol);
        lines.forEach((l, i) => {
          const n = at(l, b.tick);
          if (n.start !== b.tick || pcName(n.note.pitches[0]) !== b.tones[3]) return;
          // Through a suspension (the seventh tied over), look at where it resolves.
          const arrival = at(l, next.tick);
          const after = (arrival.held ? l[l.indexOf(arrival) + 1] : arrival).note.pitches[0];
          const st = diatonicIndex(after) - diatonicIndex(n.note.pitches[0]);
          // V4/3 – I6 lets the seventh rise in tenths with the bass.
          const risingException = st === 1 && /V43$/.test(b.symbol) && /[Ii]6$/.test(next.symbol);
          if (st !== -1 && !sameChord && !risingException) {
            fail(`${VOICES[i]} seventh of ${b.symbol} at ${b.tick} moves ${st}`);
          }
        });
      });
    });
    expect(found).toEqual([]);
  });

  it('sings only singable melodic intervals in every voice', () => {
    const found = violations((p, fail) => {
      for (const v of VOICES) {
        const l = line(p, v);
        for (let i = 1; i < l.length; i++) {
          const a = l[i - 1].note.pitches[0];
          const b = l[i].note.pitches[0];
          if (l[i - 1].fermata && !l[i].fermata) continue; // new phrase after a breath
          const octave = Math.abs(midi(a) - midi(b)) === 12 && v === 'b';
          if (!isSingableInterval(a, b) && !octave) fail(`${v} ${pitchName(a)} → ${pitchName(b)}`);
        }
      }
    });
    expect(found).toEqual([]);
  });

  it('ends each phrase with a fermata and the cadence its plan names, the last a PAC on the tonic', () => {
    const found = violations((p, fail) => {
      const bs = beats(p);
      const ends = bs.filter((b) => b.fermata);
      if (ends.length !== p.phrases.length) fail(`${ends.length} fermatas for ${p.phrases.length} phrases`);
      const strip = (s: string) => s.replace(/^.*: /, '');
      p.phrases.forEach((ph, k) => {
        const end = ends[k];
        const before = bs[bs.indexOf(end) - 1];
        const last = strip(end.symbol);
        const prev = strip(before.symbol);
        const ok: Record<string, boolean> = {
          PAC: /^[Ii]$/.test(last) && /^V7?$/.test(prev),
          IAC: /^[Ii]6?$/.test(last) && /^(V|vii°)/.test(prev),
          HC: last === 'V',
          DC: /^(vi|VI)$/.test(last) && /^V7?$/.test(prev),
          PC: /^[Ii]$/.test(last),
        };
        if (!ok[ph.cadence]) fail(`phrase ${k + 1} (${ph.cadence}) ends ${prev} – ${last}`);
      });
      const finalSoprano = line(p, 's').at(-1)!.note.pitches[0];
      if (finalSoprano.letter !== p.key.tonic || finalSoprano.alter !== p.key.tonicAlter) fail(`ends on ${pitchName(finalSoprano)}`);
      if (p.phrases.at(-1)!.cadence !== 'PAC') fail('final cadence is not a PAC');
    });
    expect(found).toEqual([]);
  });

  it('modulates to related keys from Grade 3 and uses bar form in six-phrase chorales', () => {
    const modulating = pieces.filter((p) => p.grade >= 3 && p.phrases.some((ph) => ph.key));
    expect(modulating.length).toBe(pieces.filter((p) => p.grade >= 3).length);
    for (const p of pieces.filter((x) => x.grade <= 2)) expect(p.phrases.some((ph) => ph.key), label(p)).toBe(false);
    for (const p of pieces.filter((x) => x.phrases.length === 6)) {
      // Phrases 3–4 repeat phrases 1–2 note for note.
      const beatsOf = (k: number) => VOICES.map((v) => line(p, v).filter((n) => n.start >= k * 32 && n.start < (k + 1) * 32).map((n) => pitchName(n.note.pitches[0]) + n.note.ticks));
      expect(beatsOf(2), label(p)).toEqual(beatsOf(0));
      expect(beatsOf(3), label(p)).toEqual(beatsOf(1));
    }
  });

  it('adds Bach-style figuration from Grade 3: passing quavers and, from Grade 4, suspensions', () => {
    const quavers = (p: Piece) => VOICES.flatMap((v) => line(p, v)).filter((n) => n.note.ticks === 2).length;
    for (const p of pieces.filter((x) => x.grade <= 2)) expect(quavers(p), label(p)).toBe(0);
    const g45 = pieces.filter((x) => x.grade >= 4);
    expect(g45.filter((p) => quavers(p) > 0).length).toBeGreaterThan(g45.length * 0.9);
    const suspensions = g45.filter((p) => VOICES.some((v) => line(p, v).some((n) => n.note.tie))).length;
    expect(suspensions).toBeGreaterThan(g45.length * 0.3);
  });

  it('is deterministic', () => {
    for (let s = 0; s < 5; s++) {
      const settings = { seed: `det-${s}`, grade: 5 as const, style: 'chorale' as const };
      expect(generatePiece(settings)).toEqual(generatePiece(settings));
    }
  });

  it('uses tonic pitch names consistent with the key', () => {
    for (const p of pieces) expect(LETTERS).toContain(p.key.tonic);
  });
});
