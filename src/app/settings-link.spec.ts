import { Settings } from './music/model';
import { keyChoices, sameSettings, settingsFromQuery, settingsToQuery, timeChoices } from './settings-link';

describe('settings link', () => {
  it('round-trips settings through a link', () => {
    const s: Settings = { seed: 'abc', grade: 3, form: 'waltz', keyId: 'G', timeId: '3/4', custom: { accidentals: false } };
    expect(settingsFromQuery(settingsToQuery(s))).toEqual(s);
  });

  it('falls back to defaults for anything missing or invalid', () => {
    const s = settingsFromQuery('?seed=x&grade=9&style=jazz&key=Zz&time=5/4');
    expect(s).toEqual({ seed: 'x', grade: 1, form: 'minuet' });
    expect(settingsFromQuery('').seed).toMatch(/\w+/);
  });

  it('opens links made before eras and forms at the nearest form', () => {
    expect(settingsFromQuery('?seed=x&grade=2&style=chopin').form).toBe('prelude');
    expect(settingsFromQuery('?seed=x&grade=2&style=march').form).toBe('gavotte');
    expect(settingsFromQuery('?seed=x&grade=2&style=chorale&form=fugue').form).toBe('fugue');
  });

  it('offers only major keys without accidentals, and only the form’s own metres', () => {
    expect(keyChoices(3, { accidentals: false }).every((k) => k.mode === 'major')).toBe(true);
    expect(timeChoices(5, 'trio', { timeSignatures: ['2/4', '6/8'] })).toEqual(['2/4']);
    expect(timeChoices(5, 'minuet', undefined)).toEqual(['3/4']);
    expect(timeChoices(5, 'nocturne', undefined)).toEqual(['4/4', '3/4', '6/8', '9/8']);
    // Below Grade 3 the grade's metres limit the form's.
    expect(timeChoices(2, 'fugue', undefined)).toEqual(['4/4', '2/4', '3/4']);
    // When none of the user's metres suit the form, it keeps its own (and the panel says so).
    expect(timeChoices(1, 'chorale', { timeSignatures: ['6/8'] })).toEqual(['4/4']);
  });

  it('drops a time signature in a link that the form is not written in', () => {
    expect(settingsFromQuery('?seed=x&grade=5&form=minuet&time=6/8').timeId).toBeUndefined();
    expect(settingsFromQuery('?seed=x&grade=5&form=waltz&time=3/8').timeId).toBe('3/8');
  });

  it('compares settings by the piece they describe', () => {
    const a: Settings = { seed: 'a', grade: 2, form: 'trio', custom: {} };
    expect(sameSettings(a, { seed: 'a', grade: 2, form: 'trio' })).toBe(true);
    expect(sameSettings(a, { ...a, custom: { ties: false } })).toBe(false);
  });
});
