/**
 * Validation: a finished piece checked against its grade before it is shown. The generators
 * aim at the grade; this is the inspector that makes sure they hit it. A piece that fails is
 * regenerated (generator.ts), never displayed.
 *
 * Checked: the key and metre (the grade's and the form's); whole bars in every hand and voice
 * (an upbeat and the bar that completes it are part-bars); note and rest values; chord sizes
 * in each hand; accidentals (chromatic notes from Grade 4; the minor key's raised 6th and 7th
 * at any grade); length; melodic leaps (as written, under any 8va); five-finger positions and
 * hands played separately where the grade asks; and every notation element — triplets, clef
 * changes, pedals, 8va, una corda, spread chords, ornaments, pauses, tenuto, ties, tempo words,
 * dynamics — only from the grade that introduces it.
 */
import { GenerationConstraints, constraintsOf, effectiveSpec } from './constraints';
import { snapTicks, totalTicks } from './durations';
import { FORMS, formAvailable } from './forms';
import { GradeSpec } from './grades';
import type { Bar, Note, Piece, Settings } from './model';
import { LETTERS, Pitch, diatonicIndex, keySignatureAlter, midi, mod } from './theory';

const EPS = 1e-6;

/** Problems with a piece for its settings' grade (empty: the piece is fit to show). */
export function validatePiece(piece: Piece, settings: Settings): string[] {
  const cons = constraintsOf(settings);
  const spec = effectiveSpec(settings.grade, cons);
  const out: string[] = [];
  const fail = (msg: string) => out.length < 12 && out.push(msg);
  const f = spec.features;
  const allow = {
    ties: cons ? cons.ties || f.ties : f.ties,
    ornaments: cons ? cons.ornaments && (f.ornaments || !!settings.custom?.advanced) : f.ornaments,
    triplets: cons ? cons.triplets : f.triplets,
  };
  const chorale = !!piece.bars[0]?.voices;
  const B = piece.time.barTicks;

  // Key, metre, form.
  if (!spec.keys.includes(piece.key.id) && !settings.keyId) fail(`key ${piece.key.id} is not in Grade ${settings.grade}`);
  if (!FORMS[piece.form].times.includes(piece.time.id)) fail(`a ${FORMS[piece.form].name} is not written in ${piece.time.id}`);
  const times = cons?.times ?? spec.times;
  if (!settings.timeId && !times.includes(piece.time.id) && FORMS[piece.form].times.some((t) => times.includes(t))) fail(`${piece.time.id} is not in Grade ${settings.grade}`);
  if (!formAvailable(piece.form, settings.grade)) fail(`a ${FORMS[piece.form].name} is not offered at Grade ${settings.grade}`);

  // Length (approximate, as the syllabus is): the bars beyond an upbeat bar.
  const body = piece.bars.length - (piece.upbeat || chorale ? 1 : 0);
  const [min, max] = [Math.min(...spec.bars), Math.max(...spec.bars)];
  if (body < Math.floor(min * 0.75) || body > Math.ceil(max * 1.25)) fail(`${body} bars (Grade ${settings.grade}: about ${min}–${max})`);

  // Whole bars.
  const expected = (b: number) => (chorale ? null : !piece.upbeat ? B : b === 0 ? piece.upbeat : b === piece.bars.length - 1 ? B - piece.upbeat : B);
  piece.bars.forEach((bar, b) => {
    const len = expected(b);
    const voices = voicesOf(bar);
    const ref = len ?? snapTicks(totalTicks(voices[0]));
    voices.forEach((v, k) => {
      if (!v.length && chorale) return;
      if (Math.abs(totalTicks(v) - ref) > EPS) fail(`bar ${b + 1} voice ${k + 1} has ${totalTicks(v)} ticks, not ${ref}`);
    });
  });

  // Note and rest values; chords; notation elements.
  const durations = cons?.noteTicks ?? spec.durations;
  const rests = cons?.restTicks ?? spec.rests;
  const advanced = !!settings.custom?.advanced;
  piece.bars.forEach((bar, b) => {
    if (bar.lhClef && !f.clefChanges) fail(`bar ${b + 1}: a clef change before Grade 6`);
    const hands: [string, Note[]][] = chorale ? [['soprano', bar.voices!.s], ['alto', bar.voices!.a], ['tenor', bar.voices!.t], ['bass', bar.voices!.b]] : [['rh', bar.rh], ['lh', bar.lh]];
    for (const [name, notes] of hands) {
      for (const n of notes) {
        if (n.rest) {
          if (!rests.includes(n.ticks) && !chorale && !advanced) fail(`bar ${b + 1} ${name}: a rest of ${n.ticks}`);
          continue;
        }
        if (n.triplet) {
          if (!allow.triplets) fail(`bar ${b + 1} ${name}: a triplet before Grade 6`);
          if (Math.abs(n.ticks - 4 / 3) > EPS) fail(`bar ${b + 1} ${name}: a triplet of ${n.ticks}`);
        } else if (!durations.includes(n.ticks) && !advanced) fail(`bar ${b + 1} ${name}: a note of ${n.ticks} ticks`);
        if (n.pitches.length > f.chordNotes && !chorale) fail(`bar ${b + 1} ${name}: a ${n.pitches.length}-note chord`);
        const span = n.pitches.length > 1 ? midi(n.pitches[n.pitches.length - 1]) - midi(n.pitches[0]) : 0;
        if (span > 12) fail(`bar ${b + 1} ${name}: a chord wider than an octave`);
        if (n.tie && !allow.ties) fail(`bar ${b + 1} ${name}: a tie before Grade 2`);
        if (n.fermata && !f.fermata) fail(`bar ${b + 1} ${name}: a pause before Grade 4`);
        if (n.articulation && !spec.articulations.includes(n.articulation) && !advanced) fail(`bar ${b + 1} ${name}: ${n.articulation}`);
        if ((n.grace?.length || n.ornament) && !allow.ornaments) fail(`bar ${b + 1} ${name}: an ornament before Grade 8`);
        if (n.spread && !f.spreadChords) fail(`bar ${b + 1} ${name}: a spread chord before Grade 8`);
        for (const p of n.pitches) if (!accidentalAllowed(piece, spec, p, n)) fail(`bar ${b + 1} ${name}: ${p.letter}${p.alter > 0 ? '#' : p.alter < 0 ? 'b' : ''} outside the key`);
      }
    }
  });
  if (chorale && !f.fourPart && piece.bars.some((bar) => bar.voices!.t.length)) fail('four-part writing before Grade 5');

  // Expression.
  const e = piece.expression;
  if (e) {
    for (const d of e.dynamics) if (!spec.dynamics.includes(d.mark)) fail(`${d.mark} before its grade`);
    if (e.pedals?.length && !f.sustainPedal) fail('pedalling before Grade 6');
    if (e.ottavas?.length && !f.ottava) fail('8va before Grade 7');
    if (e.unaCorda?.length && !f.unaCorda) fail('una corda before Grade 7');
    for (const t of e.tempos ?? []) {
      if (t.kind === 'rit' && !f.ritardando) fail('rit. before Grade 5');
      if (t.kind === 'accel' && !f.accelerando) fail('accel. before Grade 8');
      if (t.kind === 'set' && !f.tempoChanges && !f.accelerando) fail('a tempo change before Grade 7');
    }
  }
  if (piece.upbeat && !f.anacrusis) fail('an upbeat before Grade 4');

  // The hands: separately at Grade 1, in five-finger positions at Grades 1–2; leaps within the grade.
  if (!chorale) {
    if (!f.handsTogether && together(piece)) fail('both hands play at once (Grade 1 plays each hand separately)');
    if (f.fiveFinger) {
      for (const hand of ['rh', 'lh'] as const) {
        const ds = piece.bars.flatMap((bar) => bar[hand]).filter((n) => !n.rest).flatMap((n) => n.pitches.map(diatonicIndex));
        if (ds.length && Math.max(...ds) - Math.min(...ds) > 4) fail(`${hand} moves beyond a five-finger position`);
      }
    }
    leaps(piece, spec, cons, fail);
  }
  return out;
}

const voicesOf = (bar: Bar): Note[][] => (bar.voices ? [bar.voices.s, bar.voices.a, bar.voices.t, bar.voices.b] : [bar.rh, bar.lh]);

/**
 * Accidentals the grade allows: the key signature; in a minor key its raised 6th and 7th
 * (the melodic and harmonic minor — "occasional accidentals within minor keys", Grade 1); and
 * from Grade 4 any chromatic note.
 */
function accidentalAllowed(piece: Piece, spec: GradeSpec, p: Pitch, n: Note): boolean {
  const sig = keySignatureAlter(piece.key, p.letter);
  if (p.alter === sig) return true;
  const degree = mod(LETTERS.indexOf(p.letter) - LETTERS.indexOf(piece.key.tonic), 7);
  if (piece.mode === 'minor' && (degree === 6 || degree === 5) && p.alter === sig + 1) return true;
  return spec.chromatic || (n.chromatic === true && spec.chromatic);
}

/** Whether the hands ever sound at the same moment. */
function together(piece: Piece): boolean {
  let start = 0;
  for (const bar of piece.bars) {
    const spans = (notes: Note[]) => {
      let t = start;
      return notes.map((n) => {
        const s = [t, t + n.ticks, n.rest ? 0 : 1] as const;
        t += n.ticks;
        return s;
      });
    };
    const rh = spans(bar.rh).filter(([, , on]) => on);
    const lh = spans(bar.lh).filter(([, , on]) => on);
    if (rh.some(([a, z]) => lh.some(([c, d]) => a < d - EPS && c < z - EPS))) return true;
    start += totalTicks(bar.rh);
  }
  return false;
}

/**
 * Leaps as the reader sees them (an 8va passage as written): the melody's top line within the
 * grade's largest leap, the left hand's bass within its own (Galant and Baroque bass lines; a
 * Romantic accompaniment's broken chords are hand shapes, not leaps). A rest starts afresh.
 */
function leaps(piece: Piece, spec: GradeSpec, cons: GenerationConstraints | null, fail: (m: string) => void): void {
  const ottava = new Set<string>();
  for (const o of piece.expression?.ottavas ?? []) {
    for (let b = o.from.bar; b <= o.to.bar; b++) {
      piece.bars[b].rh.forEach((_, i) => {
        const after = b > o.from.bar || i >= o.from.index;
        const before = b < o.to.bar || i <= o.to.index;
        if (after && before) ottava.add(`${b}:${i}`);
      });
    }
  }
  const romantic = piece.form === 'nocturne' || piece.form === 'prelude';
  for (const hand of romantic ? (['rh'] as const) : (['rh', 'lh'] as const)) {
    const limit = hand === 'rh' ? (cons?.maxLeap ?? spec.maxLeap) : (cons?.bassMaxLeap ?? spec.maxBassLeap);
    let prev: number | null = null;
    piece.bars.forEach((bar, b) =>
      bar[hand].forEach((n, i) => {
        if (n.rest) {
          prev = null;
          return;
        }
        const p = hand === 'rh' ? n.pitches[n.pitches.length - 1] : n.pitches[0];
        const d = diatonicIndex(p) - (hand === 'rh' && ottava.has(`${b}:${i}`) ? 7 : 0);
        if (prev !== null && Math.abs(d - prev) > limit) fail(`bar ${b + 1} ${hand}: a leap of ${Math.abs(d - prev)} steps`);
        prev = d;
      }),
    );
  }
}
