/**
 * Engraving: lays out a piece as a two-stave piano score (or a four-voice chorale) with
 * VexFlow — systems of four bars, clefs, key and time signatures, beams, ties, ornaments,
 * dynamics, hairpins and slurs — and reports where each bar is drawn, for highlighting and
 * selection. Bars hidden by Ear Training keep their place but show no notes.
 */
import type * as VF from 'vexflow/bravura';
import { Bar, Note, NoteRef, Piece } from '../music/model';
import { Key, Pitch, keySignatureAlter } from '../music/theory';
import { beamGroups } from './beaming';

/** Logical drawing width; the SVG scales to its container (and to A4 when printing). */
const PAGE_WIDTH = 1100;
const LEFT = 36;
const RIGHT = 12;
const BARS_PER_LINE = 4;
const TOP = 56;
const STAVE_GAP = 110;
const SYSTEM_HEIGHT = 250;

/** How much of the score to show (ear training conceals it). */
export interface ScoreView {
  /** Hide every bar's notes except `revealed` and number the bars; the layout is unchanged. */
  concealed: boolean;
  revealed: ReadonlySet<number>;
  showKey: boolean;
  showTime: boolean;
  showTempo: boolean;
}

/** Bar position as fractions of the drawing, for the playback highlight. */
export interface BarBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DURATIONS: Record<number, { duration: string; dots: number }> = {
  16: { duration: 'w', dots: 0 },
  12: { duration: 'h', dots: 1 },
  8: { duration: 'h', dots: 0 },
  6: { duration: 'q', dots: 1 },
  4: { duration: 'q', dots: 0 },
  3: { duration: '8', dots: 1 },
  2: { duration: '8', dots: 0 },
  1: { duration: '16', dots: 0 },
};

function vexKey(p: Pitch): string {
  const acc = p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
  return `${p.letter.toLowerCase()}${acc}/${p.octave}`;
}

let vexflow: Promise<typeof VF> | undefined;

/** Loads VexFlow (with its embedded Bravura font) on first use, keeping it out of the initial bundle. */
export function loadVexFlow(): Promise<typeof VF> {
  vexflow ??= import('vexflow/bravura').then(async (vf) => {
    await Promise.all([document.fonts.load('30px Bravura'), document.fonts.load('16px Academico')]);
    // Tempo words default to "Bravura,Academico"; Bravura's tiny space glyph squashes
    // "Tempo di valse" together, so use the text font alone.
    (vf.MetricsDefaults['StaveTempo'] as { name: Record<string, unknown> }).name['fontFamily'] = 'Academico';
    vf.Metrics.clear('StaveTempo');
    return vf;
  });
  return vexflow;
}

interface BuiltBar {
  /** One voice per stave for piano music; two (stems up and down) for a chorale. */
  treble: VF.Voice[];
  bass: VF.Voice[];
  beams: VF.Beam[];
  ties: VF.StaveTie[];
  /** The right hand's (or soprano's) notes, for slurs and hairpins. */
  melody: VF.StaveNote[];
}

/** Splits bars into lines of at most BARS_PER_LINE, as evenly as possible (no lonely last bar). */
function lineBreaks(count: number): number[][] {
  const lines = Math.ceil(count / BARS_PER_LINE);
  const out: number[][] = [];
  let next = 0;
  for (let line = 0; line < lines; line++) {
    const size = Math.floor(count / lines) + (line < count % lines ? 1 : 0);
    out.push(Array.from({ length: size }, (_, i) => next + i));
    next += size;
  }
  return out;
}

export function drawPiece(vf: typeof VF, piece: Piece, view: ScoreView, el: HTMLDivElement): BarBox[] {
  const { Renderer, Stave, StaveConnector, Formatter, BarlineType } = vf;
  const layout = lineBreaks(piece.bars.length);
  const lines = layout.length;
  const height = TOP + lines * SYSTEM_HEIGHT - 40;
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(PAGE_WIDTH, height);
  const ctx = renderer.getContext();
  const svg = el.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${PAGE_WIDTH} ${height}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    // VexFlow also sets an inline pixel size; drop it so the SVG scales to its container.
    svg.style.removeProperty('width');
    svg.style.removeProperty('height');
  }

  // The layout is always the sight-reading layout: key and time signatures keep their
  // space even when hidden, and bar widths come from the notes, so every bar stays where
  // it would be in the normal view whether concealed or revealed.
  const keySpec = piece.key.id;
  const timeSpec = `${piece.time.num}/${piece.time.den}`;
  // With the key signature hidden, revealed notes show every accidental explicitly.
  const revealedAccidentals = view.showKey ? keySpec : 'C';
  const boxes: BarBox[] = [];
  const expression = piece.expression;
  // Dynamics by bar, then by right-hand note index.
  const dynamicsByBar = new Map<number, Map<number, string>>();
  for (const d of expression?.dynamics ?? []) {
    if (!dynamicsByBar.has(d.at.bar)) dynamicsByBar.set(d.at.bar, new Map());
    dynamicsByBar.get(d.at.bar)!.set(d.at.index, d.mark);
  }

  for (let line = 0; line < lines; line++) {
    const bars = layout[line].map((i) => piece.bars[i]);
    /** Formatted right-hand notes of this line's visible bars. */
    const lineMelody = new Map<number, VF.StaveNote[]>();
    const y = TOP + line * SYSTEM_HEIGHT;

    // Width taken by clef, key and (first line) time signature.
    const probeT = new Stave(LEFT, y, 400).addClef('treble').addKeySignature(keySpec);
    const probeB = new Stave(LEFT, y + STAVE_GAP, 400).addClef('bass').addKeySignature(keySpec);
    if (line === 0) {
      probeT.addTimeSignature(timeSpec);
      probeB.addTimeSignature(timeSpec);
    }
    Stave.formatBegModifiers([probeT, probeB]);
    const modifierWidth = probeT.getNoteStartX() - LEFT;

    const available = PAGE_WIDTH - LEFT - RIGHT - modifierWidth;
    // Give each bar at least the room its notes need, then share out the rest.
    const minWidths = bars.map((bar) => {
      const built = buildBar(vf, piece, bar, keySpec);
      const formatter = new Formatter().joinVoices(built.treble).joinVoices(built.bass);
      return formatter.preCalculateMinTotalWidth([...built.treble, ...built.bass]) + 36;
    });
    const total = minWidths.reduce((a, b) => a + b, 0);
    // Spare room goes to bars in proportion to their length, so a one-beat upbeat stays narrow.
    const lengths = bars.map((bar) => bar.rh.reduce((a, n) => a + n.ticks, 0));
    const totalLength = lengths.reduce((a, b) => a + b, 0);
    const widths =
      total <= available
        ? minWidths.map((w, i) => w + ((available - total) * lengths[i]) / totalLength)
        : minWidths.map((w) => (w * available) / total);

    let x = LEFT;
    bars.forEach((bar, i) => {
      const barIndex = layout[line][i];
      const first = i === 0;
      const isFinal = barIndex === piece.bars.length - 1;
      const width = widths[i] + (first ? modifierWidth : 0);
      const treble = new Stave(x, y, width);
      const bass = new Stave(x, y + STAVE_GAP, width);
      if (view.concealed) treble.setMeasure(barIndex + 1);
      if (first) {
        treble.addClef('treble').addKeySignature(keySpec);
        bass.addClef('bass').addKeySignature(keySpec);
        if (line === 0) {
          treble.addTimeSignature(timeSpec);
          bass.addTimeSignature(timeSpec);
        }
        if (line === 0 && view.showTempo) {
          const t = piece.tempo;
          treble.setTempo(
            {
              name: t.marking,
              duration: t.beatUnit === 'qd' ? 'q' : t.beatUnit,
              dots: t.beatUnit === 'qd' ? 1 : 0,
              bpm: t.bpm,
            },
            -6,
          );
        }
        Stave.formatBegModifiers([treble, bass]);
      }
      if (isFinal) {
        treble.setEndBarType(BarlineType.END);
        bass.setEndBarType(BarlineType.END);
      }
      treble.setContext(ctx).draw();
      bass.setContext(ctx).draw();

      if (first) {
        new StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
        new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
      }
      new StaveConnector(treble, bass).setType(isFinal ? 'boldDoubleRight' : 'singleRight').setContext(ctx).draw();

      // A concealed bar keeps its staves and barlines but none of its notes.
      if (!view.concealed || view.revealed.has(barIndex)) {
        const dynamics = expression ? dynamicsByBar.get(barIndex) : barIndex === 0 && piece.dynamic ? new Map([[0, piece.dynamic]]) : undefined;
        const built = buildBar(vf, piece, bar, view.concealed ? revealedAccidentals : keySpec, dynamics);
        lineMelody.set(barIndex, built.melody);
        built.treble.forEach((v) => v.setStave(treble));
        built.bass.forEach((v) => v.setStave(bass));
        const justify = treble.getNoteEndX() - treble.getNoteStartX() - 14;
        new Formatter()
          .joinVoices(built.treble)
          .joinVoices(built.bass)
          .format([...built.treble, ...built.bass], justify);
        built.treble.forEach((v) => v.draw(ctx, treble));
        built.bass.forEach((v) => v.draw(ctx, bass));
        built.beams.forEach((b) => b.setContext(ctx).draw());
        built.ties.forEach((t) => t.setContext(ctx).draw());
      }

      const top = y + 10;
      const bottom = y + STAVE_GAP + 90;
      const left = first ? treble.getNoteStartX() - 8 : x;
      boxes[barIndex] = {
        x: left / PAGE_WIDTH,
        y: top / height,
        w: (x + width - left) / PAGE_WIDTH,
        h: (bottom - top) / height,
      };
      x += width;
    });
    drawCrossBarTies(vf, ctx, piece, layout[line], lineMelody, (b) => !view.concealed || view.revealed.has(b));
    if (expression) drawLineMarks(vf, ctx, expression, layout[line], lineMelody, dynamicsByBar);
  }
  // Hidden hints keep their space (so nothing moves) but are not drawn.
  if (svg && !view.showKey) svg.querySelectorAll('.vf-keysignature').forEach((g) => g.setAttribute('visibility', 'hidden'));
  if (svg && !view.showTime) svg.querySelectorAll('.vf-timesignature').forEach((g) => g.setAttribute('visibility', 'hidden'));
  return boxes;
}

/**
 * Right-hand ties over a bar line (a suspension held into the next bar): drawn note to note
 * within a line, or out to the line's end and in from the next line's start.
 */
function drawCrossBarTies(
  vf: typeof VF,
  ctx: VF.RenderContext,
  piece: Piece,
  barsInLine: number[],
  melody: Map<number, VF.StaveNote[]>,
  visible: (bar: number) => boolean,
): void {
  if (piece.bars[0].voices) return;
  const { StaveTie } = vf;
  const tie = (firstNote: VF.StaveNote | null, lastNote: VF.StaveNote | null) =>
    new StaveTie({ firstNote, lastNote, firstIndexes: [0], lastIndexes: [0] }).setContext(ctx).draw();
  const first = barsInLine[0];
  const last = barsInLine[barsInLine.length - 1];
  for (const b of barsInLine) {
    const notes = piece.bars[b].rh;
    if (!notes[notes.length - 1]?.tie || b + 1 >= piece.bars.length || !visible(b) || !visible(b + 1)) continue;
    const from = melody.get(b)?.[notes.length - 1] ?? null;
    if (b < last) tie(from, melody.get(b + 1)?.[0] ?? null);
    else if (from) tie(from, null);
  }
  // A tie arriving from the end of the previous line.
  const before = piece.bars[first - 1]?.rh;
  if (before && before[before.length - 1].tie && visible(first - 1) && visible(first)) {
    const to = melody.get(first)?.[0];
    if (to) tie(null, to);
  }
}

/** The accidental to print on an ornament's note or a grace note, against the key signature. */
function accidentalFor(p: Pitch, key: Key | null): string | null {
  const expected = key ? keySignatureAlter(key, p.letter) : 0;
  if (p.alter === expected) return null;
  return p.alter === 0 ? 'n' : p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter);
}

/**
 * Hairpins and slurs for one line. A mark that runs on from (or to) another line is drawn up
 * to the line's edge; a mark that touches a concealed bar is not drawn at all.
 */
function drawLineMarks(
  vf: typeof VF,
  ctx: VF.RenderContext,
  expression: NonNullable<Piece['expression']>,
  barsInLine: number[],
  melody: Map<number, VF.StaveNote[]>,
  dynamicsByBar: Map<number, Map<number, string>>,
): void {
  const { StaveHairpin, Modifier, Stem } = vf;
  const first = barsInLine[0];
  const last = barsInLine[barsInLine.length - 1];
  const before = (a: NoteRef, b: NoteRef) => a.bar < b.bar || (a.bar === b.bar && a.index < b.index);
  /** The part of a span that lies on this line, or null if it is elsewhere or concealed. */
  const clip = (from: NoteRef, to: NoteRef): [VF.StaveNote, VF.StaveNote, NoteRef, NoteRef] | null => {
    if (to.bar < first || from.bar > last) return null;
    const start = from.bar < first ? { bar: first, index: 0 } : from;
    const end = to.bar > last ? { bar: last, index: (melody.get(last)?.length ?? 1) - 1 } : to;
    for (let b = start.bar; b <= end.bar; b++) if (!melody.has(b)) return null;
    const a = melody.get(start.bar)![start.index];
    const z = melody.get(end.bar)![end.index];
    if (!a || !z || !before(start, end)) return null;
    return [a, z, start, end];
  };
  for (const h of expression.hairpins) {
    const part = clip(h.from, h.to);
    if (!part) continue;
    const [a, z, start, end] = part;
    // Leave room for a dynamic printed at either end.
    const atStart = dynamicsByBar.get(start.bar)?.has(start.index);
    const atEnd = dynamicsByBar.get(end.bar)?.has(end.index);
    new StaveHairpin({ firstNote: a, lastNote: z }, h.type === 'cresc' ? StaveHairpin.type.CRESC : StaveHairpin.type.DECRESC)
      .setPosition(Modifier.Position.BELOW)
      .setRenderOptions({ height: 9, yShift: 8, leftShiftPx: atStart ? 22 : 0, rightShiftPx: atEnd ? -18 : 6 })
      .setContext(ctx)
      .draw();
  }
  // Slurs arch over the melody: from above the first note to above the last, high enough to
  // clear every note (and stem, and accent) in between.
  const centre = (n: VF.StaveNote) => (n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2;
  const topOf = (n: VF.StaveNote) => {
    let top = Math.min(...n.getYs()) - 7;
    if (n.getStemDirection() === Stem.UP && !n.isRest()) top = Math.min(top, n.getStemExtents().topY - 4);
    if (n.getStemDirection() !== Stem.UP && n.getModifiersByType('Articulation').length) top -= 9;
    return top;
  };
  for (const sl of expression.slurs) {
    const part = clip(sl.from, sl.to);
    if (!part) continue;
    const [a, z, start, end] = part;
    const inner: VF.StaveNote[] = [];
    for (let b = start.bar; b <= end.bar; b++) {
      melody.get(b)!.forEach((n, i) => {
        if (before(start, { bar: b, index: i }) && before({ bar: b, index: i }, end)) inner.push(n);
      });
    }
    const x1 = centre(a);
    const x2 = centre(z);
    const y1 = topOf(a);
    const y2 = topOf(z);
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx <= 0) continue;
    // The curve rises 3t(1 − t)·h above the straight line between its ends.
    let h = Math.min(8 + dx * 0.04, 16);
    for (const n of inner) {
      const t = (centre(n) - x1) / dx;
      const lift = 3 * t * (1 - t);
      if (lift < 0.2) continue;
      h = Math.max(h, (y1 + dy * t - topOf(n) + 3) / lift);
    }
    h = Math.min(h, 80);
    const c1x = x1 + dx / 3;
    const c2x = x1 + (2 * dx) / 3;
    const c1y = y1 + dy / 3 - h;
    const c2y = y1 + (2 * dy) / 3 - h;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
    ctx.bezierCurveTo(c2x, c2y - 1.6, c1x, c1y - 1.6, x1, y1);
    ctx.closePath();
    ctx.fill();
  }
}

function buildBar(vf: typeof VF, piece: Piece, bar: Bar, keySpec: string, dynamics?: Map<number, string>): BuiltBar {
  const { Voice, Accidental, Beam, Annotation, Articulation, Modifier, StaveTie, Stem, GraceNote, GraceNoteGroup, Ornament } = vf;
  // Ornament and grace-note accidentals are read against the key signature (if it is shown).
  const key = keySpec === piece.key.id ? piece.key : null;
  const groups = Beam.getDefaultBeamGroups(`${piece.time.num}/${piece.time.den}`);
  const beams: VF.Beam[] = [];
  const ties: VF.StaveTie[] = [];
  /** Ticks (semiquavers) per beat of the time signature's denominator. */
  const unit = 16 / piece.time.den;

  const toVoice = (notes: Note[], clef: 'treble' | 'bass', stem?: number, fermata?: 'above' | 'below') => {
    const staveNotes = notes.map((n) => makeNote(vf, n, clef, stem));
    // Staccato, accent and tenuto sit at the notehead, away from the stem.
    notes.forEach((n, i) => {
      if (!n.articulation || n.rest) return;
      const code = n.articulation === 'staccato' ? 'a.' : n.articulation === 'accent' ? 'a>' : 'a-';
      const up = staveNotes[i].getStemDirection() === Stem.UP;
      staveNotes[i].addModifier(new Articulation(code).setPosition(up ? Modifier.Position.BELOW : Modifier.Position.ABOVE), 0);
    });
    // Grace notes (acciaccaturas) and ornament signs: a turn or a trill.
    notes.forEach((n, i) => {
      if (n.grace?.length) {
        const graces = n.grace.map((g) => {
          const gn = new GraceNote({ keys: [vexKey(g)], duration: '8', slash: true, clef });
          const acc = accidentalFor(g, key);
          if (acc) gn.addModifier(new Accidental(acc), 0);
          return gn;
        });
        const group = new GraceNoteGroup(graces, true);
        if (graces.length > 1) group.beamNotes();
        staveNotes[i].addModifier(group, 0);
      }
      if (n.ornament) {
        const sign = new Ornament(n.ornament.type === 'trill' ? 'tr' : 'turn');
        const upper = accidentalFor(n.ornament.upper, key);
        if (upper) sign.setUpperAccidental(upper);
        const lower = n.ornament.lower && accidentalFor(n.ornament.lower, key);
        if (lower) sign.setLowerAccidental(lower);
        staveNotes[i].addModifier(sign, 0);
      }
    });
    if (fermata) {
      notes.forEach((n, i) => {
        if (!n.fermata) return;
        const mark = new Articulation(fermata === 'above' ? 'a@a' : 'a@u').setPosition(
          fermata === 'above' ? Modifier.Position.ABOVE : Modifier.Position.BELOW,
        );
        staveNotes[i].addModifier(mark, 0);
      });
    }
    notes.forEach((n, i) => {
      if (n.tie && staveNotes[i + 1]) {
        ties.push(new StaveTie({ firstNote: staveNotes[i], lastNote: staveNotes[i + 1], firstIndexes: [0], lastIndexes: [0] }));
      }
    });
    // Bars may be short (a chorale's upbeat and final bar), so size the voice to its notes.
    const ticks = notes.reduce((a, n) => a + n.ticks, 0);
    const voice = new Voice({ numBeats: ticks / unit, beatValue: piece.time.den });
    voice.addTickables(staveNotes);
    if (stem === undefined) {
      // Piano parts: beam groups follow the metre (four quavers together where they fill a
      // half bar), with stems chosen for each beam.
      for (const group of beamGroups(notes, piece.time)) beams.push(new Beam(group.map((i) => staveNotes[i]), true));
    } else {
      beams.push(...Beam.generateBeams(staveNotes, { groups, stemDirection: stem }));
    }
    return { voice, staveNotes };
  };

  let treble: ReturnType<typeof toVoice>[];
  let bass: ReturnType<typeof toVoice>[];
  if (bar.voices) {
    // Chorale: soprano (stems up) and alto (down) share the treble stave; tenor and bass the bass stave.
    treble = [toVoice(bar.voices.s, 'treble', Stem.UP, 'above'), toVoice(bar.voices.a, 'treble', Stem.DOWN)];
    bass = [toVoice(bar.voices.t, 'bass', Stem.UP), toVoice(bar.voices.b, 'bass', Stem.DOWN, 'below')];
  } else {
    treble = [toVoice(bar.rh, 'treble')];
    bass = [toVoice(bar.lh, 'bass')];
  }
  Accidental.applyAccidentals(treble.map((v) => v.voice), keySpec);
  Accidental.applyAccidentals(bass.map((v) => v.voice), keySpec);
  for (const [index, text] of dynamics ?? []) {
    const note = treble[0].staveNotes[index];
    if (!note) continue;
    const mark = new Annotation(text)
      .setFont('Academico', 17, 'bold', 'italic')
      .setVerticalJustification(Annotation.VerticalJustify.BOTTOM);
    note.addModifier(mark, 0);
  }
  return {
    treble: treble.map((v) => v.voice),
    bass: bass.map((v) => v.voice),
    beams,
    ties,
    melody: treble[0].staveNotes,
  };
}

function makeNote(vf: typeof VF, n: Note, clef: 'treble' | 'bass', stem?: number): VF.StaveNote {
  const { StaveNote, Dot } = vf;
  const d = DURATIONS[n.ticks];
  if (!d) throw new Error(`No notation for a duration of ${n.ticks} semiquavers`);
  const note = n.rest
    ? new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: d.duration, dots: d.dots, type: 'r', clef })
    : new StaveNote({
        keys: n.pitches.map(vexKey),
        duration: d.duration,
        dots: d.dots,
        clef,
        ...(stem === undefined ? { autoStem: true } : { stemDirection: stem }),
      });
  if (d.dots) Dot.buildAndAttach([note], { all: true });
  return note;
}
