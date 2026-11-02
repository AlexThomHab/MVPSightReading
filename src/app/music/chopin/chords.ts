/**
 * Harmony for the Chopin style: chord symbols, correctly spelled in a key, with each chord's
 * tendency tones (what must rise and what must fall) and where it is going.
 *
 * Unlike the piano generator's chords, which are stacks of scale degrees, these are built
 * from spelled pitch classes, so they can express applied dominants, applied (and
 * common-tone) diminished sevenths, borrowed (mixture) chords, the Neapolitan sixth and
 * augmented sixths.
 *
 * Symbols:  [b]NUMERAL[°|ø][figure][/TARGET]   e.g. I, ii6, V7, V65/vi, vii°7/V, iv6, bVI
 *           and the specials N6, It+6, Ger+6, Fr+6, and I64 / i64 (cadential six-four).
 */
import {
  CHORD_SHAPES,
  ChordQuality,
  HarmonicFunction,
  PC,
  TonalKey,
  degreeOfLetter,
  isChromatic,
  pcAbove,
  pcSemis,
  samePc,
  scaleDegreePc,
} from '../pitch-class';

export type ChordKind = 'diatonic' | 'applied' | 'mixture' | 'neapolitan' | 'aug6' | 'cadential64';

export interface RChord {
  symbol: string;
  /** Chord tones, root first (for an augmented sixth: ♭6, 1, [♭3 or 2], ♯4). */
  tones: PC[];
  bass: PC;
  /** Scale degree of the root (♭6 for augmented sixths). */
  rootDeg: number;
  fn: HarmonicFunction;
  kind: ChordKind;
  /** Tones that should rise a semitone (leading notes; the ♯4 of an augmented sixth). */
  rising: PC[];
  /** Tones that should fall (sevenths; ♭6 and ♭2; the 6–4 of a cadential six-four). */
  falling: PC[];
  /** For chords that lead somewhere: the scale degree whose chord should follow. */
  target?: number;
  /** True when any tone lies outside the key (see isChromatic). */
  chromatic: boolean;
}

const NUMERAL = /^(b?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)([°ø]?)(7|65|43|42|64|6)?$/;
const ROMAN: Record<string, number> = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
const BASS_INDEX: Record<string, number> = { '': 0, '7': 0, '6': 1, '65': 1, '64': 2, '43': 2, '42': 3 };

/** Parses a chord symbol in a key. Throws for symbols it does not know. */
export function chordFor(k: TonalKey, symbol: string): RChord {
  const special = specialChord(k, symbol);
  if (special) return finish(k, special);

  const [head, targetSymbol] = symbol.split('/');
  const m = NUMERAL.exec(head);
  if (!m) throw new Error(`Unknown chord symbol ${symbol}`);
  const [, flat, numeral, mark, figure = ''] = m;
  const deg = ROMAN[numeral.toUpperCase()];
  const upper = numeral === numeral.toUpperCase();
  const seventh = ['7', '65', '43', '42'].includes(figure);
  let quality: ChordQuality;
  if (mark === '°') quality = seventh ? 'd7' : 'd';
  else if (mark === 'ø') quality = 'h7';
  else if (upper) quality = seventh ? 'D7' : 'M';
  else quality = seventh ? 'm7' : 'm';

  let root: PC;
  let rootDeg = deg;
  let kind: ChordKind = 'diatonic';
  let target: number | undefined;
  if (targetSymbol) {
    // Applied chord: V or vii° of the target chord's root.
    const t = NUMERAL.exec(targetSymbol);
    if (!t) throw new Error(`Unknown target in ${symbol}`);
    const targetDeg = ROMAN[t[2].toUpperCase()];
    let targetRoot = scaleDegreePc(k, targetDeg);
    if (t[1]) targetRoot = pcAbove(targetRoot, 0, -1);
    root = deg === 4 ? pcAbove(targetRoot, 4, 7) : pcAbove(targetRoot, 6, 11);
    rootDeg = degreeOfLetter(k, root.l);
    kind = 'applied';
    target = targetDeg;
  } else {
    root = scaleDegreePc(k, deg);
    if (flat) root = pcAbove(root, 0, -1);
    // In minor, vii° is built on the raised 7th.
    if (k.mode === 'minor' && deg === 6 && (mark === '°' || mark === 'ø')) root = scaleDegreePc(k, 6, true);
    if (deg === 4 && quality !== 'm' && quality !== 'm7') target = 0;
    if (deg === 6 && (mark === '°' || mark === 'ø')) target = 0;
  }
  const tones = CHORD_SHAPES[quality].map(([steps, semis]) => pcAbove(root, steps, semis));
  const fn: HarmonicFunction = target !== undefined ? 'D' : [1, 3].includes(deg) || flat ? 'S' : 'T';
  const isDominantShape = quality === 'M' || quality === 'D7';
  const rising =
    target !== undefined ? [isDominantShape ? tones[1] : tones[0]] : [];
  const falling = tones.length === 4 ? [tones[3]] : [];
  const chord: Omit<RChord, 'chromatic'> = {
    symbol,
    tones,
    bass: tones[BASS_INDEX[figure]],
    rootDeg,
    fn,
    kind,
    rising,
    falling,
    target,
  };
  const result = finish(k, chord);
  // Borrowed from the parallel key: a chromatic chord that is not applied or a dominant.
  if (result.chromatic && result.kind === 'diatonic' && target === undefined) {
    result.kind = 'mixture';
    // Mixture's ♭6 (and ♭3) lean downwards.
    result.falling = [...result.falling, ...result.tones.filter((t) => isChromatic(k, t) && t.a < scaleDegreePc(k, degreeOfLetter(k, t.l)).a)];
  }
  return result;
}

function finish(k: TonalKey, chord: Omit<RChord, 'chromatic'>): RChord {
  return { ...chord, chromatic: chord.tones.some((t) => isChromatic(k, t)) };
}

function specialChord(k: TonalKey, symbol: string): Omit<RChord, 'chromatic'> | null {
  const s = (deg: number) => scaleDegreePc(k, deg);
  const b6 = pcAbove(s(4), 1, 1); // a semitone above the dominant
  const sharp4 = pcAbove(s(4), -1, -1); // a semitone below the dominant
  switch (symbol) {
    case 'N6': {
      // Neapolitan: major triad on ♭2, in first inversion.
      const root = pcAbove(s(0), 1, 1);
      const tones = CHORD_SHAPES.M.map(([st, se]) => pcAbove(root, st, se));
      return { symbol, tones, bass: tones[1], rootDeg: 1, fn: 'S', kind: 'neapolitan', rising: [], falling: [root], target: 4 };
    }
    case 'It+6':
    case 'Ger+6':
    case 'Fr+6': {
      const extra = symbol === 'Ger+6' ? [pcAbove(s(0), 2, 3)] : symbol === 'Fr+6' ? [s(1)] : [];
      const tones = [b6, s(0), ...extra, sharp4];
      return { symbol, tones, bass: b6, rootDeg: 5, fn: 'S', kind: 'aug6', rising: [sharp4], falling: [b6], target: 4 };
    }
    case 'I64':
    case 'i64': {
      const tones = [s(0), symbol === 'I64' ? pcAbove(s(0), 2, 4) : pcAbove(s(0), 2, 3), s(4)];
      return {
        symbol,
        tones,
        bass: s(4),
        rootDeg: 0,
        fn: 'D',
        kind: 'cadential64',
        rising: [],
        falling: [tones[0], tones[1]],
        target: 4,
      };
    }
    default:
      return null;
  }
}

/** The symbol for the same function in minor (used to adapt major-key templates). */
export function toMinor(symbol: string): string {
  const map: Record<string, string> = {
    I: 'i',
    I64: 'i64',
    ii: 'ii°6',
    ii6: 'ii°6',
    ii65: 'iiø65',
    iii: 'III',
    IV: 'iv',
    iv: 'iv',
    vi: 'VI',
    bVI: 'VI',
    'V7/ii': 'V7/iv',
    'V65/ii': 'V65/iv',
    'vii°7/ii': 'vii°7/iv',
    'V7/vi': 'V7/VI',
    'V65/vi': 'V65/VI',
    'vii°7/vi': 'vii°7/VI',
    'V7/IV': 'V7/iv',
    'V65/IV': 'V65/iv',
    iiø65: 'iiø65',
  };
  return map[symbol] ?? symbol;
}

/**
 * True when chord `a` may move to chord `b`: a chord that leads somewhere (a dominant, an
 * applied chord, a Neapolitan or augmented sixth, a cadential six-four) must go there.
 *   - V and applied dominants resolve to their target (or deceptively, to the chord a step up);
 *   - a dominant may be prolonged (V → V7, V65/vi → V7/vi);
 *   - chords aimed at V may pass through the cadential six-four first;
 *   - a (common-tone) diminished seventh may resolve wherever its rising tones lead.
 */
export function leadsTo(a: RChord, b: RChord): boolean {
  if (a.kind === 'cadential64') return b.rootDeg === 4 && b.kind !== 'cadential64' && b.fn === 'D';
  if (a.target === undefined) return true;
  if (samePc(a.tones[0], b.tones[0]) && a.kind === b.kind && b.target === a.target) return true;
  if (b.kind === 'cadential64') return a.target === 4;
  if (b.rootDeg === a.target && b.kind !== 'aug6') return true;
  const diminished = a.tones.length === 4 && pcSemis(a.tones[3]) === (pcSemis(a.tones[0]) + 9) % 12;
  const risingResolve = a.rising.length > 0 && a.rising.every((r) => b.tones.some((t) => samePc(t, pcAbove(r, 1, 1))));
  if (diminished && risingResolve) return true;
  // Deceptive: the dominant's leading note still rises, to the chord a step above the target.
  return /^V/.test(a.symbol) && b.rootDeg === (a.target + 5) % 7 && risingResolve;
}
