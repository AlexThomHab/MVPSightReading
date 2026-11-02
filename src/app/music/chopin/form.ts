/**
 * Form: what each bar does in the musical argument (motif, sequence, climax, cadence…), the
 * phrases and their cadences, and which bars echo earlier ones (returns, sequences, inversions).
 */
import type { Cadence } from '../model';
import { Ctx } from './context';

/** What a bar does in the musical argument. */
export type Role =
  | 'motif'
  | 'answer'
  | 'sequence'
  | 'sequenceAnswer'
  | 'intensify'
  | 'climax'
  | 'precadence'
  | 'cadence'
  | 'contrast'
  | 'contrastSeq'
  | 'return';

interface CPhrase {
  start: number;
  roles: Role[];
  cadence: Cadence;
  /** The B section of A–B–A′. */
  contrast: boolean;
  /** Opens by bringing back the opening. */
  returns: boolean;
}

/** A bar that echoes an earlier one: exactly (a return) or in shape (a sequence). */
interface Echo {
  source: number;
  exact: boolean;
  /** The return is more ornate than the original. */
  ornate: boolean;
  /** The motif turned upside down (a contrasting section's new idea, grown from the old). */
  invert?: boolean;
}

export interface Form {
  kind: 'gesture' | 'period' | 'sentence' | 'ternary';
  phrases: CPhrase[];
  barCount: number;
  /** The bar holding the piece's highest note. */
  climaxBar: number;
  echoes: Map<number, Echo>;
}

export function planForm(ctx: Ctx, barCount: number): Form {
  const phrase = (start: number, roles: Role[], cadence: Cadence, extra: Partial<CPhrase> = {}): CPhrase => ({
    start,
    roles,
    cadence,
    contrast: false,
    returns: false,
    ...extra,
  });
  const echoes = new Map<number, Echo>();
  if (barCount === 4) {
    return { kind: 'gesture', barCount, climaxBar: 2, echoes, phrases: [phrase(0, ['motif', 'answer', 'climax', 'cadence'], 'PAC')] };
  }
  const antecedent: Role[] = ['motif', 'answer', 'intensify', 'cadence'];
  const consequent: Role[] = ['return', 'climax', 'precadence', 'cadence'];
  if (barCount === 8) {
    if (ctx.rng.chance(0.45)) {
      // Sentence: an idea, its sequence, then intensification to the climax and cadence.
      echoes.set(2, { source: 0, exact: false, ornate: false });
      echoes.set(3, { source: 1, exact: false, ornate: false });
      return {
        kind: 'sentence',
        barCount,
        climaxBar: 5,
        echoes,
        phrases: [phrase(0, ['motif', 'answer', 'sequence', 'sequenceAnswer', 'intensify', 'climax', 'precadence', 'cadence'], 'PAC')],
      };
    }
    // Period: the motif is sequenced in the third bar; the answer returns to the opening —
    // decorated, as Chopin's returns always are.
    echoes.set(2, { source: 0, exact: false, ornate: false });
    echoes.set(4, { source: 0, exact: true, ornate: ctx.grade >= 2 });
    return {
      kind: 'period',
      barCount,
      climaxBar: 5,
      echoes,
      phrases: [phrase(0, antecedent, 'HC'), phrase(4, consequent, 'PAC', { returns: true })],
    };
  }
  // A–B–A′: the motif sequenced, then turned upside down to open the middle section (and
  // sequenced there), then the return, ornamented.
  echoes.set(2, { source: 0, exact: false, ornate: false });
  echoes.set(4, { source: 0, exact: false, ornate: false, invert: true });
  echoes.set(5, { source: 4, exact: false, ornate: false });
  echoes.set(8, { source: 0, exact: true, ornate: true });
  return {
    kind: 'ternary',
    barCount,
    climaxBar: 9,
    echoes,
    phrases: [
      phrase(0, antecedent, 'HC'),
      phrase(4, ['contrast', 'contrastSeq', 'intensify', 'cadence'], 'HC', { contrast: true }),
      phrase(8, consequent, 'PAC', { returns: true }),
    ],
  };
}
