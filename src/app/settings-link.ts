/**
 * The generator's settings as a shareable link (?seed=…&grade=…&form=…&key=…&time=…&c=…), and
 * the choices the Key and Time menus offer for them.
 */
import { Customisation, decodeCustomisation, encodeCustomisation, isDefault } from './music/constraints';
import { FormId, formTimes, isFormId, keysFor } from './music/forms';
import { GRADE_SPECS, Grade, TimeSignatureId, isGrade, isTimeSignatureId } from './music/grades';
import { Settings } from './music/model';
import { freshSeed } from './music/random';
import { Key } from './music/theory';

/** Links made before eras and forms named a style: each opens the nearest form. */
const LEGACY_STYLES: Readonly<Record<string, FormId>> = {
  classical: 'trio',
  waltz: 'waltz',
  minuet: 'minuet',
  march: 'gavotte',
  folk: 'trio',
  chopin: 'prelude',
  chorale: 'chorale',
};

/**
 * The time signatures the Time menu offers: the form's own metres, as far as the user's chosen
 * metres (or else the grade's) allow.
 */
export function timeChoices(grade: Grade, form: FormId, custom: Customisation | undefined): TimeSignatureId[] {
  return formTimes(form, custom?.timeSignatures ?? GRADE_SPECS[grade].times);
}

/** The keys the Key menu offers: the grade's, only major ones without accidentals. */
export function keyChoices(grade: Grade, custom: Customisation | undefined): Key[] {
  return keysFor(grade).filter((k) => custom?.accidentals !== false || k.mode === 'major');
}

/** Settings from a link's query string; anything missing or invalid falls back to a default. */
export function settingsFromQuery(search: string): Settings {
  const params = new URLSearchParams(search);
  const grade = Number(params.get('grade'));
  const form = params.get('form');
  const legacy = LEGACY_STYLES[params.get('style') ?? ''];
  const settings: Settings = {
    seed: params.get('seed') || freshSeed(),
    grade: isGrade(grade) ? grade : 1,
    form: isFormId(form) ? form : (legacy ?? 'minuet'),
  };
  const custom = decodeCustomisation(params.get('c'));
  if (!isDefault(custom)) settings.custom = custom;
  const keyId = params.get('key');
  if (keyId && keyChoices(settings.grade, settings.custom).some((k) => k.id === keyId)) settings.keyId = keyId;
  const timeId = params.get('time');
  if (isTimeSignatureId(timeId) && timeChoices(settings.grade, settings.form, settings.custom).includes(timeId)) settings.timeId = timeId;
  return settings;
}

/** The query string that shares these settings. */
export function settingsToQuery(s: Settings): string {
  const params = new URLSearchParams({ seed: s.seed, grade: String(s.grade), form: s.form });
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
