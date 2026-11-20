import { generatePiece } from '../music/generator';
import { Bar, Note, Piece } from '../music/model';
import { Letter } from '../music/theory';
import { breakdown, beatName, checkAnswers, checkStaff, summarise } from './scoring';
import { Transcription, emptyTranscription } from './transcription';

const base = generatePiece({ seed: 'score', grade: 3, style: 'classical', timeId: '4/4' });
const n = (letter: Letter, octave: number, ticks: number, alter = 0): Note => ({ pitches: [{ letter, alter, octave }], ticks });
const r = (ticks: number): Note => ({ pitches: [], ticks, rest: true });
const bar = (rh: Note[], lh: Note[] = [r(16)]): Bar => ({ harmony: [], rh, lh });

/** A piece of our own: bars of given right-hand notes (left hand resting). */
function pieceOf(...rh: Note[][]): Piece {
  return { ...base, bars: rh.map((notes) => bar(notes)), expression: undefined };
}
/** An answer: the given right-hand notes in the given bars, rests elsewhere. */
function answer(piece: Piece, rh: Record<number, Note[]>): Transcription {
  const t = emptyTranscription(piece);
  for (const [b, notes] of Object.entries(rh)) t.bars[Number(b)].rh = notes;
  return t;
}
const scale = [n('C', 5, 4), n('D', 5, 4), n('E', 5, 4), n('F', 5, 4)];

describe('scoring: checking the attempted bars', () => {
  it('scores a perfect answer 100%, checking only what was attempted', () => {
    const piece = pieceOf(scale, scale, scale);
    const t = answer(piece, { 0: scale, 1: scale });
    const result = checkAnswers(piece, t, new Set(['0:rh', '1:rh']), new Set());
    expect(result.percent).toBe(100);
    expect(result.staves.map((s) => `${s.bar}:${s.staff}`)).toEqual(['0:rh', '1:rh']);
    expect(summarise(result)).toBe('2 of 3 bars attempted · Treble clef only');
  });

  it('counts a missing note against an attempted bar, without shifting the notes after it', () => {
    const piece = pieceOf(scale);
    const s = checkStaff(piece, answer(piece, { 0: [n('C', 5, 4), r(4), n('E', 5, 4), n('F', 5, 4)] }), 0, 'rh', false);
    expect(s.percent).toBe(75);
    expect(s.missing).toEqual([{ tick: 4, ticks: 4, pitch: { letter: 'D', alter: 0, octave: 5 } }]);
    expect(s.marks.filter((m) => m.verdict === 'correct').length).toBe(3);
  });

  it('gives one correct note in a busy bar only its share', () => {
    const piece = pieceOf(scale);
    const s = checkStaff(piece, answer(piece, { 0: [n('C', 5, 4), r(4), r(8)] }), 0, 'rh', false);
    expect(s.percent).toBe(25);
  });

  it('splits each note equally between pitch, length and position', () => {
    const piece = pieceOf(scale);
    // D a semitone out: right length and place.
    const wrongPitch = checkStaff(piece, answer(piece, { 0: [n('C', 5, 4), n('D', 5, 4, 1), n('E', 5, 4), n('F', 5, 4)] }), 0, 'rh', false);
    expect(wrongPitch.percent).toBe(Math.round(((3 + 2 / 3) / 4) * 100));
    expect(wrongPitch.marks.find((m) => m.verdict === 'wrong')).toMatchObject({ hint: 'Wrong pitch', detail: 'Expected: D5 crotchet · Your answer: D♯5 crotchet' });
    // D a quaver late (and a quaver long): right pitch only.
    const late = checkStaff(piece, answer(piece, { 0: [n('C', 5, 4), r(2), n('D', 5, 2), n('E', 5, 4), n('F', 5, 4)] }), 0, 'rh', false);
    expect(late.percent).toBe(Math.round(((3 + 1 / 3) / 4) * 100));
    expect(late.marks.find((m) => m.verdict === 'wrong')!.hint).toBe('Right note, in the wrong place');
  });

  it('lets extra notes lower the score', () => {
    const piece = pieceOf(scale);
    // E shortened to a quaver and an extra G after it.
    const s = checkStaff(piece, answer(piece, { 0: [n('C', 5, 4), n('D', 5, 4), n('E', 5, 2), n('G', 5, 2), n('F', 5, 4)] }), 0, 'rh', false);
    expect(s.possible).toBe(5);
    expect(s.percent).toBe(Math.round(((3 + 2 / 3) / 5) * 100));
    expect(s.marks.find((m) => m.verdict === 'extra')!.hint).toBe('Not in the original');
  });

  it('marks a bar of rest answered with rests as right, and with notes as wrong', () => {
    const piece = pieceOf([r(16)]);
    expect(checkStaff(piece, answer(piece, {}), 0, 'rh', false).percent).toBe(100);
    expect(checkStaff(piece, answer(piece, { 0: [n('C', 5, 16)] }), 0, 'rh', false).percent).toBe(0);
  });

  it('weights the overall score by notes, not by averaging bars', () => {
    const piece = pieceOf(scale, [n('G', 5, 16)]);
    const t = answer(piece, { 0: scale, 1: [n('A', 4, 16)] });
    // Bar 1: 4/4 right. Bar 2: the one note wrong in pitch only (2/3). (4 + 2/3) / 5 = 93%.
    expect(checkAnswers(piece, t, new Set(['0:rh', '1:rh']), new Set()).percent).toBe(93);
  });

  it('leaves revealed bars out of the overall score, and has no score when only those were tried', () => {
    const piece = pieceOf(scale, scale);
    const t = answer(piece, { 0: scale, 1: [r(16)] });
    const result = checkAnswers(piece, t, new Set(['0:rh', '1:rh']), new Set([1]));
    expect(result.percent).toBe(100);
    expect(result.staves[1]).toMatchObject({ revealed: true, percent: 0 });
    expect(checkAnswers(piece, t, new Set(['1:rh']), new Set([1])).percent).toBeNull();
  });

  it('checks treble and bass apart, and a chorale stave against both its voices', () => {
    const chorale = generatePiece({ seed: 'score', grade: 2, style: 'chorale' });
    const t = emptyTranscription(chorale);
    // The soprano alone on the treble stave misses the alto.
    t.bars[1].rh = chorale.bars[1].voices!.s.map((x) => ({ ...x, fermata: undefined }));
    const s = checkStaff(chorale, t, 1, 'rh', false);
    const sop = chorale.bars[1].voices!.s.filter((x) => !x.rest).length;
    const alto = chorale.bars[1].voices!.a.filter((x) => !x.rest).length;
    expect(s.possible).toBe(sop + alto);
    expect(s.earned).toBe(sop);
  });

  it('lists each attempted bar, and runs of untouched bars per stave', () => {
    const piece = pieceOf(scale, scale, scale);
    const result = checkAnswers(piece, answer(piece, { 0: scale, 1: scale }), new Set(['0:rh', '1:rh']), new Set());
    expect(breakdown(result).map((row) => `${row.bars} ${row.staff} ${row.result ? row.result.percent + '%' : 'not attempted'}`)).toEqual([
      '1 rh 100%',
      '2 rh 100%',
      '3 rh not attempted',
      '1–3 lh not attempted',
    ]);
  });

  it('names beats for the feedback', () => {
    expect(beatName(0, base.time)).toBe('beat 1');
    expect(beatName(6, base.time)).toBe('beat 2½');
  });
});
