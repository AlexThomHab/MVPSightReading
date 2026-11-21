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
import { FORMS, FormId } from './forms';
import { generateGalant } from './galant';
import type { Piece, Settings } from './model';

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

/**
 * The piece for these settings. With a customisation, the generator composes within the
 * user's constraints and the result is checked against them (see customise.ts); throws a
 * GenerationError when the settings cannot be met — including a time signature the form is
 * not written in.
 */
export function generatePiece(settings: Settings): Piece {
  const form = FORMS[settings.form];
  if (!form) throw new Error(`Unknown form: ${settings.form}`);
  if (settings.timeId && !form.times.includes(settings.timeId)) {
    const message = `A ${form.name} is not written in ${settings.timeId} (it is written in ${form.times.join(', ')}).`;
    throw new GenerationError([{ severity: 'error', area: 'metre', message }]);
  }
  const generate = GENERATORS[settings.form];
  return isDefault(settings.custom) ? generate(settings) : generateCustomised(settings, generate);
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
