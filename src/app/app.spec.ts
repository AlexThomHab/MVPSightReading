import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';
import { decodeCustomisation } from './music/constraints';
import { EarTrainingState } from './ear-training/ear-training.state';
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
    expect(el.querySelector('h1')?.textContent).toContain('Sight-Reading Generator');
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

  describe('Ear Training mode', () => {
    let fixture: ComponentFixture<App>;
    let el: HTMLElement;
    const seed = () => new URLSearchParams(location.search).get('seed');
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!;
    const press = async (text: string) => {
      button(text).click();
      await fixture.whenStable();
    };
    const toggle = async (label: string) => {
      [...el.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!.click();
      await fixture.whenStable();
    };
    const select = async (index: number, value: string) => {
      const s = el.querySelectorAll<HTMLSelectElement>('.toolbar select')[index];
      s.value = value;
      s.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const revealed = () => el.querySelector('app-ear-toolbar .count')!.textContent!.trim();

    beforeEach(async () => {
      history.replaceState(null, '', '/?seed=spec&grade=3&style=folk&key=G&time=3/4');
      fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      el = fixture.nativeElement;
    });

    it('switches activity from the header, keeping the piece and the generator controls', async () => {
      const subtitle = el.querySelector('.sheet-meta')!.textContent!;
      const modes = el.querySelectorAll('.mode-switch [role=radio]');
      expect([...modes].map((m) => m.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      await press('Ear training');
      expect([...modes].map((m) => m.getAttribute('aria-checked'))).toEqual(['false', 'true']);
      expect(button('Exit ear training')).toBeUndefined();
      expect(el.querySelectorAll('.toolbar select').length).toBe(3);
      expect(button('New piece')).toBeDefined();
      // Ear Training has one Play (for the selected bars) and nothing to print.
      expect(el.querySelector('.toolbar')!.textContent).not.toContain('Print');
      expect(el.querySelectorAll('input[type=range]').length).toBe(1);
      const order = [...el.querySelectorAll('.toolbar, app-ear-toolbar, .sheet')].map((n) => n.className || n.tagName);
      expect(order).toEqual(['toolbar', 'APP-EAR-TOOLBAR', 'sheet']);
      expect(el.querySelector('.analysis')).toBeNull();
      expect(seed()).toBe('spec');

      await press('Sight reading');
      expect(el.querySelector('app-ear-toolbar')).toBeNull();
      expect(el.querySelector('.analysis')).not.toBeNull();
      expect(el.querySelector('.sheet-meta')!.textContent).toBe(subtitle);
      expect(seed()).toBe('spec');
    });

    it('always shows the key and time signature (no hint switches)', async () => {
      await press('Ear training');
      expect(el.textContent).not.toContain('Show key');
      expect(el.textContent).not.toContain('Show time signature');
      const meta = el.querySelector('.sheet')!.textContent!;
      expect(meta).toContain('G major');
      expect(meta).toContain('3/4');
    });

    it('plays the selected bars from one Play button that says what it will play', async () => {
      const playback = TestBed.inject(PlaybackService);
      const ear = TestBed.inject(EarTrainingState);
      const play = vi.spyOn(playback, 'play').mockResolvedValue();
      await press('Ear training');
      expect(button('Play my notes')).toBeUndefined();
      const lastBar = ear.barCount() - 1;
      await press('▶ Play the whole piece');
      expect(play.mock.calls[0][2]).toEqual({ fromBar: 0, toBar: lastBar, loop: false, countIn: true });

      // Click bar 3, then bar 6: bars 3–6.
      ear.clickBar(2);
      ear.clickBar(5);
      await fixture.whenStable();
      await toggle('Repeat');
      await toggle('Count in');
      await press('▶ Play bars 3–6');
      expect(play.mock.calls[1][2]).toEqual({ fromBar: 2, toBar: 5, loop: true, countIn: false });

      // Space plays too; Clear selection goes back to the whole piece.
      await press('Clear selection');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      expect(play.mock.calls[2][2]).toMatchObject({ fromBar: 0, toBar: lastBar });
    });

    it('pauses and resumes while playing', async () => {
      const playback = TestBed.inject(PlaybackService);
      await press('Ear training');
      const pause = vi.spyOn(playback, 'pause').mockImplementation(() => playback.paused.set(true));
      const resume = vi.spyOn(playback, 'resume').mockImplementation(() => playback.paused.set(false));
      playback.playing.set(true);
      await fixture.whenStable();
      await press('❚❚ Pause');
      expect(pause).toHaveBeenCalled();
      await press('▶ Resume');
      expect(resume).toHaveBeenCalled();
      playback.playing.set(false);
    });

    it('plays the listener’s own notes when My notes is chosen', async () => {
      const playback = TestBed.inject(PlaybackService);
      const play = vi.spyOn(playback, 'play').mockResolvedValue();
      await press('Ear training');
      await press('My notes');
      await press('▶ Play');
      // Nothing written yet: every bar of what plays is rests.
      expect(play.mock.calls[0][0].bars.every((b) => b.rh.every((n) => n.rest))).toBe(true);
      await press('Original');
      await press('▶ Play');
      expect(play.mock.calls[1][0].bars.some((b) => b.rh.some((n) => !n.rest))).toBe(true);
    });

    it('applies new settings only on New piece, then stays in the mode with everything concealed again', async () => {
      await press('Ear training');
      await press('Reveal all');
      const [shown, total] = revealed().split('/');
      expect(shown).toBe(total);

      await select(0, 'classical'); // style
      expect(seed()).toBe('spec');
      expect(new URLSearchParams(location.search).get('style')).toBe('folk');
      expect(el.textContent).toContain('will be used when you click New piece');

      await press('New piece');
      expect(seed()).not.toBe('spec');
      expect(new URLSearchParams(location.search).get('style')).toBe('classical');
      expect(el.querySelector('app-ear-toolbar')).not.toBeNull();
      expect(revealed().startsWith('0/')).toBe(true);
      expect(el.textContent).not.toContain('will be used when you click New piece');
    });

    it('drops unapplied setting changes when switching back to sight reading, so the piece stays the same', async () => {
      await press('Ear training');
      await select(0, 'march');
      await press('Sight reading');
      expect(seed()).toBe('spec');
      expect(new URLSearchParams(location.search).get('style')).toBe('folk');
      expect(el.querySelectorAll<HTMLSelectElement>('.toolbar select')[0].value).toBe('folk');
    });

    it('reveals the selected bars, then the next bar, without changing the selection', async () => {
      const ear = TestBed.inject(EarTrainingState);
      await press('Ear training');
      expect(button('Reveal selected bars').disabled).toBe(true);
      ear.clickBar(2);
      ear.clickBar(4);
      await fixture.whenStable();
      await press('Reveal bars 3–5');
      expect(revealed().startsWith('3/')).toBe(true);
      await press('Reveal next bar (6)');
      expect(revealed().startsWith('4/')).toBe(true);
      expect(ear.selection()).toEqual({ from: 2, to: 4 });
      await press('Hide all again');
      expect(revealed().startsWith('0/')).toBe(true);
    });
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
