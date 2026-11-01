import { nextReveal, selectionRange, validateSelection, withRevealed } from './ear-training';

describe('ear training selection', () => {
  it('accepts the full piece, any single bar, and forward ranges within the piece', () => {
    expect(validateSelection('full', 0, 0, 16)).toBeNull();
    expect(validateSelection('single', 13, 13, 32)).toBeNull();
    expect(validateSelection('range', 5, 9, 16)).toBeNull();
    expect(validateSelection('range', 7, 7, 16)).toBeNull();
  });

  it('rejects bars outside the piece, non-whole numbers and backwards ranges', () => {
    expect(validateSelection('single', 0, 0, 16)).toMatch(/1 to 16/);
    expect(validateSelection('single', 17, 17, 16)).toMatch(/1 to 16/);
    expect(validateSelection('single', 2.5, 2.5, 16)).toMatch(/1 to 16/);
    expect(validateSelection('range', 3, 20, 16)).toMatch(/end bar/);
    expect(validateSelection('range', 9, 5, 16)).toMatch(/after the start/);
  });

  it('turns 1-based bar numbers into 0-based ranges', () => {
    expect(selectionRange('full', 4, 6, 16)).toEqual({ from: 0, to: 15 });
    expect(selectionRange('single', 13, 13, 32)).toEqual({ from: 12, to: 12 });
    expect(selectionRange('range', 5, 9, 16)).toEqual({ from: 4, to: 8 });
  });
});

describe('ear training reveals', () => {
  it('follows the dev card example: select 5–8, reveal 5, then 6, 7 and 8, leaving the rest hidden', () => {
    let revealed: number[] = [];
    // "Reveal bar" on the selected bar 5 (index 4).
    revealed = withRevealed(revealed, 4);
    let cursor: number | null = 4;
    for (const expected of [5, 6, 7]) {
      const bar: number = nextReveal(revealed, cursor, 4, 16)!;
      expect(bar).toBe(expected);
      revealed = withRevealed(revealed, bar);
      cursor = bar;
    }
    expect(revealed).toEqual([4, 5, 6, 7]);
  });

  it('can reveal a bar in the middle without revealing the bars before it', () => {
    expect(withRevealed([], 12)).toEqual([12]);
    expect(nextReveal([12], 12, 12, 16)).toBe(13);
  });

  it('starts from the selected bar, skips bars already showing and stops at the end', () => {
    expect(nextReveal([], null, 2, 8)).toBe(2);
    expect(nextReveal([3, 4], 2, 2, 8)).toBe(5);
    expect(nextReveal([7], 6, 0, 8)).toBeNull();
    expect(nextReveal([], 7, 0, 8)).toBeNull();
  });

  it('keeps reveals sorted and unique', () => {
    expect(withRevealed([1, 5], 3)).toEqual([1, 3, 5]);
    expect(withRevealed([1, 3], 3)).toEqual([1, 3]);
  });
});
