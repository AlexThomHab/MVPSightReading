/**
 * Rhythm for the Chopin style: rhythm cells weighted by the character's taste.
 */
import { cellUnit, fillWithCells, rhythmPreferences } from '../rhythm';
import { Ctx } from './context';

function fillUnits(ctx: Ctx, startPos: number, endPos: number): number[] {
  return fillWithCells(ctx.rng, ctx.time, ctx.grade, ctx.spec.durations, startPos, endPos, (c) => ctx.ch.cellWeights[c.name] ?? 0.5, rhythmPreferences(ctx.cons));
}

/** Distinct rhythms for a span, with how often the character's cells produce each. */
export function spanRhythms(ctx: Ctx, onset: number, ticks: number): { r: number[]; count: number }[] {
  const unit = cellUnit(ctx.time);
  const a = onset / unit;
  const b = (onset + ticks) / unit;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return [{ r: [ticks], count: 1 }];
  const seen = new Map<string, { r: number[]; count: number }>();
  for (let i = 0; i < 28; i++) {
    const r = fillUnits(ctx, a, b);
    const k = r.join('-');
    const e = seen.get(k);
    if (e) e.count++;
    else seen.set(k, { r, count: 1 });
  }
  return [...seen.values()];
}
