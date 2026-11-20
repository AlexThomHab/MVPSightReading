/**
 * Generates a sight-reading piece in any style. Each style has its own generator; this is the
 * one place that knows which — adding a style means adding its generator here and its entry
 * in STYLES.
 *
 * Pure TypeScript with no Angular dependencies. Fully deterministic: the same settings
 * (including the seed) always produce the same piece.
 */
import { generateChopin } from './chopin';
import { generateChorale } from './chorale';
import { GenerationError, isDefault } from './constraints';
import { generateCustomised } from './customise';
import type { Piece, Settings } from './model';
import { generatePianoPiece } from './piano';
import { StyleId } from './styles';

type StyleGenerator = (settings: Settings) => Piece;

const GENERATORS: Readonly<Record<StyleId, StyleGenerator>> = {
  classical: generatePianoPiece,
  waltz: generatePianoPiece,
  minuet: generatePianoPiece,
  march: generatePianoPiece,
  folk: generatePianoPiece,
  chopin: generateChopin,
  chorale: generateChorale,
};

/**
 * The piece for these settings. With a customisation, the generator composes within the
 * user's constraints and the result is checked against them (see customise.ts); throws a
 * GenerationError when the settings cannot be met.
 */
export function generatePiece(settings: Settings): Piece {
  const generate = GENERATORS[settings.style];
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
