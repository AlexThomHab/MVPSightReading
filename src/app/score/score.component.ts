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
import { Piece } from '../music/model';
import { BarBox, Drawing, ScoreView, drawPiece, loadVexFlow } from './engraving';
import { InputTarget, Staff, TOP_LINE, elementAt, geometryOf, inputTargetAt, ledgerLines, yOf } from './hit-test';

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

// SMuFL (Bravura) glyphs for the ghost note.
const HEAD: Record<string, string> = { whole: '', half: '', black: '' };
const REST: Record<number, string> = { 16: '', 8: '', 4: '', 2: '', 1: '', 0.5: '' };
const FLAG_UP: Record<number, string> = { 2: '', 1: '', 0.5: '' };
const FLAG_DOWN: Record<number, string> = { 2: '', 1: '', 0.5: '' };
const DOT = '';
const PLAIN = [16, 8, 4, 2, 1, 0.5];

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
    @if (highlight(); as box) {
      <div
        class="highlight"
        [class.ear]="concealed()"
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
        @if (ghost(); as g) {
          <g class="ghost">
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
          </g>
        }
      </svg>
    }
    @if (concealed() && noteInput()?.active) {
      <div
        class="input-surface"
        (pointermove)="onInputMove($event)"
        (pointerleave)="hover.set(null)"
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
    app-score .highlight {
      position: absolute;
      background: var(--highlight, rgb(255 196 0 / 0.22));
      border-radius: 4px;
      pointer-events: none;
    }
    /* The playing bar in ear training: a bar under the bar, distinct from the selection. */
    app-score .highlight.ear {
      background: rgb(255 196 0 / 0.18);
      box-shadow: inset 0 -5px 0 rgb(214 150 0);
      border-radius: 0 0 4px 4px;
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
    app-score .bar-target.selected {
      border-color: var(--accent, #8a3b12);
      background-color: rgb(138 59 18 / 0.1);
    }
    app-score .bar-target:focus-visible {
      outline: 2px solid var(--accent, #8a3b12);
      outline-offset: 2px;
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
      app-score .highlight,
      app-score .input-overlay,
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
  readonly showKey = input(true);
  readonly showTime = input(true);
  readonly showTempo = input(true);
  /** Selected bars (0-based, inclusive), outlined while concealed. */
  readonly selection = input<{ from: number; to: number } | null>(null);
  /** Note input (Ear Training), or null when the score is not editable. */
  readonly noteInput = input<NoteInputView | null>(null);
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
  /** Where note input would write under the pointer. */
  protected readonly hover = signal<InputTarget | null>(null);
  protected readonly revealedSet = computed(() => new Set(this.revealed()));
  protected readonly dotGlyph = DOT;
  private readonly view = computed<ScoreView>(() => ({
    concealed: this.concealed(),
    revealed: this.revealedSet(),
    showKey: this.showKey(),
    showTime: this.showTime(),
    showTempo: this.showTempo(),
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
    const p = this.toScore(event);
    const d = this.drawing();
    const t = p && d ? inputTargetAt(d.bars, p.x, p.y) : null;
    const target = t && this.editable(t.bar) ? t : null;
    const h = this.hover();
    // Only a change of slot or pitch redraws the ghost.
    if (h?.bar !== target?.bar || h?.staff !== target?.staff || h?.index !== target?.index || h?.diatonic !== target?.diatonic) this.hover.set(target);
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
    const found = geometryOf(d.bars, t.bar, t.staff, t.index);
    if (!found) return null;
    const top = t.staff === 'rh' ? found.g.rhTop : found.g.lhTop;
    const x = found.e.x;
    const dotted = !PLAIN.includes(input.ticks);
    const base = dotted ? input.ticks / 1.5 : input.ticks;
    if (input.rest) {
      // A semibreve rest hangs from the fourth line; the others sit round the middle line.
      const y = top + (base === 16 ? 10 : 20);
      return { x, y, glyph: REST[base] ?? REST[4], ledgers: [], stem: null, flag: null, dot: dotted ? { x: x + 16, y: top + 15 } : null };
    }
    const y = yOf(t.staff, top, t.diatonic);
    const up = t.diatonic < TOP_LINE[t.staff] - 4;
    const head = base >= 16 ? HEAD['whole'] : base >= 8 ? HEAD['half'] : HEAD['black'];
    const stemX = up ? x + 11.2 : x + 0.6;
    const stemEnd = up ? y - 35 : y + 35;
    const flags = up ? FLAG_UP : FLAG_DOWN;
    const onLine = (TOP_LINE[t.staff] - t.diatonic) % 2 === 0;
    return {
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
