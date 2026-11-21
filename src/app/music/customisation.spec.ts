import {
  Customisation,
  GenerationError,
  decodeCustomisation,
  defaultRange,
  encodeCustomisation,
  intervalSize,
  resolveConstraints,
  sanitiseCustomisation,
  validateSettings,
} from './constraints';
import { generatePiece } from './generator';
import { GRADE_SPECS, Grade } from './grades';
import type { Note, Piece, Settings } from './model';
import { FormId, formAvailable } from './forms';
import { keySignatureAlter, midi, pitchName } from './theory';
import { onsets } from './durations';

/** Every form written for two hands (chorales are four voices). */
const PIANO: FormId[] = ['minuet', 'trio', 'waltz', 'polonaise', 'gavotte', 'nocturne', 'prelude', 'invention', 'fugue'];

/** Generates `count` pieces; returns those that succeeded and the errors of those that did not. */
function sample(base: Omit<Settings, 'seed'>, count = 12): { pieces: Piece[]; errors: string[] } {
  const pieces: Piece[] = [];
  const errors: string[] = [];
  for (let s = 0; s < count; s++) {
    try {
      pieces.push(generatePiece({ ...base, seed: `cust-${s}` }));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { pieces, errors };
}

const notesOf = (p: Piece, hand: 'rh' | 'lh'): Note[] => p.bars.flatMap((b) => (b.voices ? (hand === 'rh' ? b.voices.s : b.voices.b) : b[hand]));
/** A chord's top note: the melody (finishing may add a note below it). */
const top = (n: Note) => n.pitches[n.pitches.length - 1];
const melody = (p: Piece) => notesOf(p, 'rh').filter((n) => !n.rest);

describe('customisation: settings and validation', () => {
  it('keeps the grade default for anything not customised, and the user’s choice for anything that is', () => {
    const c = resolveConstraints(2, { noteValues: ['crotchet', 'minim'], maxLeap: 2 });
    expect([...c.noteTicks].sort()).toEqual([4, 8]);
    expect(c.maxLeap).toBe(2);
    expect(c.times).toEqual(GRADE_SPECS[2].times);
    // (Rests: the grade's own — minim, crotchet and, from Grade 2, dotted minim and semibreve rests.)
    expect(c.restTicks).toEqual(GRADE_SPECS[2].rests);
    // Changing the grade keeps the user's choices.
    expect([...resolveConstraints(5, { noteValues: ['crotchet', 'minim'] }).noteTicks].sort()).toEqual([4, 8]);
  });

  it('reports impossible combinations before generating, instead of ignoring a setting', () => {
    const errors = (grade: Grade, form: FormId, custom: Customisation, timeId?: Settings['timeId']) =>
      validateSettings({ seed: 'v', grade, form, custom, timeId }, resolveConstraints(grade, custom))
        .filter((i) => i.severity === 'error')
        .map((i) => i.message);
    expect(errors(1, 'trio', { noteValues: [] })[0]).toMatch(/at least one note value/);
    expect(errors(3, 'trio', { noteValues: ['minim'] }, '3/4')[0]).toMatch(/can't be made of minim/);
    expect(errors(4, 'chorale', { noteValues: ['minim', 'quaver'] })[0]).toMatch(/Chorales move in crotchets/);
    expect(errors(1, 'trio', { melodyRange: { low: 'C4', high: 'E4' } })[0]).toMatch(/at least a fifth/);
    expect(errors(1, 'trio', { melodyRange: { low: 'G4', high: 'B4' } })[0]).toMatch(/at least a fifth/);
    expect(errors(3, 'trio', { melodyRange: { low: 'D4', high: 'B4' } }).join(' ')).not.toMatch(/tonic/);
    expect(errors(3, 'trio', { melodyRange: { low: 'D4', high: 'B4' }, separateHands: false }, undefined)).toEqual([]);
    expect(errors(1, 'trio', { leapMode: 'custom', ascending: [], descending: [] })[0]).toMatch(/needs to move/);
    expect(errors(1, 'trio', { leapMode: 'custom', ascending: [1, 2], descending: [] })[0]).toMatch(/must rise and fall/);
    // A specific key whose tonic lies outside the range.
    const keyed = validateSettings(
      { seed: 'v', grade: 1, form: 'trio', keyId: 'G', custom: { melodyRange: { low: 'C4', high: 'F4' } } },
      resolveConstraints(1, { melodyRange: { low: 'C4', high: 'F4' } }),
    );
    expect(keyed.some((i) => i.severity === 'error' && /tonic/.test(i.message))).toBe(true);
  });

  it('throws a GenerationError carrying the reasons when settings cannot be met', () => {
    expect(() => generatePiece({ seed: 'x', grade: 1, form: 'trio', custom: { noteValues: [] } })).toThrow(GenerationError);
  });

  it('is deterministic: the same seed and customisation give the same piece', () => {
    const settings: Settings = { seed: 'same', grade: 3, form: 'waltz', custom: { noteValues: ['crotchet', 'quaver', 'minim', 'dottedMinim'], maxLeap: 3, restValues: ['crotchet'] } };
    expect(generatePiece(settings)).toEqual(generatePiece(settings));
  });
});

// (These generate many pieces each: allow for a busy machine running the whole suite.)
describe('customisation: every setting shapes the music', { timeout: 60_000 }, () => {
  it('uses only the note values and rests allowed, in every piano form', () => {
    const custom: Customisation = { noteValues: ['crotchet', 'minim', 'dottedMinim', 'semibreve'], restValues: ['crotchet'] };
    let rests = 0;
    for (const form of PIANO) {
      for (const grade of ([1, 3, 5] as Grade[]).filter((g) => formAvailable(form, g))) {
        const { pieces, errors } = sample({ grade, form, custom }, 6);
        expect(errors, `${form} G${grade}`).toEqual([]);
        for (const p of pieces) {
          for (const n of [...notesOf(p, 'rh'), ...notesOf(p, 'lh')]) {
            expect(n.rest ? [4] : [4, 8, 12, 16], `${form} G${grade} ${n.ticks}`).toContain(n.ticks);
            if (n.rest) rests++;
          }
          p.bars.forEach((bar, b) => {
            // (A Gavotte's upbeat bar, and the last bar that completes it, are part-bars.)
            const length = !p.upbeat ? p.time.barTicks : b === 0 ? p.upbeat : b === p.bars.length - 1 ? p.time.barTicks - p.upbeat : p.time.barTicks;
            expect(bar.rh.reduce((a, n) => a + n.ticks, 0)).toBe(length);
            expect(bar.lh.reduce((a, n) => a + n.ticks, 0)).toBe(length);
          });
        }
      }
    }
    expect(rests).toBeGreaterThan(0);
  });

  it('never writes a rest when rests are not allowed', () => {
    for (const form of PIANO) {
      for (const p of sample({ grade: 3, form, custom: { restValues: [] } }, 4).pieces) {
        expect([...notesOf(p, 'rh'), ...notesOf(p, 'lh')].some((n) => n.rest)).toBe(false);
      }
    }
  });

  it('keeps each hand inside its range', () => {
    const custom: Customisation = { separateHands: true, melodyRange: { low: 'C4', high: 'G5' }, bassRange: { low: 'C2', high: 'G3' } };
    for (const form of [...PIANO, 'chorale'] as FormId[]) {
      const { pieces, errors } = sample({ grade: 4, form, custom }, 6);
      expect(pieces.length, `${form}: ${errors[0]}`).toBeGreaterThan(3);
      for (const p of pieces) {
        for (const bar of p.bars) {
          const rh = bar.voices ? [...bar.voices.s, ...bar.voices.a] : bar.rh;
          const lh = bar.voices ? [...bar.voices.t, ...bar.voices.b] : bar.lh;
          for (const n of rh) for (const x of [...n.pitches, ...(n.grace ?? [])]) expect(midi(x), `${form} ${pitchName(x)}`).toBeGreaterThanOrEqual(60);
          for (const n of rh) for (const x of n.pitches) expect(midi(x)).toBeLessThanOrEqual(79);
          for (const n of lh) for (const x of n.pitches) expect(midi(x), `${form} LH ${pitchName(x)}`).toBeLessThanOrEqual(55);
          for (const n of lh) for (const x of n.pitches) expect(midi(x)).toBeGreaterThanOrEqual(36);
        }
      }
    }
  });

  it('limits melodic leaps to the maximum chosen', () => {
    for (const form of [...PIANO, 'chorale'] as FormId[]) {
      const { pieces, errors } = sample({ grade: 5, form, custom: { maxLeap: 2 } }, 6);
      expect(pieces.length, `${form}: ${errors[0]}`).toBeGreaterThan(3);
      for (const p of pieces) {
        const m = melody(p);
        for (let i = 1; i < m.length; i++) expect(intervalSize(top(m[i - 1]), top(m[i])), form).toBeLessThanOrEqual(2);
      }
    }
  });

  it('uses only the intervals chosen, while still shaping a melody', () => {
    const custom: Customisation = { leapMode: 'custom', ascending: [1, 2, 4], descending: [1, 2, 4] };
    for (const form of ['trio', 'waltz', 'prelude'] as FormId[]) {
      const { pieces, errors } = sample({ grade: 3, form, custom }, 8);
      expect(pieces.length, `${form}: ${errors[0]}`).toBeGreaterThan(4);
      for (const p of pieces) {
        const m = melody(p);
        for (let i = 1; i < m.length; i++) {
          if (m[i - 1].tie) continue;
          expect([1, 2, 4], `${form} ${pitchName(top(m[i - 1]))}–${pitchName(top(m[i]))}`).toContain(intervalSize(top(m[i - 1]), top(m[i])));
        }
      }
    }
  });

  it('writes no accidentals when they are switched off — even for Chopin and chorales', () => {
    for (const form of [...PIANO, 'chorale'] as FormId[]) {
      const { pieces, errors } = sample({ grade: 5, form, custom: { accidentals: false } }, 5);
      expect(pieces.length, `${form}: ${errors[0]}`).toBeGreaterThan(2);
      for (const p of pieces) {
        for (const bar of p.bars) {
          const all = bar.voices ? [...bar.voices.s, ...bar.voices.a, ...bar.voices.t, ...bar.voices.b] : [...bar.rh, ...bar.lh];
          for (const n of all) for (const x of [...n.pitches, ...(n.grace ?? [])]) expect(x.alter, `${form} ${pitchName(x)}`).toBe(keySignatureAlter(p.key, x.letter));
        }
      }
    }
  });

  it('removes dynamics, articulation, slurs and ornaments that are switched off', () => {
    const custom: Customisation = { dynamics: false, staccato: false, accents: false, tenuto: false, slurs: false, ornaments: false };
    for (const form of PIANO) {
      for (const p of sample({ grade: 5, form, custom }, 4).pieces) {
        expect(p.dynamic).toBe('');
        expect(p.expression?.dynamics ?? []).toEqual([]);
        expect(p.expression?.hairpins ?? []).toEqual([]);
        expect(p.expression?.slurs ?? []).toEqual([]);
        for (const n of [...notesOf(p, 'rh'), ...notesOf(p, 'lh')]) {
          expect(n.articulation).toBeUndefined();
          expect(n.grace).toBeUndefined();
          expect(n.ornament).toBeUndefined();
        }
      }
    }
  });

  it('keeps the hands together (shared attack points), or makes them independent, as asked', () => {
    for (const form of ['trio', 'minuet', 'prelude'] as FormId[]) {
      for (const p of sample({ grade: 3, form, custom: { independence: 'together' } }, 5).pieces) {
        for (const bar of p.bars) {
          const rh = new Set(onsets(bar.rh));
          onsets(bar.lh).forEach((t, i) => bar.lh[i].rest || expect(rh.has(t), `${form} bar onset ${t}`).toBe(true));
        }
      }
    }
    // Fully independent: even at Grade 2 the left hand moves on its own — beyond the grade,
    // so only with Beyond the grade switched on (otherwise held to the grade).
    const busy = (custom: Customisation) =>
      sample({ grade: 2, form: 'trio', custom }, 8).pieces.reduce((a, p) => a + notesOf(p, 'lh').length / p.bars.length, 0);
    expect(busy({ independence: 'full', advanced: true })).toBeGreaterThan(busy({}) * 1.5);
    expect(busy({ independence: 'full' })).toBeLessThan(busy({ independence: 'full', advanced: true }));
  });

  it('makes rhythm busier as rhythmic difficulty rises, within the same note values', () => {
    const notesPerBar = (difficulty: Customisation['rhythmicDifficulty']) =>
      sample({ grade: 3, form: 'trio', custom: { rhythmicDifficulty: difficulty, noteValues: ['minim', 'crotchet', 'quaver', 'dottedCrotchet', 'semibreve'] } }, 10).pieces.reduce(
        (a, p) => a + melody(p).length / p.bars.length,
        0,
      );
    expect(notesPerBar('easy')).toBeLessThan(notesPerBar('medium'));
    expect(notesPerBar('medium')).toBeLessThan(notesPerBar('difficult'));
  });

  it('writes syncopations only when they are allowed', () => {
    const syncopated = (p: Piece) => p.bars.some((b) => onsets(b.rh).some((t, i) => t % 4 === 2 && b.rh[i].ticks >= 4 && !b.rh[i].rest));
    // (Syncopation is a Grade 5 element: at Grade 3 it needs Beyond the grade.)
    const custom: Customisation = { noteValues: ['crotchet', 'quaver', 'minim'], syncopation: true, rhythmicDifficulty: 'difficult', advanced: true };
    expect(sample({ grade: 3, form: 'trio', custom }, 10).pieces.some(syncopated)).toBe(true);
    expect(sample({ grade: 3, form: 'trio', custom: { ...custom, advanced: undefined } }, 10).pieces.some(syncopated)).toBe(false);
    expect(sample({ grade: 3, form: 'trio', custom: { ...custom, syncopation: false } }, 10).pieces.some(syncopated)).toBe(false);
  });

  it('ties notes only when ties are allowed', () => {
    const tied = (ps: Piece[]) => ps.some((p) => [...notesOf(p, 'rh'), ...notesOf(p, 'lh')].some((n) => n.tie));
    expect(tied(sample({ grade: 5, form: 'prelude', custom: { ties: false } }, 8).pieces)).toBe(false);
    expect(tied(sample({ grade: 4, form: 'trio', custom: { ties: true, rhythmicDifficulty: 'difficult' } }, 10).pieces)).toBe(true);
  });

  it('respects the chosen time signatures', () => {
    for (const p of sample({ grade: 5, form: 'prelude', custom: { timeSignatures: ['6/8', '9/8'] } }, 8).pieces) expect(['6/8', '9/8']).toContain(p.time.id);
    for (const p of sample({ grade: 3, form: 'trio', custom: { timeSignatures: ['3/4'] } }, 4).pieces) expect(p.time.id).toBe('3/4');
  });
});

describe('customisation: the practice sessions on the card', { timeout: 60_000 }, () => {
  it('Example 1 — beginner: Grade 1 Classical in 4/4, crotchets and minims, crotchet rests, leaps of a 3rd, C4–G4, hands together, no dynamics', () => {
    const custom: Customisation = {
      noteValues: ['crotchet', 'minim'],
      restValues: ['crotchet'],
      maxLeap: 2,
      melodyRange: { low: 'C4', high: 'G4' },
      independence: 'together',
      dynamics: false,
    };
    const { pieces, errors } = sample({ grade: 1, form: 'trio', timeId: '4/4', custom }, 10);
    expect(errors).toEqual([]);
    for (const p of pieces) {
      expect(p.time.id).toBe('4/4');
      expect(p.dynamic).toBe('');
      const m = melody(p);
      for (const n of m) expect(midi(n.pitches[0])).toBeGreaterThanOrEqual(60);
      for (const n of m) expect(midi(n.pitches[0])).toBeLessThanOrEqual(67);
      for (let i = 1; i < m.length; i++) expect(intervalSize(m[i - 1].pitches[0], m[i].pitches[0])).toBeLessThanOrEqual(2);
    }
  });

  it('Example 2 — intermediate Romantic: Grade 3 Chopin in 3/4, leaps to a 6th, hands fully independent, dynamics and accidentals on', () => {
    const custom: Customisation = { noteValues: ['minim', 'crotchet', 'quaver', 'dottedCrotchet', 'dottedMinim'], maxLeap: 5, independence: 'full', dynamics: true, accidentals: true };
    const { pieces, errors } = sample({ grade: 3, form: 'prelude', timeId: '3/4', custom }, 10);
    expect(errors).toEqual([]);
    for (const p of pieces) {
      expect(p.title).toMatch(/^(Nocturne|Valse|Mazurka|Prelude)/);
      expect(p.expression!.dynamics.length).toBeGreaterThan(0);
    }
  });

  it('Example 3 — advanced rhythm: Grade 5, crotchets, quavers and semiquavers, difficult, syncopation and ties, leaps to a 4th', () => {
    const custom: Customisation = { noteValues: ['crotchet', 'quaver', 'semiquaver', 'minim'], rhythmicDifficulty: 'difficult', syncopation: true, ties: true, maxLeap: 3 };
    for (const form of ['trio', 'prelude'] as FormId[]) {
      const { pieces, errors } = sample({ grade: 5, form, custom }, 8);
      expect(pieces.length, `${form}: ${errors[0]}`).toBeGreaterThan(5);
      for (const p of pieces) {
        const m = melody(p);
        for (let i = 1; i < m.length; i++) expect(intervalSize(top(m[i - 1]), top(m[i]))).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('customisation: sharing and defaults', { timeout: 60_000 }, () => {
  it('round-trips a customisation through a link, and leaves an untouched one out of it', () => {
    const custom: Customisation = { noteValues: ['crotchet', 'quaver'], melodyRange: { low: 'C4', high: 'G5' }, independence: 'full', accidentals: false, ascending: [0, 1, 2] };
    const text = encodeCustomisation(custom);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCustomisation(text)).toEqual(custom);
    expect(encodeCustomisation({})).toBe('');
    expect(encodeCustomisation(undefined)).toBe('');
  });

  it('drops anything malformed or unknown from a link', () => {
    expect(decodeCustomisation('not base64 json!')).toEqual({});
    expect(decodeCustomisation(null)).toEqual({});
    expect(
      sanitiseCustomisation({
        noteValues: ['crotchet', 'breve', 4, 'crotchet'],
        timeSignatures: ['3/4', 'toString', '11/8'],
        melodyRange: { low: 'C4', high: 'H9' },
        maxLeap: 99,
        independence: 'sometimes',
        dynamics: 'yes',
        ties: false,
        evil: '<script>',
      }),
    ).toEqual({ noteValues: ['crotchet'], timeSignatures: ['3/4'], ties: false });
    expect(sanitiseCustomisation([1, 2])).toEqual({});
  });

  it("shows a grade's default range as absolute notes (in C major)", () => {
    expect(defaultRange(1, 'melody')).toEqual({ low: 'C4', high: 'G4' });
    expect(defaultRange(3, 'melody')).toEqual({ low: 'A3', high: 'C5' });
    // (Grades 1–2: a five-finger position, tonic to dominant.)
    expect(defaultRange(2, 'bass')).toEqual({ low: 'C3', high: 'G3' });
  });

  it('writes in major keys only when accidentals are off (a minor key needs its raised leading note)', () => {
    for (const form of ['trio', 'prelude', 'chorale'] as FormId[]) {
      const { pieces } = sample({ grade: 5, form, custom: { accidentals: false } }, 6);
      for (const p of pieces) expect(p.key.mode, `${form} ${p.key.id}`).toBe('major');
    }
    const issues = validateSettings({ seed: 'v', grade: 3, form: 'trio', keyId: 'Am', custom: { accidentals: false } }, resolveConstraints(3, { accidentals: false }));
    expect(issues.find((i) => i.severity === 'error')?.message).toMatch(/Minor keys need accidentals/);
  });
});
