import { ComponentFixture, TestBed } from '@angular/core/testing';
import { generatePiece, Piece } from '../music/generator';
import { STYLE_IDS } from '../music/styles';
import { keyName } from '../music/theory';
import { EarTrainingComponent } from './ear-training.component';

describe('EarTrainingComponent', () => {
  let fixture: ComponentFixture<EarTrainingComponent>;
  let el: HTMLElement;
  const piece = generatePiece({ seed: 'ear', grade: 5, style: 'minuet', keyId: 'Eb', timeId: '3/4' });
  const snapshot = JSON.stringify(piece);

  const buttons = (text: string | RegExp) =>
    [...el.querySelectorAll('button')].filter((b) => (typeof text === 'string' ? b.textContent!.includes(text) : text.test(b.textContent!)));
  const click = async (text: string | RegExp) => {
    buttons(text)[0].click();
    await fixture.whenStable();
  };
  const toggle = async (label: string) => {
    const input = [...el.querySelectorAll('label.toggle')].find((l) => l.textContent!.includes(label))!.querySelector('input')!;
    input.click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EarTrainingComponent] }).compileComponents();
    fixture = TestBed.createComponent(EarTrainingComponent);
    fixture.componentRef.setInput('piece', piece);
    await fixture.whenStable();
    el = fixture.nativeElement;
  });

  it('hides the key, time signature, title and style by default', () => {
    const text = el.textContent!;
    expect(text).toContain(`${piece.bars.length} bars`);
    expect(text).not.toContain(keyName(piece.key));
    expect(text).not.toContain('3/4');
    expect(text).not.toContain(piece.title);
    expect(text).not.toMatch(/Minuet/i);
    expect(text).not.toContain('♩');
  });

  it('shows the key and the time signature independently', async () => {
    await toggle('Show key');
    expect(el.textContent).toContain(`Key: ${keyName(piece.key)}`);
    expect(el.textContent).not.toContain('Time: 3/4');
    await toggle('Show time signature');
    expect(el.textContent).toContain('Time: 3/4');
    await toggle('Show key');
    expect(el.textContent).not.toContain(keyName(piece.key));
    expect(el.textContent).toContain('Time: 3/4');
  });

  it('validates the bar selection against the length of the piece', async () => {
    await click('Bar range');
    const [from, to] = [...el.querySelectorAll<HTMLInputElement>('input[type=number]')];
    from.value = '5';
    from.dispatchEvent(new Event('input'));
    to.value = '3';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent).toMatch(/after the start/);
    expect(buttons(/Play/)[0].disabled).toBe(true);
    to.value = String(piece.bars.length + 1);
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent).toMatch(new RegExp(`1 to ${piece.bars.length}`));
    to.value = '7';
    to.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelector('.error')).toBeNull();
    expect(buttons(/Play/)[0].disabled).toBe(false);
  });

  it('reveals bars one at a time, then hides them all again without changing the music', async () => {
    await click('Single bar');
    const bar = el.querySelector<HTMLInputElement>('input[type=number]')!;
    bar.value = '5';
    bar.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await click('Reveal bar 5');
    expect(el.textContent).toContain(`1 of ${piece.bars.length} bars revealed`);
    await click('Reveal next bar (6)');
    await click('Reveal next bar (7)');
    expect(el.textContent).toContain(`3 of ${piece.bars.length} bars revealed`);
    await click('Hide all');
    expect(el.textContent).toContain(`0 of ${piece.bars.length} bars revealed`);
    expect(JSON.stringify(piece)).toBe(snapshot);
  });

  it('emits exit when leaving', async () => {
    let exited = false;
    fixture.componentInstance.exit.subscribe(() => (exited = true));
    await click('Exit ear training');
    expect(exited).toBe(true);
  });

  it('works with every style', async () => {
    for (const style of STYLE_IDS) {
      fixture.componentRef.setInput('piece', generatePiece({ seed: 'ear', grade: 4, style }));
      await fixture.whenStable();
      expect(el.textContent).toMatch(/\d+ bars/);
    }
  });
});
