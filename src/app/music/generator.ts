/**
 * Generates a sight-reading piece in any form. Each era has its own generator; this is the one
 * place that knows which — adding a form means adding it to forms.ts and its generator here.
 *
 * Pure TypeScript with no Angular dependencies. Fully deterministic: the same settings
 * (including the seed) always produce the same piece.
 */
import { generateBaroque } from './baroque';
import { generateChopin } from './chopin';
import { generateChorale } from './chorale';
import { GenerationError, isDefault } from './constraints';
import { generateCustomised } from './customise';
import { FORMS, FormId, unavailableReason } from './forms';
import { finish } from './finishing';
import { generateGalant } from './galant';
import type { Piece, Settings } from './model';
import { beyondGrade } from './constraints';
import { validatePiece } from './validate';

type FormGenerator = (settings: Settings) => Piece;

const GENERATORS: Readonly<Record<FormId, FormGenerator>> = {
  invention: generateBaroque,
  fugue: generateBaroque,
  chorale: generateChorale,
  minuet: generateGalant,
  trio: generateGalant,
  waltz: generateGalant,
  polonaise: generateGalant,
  gavotte: generateGalant,
  nocturne: generateChopin,
  prelude: generateChopin,
};

/** How many related seeds to try before giving up on a piece that keeps failing validation. */
const ATTEMPTS = 12;

/**
 * The piece for these settings: composed by the form's generator, finished with the grade's
 * notation elements (finishing.ts), fitted to any customisation (customise.ts), then validated
 * against the grade (validate.ts). A piece that fails validation is never shown: the next of
 * a few related seeds is tried instead (deterministically, so a link still reproduces it).
 *
 * Throws a GenerationError when the settings cannot be met: a form the grade cannot write, a
 * time signature the form is not written in, or a customisation that cannot work.
 */
export function generatePiece(settings: Settings): Piece {
  const form = FORMS[settings.form];
  if (!form) throw new Error(`Unknown form: ${settings.form}`);
  const unavailable = unavailableReason(settings.form, settings.grade);
  if (unavailable) throw new GenerationError([{ severity: 'error', area: 'metre', message: `A ${form.name} at Grade ${settings.grade}? ${unavailable}` }]);
  if (settings.timeId && !form.times.includes(settings.timeId)) {
    const message = `A ${form.name} is not written in ${settings.timeId} (it is written in ${form.times.join(', ')}).`;
    throw new GenerationError([{ severity: 'error', area: 'metre', message }]);
  }
  const compose = (s: Settings) => finish(GENERATORS[settings.form](s), s);
  let lastError: unknown = null;
  let fallback: Piece | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt ? { ...settings, seed: `${settings.seed}~${attempt}` } : settings;
    let piece: Piece;
    try {
      piece = isDefault(settings.custom) ? compose(s) : generateCustomised(s, compose);
    } catch (e) {
      if (e instanceof GenerationError) throw e;
      lastError = e;
      continue;
    }
    piece.seed = settings.seed;
    const beyond = settings.custom?.advanced ? beyondGrade(settings.grade, settings.custom) : [];
    piece.difficulty = beyond.length ? 'custom' : 'grade';
    if (beyond.length) piece.beyondGrade = beyond;
    if (!validatePiece(piece, settings).length) return piece;
    fallback ??= piece;
  }
  if (fallback) return fallback;
  throw lastError instanceof Error ? lastError : new Error('Could not generate a piece');
}

/** A piece, or why the settings cannot produce one. */
export type Attempt = { piece: Piece; error?: undefined } | { piece?: undefined; error: string };

/** Like generatePiece, but a GenerationError comes back as its message instead of being thrown. */
export function tryGeneratePiece(settings: Settings): Attempt {
  try {
    return { piece: generatePiece(settings) };
  } catch (e) {
    if (e instanceof GenerationError) return { error: e.message };
    throw e;
  }
}
