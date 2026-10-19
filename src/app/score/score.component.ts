import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type * as VF from 'vexflow/bravura';
import { Bar, Note, Piece } from '../music/generator';
import { Pitch } from '../music/theory';

/** Logical drawing width; the SVG scales to its container (and to A4 when printing). */
const PAGE_WIDTH = 1100;
const LEFT = 36;
const RIGHT = 12;
const BARS_PER_LINE = 4;
const TOP = 56;
const STAVE_GAP = 110;
const SYSTEM_HEIGHT = 250;

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
function loadVexFlow(): Promise<typeof VF> {
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

@Component({
  selector: 'app-score',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // VexFlow inserts the SVG itself, so styles must reach it without view encapsulation.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="score" #host role="img" [attr.aria-label]="label()"></div>
    @if (highlight(); as box) {
      <div
        class="highlight"
        [style.left.%]="box.x * 100"
        [style.top.%]="box.y * 100"
        [style.width.%]="box.w * 100"
        [style.height.%]="box.h * 100"
      ></div>
    }
    @if (error()) {
      <p class="error">The score could not be drawn: {{ error() }}</p>
    }
  `,
  styles: `
    app-score {
      display: block;
      position: relative;
    }
    app-score .score svg {
      display: block;
      width: 100%;
      height: auto;
    }
    app-score .highlight {
      position: absolute;
      background: var(--highlight, rgb(255 196 0 / 0.22));
      border-radius: 4px;
      pointer-events: none;
    }
    app-score .error {
      color: #b3261e;
    }
    @media print {
      app-score .highlight {
        display: none;
      }
    }
  `,
})
export class ScoreComponent {
  readonly piece = input.required<Piece>();
  /** Index of the bar to highlight during playback, or null. */
  readonly activeBar = input<number | null>(null);

  protected readonly error = signal('');
  private readonly boxes = signal<BarBox[]>([]);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private renderToken = 0;

  protected readonly label = () => `Sheet music: ${this.piece().title}`;
  protected readonly highlight = () => {
    const i = this.activeBar();
    return i === null ? null : (this.boxes()[i] ?? null);
  };

  constructor() {
    effect(() => {
      const piece = this.piece();
      const el = this.host().nativeElement;
      void this.render(piece, el);
    });
  }

  private async render(piece: Piece, el: HTMLDivElement): Promise<void> {
    const token = ++this.renderToken;
    // Font loading needs a real browser (not jsdom in unit tests).
    if (typeof document === 'undefined' || !document.fonts) return;
    try {
      const vf = await loadVexFlow();
      if (token !== this.renderToken) return;
      el.replaceChildren();
      this.boxes.set(drawPiece(vf, piece, el));
      this.error.set('');
    } catch (e) {
      console.error(e);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}

interface BuiltBar {
  rh: VF.Voice;
  lh: VF.Voice;
  beams: VF.Beam[];
}

function drawPiece(vf: typeof VF, piece: Piece, el: HTMLDivElement): BarBox[] {
  const { Renderer, Stave, StaveConnector, Formatter, BarlineType } = vf;
  const lines = Math.ceil(piece.bars.length / BARS_PER_LINE);
  const height = TOP + lines * SYSTEM_HEIGHT - 40;
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(PAGE_WIDTH, height);
  const ctx = renderer.getContext();
  const svg = el.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${PAGE_WIDTH} ${height}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
  }

  const keySpec = piece.key.id;
  const timeSpec = `${piece.time.num}/${piece.time.den}`;
  const boxes: BarBox[] = [];

  for (let line = 0; line < lines; line++) {
    const bars = piece.bars.slice(line * BARS_PER_LINE, (line + 1) * BARS_PER_LINE);
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

    // Give each bar at least the room its notes need, then share out the rest evenly.
    const minWidths = bars.map((bar) => {
      const built = buildBar(vf, piece, bar, keySpec);
      const formatter = new Formatter().joinVoices([built.rh]).joinVoices([built.lh]);
      return formatter.preCalculateMinTotalWidth([built.rh, built.lh]) + 36;
    });
    const available = PAGE_WIDTH - LEFT - RIGHT - modifierWidth;
    const total = minWidths.reduce((a, b) => a + b, 0);
    const widths =
      total <= available
        ? minWidths.map((w) => w + (available - total) / bars.length)
        : minWidths.map((w) => (w * available) / total);

    let x = LEFT;
    bars.forEach((bar, i) => {
      const barIndex = line * BARS_PER_LINE + i;
      const first = i === 0;
      const isFinal = barIndex === piece.bars.length - 1;
      const width = widths[i] + (first ? modifierWidth : 0);
      const treble = new Stave(x, y, width);
      const bass = new Stave(x, y + STAVE_GAP, width);
      if (first) {
        treble.addClef('treble').addKeySignature(keySpec);
        bass.addClef('bass').addKeySignature(keySpec);
        if (line === 0) {
          treble.addTimeSignature(timeSpec);
          bass.addTimeSignature(timeSpec);
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

      const built = buildBar(vf, piece, bar, keySpec, barIndex === 0 ? piece.dynamic : undefined);
      built.rh.setStave(treble);
      built.lh.setStave(bass);
      const justify = treble.getNoteEndX() - treble.getNoteStartX() - 14;
      new Formatter().joinVoices([built.rh]).joinVoices([built.lh]).format([built.rh, built.lh], justify);
      built.rh.draw(ctx, treble);
      built.lh.draw(ctx, bass);
      built.beams.forEach((b) => b.setContext(ctx).draw());

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
  }
  return boxes;
}

function buildBar(vf: typeof VF, piece: Piece, bar: Bar, keySpec: string, dynamic?: string): BuiltBar {
  const { Voice, Accidental, Beam, Annotation } = vf;
  const toVoice = (notes: Note[], clef: 'treble' | 'bass') => {
    const staveNotes = notes.map((n) => makeNote(vf, n, clef));
    const voice = new Voice({ numBeats: piece.time.num, beatValue: piece.time.den });
    voice.addTickables(staveNotes);
    Accidental.applyAccidentals([voice], keySpec);
    return { voice, staveNotes };
  };
  const rh = toVoice(bar.rh, 'treble');
  const lh = toVoice(bar.lh, 'bass');
  if (dynamic) {
    const mark = new Annotation(dynamic)
      .setFont('Academico', 17, 'bold', 'italic')
      .setVerticalJustification(Annotation.VerticalJustify.BOTTOM);
    rh.staveNotes[0].addModifier(mark, 0);
  }
  const groups = Beam.getDefaultBeamGroups(`${piece.time.num}/${piece.time.den}`);
  const beams = [
    ...Beam.generateBeams(rh.staveNotes, { groups }),
    ...Beam.generateBeams(lh.staveNotes, { groups }),
  ];
  return { rh: rh.voice, lh: lh.voice, beams };
}

function makeNote(vf: typeof VF, n: Note, clef: 'treble' | 'bass'): VF.StaveNote {
  const { StaveNote, Dot } = vf;
  const d = DURATIONS[n.ticks];
  if (!d) throw new Error(`No notation for a duration of ${n.ticks} semiquavers`);
  const note = n.rest
    ? new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: d.duration, dots: d.dots, type: 'r', clef })
    : new StaveNote({ keys: n.pitches.map(vexKey), duration: d.duration, dots: d.dots, clef, autoStem: true });
  if (d.dots) Dot.buildAndAttach([note], { all: true });
  return note;
}
