import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { Cadence, SequenceName, Settings, generatePiece, keysFor, timesFor } from './music/generator';
import { GRADES, Grade, TIME_SIGNATURES, TimeSignatureId } from './music/grades';
import { freshSeed } from './music/random';
import { STYLES, STYLE_IDS, StyleId } from './music/styles';
import { keyById, keyName } from './music/theory';
import { PlaybackService } from './playback/playback.service';
import { ScoreComponent } from './score/score.component';

/** Reads ?seed=…&grade=…&style=…&key=…&time=… so a piece can be shared as a link. */
function settingsFromUrl(): Settings {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const grade = Number(params.get('grade'));
  const style = params.get('style') as StyleId;
  const settings: Settings = {
    seed: params.get('seed') || freshSeed(),
    grade: (GRADES as readonly number[]).includes(grade) ? (grade as Grade) : 1,
    style: STYLE_IDS.includes(style) ? style : 'classical',
  };
  const keyId = params.get('key');
  if (keyId && keysFor(settings.grade, settings.style).some((k) => k.id === keyId)) settings.keyId = keyId;
  const timeId = params.get('time') as TimeSignatureId;
  if (timeId && timesFor(settings.grade).includes(timeId)) settings.timeId = timeId;
  return settings;
}

const CADENCE_NAMES: Record<Cadence, string> = {
  PAC: 'Perfect authentic cadence',
  IAC: 'Imperfect authentic cadence',
  HC: 'Half cadence',
  PC: 'Plagal cadence',
  DC: 'Deceptive cadence',
};

const SEQUENCE_NAMES: Record<SequenceName, string> = {
  romanesca: 'Romanesca sequence',
  'descending-fifths': 'Descending-fifths sequence',
  'ascending-5-6': 'Ascending 5–6 sequence',
};

@Component({
  selector: 'app-root',
  imports: [ScoreComponent],
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

  protected readonly keyOptions = computed(() =>
    keysFor(this.grade(), this.style()).map((k) => ({ id: k.id, name: keyName(k) })),
  );
  protected readonly timeOptions = computed(() => timesFor(this.grade()));

  protected readonly settings = computed<Settings>(() => {
    const keyId = this.keyId();
    const timeId = this.timeId();
    return {
      seed: this.seed(),
      grade: this.grade(),
      style: this.style(),
      keyId: this.keyOptions().some((k) => k.id === keyId) ? keyId : undefined,
      timeId: timeId && this.timeOptions().includes(timeId) ? timeId : undefined,
    };
  });

  protected readonly piece = computed(() => generatePiece(this.settings()));
  /** Playback tempo; resets to the score's tempo whenever the piece changes. */
  protected readonly bpm = linkedSignal(() => this.piece().tempo.bpm);

  protected readonly tempoRange = computed(() => {
    const bpm = this.piece().tempo.bpm;
    return { min: Math.round(bpm * 0.5), max: Math.round(bpm * 1.5) };
  });

  protected readonly subtitle = computed(() => {
    const p = this.piece();
    return `Grade ${p.grade} · ${STYLES[p.style].name} · ${keyName(p.key)} · ${p.time.id}`;
  });

  /** Phrase-by-phrase analysis for teachers: bars, any sequence, and the cadence. */
  protected readonly analysis = computed(() =>
    this.piece().phrases.map((ph) => ({
      bars: `Bars ${ph.startBar + 1}–${ph.startBar + ph.bars}`,
      detail: [
        ph.repeatsOpening ? 'Repeats the opening' : '',
        ph.sequence ? SEQUENCE_NAMES[ph.sequence] : '',
        CADENCE_NAMES[ph.cadence],
      ].filter(Boolean),
      chords: this.piece()
        .bars.slice(ph.startBar, ph.startBar + ph.bars)
        .map((b) => b.harmony.map((h) => h.symbol).join(' '))
        .join(' | '),
    })),
  );

  protected readonly beatLabel = computed(() => {
    const unit = this.piece().tempo.beatUnit;
    return unit === 'qd' ? '♩.' : unit === '8' ? '♪' : '♩';
  });

  constructor() {
    // Keep the URL in step with the settings, so the address bar always shares this piece.
    effect(() => {
      const s = this.settings();
      if (typeof history === 'undefined') return;
      const params = new URLSearchParams({ seed: s.seed, grade: String(s.grade), style: s.style });
      if (s.keyId) params.set('key', s.keyId);
      if (s.timeId) params.set('time', s.timeId);
      history.replaceState(null, '', `${location.pathname}?${params}`);
    });
    // A new piece stops whatever is playing.
    effect(() => {
      this.piece();
      untracked(() => this.playback.stop());
    });
  }

  protected newPiece(): void {
    this.seed.set(freshSeed());
  }

  protected setGrade(value: string): void {
    this.grade.set(Number(value) as Grade);
  }

  protected setStyle(value: string): void {
    this.style.set(value as StyleId);
  }

  protected setKey(value: string): void {
    this.keyId.set(keyById(value) ? value : '');
  }

  protected setTime(value: string): void {
    this.timeId.set(value in TIME_SIGNATURES ? (value as TimeSignatureId) : '');
  }

  protected setBpm(value: string): void {
    this.bpm.set(Number(value));
  }

  protected togglePlay(): void {
    if (this.playback.playing() || this.playback.loading()) {
      this.playback.stop();
    } else {
      void this.playback.play(this.piece(), this.bpm());
    }
  }

  protected print(): void {
    window.print();
  }
}
