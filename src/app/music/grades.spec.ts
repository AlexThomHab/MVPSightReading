import { beyondGrade, clampToGrade, resolveConstraints, validateSettings } from './constraints';
import { FORM_IDS, formAvailable, timesFor } from './forms';
import { generatePiece } from './generator';
import { GRADES, GRADE_SPECS, Grade, GradeFeatures, TIME_SIGNATURES, gradeIntroducing, lengthsFor } from './grades';
import { Note, Piece, Settings } from './model';
import { totalTicks } from './durations';
import { validatePiece } from './validate';

/**
 * The grades follow the ABRSM Piano sight-reading parameters (2025 & 2026 syllabus, page 16):
 * these tests pin the table, its cumulative reading, and that the generated music both stays
 * within each grade and can use what each grade introduces.
 */
const notes = (p: Piece): Note[] => p.bars.flatMap((b) => (b.voices ? [...b.voices.s, ...b.voices.a, ...b.voices.t, ...b.voices.b] : [...b.rh, ...b.lh]));
const pianoNotes = (p: Piece, hand: 'rh' | 'lh') => p.bars.flatMap((b) => b[hand]);

/** A few pieces of every form a grade writes, in every metre it offers. */
function sample(grade: Grade, seeds = 2): { settings: Settings; piece: Piece }[] {
  const out: { settings: Settings; piece: Piece }[] = [];
  for (const form of FORM_IDS.filter((f) => formAvailable(f, grade))) {
    for (const timeId of timesFor(grade, form)) {
      for (let s = 0; s < seeds; s++) {
        const settings: Settings = { seed: `gr-${s}`, grade, form, timeId };
        out.push({ settings, piece: generatePiece(settings) });
      }
    }
  }
  return out;
}
const byGrade = new Map(GRADES.map((g) => [g, sample(g)]));
const piecesAt = (g: Grade) => byGrade.get(g)!.map((c) => c.piece);

describe('ABRSM grade configuration', () => {
  it('has eight grades', () => {
    expect(GRADES).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('follows the syllabus: keys, time signatures and lengths grade by grade', () => {
    const keys = (g: Grade) => [...GRADE_SPECS[g].keys].sort();
    expect(keys(1)).toEqual(['Am', 'C', 'Dm', 'F', 'G']);
    expect(keys(2)).toEqual([...keys(1), 'D', 'Em', 'Gm'].sort());
    expect(keys(3)).toEqual([...keys(2), 'A', 'Bb', 'Eb', 'Bm'].sort());
    expect(keys(4)).toEqual(keys(3));
    expect(keys(5)).toEqual([...keys(4), 'E', 'Ab', 'F#m', 'Cm'].sort());
    expect(keys(6)).toEqual([...keys(5), 'C#m', 'Fm'].sort());
    expect(keys(7)).toEqual(keys(6));
    expect(keys(8)).toEqual([...keys(7), 'B', 'Db'].sort());
    const times = (g: Grade) => [...GRADE_SPECS[g].times].sort();
    expect(times(1)).toEqual(['2/4', '3/4', '4/4']);
    expect(times(3)).toEqual(['2/4', '3/4', '3/8', '4/4']);
    expect(times(4)).toEqual([...times(3), '6/8'].sort());
    expect(times(6)).toEqual([...times(5), '9/8', '5/8', '5/4'].sort());
    expect(times(7)).toEqual([...times(6), '7/8', '7/4'].sort());
    expect(times(8)).toEqual([...times(7), '12/8'].sort());
    // Lengths: c. 4–6 bars at Grade 1, up to 8 at 3, 8–12 at 5, 12–16 at 6, 16–20 at 7, a page at 8.
    expect(Math.max(...GRADE_SPECS[1].bars)).toBeLessThanOrEqual(6);
    expect(Math.max(...GRADE_SPECS[3].bars)).toBe(8);
    expect(GRADE_SPECS[5].bars).toEqual([8, 12]);
    expect(GRADE_SPECS[6].bars).toEqual([12, 16]);
    expect(GRADE_SPECS[7].bars).toEqual([16, 20]);
    expect(Math.min(...GRADE_SPECS[8].bars)).toBeGreaterThanOrEqual(20);
  });

  it('introduces each element at the grade the syllabus gives', () => {
    const at: Partial<Record<keyof GradeFeatures, Grade>> = {
      handsTogether: 2,
      ties: 2,
      anacrusis: 4,
      fermata: 4,
      fourPart: 5,
      syncopation: 5,
      ritardando: 5,
      triplets: 6,
      clefChanges: 6,
      sustainPedal: 6,
      tempoChanges: 7,
      ottava: 7,
      unaCorda: 7,
      spreadChords: 8,
      ornaments: 8,
      accelerando: 8,
    };
    for (const [feature, grade] of Object.entries(at)) expect(gradeIntroducing(feature as keyof GradeFeatures), feature).toBe(grade);
    expect(GRADES.map((g) => GRADE_SPECS[g].features.chordNotes)).toEqual([1, 1, 2, 2, 2, 2, 2, 3]);
    expect(GRADES.map((g) => GRADE_SPECS[g].features.fiveFinger)).toEqual([true, true, false, false, false, false, false, false]);
    expect(GRADES.find((g) => GRADE_SPECS[g].chromatic)).toBe(4);
    expect(GRADES.find((g) => GRADE_SPECS[g].durations.includes(16))).toBe(2); // semibreves
    expect(GRADES.find((g) => GRADE_SPECS[g].durations.includes(1))).toBe(3); // semiquavers
    expect(GRADES.find((g) => GRADE_SPECS[g].rests.includes(2))).toBe(3); // quaver rests
    expect(GRADES.find((g) => GRADE_SPECS[g].articulations.includes('tenuto'))).toBe(4);
    expect(GRADES.find((g) => GRADE_SPECS[g].dynamics.includes('pp'))).toBe(2);
    expect(GRADES.find((g) => GRADE_SPECS[g].dynamics.includes('ff'))).toBe(5);
  });

  it('is cumulative: a grade keeps everything the grades before it allow', () => {
    for (const g of GRADES.slice(1)) {
      const [prev, spec] = [GRADE_SPECS[(g - 1) as Grade], GRADE_SPECS[g]];
      for (const k of prev.keys) expect(spec.keys, `G${g} key ${k}`).toContain(k);
      for (const t of prev.times) expect(spec.times, `G${g} time ${t}`).toContain(t);
      for (const d of prev.durations) expect(spec.durations, `G${g} duration ${d}`).toContain(d);
      for (const r of prev.rests) expect(spec.rests, `G${g} rest ${r}`).toContain(r);
      for (const d of prev.dynamics) expect(spec.dynamics).toContain(d);
      for (const a of prev.articulations) expect(spec.articulations).toContain(a);
      // (Every element stays once introduced; the five-finger position is a restriction, lifted at Grade 3.)
      for (const [f, on] of Object.entries(prev.features)) if (on === true && f !== 'fiveFinger') expect(spec.features[f as keyof GradeFeatures], `G${g} ${f}`).toBe(true);
      expect(spec.features.chordNotes).toBeGreaterThanOrEqual(prev.features.chordNotes);
      expect(Math.min(...spec.bars)).toBeGreaterThanOrEqual(Math.min(...prev.bars));
      expect(spec.maxLeap).toBeGreaterThanOrEqual(prev.maxLeap);
      // Difficulty rises on every axis, not only one.
      for (const axis of ['rhythmic', 'melodic', 'harmonic', 'handIndependence'] as const) expect(spec.complexity[axis]).toBeGreaterThan(prev.complexity[axis]);
    }
  });

  it('defines every metre with its beat groups, the irregular ones as the syllabus writes them', () => {
    for (const t of Object.values(TIME_SIGNATURES)) expect(t.groups.reduce((a, b) => a + b, 0), t.id).toBe(t.barTicks);
    expect(TIME_SIGNATURES['5/8'].groups).toEqual([6, 4]);
    expect(TIME_SIGNATURES['7/8'].groups).toEqual([4, 4, 6]);
    expect(TIME_SIGNATURES['12/8'].beatsPerBar).toBe(4);
    expect(lengthsFor(GRADE_SPECS[1], 4)).toEqual([4]);
    expect(lengthsFor(GRADE_SPECS[7], 4)).toEqual([16, 20]);
  });
});

describe('generated music within its grade', { timeout: 120_000 }, () => {
  it('passes validation at every grade, in every form and metre the grade offers', () => {
    const found = GRADES.flatMap((g) => byGrade.get(g)!.flatMap(({ settings, piece }) => validatePiece(piece, settings).map((m) => `G${g} ${settings.form} ${settings.timeId}: ${m}`)));
    expect(found.slice(0, 10)).toEqual([]);
  });

  it('Grade 1: only its keys and metres, single notes, each hand on its own, no semibreves', () => {
    for (const p of piecesAt(1)) {
      expect(GRADE_SPECS[1].keys).toContain(p.key.id);
      expect(['2/4', '3/4', '4/4']).toContain(p.time.id);
      for (const n of notes(p)) {
        expect(n.pitches.length).toBeLessThanOrEqual(1);
        expect(n.ticks).not.toBe(16);
        expect(n.tie).toBeUndefined();
        expect(n.triplet).toBeUndefined();
      }
      for (const bar of p.bars) expect(bar.rh.every((n) => n.rest) || bar.lh.every((n) => n.rest)).toBe(true);
    }
  });

  it('Grade 3: can write simple semiquaver figures, two-note chords and wider hand positions', () => {
    const ps = piecesAt(3);
    expect(ps.some((p) => notes(p).some((n) => n.ticks === 1))).toBe(true);
    expect(ps.some((p) => pianoNotes(p, 'rh').some((n) => n.pitches.length === 2))).toBe(true);
    expect(ps.some((p) => pianoNotes(p, 'lh').some((n) => n.pitches.length === 2))).toBe(true);
    const span = (p: Piece) => {
      const ds = pianoNotes(p, 'rh').filter((n) => !n.rest).flatMap((n) => n.pitches.map((x) => x.octave * 7 + 'CDEFGAB'.indexOf(x.letter)));
      return Math.max(...ds) - Math.min(...ds);
    };
    expect(ps.some((p) => span(p) > 4)).toBe(true);
    for (const p of ps) for (const n of notes(p)) expect(n.pitches.length).toBeLessThanOrEqual(2);
  });

  it('Grade 5: can write syncopation, four-part chords (never more than two notes in a hand) and rit.', () => {
    const ps = [...piecesAt(5), ...Array.from({ length: 12 }, (_, s) => generatePiece({ seed: `sync-${s}`, grade: 5, form: 'trio', timeId: '4/4' }))];
    const syncopated = (p: Piece) =>
      p.bars.some((b) => {
        let t = 0;
        return b.rh.some((n) => {
          const off = t % 4 === 2 && n.ticks >= 4 && !n.rest;
          t += n.ticks;
          return off;
        });
      });
    expect(ps.some(syncopated)).toBe(true);
    expect(ps.some((p) => p.bars.at(-1)!.rh.some((n) => n.pitches.length === 2) && p.bars.at(-1)!.lh.some((n) => n.pitches.length === 2))).toBe(true);
    expect(ps.some((p) => p.expression?.tempos?.some((t) => t.text === 'rit.'))).toBe(true);
    for (const p of ps) for (const n of notes(p)) expect(n.pitches.length).toBeLessThanOrEqual(2);
  });

  it('Grade 6: can write triplets, irregular metres, clef changes and the right pedal', () => {
    const ps = piecesAt(6);
    expect(ps.some((p) => notes(p).some((n) => n.triplet))).toBe(true);
    expect(ps.some((p) => ['5/8', '5/4'].includes(p.time.id))).toBe(true);
    expect(ps.some((p) => p.bars.some((b) => b.lhClef === 'treble'))).toBe(true);
    expect(ps.some((p) => p.expression?.pedals?.length)).toBe(true);
    // A triplet is three in the time of two: its group fills a crotchet beat exactly.
    for (const p of ps) for (const b of p.bars) for (const hand of [b.rh, b.lh]) expect(totalTicks(hand)).toBeCloseTo(totalTicks(hand), 9);
    for (const p of ps) expect(p.expression?.ottavas ?? []).toEqual([]);
  });

  it('Grade 7: can write tempo changes, 8va and una corda, in 7/8 and 7/4 too', () => {
    const ps = piecesAt(7);
    expect(ps.some((p) => p.expression?.tempos?.some((t) => t.kind === 'set' && t.text !== 'a tempo'))).toBe(true);
    expect(ps.some((p) => p.expression?.ottavas?.length)).toBe(true);
    expect(ps.some((p) => p.expression?.unaCorda?.length)).toBe(true);
    expect(ps.some((p) => p.time.id === '7/8')).toBe(true);
  });

  it('Grade 8: can write three-note chords in either hand, spread chords, ornaments and accel., about a page long', () => {
    const ps = piecesAt(8);
    expect(ps.some((p) => pianoNotes(p, 'rh').some((n) => n.pitches.length === 3))).toBe(true);
    expect(ps.some((p) => pianoNotes(p, 'lh').some((n) => n.pitches.length === 3))).toBe(true);
    expect(ps.some((p) => notes(p).some((n) => n.spread))).toBe(true);
    expect(ps.some((p) => notes(p).some((n) => n.ornament || n.grace))).toBe(true);
    expect(ps.some((p) => p.expression?.tempos?.some((t) => t.kind === 'accel'))).toBe(true);
    expect(Math.min(...ps.map((p) => p.bars.length))).toBeGreaterThanOrEqual(20);
  });

  it('never uses an element before its grade', () => {
    for (const g of GRADES) {
      const f = GRADE_SPECS[g].features;
      for (const p of piecesAt(g)) {
        const ns = notes(p);
        if (!f.triplets) expect(ns.some((n) => n.triplet)).toBe(false);
        if (!f.spreadChords) expect(ns.some((n) => n.spread)).toBe(false);
        if (!f.ornaments) expect(ns.some((n) => n.ornament || n.grace)).toBe(false);
        if (!f.fermata) expect(ns.some((n) => n.fermata)).toBe(false);
        if (!f.ties) expect(ns.some((n) => n.tie)).toBe(false);
        if (!f.clefChanges) expect(p.bars.some((b) => b.lhClef)).toBe(false);
        if (!f.sustainPedal) expect(p.expression?.pedals?.length ?? 0).toBe(0);
        if (!f.ottava) expect(p.expression?.ottavas?.length ?? 0).toBe(0);
        if (!f.anacrusis) expect(p.upbeat).toBeUndefined();
      }
    }
  });

  it('grows harder on every axis, not just by tempo: longer, denser, wider, more varied', () => {
    const mean = (g: Grade, f: (p: Piece) => number) => piecesAt(g).reduce((a, p) => a + f(p), 0) / piecesAt(g).length;
    const length = (p: Piece) => p.bars.length;
    const values = (p: Piece) => new Set(notes(p).map((n) => n.ticks)).size;
    expect(mean(8, length)).toBeGreaterThan(mean(5, length));
    expect(mean(5, length)).toBeGreaterThan(mean(1, length));
    expect(mean(6, values)).toBeGreaterThan(mean(2, values));
    // Tempo is not the measure: Grade 8 is not simply faster than Grade 3.
    expect(mean(8, (p) => p.tempo.bpm)).toBeLessThan(mean(3, (p) => p.tempo.bpm) * 1.35);
  });
});

describe('Customise and the grade', () => {
  it('holds a customisation to the grade unless Beyond the grade is on', () => {
    const custom = { noteValues: ['semiquaver', 'crotchet', 'minim'] as const, timeSignatures: ['5/8', '3/4'] as const, syncopation: true };
    const held = resolveConstraints(2, { ...custom, noteValues: [...custom.noteValues], timeSignatures: [...custom.timeSignatures] });
    expect(held.noteTicks).toEqual([4, 8]);
    expect(held.times).toEqual(['3/4']);
    expect(held.syncopation).toBe(false);
    const freed = resolveConstraints(2, { noteValues: [...custom.noteValues], timeSignatures: [...custom.timeSignatures], syncopation: true, advanced: true });
    expect(freed.noteTicks).toContain(1);
    expect(freed.times).toContain('5/8');
    expect(clampToGrade(2, { advanced: true, syncopation: true })).toEqual({ advanced: true, syncopation: true });
    // The panel says what is held back.
    const issues = validateSettings({ seed: 'v', grade: 2, form: 'trio', custom: { noteValues: ['semiquaver', 'crotchet'] } }, resolveConstraints(2, { noteValues: ['semiquaver', 'crotchet'] }));
    expect(issues.some((i) => /semiquavers is beyond Grade 2/.test(i.message))).toBe(true);
  });

  it('marks a piece beyond its grade as Custom difficulty, never as the grade', () => {
    expect(beyondGrade(2, { noteValues: ['semiquaver'], syncopation: true, timeSignatures: ['7/8'] })).toEqual(['semiquavers', '7/8', 'syncopation']);
    expect(beyondGrade(5, { noteValues: ['semiquaver'] })).toEqual([]);
    const custom = generatePiece({ seed: 'c', grade: 2, form: 'trio', custom: { noteValues: ['semiquaver', 'quaver', 'crotchet', 'minim', 'dottedMinim'], advanced: true } });
    expect(custom.difficulty).toBe('custom');
    expect(custom.beyondGrade).toEqual(['semiquavers']);
    const held = generatePiece({ seed: 'c', grade: 2, form: 'trio', custom: { noteValues: ['semiquaver', 'quaver', 'crotchet', 'minim', 'dottedMinim'] } });
    expect(held.difficulty).toBe('grade');
    expect(notes(held).some((n) => n.ticks === 1)).toBe(false);
    expect(generatePiece({ seed: 'c', grade: 2, form: 'trio' }).difficulty).toBe('grade');
  });
});
