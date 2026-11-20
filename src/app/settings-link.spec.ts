import { Settings } from './music/model';
import { keyChoices, sameSettings, settingsFromQuery, settingsToQuery, timeChoices } from './settings-link';

describe('settings link', () => {
  it('round-trips settings through a link', () => {
    const s: Settings = { seed: 'abc', grade: 3, style: 'waltz', keyId: 'G', timeId: '3/4', custom: { accidentals: false } };
    expect(settingsFromQuery(settingsToQuery(s))).toEqual(s);
  });

  it('falls back to defaults for anything missing or invalid', () => {
    const s = settingsFromQuery('?seed=x&grade=9&style=jazz&key=Zz&time=5/4');
    expect(s).toEqual({ seed: 'x', grade: 1, style: 'classical' });
    expect(settingsFromQuery('').seed).toMatch(/\w+/);
  });

  it('offers only major keys without accidentals, and the chosen metres', () => {
    expect(keyChoices(3, 'classical', { accidentals: false }).every((k) => k.mode === 'major')).toBe(true);
    expect(timeChoices(1, 'classical', { timeSignatures: ['6/8'] })).toEqual(['6/8']);
    // A chorale keeps to its own metre.
    expect(timeChoices(1, 'chorale', { timeSignatures: ['6/8'] })).toEqual(['4/4']);
  });

  it('compares settings by the piece they describe', () => {
    const a: Settings = { seed: 'a', grade: 2, style: 'folk', custom: {} };
    expect(sameSettings(a, { seed: 'a', grade: 2, style: 'folk' })).toBe(true);
    expect(sameSettings(a, { ...a, custom: { ties: false } })).toBe(false);
  });
});
