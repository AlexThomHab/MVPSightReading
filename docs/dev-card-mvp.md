# Dev card: Sight-reading generator MVP

**Branch:** `feature/sight-reading-prototype`
**Stack:** Angular 22, TypeScript, VexFlow 5.0.0 (notation), Tone.js 15.1.22 (playback), Vitest
**Status:** Libraries installed. No feature code yet.

## Goal

A single web page that generates a new piano sight-reading piece for Grades 1–5, in a chosen style, on demand. It shows the piece as grand-staff sheet music, plays it back, and prints it.

The point of the MVP is to prove one claim: **our generated music sounds composed, not random.** That is the main complaint about Sight Reading Factory. Everything else is secondary.

## User story

As a piano teacher or student, I pick a grade and a style, click **New piece**, and get a short, musical exercise at that level. I can listen to it, generate another, or print it.

## In scope

### 1. Generator (pure TypeScript, no Angular dependencies)

Lives in `src/app/music/`. It must be deterministic from a seed so pieces can be shared and tested.

- **Seeded random numbers.** The same seed and settings always give the same piece.
- **Correct note spelling.** Pitches are stored as letter + octave + sharp/flat, not just MIDI numbers, so G major always shows F♯ and never G♭.
- **Keys and time signatures per grade.** These are approximate and must be checked against the current ABRSM syllabus before we claim alignment.

| Grade | Keys | Time signatures | Rhythms | Bars |
|---|---|---|---|---|
| 1 | C, G, F major; A minor | 2/4, 3/4, 4/4 | Semibreve, minim, dotted minim, crotchet | 4 |
| 2 | Adds D major; D and E minor | Same | Adds quaver pairs | 8 |
| 3 | Up to 2 sharps or flats | Adds 6/8 | Adds dotted crotchet + quaver | 8 |
| 4 | Up to 3 sharps or flats | Adds 3/8 | Adds semiquavers | 8–12 |
| 5 | Up to 4 sharps or flats | Adds 9/8 | Adds dotted quaver + semiquaver | 12 |

- **Harmony first.** Each piece is built from 4-bar phrases with a chord plan, for example I–IV–V–V (ends on a half cadence), then I–IV–V–I (ends on a full cadence). Minor keys use a major V with the raised leading note.
- **Melody over the harmony:**
  - chord tones on strong beats, with steps or passing notes in between
  - leap size limited by grade, from a 3rd at Grade 1 up to an octave at Grade 5
  - after a big leap, step back in the opposite direction
  - hand range limited by grade: a five-finger position at Grade 1, wider later
  - the second phrase repeats the opening of the first, so the piece has a recognisable idea
  - the last note is the tonic, approached by step
- **Left hand by grade and style:** long bass notes at Grades 1–2, simple intervals at Grade 3, and broken chords, Alberti bass or oom-pah-pah at Grades 4–5.
- **Styles:**

| Style | Time | Character |
|---|---|---|
| Classical | 4/4 or 2/4 | Balanced phrases, Alberti bass at higher grades |
| Waltz | 3/4 | Long first beat, oom-pah-pah left hand |
| Minuet | 3/4 | Moderate crotchets and quavers, walking bass |
| March | 2/4 or 4/4 | Dotted rhythms, bass and chord alternating, major key |
| Folk | 6/8 or 2/4 | Simple tune over a drone of open fifths |

- **Output:** a `Piece` object with title, key, mode, time signature, tempo, style, grade, seed, and bars of right-hand and left-hand notes.

### 2. Sheet music rendering (VexFlow)

- Grand staff with treble and bass clef, brace and key signature on every line, and the time signature at the start
- 4 bars per line, with a final double barline
- Automatic accidentals and beaming grouped correctly for the time signature
- A tempo word and metronome mark, plus a starting dynamic

### 3. Playback (Tone.js)

- Piano samples, falling back to a synth if they fail to load
- A one-bar count-in click
- Play and stop buttons, with a tempo slider

### 4. Page

- Controls for grade (1–5), style, and optionally key and time signature (default: random within the grade)
- A **New piece** button
- The seed shown in the URL (`?seed=…&grade=…&style=…`) so a piece can be shared
- A **Print** button that prints only the music

## Out of scope for the MVP

- Microphone or MIDI grading
- Accounts, payments, teacher assignments
- Instruments other than piano
- Triplets, ties, pedal marks, fingering
- Mobile app

## Acceptance criteria

1. Every bar in both hands adds up exactly to the time signature.
2. Every note uses the key signature's sharps or flats, except the raised leading note in minor keys and the deliberate chromatic notes allowed from Grade 4.
3. The rhythms, keys, time signatures and leap sizes used never exceed the selected grade's limits.
4. The piece ends on the tonic in both hands, with a cadence.
5. The same seed and settings always produce the same piece.
6. The music renders without overlaps at 1280px wide and prints on A4.
7. Playback matches the score, at the shown tempo.
8. Unit tests cover points 1–5 across all grades and styles (for example, 200 seeds each), and `ng test` passes.
9. **Musicality check:** play 10 pieces for at least 3 piano teachers or experienced pianists. Most of them should judge most pieces as "sounds like a real exercise". Write down what they say.

## Suggested file layout

```
src/app/music/
  random.ts        seeded random numbers
  theory.ts        keys, spelling, scale degrees, chords
  grades.ts        per-grade limits
  styles.ts        per-style rhythms and left-hand patterns
  generator.ts     harmony → melody → left hand → Piece
  generator.spec.ts
src/app/score/score.component.ts      VexFlow rendering
src/app/playback/playback.service.ts  Tone.js playback
src/app/app.ts / app.html             page and controls
```

## Risks

- **The music may still sound mechanical.** Tune the weights and motif repetition with musician feedback before adding features.
- **The grade limits are our approximation.** Check them against the official syllabus before using exam-board names in marketing. Don't copy specimen tests or logos.
- **Sample loading needs a network connection.** Keep the synth fallback.
