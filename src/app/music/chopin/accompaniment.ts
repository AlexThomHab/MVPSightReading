/**
 * The left hand: one accompaniment pattern per piece (broken chords, wide arpeggios, or bass and
 * chord), voiced from the harmony with smooth inner voices.
 */
import type { Note } from '../model';
import { PC, isChromatic, pcAbove, pcOf, samePc } from '../pitch-class';
import { LETTERS, Pitch, diatonicIndex, midi, mod } from '../theory';
import { BassLine } from './bass';
import { Ctx, Texture } from './context';
import { Melody } from './elaboration';
import { Form } from './form';
import { Segment } from './harmony';

interface LhEvent {
  /** Indices into the voicing: 0 = bass, 1.. = upper notes. */
  parts: number[];
  ticks: number;
  articulation?: Note['articulation'];
}

/** The one accompaniment pattern for a piece, chosen from those that suit its character, metre and grade. */
export function choosePattern(ctx: Ctx): Texture {
  const { grade, character, time, rng } = ctx;
  const compound = time.compound || time.id === '3/8';
  const options: [Texture, number][] = (() => {
    switch (character) {
      case 'nocturne':
        if (grade <= 2) return [['broken', 1]] as [Texture, number][];
        return compound
          ? ([['arpeggio', 2], ['broken', 1], ['bassChord', 1.5]] as [Texture, number][])
          : ([['arpeggio', 2], ['broken', 1]] as [Texture, number][]);
      case 'prelude':
        return grade >= 3
          ? ([['broken', 1.5], ['bassChord', 1.5], ['arpeggio', 0.8]] as [Texture, number][])
          : ([['broken', 1], ['bassChord', 1]] as [Texture, number][]);
      case 'waltz':
      case 'mazurka':
        return [['bassChord', 1]] as [Texture, number][];
    }
  })();
  // The user's note values and hand independence narrow the choice; with nothing that fits, held chords.
  const cons = ctx.cons;
  if (!cons) return rng.weighted(options, ([, w]) => w)[0];
  const unit = (t: Texture) => (t === 'broken' ? (grade === 1 && !compound ? 4 : 2) : t === 'arpeggio' ? 2 : compound || time.id === '2/4' ? 2 : 4);
  let fitting = options.filter(([t]) => cons.noteTicks.includes(unit(t)));
  const moving = fitting.filter(([t]) => t !== 'bassChord');
  if (cons.independence === 'full' && moving.length) fitting = moving;
  return fitting.length ? rng.weighted(fitting, ([, w]) => w)[0] : 'final';
}

function halvesOf(ticks: number): number[] {
  return ticks === 18 ? [12, 6] : [ticks];
}

function pattern(texture: Texture, at: number, ticks: number, ctx: Ctx, uppers: number): LhEvent[] {
  const { time, grade, character } = ctx;
  const compound = time.compound || time.id === '3/8';
  const all = Array.from({ length: uppers + 1 }, (_, i) => i);
  const held = (): LhEvent[] => halvesOf(ticks).map((t) => ({ parts: all.slice(0, 3), ticks: t }));
  const cycle = (unit: number, order: number[]) => Array.from({ length: ticks / unit }, (_, i) => ({ parts: [order[i % order.length]], ticks: unit }));
  // Up through the chord and back: bass, middle, top, middle (compound beats: bass, middle, top).
  const sweep = uppers >= 2 ? (compound ? [0, 1, 2] : [0, 1, 2, 1]) : uppers === 1 ? [0, 1] : [0];
  const dance = character === 'waltz' || character === 'mazurka';
  const stacc: Note['articulation'] = grade >= 2 && dance ? 'staccato' : undefined;
  switch (texture) {
    case 'final':
      // The closing chord, held: the bass and at most two notes above it.
      return held();
    case 'broken': {
      const unit = grade === 1 && !compound ? 4 : 2;
      return ticks % unit === 0 ? cycle(unit, sweep) : held();
    }
    case 'arpeggio':
      return ticks % 2 === 0 ? cycle(2, sweep) : held();
    case 'bassChord': {
      // The bass alone on the beat, then the chord above it: two notes (the outer pair of the
      // upper voices, a sixth apart); three only on beat 3 of a 4/4 bar.
      // (In 2/4 the beats are halved: bass, chord on each crotchet beat.)
      const twoFour = time.id === '2/4' && grade >= 2;
      const unit = compound || twoFour ? 2 : 4;
      if (ticks % unit !== 0) return held();
      const dyad = uppers >= 3 ? [1, 3] : uppers === 2 ? [1, 2] : uppers === 1 ? [1] : [0];
      return Array.from({ length: ticks / unit }, (_, i) => {
        const t = at + i * unit;
        // Each beat of a new harmony (compound: each dotted crotchet) begins with the bass.
        const onBeat = compound ? t % 6 === 0 : twoFour ? t % 4 === 0 : i === 0;
        if (onBeat) return { parts: character === 'mazurka' && t === 0 && uppers >= 1 ? [0, 1] : [0], ticks: unit };
        if (time.id === '4/4' && t === 8 && uppers >= 3) return { parts: [1, 2, 3], ticks: unit };
        return { parts: dyad, ticks: unit, articulation: stacc };
      });
    }
  }
}

export function accompany(ctx: Ctx, form: Form, segments: Segment[][], bassLine: BassLine, melody: Melody): Note[][] {
  const { spec, grade, hkey } = ctx;
  const { hiD } = bassLine;
  // One pattern for the whole piece; only the last bar's chord is held.
  const chosenPattern = ctx.pattern;
  const textureOf = (b: number): Texture => (b === form.barCount - 1 ? 'final' : chosenPattern);
  const atD = (pc: PC, D: number): Pitch => ({ letter: LETTERS[pc.l], alter: pc.a, octave: Math.floor(D / 7) });

  // The right hand's lowest note over a stretch of time, so the left hand can stay below it.
  const rhLow = (bar: number, from: number, ticks: number): number => {
    let t = 0;
    let low = Infinity;
    melody.notes[bar].forEach((n) => {
      if (t < from + ticks && t + n.ticks > from) low = Math.min(low, midi(n.pitches[0]), ...(n.grace ?? []).map(midi));
      t += n.ticks;
    });
    return low;
  };

  // Voicings: the notes above the bass, chosen for the whole piece at once so the inner voices
  // move smoothly — leading notes rise, sevenths fall, chromatic notes slide by semitone.
  const flat = segments.flatMap((segs, b) => segs.map((s, k) => ({ s, b, k })));
  type Voicing = { D: number[]; pcs: PC[]; cost: number };
  const voicingsFor = (i: number): Voicing[] => {
    const { s, b, k } = flat[i];
    const texture = textureOf(b);
    const bassD = bassLine.D[b][k];
    const bass = bassLine.pitches[b][k];
    const wide = texture === 'arpeggio';
    // Upper voices: two (three for the bass-and-chord pattern's chords in simple time, Grade 3+).
    const count = texture === 'bassChord' && grade >= 3 && !ctx.time.compound && ctx.time.id !== '3/8' ? 3 : 2;
    // An arpeggio spreads to the octave (the tenth from Grade 4); chords stay within a tenth.
    const span = wide ? (grade >= 4 ? 9 : 7) : count === 3 ? 9 : 7;
    const ceiling = rhLow(b, s.at, s.ticks) - 1;
    const positions: { D: number; pc: PC }[] = [];
    for (let D = bassD + 1; D <= Math.min(hiD, bassD + span); D++) {
      const pc = s.chord.tones.find((t) => t.l === mod(D, 7));
      if (pc && midi(atD(pc, D)) <= ceiling) positions.push({ D, pc });
    }
    // (The bass stays the lowest note: with no room above it, it plays alone.)
    const out: Voicing[] = [];
    const choose = (from: number, picked: { D: number; pc: PC }[]) => {
      if (picked.length === Math.min(count, positions.length)) {
        const pcs = picked.map((p) => p.pc);
        let cost = 0;
        const has = (pc: PC) => pcs.some((x) => samePc(x, pc)) || samePc(pcOf(bass), pc);
        // Complete the chord: its third, its seventh, an augmented sixth's ♯4 and ♭6.
        if (s.chord.tones[1] && !has(s.chord.tones[1])) cost += 6;
        if (s.chord.tones.length === 4 && !has(s.chord.tones[3])) cost += 4;
        if (s.chord.tones[2] && !has(s.chord.tones[2])) cost += 1.5;
        if (pcs.some((x) => samePc(x, pcOf(bass))) && s.chord.tones.some((t) => !has(t))) cost += 1.5;
        for (const r of s.chord.rising) if (!has(r)) cost += 3;
        // No doubled leading notes; no doubled pitch classes when there is a note to spare.
        for (const r of s.chord.rising) if (samePc(pcOf(bass), r) && pcs.some((x) => samePc(x, r))) cost += 8;
        if (new Set(pcs.map((p) => `${p.l}${p.a}`)).size < pcs.length) cost += 3;
        // A wide nocturne spread: an open fifth (or more) above the bass.
        // An arpeggio is open: a fifth (or more) above the bass, then the octave or tenth.
        if (wide && picked.length && picked[0].D - bassD < 3) cost += 3;
        if (wide && picked.length && picked[picked.length - 1].D - bassD < 7) cost += 2;
        // Low in the bass a close chord is muddy: space it open (a fifth or more above the bass).
        if (!wide && picked.length && midi(bass) < 48 && picked[0].D - bassD < 3) cost += 3;
        out.push({ D: picked.map((p) => p.D), pcs, cost });
        return;
      }
      for (let j = from; j < positions.length; j++) {
        if (picked.length && positions[j].D - picked[picked.length - 1].D > spec.maxBassLeap) continue;
        choose(j + 1, [...picked, positions[j]]);
      }
    };
    choose(0, []);
    return out.length ? out : [{ D: [], pcs: [], cost: 0 }];
  };
  const options = flat.map((_, i) => voicingsFor(i));
  const motion = (i: number, a: Voicing, b: Voicing): number => {
    if (!a.D.length || !b.D.length) return 0;
    const prev = flat[i - 1].s.chord;
    const cur = flat[i].s.chord;
    const from = a.D.map((D, v) => midi(atD(a.pcs[v], D)));
    const to = b.D.map((D, v) => midi(atD(b.pcs[v], D)));
    // How far the voices move, paired off in order (the hand keeps its shape).
    let cost = 0;
    for (let v = 0; v < Math.min(from.length, to.length); v++) cost += Math.abs(to[v] - from[v]) * 0.35;
    if (prev === cur) return cost;
    // Tendency tones resolve: a leading note to the note a semitone up, a seventh down a step.
    a.pcs.forEach((pc, v) => {
      if (prev.rising.some((r) => samePc(r, pc)) && cur.tones.some((t) => samePc(t, pcAbove(pc, 1, 1))) && !to.includes(from[v] + 1)) cost += 2.5;
      const below = cur.tones.some((t) => samePc(t, pcAbove(pc, -1, -1)) || samePc(t, pcAbove(pc, -1, -2)));
      if (prev.falling.some((f) => samePc(f, pc)) && below && !to.includes(from[v] - 1) && !to.includes(from[v] - 2)) cost += 4;
    });
    return cost;
  };
  let costs = options[0].map((o) => o.cost);
  const back: number[][] = [];
  for (let i = 1; i < options.length; i++) {
    const prevCosts = costs;
    back[i] = [];
    costs = options[i].map((o, j) => {
      let best = Infinity;
      options[i - 1].forEach((p, k) => {
        const c = prevCosts[k] + motion(i, p, o) + o.cost;
        if (c < best) {
          best = c;
          back[i][j] = k;
        }
      });
      return best;
    });
  }
  const chosen: Voicing[] = [];
  let pick = costs.indexOf(Math.min(...costs));
  for (let i = options.length - 1; i >= 0; i--) {
    chosen[i] = options[i][pick];
    if (i > 0) pick = back[i][pick];
  }

  const bars: Note[][] = segments.map(() => []);
  const uppersOf = (i: number) => chosen[i].D.map((D, j) => atD(chosen[i].pcs[j], D)).sort((x, y) => midi(x) - midi(y));
  const phraseStarts = new Set(form.phrases.map((p) => p.start));
  /** Right-hand notes sounding at any moment of [from, from + ticks) in a bar. */
  const rhDuring = (bar: number, from: number, ticks: number): Pitch[] => {
    let t = 0;
    const out: Pitch[] = [];
    for (const n of melody.notes[bar]) {
      if (t < from + ticks && t + n.ticks > from) out.push(...n.pitches, ...(n.grace ?? []));
      t += n.ticks;
    }
    return out;
  };
  /**
   * Chromatic inner-voice motion (Grade 4+), as in the E minor Prelude: where an upper voice
   * moves a whole tone into the next chord, it slides through the semitone between in the
   * second half of the beat — one voice at a time, never against the melody's spelling.
   */
  const passingVoice = (i: number, uppers: Pitch[], texture: Texture): { voice: number; pitch: Pitch } | null => {
    const { s, b } = flat[i];
    const next = flat[i + 1];
    if (grade < 4 || !next || texture === 'final' || textureOf(next.b) === 'final' || ctx.cons?.accidentals === false) return null;
    if (next.b !== b && phraseStarts.has(next.b)) return null;
    if (s.ticks < 2 * ctx.time.beatTicks && !ctx.time.compound) return null;
    const after = uppersOf(i + 1);
    if (after.length !== uppers.length) return null;
    for (let v = 0; v < uppers.length; v++) {
      const from = uppers[v];
      const to = after[v];
      const move = midi(to) - midi(from);
      if (Math.abs(move) !== 2 || Math.abs(diatonicIndex(to) - diatonicIndex(from)) !== 1) continue;
      // Never against a tendency: a seventh does not climb, a leading note does not sink.
      const pc = pcOf(from);
      if (move > 0 && s.chord.falling.some((f) => samePc(f, pc))) continue;
      if (move < 0 && s.chord.rising.some((r) => samePc(r, pc))) continue;
      const pitch: Pitch = { ...from, alter: from.alter + Math.sign(move) };
      if (Math.abs(pitch.alter) > 1) continue;
      const others = [bassLine.pitches[b][flat[i].k], ...uppers.filter((_, j) => j !== v)];
      const half = s.ticks / 2;
      const against = [...others, ...rhDuring(b, s.at + half, half)];
      if (against.some((q) => q.letter === pitch.letter)) continue;
      if (others.some((q) => Math.abs(midi(q) - midi(pitch)) <= 2)) continue;
      if (midi(pitch) >= rhLow(b, s.at + half, half)) continue;
      return { voice: v, pitch };
    }
    return null;
  };
  flat.forEach(({ s, b, k }, i) => {
    const texture = textureOf(b);
    const bass = bassLine.pitches[b][k];
    const uppers = uppersOf(i);
    const voicing = [bass, ...uppers];
    const passing = passingVoice(i, uppers, texture);
    const events = pattern(texture, s.at, s.ticks, ctx, uppers.length);
    let t = s.at;
    for (const e of events) {
      // Keep the left hand below the right.
      const ceiling = rhLow(b, t, e.ticks) - 1;
      const sounding = passing && t >= s.at + s.ticks / 2 ? voicing.map((p, j) => (j === passing.voice + 1 ? passing.pitch : p)) : voicing;
      let pitches = e.parts.map((p) => sounding[Math.min(p, sounding.length - 1)]).filter((p) => midi(p) <= ceiling);
      if (!pitches.length) pitches = [bass];
      const seen = new Set<number>();
      pitches = pitches.filter((p) => !seen.has(midi(p)) && seen.add(midi(p))).sort((x, y) => midi(x) - midi(y));
      const note: Note = { pitches, ticks: e.ticks };
      if (pitches.some((p) => isChromatic(hkey, pcOf(p)))) note.chromatic = true;
      if (e.articulation) note.articulation = e.articulation;
      bars[b].push(note);
      t += e.ticks;
    }
  });
  return bars;
}
