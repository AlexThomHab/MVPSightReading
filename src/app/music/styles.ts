/**
 * The styles the generator writes in, and what every part of the application needs to know
 * about them: their names, the keys and metres they use. Each style's compositional rules
 * live with its generator (piano-styles.ts and piano.ts, chopin/, chorale.ts).
 */
import { GRADE_SPECS, Grade, TimeSignatureId } from './grades';
import { KEYS, Key } from './theory';

export type StyleId = 'classical' | 'waltz' | 'minuet' | 'march' | 'folk' | 'chorale' | 'chopin';
/** Every style, in the order they are offered. */
export const STYLE_IDS: readonly StyleId[] = ['classical', 'waltz', 'minuet', 'march', 'folk', 'chopin', 'chorale'];

export function isStyleId(value: string | null): value is StyleId {
  return value !== null && (STYLE_IDS as readonly string[]).includes(value);
}

export interface StyleInfo {
  id: StyleId;
  /** The name shown to the user. */
  name: string;
  /** Written only in major keys. */
  majorOnly: boolean;
  /** The only time signatures the style is written in; otherwise any the grade allows. */
  metres?: readonly TimeSignatureId[];
}

export const STYLES: Readonly<Record<StyleId, StyleInfo>> = {
  classical: { id: 'classical', name: 'Classical', majorOnly: false },
  waltz: { id: 'waltz', name: 'Waltz', majorOnly: false },
  minuet: { id: 'minuet', name: 'Minuet', majorOnly: false },
  march: { id: 'march', name: 'March', majorOnly: true },
  folk: { id: 'folk', name: 'Folk', majorOnly: false },
  // Miniatures in the manner of Chopin: nocturnes, preludes, waltzes and mazurkas (chopin/).
  chopin: { id: 'chopin', name: 'Chopin', majorOnly: false },
  // Four-part chorales in the manner of J. S. Bach (chorale.ts).
  chorale: { id: 'chorale', name: 'Bach chorale', majorOnly: false, metres: ['4/4'] },
};

/** Keys offered for a grade and style (March is major-only). */
export function keysFor(grade: Grade, style: StyleId): Key[] {
  const spec = GRADE_SPECS[grade];
  return KEYS.filter((k) => spec.keys.includes(k.id) && !(STYLES[style].majorOnly && k.mode === 'minor'));
}

/** Time signatures offered for a grade (and style: chorales are in 4/4). */
export function timesFor(grade: Grade, style?: StyleId): TimeSignatureId[] {
  return [...(style ? STYLES[style].metres : undefined) ?? GRADE_SPECS[grade].times];
}
