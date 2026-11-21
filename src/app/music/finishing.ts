/**
 * Finishing: the syllabus's elements that are not a matter of composition, written into a
 * generated piece according to its grade (grades.ts). The generators compose (melody, harmony,
 * texture, form); this pass makes the piece read like an exam-board test of its grade:
 *
 *   Grade 1  each hand on its own (a line passed between the hands); dynamics, hairpins,
 *            slurs, breath rests
 *   Grade 3  two-note chords in the right hand
 *   Grade 4  an upbeat start; pause signs; tenuto
 *   Grade 5  four-part final chords (two notes a hand); rit. at the end
 *   Grade 6  triplets; the left hand in the treble clef for a passage; the right pedal
 *   Grade 7  tempo changes; 8va; una corda
 *   Grade 8  three-note chords; spread chords; simple ornaments; accel.
 *
 * Each element is a possibility, not a requirement: a grade allows it, and a piece uses it
 * now and then (more often as the grade rises), as real tests do. Everything is drawn from the
 * piece's own seed, so the same settings always finish the same way. The customisation's
 * switches (dynamics off, no ornaments…) are applied afterwards (customise.ts).
 */
import { GenerationConstraints, effectiveSpec, constraintsOf, pitchWindow } from './constraints';
import { starts, totalTicks } from './durations';
import { GradeSpec, TimeSignature } from './grades';
import type { Bar, DynamicMark, Expression, Note, NoteRef, Piece, Settings } from './model';
import { Random } from './random';
import { restsFor } from './rests';
import { TRIPLET_QUAVER } from './rhythm';
import { Key, LETTERS, Pitch, diatonicIndex, isSingableInterval, keySignatureAlter, midi, mod, naturalAt } from './theory';

export function finish(piece: Piece, settings: Settings): Piece {
  const cons = constraintsOf(settings);
  const spec = effectiveSpec(settings.grade, cons);
  const rng = new Random(`${settings.seed}|finish|${settings.grade}|${settings.form}`);
  const ctx: FCtx = { piece, spec, cons, rng, key: piece.key, time: piece.time, rests: cons?.restTicks ?? spec.rests };
  const chorale = !!piece.bars[0].voices;
  const counterpoint = piece.form === 'invention' || piece.form === 'fugue';
  const romantic = piece.form === 'nocturne' || piece.form === 'prelude';
  const f = spec.features;

  tidyToGrade(ctx);
  if (!chorale) {
    writeableLengths(ctx);
    if (!f.handsTogether && !counterpoint) handsSeparately(ctx);
    // (Counterpoint runs on without breathing, and its voices were checked against each other
    // as written: new notes in one would make sonorities nobody checked.)
    if (!counterpoint) breathRests(ctx);
    if (f.chordNotes >= 2 && !counterpoint) rightHandChords(ctx, f.chordNotes, 0.06 + 0.3 * spec.complexity.harmonic);
    if (f.fourPart || f.chordNotes >= 3) finalChord(ctx, f.chordNotes);
    if (f.triplets && (!cons || cons.triplets) && !counterpoint) triplets(ctx);
  }
  expression(ctx, romantic);
  if (!chorale) {
    if (f.fermata && rng.chance(0.4)) pause(ctx);
    if (f.anacrusis && piece.form !== 'gavotte' && !counterpoint && !piece.upbeat && rng.chance(0.35)) anacrusis(ctx);
    // (A customised left-hand range is kept: no passage lifted out of it.)
    if (f.clefChanges) clefs(ctx, !cons?.bassRange && rng.chance(romantic ? 0.6 : 0.45));
    if (f.sustainPedal && !counterpoint && rng.chance(romantic ? 0.9 : 0.3)) pedal(ctx, romantic);
    // (8va raises the sound beyond a customised range and its leaps: not in customised pieces.)
    if (f.ottava && !counterpoint && !cons && rng.chance(0.45)) ottava(ctx);
    if (f.unaCorda && rng.chance(romantic ? 0.6 : 0.3)) unaCorda(ctx);
    if (f.spreadChords && rng.chance(0.65)) spread(ctx);
    if (f.ornaments && !romantic && (!cons || cons.ornaments) && rng.chance(0.75)) cadentialTrill(ctx);
  }
  tempo(ctx);
  return piece;
}

interface FCtx {
  piece: Piece;
  spec: GradeSpec;
  cons: GenerationConstraints | null;
  rng: Random;
  key: Key;
  time: TimeSignature;
  /** The rest values the grade (or customisation) writes. */
  rests: readonly number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ensureExpression = (piece: Piece): Expression => (piece.expression ??= { dynamics: [], hairpins: [], slurs: [] });

/** The note of a voice sounding at tick `t` of its bar, and its index. */
function noteAt(notes: Note[], t: number): { note: Note; index: number; at: number } | null {
  const at = starts(notes.map((n) => n.ticks));
  for (let i = notes.length - 1; i >= 0; i--) if (at[i] <= t + 1e-6) return t < at[i] + notes[i].ticks - 1e-6 ? { note: notes[i], index: i, at: at[i] } : null;
  return null;
}

/** Scale degree (0–6) of a pitch's letter in the key. */
const degreeOf = (key: Key, p: Pitch) => mod(LETTERS.indexOf(p.letter) - LETTERS.indexOf(key.tonic), 7);

/** The pitch `steps` scale steps from `p`, spelled by the key signature (the minor leading note raised when asked). */
function step(key: Key, p: Pitch, steps: number, raiseLeading = false): Pitch {
  const n = naturalAt(diatonicIndex(p) + steps);
  const leading = key.mode === 'minor' && degreeOf(key, n) === 6 && raiseLeading;
  return { ...n, alter: keySignatureAlter(key, n.letter) + (leading ? 1 : 0) };
}

const octave = (p: Pitch, by: number): Pitch => ({ ...p, octave: p.octave + by });

/**
 * Bars whose notes must stay exactly as composed: the opening two bars and their repeats, and
 * a sequence's model and copies — later bars copy them note for note.
 */
function copiedBars(piece: Piece): Set<number> {
  const out = new Set<number>([0, 1]);
  for (const p of piece.phrases) {
    if (p.sequence) range(p.startBar, p.startBar + 4).forEach((b) => out.add(b));
    if (p.repeatsOpening) [p.startBar, p.startBar + 1].forEach((b) => out.add(b));
    // A Baroque episode is a sequence too.
    if (p.section === 'Episode') range(p.startBar, p.startBar + p.bars).forEach((b) => out.add(b));
  }
  return out;
}

/** The phrases as bar ranges [start, end) (one phrase: the whole piece). */
function phraseRanges(piece: Piece): [number, number][] {
  const n = piece.bars.length;
  const ps = piece.phrases.length ? piece.phrases : [{ startBar: 0, bars: n }];
  return ps.map((p, i) => [p.startBar, i === ps.length - 1 ? n : Math.min(n, ps[i + 1].startBar)] as [number, number]).filter(([a, b]) => b > a);
}

/** A right-hand note reference for the first sounding note at or after a bar. */
function firstNoteRef(piece: Piece, bar: number): NoteRef | null {
  for (let b = bar; b < piece.bars.length; b++) {
    const i = piece.bars[b].rh.findIndex((n) => !n.rest);
    if (i >= 0) return { bar: b, index: i };
  }
  return null;
}

/** The last sounding right-hand note before a bar (exclusive). */
function lastNoteRef(piece: Piece, before: number): NoteRef | null {
  for (let b = before - 1; b >= 0; b--) {
    const rh = piece.bars[b].rh;
    for (let i = rh.length - 1; i >= 0; i--) if (!rh[i].rest) return { bar: b, index: i };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Within the grade: marks a generator may write that the grade does not have yet
// ---------------------------------------------------------------------------

function tidyToGrade(ctx: FCtx): void {
  const { piece, spec } = ctx;
  const f = spec.features;
  for (const bar of piece.bars) {
    const all = bar.voices ? [bar.voices.s, bar.voices.a, bar.voices.t, bar.voices.b] : [bar.rh, bar.lh];
    for (const notes of all) {
      for (const n of notes) {
        if (n.fermata && !f.fermata) delete n.fermata;
        if (n.articulation && !spec.articulations.includes(n.articulation)) delete n.articulation;
        if (!f.ornaments) {
          delete n.grace;
          delete n.ornament;
        }
      }
    }
  }
  const e = piece.expression;
  if (e) {
    const allowed = spec.dynamics;
    const LEVELS: DynamicMark[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
    // A mark beyond the grade becomes the nearest the grade has (ff → f before Grade 5).
    const nearest = (m: DynamicMark) => [...allowed].sort((a, b) => Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(m)) - Math.abs(LEVELS.indexOf(b) - LEVELS.indexOf(m)))[0];
    e.dynamics = e.dynamics.map((d) => (allowed.includes(d.mark) ? d : { ...d, mark: nearest(d.mark) }));
    if (!spec.hairpins) e.hairpins = [];
    if (!spec.slurs) e.slurs = [];
  }
}

/**
 * Every note in a value the grade writes: a length with no single value (a whole bar of 7/4,
 * 28 ticks) becomes tied notes — or, before ties (Grade 2), the note and then rests.
 */
function writeableLengths(ctx: FCtx): void {
  const { piece, rests } = ctx;
  const durations = [...(ctx.cons?.noteTicks ?? ctx.spec.durations)].sort((a, b) => b - a);
  const ties = ctx.cons ? ctx.cons.ties : ctx.spec.features.ties;
  piece.bars.forEach((bar, b) => {
    for (const hand of ['rh', 'lh'] as const) {
      for (let i = bar[hand].length - 1; i >= 0; i--) {
        const n = bar[hand][i];
        if (n.triplet || (n.rest ? rests : durations).includes(n.ticks)) continue;
        const parts: number[] = [];
        let left = n.ticks;
        const values = n.rest ? [...rests].sort((x, y) => y - x) : durations;
        while (left > 1e-6) {
          const d = values.find((x) => x <= left + 1e-6);
          if (!d) break;
          parts.push(d);
          left -= d;
        }
        if (left > 1e-6 || parts.length < 2) continue;
        let replaced: Note[];
        if (n.rest) replaced = parts.map((t) => ({ pitches: [], ticks: t, rest: true }));
        else if (ties) replaced = parts.map((t, k) => ({ ...n, ticks: t, tie: k < parts.length - 1 ? true : n.tie, ...(k > 0 ? { ornament: undefined, grace: undefined, articulation: undefined } : {}) }));
        else {
          const tail = restsFor(n.ticks - parts[0], rests);
          if (!tail) continue;
          replaced = [{ ...n, ticks: parts[0] }, ...tail.map((t) => ({ pitches: [], ticks: t, rest: true }))];
        }
        bar[hand].splice(i, 1, ...replaced.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as Note));
        if (hand === 'rh') shiftRefs(piece, b, i + 1, replaced.length - 1);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Grade 1: each hand on its own
// ---------------------------------------------------------------------------

/**
 * The syllabus's Grade 1 plays each hand separately: the melody is passed between the hands.
 * The accompaniment goes; the melody stays in the right hand, except for a phrase (or, in a
 * four-bar piece, its third bar) taken by the left hand an octave or two lower, in its own
 * five-finger position — the other hand resting.
 */
function handsSeparately(ctx: FCtx): void {
  const { piece, spec, cons, key, rests } = ctx;
  const lhWin = pitchWindow(key, spec.lhRange, { letter: 'E', alter: 0, octave: 2 }, { letter: 'D', alter: 0, octave: 4 }, cons?.bassRange ?? null);
  const restBar = (ticks: number): Note[] => (restsFor(ticks, rests) ?? [ticks]).map((t) => ({ pitches: [], ticks: t, rest: true }));
  const n = piece.bars.length;
  // The left hand's bars: the third bar of four, or the second phrase of a longer piece.
  const lhBars = new Set<number>(n <= 4 ? [2] : phraseRanges(piece).length > 1 ? range(...phraseRanges(piece)[1]) : [Math.floor(n / 2)]);
  // Never the last bar: the piece ends in the right hand.
  lhBars.delete(n - 1);
  const lo = lhWin ? diatonicIndex({ letter: key.tonic, alter: 0, octave: lhWin.tonicOctave }) + lhWin.lo : 0;
  const hi = lhWin ? diatonicIndex({ letter: key.tonic, alter: 0, octave: lhWin.tonicOctave }) + lhWin.hi : 0;
  const melodyIn = [...lhBars].flatMap((b) => piece.bars[b].rh.filter((x) => !x.rest).map((x) => diatonicIndex(x.pitches[0])));
  // Down one or two octaves, whichever puts every note in the left hand's position.
  const shift = [-7, -14].find((s) => lhWin && melodyIn.every((d) => d + s >= lo && d + s <= hi));
  piece.bars.forEach((bar, b) => {
    const length = totalTicks(bar.rh);
    if (shift !== undefined && lhBars.has(b)) {
      bar.lh = bar.rh.map((x) => (x.rest ? { ...x } : { ...x, pitches: x.pitches.map((p) => octave(p, shift / 7)) }));
      bar.rh = restBar(length);
    } else {
      bar.lh = restBar(length);
    }
  });
  if (piece.expression) piece.expression.slurs = [];
}

function range(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
}

// ---------------------------------------------------------------------------
// Rests: a breath at the end of a phrase
// ---------------------------------------------------------------------------

/**
 * A breath at the end of some phrases: the phrase's last right-hand note shortened, a rest
 * after it — in rest values the grade writes (crotchet and minim rests at Grade 1, quaver rests
 * from Grade 3).
 */
function breathRests(ctx: FCtx): void {
  const { piece, rests, rng, time } = ctx;
  const durations = ctx.cons?.noteTicks ?? ctx.spec.durations;
  if (!rests.length) return;
  const ranges = phraseRanges(piece);
  ranges.slice(0, -1).forEach(([, end]) => {
    const bar = piece.bars[end - 1];
    if (!bar || !rng.chance(0.6)) return;
    const last = bar.rh[bar.rh.length - 1];
    if (!last || last.rest || last.tie || last.ornament || last.triplet) return;
    const at = totalTicks(bar.rh) - last.ticks;
    // The longest rest that leaves a note value the grade has, the rest starting on a beat.
    const r = [...rests].sort((a, b) => b - a).find((x) => x < last.ticks && durations.includes(last.ticks - x) && (at + last.ticks - x) % time.beatTicks === 0);
    if (!r) return;
    last.ticks = last.ticks - r;
    bar.rh.push({ pitches: [], ticks: r, rest: true });
  });
}

// ---------------------------------------------------------------------------
// Chords in the hands
// ---------------------------------------------------------------------------

/** Semitones apart, as an interval class: consonant (3rd, 6th, perfect) or not. */
const consonantWith = (a: Pitch, b: Pitch) => [0, 3, 4, 5, 7, 8, 9].includes(mod(Math.abs(midi(a) - midi(b)), 12)) && midi(a) !== midi(b);
const thirdOrSixth = (a: Pitch, b: Pitch) => [3, 4, 8, 9].includes(mod(Math.abs(midi(a) - midi(b)), 12));

/**
 * Two-note chords in the right hand (Grade 3): a third or sixth below some longer melody
 * notes on the beat — always below the melody, above the left hand, and consonant with it.
 */
function rightHandChords(ctx: FCtx, maxNotes: number, share: number): void {
  const { piece, key, rng, time } = ctx;
  const copied = copiedBars(piece);
  piece.bars.forEach((bar, b) => {
    if (copied.has(b)) return;
    const at = starts(bar.rh.map((n) => n.ticks));
    bar.rh.forEach((n, i) => {
      if (n.rest || n.pitches.length >= maxNotes || n.ticks < time.beatTicks || n.chromatic || n.triplet) return;
      if (at[i] % time.beatTicks !== 0 || !rng.chance(share)) return;
      const top = n.pitches[n.pitches.length - 1];
      const lh = noteAt(bar.lh, at[i])?.note;
      // (Above the left hand, and inside a customised melody range.)
      const lhTop = Math.max(lh && !lh.rest ? Math.max(...lh.pitches.map(midi)) : -Infinity, ctx.cons?.melodyRange ? midi(ctx.cons.melodyRange.low) - 3 : -Infinity);
      for (const steps of rng.chance(0.6) ? [-2, -5] : [-5, -2]) {
        const below = step(key, top, steps, top.alter !== keySignatureAlter(key, top.letter));
        if (!thirdOrSixth(below, top) || midi(below) <= lhTop + 2) continue;
        if (lh && !lh.rest && lh.pitches.some((p) => !consonantWith(p, below))) continue;
        n.pitches = [below, ...n.pitches];
        return;
      }
    });
  });
}

/**
 * The final chord in more parts: from Grade 5 two notes in each hand (four-part), at Grade 8
 * three in one hand — the tonic's octave, third or fifth added below the right hand's tonic
 * and above the left hand's.
 */
function finalChord(ctx: FCtx, maxNotes: number): void {
  const { piece, key, rng } = ctx;
  const bar = piece.bars[piece.bars.length - 1];
  const rh = bar.rh.find((n) => !n.rest);
  const lh = bar.lh.find((n) => !n.rest);
  if (!rh || !lh || !rng.chance(0.7)) return;
  const tonicDegree = (p: Pitch) => degreeOf(key, p);
  const third = key.mode === 'minor' && rng.chance(0.35) ? null : 2;
  // Right hand: the third (or fifth) below its top note, then (Grade 8) the fifth.
  const top = rh.pitches[rh.pitches.length - 1];
  const want = maxNotes >= 3 ? [third ?? 4, 4] : [rng.chance(0.5) && third !== null ? third : 4];
  const added: Pitch[] = [];
  for (const deg of want) {
    for (let s = -1; s >= -7; s--) {
      const p = step(key, top, s);
      if (tonicDegree(p) === deg && !rh.pitches.some((x) => midi(x) === midi(p)) && !added.some((x) => midi(x) === midi(p))) {
        added.push(p);
        break;
      }
    }
  }
  const lhTop = Math.max(...lh.pitches.map(midi), ctx.cons?.melodyRange ? midi(ctx.cons.melodyRange.low) - 3 : -Infinity);
  rh.pitches = [...added.filter((p) => midi(p) > lhTop + 2), ...rh.pitches].filter((p, i, list) => list.findIndex((q) => midi(q) === midi(p)) === i).sort((a, c) => midi(a) - midi(c)).slice(-maxNotes);
  // Left hand: the fifth above the bass (a bare fifth, as the final chord's foundation).
  if (lh.pitches.length < Math.min(2, maxNotes)) {
    const bass = lh.pitches[0];
    const fifth = step(key, bass, 4);
    const ceiling = ctx.cons?.bassRange ? midi(ctx.cons.bassRange.high) : Infinity;
    if (midi(fifth) < Math.min(...rh.pitches.map(midi)) - 2 && midi(fifth) <= ceiling) lh.pitches = [bass, fifth];
  }
}

// ---------------------------------------------------------------------------
// Grade 6: triplets
// ---------------------------------------------------------------------------

/**
 * Triplets (Grade 6): now and then a pair of quavers a third apart, on a crotchet beat,
 * becomes three triplet quavers with the passing note between. Left alone: sequences and
 * repeated openings (their copies must stay exact), and the last bar.
 */
function triplets(ctx: FCtx): void {
  const { piece, key, rng, time } = ctx;
  if (time.beatTicks !== 4 || time.compound) return;
  const protectedBars = copiedBars(piece);
  protectedBars.add(piece.bars.length - 1);
  const candidates: { b: number; i: number }[] = [];
  piece.bars.forEach((bar, b) => {
    if (protectedBars.has(b)) return;
    const at = starts(bar.rh.map((n) => n.ticks));
    bar.rh.forEach((n, i) => {
      const next = bar.rh[i + 1];
      if (!next || n.rest || next.rest || n.ticks !== 2 || next.ticks !== 2 || at[i] % 4 !== 0 || n.tie || n.pitches.length > 1 || next.pitches.length > 1) return;
      if (Math.abs(diatonicIndex(next.pitches[0]) - diatonicIndex(n.pitches[0])) === 2) candidates.push({ b, i });
    });
  });
  if (!candidates.length || !rng.chance(0.85)) return;
  const quota = Math.min(candidates.length, 1 + rng.int(0, 2));
  const chosen = rng.weightedOrder(candidates, () => 1).slice(0, quota).sort((x, y) => y.b - x.b || y.i - x.i);
  for (const { b, i } of chosen) {
    const bar = piece.bars[b];
    const [a, c] = [bar.rh[i], bar.rh[i + 1]];
    const dir = Math.sign(diatonicIndex(c.pitches[0]) - diatonicIndex(a.pitches[0]));
    const raise = c.pitches[0].alter !== keySignatureAlter(key, c.pitches[0].letter);
    const mid = step(key, a.pitches[0], dir, raise);
    if (!isSingableInterval(a.pitches[0], mid) || !isSingableInterval(mid, c.pitches[0])) continue;
    const t = TRIPLET_QUAVER;
    bar.rh.splice(i, 2, { ...a, ticks: t, triplet: true }, { pitches: [mid], ticks: t, triplet: true }, { ...c, ticks: t, triplet: true });
    // Marks pointing past the new note move along by one.
    shiftRefs(piece, b, i + 2, 1);
  }
}

/** Right-hand references at or after (bar, index) move by `by` notes. */
function shiftRefs(piece: Piece, bar: number, index: number, by: number): void {
  const e = piece.expression;
  if (!e) return;
  const move = (r: NoteRef) => (r.bar === bar && r.index >= index ? { bar, index: r.index + by } : r);
  e.dynamics = e.dynamics.map((d) => ({ ...d, at: move(d.at) }));
  e.hairpins = e.hairpins.map((h) => ({ ...h, from: move(h.from), to: move(h.to) }));
  e.slurs = e.slurs.map((s) => ({ from: move(s.from), to: move(s.to) }));
  e.tempos = e.tempos?.map((t) => ({ ...t, at: move(t.at) }));
  e.ottavas = e.ottavas?.map((o) => ({ from: move(o.from), to: move(o.to) }));
  e.unaCorda = e.unaCorda?.map((o) => ({ from: move(o.from), to: move(o.to) }));
}

// ---------------------------------------------------------------------------
// Expression: dynamics, hairpins, slurs
// ---------------------------------------------------------------------------

const LOUDNESS: DynamicMark[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];

/**
 * Dynamics, hairpins and slurs for pieces whose generator writes none (Galant, Baroque, the
 * chorale): the form's dynamic to begin, a contrasting one for a contrasting phrase, a swell
 * towards each phrase's highest note and away from it, and slurs over each phrase's legato
 * line (broken at rests). Romantic pieces bring their own; they gain ff at the climax (Grade 5).
 */
function expression(ctx: FCtx, romantic: boolean): void {
  const { piece, spec, rng } = ctx;
  const allowed = spec.dynamics;
  const near = (m: DynamicMark) => (allowed.includes(m) ? m : [...allowed].sort((a, b) => Math.abs(LOUDNESS.indexOf(a) - LOUDNESS.indexOf(m)) - Math.abs(LOUDNESS.indexOf(b) - LOUDNESS.indexOf(m)))[0]);
  if (romantic && piece.expression) {
    if (allowed.includes('ff') && rng.chance(0.4)) {
      const loudest = piece.expression.dynamics.find((d) => d.mark === 'f');
      if (loudest) loudest.mark = 'ff';
    }
    return;
  }
  const e = ensureExpression(piece);
  const start = near((piece.dynamic as DynamicMark) || 'mf');
  const first = firstNoteRef(piece, 0);
  if (first && !e.dynamics.length) e.dynamics.push({ at: first, mark: start });
  piece.dynamic = '';
  const ranges = phraseRanges(piece);
  ranges.forEach(([a, z], k) => {
    // A contrasting phrase: louder or softer; the return: the opening's dynamic again.
    const p = piece.phrases[k];
    const ref = firstNoteRef(piece, a);
    // (Not at every one-bar section of a Baroque piece: a new level for an episode or middle entry.)
    const marks = z - a >= 2 || /Episode|Middle/.test(p?.section ?? '');
    if (k > 0 && ref && ref.bar < z && marks) {
      const contrast = p?.section === 'Episode' || p?.repeatsOpening === false;
      const level = LOUDNESS.indexOf(start) + (contrast ? (rng.chance(0.5) ? 1 : -1) : 0);
      const mark = near(LOUDNESS[Math.max(0, Math.min(LOUDNESS.length - 1, level))]);
      if (mark !== e.dynamics[e.dynamics.length - 1]?.mark && rng.chance(0.55)) e.dynamics.push({ at: ref, mark });
    }
    // A swell to the phrase's highest note, and back (phrases of two bars or more).
    if (spec.hairpins && z - a >= 2 && rng.chance(0.7)) {
      let peak: NoteRef | null = null;
      let high = -Infinity;
      for (let b = a; b < z; b++) piece.bars[b].rh.forEach((n, i) => {
        if (!n.rest && midi(n.pitches[n.pitches.length - 1]) > high) {
          high = midi(n.pitches[n.pitches.length - 1]);
          peak = { bar: b, index: i };
        }
      });
      const from = firstNoteRef(piece, a);
      const to = lastNoteRef(piece, z);
      const pk = peak as NoteRef | null;
      const before = (x: NoteRef, y: NoteRef) => x.bar < y.bar || (x.bar === y.bar && x.index < y.index);
      if (from && to && pk && before(from, pk) && before(pk, to)) {
        e.hairpins.push({ from, to: pk, type: 'cresc' });
        if (rng.chance(0.6)) e.hairpins.push({ from: pk, to, type: 'dim' });
      }
    }
    // Slurs over the legato line, broken at rests (and not over staccato notes).
    if (spec.slurs) {
      let run: NoteRef[] = [];
      const flush = () => {
        if (run.length >= 3) e.slurs.push({ from: run[0], to: run[run.length - 1] });
        run = [];
      };
      for (let b = a; b < z; b++) {
        piece.bars[b].rh.forEach((n, i) => {
          if (n.rest || n.articulation === 'staccato') flush();
          else run.push({ bar: b, index: i });
        });
        // A slur covers at most two bars: phrasing, not a single arc over everything.
        if ((b - a) % 2 === 1) flush();
      }
      flush();
    }
  });
  // Tenuto (Grade 4): a phrase's longest note now and then.
  if (spec.articulations.includes('tenuto')) {
    for (const [a, z] of ranges) {
      if (!rng.chance(0.3)) continue;
      let best: Note | null = null;
      for (let b = a; b < z - 1; b++) if (!copiedBars(piece).has(b)) for (const n of piece.bars[b].rh) if (!n.rest && !n.articulation && (!best || n.ticks > best.ticks)) best = n;
      if (best) best.articulation = 'tenuto';
    }
  }
}

// ---------------------------------------------------------------------------
// Grade 4: a pause; an upbeat start
// ---------------------------------------------------------------------------

/** A pause sign over the final chord (both hands) — or over a half close before the last phrase. */
function pause(ctx: FCtx): void {
  const { piece, rng } = ctx;
  const ranges = phraseRanges(piece);
  const half = piece.phrases.findIndex((p, i) => p.cadence === 'HC' && i === piece.phrases.length - 2);
  const bar = half >= 0 && rng.chance(0.4) ? ranges[half][1] - 1 : piece.bars.length - 1;
  const b = piece.bars[bar];
  for (const notes of [b.rh, b.lh]) {
    const sounding = notes.filter((n) => !n.rest);
    const last = sounding[sounding.length - 1];
    if (last && !last.tie) last.fermata = true;
  }
}

/**
 * An upbeat (Grade 4): a pickup note before the first bar — the dominant below the first
 * note, or the step below it — and the last bar shortened by the same amount, so the piece
 * still adds up to whole bars.
 */
function anacrusis(ctx: FCtx): void {
  const { piece, key, time } = ctx;
  const durations = ctx.cons?.noteTicks ?? ctx.spec.durations;
  const up = time.compound || time.beatTicks === 2 ? 2 : time.beatTicks;
  if (!durations.includes(up) || !restsFor(up, ctx.rests)) return;
  const lastBar = piece.bars[piece.bars.length - 1];
  // Shorten the last bar's final note (or trailing rest) in each hand.
  const shorten = (notes: Note[]): Note[] | null => {
    const out = notes.map((n) => ({ ...n }));
    let left = up;
    for (let i = out.length - 1; i >= 0 && left > 0; i--) {
      const n = out[i];
      if (n.ticks <= left && n.rest) {
        left -= n.ticks;
        out.splice(i, 1);
        continue;
      }
      const remain = n.ticks - left;
      if (remain <= 0 || !(n.rest ? ctx.rests : durations).includes(remain)) return null;
      n.ticks = remain;
      left = 0;
    }
    return left === 0 && out.length ? out : null;
  };
  const rh = shorten(lastBar.rh);
  const lh = shorten(lastBar.lh);
  const first = piece.bars[0].rh.find((n) => !n.rest);
  if (!rh || !lh || !first) return;
  const top = first.pitches[first.pitches.length - 1];
  // The dominant a fourth below (5 → 1), else the step below.
  const pickup = degreeOf(key, top) === 0 ? step(key, top, -3) : step(key, top, -1, key.mode === 'minor' && degreeOf(key, top) === 0);
  if (!isSingableInterval(pickup, top)) return;
  lastBar.rh = rh;
  lastBar.lh = lh;
  const pickupBar: Bar = {
    harmony: [{ symbol: key.mode === 'minor' ? 'V' : 'V', at: 0 }],
    rh: [{ pitches: [pickup], ticks: up }],
    lh: (restsFor(up, ctx.rests) ?? [up]).map((t) => ({ pitches: [], ticks: t, rest: true })),
  };
  piece.bars.unshift(pickupBar);
  piece.upbeat = up;
  piece.phrases = piece.phrases.map((p) => ({ ...p, startBar: p.startBar + 1 }));
  const e = piece.expression;
  if (e) {
    const move = (r: NoteRef) => ({ bar: r.bar + 1, index: r.index });
    e.dynamics = e.dynamics.map((d) => ({ ...d, at: move(d.at) }));
    e.hairpins = e.hairpins.map((h) => ({ ...h, from: move(h.from), to: move(h.to) }));
    e.slurs = e.slurs.map((s) => ({ from: move(s.from), to: move(s.to) }));
    // The opening slur and dynamic begin with the pickup.
    const firstSlur = e.slurs.find((s) => s.from.bar === 1);
    if (firstSlur && firstSlur.from.index === 0) firstSlur.from = { bar: 0, index: 0 };
    const firstDynamic = e.dynamics.find((d) => d.at.bar === 1);
    if (firstDynamic) firstDynamic.at = { bar: 0, index: 0 };
  }
}

// ---------------------------------------------------------------------------
// Grade 6: clef changes, the right pedal
// ---------------------------------------------------------------------------

/**
 * The left hand in the treble clef (Grade 6) wherever a bar of it lies high (all of it at or
 * above G3) — and, when asked, a middle phrase of the left hand taken up an octave to make such
 * a passage, where it stays below the right hand and still moves within the grade's leaps.
 */
function clefs(ctx: FCtx, lift: boolean): void {
  const { piece, spec } = ctx;
  const ranges = phraseRanges(piece);
  if (lift && ranges.length >= 3) {
    const [a, z] = ranges[1 + Math.floor(ctx.rng.next() * (ranges.length - 2))];
    const raised = range(a, z).map((b) => piece.bars[b].lh.map((n) => (n.rest ? n : { ...n, pitches: n.pitches.map((p) => octave(p, 1)) })));
    const clear = range(a, z).every((b, k) => {
      const lh = raised[k];
      const at = starts(lh.map((n) => n.ticks));
      return lh.every((n, i) => {
        if (n.rest) return true;
        const above = noteAt(piece.bars[b].rh, at[i])?.note;
        return !above || above.rest || Math.max(...n.pitches.map(midi)) < Math.min(...above.pitches.map(midi)) - 2;
      });
    });
    const lhLine = (bars: Note[][]) => bars.flat().filter((n) => !n.rest).map((n) => diatonicIndex(n.pitches[0]));
    const before = lhLine(piece.bars.slice(0, a).map((b) => b.lh)).pop();
    const after = lhLine(piece.bars.slice(z).map((b) => b.lh))[0];
    const inside = lhLine(raised);
    const joins = (x: number | undefined, y: number | undefined) => x === undefined || y === undefined || Math.abs(x - y) <= spec.maxBassLeap;
    // (And sings at its joins: no seventh or augmented leap into or out of it.)
    const lhNotes = (bars: Note[][]) => bars.flat().filter((n) => !n.rest).map((n) => n.pitches[0]);
    const pb = lhNotes(piece.bars.slice(0, a).map((b) => b.lh)).pop();
    const pa = lhNotes(piece.bars.slice(z).map((b) => b.lh))[0];
    const pr = lhNotes(raised);
    const sings = (!pb || isSingableInterval(pb, pr[0])) && (!pa || isSingableInterval(pr[pr.length - 1], pa));
    if (clear && sings && joins(before, inside[0]) && joins(inside[inside.length - 1], after)) range(a, z).forEach((b, k) => (piece.bars[b].lh = raised[k]));
  }
  const G3 = diatonicIndex({ letter: 'G', alter: 0, octave: 3 });
  for (const bar of piece.bars) {
    const lh = bar.lh.filter((n) => !n.rest);
    if (lh.length && lh.every((n) => n.pitches.every((p) => diatonicIndex(p) >= G3))) bar.lhClef = 'treble';
  }
}

/**
 * The right pedal (Grade 6): in Romantic pieces with each change of harmony (down with the bass,
 * up before the next chord), as Chopin pedals; elsewhere over the closing bars.
 */
function pedal(ctx: FCtx, romantic: boolean): void {
  const { piece } = ctx;
  const e = ensureExpression(piece);
  const spans: { from: NoteRef; to: NoteRef }[] = [];
  const n = piece.bars.length;
  const bars = romantic ? range(0, n) : range(Math.max(0, n - 2), n);
  for (const b of bars) {
    const bar = piece.bars[b];
    const at = starts(bar.lh.map((x) => x.ticks));
    const changes = bar.harmony.map((h) => h.at);
    changes.forEach((t, k) => {
      const end = changes[k + 1] ?? totalTicks(bar.lh);
      const inside = bar.lh.map((x, i) => ({ x, i, at: at[i] })).filter(({ at: s }) => s >= t - 1e-6 && s < end - 1e-6);
      if (!inside.length || inside.some(({ x }) => x.rest)) return;
      spans.push({ from: { bar: b, index: inside[0].i }, to: { bar: b, index: inside[inside.length - 1].i } });
    });
  }
  if (spans.length) e.pedals = spans;
}

// ---------------------------------------------------------------------------
// Grade 7: 8va, una corda
// ---------------------------------------------------------------------------

/**
 * 8va (Grade 7): one phrase of the right hand (not the first or last) played an octave higher,
 * written where it was with the 8va sign — the reader sees the same notes; the sound is higher.
 */
function ottava(ctx: FCtx): void {
  const { piece, rng } = ctx;
  const ranges = phraseRanges(piece);
  // A middle phrase that neither repeats the opening nor is a sequence (their copies stay exact).
  const middle = ranges.slice(1, -1).filter((_, k) => !piece.phrases[k + 1]?.repeatsOpening && !piece.phrases[k + 1]?.sequence);
  if (!middle.length) return;
  const [a, z] = middle[Math.floor(rng.next() * middle.length)];
  const from = firstNoteRef(piece, a);
  const to = lastNoteRef(piece, z);
  if (!from || !to || to.bar < a) return;
  for (let b = a; b < z; b++) for (const n of piece.bars[b].rh) if (!n.rest) n.pitches = n.pitches.map((p) => octave(p, 1));
  const e = ensureExpression(piece);
  (e.ottavas ??= []).push({ from, to });
}

/** Una corda (Grade 7): a quiet phrase on the soft pedal, then tre corde. */
function unaCorda(ctx: FCtx): void {
  const { piece } = ctx;
  const e = ensureExpression(piece);
  const ranges = phraseRanges(piece);
  // The softest marked phrase (or the second, if none is marked soft).
  const level = (ref: NoteRef | null) => {
    if (!ref) return 3;
    const d = [...e.dynamics].reverse().find((x) => x.at.bar < ref.bar || (x.at.bar === ref.bar && x.at.index <= ref.index));
    return d ? LOUDNESS.indexOf(d.mark) : 3;
  };
  const candidates = ranges.slice(1, -1).map((r) => ({ r, l: level(firstNoteRef(piece, r[0])) }));
  if (!candidates.length) return;
  const { r } = candidates.sort((x, y) => x.l - y.l)[0];
  const from = firstNoteRef(piece, r[0]);
  const to = lastNoteRef(piece, r[1]);
  if (from && to) (e.unaCorda ??= []).push({ from, to });
}

// ---------------------------------------------------------------------------
// Grade 8: spread chords, ornaments
// ---------------------------------------------------------------------------

/** Spread chords (Grade 8): the final chord rolled, and now and then a chord on a phrase's first beat. */
function spread(ctx: FCtx): void {
  const { piece, rng } = ctx;
  const last = piece.bars[piece.bars.length - 1];
  for (const n of [...last.rh, ...last.lh]) if (!n.rest && n.pitches.length >= 2) n.spread = true;
  for (const [a] of phraseRanges(piece).slice(1)) {
    const first = piece.bars[a]?.lh[0];
    if (first && !first.rest && first.pitches.length >= 2 && rng.chance(0.35)) first.spread = true;
  }
}

/** A trill on the note before the final tonic (Grade 8) — the cadential trill of the Galant and Baroque. */
function cadentialTrill(ctx: FCtx): void {
  const { piece, key } = ctx;
  const ref = lastNoteRef(piece, piece.bars.length - 1);
  if (!ref) return;
  const n = piece.bars[ref.bar].rh[ref.index];
  if (n.rest || n.ticks < 4 || n.pitches.length > 1 || n.triplet) return;
  const p = n.pitches[0];
  const upper = step(key, p, 1);
  if (!isSingableInterval(p, upper)) return;
  n.ornament = { type: 'trill', upper };
}

// ---------------------------------------------------------------------------
// Tempo: rit. (Grade 5), tempo changes (Grade 7), accel. (Grade 8)
// ---------------------------------------------------------------------------

function tempo(ctx: FCtx): void {
  const { piece, spec, rng } = ctx;
  const f = spec.features;
  const ranges = phraseRanges(piece);
  const tempos: NonNullable<Expression['tempos']> = [];
  const n = piece.bars.length;
  // Tempo changes: a contrasting middle phrase quicker or slower, then a tempo.
  if (f.tempoChanges && ranges.length >= 3 && rng.chance(0.6)) {
    const k = 1 + Math.floor(rng.next() * (ranges.length - 2));
    const from = firstNoteRef(piece, ranges[k][0]);
    const back = firstNoteRef(piece, ranges[k + 1][0]);
    if (from && back) {
      const faster = rng.chance(0.5);
      tempos.push({ at: from, text: faster ? 'Più mosso' : 'Meno mosso', kind: 'set', factor: faster ? 1.12 : 0.88 });
      tempos.push({ at: back, text: 'a tempo', kind: 'set', factor: 1 });
    }
  }
  // Accel. towards the climax of a phrase, then a tempo.
  if (f.accelerando && ranges.length >= 2 && rng.chance(0.45)) {
    const k = ranges.length >= 3 ? 1 + Math.floor(rng.next() * (ranges.length - 2)) : 0;
    const [a, z] = ranges[k];
    const from = firstNoteRef(piece, Math.min(z - 1, a + Math.floor((z - a) / 2)));
    const back = firstNoteRef(piece, z);
    if (from && back && !tempos.some((t) => t.at.bar >= from.bar && t.at.bar <= back.bar)) {
      tempos.push({ at: from, text: 'accel.', kind: 'accel', factor: 1.2 });
      tempos.push({ at: back, text: 'a tempo', kind: 'set', factor: 1 });
    }
  }
  // Rit. into the final bar.
  if (f.ritardando && n >= 4 && rng.chance(0.65)) {
    const at = firstNoteRef(piece, n - 2);
    if (at && !tempos.some((t) => t.at.bar >= n - 2)) tempos.push({ at, text: 'rit.', kind: 'rit', factor: 0.78 });
  }
  if (tempos.length) {
    const e = ensureExpression(piece);
    e.tempos = tempos.sort((x, y) => x.at.bar - y.at.bar || x.at.index - y.at.index);
  }
}

