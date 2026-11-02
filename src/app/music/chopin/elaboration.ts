/**
 * Elaboration: each span between main notes filled with a figure — passing and neighbour notes,
 * appoggiaturas and suspensions, turns, runs, and chromatic notes that the harmony explains.
 */
import type { Note, NoteRef } from '../model';
import { degreeOfLetter, isChromatic, pcAbove, pcOf, samePc, scaleDegreePc } from '../pitch-class';
import { LETTERS, Pitch, midi } from '../theory';
import { RChord } from './chords';
import { Ctx, roomAbove } from './context';
import { Form } from './form';
import { Frame, MP, isStep, melodicOk, runLength, samePitch, semis, steps } from './frame';
import { spanRhythms } from './rhythm';
import { Structure, echoSource } from './structure';

/** What a melody note does. */
type Kind = 'main' | 'chord' | 'appoggiatura' | 'suspension' | 'passing' | 'neighbour' | 'approach';

interface MNote extends MP {
  kind: Kind;
  ticks: number;
}

export interface Melody {
  notes: Note[][];
  /** For each note: its degree, its role, and whether it is a main (structural) note. */
  meta: { d: number; kind: Kind; slot: number }[][];
  climax: NoteRef;
  appoggiaturas: NoteRef[];
  structure: Structure;
}

type Entry = 'plain' | 'appoggiatura' | 'chromaticAppoggiatura' | 'suspension';

/** How many chromatic melody notes (outside the harmony) each grade may use. */
const CHROMATIC_QUOTA = [0, 0, 2, 3, 5, 7];

/** Appetite for (well-explained) chromatic notes by grade: always below 1 — never colour for its own sake. */
const CHROMATIC_WEIGHT = [0, 0, 0.6, 0.8, 0.9, 1];

export function elaborate(ctx: Ctx, form: Form, structure: Structure, frame: Frame): Melody {
  const { spec, rng, grade, ch, hkey } = ctx;
  const { slots, notes: mains } = structure;
  const n = slots.length;
  const climaxPitch = structure.climaxD !== null ? midi(mains[structure.climaxIndex].pitch) : Infinity;
  // (No chromatic notes at all when the user has switched accidentals off.)
  let chromaticLeft = ctx.cons?.accidentals === false ? 0 : CHROMATIC_QUOTA[grade];

  const ornateBar = (b: number) => form.echoes.get(b)?.ornate ?? false;
  const finalBar = form.barCount - 1;

  // --- Rhythm of each span (planned with the main notes) ---------------------
  const rhythms = structure.rhythms.map((r) => [...r]);
  const sourceOf = (k: number) => echoSource(form, slots, k);

  // --- Entries: appoggiaturas and suspensions onto main notes ----------------
  const entries: Entry[] = slots.map(() => 'plain');
  const heads: MP[] = mains.map((m) => m);
  // A waltz may open on a sigh — an appoggiatura onto its first main note — which its
  // sequences then keep: the motif's rhythmic and expressive identity (as in Op. 64 No. 2).
  if (ctx.character === 'waltz' && grade >= 2 && rhythms[0].length >= 2 && structure.climaxIndex !== 0) {
    const upper = frame.spellings(mains[0].d + 1, slots[0].chord)[0];
    if (!frame.isCT(upper, slots[0].chord) && upper.d <= frame.hi && upper.d < (structure.climaxD ?? 99) && rng.chance(0.55)) {
      entries[0] = 'appoggiatura';
      heads[0] = upper;
    }
  }
  for (let k = 1; k < n - 1; k++) {
    const slot = slots[k];
    const s = mains[k];
    if (rhythms[k].length < 2 || k === structure.climaxIndex || slot.bar === finalBar || grade < 2 || slot.light) continue;
    const src = sourceOf(k);
    if (src !== null && !ornateBar(slot.bar) && entries[src] !== 'plain') {
      // Sequences keep the original's appoggiatura where they can.
      const upper = frame.spellings(s.d + 1, slot.chord)[0];
      if (entries[src] === 'appoggiatura' && !frame.isCT(upper, slot.chord) && upper.d + 0 < (structure.climaxD ?? 99)) {
        entries[k] = 'appoggiatura';
        heads[k] = upper;
      }
      continue;
    }
    const prevSlot = slots[k - 1];
    const prevChordTone = (p: MP) => frame.isCT(p, prevSlot.chord);
    // Suspension: the note above, held over from the previous chord, falls onto the main note.
    const held = frame.spellings(s.d + 1, prevSlot.chord)[0];
    const heldNow = frame.spellings(s.d + 1, slot.chord)[0];
    const phraseStart = form.phrases.some((p) => p.start === slot.bar) && slot.i === 0;
    const canSuspend =
      ctx.cons?.ties !== false &&
      grade >= 3 &&
      !phraseStart &&
      prevSlot.chord !== slot.chord &&
      prevChordTone(held) &&
      samePitch(held, heldNow) &&
      !frame.isCT(heldNow, slot.chord) &&
      semis(heldNow, s) < 0 &&
      // (A leading note is never held back from its resolution.)
      !(prevSlot.chord.rising.some((r) => samePc(r, pcOf(held.pitch))) && slot.chord.tones.some((t) => samePc(t, pcAbove(pcOf(held.pitch), 1, 1)))) &&
      (rhythms[k - 1].length > 1 || samePitch(mains[k - 1], held)) &&
      entries[k - 1] === 'plain' &&
      held.d < (structure.climaxD ?? 99);
    if (canSuspend && rng.chance(0.35 * ch.appoggiatura)) {
      entries[k] = 'suspension';
      heads[k] = held;
      continue;
    }
    // Appoggiatura: the step above, sounding on the beat and sighing down onto the main note.
    const upper = frame.spellings(s.d + 1, slot.chord)[0];
    if (!frame.isCT(upper, slot.chord) && upper.d <= frame.hi && upper.d < (structure.climaxD ?? 99) && rng.chance(0.28 * ch.appoggiatura)) {
      entries[k] = 'appoggiatura';
      heads[k] = upper;
      continue;
    }
    // A chromatic appoggiatura from a semitone below (Grade 4+).
    const below = frame.at(s.d - 1, pcAbove(pcOf(s.pitch), -1, -1));
    const diatonicBelow = frame.spellings(s.d - 1, slot.chord)[0];
    if (
      grade >= 4 &&
      chromaticLeft > 0 &&
      below.d >= frame.lo &&
      isChromatic(hkey, pcOf(below.pitch)) &&
      !samePitch(below, diatonicBelow) &&
      !slot.chord.tones.some((t) => t.l === pcOf(below.pitch).l) &&
      rng.chance(0.12 * ch.appoggiatura)
    ) {
      entries[k] = 'chromaticAppoggiatura';
      heads[k] = below;
      chromaticLeft--;
    }
  }

  // --- Figures ----------------------------------------------------------------
  const out: MNote[][] = slots.map(() => []);
  const used: number[] = slots.map(() => 0);
  const retried = new Set<number>();
  const clash = (p: MP, chord: RChord, bass: Pitch) =>
    chord.tones.some((t) => t.l === LETTERS.indexOf(p.pitch.letter) && t.a !== p.pitch.alter) ||
    (bass.letter === p.pitch.letter && bass.alter !== p.pitch.alter);

  /** The source bar's melody notes starting within [from, from + ticks), if already written. */
  const echoNotes = (bar: number, from: number, ticks: number): MNote[] | null => {
    const found: MNote[] = [];
    slots.forEach((sl, j) => {
      if (sl.bar !== bar) return;
      let t = sl.onset;
      for (const m of out[j]) {
        if (t >= from && t < from + ticks) found.push(m);
        t += m.ticks;
      }
    });
    return found.length ? found : null;
  };
  for (let k = 0; k < n; k++) {
    const slot = slots[k];
    const s = mains[k];
    const head = heads[k];
    const entry = entries[k];
    const prev = k > 0 ? out[k - 1][out[k - 1].length - 1] : undefined;
    /** The melody so far (its last few notes), for judging runs across spans. */
    const history: MP[] = out.slice(Math.max(0, k - 4), k).flat().slice(-8);
    const nextHead = k < n - 1 ? heads[k + 1] : undefined;
    const nextChord = k < n - 1 ? slots[k + 1].chord : undefined;
    const forcedLast = k < n - 1 && entries[k + 1] === 'suspension' ? heads[k + 1] : undefined;
    // The final approach: 2̂ or 7̂ to the tonic.
    const lastIn = k === n - 2 ? [1, -1] : null;
    const isClimaxSpan = k === structure.climaxIndex;
    const src = sourceOf(k);
    const echoInfo = form.echoes.get(slot.bar);
    const echo = src !== null ? out[src] : echoInfo ? echoNotes(echoInfo.source, slot.onset, slot.ticks) : null;
    const echoExact = echoInfo?.exact ?? false;
    const flip = echoInfo?.invert ? -1 : 1;

    if (k === n - 1) {
      // The final tonic, held (tied across the bar in 9/8).
      out[k] = rhythms[k].map((t) => ({ ...s, ticks: t, kind: 'main' as Kind }));
      continue;
    }
    const tryRhythm = (r: number[], relaxed: boolean, free = false): MNote[] | null => {
      const len = r.length;
      if (entry !== 'plain' && len < 2) return null;
      const fixed: (MP | undefined)[] = Array(len).fill(undefined);
      fixed[0] = head;
      if (entry !== 'plain') fixed[1] = s;
      if (forcedLast) {
        if (fixed[len - 1] && !samePitch(fixed[len - 1]!, forcedLast)) return null;
        fixed[len - 1] = forcedLast;
      }
      const lowD = Math.max(frame.lo, Math.min(s.d, nextHead?.d ?? s.d) - 3);
      const highD = Math.min(frame.hi, Math.max(s.d, nextHead?.d ?? s.d) + 3);
      const path: MP[] = [];
      const found: { path: MP[]; w: number }[] = [];
      let nodes = 0;

      const kindOf = (j: number, p: MP, a: MP | undefined, b: MP | undefined, last: boolean): Kind | null => {
        if (j === 0) return entry === 'plain' ? 'main' : entry === 'suspension' ? 'suspension' : 'appoggiatura';
        if (j === 1 && entry !== 'plain') return 'main';
        if (frame.isCT(p, slot.chord)) return 'chord';
        if (!a) return null;
        // No false relations: a note never contradicts the harmony's spelling of its letter.
        if (clash(p, slot.chord, slot.bass)) return null;
        const chrom = isChromatic(hkey, pcOf(p.pitch));
        const stepIn = isStep(a, p);
        const stepOut = b ? isStep(p, b) : false;
        if (b && stepIn && stepOut) {
          const through = Math.sign(semis(a, p)) === Math.sign(semis(p, b));
          if (chrom) {
            // Chromatic passing notes alter the letter they leave (C–C♯–D, D–D♭–C); chromatic
            // neighbours are the letter beside (E–D♯–E, G–A♭–G).
            if (through && Math.abs(semis(a, b)) === 2 && p.pitch.letter === a.pitch.letter) return 'passing';
            if (samePitch(a, b) && Math.abs(semis(a, p)) === 1 && p.pitch.letter !== a.pitch.letter) return 'neighbour';
            if (last && semis(p, b) === 1 && p.pitch.letter !== b.pitch.letter) return 'approach';
            return null;
          }
          // A semitone either side is chromatic passing, however the key spells it: keep the letter.
          if (through) return Math.abs(semis(a, b)) === 2 && p.pitch.letter !== a.pitch.letter ? null : 'passing';
          if (samePitch(a, b)) return 'neighbour';
        }
        // An approach note: a step (or semitone) below the next main note, reached from a chord tone.
        if (last && b && semis(p, b) > 0 && semis(p, b) <= 2 && steps(p, b) === 1 && entries[k + 1] === 'plain' && steps(a, p) <= 2) {
          return 'approach';
        }
        return relaxed && b && isStep(p, b) ? 'passing' : null;
      };

      /**
       * How well a chromatic non-chord tone is explained by the harmony around it — the
       * measure of good chromaticism, not how much of it there is:
       *  - it belongs to the chord before or after (anticipating V7/V's ♯4, echoing iv's ♭6);
       *  - it is a leading note, a semitone below where it goes;
       *  - it is a borrowed ♭3 or ♭6 in a major key, leaning down a semitone;
       *  - otherwise it is colour for its own sake, and is avoided.
       */
      const chromaticPurpose = (q: MP, after: MP | undefined): number => {
        const pc = pcOf(q.pitch);
        const near = [slots[k - 1]?.chord, nextChord].filter((c): c is RChord => !!c && c !== slot.chord);
        if (near.some((c) => c.tones.some((t) => samePc(t, pc)))) return 1.6 * CHROMATIC_WEIGHT[grade];
        if (after && semis(q, after) === 1 && after.pitch.letter !== q.pitch.letter) return 1.0 * CHROMATIC_WEIGHT[grade];
        const deg = degreeOfLetter(hkey, pc.l);
        if (!ctx.minor && (deg === 2 || deg === 5) && pc.a < scaleDegreePc(hkey, deg).a && after && semis(q, after) === -1) return 0.9 * CHROMATIC_WEIGHT[grade];
        return 0.15;
      };

      const score = (p: MP[]): number => {
        let w = 1;
        const all = prev ? [prev, ...p] : p;
        let chrom = 0;
        for (let j = 1; j < p.length; j++) {
          const size = steps(p[j - 1], p[j]);
          // A singing line moves mostly by step; a waltz may sparkle through the chord.
          const skip = ctx.character === 'waltz' ? [1, 1, 0.8, 0.45, 0.3] : [1, 1, 0.4, 0.2, 0.1];
          w *= skip[Math.min(size, 4)];
          if (isChromatic(hkey, pcOf(p[j].pitch)) && !frame.isCT(p[j], slot.chord)) {
            chrom++;
            w *= chromaticPurpose(p[j], p[j + 1] ?? nextHead);
          }
        }
        if (chrom && ctx.character === 'mazurka') w *= 1.2;
        {
          const chromatic = p.filter((q) => isChromatic(hkey, pcOf(q.pitch)) && !frame.isCT(q, slot.chord));
          const distinct = new Set(chromatic.map((q) => midi(q.pitch))).size;
          w *= 0.25 ** (chromatic.length - distinct);
        }
        // The move on to the next main note counts too: an expressive leap up is welcome
        // before the climax, but the line should not lurch.
        if (nextHead) {
          const into = steps(p[p.length - 1], nextHead);
          const toClimax = k + 1 === structure.climaxIndex && nextHead.d > p[p.length - 1].d;
          // A nocturne's opening leap is heard, not filled in (Op. 9 No. 2).
          const opening = k === 0 && ctx.character === 'nocturne' && grade >= 2 && nextHead.d - p[p.length - 1].d >= 3;
          w *= into <= 1 ? 1 : opening ? 3 : into === 2 ? 0.5 : toClimax ? 0.6 * ch.leap : into === 3 ? 0.25 : 0.1;
        }
        // Do not crowd the left hand: notes close above the bass leave no room for its chord.
        for (const q of p) if (midi(q.pitch) - midi(slot.bass) < roomAbove(ctx)) w *= 0.3;
        // Stay near the line from this main note to the next.
        const a = Math.min(s.d, nextHead?.d ?? s.d) - 1;
        const b = Math.max(s.d, nextHead?.d ?? s.d) + 1;
        for (const q of p) w *= Math.exp(-0.5 * Math.max(0, a - q.d, q.d - b));
        // Figures: neighbour notes, written-out turns, runs, arpeggios.
        const ds = p.map((q) => q.d);
        for (let j = 0; j + 2 < ds.length; j++) if (ds[j] === ds[j + 2] && Math.abs(ds[j + 1] - ds[j]) === 1) w *= 1.25;
        for (let j = 0; j + 3 < ds.length; j++) {
          const x = ds.slice(j, j + 4).map((v) => v - ds[j]);
          const turn = (x[1] === 1 && x[2] === 0 && x[3] === -1) || (x[1] === -1 && x[2] === -2 && x[3] === -1);
          if (turn) w *= grade >= 3 ? 2 * ch.ornament : 0.5;
        }
        let run = 1;
        let longest = 1;
        for (let j = 1; j < ds.length; j++) {
          run = Math.abs(ds[j] - ds[j - 1]) === 1 && Math.sign(ds[j] - ds[j - 1]) === Math.sign(ds[j - 1] - (ds[j - 2] ?? ds[j - 1] - (ds[j] - ds[j - 1]))) ? run + 1 : 1;
          longest = Math.max(longest, run);
        }
        const toClimax = k + 1 === structure.climaxIndex;
        if (longest >= 4) w *= grade >= 4 && (toClimax || ornateBar(slot.bar)) ? 1.6 * ch.ornament : 0.3;
        if (ctx.character === 'waltz' && p.every((q) => frame.isCT(q, slot.chord))) w *= 1.3;
        // Repeated notes are for a prelude's sighs, not elsewhere.
        for (let j = 1; j < all.length; j++) if (samePitch(all[j - 1], all[j])) w *= ctx.character === 'prelude' ? 0.8 : 0.25;
        // Echo the original: the same shape (a sequence) or the same notes (a plain return).
        if (echo && echo.length === p.length) {
          const same = p.every((q, j) => q.d - p[0].d === flip * (echo[j].d - echo[0].d));
          const exact = p.every((q, j) => samePitch(q, echo[j]));
          if (echoExact ? exact : same) w *= 20;
          else if (same) w *= 6;
        }
        if (ornateBar(slot.bar)) w *= 1 + 0.3 * chrom;
        return w;
      };

      const dfs = (j: number): void => {
        if (found.length >= 160 || ++nodes > 6000) return;
        if (j === len) {
          // The last note must move on properly to the next main note.
          const last = path[len - 1];
          if (nextHead) {
            if (samePitch(last, nextHead) && !forcedLast) return;
            if (!forcedLast && !(melodicOk(last, nextHead, spec.maxLeap) && frame.allows(last, nextHead))) return;
            const a = path[len - 2] ?? prev;
            const kind = kindOf(len - 1, last, a, nextHead, true);
            if (!kind) return;
            // Leading notes rise and sevenths fall into the next harmony.
            // (An appoggiatura or suspension on the next beat must honour this too.)
            if (!free && nextChord && nextChord !== slot.chord) {
              const pc = pcOf(last.pitch);
              if (slot.chord.rising.some((r) => samePc(r, pc)) && nextChord.tones.some((t) => samePc(t, pcAbove(pc, 1, 1))) && semis(last, nextHead) !== 1) return;
              if (slot.chord.falling.some((f) => samePc(f, pc)) && (semis(last, nextHead) > 0 || semis(last, nextHead) < -2)) return;
            }
          }
          if (lastIn && !lastIn.includes(path[len - 1].d)) return;
          found.push({ path: [...path], w: score(path) });
          return;
        }
        const options: MP[] = [];
        if (fixed[j]) options.push(fixed[j]!);
        else {
          const q = path[j - 1];
          for (let d = lowD; d <= highD; d++) options.push(...frame.spellings(d, slot.chord));
          if (grade >= 2 && chromaticLeft > 0) {
            const qpc = pcOf(q.pitch);
            if (Math.abs(q.pitch.alter) < 1 || q.pitch.alter === -1) options.push(frame.at(q.d, { l: qpc.l, a: qpc.a + 1 }));
            if (Math.abs(q.pitch.alter) < 1 || q.pitch.alter === 1) options.push(frame.at(q.d, { l: qpc.l, a: qpc.a - 1 }));
            options.push(frame.at(q.d - 1, pcAbove(qpc, -1, -1)));
            // An upper chromatic neighbour only where it is a borrowed degree: ♭2, or ♭6 in major.
            const upper = pcAbove(qpc, 1, 1);
            const deg = degreeOfLetter(hkey, upper.l);
            if (grade >= 4 && isChromatic(hkey, upper) && (deg === 1 || (deg === 5 && !ctx.minor))) options.push(frame.at(q.d + 1, upper));
            if (j === len - 1 && nextHead) options.push(frame.at(nextHead.d - 1, pcAbove(pcOf(nextHead.pitch), -1, -1)));
          }
        }
        const seen = new Set<string>();
        const unique = options.filter((o) => {
          const key = `${o.d}:${o.pitch.alter}`;
          if (seen.has(key) || Math.abs(o.pitch.alter) > 1) return false;
          seen.add(key);
          return true;
        });
        for (const c of rng.weightedOrder(unique, (c) => (path[j - 1] && steps(path[j - 1], c) <= 1 ? 3 : 1))) {
          if (c.d < frame.lo || c.d > frame.hi) continue;
          // The melody stays clear above the left hand: its bass and the pattern's notes above it.
          if (midi(c.pitch) - midi(slot.bass) < (grade >= 2 ? roomAbove(ctx) - 2 : 3)) continue;
          if (midi(c.pitch) >= climaxPitch && !(isClimaxSpan && j === 0)) continue;
          const q = j > 0 ? path[j - 1] : prev;
          if (q && j > 0 && samePitch(q, c)) continue;
          // No aimless scales: at most seven steps running one way, counting earlier spans
          // (and, for the last note, the step on into the next main note).
          if (runLength([...history, ...path.slice(0, j), c, ...(j === len - 1 && nextHead ? [nextHead] : [])]) > 7) continue;
          // No false relation within the figure: a letter changes its accidental only by moving
          // straight on to it (a chromatic step).
          const earlier = j > 0 ? [...(prev ? [prev] : []), ...path.slice(0, j - 1)] : [];
          if (earlier.some((x) => x.pitch.letter === c.pitch.letter && x.pitch.alter !== c.pitch.alter)) continue;
          if (q && !(j === 0 && entry === 'suspension') && !(melodicOk(q, c, spec.maxLeap) && frame.allows(q, c))) continue;
          // The note before this one is now flanked on both sides: is it a proper non-chord tone?
          if (j >= 2 && !kindOf(j - 1, path[j - 1], path[j - 2], c, false)) continue;
          // Chromatic notes are counted against the grade's allowance.
          const chromSoFar = [...path, c].filter((x) => isChromatic(hkey, pcOf(x.pitch)) && !frame.isCT(x, slot.chord)).length;
          if (chromSoFar > chromaticLeft + (entry === 'chromaticAppoggiatura' ? 1 : 0)) continue;
          path[j] = c;
          dfs(j + 1);
          path.length = j;
        }
      };
      dfs(0);
      if (!found.length) return null;
      const chosen = rng.weighted(found, (f) => f.w).path;
      return chosen.map((p, j) => ({
        ...p,
        ticks: r[j],
        kind: kindOf(j, p, j > 0 ? chosen[j - 1] : prev, j < len - 1 ? chosen[j + 1] : nextHead, j === len - 1) ?? 'passing',
      }));
    };

    let result = tryRhythm(rhythms[k], false);
    if (!result) {
      // Another rhythm for this span, then a looser treatment, then the main note held.
      const alternatives = spanRhythms(ctx, slot.onset, slot.ticks).map((x) => x.r);
      for (const r of alternatives) if (!result) result = tryRhythm(r, false);
      for (const r of [rhythms[k], ...alternatives]) if (!result) result = tryRhythm(r, true);
      for (const r of [rhythms[k], ...alternatives]) if (!result) result = tryRhythm(r, true, true);
    }
    if (!result && entries[k] !== 'plain' && k > 0 && !retried.has(k)) {
      // The appoggiatura or suspension cannot be written here: drop it, and rewrite the span
      // before (which was leading into it).
      if (entries[k] === 'chromaticAppoggiatura') chromaticLeft++;
      entries[k] = 'plain';
      heads[k] = mains[k];
      chromaticLeft += used[k - 1];
      retried.add(k);
      k -= 2;
      continue;
    }
    if (!result) {
      // Last resort: the main note held for the whole span.
      result = [{ ...s, ticks: slot.ticks, kind: 'main' }];
      if (slot.ticks === 18) result = [{ ...s, ticks: 12, kind: 'main' }, { ...s, ticks: 6, kind: 'main' }];
      if (entries[k] !== 'plain') entries[k] = 'plain';
    }
    rhythms[k] = result.map((x) => x.ticks);
    used[k] = result.filter((x) => isChromatic(hkey, pcOf(x.pitch)) && !frame.isCT(x, slot.chord) && x.kind !== 'appoggiatura').length;
    chromaticLeft -= used[k];
    out[k] = result;
  }

  // --- Assemble -----------------------------------------------------------------
  const notes: Note[][] = Array.from({ length: form.barCount }, () => []);
  const meta: Melody['meta'] = Array.from({ length: form.barCount }, () => []);
  const appoggiaturas: NoteRef[] = [];
  let climax: NoteRef = { bar: 0, index: 0 };
  out.forEach((fig, k) => {
    const b = slots[k].bar;
    fig.forEach((m, j) => {
      const note: Note = { pitches: [m.pitch], ticks: m.ticks };
      if (isChromatic(hkey, pcOf(m.pitch))) note.chromatic = true;
      // A suspension is tied over from the note before; so is a 9/8 final note.
      if (j === 0 && m.kind === 'suspension') {
        const prevBar = slots[k - 1].bar;
        notes[prevBar][notes[prevBar].length - 1].tie = true;
      }
      if (m.kind === 'appoggiatura') appoggiaturas.push({ bar: b, index: notes[b].length });
      if (k === structure.climaxIndex && j === 0) climax = { bar: b, index: notes[b].length };
      notes[b].push(note);
      meta[b].push({ d: m.d, kind: m.kind, slot: k });
    });
    if (k === n - 1 && fig.length === 2) notes[b][notes[b].length - 2].tie = true;
  });
  return { notes, meta, climax, appoggiaturas, structure };
}
