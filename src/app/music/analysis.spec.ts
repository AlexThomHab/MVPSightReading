import { describePhrases } from './analysis';
import { generatePiece } from './generator';

describe('describePhrases', () => {
  it('describes piano phrases by bars, with their chords bar by bar and their cadence last', () => {
    const piece = generatePiece({ seed: 'an-1', grade: 3, style: 'classical', timeId: '4/4' });
    const summary = describePhrases(piece);
    expect(summary.length).toBe(piece.phrases.length);
    summary.forEach((s, i) => {
      const ph = piece.phrases[i];
      expect(s.bars).toBe(`Bars ${ph.startBar + 1}–${ph.startBar + ph.bars}`);
      expect(s.chords.split(' | ').length).toBe(ph.bars);
      expect(s.detail[s.detail.length - 1]).toMatch(/cadence$/);
    });
  });

  it('numbers chorale phrases (they begin on an upbeat) and lists their chords beat by beat', () => {
    const piece = generatePiece({ seed: 'an-2', grade: 4, style: 'chorale' });
    const summary = describePhrases(piece);
    summary.forEach((s, i) => {
      expect(s.bars).toBe(`Phrase ${i + 1}`);
      expect(s.chords.split('  ').length).toBeLessThanOrEqual(8);
    });
  });
});
