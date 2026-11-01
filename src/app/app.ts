import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { Cadence, SequenceName, Settings, generatePiece, keysFor, timesFor } from './music/generator';
import { GRADES, Grade, TIME_SIGNATURES, TimeSignatureId } from './music/grades';
import { freshSeed } from './music/random';
import { STYLES, STYLE_IDS, StyleId } from './music/styles';
import { keyById, keyName } from './music/theory';
import { EarToolbarComponent } from './ear-training/ear-toolbar.component';
import { EarTrainingState } from './ear-training/ear-training.state';
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
  if (timeId && timesFor(settings.grade, settings.style).includes(timeId)) settings.timeId = timeId;
  return settings;
}

/** True when two settings describe the same piece. */
function sameSettings(a: Settings, b: Settings): boolean {
  return a.seed === b.seed && a.grade === b.grade && a.style === b.style && a.keyId === b.keyId && a.timeId === b.timeId;
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
  imports: [ScoreComponent, EarToolbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly playback = inject(PlaybackService);
  /** Ear Training mode: the same generator and score, with the notation concealed. */
  protected readonly ear = inject(EarTrainingState);

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
  protected readonly timeOptions = computed(() => timesFor(this.grade(), this.style()));

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

  /**
   * The settings the current piece was generated from. In sight-reading mode they follow the
   * controls; in Ear Training mode control changes wait for New piece, so the piece being
   * transcribed never changes underneath the listener.
   */
  private readonly applied = signal<Settings>(this.settings(), { equal: sameSettings });
  protected readonly piece = computed(() => generatePiece(this.applied()));
  /** Ear Training: the controls differ from the piece on screen until New piece is clicked. */
  protected readonly pendingSettings = computed(
    () => this.ear.active() && !sameSettings({ ...this.settings(), seed: this.applied().seed }, this.applied()),
  );
  /** Playback tempo; resets to the score's tempo whenever the piece changes. */
  protected readonly bpm = linkedSignal(() => this.piece().tempo.bpm);

  protected readonly tempoRange = computed(() => {
    const bpm = this.piece().tempo.bpm;
    return { min: Math.round(bpm * 0.5), max: Math.round(bpm * 1.5) };
  });

  /** In Ear Training mode the title and subtitle leave out whatever the hints hide. */
  protected readonly sheetTitle = computed(() => {
    const p = this.piece();
    if (!this.ear.active() || this.ear.showKey()) return p.title;
    return STYLES[p.style].titleWord;
  });

  protected readonly subtitle = computed(() => {
    const p = this.piece();
    const showKey = !this.ear.active() || this.ear.showKey();
    const showTime = !this.ear.active() || this.ear.showTime();
    return [
      `Grade ${p.grade}`,
      STYLES[p.style].name,
      showKey ? keyName(p.key) : '',
      showTime ? p.time.id : '',
      this.ear.active() ? `${p.bars.length} bars` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /** Phrase-by-phrase analysis for teachers: bars, any sequence, and the cadence. */
  protected readonly analysis = computed(() =>
    this.piece().phrases.map((ph, i) => ({
      // Chorale phrases start on an upbeat, so they are numbered rather than given bar ranges.
      bars: this.piece().style === 'chorale' ? `Phrase ${i + 1}` : `Bars ${ph.startBar + 1}–${ph.startBar + ph.bars}`,
      detail: [
        ph.repeatsOpening ? (this.piece().style === 'chorale' ? 'Repeats phrase ' + (i - 1) : 'Repeats the opening') : '',
        ph.key ? `Modulates to ${ph.key}` : '',
        ph.sequence ? SEQUENCE_NAMES[ph.sequence] : '',
        CADENCE_NAMES[ph.cadence],
      ].filter(Boolean),
      chords:
        this.piece().style === 'chorale'
          ? // One chord per beat; each chorale phrase is eight beats long.
            this.piece()
              .bars.flatMap((b) => b.harmony.map((h) => h.symbol))
              .slice(i * 8, i * 8 + 8)
              .join('  ')
          : this.piece()
              .bars.slice(ph.startBar, ph.startBar + ph.bars)
              .map((b) => b.harmony.map((h) => h.symbol).join(' '))
              .join(' | '),
    })),
  );

  protected readonly beatLabel = computed(() => {
    // A dotted crotchet would give away compound time while the time signature is hidden.
    if (this.ear.active() && !this.ear.showTime()) return '';
    const unit = this.piece().tempo.beatUnit;
    return unit === 'qd' ? '♩.' : unit === '8' ? '♪' : '♩';
  });

  protected readonly tempoLabel = computed(() =>
    this.beatLabel() ? `Tempo ${this.beatLabel()} = ${this.bpm()}` : `Tempo ${this.bpm()} bpm`,
  );

  constructor() {
    // Keep the URL in step with the settings, so the address bar always shares this piece.
    // Sight-reading mode: the piece follows the controls straight away.
    effect(() => {
      const s = this.settings();
      if (!this.ear.active()) this.applied.set(s);
    });
    effect(() => {
      const s = this.applied();
      if (typeof history === 'undefined') return;
      const params = new URLSearchParams({ seed: s.seed, grade: String(s.grade), style: s.style });
      if (s.keyId) params.set('key', s.keyId);
      if (s.timeId) params.set('time', s.timeId);
      history.replaceState(null, '', `${location.pathname}?${params}`);
    });
    // A new piece stops whatever is playing, and (in Ear Training) is concealed afresh.
    effect(() => {
      const piece = this.piece();
      untracked(() => {
        this.playback.stop();
        this.ear.reset(piece.bars.length);
      });
    });
  }

  protected toggleEarTraining(): void {
    this.playback.stop();
    if (this.ear.active()) {
      // Back to the fully visible score of the same piece: drop any control changes that
      // were waiting for New piece, so leaving the mode does not regenerate the music.
      const a = this.applied();
      this.seed.set(a.seed);
      this.grade.set(a.grade);
      this.style.set(a.style);
      this.keyId.set(a.keyId ?? '');
      this.timeId.set(a.timeId ?? '');
      this.ear.active.set(false);
    } else {
      this.ear.reset(this.piece().bars.length);
      this.ear.active.set(true);
    }
  }

  protected newPiece(): void {
    this.seed.set(freshSeed());
    if (this.ear.active()) this.applied.set(this.settings());
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
      return;
    }
    if (!this.ear.active()) {
      void this.playback.play(this.piece(), this.bpm());
      return;
    }
    // Ear Training: play the selected passage, or the whole piece when nothing is selected.
    const selection = this.ear.playRange();
    void this.playback.play(this.piece(), this.bpm(), {
      fromBar: selection.from,
      toBar: selection.to,
      loop: this.ear.loop(),
      countIn: this.ear.countIn(),
    });
  }

  protected print(): void {
    window.print();
  }
}
