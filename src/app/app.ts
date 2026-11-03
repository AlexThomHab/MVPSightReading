import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { generatePiece } from './music/generator';
import { describePhrases } from './music/analysis';
import { Customisation, GenerationError, decodeCustomisation, encodeCustomisation, isDefault } from './music/constraints';
import { Piece, Settings } from './music/model';
import { GRADES, Grade, TimeSignatureId, isGrade, isTimeSignatureId } from './music/grades';
import { freshSeed } from './music/random';
import { STYLES, STYLE_IDS, StyleId, isStyleId, keysFor, timesFor } from './music/styles';
import { Key, keyById, keyName } from './music/theory';
import { CustomisePanelComponent } from './customise/customise-panel.component';
import { PlaybackService } from './playback/playback.service';
import { ScoreComponent } from './score/score.component';

/**
 * The time signatures the Time menu offers: the style's own metres (chorales are in 4/4), else
 * the user's chosen metres, else the grade's.
 */
function timeChoices(grade: Grade, style: StyleId, custom: Customisation | undefined): TimeSignatureId[] {
  return !STYLES[style].metres && custom?.timeSignatures ? [...custom.timeSignatures] : timesFor(grade, style);
}

/** The keys the Key menu offers: the grade's (and style's), only major ones without accidentals. */
function keyChoices(grade: Grade, style: StyleId, custom: Customisation | undefined): Key[] {
  return keysFor(grade, style).filter((k) => custom?.accidentals !== false || k.mode === 'major');
}

/** Reads ?seed=…&grade=…&style=…&key=…&time=…&c=… so a piece can be shared as a link. */
function settingsFromUrl(): Settings {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const grade = Number(params.get('grade'));
  const style = params.get('style');
  const settings: Settings = {
    seed: params.get('seed') || freshSeed(),
    grade: isGrade(grade) ? grade : 1,
    style: isStyleId(style) ? style : 'classical',
  };
  const custom = decodeCustomisation(params.get('c'));
  if (!isDefault(custom)) settings.custom = custom;
  const keyId = params.get('key');
  if (keyId && keyChoices(settings.grade, settings.style, settings.custom).some((k) => k.id === keyId)) settings.keyId = keyId;
  const timeId = params.get('time');
  if (isTimeSignatureId(timeId) && timeChoices(settings.grade, settings.style, settings.custom).includes(timeId)) settings.timeId = timeId;
  return settings;
}

/** True when two settings describe the same piece. */
function sameSettings(a: Settings, b: Settings): boolean {
  return (
    a.seed === b.seed &&
    a.grade === b.grade &&
    a.style === b.style &&
    a.keyId === b.keyId &&
    a.timeId === b.timeId &&
    encodeCustomisation(a.custom) === encodeCustomisation(b.custom)
  );
}

/** A piece, or why the settings could not produce one. */
type Attempt = { piece: Piece; error?: undefined } | { piece?: undefined; error: string };

function attempt(settings: Settings): Attempt {
  try {
    return { piece: generatePiece(settings) };
  } catch (e) {
    if (e instanceof GenerationError) return { error: e.message };
    throw e;
  }
}

@Component({
  selector: 'app-root',
  imports: [ScoreComponent, CustomisePanelComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly playback = inject(PlaybackService);

  protected readonly grades = GRADES;
  protected readonly styles = STYLE_IDS.map((id) => STYLES[id]);

  private readonly initial = settingsFromUrl();
  protected readonly seed = signal(this.initial.seed);
  protected readonly grade = signal<Grade>(this.initial.grade);
  protected readonly style = signal<StyleId>(this.initial.style);
  /** '' means random within the grade. */
  protected readonly keyId = signal(this.initial.keyId ?? '');
  protected readonly timeId = signal<TimeSignatureId | ''>(this.initial.timeId ?? '');
  /** The customisation the next piece will use; the panel edits this draft. */
  protected readonly customDraft = signal<Customisation>(this.initial.custom ?? {});
  /** The customisation in force: the draft, as it was at the last New piece. */
  private readonly custom = signal<Customisation | undefined>(this.initial.custom);
  protected readonly customiseOpen = signal(!!this.initial.custom);

  protected readonly keyOptions = computed(() =>
    keyChoices(this.grade(), this.style(), this.custom()).map((k) => ({ id: k.id, name: keyName(k) })),
  );
  protected readonly timeOptions = computed(() => timeChoices(this.grade(), this.style(), this.custom()));

  /** The settings the piece on screen is generated from: the controls, as they stand. */
  protected readonly settings = computed<Settings>(
    () => {
      const keyId = this.keyId();
      const timeId = this.timeId();
      return {
        seed: this.seed(),
        grade: this.grade(),
        style: this.style(),
        keyId: this.keyOptions().some((k) => k.id === keyId) ? keyId : undefined,
        timeId: timeId && this.timeOptions().includes(timeId) ? timeId : undefined,
        custom: this.custom(),
      };
    },
    { equal: sameSettings },
  );

  private readonly attempt = computed(() => attempt(this.settings()));
  /**
   * The piece on screen. When customised settings cannot produce a piece, the last piece stays
   * (or, on first load, the grade's own) and `generationError` says why.
   */
  protected readonly piece = linkedSignal<Attempt, Piece>({
    source: this.attempt,
    computation: (result, previous) => result.piece ?? previous?.value ?? generatePiece({ ...this.settings(), custom: undefined }),
  });
  protected readonly generationError = computed(() => this.attempt().error ?? '');
  /** The panel's draft differs from the customisation in force. */
  protected readonly pendingCustom = computed(() => encodeCustomisation(this.customDraft()) !== encodeCustomisation(this.custom()));
  protected readonly isCustomised = computed(() => !isDefault(this.custom()));
  /** Playback tempo; resets to the score's tempo whenever the piece changes. */
  protected readonly bpm = linkedSignal(() => this.piece().tempo.bpm);

  protected readonly tempoRange = computed(() => {
    const bpm = this.piece().tempo.bpm;
    return { min: Math.round(bpm * 0.5), max: Math.round(bpm * 1.5) };
  });

  protected readonly subtitle = computed(() => {
    const p = this.piece();
    return [`Grade ${p.grade}`, STYLES[p.style].name, keyName(p.key), p.time.id].join(' · ');
  });

  /** Phrase-by-phrase analysis for teachers: bars, any sequence, and the cadence. */
  protected readonly analysis = computed(() => describePhrases(this.piece()));

  protected readonly tempoLabel = computed(() => {
    const unit = this.piece().tempo.beatUnit;
    return `Tempo ${unit === 'qd' ? '♩.' : unit === '8' ? '♪' : '♩'} = ${this.bpm()}`;
  });

  constructor() {
    // Keep the URL in step with the settings, so the address bar always shares this piece.
    effect(() => {
      const s = this.settings();
      // (Settings that could not produce a piece are not worth sharing: keep the last good link.)
      if (typeof history === 'undefined' || this.attempt().error) return;
      const params = new URLSearchParams({ seed: s.seed, grade: String(s.grade), style: s.style });
      if (s.keyId) params.set('key', s.keyId);
      if (s.timeId) params.set('time', s.timeId);
      const c = encodeCustomisation(s.custom);
      if (c) params.set('c', c);
      history.replaceState(null, '', `${location.pathname}?${params}`);
    });
    // A new piece stops whatever is playing.
    effect(() => {
      this.piece();
      untracked(() => this.playback.stop());
    });
  }

  protected newPiece(): void {
    // A New piece is when the customisation's changes take effect.
    const draft = this.customDraft();
    this.custom.set(isDefault(draft) ? undefined : draft);
    this.seed.set(freshSeed());
  }

  protected setGrade(value: string): void {
    const grade = Number(value);
    if (isGrade(grade)) this.grade.set(grade);
  }

  protected setStyle(value: string): void {
    if (isStyleId(value)) this.style.set(value);
  }

  protected setKey(value: string): void {
    this.keyId.set(keyById(value) ? value : '');
  }

  protected setTime(value: string): void {
    this.timeId.set(isTimeSignatureId(value) ? value : '');
  }

  protected toggleCustomise(): void {
    this.customiseOpen.update((open) => !open);
  }

  protected setBpm(value: string): void {
    this.bpm.set(Number(value));
  }

  protected togglePlay(): void {
    if (this.playback.playing() || this.playback.loading()) {
      this.playback.stop();
      return;
    }
    void this.playback.play(this.piece(), this.bpm());
  }

  protected print(): void {
    window.print();
  }
}
