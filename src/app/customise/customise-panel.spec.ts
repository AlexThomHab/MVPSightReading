import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Customisation, PitchRangeSetting } from '../music/constraints';
import { Grade } from '../music/grades';
import { StyleId } from '../music/styles';
import { CustomisePanelComponent } from './customise-panel.component';
import { PitchRangeComponent } from './pitch-range.component';

describe('CustomisePanelComponent', () => {
  let fixture: ComponentFixture<CustomisePanelComponent>;
  let el: HTMLElement;
  let emitted: Customisation[];

  async function render(value: Customisation, grade: Grade = 1, style: StyleId = 'classical') {
    fixture = TestBed.createComponent(CustomisePanelComponent);
    fixture.componentRef.setInput('grade', grade);
    fixture.componentRef.setInput('style', style);
    fixture.componentRef.setInput('value', value);
    emitted = [];
    // Like the app: each change becomes the new value.
    fixture.componentInstance.valueChange.subscribe((v) => {
      emitted.push(v);
      fixture.componentRef.setInput('value', v);
    });
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  }

  const last = () => emitted[emitted.length - 1];
  const byLabel = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const byText = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
  const click = async (b: HTMLElement) => {
    b.click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CustomisePanelComponent] }).compileComponents();
  });

  it("starts at the grade's defaults, shown as pressed tiles", async () => {
    await render({}, 1);
    expect(el.textContent).toContain('Using the Grade 1 defaults');
    // Grade 1: semibreve, dotted minim, minim and crotchet.
    const pressed = [...el.querySelectorAll('.tiles')[0].querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label'));
    expect(pressed).toEqual(['Semibreve (whole note)', 'Dotted minim (dotted half note)', 'Minim (half note)', 'Crotchet (quarter note)']);
    expect(byText('Reset to grade defaults').disabled).toBe(true);
  });

  it('overrides a setting when its control changes, keeping the rest at the defaults', async () => {
    await render({}, 1);
    await click(byLabel('Quaver (eighth note)'));
    expect(last().noteValues).toEqual(['semibreve', 'dottedMinim', 'minim', 'crotchet', 'quaver']);
    expect(Object.keys(last())).toEqual(['noteValues']);
    expect(el.querySelector('.badge')?.textContent).toContain('Custom');
    expect(el.textContent).toContain('Custom settings for Grade 1');
  });

  it('resets one section, or everything, to the grade defaults', async () => {
    await render({ noteValues: ['crotchet', 'minim'], independence: 'full' }, 2);
    await click(el.querySelector<HTMLButtonElement>('.badge')!);
    expect(last()).toEqual({ independence: 'full' });
    await click(byText('Reset to grade defaults'));
    expect(last()).toEqual({});
  });

  it('shows problems beside the setting and blocks applying them', async () => {
    await render({ leapMode: 'custom', ascending: [1, 2], descending: [] });
    const issue = el.querySelector('.issues li.error');
    expect(issue?.textContent).toMatch(/must rise and fall/);
    expect(byText('New piece with these settings').disabled).toBe(true);
    expect(el.querySelector('.footer-status')?.textContent).toMatch(/One setting needs changing/);
  });

  it('explains how a style will adapt, without blocking it', async () => {
    await render({ independence: 'together' }, 3, 'chopin');
    expect(el.querySelector('.issues li.warning')?.textContent).toMatch(/Chopin's flowing accompaniment/);
    expect(byText('New piece with these settings').disabled).toBe(false);
  });

  it('switches between a largest leap and chosen intervals, rising and falling', async () => {
    await render({}, 2);
    await click(byText('Choose intervals'));
    expect(last().leapMode).toBe('custom');
    expect(last().ascending).toEqual(last().descending);
    const falling = el.querySelectorAll('.chips')[1];
    const third = [...falling.querySelectorAll('button')].find((b) => b.textContent?.trim() === '3rd')!;
    await click(third);
    expect(last().descending).not.toContain(2);
    expect(last().ascending).toContain(2);
    await click(byText('Largest leap'));
    expect(last().ascending).toBeUndefined();
  });

  it('shows the left hand only when the hands are configured separately', async () => {
    await render({});
    expect(el.querySelectorAll('app-pitch-range').length).toBe(1);
    const toggle = [...el.querySelectorAll('label.switch')].find((l) => l.textContent?.includes('Configure hands separately'))!.querySelector('input')!;
    await click(toggle);
    expect(last().separateHands).toBe(true);
    expect(el.querySelectorAll('app-pitch-range').length).toBe(2);
    await click(toggle);
    expect(last()).toEqual({ separateHands: false });
  });

  it('turns expression marks off and on', async () => {
    await render({});
    const staccato = [...el.querySelectorAll('label.switch')].find((l) => l.textContent?.includes('Staccato'))!.querySelector('input')!;
    expect(staccato.checked).toBe(true);
    await click(staccato);
    expect(last().staccato).toBe(false);
  });
});

describe('PitchRangeComponent', () => {
  let fixture: ComponentFixture<PitchRangeComponent>;
  let el: HTMLElement;
  let changes: PitchRangeSetting[];

  async function render(range: PitchRangeSetting, clef: 'treble' | 'bass' = 'treble') {
    await TestBed.configureTestingModule({ imports: [PitchRangeComponent] }).compileComponents();
    fixture = TestBed.createComponent(PitchRangeComponent);
    fixture.componentRef.setInput('range', range);
    fixture.componentRef.setInput('clef', clef);
    changes = [];
    fixture.componentInstance.rangeChange.subscribe((r) => changes.push(r));
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  }

  const button = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it('moves either end a step at a time', async () => {
    await render({ low: 'C4', high: 'G5' });
    expect(el.textContent).toContain('C4');
    button('Raise the highest melody note').click();
    button('Lower the lowest melody note').click();
    expect(changes).toEqual([
      { low: 'C4', high: 'A5' },
      { low: 'B3', high: 'G5' },
    ]);
  });

  it('keeps the lowest note below the highest', async () => {
    await render({ low: 'E4', high: 'F4' });
    expect(button('Raise the lowest melody note').disabled).toBe(true);
    expect(button('Lower the highest melody note').disabled).toBe(true);
  });

  it('draws ledger lines for notes off the stave', async () => {
    // Treble stave lines are E4–F5: C4 needs one ledger line, A5 one above.
    await render({ low: 'C4', high: 'A5' });
    expect(el.querySelectorAll('line').length).toBe(5 + 2);
  });
});
