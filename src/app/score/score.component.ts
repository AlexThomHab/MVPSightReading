import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Piece, Staff } from '../music/model';
import { isPlain } from '../music/durations';
import { Pitch, diatonicIndex } from '../music/theory';
import { BarBox, BarMarks, Drawing, ScoreView, drawPiece, loadVexFlow } from './engraving';
import { DOT, FLAG_DOWN, FLAG_UP, REST, headFor } from './glyphs';
import { InputTarget, TOP_LINE, elementAt, geometryOf, inputTargetAt, ledgerLines, yOf } from './hit-test';

/** A note or rest in the listener's transcription. */
export interface NoteRefOnScore {
  bar: number;
  staff: Staff;
  index: number;
}

/** Note input's state, as the score needs it to draw the ghost note and the input cursor. */
export interface NoteInputView {
  /** Note input mode is on. */
  active: boolean;
  /** The next note's length (ticks) and whether it is a rest. */
  ticks: number;
  rest: boolean;
  cursor: { bar: number; staff: Staff; tick: number } | null;
  selected: NoteRefOnScore | null;
}

/** An expected note the listener left out, drawn when reviewing mistakes. */
export interface MissingOnScore {
  bar: number;
  staff: Staff;
  tick: number;
  ticks: number;
  pitch: Pitch;
}


/**
 * The score: renders a piece (see engraving.ts). In Ear Training it also covers hidden bars,
 * lets the listener select bars (click, drag or keyboard) or a note of their own, and — in
 * note input — shows a ghost of the next note under the pointer and writes it on a click.
 */
@Component({
  selector: 'app-score',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // VexFlow inserts the SVG itself, so styles must reach it without view encapsulation.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="score" #host role="img" [attr.aria-label]="label()"></div>
    @if (concealed()) {
      @for (box of boxes(); track $index) {
        <button
          type="button"
          class="bar-target"
          [attr.data-bar]="$index"
          [class.hidden-bar]="!revealedSet().has($index)"
          [class.selected]="isSelected($index)"
          [style.left.%]="box.x * 100"
          [style.top.%]="box.y * 100"
          [style.width.%]="box.w * 100"
          [style.height.%]="box.h * 100"
          [attr.aria-label]="'Bar ' + ($index + 1) + (revealedSet().has($index) ? ', revealed' : ', hidden')"
          [attr.aria-pressed]="isSelected($index)"
          (pointerdown)="onPointerDown($event, $index)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="drag = null"
          (click)="onKeyboardClick($event, $index)"
        ></button>
      }
    }
    <!-- The selected bars: a bracket over them, from the first to the last (one per line of music). -->
    @for (span of selectionSpans(); track $index) {
      <div
        class="selection-span"
        [class.continues]="span.continues"
        [class.continued]="span.continued"
        [style.left.%]="span.left"
        [style.top.%]="span.top"
        [style.width.%]="span.width"
      ></div>
    }
    @if (highlight(); as box) {
      <div
        class="highlight"
        [style.left.%]="box.x * 100"
        [style.top.%]="box.y * 100"
        [style.width.%]="box.w * 100"
        [style.height.%]="box.h * 100"
      ></div>
    }
    @if (concealed() && drawing(); as d) {
      <svg class="input-overlay" [attr.viewBox]="'0 0 ' + d.width + ' ' + d.height" aria-hidden="true">
        @if (selectionBox(); as s) {
          <rect class="note-selection" [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.w" [attr.height]="s.h" rx="3" />
        }
        @if (cursorBox(); as c) {
          <rect class="input-cursor" [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.w" [attr.height]="c.h" rx="2" />
        }
        @for (w of wrongMarks(); track $index) {
          <text class="wrong-mark" [attr.x]="w.x" [attr.y]="w.y" text-anchor="middle">✗</text>
        }
        @for (m of missingNotes(); track $index) {
          <g class="missing-note">
            @for (ly of m.ledgers; track ly) {
              <line [attr.x1]="m.x - 5" [attr.x2]="m.x + 17" [attr.y1]="ly" [attr.y2]="ly" />
            }
            <text [attr.x]="m.x" [attr.y]="m.y">{{ m.glyph }}</text>
          </g>
        }
        @if (ghost(); as g) {
          <g class="ghost" [class.invalid]="!g.fits">
            <!-- The span of the bar the note will take. -->
            <rect class="span" [attr.x]="g.x - 3" [attr.y]="g.top - 14" [attr.width]="g.spanW" height="68" rx="3" />
            @for (ly of g.ledgers; track ly) {
              <line [attr.x1]="g.x - 5" [attr.x2]="g.x + 17" [attr.y1]="ly" [attr.y2]="ly" />
            }
            @if (g.stem; as st) {
              <line class="stem" [attr.x1]="st.x" [attr.x2]="st.x" [attr.y1]="st.y1" [attr.y2]="st.y2" />
            }
            <text [attr.x]="g.x" [attr.y]="g.y">{{ g.glyph }}</text>
            @if (g.flag; as f) {
              <text [attr.x]="f.x" [attr.y]="f.y">{{ f.glyph }}</text>
            }
            @if (g.dot; as dt) {
              <text [attr.x]="dt.x" [attr.y]="dt.y">{{ dotGlyph }}</text>
            }
            @if (!g.fits) {
              <text class="warning" [attr.x]="g.x - 3" [attr.y]="g.top - 20">Too long for this bar</text>
            }
          </g>
        }
      </svg>
    }
    @if (tip(); as t) {
      <div class="note-tip" role="status" [style.left.%]="t.left" [style.top.%]="t.top">
        @for (line of t.lines; track $index) {
          <div>{{ line }}</div>
        }
      </div>
    }
    @if (concealed() && noteInput()?.active) {
      <div
        class="input-surface"
        (pointermove)="onInputMove($event)"
        (pointerleave)="pointer.set(null)"
        (pointerdown)="onInputDown($event)"
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
    /* The bar being played: a light wash of yellow, the same in both modes. */
    app-score .highlight {
      position: absolute;
      background: rgb(255 196 0 / 0.12);
      border-radius: 4px;
      pointer-events: none;
    }
    app-score .bar-target {
      position: absolute;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 4px;
      background-color: transparent;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      /* Dragging across bars selects them, rather than scrolling the page. */
      touch-action: none;
    }
    app-score .bar-target.hidden-bar {
      background-image: repeating-linear-gradient(135deg, rgb(120 110 100 / 0.05) 0 8px, rgb(120 110 100 / 0.1) 8px 16px);
    }
    app-score .bar-target:hover {
      border-color: rgb(138 59 18 / 0.35);
    }
    /* The selection: a thin bracket above the bars, open where it carries on to another line. */
    app-score .selection-span {
      position: absolute;
      height: 8px;
      border: 2px solid var(--accent, #8a3b12);
      border-bottom: 0;
      border-radius: 3px 3px 0 0;
      pointer-events: none;
    }
    app-score .selection-span.continues {
      border-right: 0;
      border-top-right-radius: 0;
    }
    app-score .selection-span.continued {
      border-left: 0;
      border-top-left-radius: 0;
    }
    /* No focus box round a bar: the bracket above shows what is selected. */
    app-score .bar-target:focus,
    app-score .bar-target:focus-visible {
      outline: none;
    }
    /* Note input: the ghost note, the input cursor and the selected note, drawn over the score. */
    app-score .input-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: auto;
      pointer-events: none;
    }
    app-score .ghost text {
      font-family: Bravura, serif;
      font-size: 40px;
      fill: rgb(28 103 209 / 0.6);
    }
    app-score .ghost line {
      stroke: rgb(28 103 209 / 0.6);
      stroke-width: 1.3;
    }
    app-score .ghost line.stem {
      stroke-width: 1.2;
    }
    app-score .ghost .span {
      fill: rgb(28 103 209 / 0.08);
      stroke: rgb(28 103 209 / 0.35);
      stroke-dasharray: 3 3;
    }
    app-score .ghost.invalid text {
      fill: rgb(217 48 37 / 0.6);
    }
    app-score .ghost.invalid line {
      stroke: rgb(217 48 37 / 0.6);
    }
    app-score .ghost.invalid .span {
      fill: rgb(217 48 37 / 0.06);
      stroke: rgb(217 48 37 / 0.5);
    }
    app-score .ghost text.warning {
      font-family: var(--sans, sans-serif);
      font-size: 12px;
      font-weight: 600;
      fill: rgb(217 48 37);
    }
    /* Review Mistakes: the notes left out, in orange. */
    app-score .missing-note text {
      font-family: Bravura, serif;
      font-size: 40px;
      fill: rgb(227 116 0 / 0.85);
    }
    app-score .missing-note line {
      stroke: rgb(227 116 0 / 0.85);
      stroke-width: 1.3;
    }
    app-score .wrong-mark {
      font-family: var(--sans, sans-serif);
      font-size: 13px;
      font-weight: 700;
      fill: #d93025;
    }
    /* What is wrong with the selected note, after checking. */
    app-score .note-tip {
      position: absolute;
      transform: translate(-50%, 8px);
      max-width: 280px;
      padding: 6px 10px;
      border-radius: 6px;
      background: #1d1b19;
      color: #fff;
      font-size: 0.8rem;
      line-height: 1.35;
      pointer-events: none;
      white-space: normal;
      z-index: 2;
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
    }
    app-score .input-cursor {
      fill: rgb(28 103 209 / 0.12);
      stroke: rgb(28 103 209 / 0.7);
      stroke-width: 1.2;
    }
    app-score .note-selection {
      fill: rgb(28 103 209 / 0.16);
      stroke: rgb(28 103 209);
      stroke-width: 1.4;
    }
    app-score .input-surface {
      position: absolute;
      inset: 0;
      cursor: crosshair;
      touch-action: none;
    }
    app-score .error {
      color: #b3261e;
    }
    @media print {
      app-score .bar-target,
      app-score .selection-span,
      app-score .highlight,
      app-score .input-overlay,
      app-score .note-tip,
      app-score .input-surface {
        display: none;
      }
    }
  `,
})
export class ScoreComponent {
  readonly piece = input.required<Piece>();
  /** Index of the bar to highlight during playback, or null. */
  readonly activeBar = input<number | null>(null);
  /** Ear training: number the bars and make them selectable; hidden bars hold the listener's notes. */
  readonly concealed = input(false);
  /** Bars (0-based) showing the original music while concealed. */
  readonly revealed = input<readonly number[]>([]);
  /** Selected bars (0-based, inclusive), outlined while concealed. */
  readonly selection = input<{ from: number; to: number } | null>(null);
  /** Note input (Ear Training), or null when the score is not editable. */
  readonly noteInput = input<NoteInputView | null>(null);
  /** Checked answers: green and red noteheads, by bar. */
  readonly marks = input<ReadonlyMap<number, BarMarks> | undefined>(undefined);
  /** Checked answers: what to say about a selected note ("bar:staff:index" → lines). */
  readonly feedback = input<ReadonlyMap<string, string[]>>(new Map());
  /** Review Mistakes: the expected notes the listener left out. */
  readonly missing = input<readonly MissingOnScore[]>([]);
  /** Checked answers: the listener's notes with something wrong (a cross above each). */
  readonly wrong = input<readonly NoteRefOnScore[]>([]);
  /** A bar was clicked (or activated from the keyboard) without dragging. */
  readonly barClick = output<number>();
  /** A drag from one bar to another (emitted continuously while dragging). */
  readonly barDrag = output<{ anchor: number; bar: number }>();
  /** A click on one of the listener's notes (or rests) outside note input; null for elsewhere. */
  readonly noteClick = output<NoteRefOnScore | null>();
  /** A click on the stave in note input: where, and whether Shift was held (add to the chord). */
  readonly inputClick = output<{ target: InputTarget; chord: boolean }>();

  /** The drag in progress: the bar it started on and whether it has left that bar yet. */
  protected drag: { anchor: number; moved: boolean; pointerId: number } | null = null;

  protected readonly error = signal('');
  protected readonly boxes = signal<BarBox[]>([]);
  protected readonly drawing = signal<Drawing | null>(null);
  /** The pointer over the score in note input (score units), or null when it is elsewhere. */
  protected readonly pointer = signal<{ x: number; y: number } | null>(null);
  /** Where note input would write under the pointer: snapped to the next note's rhythmic grid. */
  protected readonly hover = computed<InputTarget | null>(
    () => {
      const p = this.pointer();
      const d = this.drawing();
      const input = this.noteInput();
      if (!p || !d || !input?.active) return null;
      const t = inputTargetAt(d.bars, p.x, p.y, input.ticks, this.piece().time.compound);
      return t && this.editable(t.bar) ? t : null;
    },
    // Only a change of place, pitch or fit redraws the ghost.
    { equal: (a, b) => a?.bar === b?.bar && a?.staff === b?.staff && a?.tick === b?.tick && a?.diatonic === b?.diatonic && a?.fits === b?.fits && a?.endX === b?.endX },
  );
  protected readonly revealedSet = computed(() => new Set(this.revealed()));
  protected readonly dotGlyph = DOT;
  private readonly view = computed<ScoreView>(() => ({
    concealed: this.concealed(),
    revealed: this.revealedSet(),
    marks: this.marks(),
  }));
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private renderToken = 0;

  // While concealed the title (which names the key and style) must not leak through the label.
  protected readonly label = () =>
    this.concealed() ? `Concealed score, ${this.piece().bars.length} bars` : `Sheet music: ${this.piece().title}`;
  protected isSelected(bar: number): boolean {
    const s = this.selection();
    return s !== null && bar >= s.from && bar <= s.to;
  }

  private editable(bar: number): boolean {
    return this.concealed() && !this.revealedSet().has(bar);
  }

  /** A pointer position in score units (the drawing's own coordinates). */
  private toScore(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const d = this.drawing();
    const svg = this.host().nativeElement.querySelector('svg');
    if (!d || !svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: ((event.clientX - r.left) * d.width) / r.width, y: ((event.clientY - r.top) * d.height) / r.height };
  }

  protected onPointerDown(event: PointerEvent, bar: number): void {
    if (event.button !== 0) return;
    // A click on one of the listener's own notes selects it (as in MuseScore), not the bar.
    const p = this.toScore(event);
    const d = this.drawing();
    const hit = p && d ? elementAt(d.bars, p.x, p.y) : null;
    if (hit && this.editable(hit.bar)) {
      this.noteClick.emit(hit);
      return;
    }
    if (this.noteInput()?.selected) this.noteClick.emit(null);
    // Capture the pointer so the drag carries on across bars and onto the next system.
    (event.target as Element).setPointerCapture?.(event.pointerId);
    this.drag = { anchor: bar, moved: false, pointerId: event.pointerId };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const bar = this.barAt(event.clientX, event.clientY);
    if (bar === null || (bar === this.drag.anchor && !this.drag.moved)) return;
    this.drag.moved = true;
    this.barDrag.emit({ anchor: this.drag.anchor, bar });
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (!this.drag.moved) this.barClick.emit(this.drag.anchor);
    this.drag = null;
  }

  /** Enter or Space on a focused bar (a pointer click is handled by the pointer events). */
  protected onKeyboardClick(event: MouseEvent, bar: number): void {
    if (event.detail === 0) this.barClick.emit(bar);
  }

  protected onInputMove(event: PointerEvent): void {
    this.pointer.set(this.toScore(event));
  }

  protected onInputDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.onInputMove(event);
    const target = this.hover();
    if (target) this.inputClick.emit({ target, chord: event.shiftKey });
  }

  /** The bar under a point on screen, if any. */
  private barAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.bar-target');
    if (!el || !this.element.nativeElement.contains(el)) return null;
    const bar = el.dataset['bar'];
    return bar === undefined ? null : Number(bar);
  }

  /** The selected bars as one bracket per line of music (in percent of the drawing). */
  protected readonly selectionSpans = computed(() => {
    const s = this.selection();
    const boxes = this.boxes();
    if (!this.concealed() || !s || !boxes[s.from] || !boxes[s.to]) return [];
    const spans: { left: number; top: number; width: number; continues: boolean; continued: boolean }[] = [];
    let first = s.from;
    for (let bar = s.from; bar <= s.to; bar++) {
      const next = boxes[bar + 1];
      // A line of music ends at the last selected bar, or where the next bar starts a new line.
      if (bar === s.to || !next || Math.abs(next.y - boxes[bar].y) > 1e-6) {
        const a = boxes[first];
        const b = boxes[bar];
        spans.push({ left: a.x * 100, top: a.y * 100, width: (b.x + b.w - a.x) * 100, continues: bar < s.to, continued: first > s.from });
        first = bar + 1;
      }
    }
    return spans;
  });

  protected readonly highlight = () => {
    const i = this.activeBar();
    return i === null ? null : (this.boxes()[i] ?? null);
  };

  /** The ghost of the next note (or rest) under the pointer, as MuseScore shows it. */
  protected readonly ghost = computed(() => {
    const input = this.noteInput();
    const t = this.hover();
    const d = this.drawing();
    if (!input?.active || !t || !d) return null;
    const g = d.bars.find((b) => b.bar === t.bar);
    if (!g) return null;
    const top = t.staff === 'rh' ? g.rhTop : g.lhTop;
    const x = t.x;
    const frame = { top, fits: t.fits, spanW: Math.max(18, t.endX - t.x) };
    const dotted = !isPlain(input.ticks);
    const base = dotted ? input.ticks / 1.5 : input.ticks;
    if (input.rest) {
      // A semibreve rest hangs from the fourth line; the others sit round the middle line.
      const y = top + (base === 16 ? 10 : 20);
      return { ...frame, x, y, glyph: REST[base] ?? REST[4], ledgers: [], stem: null, flag: null, dot: dotted ? { x: x + 16, y: top + 15 } : null };
    }
    const y = yOf(t.staff, top, t.diatonic);
    const up = t.diatonic < TOP_LINE[t.staff] - 4;
    const head = headFor(base);
    const stemX = up ? x + 11.2 : x + 0.6;
    const stemEnd = up ? y - 35 : y + 35;
    const flags = up ? FLAG_UP : FLAG_DOWN;
    const onLine = (TOP_LINE[t.staff] - t.diatonic) % 2 === 0;
    return {
      ...frame,
      x,
      y,
      glyph: head,
      ledgers: ledgerLines(t.staff, top, t.diatonic),
      stem: base < 16 ? { x: stemX, y1: y, y2: stemEnd } : null,
      flag: flags[base] ? { x: stemX - 0.6, y: stemEnd, glyph: flags[base] } : null,
      dot: dotted ? { x: x + (base >= 16 ? 21 : 16), y: onLine ? y - 5 : y } : null,
    };
  });

  /** Where note input will write next: a box round that slot (MuseScore's blue cursor). */
  protected readonly cursorBox = computed(() => {
    const input = this.noteInput();
    const d = this.drawing();
    const c = input?.cursor;
    if (!input?.active || !c || !d) return null;
    const g = d.bars.find((b) => b.bar === c.bar);
    const e = g?.elements.find((el) => el.staff === c.staff && Math.abs(el.tick - c.tick) < 1e-6);
    if (!g || !e) return null;
    const top = c.staff === 'rh' ? g.rhTop : g.lhTop;
    return { x: e.x - 6, y: top - 12, w: Math.max(e.w, 12) + 12, h: 64 };
  });

  /** The selected note or rest, outlined. */
  protected readonly selectionBox = computed(() => {
    const s = this.noteInput()?.selected;
    const d = this.drawing();
    if (!s || !d || !this.editable(s.bar)) return null;
    const found = geometryOf(d.bars, s.bar, s.staff, s.index);
    if (!found) return null;
    const { e } = found;
    const pad = e.rest ? 12 : 8;
    return { x: e.x - 4, y: e.ys[0] - pad, w: e.w + 8, h: e.ys[e.ys.length - 1] - e.ys[0] + pad * 2 };
  });

  /** The left-out notes, placed where they belong in the listener's bar. */
  protected readonly missingNotes = computed(() => {
    const d = this.drawing();
    if (!d) return [];
    return this.missing().flatMap((m) => {
      const g = d.bars.find((b) => b.bar === m.bar);
      const own = g?.elements.filter((e) => e.staff === m.staff).sort((a, b) => a.tick - b.tick);
      if (!g || !own?.length) return [];
      // Between the elements either side of the tick, in proportion.
      let x = own[0].x;
      own.forEach((e, i) => {
        const next = own[i + 1];
        const end = next ? next.tick : e.tick + e.ticks;
        const endX = next ? next.x : g.right - 12;
        if (m.tick >= e.tick - 1e-6 && m.tick < end - 1e-6) x = e.x + ((m.tick - e.tick) / (end - e.tick)) * (endX - e.x);
      });
      const top = m.staff === 'rh' ? g.rhTop : g.lhTop;
      const D = diatonicIndex(m.pitch);
      const head = headFor(m.ticks);
      return [{ x, y: yOf(m.staff, top, D), glyph: head, ledgers: ledgerLines(m.staff, top, D) }];
    });
  });

  /** A cross above each wrong note, so a mistake is not shown by colour alone. */
  protected readonly wrongMarks = computed(() => {
    const d = this.drawing();
    if (!d) return [];
    return this.wrong().flatMap((w) => {
      const found = geometryOf(d.bars, w.bar, w.staff, w.index);
      if (!found) return [];
      const { e, g } = found;
      const top = w.staff === 'rh' ? g.rhTop : g.lhTop;
      return [{ x: e.x + e.w / 2, y: Math.min(e.ys[0] - 12, top - 6) }];
    });
  });

  /** The selected note's feedback, under it. */
  protected readonly tip = computed(() => {
    const s = this.noteInput()?.selected;
    const box = this.selectionBox();
    const d = this.drawing();
    if (!s || !box || !d) return null;
    const lines = this.feedback().get(`${s.bar}:${s.staff}:${s.index}`);
    if (!lines?.length) return null;
    return { left: ((box.x + box.w / 2) / d.width) * 100, top: ((box.y + box.h) / d.height) * 100, lines };
  });

  constructor() {
    effect(() => {
      const piece = this.piece();
      const view = this.view();
      const el = this.host().nativeElement;
      void this.render(piece, view, el);
    });
  }

  private async render(piece: Piece, view: ScoreView, el: HTMLDivElement): Promise<void> {
    const token = ++this.renderToken;
    // Font loading needs a real browser (not jsdom in unit tests).
    if (typeof document === 'undefined' || !document.fonts) return;
    try {
      const vf = await loadVexFlow();
      if (token !== this.renderToken) return;
      el.replaceChildren();
      const drawing = drawPiece(vf, piece, view, el);
      this.boxes.set(drawing.boxes);
      this.drawing.set(drawing);
      this.error.set('');
    } catch (e) {
      console.error(e);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
