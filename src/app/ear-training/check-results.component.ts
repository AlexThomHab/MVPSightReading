import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AnswerCheckState } from './answer-check.state';
import { EarTrainingState } from './ear-training.state';
import { NoteInputState } from './note-input.state';
import { breakdown, staffKey, summarise } from './scoring';
import type { Staff } from '../music/model';

/**
 * The result of Check Answers: the overall accuracy over the attempted bars, a bar-by-bar
 * breakdown, and the next steps — check again, review the mistakes, or reveal the answers.
 */
@Component({
  selector: 'app-check-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (check.nothingToCheck()) {
      <section class="results" aria-live="polite">
        <div class="headline">
          <strong>Enter some notes to check.</strong>
          <span class="summary">Press N, write what you hear in any bar (treble or bass), then check — only the bars you try are marked.</span>
        </div>
        <button type="button" class="close" (click)="check.reset()" aria-label="Close">✕</button>
      </section>
    } @else if (check.result(); as r) {
      <section class="results" aria-label="Your answers" aria-live="polite">
        <div class="headline">
          @if (r.percent !== null) {
            <span class="score" [class.good]="r.percent >= 80" [class.fair]="r.percent >= 50 && r.percent < 80">{{ r.percent }}%</span>
            <span class="score-label">accuracy</span>
          } @else {
            <strong>No score: every bar you tried has been revealed.</strong>
          }
          <span class="summary">{{ summary() }}</span>
          @if (check.anyStale()) {
            <span class="stale">You've changed notes since checking — check again to update.</span>
          }
        </div>
        <div class="actions">
          <button type="button" class="primary" (click)="check.check()">Check again</button>
          <button type="button" [class.on]="check.review()" [attr.aria-pressed]="check.review()" (click)="check.review.set(!check.review())">
            Review mistakes
          </button>
          <button type="button" (click)="revealAttempted()" [disabled]="allAttemptedRevealed()">Reveal answers</button>
          <button type="button" class="close" (click)="check.reset()" aria-label="Close the results">✕</button>
        </div>
        <table>
          <thead>
            <tr><th scope="col">Bar</th><th scope="col">Stave</th><th scope="col">Accuracy</th><th scope="col"><span class="visually-hidden">Reset</span></th></tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.staff + row.bars) {
              <tr [class.muted]="!row.result">
                <td>{{ row.bars }}</td>
                <td>{{ row.staff === 'rh' ? 'Treble' : 'Bass' }}</td>
                <td>
                  @if (row.result; as s) {
                    <span class="pct" [class.good]="s.percent >= 80" [class.fair]="s.percent >= 50 && s.percent < 80">{{ s.percent }}%</span>
                    @if (s.revealed) {
                      <span class="tag">answer seen · not counted</span>
                    }
                    @if (isStale(s.bar, s.staff)) {
                      <span class="tag">changed</span>
                    }
                  } @else {
                    Not attempted
                  }
                </td>
                <td>
                  @if (row.result; as s) {
                    <button type="button" class="small" (click)="input.resetAttempt(s.bar, s.staff)" title="Clear this bar and mark it not attempted">Reset</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="legend">
          <span class="dot right"></span> correct <span class="dot wrong"></span> wrong
          @if (check.review()) {
            <span class="dot missing"></span> missing — click a red note to see what it should be
          } @else {
            · click a red note to see what's wrong; Review mistakes shows the answers
          }
        </p>
      </section>
    }
  `,
  styles: `
    .results {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 10px 24px;
      margin: -6px 0 16px;
      padding: 12px 14px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-left: 3px solid var(--input);
      border-radius: 10px;
      font-size: 0.875rem;
    }
    .headline {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 10px;
      flex: 1 1 260px;
    }
    .score {
      font-size: 2rem;
      font-weight: 700;
      line-height: 1;
      color: #b3261e;
      font-variant-numeric: tabular-nums;
    }
    .score.fair,
    .pct.fair {
      color: #b06000;
    }
    .score.good,
    .pct.good {
      color: #1e8e3e;
    }
    .pct {
      font-weight: 700;
      color: #b3261e;
      font-variant-numeric: tabular-nums;
    }
    .score-label {
      font-weight: 600;
      color: var(--muted);
    }
    .summary {
      flex-basis: 100%;
      color: var(--muted);
    }
    .stale {
      flex-basis: 100%;
      color: #b06000;
      font-weight: 600;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    button {
      height: 30px;
      padding: 0 10px;
      border-radius: 7px;
    }
    button.primary,
    button.on {
      background: var(--input);
      border-color: var(--input);
      color: #fff;
      font-weight: 600;
    }
    button.small {
      height: 24px;
      padding: 0 8px;
      font-size: 0.78rem;
    }
    .close {
      width: 30px;
      padding: 0;
    }
    table {
      flex-basis: 100%;
      border-collapse: collapse;
      max-width: 520px;
    }
    th,
    td {
      text-align: left;
      padding: 4px 12px 4px 0;
      border-bottom: 1px solid var(--line);
      font-variant-numeric: tabular-nums;
    }
    th {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }
    tr.muted td {
      color: var(--muted);
    }
    .tag {
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--notice);
      font-size: 0.75rem;
    }
    .legend {
      flex-basis: 100%;
      margin: 0;
      color: var(--muted);
      font-size: 0.8rem;
    }
    .dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      margin: 0 3px 0 8px;
      border-radius: 50%;
      vertical-align: baseline;
    }
    .dot.right {
      background: #1e8e3e;
    }
    .dot.wrong {
      background: #d93025;
    }
    .dot.missing {
      background: rgb(227 116 0);
    }
    @media print {
      .results {
        display: none;
      }
    }
  `,
})
export class CheckResultsComponent {
  protected readonly check = inject(AnswerCheckState);
  protected readonly input = inject(NoteInputState);
  private readonly ear = inject(EarTrainingState);

  protected readonly rows = computed(() => {
    const r = this.check.result();
    return r ? breakdown(r) : [];
  });
  protected readonly summary = computed(() => {
    const r = this.check.result();
    return r ? summarise(r) : '';
  });
  private readonly attemptedBars = computed(() => [...new Set((this.check.result()?.staves ?? []).map((s) => s.bar))]);
  protected readonly allAttemptedRevealed = computed(() => this.attemptedBars().every((b) => this.ear.revealed().includes(b)));

  protected isStale(bar: number, staff: Staff): boolean {
    return this.check.stale().has(staffKey(bar, staff));
  }

  /** Shows the original in the bars that were attempted (only when asked). */
  protected revealAttempted(): void {
    this.ear.reveal(this.attemptedBars());
  }
}
