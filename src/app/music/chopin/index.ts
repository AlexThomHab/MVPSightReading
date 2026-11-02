/**
 * Piano miniatures in the manner of Chopin: nocturnes, preludes, waltzes and mazurkas.
 *
 * Harmony, melody and accompaniment are composed as one structure, in stages:
 *   1. Character and form. A character to suit the metre (a nocturne's singing line over
 *      wide arpeggios, a prelude's sighing melody over repeated chords, a waltz, a mazurka),
 *      and a form to suit the length: a single gesture, a sentence, a period whose answer
 *      returns ornamented, or A–B–A′.
 *   2. Harmony, from a library of Chopinesque progressions rather than chord by chord:
 *      I–I7–IV–iv, the chromatic lament bass (1–7–♭7–6–♭6–5), ascending bass lines through
 *      applied diminished sevenths, the common-tone diminished seventh over a tonic pedal,
 *      chains of applied dominants (III7–VI7–II7–V7), tonicisations of vi, ii, IV and the
 *      relative major, and cadences approached through iv6, iiø7, the Neapolitan and the
 *      augmented sixths. Every chord with a goal is checked to resolve to it.
 *   3. The bass line, as smooth as possible, so the melody can be written against it.
 *   4. The structural melody: one chord tone per main beat, shaped as a whole (a motif,
 *      its sequence or return, a prepared climax often reached by an expressive leap, a
 *      descent to 2̂–1̂), and kept free of parallel fifths and octaves with the bass.
 *   5. Elaboration: each span between structural notes is filled with a figure — passing
 *      and neighbour notes, appoggiaturas and suspensions onto the main note, written-out
 *      turns, scalar runs into the climax, chromatic passing, neighbour and approach notes
 *      (each chromatic note moving by semitone to where it is going). A returning phrase
 *      comes back more ornate. Then grace notes, turns and a cadential trill, by grade.
 *   6. Accompaniment voiced from the harmony with smooth inner voices (leading notes rise,
 *      sevenths fall) and realised in the character's texture.
 *   7. Expression: dynamics, hairpins to the climax, slurs, accents.
 *
 * Deterministic from the seed, and within the grade's limits (keys, metres, rhythms, ranges
 * and leaps) like every other style.
 */
import { constraintsOf, effectiveSpec } from '../constraints';
import { TIME_SIGNATURES, TimeSignatureId } from '../grades';
import type { PhraseInfo, Piece, Settings } from '../model';
import { homeKey } from '../pitch-class';
import { Random } from '../random';
import { harmonySplit } from '../rhythm';
import { KEYS, Key, keyName } from '../theory';
import { accompany, choosePattern } from './accompaniment';
import { planBass } from './bass';
import { CHARACTERS, CHARACTERS_FOR, CHOPIN_TIMES, Ctx } from './context';
import { elaborate } from './elaboration';
import { express } from './expression';
import { planForm } from './form';
import { melodyFrame } from './frame';
import { planHarmony } from './harmony';
import { ornament } from './ornaments';
import { planStructure } from './structure';

export function generateChopin(settings: Settings): Piece {
  const { seed, grade } = settings;
  const cons = constraintsOf(settings);
  const spec = effectiveSpec(grade, cons);
  const rng = new Random(`${seed}|g${grade}|chopin|${settings.keyId ?? ''}|${settings.timeId ?? ''}`);
  const keyChoices = KEYS.filter((k) => spec.keys.includes(k.id));
  // Chopin favours minor keys; at the earliest grades major keys still predominate.
  const key: Key =
    KEYS.find((k) => k.id === settings.keyId) ?? rng.weighted(keyChoices, (k) => (k.mode === 'minor' ? (grade <= 2 ? 1 : 1.4) : 1));
  const timeId: TimeSignatureId =
    settings.timeId && spec.times.includes(settings.timeId)
      ? settings.timeId
      : rng.weighted(
          CHOPIN_TIMES.filter((t) => spec.times.includes(t)),
          (t) => (t === '3/4' ? 4 : t === '4/4' ? 3 : 1.5),
        );
  const time = TIME_SIGNATURES[timeId];
  const options = CHARACTERS_FOR[time.id].filter(([c]) => CHARACTERS[c].minGrade <= grade);
  const character = rng.weighted(options, ([, w]) => w)[0];
  const ch = CHARACTERS[character];
  const hkey = homeKey(key);
  const split = harmonySplit(time);
  const ctx: Ctx = { rng, spec, grade, key, hkey, time, character, ch, minor: key.mode === 'minor', split, twoChords: grade >= 3 && split !== null, pattern: 'broken', cons };
  // The left hand's one pattern is chosen first, so the melody can leave it room.
  ctx.pattern = choosePattern(ctx);

  const barCount = rng.pick(spec.bars);
  const form = planForm(ctx, barCount);
  const segments = planHarmony(ctx, form);
  const bassLine = planBass(ctx, form, segments);
  const frame = melodyFrame(ctx);
  const structure = planStructure(ctx, form, segments, bassLine, frame);
  const melody = elaborate(ctx, form, structure, frame);
  ornament(ctx, form, melody, frame);
  const lh = accompany(ctx, form, segments, bassLine, melody);
  const expression = express(ctx, form, melody);

  const bars = segments.map((segs, b) => ({
    harmony: segs.map((s) => ({ symbol: s.pedal ? `${s.chord.symbol} (pedal)` : s.chord.symbol, at: s.at })),
    rh: melody.notes[b],
    lh: lh[b],
  }));
  const phrases: PhraseInfo[] = form.phrases.map((p) => ({
    startBar: p.start,
    bars: p.roles.length,
    cadence: p.cadence,
    repeatsOpening: p.returns,
  }));

  return {
    title: `${ch.title} in ${keyName(key)}`,
    seed,
    grade,
    style: 'chopin',
    key,
    mode: key.mode,
    time,
    tempo: chooseTempo(ctx),
    dynamic: '',
    bars,
    phrases,
    expression,
  };
}

function chooseTempo(ctx: Ctx): Piece['tempo'] {
  let { slow, fast, marking } = ctx.ch.tempo;
  // A prelude in a major key is gentler and moves on (Andantino), one in a minor key broods (Largo).
  if (ctx.character === 'prelude' && !ctx.minor) [slow, fast, marking] = [66, 80, 'Andantino'];
  const crotchet = slow + ((fast - slow) * (ctx.grade - 1)) / 4 + ctx.rng.int(-3, 3);
  const even = (n: number) => Math.round(n / 2) * 2;
  if (ctx.time.compound) return { bpm: even(crotchet * 0.62), beatUnit: 'qd', marking };
  if (ctx.time.id === '3/8') return { bpm: even(crotchet * 1.6), beatUnit: '8', marking };
  return { bpm: even(crotchet), beatUnit: 'q', marking };
}

export { HARMONY_LIBRARY, progressionOk, tension, tensionBuilds } from './harmony';
