/**
 * SMuFL code points, drawn in the Bravura font VexFlow brings: the notes, rests and signs the
 * toolbars, the Customise panel and the note-input overlay draw themselves.
 */

/** A note of each plain value (stem up), by its length in ticks. */
export const NOTE: Readonly<Record<number, string>> = { 16: '', 8: '', 4: '', 2: '', 1: '', 0.5: '' };

/** A rest of each plain value. */
export const REST: Readonly<Record<number, string>> = { 16: '', 8: '', 4: '', 2: '', 1: '', 0.5: '' };

/** Noteheads: a semibreve's, a minim's, and the black head of everything shorter. */
export const HEAD = { whole: '', half: '', black: '' } as const;
export const headFor = (base: number) => (base >= 16 ? HEAD.whole : base >= 8 ? HEAD.half : HEAD.black);

/** Flags, by length, for a stem up or down. */
export const FLAG_UP: Readonly<Record<number, string>> = { 2: '', 1: '', 0.5: '' };
export const FLAG_DOWN: Readonly<Record<number, string>> = { 2: '', 1: '', 0.5: '' };

export const DOT = '';
export const ACCIDENTAL = { flat: '', natural: '', sharp: '' } as const;
export const CLEF = { treble: '', bass: '' } as const;

/** A time-signature number in SMuFL's digits ("12" → two glyphs). */
export const timeDigits = (n: number) => [...String(n)].map((d) => String.fromCodePoint(0xe080 + Number(d))).join('');
