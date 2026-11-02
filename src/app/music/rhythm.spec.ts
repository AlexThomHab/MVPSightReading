import { GRADES, GRADE_SPECS, TIME_SIGNATURES, TimeSignatureId, isGrade, isTimeSignatureId } from './grades';
import { Random } from './random';
import { cellFitsMetre, cellUnit, cellsFor, fillWithCells, harmonySplit } from './rhythm';
import { STYLE_IDS, isStyleId, keysFor, timesFor } from './styles';

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

describe('styles, grades and metres', () => {
  it('offers chorales only in 4/4, and March only in major keys', () => {
    expect(timesFor(5, 'chorale')).toEqual(['4/4']);
    expect(timesFor(5, 'chopin')).toEqual([...GRADE_SPECS[5].times]);
    expect(keysFor(5, 'march').every((k) => k.mode === 'major')).toBe(true);
    expect(keysFor(5, 'folk').some((k) => k.mode === 'minor')).toBe(true);
  });

  it('recognises valid ids from untrusted input (a URL, a select box)', () => {
    for (const id of STYLE_IDS) expect(isStyleId(id)).toBe(true);
    expect(isStyleId('romantic')).toBe(false);
    expect(isStyleId(null)).toBe(false);
    expect(isGrade(3)).toBe(true);
    expect(isGrade(6)).toBe(false);
    expect(isGrade(Number('x'))).toBe(false);
    expect(isTimeSignatureId('6/8')).toBe(true);
    expect(isTimeSignatureId('5/4')).toBe(false);
    expect(isTimeSignatureId('toString')).toBe(false);
  });
});
