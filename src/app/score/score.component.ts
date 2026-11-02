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
import { BarBox, ScoreView, drawPiece, loadVexFlow } from './engraving';

/**
 * The score: renders a piece (see engraving.ts) and, in Ear Training, covers hidden bars and
 * lets the listener select bars by clicking, dragging or keyboard.
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
      background-image: repeating-linear-gradient(135deg, rgb(120 110 100 / 0.07) 0 8px, rgb(120 110 100 / 0.13) 8px 16px);
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
    app-score .error {
      color: #b3261e;
    }
    @media print {
      app-score .bar-target,
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
  /** Ear training: hide notes (except revealed bars), number the bars and make them selectable. */
  readonly concealed = input(false);
  /** Bars (0-based) whose notes are shown while concealed. */
  readonly revealed = input<readonly number[]>([]);
  readonly showKey = input(true);
  readonly showTime = input(true);
  readonly showTempo = input(true);
  /** Selected bars (0-based, inclusive), outlined while concealed. */
  readonly selection = input<{ from: number; to: number } | null>(null);
  /** A bar was clicked (or activated from the keyboard) without dragging. */
  readonly barClick = output<number>();
  /** A drag from one bar to another (emitted continuously while dragging). */
  readonly barDrag = output<{ anchor: number; bar: number }>();

  /** The drag in progress: the bar it started on and whether it has left that bar yet. */
  protected drag: { anchor: number; moved: boolean; pointerId: number } | null = null;

  protected readonly error = signal('');
  protected readonly boxes = signal<BarBox[]>([]);
  protected readonly revealedSet = computed(() => new Set(this.revealed()));
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

  protected onPointerDown(event: PointerEvent, bar: number): void {
    if (event.button !== 0) return;
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
      this.boxes.set(drawPiece(vf, piece, view, el));
      this.error.set('');
    } catch (e) {
      console.error(e);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
