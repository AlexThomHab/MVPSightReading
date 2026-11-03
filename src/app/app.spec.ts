import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';
import { decodeCustomisation } from './music/constraints';
import { PlaybackService } from './playback/playback.service';

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

  it('plays the whole piece from the Play button', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const playback = TestBed.inject(PlaybackService);
    const play = vi.spyOn(playback, 'play').mockResolvedValue();
    const el = fixture.nativeElement as HTMLElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Play'))!.click();
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][2]).toBeUndefined();
  });

  describe('Customise panel', () => {
    let fixture: ComponentFixture<App>;
    let el: HTMLElement;
    const params = () => new URLSearchParams(location.search);
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!;
    const press = async (b: HTMLElement) => {
      b.click();
      await fixture.whenStable();
    };
    const open = async () => {
      fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      el = fixture.nativeElement as HTMLElement;
      await press(button('Customise'));
    };

    it('opens from the toolbar and closes again', async () => {
      await open();
      expect(el.querySelector('app-customise-panel')).not.toBeNull();
      expect(button('Customise').getAttribute('aria-expanded')).toBe('true');
      await press(el.querySelector<HTMLButtonElement>('button[aria-label="Close the customise panel"]')!);
      expect(el.querySelector('app-customise-panel')).toBeNull();
    });

    it('keeps the piece until New piece, then applies the settings and shares them in the link', async () => {
      await open();
      // (Grade 2 allows quavers: this takes them away.)
      await press(el.querySelector<HTMLButtonElement>('button[aria-label="Quaver (eighth note)"]')!);
      expect(params().get('seed')).toBe('spec');
      expect(params().get('c')).toBeNull();
      expect(el.textContent).toContain('These settings will be used for the next piece.');
      await press(button('New piece with these settings'));
      expect(params().get('seed')).not.toBe('spec');
      const c = params().get('c');
      expect(c).toBeTruthy();
      expect(decodeCustomisation(c)).toEqual({ noteValues: ['semibreve', 'dottedMinim', 'minim', 'crotchet'] });
      expect(el.querySelector('.customise-toggle .dot')).not.toBeNull();
    });

    it('keeps the last piece and explains why when the settings cannot produce one', async () => {
      await open();
      const title = el.querySelector('.sheet h2')!.textContent;
      // No note values at all.
      for (const b of el.querySelectorAll<HTMLButtonElement>('.tiles')[0].querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')) await press(b);
      await press(button('New piece'));
      expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/at least one note value/);
      expect(el.querySelector('.sheet h2')!.textContent).toBe(title);
      expect(params().get('seed')).toBe('spec');
    });
  });

  it('reads a customisation from a shared link', async () => {
    const custom = { accidentals: false, noteValues: ['crotchet', 'minim'] };
    const c = btoa(JSON.stringify(custom)).replace(/=+$/, '');
    history.replaceState(null, '', `/?seed=shared&grade=2&style=classical&c=${c}`);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-customise-panel')).not.toBeNull();
    expect(decodeCustomisation(new URLSearchParams(location.search).get('c'))).toEqual(custom);
    // Without accidentals, the Key menu offers major keys only.
    const keys = [...el.querySelectorAll<HTMLSelectElement>('.toolbar select')[1].options].map((o) => o.text);
    expect(keys.some((k) => /minor/.test(k))).toBe(false);
  });
});
