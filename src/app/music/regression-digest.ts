/**
 * Digests of generated music, for regression tests: the same settings must keep producing the
 * same piece. A digest covers everything in the piece (notes, harmony, phrasing, expression),
 * serialised canonically (object keys sorted), so it changes only when the music does.
 */
import { generatePiece } from './generator';
import { GRADES, GRADE_SPECS, Grade } from './grades';
import { FORM_IDS, timesFor } from './forms';

/** JSON with object keys sorted, so field order never affects the digest. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a, 32-bit, as 8 hex digits. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** One digest per form and grade, covering every metre the form offers at the grade, several seeds and a key override. */
export function formGradeDigests(seeds = 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const form of FORM_IDS) {
    for (const grade of GRADES as readonly Grade[]) {
      const parts: string[] = [];
      for (const timeId of timesFor(grade, form)) {
        for (let s = 0; s < seeds; s++) parts.push(canonicalJson(generatePiece({ seed: `reg-${s}`, grade, form, timeId })));
      }
      parts.push(canonicalJson(generatePiece({ seed: 'reg-key', grade, form, keyId: GRADE_SPECS[grade].keys[1] })));
      parts.push(canonicalJson(generatePiece({ seed: 'reg-free', grade, form })));
      out[`${form}/${grade}`] = fnv1a(parts.join('\n'));
    }
  }
  return out;
}
