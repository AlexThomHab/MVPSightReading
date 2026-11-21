import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { Attempt, generatePiece, tryGeneratePiece } from './music/generator';
import { Customisation, encodeCustomisation, isDefault } from './music/constraints';
import { Piece, Settings } from './music/model';
import { GRADES, Grade, TimeSignatureId, isGrade, isTimeSignatureId } from './music/grades';
import { freshSeed } from './music/random';
import { ERAS, ERA_IDS, EraId, FORMS, FormId, eraOf, isEraId, isFormId } from './music/forms';
import { keyById, keyName } from './music/theory';
import { keyChoices, sameSettings, settingsFromQuery, settingsToQuery, timeChoices } from './settings-link';
import { CustomisePanelComponent } from './customise/customise-panel.component';
import { AnswerCheckState } from './ear-training/answer-check.state';
import { CheckResultsComponent } from './ear-training/check-results.component';
import { EarToolbarComponent } from './ear-training/ear-toolbar.component';
import { EarTrainingState } from './ear-training/ear-training.state';
import { NoteInputState } from './ear-training/note-input.state';
import { displayPiece, transcriptionPiece } from './ear-training/transcription';
import { NoteInputView } from './score/score.component';
import { PlaybackService } from './playback/playback.service';
import { ScoreComponent } from './score/score.component';

/** The fastest the tempo slider goes (beats per minute). */
const MAX_BPM = 140;

@Component({
  selector: 'app-root',
  imports: [ScoreComponent, EarToolbarComponent, CheckResultsComponent, CustomisePanelComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Note-input shortcuts (N, 2–7, A–G, arrows, Ctrl/⌘+Z…) work anywhere on the page in Ear Training.
  host: { '(document:keydown)': 'onKey($event)' },
})
export class App {
  protected readonly playback = inject(PlaybackService);
  /** Ear Training mode: the same generator and score, with the notation concealed. */
  protected readonly ear = inject(EarTrainingState);
  /** Ear Training's note input: the listener's own notes in the hidden bars. */
  protected readonly input = inject(NoteInputState);
  /** Check Answers: the listener's notes marked against the original. */
  protected readonly check = inject(AnswerCheckState);

  protected readonly grades = GRADES;
  protected readonly eras = ERA_IDS.map((id) => ERAS[id]);

  private readonly initial = settingsFromQuery(typeof location === 'undefined' ? '' : location.search);
  protected readonly seed = signal(this.initial.seed);
  protected readonly grade = signal<Grade>(this.initial.grade);
  /** The form (which decides the era). */
  protected readonly form = signal<FormId>(this.initial.form);
  protected readonly era = computed<EraId>(() => eraOf(this.form()));
  /** The Form menu: the chosen era's forms. */
  protected readonly formOptions = computed(() => ERAS[this.era()].forms.map((id) => FORMS[id]));
  /** '' means random within the grade. */
  protected readonly keyId = signal(this.initial.keyId ?? '');
  protected readonly timeId = signal<TimeSignatureId | ''>(this.initial.timeId ?? '');
  /** The customisation the next piece will use; the panel edits this draft. */
  protected readonly customDraft = signal<Customisation>(this.initial.custom ?? {});
  /** The customisation in force: the draft, as it was at the last New piece. */
  private readonly custom = signal<Customisation | undefined>(this.initial.custom);
  protected readonly customiseOpen = signal(!!this.initial.custom);

  protected readonly keyOptions = computed(() =>
    keyChoices(this.grade(), this.custom()).map((k) => ({ id: k.id, name: keyName(k) })),
  );
  protected readonly timeOptions = computed(() => timeChoices(this.grade(), this.form(), this.custom()));

  protected readonly settings = computed<Settings>(() => {
    const keyId = this.keyId();
    const timeId = this.timeId();
    return {
      seed: this.seed(),
      grade: this.grade(),
      form: this.form(),
      keyId: this.keyOptions().some((k) => k.id === keyId) ? keyId : undefined,
      timeId: timeId && this.timeOptions().includes(timeId) ? timeId : undefined,
      custom: this.custom(),
    };
  });

  /**
   * The settings the current piece was generated from. In sight-reading mode they follow the
   * controls; in Ear Training mode control changes wait for New piece, so the piece being
   * transcribed never changes underneath the listener.
   */
  private readonly applied = signal<Settings>(this.settings(), { equal: sameSettings });
  private readonly attempt = computed(() => tryGeneratePiece(this.applied()));
  /**
   * The piece on screen. When customised settings cannot produce a piece, the last piece stays
   * (or, on first load, the grade's own) and `generationError` says why.
   */
  protected readonly piece = linkedSignal<Attempt, Piece>({
    source: this.attempt,
    computation: (result, previous) => result.piece ?? previous?.value ?? generatePiece({ ...this.applied(), custom: undefined }),
  });
  protected readonly generationError = computed(() => this.attempt().error ?? '');
  /** The panel's draft differs from the customisation in force. */
  protected readonly pendingCustom = computed(() => encodeCustomisation(this.customDraft()) !== encodeCustomisation(this.custom()));
  protected readonly isCustomised = computed(() => !isDefault(this.custom()));
  /** Ear Training: the controls differ from the piece on screen until New piece is clicked. */
  protected readonly pendingSettings = computed(
    () => this.ear.active() && !sameSettings({ ...this.settings(), seed: this.applied().seed }, this.applied()),
  );
  /**
   * What the score shows: the piece, or in Ear Training the original in revealed bars and the
   * listener's own notes in the rest.
   */
  protected readonly scorePiece = computed(() => {
    const piece = this.piece();
    const t = this.input.transcription();
    if (!this.ear.active() || t.bars.length !== piece.bars.length) return piece;
    return displayPiece(piece, t, new Set(this.ear.revealed()));
  });

  protected readonly noteInputView = computed<NoteInputView | null>(() =>
    this.ear.active()
      ? { active: this.input.active(), ticks: this.input.ticks(), rest: this.input.restMode(), cursor: this.input.cursor(), selected: this.input.selected() }
      : null,
  );

  /** Playback tempo; resets to the score's tempo whenever the piece changes. */
  protected readonly bpm = linkedSignal(() => Math.min(MAX_BPM, this.piece().tempo.bpm));

  /** Half to one and a half times the score's tempo, but never above MAX_BPM. */
  protected readonly tempoRange = computed(() => {
    const bpm = this.piece().tempo.bpm;
    return { min: Math.min(MAX_BPM, Math.round(bpm * 0.5)), max: Math.min(MAX_BPM, Math.round(bpm * 1.5)) };
  });

  protected readonly subtitle = computed(() => {
    const p = this.piece();
    const form = FORMS[p.form];
    return [`Grade ${p.grade}`, ERAS[form.era].name, form.name, keyName(p.key), p.time.id, this.ear.active() ? `${p.bars.length} bars` : '']
      .filter(Boolean)
      .join(' · ');
  });


  protected readonly tempoLabel = computed(() => {
    const unit = this.piece().tempo.beatUnit;
    return `Tempo ${unit === 'qd' ? '♩.' : unit === '8' ? '♪' : '♩'} = ${this.bpm()}`;
  });

  constructor() {
    // Keep the URL in step with the settings, so the address bar always shares this piece.
    // Sight-reading mode: the piece follows the controls straight away.
    effect(() => {
      const s = this.settings();
      if (!this.ear.active()) this.applied.set(s);
    });
    effect(() => {
      const s = this.applied();
      // (Settings that could not produce a piece are not worth sharing: keep the last good link.)
      if (typeof history === 'undefined' || this.attempt().error) return;
      history.replaceState(null, '', location.pathname + settingsToQuery(s));
    });
    // A new piece stops whatever is playing, and (in Ear Training) is concealed afresh.
    effect(() => {
      const piece = this.piece();
      untracked(() => {
        this.playback.stop();
        this.ear.reset(piece.bars.length);
        this.input.load(piece);
        this.check.reset();
      });
    });
  }

  /** Switches activity. The piece, the listener's notes and what is revealed carry over. */
  protected setMode(mode: 'reading' | 'ear'): void {
    if ((mode === 'ear') === this.ear.active()) return;
    this.playback.stop();
    if (this.ear.active()) {
      // Back to the fully visible score of the same piece: drop any control changes that
      // were waiting for New piece, so leaving the mode does not regenerate the music.
      const a = this.applied();
      this.seed.set(a.seed);
      this.grade.set(a.grade);
      this.form.set(a.form);
      this.keyId.set(a.keyId ?? '');
      this.timeId.set(a.timeId ?? '');
      this.input.exit();
      this.ear.active.set(false);
    } else {
      this.ear.active.set(true);
    }
  }

  protected newPiece(): void {
    // A New piece is when the customisation's changes take effect.
    const draft = this.customDraft();
    this.custom.set(isDefault(draft) ? undefined : draft);
    this.seed.set(freshSeed());
    if (this.ear.active()) this.applied.set(this.settings());
  }

  protected setGrade(value: string): void {
    const grade = Number(value);
    if (isGrade(grade)) this.grade.set(grade);
  }

  /** Choosing an era chooses its first form. */
  protected setEra(value: string): void {
    if (isEraId(value) && value !== this.era()) this.setForm(ERAS[value].forms[0]);
  }

  /** A time signature the new form is not written in goes back to Random. */
  protected setForm(value: string): void {
    if (!isFormId(value)) return;
    this.form.set(value);
    const time = this.timeId();
    if (time && !this.timeOptions().includes(time)) this.timeId.set('');
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

  /**
   * Play. Sight reading: the whole piece, or stop. Ear Training: the selected bars (or the whole
   * piece), of the original or of the listener's notes — and while playing, pause or resume.
   */
  protected togglePlay(): void {
    if (this.playback.loading()) {
      this.playback.stop();
      return;
    }
    if (!this.ear.active()) {
      if (this.playback.playing()) this.playback.stop();
      else void this.playback.play(this.piece(), this.bpm(), { countIn: this.ear.countIn() });
      return;
    }
    if (this.playback.playing()) {
      if (this.playback.paused()) this.playback.resume();
      else this.playback.pause();
      return;
    }
    const music = this.ear.source() === 'mine' ? transcriptionPiece(this.piece(), this.input.transcription()) : this.piece();
    const selection = this.ear.playRange();
    void this.playback.play(music, this.bpm(), {
      fromBar: selection.from,
      toBar: selection.to,
      loop: this.ear.loop(),
      countIn: this.ear.countIn(),
    });
  }

  /** Keyboard shortcuts — Space to play, and note input in Ear Training — except while typing in a field. */
  protected onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    // Space is always Play (as in MuseScore): the selected bars, or the whole piece — even when
    // a button (a bar just clicked, a note value) has the focus. Enter still presses a button.
    if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) this.togglePlay();
      return;
    }
    if (this.ear.active() && this.input.handleKey(event)) event.preventDefault();
  }

  protected print(): void {
    window.print();
  }
}
