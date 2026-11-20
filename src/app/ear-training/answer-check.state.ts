import { Injectable, computed, inject, signal } from '@angular/core';
import type { BarMarks } from '../score/engraving';
import type { MissingOnScore } from '../score/score.component';
import { EarTrainingState } from './ear-training.state';
import { NoteInputState } from './note-input.state';
import { CheckResult, checkAnswers, staffKey } from './scoring';
import type { Staff } from '../music/model';

export const RIGHT = '#1e8e3e';
export const WRONG = '#d93025';

/**
 * Check Answers: scores the attempted bars against the original without revealing it. The
 * result is a snapshot — it changes only when the listener checks again — and a bar edited
 * since the check loses its colours (and is flagged) until then. Review Mistakes adds the
 * answers: what each wrong note should have been, and the notes left out.
 */
@Injectable({ providedIn: 'root' })
export class AnswerCheckState {
  private readonly input = inject(NoteInputState);
  private readonly ear = inject(EarTrainingState);

  readonly result = signal<CheckResult | null>(null);
  /** Check was pressed with nothing attempted. */
  readonly nothingToCheck = signal(false);
  /** Review Mistakes: show the expected notes, not just right and wrong. */
  readonly review = signal(false);
  /** Each checked bar/stave's notes as they were when checked. */
  private readonly snapshot = signal<ReadonlyMap<string, string>>(new Map());

  check(): void {
    const piece = this.input.piece();
    if (!piece) return;
    const attempted = this.input.attempted();
    if (!attempted.size) {
      this.result.set(null);
      this.nothingToCheck.set(true);
      return;
    }
    const t = this.input.transcription();
    const result = checkAnswers(piece, t, attempted, new Set(this.ear.revealed()));
    this.snapshot.set(new Map(result.staves.map((s) => [staffKey(s.bar, s.staff), JSON.stringify(t.bars[s.bar][s.staff])])));
    this.nothingToCheck.set(false);
    this.result.set(result);
  }

  /** Back to before any check (a new piece, or the panel closed). */
  reset(): void {
    this.result.set(null);
    this.nothingToCheck.set(false);
    this.review.set(false);
    this.snapshot.set(new Map());
  }

  /** Bar/staves changed (or reset) since the check. */
  readonly stale = computed(() => {
    const t = this.input.transcription();
    const attempted = this.input.attempted();
    const out = new Set<string>();
    for (const [key, notes] of this.snapshot()) {
      const [bar, staff] = key.split(':') as [string, Staff];
      if (!attempted.has(key) || JSON.stringify(t.bars[Number(bar)]?.[staff]) !== notes) out.add(key);
    }
    return out;
  });

  /** Results that still describe what is on the score: not edited since, and not now revealed. */
  private readonly live = computed(() => {
    const r = this.result();
    if (!r) return [];
    const stale = this.stale();
    const revealed = new Set(this.ear.revealed());
    return r.staves.filter((s) => !stale.has(staffKey(s.bar, s.staff)) && !revealed.has(s.bar));
  });

  /** Green and red noteheads for the score, bar by bar. */
  readonly marks = computed<ReadonlyMap<number, BarMarks>>(() => {
    const t = this.input.transcription();
    const out = new Map<number, BarMarks>();
    for (const s of this.live()) {
      const bar = out.get(s.bar) ?? { rh: [], lh: [] };
      const voice = t.bars[s.bar][s.staff];
      const colours = voice.map((n) => (n.rest ? undefined : n.pitches.map((): string | null => null)));
      for (const m of s.marks) {
        const keys = colours[m.index];
        if (keys) keys[m.key] = m.verdict === 'correct' ? RIGHT : WRONG;
      }
      bar[s.staff] = colours;
      out.set(s.bar, bar);
    }
    return out;
  });

  /** The listener's notes with anything wrong (marked with a cross too, not by colour alone). */
  readonly wrongNotes = computed(() =>
    this.live().flatMap((s) => [...new Set(s.marks.filter((m) => m.verdict !== 'correct').map((m) => m.index))].map((index) => ({ bar: s.bar, staff: s.staff, index }))),
  );

  /** What to say about each of the listener's notes when it is selected: "bar:staff:index" → lines. */
  readonly feedback = computed<ReadonlyMap<string, string[]>>(() => {
    const out = new Map<string, string[]>();
    const review = this.review();
    for (const s of this.live()) {
      for (const m of s.marks) {
        const key = `${s.bar}:${s.staff}:${m.index}`;
        const line = review || m.verdict === 'correct' ? m.detail : m.hint;
        out.set(key, [...(out.get(key) ?? []), line]);
      }
    }
    return out;
  });

  /** The notes left out, shown while reviewing mistakes. */
  readonly missing = computed<MissingOnScore[]>(() => {
    if (!this.review()) return [];
    return this.live().flatMap((s) => s.missing.map((m) => ({ bar: s.bar, staff: s.staff, tick: m.tick, ticks: m.ticks, pitch: m.pitch })));
  });

  readonly anyStale = computed(() => this.result() !== null && this.stale().size > 0);
}
