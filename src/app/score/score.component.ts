import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, effect, input, signal, viewChild } from '@angular/core';
import { Piece } from '../music/model';
import { BarBox, drawPiece, loadVexFlow } from './engraving';

/** The score: renders a piece (see engraving.ts) and highlights the bar being played. */
@Component({
  selector: 'app-score',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // VexFlow inserts the SVG itself, so styles must reach it without view encapsulation.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="score" #host role="img" [attr.aria-label]="'Sheet music: ' + piece().title"></div>
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
