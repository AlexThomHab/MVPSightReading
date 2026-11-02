import { HARMONY_LIBRARY, progressionOk, tensionBuilds } from './chopin';
import { RChord, chordFor, leadsTo } from './chopin/chords';
import { degreeOfLetter, homeKey, isChromatic, pcAbove, pcOf, pcSemis, samePc, scaleDegreePc } from './pitch-class';
import { generatePiece } from './generator';
import { Note, Piece } from './model';
import { GRADES, GRADE_SPECS } from './grades';
import { diatonicIndex, keyById, keyName, midi, pitchName } from './theory';

const SEEDS = 10;

/** Every grade, every metre it allows, several seeds — plus a sweep of key overrides. */
const pieces: Piece[] = [];
for (const grade of GRADES) {
  for (const timeId of GRADE_SPECS[grade].times) {
    for (let s = 0; s < SEEDS; s++) pieces.push(generatePiece({ seed: `ch-${s}`, grade, style: 'chopin', timeId }));
  }
  for (const keyId of GRADE_SPECS[grade].keys) pieces.push(generatePiece({ seed: `key-${keyId}`, grade, style: 'chopin', keyId }));
}

const label = (p: Piece) => `seed=${p.seed} grade=${p.grade} key=${p.key.id} time=${p.time.id} (${p.title})`;
const sum = (ns: Note[]) => ns.reduce((a, n) => a + n.ticks, 0);
const bare = (symbol: string) => symbol.replace(/ \(pedal\)$/, '');

interface Timed {
  note: Note;
  bar: number;
  index: number;
  start: number;
  end: number;
}
/** Notes of one hand with absolute times. */
function line(p: Piece, hand: 'rh' | 'lh'): Timed[] {
  const out: Timed[] = [];
  p.bars.forEach((bar, b) => {
    let t = b * p.time.barTicks;
    bar[hand].forEach((note, index) => {
      out.push({ note, bar: b, index, start: t, end: t + note.ticks });
      t += note.ticks;
    });
  });
  return out;
}
/** The chord sounding at a moment. */
function chordAt(p: Piece, bar: number, at: number): RChord {
  const h = [...p.bars[bar].harmony].reverse().find((x) => x.at <= at)!;
  return chordFor(homeKey(p.key), bare(h.symbol));
}
const local = (p: Piece, n: Timed) => chordAt(p, n.bar, n.start - n.bar * p.time.barTicks);
const symbols = (p: Piece) => p.bars.flatMap((b) => b.harmony.map((h) => bare(h.symbol)));
const chords = (p: Piece) => symbols(p).map((s) => chordFor(homeKey(p.key), s));
const mean = (list: Piece[], f: (p: Piece) => number) => list.reduce((a, p) => a + f(p), 0) / list.length;
const ofGrade = (g: number) => pieces.filter((p) => p.grade === g);

function violations(list: Piece[], check: (p: Piece, fail: (m: string) => void) => void): string[] {
  const out: string[] = [];
  for (const p of list) check(p, (m) => out.push(`${label(p)}: ${m}`));
  return out.slice(0, 10);
}

describe('Chopin style: harmony library', () => {
  it('resolves every chord of every progression in the library, in major and minor', () => {
    const bad: string[] = [];
    for (const [unit, libs] of Object.entries(HARMONY_LIBRARY)) {
      for (const [mode, lib] of Object.entries(libs)) {
        const key = homeKey(keyById(mode === 'major' ? 'C' : 'Am')!);
        for (const [pattern] of lib) {
          const bars = pattern.split('|').map((b) => b.trim().split(',').map((c) => c.trim()));
          if (!progressionOk(key, bars)) bad.push(`${unit} ${mode}: ${pattern}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('covers the techniques of Chopin’s harmony', () => {
    const all = Object.values(HARMONY_LIBRARY).flatMap((l) => [...l.major, ...l.minor].map(([p]) => p));
    const has = (re: RegExp) => all.some((p) => re.test(p));
    expect(has(/V7\/(vi|ii|IV|iv|III|VI)/)).toBe(true); // applied dominants (tonicisation)
    expect(has(/vii°7\//)).toBe(true); // applied diminished sevenths
    expect(has(/vii°7\/iii/) && has(/\^/)).toBe(true); // the common-tone diminished seventh over a pedal
    expect(has(/IV, iv/) && has(/bVI/)).toBe(true); // modal mixture
    expect(has(/V42\/IV \| IV6, iv6/) && has(/V6 \| V42\/iv, iv6/)).toBe(true); // chromatic lament basses
    expect(has(/V7\/vi \| V7\/ii \| V7\/V \| V7/)).toBe(true); // a chain of dominants round the circle of fifths
    expect(has(/N6/) && has(/Ger\+6/) && has(/It\+6/)).toBe(true); // Neapolitan and augmented sixths
  });

  it('knows where each chord is going', () => {
    const C = homeKey(keyById('C')!);
    const c = (s: string) => chordFor(C, s);
    expect(leadsTo(c('V7/vi'), c('vi'))).toBe(true);
    expect(leadsTo(c('V7/vi'), c('ii'))).toBe(false);
    expect(leadsTo(c('V7/vi'), c('V7/ii'))).toBe(true); // a chain of dominants
    expect(leadsTo(c('vii°7/V'), c('I64'))).toBe(true);
    expect(leadsTo(c('I64'), c('V7'))).toBe(true);
    expect(leadsTo(c('I64'), c('IV'))).toBe(false);
    expect(leadsTo(c('Ger+6'), c('V'))).toBe(true);
    expect(leadsTo(c('vii°7/iii'), c('I'))).toBe(true); // common-tone diminished seventh
    expect(leadsTo(c('V7'), c('vi'))).toBe(true); // deceptive
    expect(leadsTo(c('V7'), c('IV'))).toBe(false);
  });
});

describe('Chopin style', () => {
  it('generates across every grade, metre and key the grade allows', () => {
    expect(pieces.length).toBeGreaterThan(250);
    for (const p of pieces) {
      expect(p.style).toBe('chopin');
      expect(GRADE_SPECS[p.grade].keys, label(p)).toContain(p.key.id);
      expect(GRADE_SPECS[p.grade].times, label(p)).toContain(p.time.id);
    }
  });

  it('respects the selected key and time signature', () => {
    const p = generatePiece({ seed: 'pick', grade: 4, style: 'chopin', keyId: 'Eb', timeId: '6/8' });
    expect(p.key.id).toBe('Eb');
    expect(p.time.id).toBe('6/8');
  });

  it('is deterministic, and different seeds give different music', () => {
    const a = { seed: 'same', grade: 5 as const, style: 'chopin' as const };
    expect(generatePiece(a)).toEqual(generatePiece(a));
    const melodies = new Set(Array.from({ length: 8 }, (_, s) => JSON.stringify(generatePiece({ ...a, seed: `v${s}` }).bars.map((b) => b.rh))));
    expect(melodies.size).toBe(8);
  });

  it('fills every bar exactly, in both hands, with durations the grade allows', () => {
    const found = violations(pieces, (p, fail) => {
      const spec = GRADE_SPECS[p.grade];
      if (!spec.bars.includes(p.bars.length)) fail(`${p.bars.length} bars`);
      p.bars.forEach((bar, b) => {
        if (sum(bar.rh) !== p.time.barTicks) fail(`bar ${b + 1} RH ${sum(bar.rh)} ticks`);
        if (sum(bar.lh) !== p.time.barTicks) fail(`bar ${b + 1} LH ${sum(bar.lh)} ticks`);
        for (const n of [...bar.rh, ...bar.lh]) if (!spec.durations.includes(n.ticks)) fail(`bar ${b + 1} duration ${n.ticks}`);
      });
    });
    expect(found).toEqual([]);
  });

  it('is playable: leaps and stretches within the grade, the bass lowest, the hands apart', () => {
    const found = violations(pieces, (p, fail) => {
      const spec = GRADE_SPECS[p.grade];
      const rh = line(p, 'rh');
      const lh = line(p, 'lh').filter((n) => !n.note.rest);
      for (let i = 1; i < rh.length; i++) {
        const leap = Math.abs(diatonicIndex(rh[i].note.pitches[0]) - diatonicIndex(rh[i - 1].note.pitches[0]));
        if (leap > spec.maxLeap) fail(`RH leap ${leap} at bar ${rh[i].bar + 1}`);
      }
      for (const n of lh) {
        const ms = n.note.pitches.map(midi);
        if (Math.max(...ms) - Math.min(...ms) > 12) fail(`LH chord spans ${Math.max(...ms) - Math.min(...ms)} semitones`);
      }
      // Each new harmony's bass is within reach of the last.
      const basses = lh.filter((n, i) => i === 0 || p.bars[n.bar].harmony.some((h) => h.at === n.start - n.bar * p.time.barTicks));
      for (let i = 1; i < basses.length; i++) {
        const leap = Math.abs(diatonicIndex(basses[i].note.pitches[0]) - diatonicIndex(basses[i - 1].note.pitches[0]));
        if (leap > spec.maxBassLeap) fail(`bass leap ${leap} at bar ${basses[i].bar + 1}`);
      }
      // The left hand stays below the melody (grace notes included).
      for (const l of lh) {
        for (const r of rh) {
          const low = Math.min(midi(r.note.pitches[0]), ...(r.note.grace ?? []).map(midi));
          if (r.start < l.end && l.start < r.end && Math.max(...l.note.pitches.map(midi)) >= low) fail(`hands collide at bar ${l.bar + 1}`);
        }
      }
    });
    expect(found).toEqual([]);
  });

  it('builds the accompaniment from the harmony: every left-hand note belongs to the chord, or slides by semitone into the next', () => {
    let slides = 0;
    const found = violations(pieces, (p, fail) => {
      const changes = p.bars.flatMap((b, i) => b.harmony.map((h) => i * p.time.barTicks + h.at));
      for (const n of line(p, 'lh')) {
        const chord = local(p, n);
        for (const pitch of n.note.pitches) {
          if (chord.tones.some((t) => samePc(t, pcOf(pitch)))) continue;
          // A chromatic inner voice (Grade 4+): a semitone from a tone of this chord, moving on
          // by semitone to a tone of the next.
          const nextChange = changes.find((t) => t > n.start);
          const next = nextChange === undefined ? null : chordAt(p, Math.floor(nextChange / p.time.barTicks), nextChange % p.time.barTicks);
          const semitone = (t: { l: number; a: number }) => [1, 11].includes((((pcSemis(t) - pcSemis(pcOf(pitch))) % 12) + 12) % 12);
          if (p.grade >= 4 && chord.tones.some(semitone) && next?.tones.some(semitone)) slides++;
          else fail(`bar ${n.bar + 1} LH ${pitchName(pitch)} not in ${chord.symbol}`);
        }
      }
    });
    expect(found).toEqual([]);
    // Chromatic inner voices are a feature from Grade 4, not an accident.
    expect(slides).toBeGreaterThan(0);
    for (const p of pieces.filter((x) => x.grade <= 3)) {
      for (const n of line(p, 'lh')) for (const pitch of n.note.pitches) expect(local(p, n).tones.some((t) => samePc(t, pcOf(pitch))), label(p)).toBe(true);
    }
  });

  it('plans a directed progression: every applied chord, diminished seventh and augmented sixth resolves', () => {
    const found = violations(pieces, (p, fail) => {
      const halfCloses = new Set(p.phrases.filter((ph) => ph.cadence === 'HC').map((ph) => ph.startBar + ph.bars - 1));
      const bars = p.bars.map((b) => b.harmony.map((h) => bare(h.symbol)));
      if (!progressionOk(homeKey(p.key), bars, halfCloses)) fail(bars.map((b) => b.join(',')).join(' | '));
    });
    expect(found).toEqual([]);
  });

  it('gives every chromatic melody note a function, and spells it by its direction', () => {
    const found = violations(pieces, (p, fail) => {
      const key = homeKey(p.key);
      const rh = line(p, 'rh');
      rh.forEach((n, i) => {
        const pitch = n.note.pitches[0];
        for (const g of n.note.grace ?? []) if (Math.abs(midi(g) - midi(pitch)) > 2) fail(`bar ${n.bar + 1} grace note ${pitchName(g)} is not beside its note`);
        if (!isChromatic(key, pcOf(pitch))) return;
        const chord = local(p, n);
        if (chord.tones.some((t) => samePc(t, pcOf(pitch)))) return; // a chromatic chord tone
        const prev = rh[i - 1]?.note.pitches[0];
        const next = rh[i + 1]?.note.pitches[0];
        // It moves on by step (a passing, neighbour, approach or appoggiatura note)…
        const step = next && Math.abs(diatonicIndex(next) - diatonicIndex(pitch)) <= 1 && Math.abs(midi(next) - midi(pitch)) <= 2;
        if (!step) fail(`bar ${n.bar + 1} ${pitchName(pitch)} → ${next ? pitchName(next) : 'end'} has no function`);
        // …and a chromatic passing note keeps the letter it leaves: C–C♯–D, D–D♭–C.
        if (prev && next && Math.abs(midi(next) - midi(prev)) === 2 && Math.abs(midi(pitch) - midi(prev)) === 1 && pitch.letter !== prev.letter) {
          fail(`bar ${n.bar + 1} ${pitchName(prev)}–${pitchName(pitch)}–${pitchName(next)} is misspelled`);
        }
      });
    });
    expect(found).toEqual([]);
  });

  it('avoids false relations: no melody note contradicts the harmony’s spelling of its letter', () => {
    const found = violations(pieces, (p, fail) => {
      for (const n of line(p, 'rh')) {
        const pitch = n.note.pitches[0];
        const chord = local(p, n);
        if (chord.tones.some((t) => t.l === pcOf(pitch).l && t.a !== pitch.alter)) fail(`bar ${n.bar + 1} ${pitchName(pitch)} against ${chord.symbol}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('resolves tendency tones in the melody: leading notes rise, sevenths fall', () => {
    const found = violations(pieces, (p, fail) => {
      const rh = line(p, 'rh');
      for (let i = 0; i + 1 < rh.length; i++) {
        const a = rh[i];
        const b = rh[i + 1];
        if (a.note.tie) continue;
        const ca = local(p, a);
        const cb = local(p, b);
        if (ca.symbol === cb.symbol && a.bar === b.bar) continue;
        if (p.phrases.some((ph) => ph.startBar === b.bar) && a.bar !== b.bar) continue;
        const pa = pcOf(a.note.pitches[0]);
        const move = midi(b.note.pitches[0]) - midi(a.note.pitches[0]);
        // (An appoggiatura or suspension may delay the resolution by one note.)
        const after = rh[i + 2] ? midi(rh[i + 2].note.pitches[0]) - midi(a.note.pitches[0]) : move;
        if (ca.rising.some((t) => samePc(t, pa)) && cb.tones.some((t) => samePc(t, pcAbove(pa, 1, 1))) && move !== 1 && after !== 1) {
          fail(`bar ${a.bar + 1} leading note ${pitchName(a.note.pitches[0])} of ${ca.symbol} does not rise`);
        }
        if (ca.falling.some((t) => samePc(t, pa)) && !(move <= 0 && move >= -2) && !(after <= -1 && after >= -2)) {
          fail(`bar ${a.bar + 1} ${pitchName(a.note.pitches[0])} of ${ca.symbol} does not fall`);
        }
      }
    });
    expect(found.length).toBeLessThan(5);
  });

  it('keeps the melody and bass free of parallel fifths and octaves between main notes', () => {
    let parallels = 0;
    for (const p of pieces) {
      // The notes sounding at each change of harmony.
      const rh = line(p, 'rh');
      const lh = line(p, 'lh');
      const changes = p.bars.flatMap((b, i) => b.harmony.map((h) => i * p.time.barTicks + h.at));
      const at = (l: Timed[], t: number) => l.find((n) => n.start <= t && t < n.end)!;
      const ct = (t: number) => {
        const n = at(rh, t);
        return local(p, n).tones.some((x) => samePc(x, pcOf(n.note.pitches[0])));
      };
      for (let k = 1; k < changes.length; k++) {
        // (An appoggiatura or suspension on the change is a dissonance, not a fifth or octave.)
        if (!ct(changes[k - 1]) || !ct(changes[k])) continue;
        const [m0, m1] = [at(rh, changes[k - 1]), at(rh, changes[k])].map((n) => midi(n.note.pitches[0]));
        const [b0, b1] = [at(lh, changes[k - 1]), at(lh, changes[k])].map((n) => midi(n.note.pitches[0]));
        const i0 = (((m0 - b0) % 12) + 12) % 12;
        const i1 = (((m1 - b1) % 12) + 12) % 12;
        if ((i0 === 0 || i0 === 7) && i0 === i1 && m0 !== m1 && Math.sign(m1 - m0) === Math.sign(b1 - b0)) parallels++;
      }
    }
    expect(parallels / pieces.length).toBeLessThan(0.08);
  });

  it('establishes the key: tonic at the start, a dominant–tonic cadence and the tonic in both hands at the end', () => {
    const found = violations(pieces, (p, fail) => {
      const syms = symbols(p);
      if (!/^[Ii]$/.test(syms[0])) fail(`starts on ${syms[0]}`);
      if (!/^[Ii]$/.test(syms[syms.length - 1])) fail(`ends on ${syms[syms.length - 1]}`);
      if (!/^V7?$/.test(syms[syms.length - 2])) fail(`approaches the end from ${syms[syms.length - 2]}`);
      const rh = line(p, 'rh');
      const lh = line(p, 'lh');
      const last = rh[rh.length - 1].note.pitches[0];
      if (last.letter !== p.key.tonic || last.alter !== p.key.tonicAlter) fail(`melody ends on ${pitchName(last)}`);
      const before = rh.filter((n) => !n.note.tie || n.bar < p.bars.length - 1);
      const approach = before[before.length - 2].note.pitches[0];
      if (Math.abs(diatonicIndex(last) - diatonicIndex(approach)) !== 1) fail('final note not approached by step');
      const bass = lh[lh.length - 1].note.pitches[0];
      if (bass.letter !== p.key.tonic) fail(`bass ends on ${pitchName(bass)}`);
    });
    expect(found).toEqual([]);
  });

  it('ends each phrase with its cadence', () => {
    const found = violations(pieces, (p, fail) => {
      for (const ph of p.phrases) {
        const end = p.bars[ph.startBar + ph.bars - 1].harmony;
        const goal = bare(end[end.length - 1].symbol);
        if (ph.cadence === 'HC' && !/^V7?$/.test(goal)) fail(`half cadence ends on ${goal}`);
        if (ph.cadence === 'PAC' && !/^[Ii]$/.test(goal)) fail(`perfect cadence ends on ${goal}`);
      }
    });
    expect(found).toEqual([]);
  });

  it('builds to one prepared climax, after the opening and before the close', () => {
    let unique = 0;
    let leapt = 0;
    const found = violations(pieces, (p, fail) => {
      const rh = line(p, 'rh');
      const top = Math.max(...rh.map((n) => midi(n.note.pitches[0])));
      const peaks = rh.filter((n) => midi(n.note.pitches[0]) === top);
      if (peaks.length === 1) unique++;
      const at = peaks[0].bar / p.bars.length;
      if (p.bars.length > 4 && at < 0.35) fail(`peak in bar ${peaks[0].bar + 1}`);
      if (peaks[0].bar === p.bars.length - 1) fail('peak in the final bar');
      // Is it reached by an expressive leap (a fourth or more)?
      const i = rh.indexOf(peaks[0]);
      if (i > 0 && diatonicIndex(peaks[0].note.pitches[0]) - diatonicIndex(rh[i - 1].note.pitches[0]) >= 3) leapt++;
    });
    expect(found).toEqual([]);
    expect(unique / pieces.length).toBeGreaterThan(0.85);
    // Many — not all — climaxes are reached by a leap from Grade 3.
    expect(leapt).toBeGreaterThan(pieces.length * 0.12);
  });

  it('sings: mostly steps, with leaps the exception and no aimless scales', () => {
    const ratios: number[] = [];
    const found = violations(pieces, (p, fail) => {
      const rh = line(p, 'rh').map((n) => diatonicIndex(n.note.pitches[0]));
      let run = 0;
      let steps = 0;
      for (let i = 1; i < rh.length; i++) {
        const step = rh[i] - rh[i - 1];
        if (Math.abs(step) <= 1) steps++;
        const prev = rh[i - 1] - (rh[i - 2] ?? rh[i - 1]);
        run = Math.abs(step) === 1 && step === prev ? run + 1 : Math.abs(step) === 1 ? 1 : 0;
        if (run > 7) fail(`a run of ${run} steps at note ${i}`);
      }
      // (A Grade 1 five-finger tune over changing chords moves more by thirds.)
      ratios.push(steps / (rh.length - 1));
      if (steps / (rh.length - 1) < (p.grade === 1 ? 0.3 : 0.35)) fail(`only ${Math.round((100 * steps) / (rh.length - 1))}% steps`);
    });
    expect(found).toEqual([]);
    // Taken together, the melodies move mostly by step.
    expect(ratios.reduce((a, b) => a + b, 0) / ratios.length).toBeGreaterThan(0.6);
  });

  it('develops its motif: a return begins as the opening did; a sentence repeats its rhythm in sequence', () => {
    const returns = pieces.filter((p) => p.phrases.some((ph) => ph.repeatsOpening));
    let exact = 0;
    for (const p of returns) {
      const ph = p.phrases.find((x) => x.repeatsOpening)!;
      const first = p.bars[0].rh[0].pitches[0];
      const back = p.bars[ph.startBar].rh.slice(0, 2).map((n) => n.pitches[0]);
      // Exactly, or after an appoggiatura that decorates the return.
      if (back.some((x) => midi(x) === midi(first))) exact++;
    }
    expect(exact / returns.length).toBeGreaterThan(0.85);
    const sentences = pieces.filter((p) => p.bars.length === 8 && p.phrases.length === 1);
    const onsets = (ns: Note[]) => ns.reduce<number[]>((acc, _, i) => [...acc, i ? acc[i - 1] + ns[i - 1].ticks : 0], []);
    const sequenced = sentences.filter((p) => {
      const a = onsets(p.bars[0].rh);
      const b = onsets(p.bars[2].rh);
      return a.every((t) => b.includes(t)) || b.every((t) => a.includes(t));
    });
    expect(sequenced.length / sentences.length).toBeGreaterThan(0.7);
  });

  it('decorates a returning phrase more richly than the original', () => {
    const returns = pieces.filter((p) => p.grade >= 3 && p.phrases.some((ph) => ph.repeatsOpening));
    const richer = returns.filter((p) => {
      const ph = p.phrases.find((x) => x.repeatsOpening)!;
      return p.bars[ph.startBar].rh.length > p.bars[0].rh.length || p.bars[ph.startBar].rh.some((n) => n.grace || n.ornament);
    });
    expect(richer.length / returns.length).toBeGreaterThan(0.6);
  });

  it('grows richer with the grade: diatonic at Grades 1–2, applied chords from 3, diminished sevenths and mixture from 4', () => {
    const chromaticChords = (p: Piece) => chords(p).filter((c) => c.chromatic && c.kind !== 'cadential64').length;
    const chromaticNotes = (p: Piece) => line(p, 'rh').filter((n) => isChromatic(homeKey(p.key), pcOf(n.note.pitches[0]))).length;
    expect(mean(ofGrade(1), chromaticChords)).toBe(0);
    expect(mean(ofGrade(2), chromaticChords)).toBe(0);
    for (const p of ofGrade(1)) expect(chromaticNotes(p), label(p)).toBe(0);
    for (const p of ofGrade(2)) expect(chromaticNotes(p), label(p)).toBeLessThanOrEqual(2);
    expect(mean(ofGrade(4), chromaticChords)).toBeGreaterThan(mean(ofGrade(3), chromaticChords));
    expect(mean(ofGrade(5), chromaticChords)).toBeGreaterThan(mean(ofGrade(3), chromaticChords));
    const share = (g: number, test: (c: RChord) => boolean) => ofGrade(g).filter((p) => chords(p).some(test)).length / ofGrade(g).length;
    expect(share(3, (c) => c.kind === 'applied')).toBeGreaterThan(0.8);
    expect(share(4, (c) => c.symbol.includes('°7') || c.kind === 'mixture')).toBeGreaterThan(0.6);
    expect(share(5, (c) => c.kind === 'neapolitan' || c.kind === 'aug6')).toBeGreaterThan(0.5);
    // Not an exercise with accidentals: chromatic melody notes stay a seasoning.
    for (const g of [3, 4, 5]) expect(mean(ofGrade(g), chromaticNotes) / mean(ofGrade(g), (p) => line(p, 'rh').length)).toBeLessThan(0.15);
  });

  it('ornaments more as the grade rises: grace notes from Grade 4, turns and trills at Grade 5', () => {
    const graces = (p: Piece) => line(p, 'rh').filter((n) => n.note.grace).length;
    const signs = (p: Piece) => line(p, 'rh').filter((n) => n.note.ornament).length;
    const fine = (p: Piece) => line(p, 'rh').filter((n) => n.note.ticks === 1).length;
    for (const g of [1, 2]) expect(mean(ofGrade(g), (p) => graces(p) + signs(p) + fine(p))).toBe(0);
    expect(mean(ofGrade(3), signs)).toBe(0);
    expect(mean(ofGrade(4), graces)).toBeGreaterThan(mean(ofGrade(3), graces));
    expect(mean(ofGrade(5), (p) => graces(p) + signs(p))).toBeGreaterThan(mean(ofGrade(4), (p) => graces(p) + signs(p)));
    expect(ofGrade(5).filter((p) => line(p, 'rh').some((n) => n.note.ornament?.type === 'trill')).length).toBeGreaterThan(0);
    expect(ofGrade(5).filter((p) => line(p, 'rh').some((n) => n.note.ornament?.type === 'turn')).length).toBeGreaterThan(0);
    // An ornament sign knows its neighbouring notes, a step either side.
    for (const p of ofGrade(5)) {
      for (const n of line(p, 'rh')) {
        const o = n.note.ornament;
        if (!o) continue;
        expect(diatonicIndex(o.upper) - diatonicIndex(n.note.pitches[0]), label(p)).toBe(1);
        if (o.lower) expect(diatonicIndex(n.note.pitches[0]) - diatonicIndex(o.lower), label(p)).toBe(1);
      }
    }
  });

  it('varies character: nocturnes, preludes, waltzes and mazurkas', () => {
    const titles = new Set(pieces.map((p) => p.title.replace(/ in .*$/, '')));
    expect([...titles].sort()).toEqual(['Mazurka', 'Nocturne', 'Prelude', 'Valse']);
  });

  describe('left-hand accompaniment', () => {
    /** The bars that carry the pattern (the last bar only holds the closing chord). */
    const body = (p: Piece) => p.bars.slice(0, -1);
    /** Flowing (one note at a time) or bass-and-chord. */
    const kind = (p: Piece) => (body(p).every((b) => b.lh.every((n) => n.pitches.length === 1)) ? 'flowing' : 'bassChord');

    it('keeps one pattern through the whole piece: one rhythm, one texture', () => {
      const found = violations(pieces, (p, fail) => {
        // One rhythmic unit throughout.
        const units = new Set(body(p).flatMap((b) => b.lh.map((n) => n.ticks)));
        if (units.size > 1) fail(`left-hand rhythm changes: ${[...units].join(', ')}`);
        // Either one note at a time in every bar, or bass-and-chord in every bar: no switching.
        const chordal = body(p).map((b) => b.lh.some((n) => n.pitches.length > 1));
        // (At Grades 1–2 the narrow left-hand range — one hand position for the whole piece —
        // can leave no room above a high bass: that bar's chords thin to a single note, in the
        // same rhythm.)
        if (p.grade > 2 && kind(p) === 'bassChord' && chordal.some((c) => !c)) fail('switches between flowing and chordal bars');
      });
      expect(found).toEqual([]);
    });

    it('never thickens into repeated block chords', () => {
      const found = violations(pieces, (p, fail) => {
        const lh = line(p, 'lh');
        lh.forEach((n, i) => {
          if (n.note.pitches.length > 3) fail(`bar ${n.bar + 1}: a ${n.note.pitches.length}-note chord`);
          if (n.bar < p.bars.length - 1 && n.note.pitches.length >= 3 && (lh[i + 1]?.note.pitches.length ?? 0) >= 3) {
            fail(`bar ${n.bar + 1}: three-note chords on consecutive beats`);
          }
        });
      });
      expect(found).toEqual([]);
    });

    it('in the bass-and-chord pattern, sounds the bass alone on the beat and the chord after it (as in the fingering studies)', () => {
      const found = violations(
        pieces.filter((p) => kind(p) === 'bassChord'),
        (p, fail) => {
          body(p).forEach((b, i) => {
            const first = b.lh[0];
            if (first.pitches.length > 2) fail(`bar ${i + 1} begins with a chord`);
            const low = Math.min(...first.pitches.map(midi));
            for (const n of b.lh) if (Math.min(...n.pitches.map(midi)) < low - 12) fail(`bar ${i + 1}: a chord below the bass`);
          });
        },
      );
      expect(found).toEqual([]);
    });

    it('chooses different patterns for different pieces, each suited to its character', () => {
      const patterns = (list: Piece[]) => new Set(list.map((p) => `${kind(p)}:${body(p)[0].lh[0].ticks}`));
      const upper = pieces.filter((p) => p.grade >= 3);
      expect(patterns(upper.filter((p) => p.title.startsWith('Nocturne'))).size).toBeGreaterThanOrEqual(2);
      expect(patterns(upper.filter((p) => p.title.startsWith('Prelude'))).size).toBeGreaterThanOrEqual(2);
      // Waltzes and mazurkas keep their bass-and-chord accompaniment.
      for (const p of pieces.filter((x) => /^(Valse|Mazurka)/.test(x.title))) expect(kind(p), label(p)).toBe('bassChord');
      // A wide arpeggio (bass, fifth, octave or tenth) appears among flowing accompaniments.
      const spread = (p: Piece) => Math.max(...body(p).map((b) => Math.max(...b.lh.map((n) => midi(n.pitches[0]))) - midi(b.lh[0].pitches[0])));
      expect(upper.filter((p) => kind(p) === 'flowing' && spread(p) >= 15).length).toBeGreaterThan(0);
    });
  });

  it('writes expressive markings that fit the phrase: a dynamic to start, a swell to the climax, a fade to the end', () => {
    const found = violations(pieces, (p, fail) => {
      const e = p.expression!;
      const valid = (r: { bar: number; index: number }) => r.bar < p.bars.length && r.index < p.bars[r.bar].rh.length;
      if (!e.dynamics.length || e.dynamics[0].at.bar !== 0 || e.dynamics[0].at.index !== 0) fail('no opening dynamic');
      for (const d of e.dynamics) if (!valid(d.at)) fail('dynamic on a missing note');
      for (const h of [...e.hairpins, ...e.slurs]) {
        if (!valid(h.from) || !valid(h.to)) fail('mark on a missing note');
        if (h.from.bar > h.to.bar || (h.from.bar === h.to.bar && h.from.index >= h.to.index)) fail('mark runs backwards');
      }
      if (e.dynamics.length > p.bars.length / 2 + 2) fail(`${e.dynamics.length} dynamics is too many`);
      if (!e.hairpins.some((h) => h.type === 'cresc')) fail('no crescendo');
    });
    expect(found).toEqual([]);
  });

  it('names its key correctly in the title', () => {
    for (const p of pieces) expect(p.title, label(p)).toContain(keyName(p.key));
  });

  describe('refinements after Chopin (Op. 28/4, Op. 9/2, Op. 64/2)', () => {
    /** Each harmony change: when it starts and the chord. */
    const changes = (p: Piece) => p.bars.flatMap((b, i) => b.harmony.map((h) => ({ t: i * p.time.barTicks + h.at, chord: chordFor(homeKey(p.key), bare(h.symbol)) })));

    it('explains every chromatic melody note by the harmony: better chromaticism, not more', () => {
      let explained = 0;
      let total = 0;
      for (const p of pieces) {
        const key = homeKey(p.key);
        const cs = changes(p);
        const rh = line(p, 'rh');
        rh.forEach((n, i) => {
          const pc = pcOf(n.note.pitches[0]);
          if (!isChromatic(key, pc)) return;
          total++;
          const j = cs.reduce((last, c, x) => (c.t <= n.start ? x : last), 0);
          const around = [cs[j - 1], cs[j], cs[j + 1]].filter(Boolean).map((c) => c.chord);
          const next = rh[i + 1]?.note.pitches[0];
          const deg = degreeOfLetter(key, pc.l);
          const ok =
            // a tone of this chord, or of the one before or after (V7/V's ♯4, iv's ♭6)…
            around.some((c) => c.tones.some((t) => samePc(t, pc))) ||
            // …a leading note into the next note…
            (next && pcSemis(pcOf(next)) === (pcSemis(pc) + 1) % 12 && next.letter !== n.note.pitches[0].letter) ||
            // …or a borrowed ♭3 or ♭6 leaning down a semitone.
            (p.mode === 'major' && (deg === 2 || deg === 5) && pc.a < scaleDegreePc(key, deg).a && next && pcSemis(pc) === (pcSemis(pcOf(next)) + 1) % 12);
          if (ok) explained++;
        });
      }
      expect(explained / total).toBeGreaterThan(0.95);
    });

    it('voices applied dominants so the bass rises by semitone into their target (V65), as Chopin does', () => {
      let applied = 0;
      let semitone = 0;
      for (const p of pieces.filter((x) => x.grade >= 3)) {
        const cs = changes(p);
        const lh = line(p, 'lh');
        const bassAt = (t: number) => Math.min(...lh.find((n) => n.start <= t && t < n.end)!.note.pitches.map(midi));
        cs.forEach((c, i) => {
          if (c.chord.kind !== 'applied' || !cs[i + 1]) return;
          applied++;
          if (bassAt(cs[i + 1].t) - bassAt(c.t) === 1) semitone++;
        });
      }
      expect(semitone / applied).toBeGreaterThan(0.6);
    });

    it('moves inner voices chromatically at Grade 4+ (as in the E minor Prelude), one voice at a time', () => {
      let withSlides = 0;
      const upper = pieces.filter((p) => p.grade >= 4);
      for (const p of upper) {
        const lh = line(p, 'lh');
        const slid = lh.some((n) => n.note.pitches.some((x) => !local(p, n).tones.some((t) => samePc(t, pcOf(x)))));
        if (slid) withSlides++;
        // Never two voices sliding at once.
        for (const n of lh) expect(n.note.pitches.filter((x) => !local(p, n).tones.some((t) => samePc(t, pcOf(x)))).length, label(p)).toBeLessThanOrEqual(1);
      }
      expect(withSlides / upper.length).toBeGreaterThan(0.2);
    });

    it('plans tension across the phrase: it builds towards the cadence', () => {
      let building = 0;
      let phrases = 0;
      for (const p of pieces.filter((x) => x.grade >= 3)) {
        const bars = p.bars.map((b) => b.harmony.map((h) => bare(h.symbol)));
        for (const ph of p.phrases) {
          phrases++;
          if (tensionBuilds(homeKey(p.key), bars.slice(ph.startBar, ph.startBar + ph.bars))) building++;
        }
      }
      expect(building / phrases).toBeGreaterThan(0.75);
    });

    it('gives the motif a rhythmic identity: its rhythm recurs through the piece, and opens the middle section', () => {
      const long = pieces.filter((p) => p.bars.length >= 8);
      const rhythm = (ns: Note[]) => ns.map((n) => n.ticks).join('-');
      const recurrences = long.map((p) => p.bars.slice(1).filter((b) => rhythm(b.rh) === rhythm(p.bars[0].rh)).length);
      expect(recurrences.reduce((a, b) => a + b, 0) / long.length).toBeGreaterThan(1.5);
      const ternary = pieces.filter((p) => p.phrases.length === 3);
      const opens = ternary.filter((p) => rhythm(p.bars[4].rh) === rhythm(p.bars[0].rh));
      expect(opens.length / ternary.length).toBeGreaterThan(0.5);
    });

    it('opens a nocturne with an expressive rising leap (Op. 9 No. 2) and a waltz, often, with a sigh (Op. 64 No. 2)', () => {
      const nocturnes = pieces.filter((p) => p.title.startsWith('Nocturne') && p.grade >= 2);
      const leaping = nocturnes.filter((p) => {
        const ds = [...p.bars[0].rh, ...p.bars[1].rh].map((n) => diatonicIndex(n.pitches[0]));
        return ds.some((d, i) => i > 0 && d - ds[i - 1] >= 3);
      });
      expect(leaping.length / nocturnes.length).toBeGreaterThan(0.5);
      const waltzes = pieces.filter((p) => p.title.startsWith('Valse') && p.grade >= 2);
      const sighing = waltzes.filter((p) => {
        const first = p.bars[0].rh[0].pitches[0];
        return !chordAt(p, 0, 0).tones.some((t) => samePc(t, pcOf(first)));
      });
      expect(sighing.length / waltzes.length).toBeGreaterThan(0.25);
    });
  });
});
