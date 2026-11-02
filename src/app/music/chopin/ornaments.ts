/**
 * Ornaments: grace notes, turns and the cadential trill, by grade.
 */
import { isChromatic, pcAbove, pcOf } from '../pitch-class';
import { LETTERS, Pitch, diatonicIndex } from '../theory';
import { Ctx } from './context';
import { Melody } from './elaboration';
import { Form } from './form';
import { Frame } from './frame';

export function ornament(ctx: Ctx, form: Form, melody: Melody, frame: Frame): void {
  const { grade, rng, ch, character } = ctx;
  const { slots } = melody.structure;
  const climaxD = melody.structure.climaxD;
  const graceQuota = grade >= 5 ? 3 : grade >= 4 ? 2 : grade >= 3 && character === 'mazurka' ? 1 : 0;
  let graces = 0;
  const flat = melody.notes.flatMap((bar, b) => bar.map((note, i) => ({ note, b, i, m: melody.meta[b][i] })));
  const chordAt = (slot: number) => slots[slot].chord;
  const neighbourAbove = (d: number, slot: number): Pitch => frame.spellings(d + 1, chordAt(slot))[0].pitch;
  const neighbourBelow = (d: number, slot: number): Pitch => {
    const options = frame.spellings(d - 1, chordAt(slot));
    // Below the tonic (or any note a semitone up), the leading note.
    return options[options.length - 1].pitch;
  };

  // Grace notes: on a main note reached by an upward leap, or on the climax.
  for (let k = 1; k < flat.length && graces < graceQuota; k++) {
    const { note, m, b } = flat[k];
    const prev = flat[k - 1];
    if (m.kind !== 'main' || note.tie || prev.note.tie || b === form.barCount - 1) continue;
    const leapUp = m.d - prev.m.d >= 3;
    const isClimax = melody.climax.bar === b && melody.climax.index === flat[k].i;
    if (!leapUp && !isClimax) continue;
    if (!rng.chance(0.55 * ch.ornament)) continue;
    // A semitone below (chromatic, Chopin's favourite), unless it would clash with the harmony.
    const pc = pcAbove(pcOf(note.pitches[0]), -1, -1);
    const chord = chordAt(m.slot);
    const below: Pitch = { letter: LETTERS[pc.l], alter: pc.a, octave: note.pitches[0].octave - (pc.l === 6 && note.pitches[0].letter === 'C' ? 1 : 0) };
    const usable =
      Math.abs(pc.a) <= 1 && !chord.tones.some((t) => t.l === pc.l && t.a !== pc.a) && (ctx.cons?.accidentals !== false || !isChromatic(ctx.hkey, pc));
    if (!usable && isClimax) continue;
    note.grace = [usable ? below : neighbourAbove(m.d, m.slot)];
    graces++;
  }

  if (grade < 5) return;
  // A turn on a long note that moves on by step (once).
  for (const { note, m, b, i } of flat) {
    if (m.kind !== 'main' || note.ticks < 6 || note.grace || note.tie || b === form.barCount - 1) continue;
    const next = melody.notes[b][i + 1] ?? melody.notes[b + 1]?.[0];
    if (!next || Math.abs(diatonicIndex(next.pitches[0]) - diatonicIndex(note.pitches[0])) !== 1) continue;
    if (climaxD !== null && m.d + 1 >= climaxD) continue;
    if (!rng.chance(0.5 * ch.ornament)) continue;
    note.ornament = { type: 'turn', upper: neighbourAbove(m.d, m.slot), lower: neighbourBelow(m.d, m.slot) };
    break;
  }
  // The cadential trill: on the note over the final dominant, when it is long enough.
  const lastBar = form.barCount - 1;
  const before = melody.notes[lastBar - 1];
  const lastNote = before[before.length - 1];
  const lastMeta = melody.meta[lastBar - 1][before.length - 1];
  if (lastNote.ticks >= 4 && !lastNote.ornament && !lastNote.tie && chordAt(lastMeta.slot).fn === 'D' && rng.chance(0.5)) {
    if (climaxD === null || lastMeta.d + 1 < climaxD) lastNote.ornament = { type: 'trill', upper: neighbourAbove(lastMeta.d, lastMeta.slot) };
  }
}
