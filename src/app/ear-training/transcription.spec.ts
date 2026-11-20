import { splitTicks } from '../music/durations';
import { generatePiece } from '../music/generator';
import { Note } from '../music/model';
import { keyById, midi } from '../music/theory';
import {
  Transcription,
  addToChord,
  clearElement,
  displayPiece,
  emptyTranscription,
  mapPitches,
  nearestLetter,
  pitchAt,
  setDuration,
  spell,
  step,
  transcriptionPiece,
  transpose,
  write,
} from './transcription';

const piece = generatePiece({ seed: 'transcribe', grade: 3, style: 'classical', timeId: '4/4' });
const C5 = { letter: 'C' as const, alter: 0, octave: 5 };
const E4 = { letter: 'E' as const, alter: 0, octave: 4 };
const ticks = (notes: Note[]) => notes.map((n) => (n.rest ? `r${n.ticks}` : `${n.ticks}${n.tie ? '~' : ''}`)).join(' ');
const filled = (t: Transcription) => t.bars.every((b, i) => [b.rh, b.lh].every((v) => v.reduce((a, n) => a + n.ticks, 0) === t.lengths[i]));

describe('transcription: writing notes like MuseScore', () => {
  it('starts with every bar full of rests on both staves', () => {
    const t = emptyTranscription(piece);
    expect(t.bars.length).toBe(piece.bars.length);
    expect(ticks(t.bars[0].rh)).toBe('r16');
    expect(filled(t)).toBe(true);
  });

  it('overwrites the rest where a note goes and moves the input position on', () => {
    const t = emptyTranscription(piece);
    const r = write(t, { bar: 0, staff: 'rh', tick: 0 }, 4, [C5]);
    // The rests left line up with the beats: a crotchet rest, then a minim rest.
    expect(ticks(r.transcription.bars[0].rh)).toBe('4 r4 r8');
    expect(r.placed).toEqual({ bar: 0, staff: 'rh', index: 0 });
    expect(r.next).toEqual({ bar: 0, staff: 'rh', tick: 4 });
    const q = write(r.transcription, r.next!, 2, [E4]);
    expect(ticks(q.transcription.bars[0].rh)).toBe('4 2 r2 r8');
    expect(q.next).toEqual({ bar: 0, staff: 'rh', tick: 6 });
    expect(filled(q.transcription)).toBe(true);
  });

  it('leaves rests for the remainder of a longer note it cuts short', () => {
    let t = write(emptyTranscription(piece), { bar: 0, staff: 'rh', tick: 0 }, 16, [C5]).transcription;
    t = write(t, { bar: 0, staff: 'rh', tick: 0 }, 4, [E4]).transcription;
    expect(ticks(t.bars[0].rh)).toBe('4 r4 r8');
  });

  it('keeps a note inside its bar (note input checks it fits first)', () => {
    const r = write(emptyTranscription(piece), { bar: 0, staff: 'lh', tick: 12 }, 8, [E4]);
    expect(ticks(r.transcription.bars[0].lh)).toBe('r12 4');
    expect(ticks(r.transcription.bars[1].lh)).toBe('r16');
    expect(r.next).toEqual({ bar: 1, staff: 'lh', tick: 0 });
  });

  it('keeps the head of a note it starts inside, tied together, with rests after', () => {
    let t = write(emptyTranscription(piece), { bar: 0, staff: 'rh', tick: 0 }, 12, [C5]).transcription;
    t = write(t, { bar: 0, staff: 'rh', tick: 10 }, 1, [E4]).transcription;
    expect(ticks(t.bars[0].rh)).toBe('8~ 2 1 r1 r4');
  });

  it('writes demisemiquavers and dotted values, and rests', () => {
    let r = write(emptyTranscription(piece), { bar: 0, staff: 'rh', tick: 0 }, 0.5, [C5]);
    r = write(r.transcription, r.next!, 1.5, [E4]);
    r = write(r.transcription, r.next!, 2, null);
    expect(ticks(r.transcription.bars[0].rh).startsWith('0.5 1.5 r2')).toBe(true);
    expect(filled(r.transcription)).toBe(true);
  });

  it('writes a 3/4 bar of rest as one dotted minim rest, and dotted rests by the beat in 6/8', () => {
    const waltz = emptyTranscription(generatePiece({ seed: 'w', grade: 3, style: 'waltz', timeId: '3/4' }));
    expect(ticks(waltz.bars[1].rh)).toBe('r12');
    const jig = write(emptyTranscription(generatePiece({ seed: 'j', grade: 3, style: 'folk', timeId: '6/8' })), { bar: 1, staff: 'rh', tick: 0 }, 2, [C5]);
    expect(ticks(jig.transcription.bars[1].rh)).toBe('2 r4 r6');
  });

  it('splits awkward lengths into note values', () => {
    expect(splitTicks(5)).toEqual([4, 1]);
    expect(splitTicks(18)).toEqual([16, 2]);
    expect(splitTicks(0.5)).toEqual([0.5]);
  });

  it('ends input at the end of the piece', () => {
    const t = emptyTranscription(piece);
    const last = t.bars.length - 1;
    expect(write(t, { bar: last, staff: 'rh', tick: 12 }, 4, [C5]).next).toBeNull();
  });
});

describe('transcription: editing', () => {
  const start = () => write(emptyTranscription(piece), { bar: 0, staff: 'rh', tick: 0 }, 4, [C5]).transcription;
  const ref = { bar: 0, staff: 'rh' as const, index: 0 };

  it('adds notes to a chord, sorted low to high', () => {
    const t = addToChord(start(), ref, E4);
    expect(t.bars[0].rh[0].pitches.map(midi)).toEqual([64, 72]);
  });

  it('changes pitch by semitone, spelled the way it moves, and by octave', () => {
    expect(transpose(C5, 1)).toEqual({ letter: 'C', alter: 1, octave: 5 });
    expect(transpose(C5, -1)).toEqual({ letter: 'B', alter: 0, octave: 4 });
    expect(transpose(E4, -1)).toEqual({ letter: 'E', alter: -1, octave: 4 });
    expect(transpose(C5, 12)).toEqual({ letter: 'C', alter: 0, octave: 6 });
    const t = mapPitches(start(), ref, (p) => transpose(p, 2));
    expect(t.bars[0].rh[0].pitches[0]).toEqual({ letter: 'D', alter: 0, octave: 5 });
  });

  it('lengthens a note over what follows, and shortening leaves rests', () => {
    const longer = setDuration(start(), ref, 8)!.transcription;
    expect(ticks(longer.bars[0].rh)).toBe('8 r8');
    const shorter = setDuration(longer, ref, 2)!.transcription;
    expect(ticks(shorter.bars[0].rh)).toBe('2 r2 r4 r8');
  });

  it('deletes a note by turning it into a rest, and drops a tie that no longer leads anywhere', () => {
    // A dotted minim cut into a minim tied to a quaver; deleting the quaver leaves the minim untied.
    let tied = write(emptyTranscription(piece), { bar: 0, staff: 'rh', tick: 0 }, 12, [C5]).transcription;
    tied = write(tied, { bar: 0, staff: 'rh', tick: 10 }, 2, null).transcription;
    expect(tied.bars[0].rh[0].tie).toBe(true);
    const t = clearElement(tied, { bar: 0, staff: 'rh', index: 1 });
    expect(t.bars[0].rh[1].rest).toBe(true);
    expect(t.bars[0].rh[0].tie).toBeUndefined();
    expect(clearElement(t, { bar: 0, staff: 'rh', index: 1 })).toBe(t);
  });

  it('moves between elements across bar lines', () => {
    const t = start();
    expect(step(t, { bar: 0, staff: 'rh', index: 2 }, 1)).toEqual({ bar: 1, staff: 'rh', index: 0 });
    expect(step(t, { bar: 1, staff: 'rh', index: 0 }, -1)).toEqual({ bar: 0, staff: 'rh', index: 2 });
    expect(step(t, ref, -1)).toBeNull();
  });
});

describe('transcription: pitches and pieces', () => {
  it('writes a line or space as the key signature has it, when it is shown', () => {
    const g = keyById('G')!;
    const f5 = 5 * 7 + 3;
    expect(pitchAt(f5, g)).toEqual({ letter: 'F', alter: 1, octave: 5 });
    expect(pitchAt(f5, null)).toEqual({ letter: 'F', alter: 0, octave: 5 });
  });

  it('enters a letter in the octave nearest the previous note', () => {
    const near = nearestLetter('D', C5, 'rh');
    expect(near).toBe(5 * 7 + 1);
    expect(nearestLetter('B', C5, 'rh')).toBe(4 * 7 + 6);
    expect(spell(61, true)).toEqual({ letter: 'C', alter: 1, octave: 4 });
    expect(spell(61, false)).toEqual({ letter: 'D', alter: -1, octave: 4 });
  });

  it('shows the original in revealed bars and the transcription elsewhere', () => {
    const t = write(emptyTranscription(piece), { bar: 0, staff: 'rh', tick: 0 }, 4, [C5]).transcription;
    const shown = displayPiece(piece, t, new Set([1]));
    expect(shown.bars[0].rh).toBe(t.bars[0].rh);
    expect(shown.bars[1]).toBe(piece.bars[1]);
    const mine = transcriptionPiece(piece, t);
    expect(mine.bars[0].rh[0].pitches).toEqual([C5]);
    expect(mine.time).toBe(piece.time);
  });
});
