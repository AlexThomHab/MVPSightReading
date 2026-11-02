import { styleGradeDigests } from './regression-digest';

/**
 * Seeded generation must stay reproducible: these digests pin the exact music produced for
 * every style and grade (several seeds and metres each, plus key overrides). They guard
 * refactoring. When the music is changed deliberately, regenerate them with
 * styleGradeDigests() and note the reason in the commit.
 */
const EXPECTED: Record<string, string> = {
  'classical/1': '48483a59', 'classical/2': '24c9d660', 'classical/3': '4234485f', 'classical/4': '23963bc0', 'classical/5': '2fac4a1c',
  'waltz/1': '2cea86ac', 'waltz/2': '4c91536d', 'waltz/3': 'ec217b88', 'waltz/4': 'd643d766', 'waltz/5': '544aa107',
  'minuet/1': 'f60ae218', 'minuet/2': 'c88de2de', 'minuet/3': '13503b69', 'minuet/4': '6ef08a0d', 'minuet/5': 'a64d9d03',
  'march/1': '885c9415', 'march/2': '597dbee6', 'march/3': '5e93ab0e', 'march/4': '07f80ab4', 'march/5': '3e16e1b6',
  'folk/1': '37e19c87', 'folk/2': 'ce298eae', 'folk/3': '6ca0bb73', 'folk/4': 'ddc61366', 'folk/5': '22c3fcb2',
  'chopin/1': 'c259f917', 'chopin/2': 'bc180f69', 'chopin/3': 'b1f3e779', 'chopin/4': 'a917ab80', 'chopin/5': '6e3049b3',
  'chorale/1': '648e3786', 'chorale/2': '55e1d730', 'chorale/3': '17fc27d2', 'chorale/4': 'a8d02beb', 'chorale/5': '99aa2847',
};

describe('seeded generation (regression)', () => {
  it('produces exactly the same music for the same settings, in every style and grade', () => {
    expect(styleGradeDigests()).toEqual(EXPECTED);
  }, 120_000);
});
