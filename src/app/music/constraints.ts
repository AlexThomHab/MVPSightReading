/**
 * Generation constraints: what a piece may contain. Three layers decide it —
 *   1. style rules (inside each generator: what makes a waltz a waltz);
 *   2. grade defaults (GRADE_SPECS: the note values, metres, leaps and ranges of a grade);
 *   3. the user's customisation, which overrides the grade where set.
 * `resolveConstraints` merges 2 and 3; `effectiveSpec` hands the result to the generators in
 * the form they already read (a GradeSpec); `validateSettings` reports combinations that
 * cannot work before anything is generated; `pitchWindow` turns an absolute pitch range into
 * the scale-degree window a melody is written in.
 *
 * A setting the user has not touched is not overridden: with no customisation at all, every
 * generator behaves exactly as before.
 */
import { GRADE_SPECS, Grade, GradeSpec, TIME_SIGNATURES, TimeSignatureId } from './grades';
import type { Settings } from './model';
import { STYLES } from './styles';
import { KEYS, Key, LETTERS, Letter, Pitch, diatonicIndex, keySignatureAlter, midi, naturalAt, pitchName, tonicOctaveFor } from './theory';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type NoteValueId = 'semibreve' | 'dottedMinim' | 'minim' | 'dottedCrotchet' | 'crotchet' | 'dottedQuaver' | 'quaver' | 'semiquaver';

export interface NoteValue {
  id: NoteValueId;
  ticks: number;
  /** British and American names, for labels and screen readers. */
  name: string;
}

export const NOTE_VALUES: readonly NoteValue[] = [
  { id: 'semibreve', ticks: 16, name: 'Semibreve (whole note)' },
  { id: 'dottedMinim', ticks: 12, name: 'Dotted minim (dotted half note)' },
  { id: 'minim', ticks: 8, name: 'Minim (half note)' },
  { id: 'dottedCrotchet', ticks: 6, name: 'Dotted crotchet (dotted quarter note)' },
  { id: 'crotchet', ticks: 4, name: 'Crotchet (quarter note)' },
  { id: 'dottedQuaver', ticks: 3, name: 'Dotted quaver (dotted eighth note)' },
  { id: 'quaver', ticks: 2, name: 'Quaver (eighth note)' },
  { id: 'semiquaver', ticks: 1, name: 'Semiquaver (sixteenth note)' },
];

export const ticksOf = (id: NoteValueId) => NOTE_VALUES.find((v) => v.id === id)!.ticks;
export const noteValueFor = (ticks: number) => NOTE_VALUES.find((v) => v.ticks === ticks);

/** Melodic interval sizes in scale steps: 0 = unison (a repeated note), 1 = a 2nd … 7 = an octave. */
export const INTERVAL_NAMES = ['Unison', '2nd', '3rd', '4th', '5th', '6th', '7th', 'Octave'] as const;
export const MAX_INTERVAL = 7;

export type HandIndependence = 'together' | 'partial' | 'full';
export type RhythmicDifficulty = 'easy' | 'medium' | 'difficult';

/** A pitch range by its lowest and highest natural notes, written like "C4" and "G5". */
export interface PitchRangeSetting {
  low: string;
  high: string;
}

/**
 * The user's customisation: every field optional; a missing field keeps the grade's default.
 * Plain data (strings, numbers, booleans), so it can be stored and shared in a link.
 */
export interface Customisation {
  noteValues?: NoteValueId[];
  /** Rests that may appear (empty: none). */
  restValues?: NoteValueId[];
  /** Time signatures a random piece may be in. */
  timeSignatures?: TimeSignatureId[];
  /** The right hand's (melody's) range. */
  melodyRange?: PitchRangeSetting;
  /** Configure the hands separately: the left hand's range and largest bass leap. */
  separateHands?: boolean;
  bassRange?: PitchRangeSetting;
  bassMaxLeap?: number;
  /** 'max': any interval up to `maxLeap`; 'custom': only the sizes listed. */
  leapMode?: 'max' | 'custom';
  maxLeap?: number;
  ascending?: number[];
  descending?: number[];
  independence?: HandIndependence;
  rhythmicDifficulty?: RhythmicDifficulty;
  accidentals?: boolean;
  dynamics?: boolean;
  staccato?: boolean;
  accents?: boolean;
  tenuto?: boolean;
  slurs?: boolean;
  ornaments?: boolean;
  syncopation?: boolean;
  ties?: boolean;
}

/** True when nothing is customised (an empty or missing customisation). */
export function isDefault(c: Customisation | undefined): boolean {
  return !c || Object.values(c).every((v) => v === undefined);
}

const NOTE_VALUE_IDS = new Set<string>(['semibreve', 'dottedMinim', 'minim', 'dottedCrotchet', 'crotchet', 'dottedQuaver', 'quaver', 'semiquaver']);
const BOOLEAN_FIELDS = ['separateHands', 'accidentals', 'dynamics', 'staccato', 'accents', 'tenuto', 'slurs', 'ornaments', 'syncopation', 'ties'] as const;

/**
 * A customisation from untrusted data (a shared link): every field type-checked, anything
 * unknown or malformed dropped, so the result is always a valid (possibly empty) customisation.
 */
export function sanitiseCustomisation(raw: unknown): Customisation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Customisation = {};
  const list = <T>(v: unknown, ok: (x: unknown) => x is T): T[] | undefined => (Array.isArray(v) ? [...new Set(v.filter(ok))] : undefined);
  const isNoteValue = (x: unknown): x is NoteValueId => typeof x === 'string' && NOTE_VALUE_IDS.has(x);
  const isTime = (x: unknown): x is TimeSignatureId => typeof x === 'string' && Object.prototype.hasOwnProperty.call(TIME_SIGNATURES, x);
  const isSize = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= MAX_INTERVAL;
  const range = (v: unknown): PitchRangeSetting | undefined => {
    if (typeof v !== 'object' || v === null) return undefined;
    const { low, high } = v as Record<string, unknown>;
    return typeof low === 'string' && typeof high === 'string' && parsePitch(low) && parsePitch(high) ? { low, high } : undefined;
  };
  out.noteValues = list(r['noteValues'], isNoteValue);
  out.restValues = list(r['restValues'], isNoteValue);
  out.timeSignatures = list(r['timeSignatures'], isTime);
  out.melodyRange = range(r['melodyRange']);
  out.bassRange = range(r['bassRange']);
  out.bassMaxLeap = isSize(r['bassMaxLeap']) && r['bassMaxLeap'] > 0 ? r['bassMaxLeap'] : undefined;
  out.leapMode = r['leapMode'] === 'max' || r['leapMode'] === 'custom' ? r['leapMode'] : undefined;
  out.maxLeap = isSize(r['maxLeap']) && r['maxLeap'] > 0 ? r['maxLeap'] : undefined;
  out.ascending = list(r['ascending'], isSize);
  out.descending = list(r['descending'], isSize);
  const independence = r['independence'];
  out.independence = independence === 'together' || independence === 'partial' || independence === 'full' ? independence : undefined;
  const difficulty = r['rhythmicDifficulty'];
  out.rhythmicDifficulty = difficulty === 'easy' || difficulty === 'medium' || difficulty === 'difficult' ? difficulty : undefined;
  for (const field of BOOLEAN_FIELDS) {
    if (typeof r[field] === 'boolean') out[field] = r[field];
  }
  // Drop the fields left undefined, so an untouched setting stays absent.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Customisation;
}

/** A customisation as a compact, URL-safe string (base64url JSON); '' when nothing is customised. */
export function encodeCustomisation(c: Customisation | undefined): string {
  if (!c || isDefault(c)) return '';
  return btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The customisation in a link (see `encodeCustomisation`); empty when missing or malformed. */
export function decodeCustomisation(text: string | null): Customisation {
  if (!text) return {};
  try {
    return sanitiseCustomisation(JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/'))));
  } catch {
    return {};
  }
}

/**
 * The grade's default range for a hand, as absolute notes, shown in the panel before the user
 * sets one. A grade's ranges are relative to the key's tonic, so these are given in C major.
 */
export function defaultRange(grade: Grade, hand: 'melody' | 'bass'): PitchRangeSetting {
  const spec = GRADE_SPECS[grade];
  const [lo, hi] = hand === 'melody' ? spec.rhRange : spec.lhRange;
  const tonic = diatonicIndex({ letter: 'C', alter: 0, octave: hand === 'melody' ? 4 : 3 });
  return { low: formatPitch(naturalAt(tonic + lo)), high: formatPitch(naturalAt(tonic + hi)) };
}

// ---------------------------------------------------------------------------
// Resolved constraints
// ---------------------------------------------------------------------------

export interface PitchRange {
  low: Pitch;
  high: Pitch;
}

export interface GenerationConstraints {
  noteTicks: readonly number[];
  restTicks: readonly number[];
  times: readonly TimeSignatureId[];
  /** Absolute ranges, or null to use the grade's range around the key's tonic. */
  melodyRange: PitchRange | null;
  bassRange: PitchRange | null;
  maxLeap: number;
  /** Interval sizes allowed rising and falling (all sizes up to maxLeap unless customised). */
  ascending: ReadonlySet<number>;
  descending: ReadonlySet<number>;
  bassMaxLeap: number;
  independence: HandIndependence;
  rhythmicDifficulty: RhythmicDifficulty;
  accidentals: boolean;
  dynamics: boolean;
  staccato: boolean;
  accents: boolean;
  tenuto: boolean;
  slurs: boolean;
  ornaments: boolean;
  syncopation: boolean;
  ties: boolean;
  /** Whether the user chose the note values (then they replace the grade's rhythmic vocabulary). */
  customRhythm: boolean;
}

const upTo = (n: number) => new Set(Array.from({ length: n + 1 }, (_, i) => i));

/** Parses "C4", "F#3", "Bb5"; null if malformed. */
export function parsePitch(name: string): Pitch | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) return null;
  return { letter: m[1] as Letter, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) };
}

export function formatPitch(p: Pitch): string {
  return `${p.letter}${p.alter > 0 ? '#' : p.alter < 0 ? 'b' : ''}${p.octave}`;
}

function rangeOf(setting: PitchRangeSetting | undefined): PitchRange | null {
  if (!setting) return null;
  const low = parsePitch(setting.low);
  const high = parsePitch(setting.high);
  return low && high ? { low, high } : null;
}

/** The grade's defaults, overridden by whatever the user has customised. */
export function resolveConstraints(grade: Grade, c: Customisation = {}): GenerationConstraints {
  const spec = GRADE_SPECS[grade];
  const maxLeap = c.maxLeap ?? spec.maxLeap;
  const custom = c.leapMode === 'custom';
  return {
    noteTicks: c.noteValues ? c.noteValues.map(ticksOf) : spec.durations,
    restTicks: (c.restValues ?? []).map(ticksOf),
    times: c.timeSignatures ?? spec.times,
    melodyRange: rangeOf(c.melodyRange),
    bassRange: c.separateHands ? rangeOf(c.bassRange) : null,
    maxLeap: custom ? Math.max(0, ...(c.ascending ?? []), ...(c.descending ?? [])) : maxLeap,
    ascending: custom ? new Set(c.ascending ?? []) : upTo(maxLeap),
    descending: custom ? new Set(c.descending ?? []) : upTo(maxLeap),
    bassMaxLeap: (c.separateHands ? c.bassMaxLeap : undefined) ?? spec.maxBassLeap,
    independence: c.independence ?? 'partial',
    rhythmicDifficulty: c.rhythmicDifficulty ?? 'medium',
    accidentals: c.accidentals ?? true,
    dynamics: c.dynamics ?? true,
    staccato: c.staccato ?? true,
    accents: c.accents ?? true,
    tenuto: c.tenuto ?? true,
    slurs: c.slurs ?? true,
    ornaments: c.ornaments ?? true,
    syncopation: c.syncopation ?? false,
    ties: c.ties ?? true,
    customRhythm: c.noteValues !== undefined,
  };
}

/** The constraints a piece's settings imply, or null when nothing is customised. */
export function constraintsOf(settings: Settings): GenerationConstraints | null {
  return isDefault(settings.custom) ? null : resolveConstraints(settings.grade, settings.custom);
}

/**
 * Melodic interval size between two pitches, in scale steps (a chromatic step on one letter,
 * C–C♯, counts as a 2nd: it sounds like one).
 */
export function intervalSize(a: Pitch, b: Pitch): number {
  const steps = Math.abs(diatonicIndex(b) - diatonicIndex(a));
  return steps === 0 && midi(a) !== midi(b) ? 1 : steps;
}

/** Whether the melody may move from `a` to `b`. */
export function melodicIntervalAllowed(c: GenerationConstraints, a: Pitch, b: Pitch): boolean {
  const size = intervalSize(a, b);
  if (size > c.maxLeap) return false;
  const rising = midi(b) > midi(a);
  return size === 0 ? c.ascending.has(0) || c.descending.has(0) : (rising ? c.ascending : c.descending).has(size);
}

/**
 * The grade's limits with the user's overrides applied, in the form the generators read. With
 * no constraints, the grade's own spec, untouched.
 */
export function effectiveSpec(grade: Grade, c: GenerationConstraints | null): GradeSpec {
  const spec = GRADE_SPECS[grade];
  if (!c) return spec;
  // Only keys whose tonic lies inside the ranges (melodies begin and end on it), and without
  // accidentals only major keys (a minor key's raised leading note is written as one).
  const keys = spec.keys.filter((id) => keyAllowed(KEYS.find((k) => k.id === id)!, c));
  return {
    ...spec,
    durations: c.noteTicks,
    times: c.times.filter((t) => canFill(TIME_SIGNATURES[t].barTicks, c.noteTicks)),
    maxLeap: c.maxLeap,
    maxBassLeap: c.bassMaxLeap,
    keys,
    chromatic: spec.chromatic && c.accidentals,
    // V/V raises the 4th: a chromatic note.
    extraChords: c.accidentals ? spec.extraChords : spec.extraChords.filter((x) => x !== 'V/V'),
  };
}

// ---------------------------------------------------------------------------
// Pitch ranges
// ---------------------------------------------------------------------------

export interface PitchWindow {
  /** Octave of the tonic that degree 0 refers to. */
  tonicOctave: number;
  /** Lowest and highest scale degrees (relative to that tonic) inside the range. */
  lo: number;
  hi: number;
}

/**
 * The scale-degree window for a part: the grade's degrees around the tonic, or — for an
 * absolute range — the degrees whose notes (in the key) lie inside it, measured from a tonic
 * that lies inside it too (melodies begin and end there).
 */
export function pitchWindow(key: Key, gradeRange: readonly [number, number], comfortLow: Pitch, comfortHigh: Pitch, range: PitchRange | null): PitchWindow | null {
  if (!range) {
    const [lo, hi] = gradeRange;
    return { tonicOctave: tonicOctaveFor(key, lo, hi, comfortLow, comfortHigh), lo, hi };
  }
  const inKey = (letter: Letter, octave: number): Pitch => ({ letter, alter: keySignatureAlter(key, letter), octave });
  const lowMidi = midi(range.low);
  const highMidi = midi(range.high);
  // Tonics inside the range; prefer one with room above it (a melody rises from its tonic).
  const tonics = [1, 2, 3, 4, 5, 6].map((o) => inKey(key.tonic, o)).filter((t) => midi(t) >= lowMidi && midi(t) <= highMidi);
  if (!tonics.length) return null;
  const tonic = tonics.find((t) => highMidi - midi(t) >= 7) ?? tonics[0];
  const tonicIndex = diatonicIndex({ letter: key.tonic, alter: 0, octave: tonic.octave });
  const at = (d: number) => {
    const D = tonicIndex + d;
    return inKey(LETTERS[((D % 7) + 7) % 7], Math.floor(D / 7));
  };
  let lo = diatonicIndex(range.low) - tonicIndex;
  let hi = diatonicIndex(range.high) - tonicIndex;
  while (midi(at(lo)) < lowMidi) lo++;
  while (midi(at(hi)) > highMidi) hi--;
  return { tonicOctave: tonic.octave, lo, hi };
}

/** A key suits the ranges when each contains its tonic. */
/** Whether a piece may be in this key under these constraints. */
export function keyAllowed(key: Key, c: GenerationConstraints): boolean {
  return keyFitsRanges(key, c) && (c.accidentals || key.mode === 'major');
}

export function keyFitsRanges(key: Key, c: GenerationConstraints): boolean {
  const comfort = { letter: 'C', alter: 0, octave: 4 } as const;
  if (c.melodyRange && !pitchWindow(key, [0, 0], comfort, comfort, c.melodyRange)) return false;
  if (c.bassRange && !pitchWindow(key, [0, 0], comfort, comfort, c.bassRange)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ConstraintIssue {
  severity: 'error' | 'warning';
  /** The panel section the issue belongs to. */
  area: 'rhythm' | 'metre' | 'range' | 'leaps' | 'hands' | 'expression';
  message: string;
}

/** Whether a bar of `barTicks` can be made of these durations at all. */
export function canFill(barTicks: number, durations: readonly number[]): boolean {
  const ok = [true];
  for (let t = 1; t <= barTicks; t++) ok[t] = durations.some((d) => d <= t && ok[t - d]);
  return ok[barTicks];
}

const describe = (ticks: readonly number[]) => ticks.map((t) => noteValueFor(t)?.name.split(' (')[0].toLowerCase() ?? `${t}`).join(', ');

/**
 * Problems with a combination of settings, found before generating: errors make a piece
 * impossible; warnings explain where a style must adapt to a setting.
 */
export function validateSettings(settings: Settings, c: GenerationConstraints): ConstraintIssue[] {
  const issues: ConstraintIssue[] = [];
  const error = (area: ConstraintIssue['area'], message: string) => issues.push({ severity: 'error', area, message });
  const warn = (area: ConstraintIssue['area'], message: string) => issues.push({ severity: 'warning', area, message });
  const style = settings.style;

  // Rhythm and metre.
  if (!c.noteTicks.length) error('rhythm', 'Choose at least one note value.');
  const metres = settings.timeId ? [settings.timeId] : style === 'chorale' ? (['4/4'] as TimeSignatureId[]) : [...c.times];
  if (!metres.length) error('metre', 'Choose at least one time signature.');
  const fillable = metres.filter((t) => canFill(TIME_SIGNATURES[t].barTicks, c.noteTicks));
  if (c.noteTicks.length && metres.length && !fillable.length) {
    error('rhythm', `A bar of ${metres.join(' or ')} can't be made of ${describe(c.noteTicks)} alone — allow more note values.`);
  } else if (fillable.length < metres.length) {
    warn('metre', `${metres.filter((t) => !fillable.includes(t)).join(', ')} can't be filled with these note values, so won't be used.`);
  }
  if (style === 'chorale') {
    if (!c.noteTicks.includes(4)) error('rhythm', 'Chorales move in crotchets: allow crotchets.');
    if (!c.times.includes('4/4') && !settings.timeId) error('metre', 'Chorales are in 4/4: allow 4/4.');
    if (c.restTicks.length) warn('rhythm', "Chorales don't use rests.");
  }
  if (c.syncopation && !(c.noteTicks.includes(2) && c.noteTicks.includes(4))) {
    warn('rhythm', 'Syncopation needs quavers and crotchets, so none will be written.');
  }

  // Ranges.
  for (const [name, range, minSteps] of [['melody', c.melodyRange, 4], ['left-hand', c.bassRange, 3]] as const) {
    if (!range) continue;
    if (midi(range.low) >= midi(range.high)) error('range', `The ${name} range's lowest note must be below its highest.`);
    else if (diatonicIndex(range.high) - diatonicIndex(range.low) < minSteps) {
      error('range', `The ${name} range needs at least ${minSteps === 4 ? 'a fifth' : 'a fourth'} (${pitchName(range.low)}–${pitchName(range.high)} is too narrow).`);
    }
  }
  if (c.melodyRange && c.bassRange && midi(c.bassRange.high) >= midi(c.melodyRange.low)) {
    warn('range', 'The hands’ ranges overlap: their notes may cross.');
  }
  const candidateKeys = settings.keyId ? KEYS.filter((k) => k.id === settings.keyId) : effectiveSpec(settings.grade, c).keys.map((id) => KEYS.find((k) => k.id === id)!);
  const usable = candidateKeys.filter((k) => keyAllowed(k, c) && !(STYLES[style].majorOnly && k.mode === 'minor'));
  const chosen = settings.keyId ? KEYS.find((k) => k.id === settings.keyId) : undefined;
  if (chosen?.mode === 'minor' && !c.accidentals) {
    error('expression', `Minor keys need accidentals for their raised leading note: choose a major key or switch accidentals on.`);
  } else if ((c.melodyRange || c.bassRange) && !usable.length) {
    error('range', settings.keyId ? `The range must include the key's tonic (${settings.keyId.replace('m', ' minor')}).` : 'No key this grade allows has its tonic inside the range — widen the range.');
  }

  // Leaps.
  const rises = [...c.ascending].some((s) => s > 0);
  const falls = [...c.descending].some((s) => s > 0);
  if (!rises && !falls) error('leaps', 'A melody needs to move: allow at least one interval larger than a unison.');
  else if (!rises || !falls) error('leaps', `A melody must rise and fall: allow at least one ${rises ? 'falling' : 'rising'} interval.`);
  else if (!c.ascending.has(1) && !c.descending.has(1)) warn('leaps', 'Without 2nds, melodies are hard to shape: some combinations may not be possible.');

  // Style adaptations worth knowing about.
  if (style === 'chopin' && c.independence === 'together') {
    warn('hands', "Chopin's flowing accompaniment will follow the melody's rhythm instead.");
  }
  if ((style === 'chopin' || style === 'chorale') && !c.accidentals) {
    warn('expression', `Without accidentals, ${style === 'chopin' ? 'Chopin pieces' : 'chorales'} keep to diatonic harmony (no modulation, secondary dominants or chromatic colour).`);
  }
  return issues;
}

/** An error raised when settings cannot produce a piece; carries the reasons. */
export class GenerationError extends Error {
  constructor(readonly issues: ConstraintIssue[]) {
    super(issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' '));
    this.name = 'GenerationError';
  }
}
