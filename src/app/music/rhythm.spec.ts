import { GRADES, GRADE_SPECS, TIME_SIGNATURES, TimeSignatureId } from './grades';
import { Random } from './random';
import { cellFitsMetre, cellUnit, cellsFor, fillWithCells, harmonySplit } from './rhythm';

describe('rhythm cells', () => {
  it('fill exactly the units asked for, with durations and cells the grade allows', () => {
    for (const grade of GRADES) {
      const spec = GRADE_SPECS[grade];
      for (const id of spec.times) {
        const time = TIME_SIGNATURES[id];
        const units = time.barTicks / cellUnit(time);
        for (let s = 0; s < 20; s++) {
          const rhythm = fillWithCells(new Random(`r${s}`), time, grade, spec.durations, 0, units, () => 1);
          expect(rhythm.reduce((a, b) => a + b, 0)).toBe(time.barTicks);
          for (const d of rhythm) expect(spec.durations).toContain(d);
        }
      }
    }
  });

  it('keep long notes in line with the metre', () => {
    const fourFour = TIME_SIGNATURES['4/4'];
    const minim = cellsFor(fourFour).find((c) => c.name === '8')!;
    expect(cellFitsMetre(minim, 0, fourFour)).toBe(true);
    expect(cellFitsMetre(minim, 1, fourFour)).toBe(false); // not across the middle of the bar
    expect(cellFitsMetre(minim, 1, TIME_SIGNATURES['3/4'])).toBe(true);
  });

  it('use dotted-crotchet units in compound time and 3/8, crotchets otherwise', () => {
    const units: Record<TimeSignatureId, number> = { '2/4': 4, '3/4': 4, '4/4': 4, '6/8': 6, '9/8': 6, '3/8': 6 };
    for (const [id, unit] of Object.entries(units)) expect(cellUnit(TIME_SIGNATURES[id as TimeSignatureId])).toBe(unit);
  });

  it('change harmony at the half bar (or the second beat of three), never in 3/8', () => {
    expect(harmonySplit(TIME_SIGNATURES['4/4'])).toBe(8);
    expect(harmonySplit(TIME_SIGNATURES['3/4'])).toBe(8);
    expect(harmonySplit(TIME_SIGNATURES['9/8'])).toBe(12);
    expect(harmonySplit(TIME_SIGNATURES['3/8'])).toBeNull();
  });
});

