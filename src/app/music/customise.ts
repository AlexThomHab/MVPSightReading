/**
 * Applying a user's customisation to generated music, and checking the result.
 *
 * The generators read the constraints while composing (note values, ranges, leaps, key,
 * metre, harmony, accompaniment). What remains is applied here, to the finished piece:
 *   - expression and articulation the user has switched off are removed;
 *   - ties are removed (or, when the user wants them, repeated notes are tied);
 *   - with the hands "together", the left hand takes the right hand's rhythm;
 *   - any note value the user has not allowed is re-rhythmed into allowed ones (the pitches
 *     sounding at each moment are kept, so the harmony is unchanged);
 *   - rests the user allows are written as breaths at the ends of phrases.
 * Then `checkPiece` verifies every hard constraint. `generateCustomised` retries (with a
 * derived, deterministic seed) a bounded number of times and reports why if it cannot comply.
 */
import { ConstraintIssue, Customisation, GenerationConstraints, GenerationError, canFill, melodicIntervalAllowed, resolveConstraints, validateSettings } from './constraints';
import type { Bar, Note, Piece, Settings } from './model';
import { Random } from './random';
import { Pitch, diatonicIndex, keySignatureAlter, midi, pitchName } from './theory';

type Hand = 'rh' | 'lh';

/** The pitches sounding at tick `t` of a bar's hand, or null in a rest. */
function soundingAt(notes: readonly Note[], t: number): Note | null {
  let at = 0;
  for (const n of notes) {
    if (t >= at && t < at + n.ticks) return n;
    at += n.ticks;
  }
  return null;
}

const onsetsOf = (notes: readonly Note[]) => notes.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1] + notes[i - 1].ticks], []);

/** Where the harmony changes in a bar (and its end). */
const harmonyCuts = (bar: Bar, barTicks: number) => [...bar.harmony.map((h) => h.at).filter((t) => t > 0), barTicks];

/**
 * Re-rhythms a bar's hand into the allowed note values, keeping whatever sounds at each moment.
 * Notes start at the original onsets where possible and never cross a change of harmony
 * (unless the allowed values cannot fill the harmony's span).
 */
function refit(notes: readonly Note[], bar: Bar, barTicks: number, noteTicks: readonly number[], restTicks: readonly number[]): Note[] {
  const ok = (n: Note) => (n.rest ? restTicks : noteTicks).includes(n.ticks);
  if (notes.every(ok)) return [...notes];
  const cuts = harmonyCuts(bar, barTicks);
  const spans = cuts.every((end, i) => canFill(end - (i ? cuts[i - 1] : 0), noteTicks)) ? cuts : [barTicks];
  const out: Note[] = [];
  let start = 0;
  for (const end of spans) {
    let t = start;
    while (t < end) {
      const source = soundingAt(notes, t);
      const remaining = end - t;
      // The original note's remaining length, or the nearest allowed value that still lets the span be filled.
      let sourceEnd = t;
      for (const [i, at] of onsetsOf(notes).entries()) if (at <= t) sourceEnd = at + notes[i].ticks;
      const want = Math.min(sourceEnd - t, remaining);
      const fits = noteTicks.filter((d) => d <= remaining && canFill(remaining - d, noteTicks));
      const d = fits.filter((x) => x <= want).sort((a, b) => b - a)[0] ?? fits.sort((a, b) => a - b)[0];
      const restOk = source?.rest && restTicks.includes(d);
      const pitches = source && !source.rest ? source.pitches : (out[out.length - 1]?.pitches ?? notes.find((n) => !n.rest)?.pitches ?? []);
      out.push(restOk ? { pitches: [], ticks: d, rest: true } : { ...(source && !source.rest ? source : {}), pitches, ticks: d, rest: undefined, tie: undefined });
      t += d;
    }
    start = end;
  }
  return out.map((n) => (n.rest ? { pitches: [], ticks: n.ticks, rest: true } : stripUndefined(n)));
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** The left hand rhythmically "together" with the right: an attack only where the right hand has one. */
function alignHands(bar: Bar): Note[] {
  let t = 0;
  return bar.rh.map((r) => {
    const sounding = soundingAt(bar.lh, t);
    t += r.ticks;
    if (r.rest || !sounding || sounding.rest) return { pitches: [], ticks: r.ticks, rest: true };
    return { pitches: sounding.pitches, ticks: r.ticks };
  });
}

/** Breath rests at the ends of phrases (and, as rhythm gets harder, elsewhere). */
function addRests(piece: Piece, c: GenerationConstraints, rng: Random): void {
  if (!c.restTicks.length || piece.bars[0].voices) return;
  const time = piece.time;
  const beat = time.compound || time.id === '3/8' ? (time.id === '3/8' ? 2 : 6) : 4;
  const phraseEnds = new Set(piece.phrases.map((p) => p.startBar + p.bars - 1));
  const chance = { easy: 0.05, medium: 0.15, difficult: 0.3 }[c.rhythmicDifficulty];
  piece.bars.forEach((bar, b) => {
    if (b === piece.bars.length - 1) return;
    if (!phraseEnds.has(b) && !rng.chance(chance)) return;
    const last = bar.rh[bar.rh.length - 1];
    if (last.rest || last.tie || last.ornament) return;
    // The longest allowed rest that leaves an allowed note and starts on a beat.
    const options = [...c.restTicks]
      .filter((r) => r < last.ticks && c.noteTicks.includes(last.ticks - r) && (time.barTicks - r) % beat === 0)
      .sort((a, z) => z - a);
    if (!options.length) return;
    const r = options[0];
    last.ticks -= r;
    bar.rh.push({ pitches: [], ticks: r, rest: true });
  });
}

/** Ties as a rhythmic feature: a repeated note within a phrase is tied over. */
function addTies(piece: Piece, c: GenerationConstraints, rng: Random): void {
  if (!c.ties || piece.bars[0].voices || c.rhythmicDifficulty === 'easy') return;
  const chance = c.rhythmicDifficulty === 'difficult' ? 0.5 : 0.25;
  const starts = new Set(piece.phrases.map((p) => p.startBar));
  const line = piece.bars.flatMap((bar, b) => bar.rh.map((n, i) => ({ n, b, first: i === 0 })));
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const z = line[i + 1];
    if (a.n.rest || z.n.rest || a.n.tie || z.n.grace || z.n.ornament || z.n.articulation || a.n.ornament) continue;
    if (z.first && starts.has(z.b)) continue;
    if (midi(a.n.pitches[0]) === midi(z.n.pitches[0]) && rng.chance(chance)) a.n.tie = true;
  }
}

/** Removes the marks the user has switched off. */
function stripMarks(note: Note, c: GenerationConstraints): Note {
  const n = { ...note };
  if (!c.ties) delete n.tie;
  if (!c.ornaments) {
    delete n.grace;
    delete n.ornament;
  }
  const keep = { staccato: c.staccato, accent: c.accents, tenuto: c.tenuto };
  if (n.articulation && !keep[n.articulation]) delete n.articulation;
  return n;
}

/** Keeps expression marks pointing at notes that exist after the right hand changed. */
function clampExpression(piece: Piece): void {
  const e = piece.expression;
  if (!e) return;
  const valid = (r: { bar: number; index: number }) => r.bar < piece.bars.length && r.index < piece.bars[r.bar].rh.length && !piece.bars[r.bar].rh[r.index].rest;
  const before = (a: { bar: number; index: number }, z: { bar: number; index: number }) => a.bar < z.bar || (a.bar === z.bar && a.index < z.index);
  e.dynamics = e.dynamics.filter((d) => valid(d.at));
  e.hairpins = e.hairpins.filter((h) => valid(h.from) && valid(h.to) && before(h.from, h.to));
  e.slurs = e.slurs.filter((s) => valid(s.from) && valid(s.to) && before(s.from, s.to));
}

/** Applies the customisation to a generated piece (a new piece; the input is not changed). */
export function applyConstraints(input: Piece, c: GenerationConstraints): Piece {
  const piece: Piece = structuredClone(input);
  const rng = new Random(`${piece.seed}|customise`);
  const chorale = !!piece.bars[0].voices;
  for (const bar of piece.bars) {
    bar.rh = bar.rh.map((n) => stripMarks(n, c));
    bar.lh = bar.lh.map((n) => stripMarks(n, c));
    if (bar.voices) for (const v of ['s', 'a', 't', 'b'] as const) bar.voices[v] = bar.voices[v].map((n) => stripMarks(n, c));
  }
  if (!c.dynamics) {
    piece.dynamic = '';
    if (piece.expression) piece.expression = { ...piece.expression, dynamics: [], hairpins: [] };
  }
  if (!c.slurs && piece.expression) piece.expression = { ...piece.expression, slurs: [] };
  if (!chorale) {
    for (const bar of piece.bars) {
      if (c.independence === 'together') bar.lh = alignHands(bar);
      for (const hand of ['rh', 'lh'] as Hand[]) bar[hand] = refit(bar[hand], bar, piece.time.barTicks, c.noteTicks, c.restTicks);
    }
    addRests(piece, c, rng);
    addTies(piece, c, rng);
    clampExpression(piece);
  }
  return piece;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Every way a piece breaks the constraints (empty when it keeps them all). */
export function checkPiece(piece: Piece, c: GenerationConstraints, custom: Customisation): string[] {
  const out: string[] = [];
  const fail = (m: string) => out.length < 20 && out.push(m);
  const chorale = !!piece.bars[0].voices;
  const parts = (bar: Bar): { hand: Hand; notes: Note[] }[] =>
    bar.voices
      ? [
          { hand: 'rh', notes: bar.voices.s },
          { hand: 'rh', notes: bar.voices.a },
          { hand: 'lh', notes: bar.voices.t },
          { hand: 'lh', notes: bar.voices.b },
        ]
      : [
          { hand: 'rh', notes: bar.rh },
          { hand: 'lh', notes: bar.lh },
        ];
  // A note that needs a written accidental: one that differs from the key signature.
  const written = (p: Pitch) => p.alter !== keySignatureAlter(piece.key, p.letter);
  const inRange = (p: Pitch, hand: Hand) => {
    const range = hand === 'rh' ? c.melodyRange : c.bassRange;
    return !range || (midi(p) >= midi(range.low) && midi(p) <= midi(range.high));
  };

  piece.bars.forEach((bar, b) => {
    for (const { hand, notes } of parts(bar)) {
      if (!chorale && notes.reduce((a, n) => a + n.ticks, 0) !== piece.time.barTicks) fail(`bar ${b + 1}: ${hand} does not fill the bar`);
      for (const n of notes) {
        if (n.rest ? !c.restTicks.includes(n.ticks) : !c.noteTicks.includes(n.ticks)) fail(`bar ${b + 1}: a ${n.rest ? 'rest' : 'note'} of ${n.ticks} ticks`);
        const sounding = [...n.pitches, ...(n.grace ?? [])];
        for (const p of sounding) {
          if (!inRange(p, hand)) fail(`bar ${b + 1}: ${pitchName(p)} outside the ${hand === 'rh' ? 'melody' : 'left-hand'} range`);
          if (!c.accidentals && written(p)) fail(`bar ${b + 1}: an accidental (${pitchName(p)})`);
        }
        if (!c.accidentals && n.ornament && [n.ornament.upper, n.ornament.lower].some((p) => p && written(p))) fail(`bar ${b + 1}: an ornament with an accidental`);
        if (!c.ties && n.tie) fail(`bar ${b + 1}: a tie`);
        if (!c.ornaments && (n.grace || n.ornament)) fail(`bar ${b + 1}: an ornament`);
        if (n.articulation && !{ staccato: c.staccato, accent: c.accents, tenuto: c.tenuto }[n.articulation]) fail(`bar ${b + 1}: ${n.articulation}`);
      }
    }
  });
  if (!c.times.includes(piece.time.id) && !(chorale && piece.time.id === '4/4')) fail(`the time signature ${piece.time.id}`);
  if (!c.dynamics && (piece.dynamic || piece.expression?.dynamics.length || piece.expression?.hairpins.length)) fail('dynamics');
  if (!c.slurs && piece.expression?.slurs.length) fail('slurs');

  // Melodic intervals between successive sounding notes of the melody (ties continue a note).
  const melody = piece.bars.flatMap((bar) => (bar.voices ? bar.voices.s : bar.rh));
  let prev: Note | null = null;
  for (const n of melody) {
    if (n.rest) continue;
    if (prev && !prev.tie && !melodicIntervalAllowed(c, prev.pitches[0], n.pitches[0])) {
      fail(`a melodic ${pitchName(prev.pitches[0])}–${pitchName(n.pitches[0])}`);
    }
    prev = n;
  }

  if (!chorale) {
    // The bass at each change of harmony, when the user set the left hand's leaps.
    if (custom.separateHands && custom.bassMaxLeap !== undefined) {
      let last: Pitch | null = null;
      piece.bars.forEach((bar) => {
        for (const h of bar.harmony) {
          const n = soundingAt(bar.lh, h.at);
          if (!n || n.rest) continue;
          const low = n.pitches[0];
          if (last && Math.abs(diatonicIndex(low) - diatonicIndex(last)) > c.bassMaxLeap) fail(`a bass leap ${pitchName(last)}–${pitchName(low)}`);
          last = low;
        }
      });
    }
    if (c.independence === 'together') {
      piece.bars.forEach((bar, b) => {
        const rh = new Set(onsetsOf(bar.rh));
        if (onsetsOf(bar.lh).some((t, i) => !bar.lh[i].rest && !rh.has(t))) fail(`bar ${b + 1}: the hands are not together`);
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const ATTEMPTS = 10;

/**
 * Generates a piece with the user's customisation: validates the settings, generates, applies
 * and verifies — retrying with derived seeds (deterministically) a bounded number of times.
 * Throws a GenerationError explaining what could not be satisfied.
 */
export function generateCustomised(settings: Settings, generate: (s: Settings) => Piece): Piece {
  const custom = settings.custom ?? {};
  const c = resolveConstraints(settings.grade, custom);
  const issues = validateSettings(settings, c);
  if (issues.some((i) => i.severity === 'error')) throw new GenerationError(issues);
  const notices = issues.filter((i) => i.severity === 'warning').map((i) => i.message);
  let problem = '';
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s: Settings = attempt ? { ...settings, seed: `${settings.seed}~${attempt}` } : settings;
    let piece: Piece;
    try {
      piece = applyConstraints(generate(s), c);
    } catch {
      // The style's rules found no music within these limits (e.g. voices with no room to move).
      problem = 'the music could not be fitted within these limits';
      continue;
    }
    const violations = checkPiece(piece, c, custom);
    if (!violations.length) return { ...piece, seed: settings.seed, ...(notices.length ? { notices } : {}) };
    problem = violations[0];
  }
  const failure: ConstraintIssue = {
    severity: 'error',
    area: 'rhythm',
    message: `Couldn't write a piece that keeps all these settings (${problem}). Try allowing more note values or intervals, or a wider range.`,
  };
  throw new GenerationError([...issues, failure]);
}
