/**
 * Phrase-by-phrase analysis for teachers: where each phrase lies, what it does (a repeat, a
 * modulation, a sequence) and how it cadences, with its chords.
 */
import type { Cadence, Piece, SequenceName } from './model';

export const CADENCE_NAMES: Readonly<Record<Cadence, string>> = {
  PAC: 'Perfect authentic cadence',
  IAC: 'Imperfect authentic cadence',
  HC: 'Half cadence',
  PC: 'Plagal cadence',
  DC: 'Deceptive cadence',
};

export const SEQUENCE_NAMES: Readonly<Record<SequenceName, string>> = {
  romanesca: 'Romanesca sequence',
  'descending-fifths': 'Descending-fifths sequence',
  'ascending-5-6': 'Ascending 5–6 sequence',
};

export interface PhraseSummary {
  /** "Bars 1–4", or "Phrase 1" when phrases do not follow bar lines. */
  bars: string;
  /** What the phrase does, ending with its cadence. */
  detail: string[];
  /** Its chords: bars separated by "|" (or, for a chorale, one chord per beat). */
  chords: string;
}

/** A chorale's phrases begin on an upbeat and last eight beats, so they are counted by beat, not bar. */
const BEATS_PER_CHORALE_PHRASE = 8;

export function describePhrases(piece: Piece): PhraseSummary[] {
  const byBeat = piece.style === 'chorale';
  const symbols = (bars: Piece['bars']) => bars.map((b) => b.harmony.map((h) => h.symbol));
  return piece.phrases.map((ph, i) => ({
    bars: byBeat ? `Phrase ${i + 1}` : `Bars ${ph.startBar + 1}–${ph.startBar + ph.bars}`,
    detail: [
      ph.repeatsOpening ? (byBeat ? `Repeats phrase ${i - 1}` : 'Repeats the opening') : '',
      ph.key ? `Modulates to ${ph.key}` : '',
      ph.sequence ? SEQUENCE_NAMES[ph.sequence] : '',
      CADENCE_NAMES[ph.cadence],
    ].filter(Boolean),
    chords: byBeat
      ? symbols(piece.bars)
          .flat()
          .slice(i * BEATS_PER_CHORALE_PHRASE, (i + 1) * BEATS_PER_CHORALE_PHRASE)
          .join('  ')
      : symbols(piece.bars.slice(ph.startBar, ph.startBar + ph.bars))
          .map((bar) => bar.join(' '))
          .join(' | '),
  }));
}
