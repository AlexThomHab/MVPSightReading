/**
 * The generator's settings as a shareable link (?seed=…&grade=…&style=…&key=…&time=…&c=…), and
 * the choices the Key and Time menus offer for them.
 */
import { Customisation, decodeCustomisation, encodeCustomisation, isDefault } from './music/constraints';
import { Grade, TimeSignatureId, isGrade, isTimeSignatureId } from './music/grades';
import { Settings } from './music/model';
import { freshSeed } from './music/random';
import { STYLES, StyleId, isStyleId, keysFor, timesFor } from './music/styles';
import { Key } from './music/theory';

/**
 * The time signatures the Time menu offers: the style's own metres (chorales are in 4/4), else
 * the user's chosen metres, else the grade's.
 */
export function timeChoices(grade: Grade, style: StyleId, custom: Customisation | undefined): TimeSignatureId[] {
  return !STYLES[style].metres && custom?.timeSignatures ? [...custom.timeSignatures] : timesFor(grade, style);
}

/** The keys the Key menu offers: the grade's (and style's), only major ones without accidentals. */
export function keyChoices(grade: Grade, style: StyleId, custom: Customisation | undefined): Key[] {
  return keysFor(grade, style).filter((k) => custom?.accidentals !== false || k.mode === 'major');
}

/** Settings from a link's query string; anything missing or invalid falls back to a default. */
export function settingsFromQuery(search: string): Settings {
  const params = new URLSearchParams(search);
  const grade = Number(params.get('grade'));
  const style = params.get('style');
  const settings: Settings = {
    seed: params.get('seed') || freshSeed(),
    grade: isGrade(grade) ? grade : 1,
    style: isStyleId(style) ? style : 'classical',
  };
  const custom = decodeCustomisation(params.get('c'));
  if (!isDefault(custom)) settings.custom = custom;
  const keyId = params.get('key');
  if (keyId && keyChoices(settings.grade, settings.style, settings.custom).some((k) => k.id === keyId)) settings.keyId = keyId;
  const timeId = params.get('time');
  if (isTimeSignatureId(timeId) && timeChoices(settings.grade, settings.style, settings.custom).includes(timeId)) settings.timeId = timeId;
  return settings;
}

/** The query string that shares these settings. */
export function settingsToQuery(s: Settings): string {
  const params = new URLSearchParams({ seed: s.seed, grade: String(s.grade), style: s.style });
  if (s.keyId) params.set('key', s.keyId);
  if (s.timeId) params.set('time', s.timeId);
  const c = encodeCustomisation(s.custom);
  if (c) params.set('c', c);
  return `?${params}`;
}

/** True when two settings describe the same piece. */
export function sameSettings(a: Settings, b: Settings): boolean {
  return settingsToQuery(a) === settingsToQuery(b);
}
