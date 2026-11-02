/**
 * The structural melody: one chord tone per main beat, shaped as a whole (motif, sequence, return,
 * a prepared climax, the descent to the cadence), and the rhythm of each span between main notes.
 */
import { TimeSignatureId } from '../grades';
import { isChromatic, pcAbove, pcOf, samePc } from '../pitch-class';
import { Pitch, isSingableInterval, midi, mod } from '../theory';
import { BassLine } from './bass';
import { RChord } from './chords';
import { Ctx, roomAbove } from './context';
import { Form, Role } from './form';
import { Frame, MP, isStep, samePitch, semis } from './frame';
import { Segment } from './harmony';
import { spanRhythms } from './rhythm';

interface SSlot {
  bar: number;
  onset: number;
  ticks: number;
  seg: number;
  chord: RChord;
  role: Role;
  bass: Pitch;
  /** Index of this slot within its bar. */
  i: number;
  fixed?: number;
  stepTo?: number;
  climax?: boolean;
  /** The last slot of a phrase ending on a half close. */
  half?: boolean;
  /** A lighter main note within one harmony: it may be a passing or neighbour note. */
  light?: boolean;
}

export interface Structure {
  slots: SSlot[];
  notes: MP[];
  /** Degree of the climax (the highest note), if one was planned. */
  climaxD: number | null;
  climaxIndex: number;
  /** The rhythm of each span, planned with the main notes. */
  rhythms: number[][];
}

const STRUCT_LEAP = [0.3, 1, 0.45, 0.2, 0.15, 0.12, 0.03, 0.04];

const STRUCT_LEAP_BARE = [0.3, 1, 0.3, 0.1, 0.06, 0.05, 0.02, 0.03];

const STRUCT_LEAP_ONE = [0.8, 0.45, 1, 0.3, 0.12, 0.08, 0.02, 0.03];

export function planStructure(ctx: Ctx, form: Form, segments: Segment[][], bassLine: BassLine, frame: Frame): Structure {
  const { spec, time, rng, ch, grade } = ctx;
  const { lo, hi } = frame;
  const roleOf = (b: number): Role => {
    for (const p of form.phrases) if (b >= p.start && b < p.start + p.roles.length) return p.roles[b - p.start];
    return 'answer';
  };
  const halfEnds = new Set(form.phrases.filter((p) => p.cadence === 'HC').map((p) => p.start + p.roles.length - 1));
  const phraseEnds = new Set(form.phrases.map((p) => p.start + p.roles.length - 1));

  // Slots: the character's main beats plus every change of harmony; the final bar is one note.
  const slots: SSlot[] = [];
  segments.forEach((segs, b) => {
    const last = b === form.barCount - 1;
    // After the opening idea, bars have a second main note, so the line can climb to its
    // climax and come down again by step.
    const echo = form.echoes.get(b);
    const spacious = ['motif', 'answer', 'contrast'].includes(roleOf(b)) || (!!echo && !echo.exact);
    const climbing = ['climax', 'precadence'].includes(roleOf(b));
    const extra = spacious ? [] : (({ '3/4': [8], '2/4': [4], '3/8': climbing ? [4] : [] } as Partial<Record<TimeSignatureId, number[]>>)[time.id] ?? []);
    const beats = last ? [0] : [...(ch.structural[time.id] ?? [0]), ...extra];
    const onsets = [...new Set([...beats, ...segs.map((s) => s.at)])].filter((t) => t < time.barTicks).sort((x, y) => x - y);
    onsets.forEach((onset, i) => {
      const seg = segs.length > 1 && onset >= segs[1].at ? 1 : 0;
      slots.push({
        bar: b,
        onset,
        ticks: (onsets[i + 1] ?? time.barTicks) - onset,
        seg,
        chord: segs[seg].chord,
        role: roleOf(b),
        bass: bassLine.pitches[b][seg],
        i,
        light: extra.includes(onset) && !segs.some((x) => x.at === onset) && !beats.slice(0, beats.length - extra.length).includes(onset),
      });
    });
  });
  const n = slots.length;
  slots[n - 1].fixed = 0;
  slots[n - 2].stepTo = 0;
  slots.forEach((s, k) => {
    if (halfEnds.has(s.bar) && (k === n - 1 || slots[k + 1].bar !== s.bar)) s.half = true;
  });

  // The climax: the first main note of the climax bar, as high as can be reached.
  const climaxIndex = slots.findIndex((s) => s.bar === form.climaxBar);
  const climaxSlot = slots[climaxIndex];
  const chordToneAt = (slot: SSlot, d: number) => frame.isCT(frame.spellings(d, slot.chord)[0], slot.chord);
  const climaxOptions: (number | null)[] = [];
  // Leave room to come down to 2̂ by the cadence.
  const room = (n - 2 - climaxIndex) * Math.min(spec.maxLeap, 4);
  for (let d = hi; d >= lo + 2; d--) if (chordToneAt(climaxSlot, d) && d - 1 <= room) climaxOptions.push(d);
  let climaxD = hi + 1;

  // Each span's rhythm, so the search knows which leaps will be filled and which heard bare.
  const rhythms = planSpanRhythms(ctx, form, slots, climaxIndex);

  // Contour: each phrase rises towards a peak; the last towards the climax, then falls home.
  const span = hi - lo;
  const T = (s: SSlot) => s.bar * time.barTicks + s.onset;
  let anchors: [number, number][] = [];
  const planContour = (peak: number) => {
    anchors = [];
    form.phrases.forEach((p, pi) => {
      const start = p.start * time.barTicks;
      const end = (p.start + p.roles.length) * time.barTicks;
      // (A nocturne's first phrase starts low, to leap up into its singing register.)
      const low = pi === 0 && ctx.character === 'nocturne' && grade >= 2 ? 0.12 : 0.3;
      anchors.push([start, lo + span * (p.contrast ? 0.5 : low)]);
      if (pi === form.phrases.length - 1) {
        anchors.push([T(climaxSlot), peak]);
        anchors.push([end, 0.5]);
      } else {
        anchors.push([start + (end - start) * 0.6, lo + span * (p.contrast ? 0.75 : 0.62)]);
        anchors.push([end, lo + span * 0.4]);
      }
    });
  };
  const contour = (slot: SSlot) => {
    const t = T(slot);
    for (let k = 1; k < anchors.length; k++) {
      const [t0, h0] = anchors[k - 1];
      const [t1, h1] = anchors[k];
      if (t <= t1) return h0 + ((h1 - h0) * (t - t0)) / Math.max(1, t1 - t0);
    }
    return anchors[anchors.length - 1][1];
  };

  const notes: MP[] = [];
  let relax = 0;
  /** The slot this one echoes (same place in an earlier bar), if any. */
  const echoSlot = (k: number): { slot: number; exact: boolean; invert: boolean } | null => {
    const e = form.echoes.get(slots[k].bar);
    if (!e) return null;
    const src = slots.findIndex((s) => s.bar === e.source && s.i === slots[k].i);
    return src >= 0 && src < k ? { slot: src, exact: e.exact, invert: !!e.invert } : null;
  };

  const candidates = (k: number): MP[] => {
    const slot = slots[k];
    if (slot.fixed !== undefined) return frame.spellings(slot.fixed, slot.chord);
    const out: MP[] = [];
    for (let d = lo; d <= hi; d++) {
      if (slot.stepTo !== undefined && Math.abs(d - slot.stepTo) !== 1) continue;
      for (const p of frame.spellings(d, slot.chord)) if (frame.isCT(p, slot.chord) || slot.light) out.push(p);
    }
    return out;
  };

  const ok = (k: number, c: MP): boolean => {
    const slot = slots[k];
    if (c.d > hi || c.d < lo) return false;
    if (!slot.climax && c.d >= climaxD) return false; // one summit
    if (midi(c.pitch) - midi(slot.bass) < 3) return false; // never on or below the bass
    // A nocturne opens with an expressive rising leap of a fourth to a sixth (Op. 9 No. 2).
    if (relax < 1 && k === 1 && ctx.character === 'nocturne' && grade >= 2 && notes[0]) {
      const leap = c.d - notes[0].d;
      if (leap < 3 || leap > Math.min(5, spec.maxLeap)) return false;
    }
    // Leave the left hand room for its chord: the melody stays a fifth or more above the bass.
    if (relax < 3 && grade >= 2 && midi(c.pitch) - midi(slot.bass) < roomAbove(ctx) - (relax >= 2 ? 2 : 0)) return false;
    // A return begins exactly as the opening did.
    const echo = echoSlot(k);
    if (relax < 2 && echo?.exact && slot.i === 0 && notes[echo.slot] && c.d !== notes[echo.slot].d) return false;
    // …so the phrase before it must end within reach of that opening note.
    const nextEcho = k + 1 < n ? echoSlot(k + 1) : null;
    if (relax < 2 && nextEcho?.exact && slots[k + 1].i === 0 && notes[nextEcho.slot]) {
      const target = notes[nextEcho.slot];
      if (Math.abs(target.d - c.d) > spec.maxLeap || (target.d !== c.d && !isSingableInterval(c.pitch, target.pitch))) return false;
    }
    const p1 = notes[k - 1];
    if (!p1) return true;
    const leap = c.d - p1.d;
    // A light main note that is not in the chord is a passing or neighbour note: by step in,
    // and (checked at the next note) by step out, in the same direction or back again.
    const nct = (q: MP, sl: SSlot) => !frame.isCT(q, sl.chord);
    const prevSlot = slots[k - 1];
    if (slot.light && nct(c, slot)) {
      if (!isStep(p1, c) || slot.chord.tones.some((t) => t.l === pcOf(c.pitch).l)) return false;
      // (It must resolve within its own phrase.)
      if (k + 1 >= n || phraseEnds.has(slot.bar) && slots[k + 1].bar !== slot.bar) return false;
    }
    if (prevSlot.light && nct(p1, prevSlot)) {
      if (!isStep(p1, c)) return false;
      const p0 = notes[k - 2];
      if (p0 && Math.sign(p1.d - p0.d) !== Math.sign(c.d - p1.d) && !samePitch(p0, c)) return false;
    }
    if (Math.abs(leap) > spec.maxLeap) return false;
    if (!frame.allows(p1, c)) return false;
    if (relax < 3 && leap !== 0 && !isSingableInterval(p1.pitch, c.pitch)) return false;
    const prev = slots[k - 1];
    // No parallel fifths or octaves with the bass from one change of harmony to the next
    // (heard on successive beats, even with notes between).
    if (relax < 2 && prev.chord !== slot.chord) {
      let j = k - 1;
      while (j > 0 && slots[j - 1].chord === slots[j].chord && slots[j].bar === slots[j - 1].bar) j--;
      for (const q of new Set([k - 1, j])) {
        const ivPrev = mod(midi(notes[q].pitch) - midi(slots[q].bass), 12);
        const iv = mod(midi(c.pitch) - midi(slot.bass), 12);
        const mMove = midi(c.pitch) - midi(notes[q].pitch);
        const bMove = midi(slot.bass) - midi(slots[q].bass);
        if ((iv === 0 || iv === 7) && iv === ivPrev && mMove !== 0 && Math.sign(mMove) === Math.sign(bMove)) return false;
      }
    }
    // A tendency tone held alone (no figuration to resolve it) resolves in the main line.
    if (relax < 1 && prevSlot.chord !== slot.chord && rhythms[k - 1].length === 1 && !(phraseEnds.has(prevSlot.bar) && prevSlot.bar !== slot.bar)) {
      const pc = pcOf(p1.pitch);
      const move = semis(p1, c);
      if (prevSlot.chord.rising.some((r) => samePc(r, pc)) && slot.chord.tones.some((t) => samePc(t, pcAbove(pc, 1, 1))) && move !== 1) return false;
      const stepDown = slot.chord.tones.some((t) => samePc(t, pcAbove(pc, -1, -1)) || samePc(t, pcAbove(pc, -1, -2)));
      if (prevSlot.chord.falling.some((f) => samePc(f, pc)) && stepDown && move !== -1 && move !== -2 && move !== 0) return false;
    }
    const p2 = notes[k - 2];
    // After a phrase ends the line may start afresh.
    const fresh = phraseEnds.has(prev.bar) && prev.bar !== slot.bar;
    if (p2 && relax < 1 && !fresh) {
      const before = p1.d - p2.d;
      // After a leap, turn back — by step (or a third), filling the gap the leap opened.
      if (Math.abs(before) >= 3 && (Math.sign(leap) === Math.sign(before) || Math.abs(leap) > 2) && leap !== 0) return false;
      // Not three main notes the same.
      if (before === 0 && leap === 0) return false;
    }
    return true;
  };

  const weight = (k: number, c: MP): number => {
    const slot = slots[k];
    const p1 = notes[k - 1];
    let w = Math.exp(-0.4 * Math.abs(c.d - contour(slot)));
    if (p1) {
      const size = Math.abs(c.d - p1.d);
      // A leap out of a single long note is heard bare; one with notes between is filled in.
      // With one note between, a third is filled by a passing note (and a step is not).
      const between = rhythms[k - 1].length - 1;
      const table = between === 0 ? STRUCT_LEAP_BARE : between === 1 ? STRUCT_LEAP_ONE : STRUCT_LEAP;
      w *= size === 0 && ctx.character === 'prelude' ? 0.8 : table[Math.min(size, table.length - 1)];
      // The expressive leap: up to the climax (or a phrase's high point) by a fourth or more.
      const next = slots[k + 1];
      if (c.d - p1.d >= 3 && (slot.climax || slot.role === 'climax')) w *= 4 * ch.leap;
      // A nocturne opens with an expressive rising leap, then falls by step (Op. 9 No. 2's sixth).
      else if (k === 1 && ctx.character === 'nocturne' && grade >= 2 && c.d - p1.d >= 3 && c.d - p1.d <= 5) w *= 4;
      else if (c.d - p1.d >= 3 && grade >= 3) w *= ch.leap;
      // A leading note or seventh resolves in the main line when it can.
      const prevChord = slots[k - 1].chord;
      if (prevChord !== slot.chord) {
        const pc = pcOf(p1.pitch);
        if (prevChord.rising.some((r) => samePc(r, pc)) && semis(p1, c) === 1) w *= 3;
        if (prevChord.falling.some((f) => samePc(f, pc)) && (semis(p1, c) === -1 || semis(p1, c) === -2)) w *= 2.5;
      }
      if (next && next.stepTo !== undefined) w *= Math.abs(c.d - next.stepTo) <= 2 ? 1.5 : 1;
    }
    // Echo the motif: the same notes for a return, the same shape for a sequence.
    const echo = echoSlot(k);
    if (echo && notes[echo.slot]) {
      if (echo.exact) w *= c.d === notes[echo.slot].d ? 12 : 0.5;
      else if (p1 && slots[k - 1].bar === slot.bar && notes[echo.slot - 1]) {
        const want = p1.d + (echo.invert ? -1 : 1) * (notes[echo.slot].d - notes[echo.slot - 1].d);
        w *= c.d === want ? 8 : Math.abs(c.d - want) === 1 ? 1.5 : 0.5;
      }
    }
    // A light main note between two others by step: the line moves on.
    if (slot.light && !frame.isCT(c, slot.chord)) w *= 1.5;
    // Melodies sing the chord's third, and its chromatic note when it has one.
    const member = slot.chord.tones.findIndex((t) => samePc(t, pcOf(c.pitch)));
    if (member === 1) w *= 1.4;
    if (isChromatic(ctx.hkey, pcOf(c.pitch))) w *= 1.8;
    // A half close rests on 2̂ (or 5̂, or 7̂).
    if (slot.half) w *= mod(c.d, 7) === 1 ? 3 : mod(c.d, 7) === 4 ? 1.5 : 1;
    return w;
  };

  const search = (from: number, to: number): boolean => {
    let budget = budgetSize;
    const go = (k: number): boolean => {
      if (--budget < 0) return false;
      if (k === to) return true;
      // Can the next fixed note (climax, or the final tonic) still be reached?
      const nextFixed = [climaxIndex, n - 1].find((j) => j > k && slots[j].fixed !== undefined);
      const options = candidates(k).filter((c) => {
        if (!ok(k, c)) return false;
        if (nextFixed !== undefined && Math.abs(slots[nextFixed].fixed! - c.d) > (nextFixed - k) * spec.maxLeap) return false;
        return true;
      });
      for (const c of rng.weightedOrder(options, (c) => weight(k, c))) {
        notes[k] = c;
        if (go(k + 1)) return true;
      }
      notes.length = k;
      return false;
    };
    for (relax = 0; relax <= maxRelax; relax++) {
      notes.length = from;
      budget = budgetSize;
      if (go(from)) return true;
    }
    return false;
  };
  let maxRelax = 1;
  let budgetSize = 30000;

  // Phrase by phrase, so the motif is fixed before its echoes are written.
  const bounds = form.phrases.map((p) => slots.findIndex((s) => s.bar >= p.start + p.roles.length)).map((x) => (x < 0 ? n : x));
  // Prefer a slightly lower climax to a melody that breaks its own rules (or its return).
  let planned: number | null = null;
  // (No planned climax at all is the very last resort.)
  const attempts: [number, number | null][] = [...climaxOptions.map((o): [number, number | null] => [1, o]), ...climaxOptions.map((o): [number, number | null] => [3, o]), [3, null], [4, null]];
  outer: for (const [limit, option] of attempts) {
    // The very last attempt searches longer.
    maxRelax = Math.min(limit, 3);
    budgetSize = limit > 3 ? 400000 : 30000;
    climaxD = option ?? hi + 1;
    climaxSlot.climax = option !== null;
    climaxSlot.fixed = option ?? undefined;
    planContour(option ?? hi);
    notes.length = 0;
    let from = 0;
    let okAll = true;
    for (const to of bounds) {
      if (!search(from, to)) {
        okAll = false;
        break;
      }
      from = to;
    }
    if (okAll) {
      planned = option;
      break outer;
    }
  }
  if (notes.length !== n) throw new Error('Chopin: structural melody search failed');
  let top = 0;
  notes.forEach((p, k) => {
    if (p.d > notes[top].d) top = k;
  });
  return { slots, notes, climaxD: planned, climaxIndex: planned === null ? top : climaxIndex, rhythms };
}

/** The span (same place in an earlier bar) that this one echoes, if they have the same length. */
export function echoSource(form: Form, slots: SSlot[], k: number): number | null {
  const e = form.echoes.get(slots[k].bar);
  if (!e) return null;
  const src = slots.findIndex((s) => s.bar === e.source && s.i === slots[k].i);
  return src >= 0 && src < k && slots[src].ticks === slots[k].ticks && slots[src].onset === slots[k].onset ? src : null;
}

/** The source bar's rhythm between two points in the bar, splitting a note that straddles them. */
function cutRhythm(ctx: Ctx, slots: SSlot[], rhythms: number[][], sourceBar: number, from: number, ticks: number): number[] | null {
  const spans = slots.map((s, k) => ({ s, k })).filter(({ s }) => s.bar === sourceBar);
  if (spans.some(({ k }) => !rhythms[k])) return null;
  const notes: [number, number][] = [];
  for (const { s, k } of spans) {
    let t = s.onset;
    for (const d of rhythms[k]) {
      notes.push([t, d]);
      t += d;
    }
  }
  const out: number[] = [];
  for (const [t, d] of notes) {
    const a = Math.max(t, from);
    const b = Math.min(t + d, from + ticks);
    if (b > a) out.push(b - a);
  }
  return out.every((d) => ctx.spec.durations.includes(d)) && out.reduce((x, y) => x + y, 0) === ticks ? out : null;
}

/**
 * The rhythm of each span between main notes: the character's cells, as busy as the grade,
 * role and metre suggest; echoes keep their source's rhythm, ornate returns are busier.
 */
function planSpanRhythms(ctx: Ctx, form: Form, slots: SSlot[], climaxIndex: number): number[][] {
  const { rng, grade, ch, time } = ctx;
  const n = slots.length;
  const beat = time.beatTicks;
  const finalBar = form.barCount - 1;
  const ornateBar = (b: number) => form.echoes.get(b)?.ornate ?? false;
  const rhythms: number[][] = [];
  const sourceOf = (k: number) => echoSource(form, slots, k);
  for (let k = 0; k < n; k++) {
    const slot = slots[k];
    if (slot.bar === finalBar) {
      rhythms[k] = slot.ticks === 18 ? [12, 6] : [slot.ticks];
      continue;
    }
    const src = sourceOf(k);
    const ornate = ornateBar(slot.bar);
    if (src !== null && !ornate) {
      rhythms[k] = rhythms[src];
      continue;
    }
    // An echo whose harmony moves differently still keeps the motif's rhythm, cut (and if
    // need be a note split) at its own main notes: the rhythm is the motif's identity.
    const echo = form.echoes.get(slot.bar);
    if (echo && !ornate) {
      const cut = cutRhythm(ctx, slots, rhythms, echo.source, slot.onset, slot.ticks);
      if (cut) {
        rhythms[k] = cut;
        continue;
      }
    }
    const options = spanRhythms(ctx, slot.onset, slot.ticks);
    const beats = slot.ticks / beat;
    let density = ch.density * (0.6 + 0.1 * grade);
    // The user's rhythmic difficulty: sparser or busier figuration (never other note values).
    if (ctx.cons) density *= { easy: 0.75, medium: 1, difficult: 1.3 }[ctx.cons.rhythmicDifficulty];
    if (slot.role === 'cadence') density *= 0.55;
    // Slow crotchet beats in 2/4, and dotted-crotchet beats in compound time, carry more
    // figuration (a 6/8 nocturne flows in quavers).
    if (time.id === '2/4') density *= 1.5;
    if (time.compound) density *= 1.7;
    if (slot.role === 'intensify' || slot.role === 'climax') density *= 1.15;
    if (ornate) density *= 1.5;
    const want = Math.max(1, density * beats);
    rhythms[k] = rng.weighted(options, ({ r, count }) => {
      let w = count * Math.exp(-1.1 * Math.abs(r.length - want));
      // The climax arrives on a long note; a half close rests.
      if (k === climaxIndex) w *= r[0] >= beat ? 4 : 0.2;
      if (slot.half) w *= r.length <= 2 && r[0] >= beat ? 4 : 0.1;
      // A returning phrase is more ornate than the original.
      if (src !== null && ornate) w *= r.length > rhythms[src].length ? 4 : 0.25;
      return w;
    }).r;
  }

  return rhythms;
}
