import { TestBed } from '@angular/core/testing';
import { BarSelection, clickBar, describeSelection, dragBars, nextReveal, playRange, withRevealed } from './ear-training';
import { EarTrainingState } from './ear-training.state';

/** Applies a series of clicks (1-based bar numbers, as the user sees them). */
function clicks(...bars: number[]): BarSelection | null {
  return bars.reduce<BarSelection | null>((s, bar) => clickBar(s, bar - 1), null);
}
const bars = (s: BarSelection | null) => (s ? `${s.from + 1}–${s.to + 1}` : 'none');

describe('bar selection (always one continuous passage)', () => {
  it('selects a clicked bar', () => {
    expect(bars(clicks(3))).toBe('3–3');
  });

  it('extends to an adjacent bar, and to a distant bar including the bars between', () => {
    expect(bars(clicks(3, 4))).toBe('3–4');
    expect(bars(clicks(3, 7))).toBe('3–7');
    expect(bars(clicks(13, 17))).toBe('13–17');
    expect(bars(clicks(7, 3))).toBe('3–7');
    expect(bars(clicks(5, 6, 2))).toBe('2–6');
  });

  it('shrinks from either end when an end bar is clicked, never leaving a gap', () => {
    expect(bars(clicks(3, 7, 7))).toBe('3–6');
    expect(bars(clicks(3, 7, 3))).toBe('4–7');
  });

  it('clears when the only selected bar is clicked again', () => {
    expect(clicks(3, 3)).toBeNull();
  });

  it('starts a new selection when a bar in the middle is clicked (removing it would split the passage)', () => {
    expect(bars(clicks(3, 7, 5))).toBe('5–5');
  });

  it('drags across any bars, in either direction, as one passage', () => {
    expect(dragBars(2, 9)).toEqual({ from: 2, to: 9 });
    expect(dragBars(9, 2)).toEqual({ from: 2, to: 9 });
    expect(dragBars(4, 4)).toEqual({ from: 4, to: 4 });
  });

  it('plays the selection, or the whole piece when nothing is selected', () => {
    expect(playRange(null, 16)).toEqual({ from: 0, to: 15 });
    expect(playRange({ from: 2, to: 2 }, 16)).toEqual({ from: 2, to: 2 });
    expect(playRange({ from: 2, to: 5 }, 16)).toEqual({ from: 2, to: 5 });
  });

  it('describes the selection', () => {
    expect(describeSelection(null)).toBe('Whole piece');
    expect(describeSelection({ from: 2, to: 2 })).toBe('Bar 3');
    expect(describeSelection({ from: 12, to: 16 })).toBe('Bars 13–17');
  });
});

describe('reveals', () => {
  it('reveals the next concealed bar in score order, wrapping round, until none are left', () => {
    expect(nextReveal([], null, 0, 8)).toBe(0);
    expect(nextReveal([4], 4, 0, 8)).toBe(5);
    expect(nextReveal([3, 4, 5], 3, 0, 8)).toBe(6);
    expect(nextReveal([6, 7], 7, 0, 8)).toBe(0);
    expect(nextReveal([0, 1, 2, 3, 4, 5, 6, 7], 7, 0, 8)).toBeNull();
  });

  it('keeps reveals sorted and unique', () => {
    expect(withRevealed([1, 5], 3)).toEqual([1, 3, 5]);
    expect(withRevealed([1, 3], 3, 4)).toEqual([1, 3, 4]);
  });
});

describe('EarTrainingState', () => {
  const make = () => {
    const state = TestBed.inject(EarTrainingState);
    state.reset(32);
    return state;
  };

  it('starts with nothing selected or revealed, so Play covers the whole piece', () => {
    const state = make();
    expect(state.selection()).toBeNull();
    expect(state.playRange()).toEqual({ from: 0, to: 31 });
    expect(state.selectionLabel()).toBe('Whole piece');
  });

  it('follows the dev card example: click bar 13, extend to 17, and play 13–17', () => {
    const state = make();
    state.clickBar(12);
    state.clickBar(16);
    expect(state.playRange()).toEqual({ from: 12, to: 16 });
    expect(state.selectionLabel()).toBe('Bars 13–17');
  });

  it('selects all and clears', () => {
    const state = make();
    state.selectAll();
    expect(state.selection()).toEqual({ from: 0, to: 31 });
    state.clearSelection();
    expect(state.selection()).toBeNull();
  });

  it('reveals the whole selected range without changing the selection', () => {
    const state = make();
    state.dragBars(4, 7);
    state.revealSelected();
    expect(state.revealed()).toEqual([4, 5, 6, 7]);
    expect(state.selection()).toEqual({ from: 4, to: 7 });
    state.revealNext();
    expect(state.revealed()).toEqual([4, 5, 6, 7, 8]);
    expect(state.selection()).toEqual({ from: 4, to: 7 });
  });

  it('reveals all, resets reveals, and a new piece starts afresh', () => {
    const state = make();
    state.revealAll();
    expect(state.revealed().length).toBe(32);
    state.resetReveals();
    expect(state.revealed()).toEqual([]);
    state.clickBar(3);
    state.reset(8);
    expect(state.selection()).toBeNull();
    expect(state.barCount()).toBe(8);
  });
});
