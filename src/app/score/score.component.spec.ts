import { ComponentFixture, TestBed } from '@angular/core/testing';
import { generatePiece } from '../music/generator';
import { BarBox } from './engraving';
import { ScoreComponent } from './score.component';

/**
 * Bar selection gestures on the concealed score. VexFlow cannot draw in jsdom, so the bar
 * boxes are supplied directly: two systems of four bars each.
 */
describe('ScoreComponent bar selection', () => {
  let fixture: ComponentFixture<ScoreComponent>;
  let clicked: number[];
  let dragged: { anchor: number; bar: number }[];
  let under: number | null;

  const target = (bar: number) => fixture.nativeElement.querySelector(`.bar-target[data-bar="${bar}"]`) as HTMLButtonElement;
  const pointer = (type: string, bar: number, el = target(bar)) => {
    under = bar;
    const event = new MouseEvent(type, { bubbles: true, button: 0 }) as PointerEvent;
    Object.defineProperty(event, 'pointerId', { value: 1 });
    el.dispatchEvent(event);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ScoreComponent] }).compileComponents();
    fixture = TestBed.createComponent(ScoreComponent);
    fixture.componentRef.setInput('piece', generatePiece({ seed: 'score', grade: 2, style: 'classical' }));
    fixture.componentRef.setInput('concealed', true);
    const boxes: BarBox[] = Array.from({ length: 8 }, (_, i) => ({ x: (i % 4) * 0.25, y: i < 4 ? 0 : 0.5, w: 0.25, h: 0.4 }));
    (fixture.componentInstance as unknown as { boxes: { set(b: BarBox[]): void } }).boxes.set(boxes);
    clicked = [];
    dragged = [];
    fixture.componentInstance.barClick.subscribe((b) => clicked.push(b));
    fixture.componentInstance.barDrag.subscribe((d) => dragged.push(d));
    // jsdom has no layout: report whichever bar the test says is under the pointer.
    document.elementFromPoint = () => (under === null ? null : target(under));
    await fixture.whenStable();
  });

  it('draws one selectable target per bar, none of which shows its notes', () => {
    expect(fixture.nativeElement.querySelectorAll('.bar-target').length).toBe(8);
    expect(fixture.nativeElement.querySelectorAll('.bar-target.hidden-bar').length).toBe(8);
    expect(fixture.nativeElement.querySelectorAll('.vf-stavenote').length).toBe(0);
  });

  it('reports a click when the pointer goes down and up on the same bar', () => {
    pointer('pointerdown', 2);
    pointer('pointerup', 2);
    expect(clicked).toEqual([2]);
    expect(dragged).toEqual([]);
  });

  it('reports a drag as the pointer moves across bars, onto the next system, without a click', () => {
    const start = target(1);
    pointer('pointerdown', 1);
    pointer('pointermove', 2, start);
    pointer('pointermove', 5, start); // second system
    pointer('pointerup', 5, start);
    expect(dragged).toEqual([
      { anchor: 1, bar: 2 },
      { anchor: 1, bar: 5 },
    ]);
    expect(clicked).toEqual([]);
  });

  it('selects from the keyboard (Enter or Space on a focused bar)', () => {
    target(6).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(clicked).toEqual([6]);
  });

  it('outlines the selected bars', async () => {
    fixture.componentRef.setInput('selection', { from: 2, to: 5 });
    await fixture.whenStable();
    const selected = [...fixture.nativeElement.querySelectorAll('.bar-target.selected')].map((b) => (b as HTMLElement).dataset['bar']);
    expect(selected).toEqual(['2', '3', '4', '5']);
  });
});
