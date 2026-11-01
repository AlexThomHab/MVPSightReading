import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    history.replaceState(null, '', '/?seed=spec&grade=2&style=waltz');
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the generated piece from the URL settings', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Sight-reading generator');
    expect(el.querySelector('.sheet h2')?.textContent).toMatch(/^Waltz in /);
    expect(el.querySelector('.sheet-meta')?.textContent).toContain('Grade 2');
    expect(el.querySelector('.seed')?.textContent).toContain('spec');
  });

  it('writes the settings into the URL so the piece can be shared', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const params = new URLSearchParams(location.search);
    expect(params.get('seed')).toBe('spec');
    expect(params.get('grade')).toBe('2');
    expect(params.get('style')).toBe('waltz');
  });

  it('generates a new seed on "New piece"', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('New piece'));
    button?.click();
    await fixture.whenStable();
    expect(new URLSearchParams(location.search).get('seed')).not.toBe('spec');
  });

  it('opens Ear Training on the same piece, hiding everything that gives it away, and returns', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const title = el.querySelector('.sheet h2')!.textContent!;
    const press = async (text: string) => {
      [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!.click();
      await fixture.whenStable();
    };

    await press('Ear training');
    expect(el.querySelector('app-ear-training')).not.toBeNull();
    expect(el.querySelector('.toolbar')).toBeNull();
    expect(el.querySelector('.analysis')).toBeNull();
    expect(el.textContent).not.toContain(title);

    await press('Exit ear training');
    expect(el.querySelector('app-ear-training')).toBeNull();
    expect(el.querySelector('.sheet h2')!.textContent).toBe(title);
    expect(new URLSearchParams(location.search).get('seed')).toBe('spec');
  });
});
