import { GenerationError } from './constraints';
import { ERAS, ERA_IDS, FORMS, FORM_IDS, FormId, eraOf, formTimes, isEraId, isFormId, keysFor, timesFor } from './forms';
import { generatePiece } from './generator';
import { GRADES, GRADE_SPECS, TIME_SIGNATURES, TimeSignatureId, isGrade, isTimeSignatureId } from './grades';
import { timeChoices } from '../settings-link';

describe('eras and forms', () => {
  it('groups every form under exactly one era, in the order the menus offer them', () => {
    expect(ERAS.baroque.forms).toEqual(['invention', 'fugue', 'chorale']);
    expect(ERAS.galant.forms).toEqual(['minuet', 'trio', 'waltz', 'polonaise', 'gavotte']);
    expect(ERAS.romantic.forms).toEqual(['nocturne', 'prelude']);
    const listed = ERA_IDS.flatMap((e) => ERAS[e].forms);
    expect([...listed].sort()).toEqual([...FORM_IDS].sort());
    for (const e of ERA_IDS) for (const f of ERAS[e].forms) expect(eraOf(f)).toBe(e);
  });

  it('gives each form the metres it is written in, the most typical first', () => {
    expect(FORMS.chorale.times).toEqual(['4/4']);
    expect(FORMS.minuet.times).toEqual(['3/4']);
    expect(FORMS.polonaise.times).toEqual(['3/4']);
    expect(FORMS.waltz.times).toEqual(['3/4', '3/8']);
    expect(FORMS.gavotte.times).toEqual(['4/4', '2/4']);
    expect(FORMS.nocturne.times).toContain('9/8');
    for (const f of FORM_IDS) for (const t of FORMS[f].times) expect(TIME_SIGNATURES[t]).toBeDefined();
  });

  it('offers only metres both the form and the grade allow, and the form’s own when none are', () => {
    expect(timesFor(1, 'nocturne')).toEqual(['4/4', '3/4']);
    expect(timesFor(5, 'nocturne')).toEqual(['4/4', '3/4', '6/8', '9/8']);
    expect(timesFor(1, 'waltz')).toEqual(['3/4']);
    expect(timesFor(4, 'waltz')).toEqual(['3/4', '3/8']);
    expect(formTimes('minuet', ['6/8'])).toEqual(['3/4']);
    for (const g of GRADES) for (const f of FORM_IDS) for (const t of timesFor(g, f)) expect(FORMS[f].times).toContain(t);
  });

  it('offers the grade’s keys for every form', () => {
    for (const g of GRADES) expect(keysFor(g).map((k) => k.id).sort()).toEqual([...GRADE_SPECS[g].keys].sort());
    expect(keysFor(1).some((k) => k.mode === 'minor')).toBe(true);
  });

  it('recognises valid ids from untrusted input (a URL, a select box)', () => {
    for (const id of FORM_IDS) expect(isFormId(id)).toBe(true);
    for (const id of ERA_IDS) expect(isEraId(id)).toBe(true);
    expect(isFormId('chopin')).toBe(false);
    expect(isFormId('toString')).toBe(false);
    expect(isFormId(null)).toBe(false);
    expect(isEraId('modern')).toBe(false);
    expect(isGrade(3)).toBe(true);
    expect(isGrade(6)).toBe(false);
    expect(isGrade(Number('x'))).toBe(false);
    expect(isTimeSignatureId('6/8')).toBe(true);
    expect(isTimeSignatureId('5/4')).toBe(false);
    expect(isTimeSignatureId('toString')).toBe(false);
  });
});

describe('switching forms with different metres', { timeout: 60_000 }, () => {
  /** What the app does on a form change: keep the time signature only if the new form offers it. */
  const switchForm = (grade: (typeof GRADES)[number], time: TimeSignatureId | undefined, to: FormId) =>
    time && timeChoices(grade, to, undefined).includes(time) ? time : undefined;

  it('resets an incompatible time signature to Random, and keeps a compatible one', () => {
    expect(switchForm(5, '6/8', 'minuet')).toBeUndefined(); // Nocturne 6/8 → Minuet (3/4 only)
    expect(switchForm(5, '9/8', 'prelude')).toBeUndefined(); // Nocturne 9/8 → Prelude
    expect(switchForm(5, '3/8', 'trio')).toBeUndefined(); // Waltz 3/8 → Trio
    expect(switchForm(5, '2/4', 'chorale')).toBeUndefined(); // Gavotte 2/4 → Chorale
    expect(switchForm(5, '3/4', 'minuet')).toBe('3/4'); // Waltz 3/4 → Minuet
    expect(switchForm(5, '4/4', 'invention')).toBe('4/4'); // Gavotte 4/4 → Invention
  });

  it('chooses at random only among the form’s metres', () => {
    for (const form of FORM_IDS) {
      for (const grade of GRADES) {
        const offered = timesFor(grade, form);
        for (let s = 0; s < 6; s++) expect(offered, `${form} G${grade}`).toContain(generatePiece({ seed: `m${s}`, grade, form }).time.id);
      }
    }
  });

  it('refuses a time signature the form is not written in, rather than ignoring it', () => {
    expect(() => generatePiece({ seed: 'x', grade: 5, form: 'minuet', timeId: '6/8' })).toThrow(GenerationError);
    expect(() => generatePiece({ seed: 'x', grade: 5, form: 'chorale', timeId: '3/4' })).toThrow(/Chorale is not written in 3\/4/);
    expect(() => generatePiece({ seed: 'x', grade: 5, form: 'invention', timeId: '9/8' })).toThrow(GenerationError);
    expect(generatePiece({ seed: 'x', grade: 5, form: 'nocturne', timeId: '9/8' }).time.id).toBe('9/8');
  });
});
