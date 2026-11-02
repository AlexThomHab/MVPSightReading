import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PitchRangeSetting, formatPitch, parsePitch } from '../music/constraints';
import { diatonicIndex, naturalAt } from '../music/theory';

/** Half a staff space, in SVG units: one diatonic step. */
const STEP = 5;
const NOTE_FONT = 40;
/** The piano's compass: A0 to C8. */
const LOWEST = diatonicIndex({ letter: 'A', alter: 0, octave: 0 });
const HIGHEST = diatonicIndex({ letter: 'C', alter: 0, octave: 8 });

/**
 * A pitch range on a small stave: the lowest and highest notes drawn as noteheads, each moved a
 * step at a time with its own up and down buttons (touch-friendly), its name shown beside it.
 * The lowest note always stays below the highest, and both within the piano's compass.
 */
@Component({
  selector: 'app-pitch-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="range">
      <svg [attr.viewBox]="viewBox()" class="staff" role="img" [attr.aria-label]="label() + ': ' + lowName() + ' to ' + highName()">
        @for (y of staffLines(); track y) {
          <line [attr.x1]="4" [attr.x2]="196" [attr.y1]="y" [attr.y2]="y" class="staff-line" />
        }
        <text class="glyph" [attr.x]="10" [attr.y]="clefY()" [attr.font-size]="font">{{ clefGlyph() }}</text>
        @for (n of notes(); track n.x) {
          @for (y of n.ledgers; track y) {
            <line [attr.x1]="n.x - 5" [attr.x2]="n.x + 17" [attr.y1]="y" [attr.y2]="y" class="staff-line" />
          }
          <text class="glyph" [attr.x]="n.x" [attr.y]="n.y" [attr.font-size]="font">&#xE0A2;</text>
        }
      </svg>
      <div class="ends">
        <div class="end">
          <span class="end-label">Lowest</span>
          <strong>{{ lowName() }}</strong>
          <div class="steppers">
            <button type="button" (click)="move('low', 1)" [disabled]="!canMove('low', 1)" [attr.aria-label]="'Raise the lowest ' + label() + ' note'">▲</button>
            <button type="button" (click)="move('low', -1)" [disabled]="!canMove('low', -1)" [attr.aria-label]="'Lower the lowest ' + label() + ' note'">▼</button>
          </div>
        </div>
        <div class="end">
          <span class="end-label">Highest</span>
          <strong>{{ highName() }}</strong>
          <div class="steppers">
            <button type="button" (click)="move('high', 1)" [disabled]="!canMove('high', 1)" [attr.aria-label]="'Raise the highest ' + label() + ' note'">▲</button>
            <button type="button" (click)="move('high', -1)" [disabled]="!canMove('high', -1)" [attr.aria-label]="'Lower the highest ' + label() + ' note'">▼</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; }
    .staff { width: 200px; height: auto; background: #fff; border-radius: 6px; border: 1px solid var(--line); }
    .staff-line { stroke: #333; stroke-width: 1; }
    .glyph { font-family: Bravura, serif; fill: #111; }
    .ends { display: flex; gap: 18px; }
    .end { display: grid; grid-template-columns: auto auto; grid-template-rows: auto auto; column-gap: 8px; align-items: center; }
    .end-label { grid-column: 1 / 3; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
    .end strong { font-variant-numeric: tabular-nums; min-width: 2.4em; }
    .steppers { display: flex; gap: 4px; }
    .steppers button { width: 40px; height: 36px; padding: 0; font-size: 0.8rem; }
    .steppers button:disabled { opacity: 0.35; cursor: default; }
  `,
})
export class PitchRangeComponent {
  readonly label = input('melody');
  readonly clef = input<'treble' | 'bass'>('treble');
  readonly range = input.required<PitchRangeSetting>();
  readonly rangeChange = output<PitchRangeSetting>();

  protected readonly font = NOTE_FONT;
  private readonly lowIndex = computed(() => diatonicIndex(parsePitch(this.range().low) ?? naturalAt(28)));
  private readonly highIndex = computed(() => diatonicIndex(parsePitch(this.range().high) ?? naturalAt(35)));
  protected readonly lowName = computed(() => formatPitch(naturalAt(this.lowIndex())));
  protected readonly highName = computed(() => formatPitch(naturalAt(this.highIndex())));

  /** The stave's bottom line: E4 in the treble clef, G2 in the bass. */
  private readonly bottom = computed(() => (this.clef() === 'treble' ? diatonicIndex({ letter: 'E', alter: 0, octave: 4 }) : diatonicIndex({ letter: 'G', alter: 0, octave: 2 })));
  /** y of a pitch: the bottom line sits at y = 0 (the view box follows the notes). */
  private readonly y = (D: number) => -(D - this.bottom()) * STEP;

  protected readonly staffLines = computed(() => [0, 2, 4, 6, 8].map((k) => this.y(this.bottom() + k)));
  protected readonly clefGlyph = computed(() => (this.clef() === 'treble' ? '' : ''));
  /** The G clef curls round the G line; the F clef's dots straddle the F line. */
  protected readonly clefY = computed(() => this.y(this.bottom() + (this.clef() === 'treble' ? 2 : 6)));

  protected readonly notes = computed(() =>
    [
      { D: this.lowIndex(), x: 92 },
      { D: this.highIndex(), x: 150 },
    ].map(({ D, x }) => ({ x, y: this.y(D), ledgers: this.ledgers(D) })),
  );

  protected readonly viewBox = computed(() => {
    const ys = [this.y(this.highIndex()), this.y(this.lowIndex()), this.y(this.bottom() + 8), 0];
    const top = Math.min(...ys) - 22;
    const bottom = Math.max(...ys) + 22;
    return `0 ${top} 200 ${bottom - top}`;
  });

  private ledgers(D: number): number[] {
    const out: number[] = [];
    const b = this.bottom();
    for (let k = b - 2; k >= D; k -= 2) out.push(this.y(k));
    for (let k = b + 10; k <= D; k += 2) out.push(this.y(k));
    return out;
  }

  protected canMove(end: 'low' | 'high', by: 1 | -1): boolean {
    const low = this.lowIndex() + (end === 'low' ? by : 0);
    const high = this.highIndex() + (end === 'high' ? by : 0);
    return low >= LOWEST && high <= HIGHEST && low < high;
  }

  protected move(end: 'low' | 'high', by: 1 | -1): void {
    if (!this.canMove(end, by)) return;
    const low = this.lowIndex() + (end === 'low' ? by : 0);
    const high = this.highIndex() + (end === 'high' ? by : 0);
    this.rangeChange.emit({ low: formatPitch(naturalAt(low)), high: formatPitch(naturalAt(high)) });
  }
}
