import { BarGeometry } from './engraving';
import { TOP_LINE, elementAt, inputTargetAt, ledgerLines, yOf } from './hit-test';

/** One bar: treble top line at y 100, bass top line at y 210; two crotchets then a minim rest in the treble. */
const bar: BarGeometry = {
  bar: 2,
  left: 300,
  right: 500,
  noteStart: 310,
  rhTop: 100,
  lhTop: 210,
  elements: [
    { staff: 'rh', index: 0, tick: 0, rest: false, x: 320, w: 12, ys: [120] },
    { staff: 'rh', index: 1, tick: 4, rest: false, x: 370, w: 12, ys: [105, 115] },
    { staff: 'rh', index: 2, tick: 8, rest: true, x: 430, w: 12, ys: [120] },
    { staff: 'lh', index: 0, tick: 0, rest: true, x: 390, w: 12, ys: [230] },
  ],
};

describe('hit-test: from the pointer to music', () => {
  it('snaps a height to the nearest line or space of the nearer stave', () => {
    // Treble top line is F5; the middle line (y 120) is B4.
    expect(inputTargetAt([bar], 325, 120)).toEqual({ bar: 2, staff: 'rh', index: 0, tick: 0, diatonic: TOP_LINE.rh - 4 });
    expect(inputTargetAt([bar], 325, 122)!.diatonic).toBe(TOP_LINE.rh - 4);
    expect(inputTargetAt([bar], 325, 124)!.diatonic).toBe(TOP_LINE.rh - 5);
    // Below the gap between the staves: the bass stave (top line A3).
    expect(inputTargetAt([bar], 325, 210)).toMatchObject({ staff: 'lh', diatonic: TOP_LINE.lh });
  });

  it('puts the pointer in the slot of the element it is over or after', () => {
    expect(inputTargetAt([bar], 305, 120)).toMatchObject({ index: 0, tick: 0 });
    expect(inputTargetAt([bar], 400, 120)).toMatchObject({ index: 1, tick: 4 });
    expect(inputTargetAt([bar], 480, 120)).toMatchObject({ index: 2, tick: 8 });
  });

  it('reaches five ledger lines beyond a stave and no further, and nothing outside a bar', () => {
    expect(inputTargetAt([bar], 325, 45)!.diatonic).toBe(TOP_LINE.rh + 10);
    expect(inputTargetAt([bar], 600, 120)).toBeNull();
    expect(inputTargetAt([bar], 325, -200)).toBeNull();
  });

  it('finds the note or rest under the pointer', () => {
    expect(elementAt([bar], 375, 106)).toEqual({ bar: 2, staff: 'rh', index: 1 });
    expect(elementAt([bar], 436, 128)).toEqual({ bar: 2, staff: 'rh', index: 2 });
    expect(elementAt([bar], 350, 120)).toBeNull();
  });

  it('places notes and their ledger lines', () => {
    expect(yOf('rh', 100, TOP_LINE.rh - 8)).toBe(140);
    // Middle C in the treble: one ledger line below.
    expect(ledgerLines('rh', 100, TOP_LINE.rh - 10)).toEqual([150]);
    // A5 in the treble: one above.
    expect(ledgerLines('rh', 100, TOP_LINE.rh + 2)).toEqual([90]);
    expect(ledgerLines('rh', 100, TOP_LINE.rh - 4)).toEqual([]);
  });
});
