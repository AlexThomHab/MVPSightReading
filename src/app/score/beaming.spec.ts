import { TIME_SIGNATURES } from '../music/grades';
import { beamGroups } from './beaming';

const notes = (...ticks: number[]) => ticks.map((t) => ({ ticks: t }));

describe('beamGroups', () => {
  it('beams eight quavers in 4/4 as 4 + 4, not in pairs', () => {
    expect(beamGroups(notes(2, 2, 2, 2, 2, 2, 2, 2), TIME_SIGNATURES['4/4'])).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it('beams six quavers in 3/4 as 4 + 2', () => {
    expect(beamGroups(notes(2, 2, 2, 2, 2, 2), TIME_SIGNATURES['3/4'])).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ]);
  });

  it('beams four quavers in 2/4 together', () => {
    expect(beamGroups(notes(2, 2, 2, 2), TIME_SIGNATURES['2/4'])).toEqual([[0, 1, 2, 3]]);
  });

  it('beams compound time by the dotted-crotchet beat: 3 + 3 in 6/8, 3 + 3 + 3 in 9/8', () => {
    expect(beamGroups(notes(2, 2, 2, 2, 2, 2), TIME_SIGNATURES['6/8'])).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(beamGroups(notes(2, 2, 2, 2, 2, 2, 2, 2, 2), TIME_SIGNATURES['9/8'])).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ]);
  });

  it('beams a 3/8 bar of quavers as one group', () => {
    expect(beamGroups(notes(2, 2, 2), TIME_SIGNATURES['3/8'])).toEqual([[0, 1, 2]]);
  });

  it('falls back to beat-by-beat beaming when a half bar holds semiquavers or dotted figures', () => {
    // 4/4: semiquavers in the first half; plain quavers in the second.
    expect(beamGroups(notes(1, 1, 2, 3, 1, 2, 2, 2, 2), TIME_SIGNATURES['4/4'])).toEqual([
      [0, 1, 2],
      [3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it('never beams a crotchet or longer, and lets a crotchet break the group', () => {
    expect(beamGroups(notes(4, 2, 2, 8), TIME_SIGNATURES['4/4'])).toEqual([[1, 2]]);
    expect(beamGroups(notes(2, 2, 4, 2, 2, 4), TIME_SIGNATURES['4/4'])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it('never beams through a rest', () => {
    expect(beamGroups([{ ticks: 2 }, { ticks: 2, rest: true }, { ticks: 2 }, { ticks: 2 }], TIME_SIGNATURES['2/4'])).toEqual([[2, 3]]);
  });

  it('does not beam a lone quaver, nor across the half bar', () => {
    expect(beamGroups(notes(6, 2, 2, 6), TIME_SIGNATURES['4/4'])).toEqual([]);
  });
});
