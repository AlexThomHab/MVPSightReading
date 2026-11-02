/**
 * Expression: dynamics, hairpins shaped to the climax, slurs and accents.
 */
import type { DynamicMark, Expression, NoteRef } from '../model';
import { Ctx } from './context';
import { Melody } from './elaboration';
import { Form } from './form';

const LEVELS: DynamicMark[] = ['pp', 'p', 'mp', 'mf', 'f'];

const softer = (m: DynamicMark, by = 1) => LEVELS[Math.max(0, LEVELS.indexOf(m) - by)];

export function express(ctx: Ctx, form: Form, melody: Melody): Expression {
  const { ch, grade, character, time } = ctx;
  const notes = melody.notes;
  const lastBar = notes.length - 1;
  const ref = (bar: number, index: number): NoteRef => ({ bar, index });
  const lastOf = (bar: number) => ref(bar, notes[bar].length - 1);
  const before = (r: NoteRef): NoteRef => (r.index > 0 ? ref(r.bar, r.index - 1) : lastOf(r.bar - 1));
  const after = (r: NoteRef): NoteRef => (r.index < notes[r.bar].length - 1 ? ref(r.bar, r.index + 1) : ref(r.bar + 1, 0));

  const dynamics: Expression['dynamics'] = [{ at: ref(0, 0), mark: ch.start }];
  const hairpins: Expression['hairpins'] = [];
  const slurs: Expression['slurs'] = [];
  // The expressive peak is the climax, unless that fell on the opening: then the planned bar.
  const climax = melody.climax.bar > 0 ? melody.climax : ref(Math.min(form.climaxBar, lastBar - 1), 0);

  const contrast = form.phrases.find((p) => p.contrast);
  if (contrast && grade >= 2) dynamics.push({ at: ref(contrast.start, 0), mark: 'mf' });
  const ret = form.phrases.find((p) => p.returns);
  if (ret && contrast) dynamics.push({ at: ref(ret.start, 0), mark: ch.start });

  // Swell to the climax and fade to the close.
  const climaxPhrase = form.phrases.find((p) => climax.bar >= p.start && climax.bar < p.start + p.roles.length)!;
  const swellFrom = climax.bar - climaxPhrase.start >= 2 ? ref(climax.bar - 2, 0) : ref(climaxPhrase.start, 0);
  if (validRange(swellFrom, before(climax))) hairpins.push({ from: swellFrom, to: before(climax), type: 'cresc' });
  const climaxMark = grade <= 2 ? LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(ch.start) + 2)] : ch.climax;
  dynamics.push({ at: climax, mark: climaxMark });
  const fadeFrom = after(climax);
  if (fadeFrom.bar < lastBar || (fadeFrom.bar === lastBar && fadeFrom.index < notes[lastBar].length - 1)) {
    hairpins.push({ from: fadeFrom, to: lastOf(lastBar), type: 'dim' });
  }
  // Earlier phrases breathe too (from Grade 3).
  if (grade >= 3) {
    for (const p of form.phrases) {
      if (p === climaxPhrase) continue;
      const mid = p.start + 1;
      if (notes[mid].length > 1) hairpins.push({ from: ref(p.start, 0), to: lastOf(mid), type: 'cresc' });
      const end = p.start + p.roles.length - 1;
      if (end > mid + 1) hairpins.push({ from: ref(mid + 1, 0), to: lastOf(end), type: 'dim' });
    }
  }
  if (!hairpins.some((h) => h.type === 'cresc')) {
    const to = notes[1] ? lastOf(1) : lastOf(0);
    if (validRange(ref(0, 0), to)) hairpins.unshift({ from: ref(0, 0), to, type: 'cresc' });
  }
  if (grade >= 3) dynamics.push({ at: lastOf(lastBar), mark: softer(ch.start) === ch.start ? 'pp' : softer(ch.start) });

  // Articulation: appoggiaturas lean (Grade 3+), the climax is held (Grade 2+), and a
  // mazurka's accent falls on the second or third beat.
  for (const r of melody.appoggiaturas) if (grade >= 3) notes[r.bar][r.index].articulation = 'accent';
  if (grade >= 2) notes[climax.bar][climax.index].articulation = 'tenuto';
  if (character === 'mazurka') {
    const accentBeat = ctx.rng.chance(0.5) ? 1 : 2;
    notes.forEach((bar, b) => {
      if (b === lastBar || b % 2 === 1) return;
      let t = 0;
      for (const n of bar) {
        if (t === accentBeat * time.beatTicks && !n.articulation && !n.tie) n.articulation = 'accent';
        t += n.ticks;
      }
    });
  }

  // Slurs: legato over each two-bar unit, broken where a suspension's tie would collide.
  for (let b = 0; b < notes.length; b += 2) {
    const endBar = Math.min(b + 1, lastBar);
    const from = ref(b, 0);
    const to = lastOf(endBar);
    if (from.bar === to.bar && to.index === 0) continue;
    slurs.push({ from, to });
  }

  const seen = new Set<number>();
  const tidyHairpins = hairpins.filter((h) => validRange(h.from, h.to) && !seen.has(h.from.bar) && seen.add(h.from.bar));
  const tidyDynamics = grade <= 1 ? dynamics.slice(0, 2) : dynamics;
  return { dynamics: dedupe(tidyDynamics), hairpins: tidyHairpins, slurs: slurs.filter((s) => validRange(s.from, s.to)) };
}

const validRange = (a: NoteRef, b: NoteRef) => a.bar < b.bar || (a.bar === b.bar && a.index < b.index);

function dedupe(d: Expression['dynamics']): Expression['dynamics'] {
  const out: Expression['dynamics'] = [];
  for (const x of d) {
    const same = out.find((y) => y.at.bar === x.at.bar && y.at.index === x.at.index);
    if (same) same.mark = x.mark;
    else if (!out.length || out[out.length - 1].mark !== x.mark) out.push(x);
  }
  return out;
}
