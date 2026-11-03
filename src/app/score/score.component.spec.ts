import { ComponentFixture, TestBed } from '@angular/core/testing';
import { generatePiece } from '../music/generator';
import { BarBox } from './engraving';
import { ScoreComponent } from './score.component';

/** VexFlow cannot draw in jsdom, so the bar boxes are supplied directly: two systems of four bars. */
describe('ScoreComponent', () => {
  let fixture: ComponentFixture<ScoreComponent>;
  const piece = generatePiece({ seed: 'score', grade: 2, style: 'classical' });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ScoreComponent] }).compileComponents();
    fixture = TestBed.createComponent(ScoreComponent);
    fixture.componentRef.setInput('piece', piece);
    const boxes: BarBox[] = Array.from({ length: 8 }, (_, i) => ({ x: (i % 4) * 0.25, y: i < 4 ? 0 : 0.5, w: 0.25, h: 0.4 }));
    (fixture.componentInstance as unknown as { boxes: { set(b: BarBox[]): void } }).boxes.set(boxes);
    await fixture.whenStable();
  });

  it('labels the score with the piece title for screen readers', () => {
    expect(fixture.nativeElement.querySelector('.score').getAttribute('aria-label')).toBe(`Sheet music: ${piece.title}`);
  });

  it('highlights the bar being played, and nothing when playback stops', async () => {
    expect(fixture.nativeElement.querySelector('.highlight')).toBeNull();
    fixture.componentRef.setInput('activeBar', 5);
    await fixture.whenStable();
    const box = fixture.nativeElement.querySelector('.highlight') as HTMLElement;
    expect(box.style.left).toBe('25%');
    expect(box.style.top).toBe('50%');
    fixture.componentRef.setInput('activeBar', null);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.highlight')).toBeNull();
  });
});
