import { CHORD_SHAPES, degreeOfLetter, homeKey, isChromatic, pcAbove, pcName, pcOf, pcSemis, pitchesOf, samePc, scaleDegreePc } from './pitch-class';
import { keyById, midi } from './theory';

const pc = (name: string) => {
  const letter = 'CDEFGAB'.indexOf(name[0]);
  const alter = [...name.slice(1)].reduce((a, ch) => a + (ch === '#' ? 1 : ch === 'b' ? -1 : 0), 0);
  return { l: letter, a: alter };
};

describe('spelled pitch classes', () => {
  it('spells intervals by letter as well as by semitone', () => {
    // A major third above E is G♯ (not A♭); a diminished seventh above C♯ is B♭ (not A♯).
    expect(pcName(pcAbove(pc('E'), 2, 4))).toBe('G♯');
    expect(pcName(pcAbove(pc('C#'), 6, 9))).toBe('B♭');
    // The leading note of A♭ minor is G (not A♭♭ or F𝄪).
    expect(pcName(pcAbove(pc('Ab'), 6, 11))).toBe('G');
    expect(pcSemis(pc('B#'))).toBe(0);
    expect(samePc(pc('B#'), pc('C'))).toBe(false);
  });

  it('builds scale degrees, raising the 6th and 7th of minor on request', () => {
    const aMinor = homeKey(keyById('Am')!);
    expect(pcName(scaleDegreePc(aMinor, 6))).toBe('G');
    expect(pcName(scaleDegreePc(aMinor, 6, true))).toBe('G♯');
    expect(pcName(scaleDegreePc(aMinor, 5, true))).toBe('F♯');
    expect(degreeOfLetter(aMinor, 'E'.charCodeAt(0) - 'A'.charCodeAt(0) + 5)).toBe(4);
  });

  it('knows which pitch classes lie outside the key (melodic and harmonic minor count as in it)', () => {
    const eFlat = homeKey(keyById('Eb')!);
    expect(isChromatic(eFlat, pc('Bb'))).toBe(false);
    expect(isChromatic(eFlat, pc('B'))).toBe(true);
    const cMinor = homeKey(keyById('Cm')!);
    expect(isChromatic(cMinor, pc('B'))).toBe(false); // the raised 7th
    expect(isChromatic(cMinor, pc('A'))).toBe(false); // the raised 6th
    expect(isChromatic(cMinor, pc('F#'))).toBe(true);
  });

  it('describes chord shapes by letter steps and semitones', () => {
    const root = pc('D');
    const tones = (q: keyof typeof CHORD_SHAPES) => CHORD_SHAPES[q].map(([st, se]) => pcName(pcAbove(root, st, se))).join(' ');
    expect(tones('D7')).toBe('D F♯ A C');
    expect(tones('h7')).toBe('D F A♭ C');
    expect(tones('d7')).toBe('D F A♭ C♭');
  });

  it('finds every pitch of a pitch class in a range', () => {
    const cs = pitchesOf(pc('C'), 48, 72).map(midi);
    expect(cs).toEqual([48, 60, 72]);
    expect(pcOf({ letter: 'F', alter: 1, octave: 4 })).toEqual({ l: 3, a: 1 });
  });
});
