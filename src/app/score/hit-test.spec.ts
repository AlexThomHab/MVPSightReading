import { BarGeometry } from './engraving';
import { TOP_LINE, anchors, elementAt, inputTargetAt, ledgerLines, snapGrid, tickAtX, xAtTick, yOf } from './hit-test';

/**
 * A 4/4 bar drawn from x 300 to 500 (notes from 310): treble top line at y 100, bass at 210.
 * The treble has two crotchets then a minim rest — drawn closer together than their lengths
 * (engraving is not proportional); the bass a lone whole-bar rest in the middle.
 */
const bar: BarGeometry = {
  bar: 2,
  lhClef: 'bass',
  left: 300,
  right: 500,
  noteStart: 310,
  rhTop: 100,
  lhTop: 210,
  length: 16,
  elements: [
    { staff: 'rh', index: 0, tick: 0, ticks: 4, rest: false, x: 320, w: 12, ys: [120] },
    { staff: 'rh', index: 1, tick: 4, ticks: 4, rest: false, x: 360, w: 12, ys: [105, 115] },
    { staff: 'rh', index: 2, tick: 8, ticks: 8, rest: true, x: 400, w: 12, ys: [120] },
    { staff: 'lh', index: 0, tick: 0, ticks: 16, rest: true, x: 395, w: 12, ys: [230] },
  ],
};
const empty: BarGeometry = { ...bar, elements: [{ staff: 'rh', index: 0, tick: 0, ticks: 16, rest: true, x: 395, w: 12, ys: [120] }] };

describe('hit-test: from the pointer to music', () => {
  it('reads time from the notes as drawn, not from the width of the bar', () => {
    // A lone bar rest says nothing; the notes and the bar's ends anchor the mapping.
    expect(anchors(bar)).toEqual([
      [320, 0],
      [360, 4],
      [400, 8],
      [484, 16],
    ]);
    expect(tickAtX(bar, 340)).toBe(2);
    expect(tickAtX(bar, 442)).toBe(12);
    expect(xAtTick(bar, 12)).toBe(442);
    // An empty bar is read evenly from the start of the notes to the end.
    expect(anchors(empty)).toEqual([
      [314, 0],
      [484, 16],
    ]);
  });

  it('snaps to the grid of the note being written', () => {
    expect(snapGrid(4, false)).toBe(4);
    expect(snapGrid(6, false)).toBe(4); // a dotted crotchet starts on a beat in simple time
    expect(snapGrid(6, true)).toBe(6); // and fills one in compound time
    // Crotchets: the nearest beat to the pointer.
    expect(inputTargetAt([bar], 335, 120, 4, false)).toMatchObject({ tick: 0, x: 320 });
    expect(inputTargetAt([bar], 345, 120, 4, false)).toMatchObject({ tick: 4, x: 360 });
    expect(inputTargetAt([bar], 440, 120, 4, false)).toMatchObject({ tick: 12, x: 442, endX: 484, fits: true });
    // Quavers: the half beats too.
    expect(inputTargetAt([bar], 381, 120, 2, false)).toMatchObject({ tick: 6 });
    // Minims: beat 1 or 3; a semibreve only at the start.
    expect(inputTargetAt([bar], 440, 120, 8, false)).toMatchObject({ tick: 8 });
    expect(inputTargetAt([bar], 470, 120, 16, false)).toMatchObject({ tick: 0, fits: true });
  });

  it('keeps a note inside the bar, and says when it cannot fit at all', () => {
    // A dotted minim (on the minim grid) near the end starts where it still fits: beat 1.
    expect(inputTargetAt([bar], 480, 120, 12, false)).toMatchObject({ tick: 0, fits: true });
    // A crotchet near the end goes on beat 4.
    expect(inputTargetAt([bar], 480, 120, 4, false)).toMatchObject({ tick: 12, fits: true });
    // A dotted semibreve never fits in 4/4.
    expect(inputTargetAt([bar], 400, 120, 24, false)).toMatchObject({ fits: false });
  });

  it('snaps a height to the nearest line or space of the nearer stave', () => {
    // Treble top line is F5; the middle line (y 120) is B4.
    expect(inputTargetAt([bar], 325, 120, 4, false)).toMatchObject({ bar: 2, staff: 'rh', diatonic: TOP_LINE.rh - 4 });
    expect(inputTargetAt([bar], 325, 124, 4, false)!.diatonic).toBe(TOP_LINE.rh - 5);
    expect(inputTargetAt([bar], 325, 210, 4, false)).toMatchObject({ staff: 'lh', diatonic: TOP_LINE.lh });
  });

  it('reaches five ledger lines beyond a stave and no further, and nothing outside a bar', () => {
    expect(inputTargetAt([bar], 325, 45, 4, false)!.diatonic).toBe(TOP_LINE.rh + 10);
    expect(inputTargetAt([bar], 600, 120, 4, false)).toBeNull();
    expect(inputTargetAt([bar], 325, -200, 4, false)).toBeNull();
  });

  it('finds the note or rest under the pointer', () => {
    expect(elementAt([bar], 365, 106)).toEqual({ bar: 2, staff: 'rh', index: 1 });
    expect(elementAt([bar], 406, 128)).toEqual({ bar: 2, staff: 'rh', index: 2 });
    expect(elementAt([bar], 345, 120)).toBeNull();
  });

  it('places notes and their ledger lines', () => {
    expect(yOf('rh', 100, TOP_LINE.rh - 8)).toBe(140);
    expect(ledgerLines('rh', 100, TOP_LINE.rh - 10)).toEqual([150]);
    expect(ledgerLines('rh', 100, TOP_LINE.rh + 2)).toEqual([90]);
    expect(ledgerLines('rh', 100, TOP_LINE.rh - 4)).toEqual([]);
  });
});
