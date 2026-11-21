import { TestBed } from '@angular/core/testing';
import { generatePiece } from '../music/generator';
import { diatonicIndex } from '../music/theory';
import { PlaybackService } from '../playback/playback.service';
import { AnswerCheckState, RIGHT, WRONG } from './answer-check.state';
import { EarTrainingState } from './ear-training.state';
import { NoteInputState } from './note-input.state';

describe('Check Answers: attempts, checking and feedback', () => {
  let input: NoteInputState;
  let check: AnswerCheckState;
  let ear: EarTrainingState;
  const piece = generatePiece({ seed: 'check', grade: 2, form: 'trio', timeId: '4/4' });
  const key = (k: string, o: KeyboardEventInit = {}) => input.handleKey(new KeyboardEvent('keydown', { key: k, ...o }));
  /** Writes the original's first right-hand note (a single note) exactly, then leaves note input with it selected. */
  const writeFirstNoteRight = () => {
    const first = piece.bars[0].rh[0];
    expect(first.rest || first.pitches.length !== 1).toBe(false);
    key('n');
    const dotted = [12, 6, 3, 1.5, 0.75].includes(first.ticks);
    input.setBase(dotted ? first.ticks / 1.5 : first.ticks);
    if (dotted !== input.dotted()) input.toggleDot();
    input.clickAt({ bar: 0, staff: 'rh', tick: 0, diatonic: diatonicIndex(first.pitches[0]), x: 0, endX: 0, fits: true }, false);
    input.setAccidental(first.pitches[0].alter as -1 | 0 | 1);
    key('Escape');
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(TestBed.inject(PlaybackService), 'preview').mockResolvedValue();
    input = TestBed.inject(NoteInputState);
    check = TestBed.inject(AnswerCheckState);
    ear = TestBed.inject(EarTrainingState);
    ear.reset(piece.bars.length);
    input.load(piece);
    check.reset();
  });

  it('says to enter some notes, rather than 0%, when nothing has been attempted', () => {
    check.check();
    expect(check.nothingToCheck()).toBe(true);
    expect(check.result()).toBeNull();
  });

  it('marks a bar/stave attempted when written in, keeps it attempted when emptied, and resets it on request', () => {
    key('n');
    key('c');
    expect([...input.attempted()]).toEqual(['0:rh']);
    key('Escape');
    key('Delete');
    expect(input.hasNotes()).toBe(false);
    expect([...input.attempted()]).toEqual(['0:rh']);
    input.resetAttempt(0, 'rh');
    expect(input.attempted().size).toBe(0);
    input.undo();
    expect([...input.attempted()]).toEqual(['0:rh']);
  });

  it('does not count a revealed bar as attempted', () => {
    ear.revealAll();
    expect(input.attempted().size).toBe(0);
  });

  it('checks only the attempted staves, and colours the notes green or red', () => {
    writeFirstNoteRight();
    check.check();
    const result = check.result()!;
    expect(result.staves.map((s) => `${s.bar}:${s.staff}`)).toEqual(['0:rh']);
    const colours = check.marks().get(0)!.rh[0];
    expect(colours).toEqual([RIGHT]);
    // A wrong note is red, with a hint that does not give the answer away.
    input.transposeSelected(1);
    check.check();
    expect(check.marks().get(0)!.rh[0]![0]).toBe(WRONG);
    expect(check.feedback().get('0:rh:0')).toEqual(['Wrong pitch']);
    check.review.set(true);
    expect(check.feedback().get('0:rh:0')![0]).toMatch(/^Expected: /);
  });

  it('keeps the score until checking again, and drops the colours of a bar edited since', () => {
    writeFirstNoteRight();
    check.check();
    const before = check.result()!.percent;
    input.transposeSelected(2);
    expect(check.result()!.percent).toBe(before);
    expect(check.anyStale()).toBe(true);
    expect(check.marks().size).toBe(0);
    check.check();
    expect(check.anyStale()).toBe(false);
    expect(check.result()!.percent).toBeLessThan(before!);
  });

  it('tries again: the marking goes and the notes stay, ready to check again', () => {
    writeFirstNoteRight();
    input.select({ bar: 0, staff: 'rh', index: 0 });
    check.check();
    check.review.set(true);
    const notes = input.transcription();
    check.tryAgain();
    expect(check.result()).toBeNull();
    expect(check.review()).toBe(false);
    expect(check.marks().size).toBe(0);
    expect(check.feedback().size).toBe(0);
    expect(input.selected()).toBeNull();
    expect(input.transcription()).toBe(notes);
    expect([...input.attempted()]).toEqual(['0:rh']);
    check.check();
    expect(check.result()!.staves.length).toBe(1);
  });

  it('shows the notes left out only when reviewing mistakes', () => {
    writeFirstNoteRight();
    check.check();
    const expectedLeft = piece.bars[0].rh.filter((x) => !x.rest).reduce((a, x) => a + x.pitches.length, 0) - 1;
    expect(check.missing()).toEqual([]);
    check.review.set(true);
    expect(check.missing().length).toBe(expectedLeft);
  });

  it('hides marks on a bar once it is revealed (the original is showing there)', () => {
    writeFirstNoteRight();
    check.check();
    ear.reveal([0]);
    expect(check.marks().size).toBe(0);
  });
});
