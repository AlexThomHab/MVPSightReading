import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';
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

    beforeEach(async () => {
      history.replaceState(null, '', '/?seed=spec&grade=3&style=folk&key=G&time=3/4');
      fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      el = fixture.nativeElement;
    });

    it('keeps the generator controls and adds the ear-training toolbar, without regenerating', async () => {
      const subtitle = el.querySelector('.sheet-meta')!.textContent;
      await press('Ear training');
      expect(el.querySelector('.toolbar')).not.toBeNull();
      expect(el.querySelectorAll('.toolbar select').length).toBe(3);
      for (const label of ['New piece', '▶ Play', 'Print', 'Exit ear training']) expect(button(label), label).toBeDefined();
      expect(el.querySelectorAll('input[type=range]').length).toBe(1); // one tempo control
      expect(el.querySelector('app-ear-toolbar')).not.toBeNull();
      // The ear toolbar sits between the generator controls and the score.
      const order = [...el.querySelectorAll('.toolbar, app-ear-toolbar, .sheet')].map((n) => n.className || n.tagName);
      expect(order).toEqual(['toolbar', 'APP-EAR-TOOLBAR', 'sheet']);
      expect(el.querySelector('.analysis')).toBeNull();
      expect(seed()).toBe('spec');

      await press('Exit ear training');
      expect(el.querySelector('app-ear-toolbar')).toBeNull();
      expect(el.querySelector('.analysis')).not.toBeNull();
      expect(el.querySelector('.sheet-meta')!.textContent).toBe(subtitle);
      expect(seed()).toBe('spec');
    });

    it('has no playback-scope or bar-number controls: bars are chosen on the score', async () => {
      await press('Ear training');
      for (const gone of ['Full piece', 'Single bar', 'Bar range']) expect(button(gone), gone).toBeUndefined();
      expect(el.querySelectorAll('app-ear-toolbar input[type=number]').length).toBe(0);
      for (const label of ['Select all', 'Clear selection', '▶ Play', 'Pause']) expect(button(label), label).toBeDefined();
      for (const label of ['Repeat selection', 'Count-in']) expect(el.querySelector('app-ear-toolbar')!.textContent).toContain(label);
    });

    it('plays the whole piece with nothing selected, and just the selected passage otherwise', async () => {
      const playback = TestBed.inject(PlaybackService);
      const ear = TestBed.inject(EarTrainingState);
      const play = vi.spyOn(playback, 'play').mockResolvedValue();
      await press('Ear training');
      const lastBar = ear.barCount() - 1;
      await press('▶ Play');
      expect(play.mock.calls[0][2]).toEqual({ fromBar: 0, toBar: lastBar, loop: false, countIn: true });

      // Click bar 3, then bar 6: bars 3–6.
      ear.clickBar(2);
      ear.clickBar(5);
      await fixture.whenStable();
      expect(el.querySelector('app-ear-toolbar')!.textContent).toContain('Bars 3–6');
      // The main toolbar's Play and the ear toolbar's Play do the same thing.
      el.querySelector<HTMLButtonElement>('.toolbar button[aria-pressed]')!.click();
      expect(play.mock.calls[1][2]).toEqual({ fromBar: 2, toBar: 5, loop: false, countIn: true });

      await toggle('Repeat selection');
      await toggle('Count-in');
      await press('▶ Play');
      expect(play.mock.calls[2][2]).toEqual({ fromBar: 2, toBar: 5, loop: true, countIn: false });

      await press('Clear selection');
      await press('▶ Play');
      expect(play.mock.calls[3][2]).toMatchObject({ fromBar: 0, toBar: lastBar });
    });

    it('hides the key and time signature from labels until each hint is turned on', async () => {
      await press('Ear training');
      const meta = () => el.querySelector('.sheet')!.textContent!;
      expect(meta()).not.toContain('G major');
      expect(meta()).not.toContain('3/4');
      expect(el.querySelector('.toolbar .tempo')!.textContent).not.toContain('♩');
      await toggle('Show key');
      expect(meta()).toContain('G major');
      expect(meta()).not.toContain('3/4');
      await toggle('Show time signature');
      expect(meta()).toContain('3/4');
      await toggle('Show key');
      expect(meta()).not.toContain('G major');
      expect(meta()).toContain('3/4');
    });

    it('applies new settings only on New piece, then stays in the mode with everything concealed again', async () => {
      await press('Ear training');
      await press('Reveal all');
      expect(el.textContent).toMatch(/(\d+) of \1 revealed/);

      await select(0, 'classical'); // style
      expect(seed()).toBe('spec');
      expect(new URLSearchParams(location.search).get('style')).toBe('folk');
      expect(el.textContent).toContain('will be used when you click New piece');

      await press('New piece');
      expect(seed()).not.toBe('spec');
      expect(new URLSearchParams(location.search).get('style')).toBe('classical');
      expect(el.querySelector('app-ear-toolbar')).not.toBeNull();
      expect(el.textContent).toMatch(/0 of \d+ revealed/);
      expect(el.textContent).not.toContain('will be used when you click New piece');
    });

    it('drops unapplied setting changes when leaving, so the piece stays the same', async () => {
      await press('Ear training');
      await select(0, 'march');
      await press('Exit ear training');
      expect(seed()).toBe('spec');
      expect(new URLSearchParams(location.search).get('style')).toBe('folk');
      expect(el.querySelectorAll<HTMLSelectElement>('.toolbar select')[0].value).toBe('folk');
    });

    it('reveals the selected passage, then the next bar, without changing the selection', async () => {
      const ear = TestBed.inject(EarTrainingState);
      await press('Ear training');
      expect(button('Reveal selected').disabled).toBe(true);
      ear.clickBar(2);
      ear.clickBar(4);
      await fixture.whenStable();
      await press('Reveal selected');
      expect(el.textContent).toMatch(/3 of \d+ revealed/);
      await press('Reveal next bar (6)');
      expect(el.textContent).toMatch(/4 of \d+ revealed/);
      expect(ear.selection()).toEqual({ from: 2, to: 4 });
      await press('Select all');
      expect(el.querySelector('app-ear-toolbar')!.textContent).toContain(`Bars 1–${ear.barCount()}`);
      await press('Reset reveals');
      expect(el.textContent).toMatch(/0 of \d+ revealed/);
    });
  });
});
