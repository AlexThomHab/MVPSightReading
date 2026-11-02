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
import { isDefault } from './constraints';
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
