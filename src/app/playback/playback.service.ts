import { Injectable, signal } from '@angular/core';
import type * as ToneNS from 'tone';
import { Piece } from '../music/generator';
import { midi } from '../music/theory';

type Tone = typeof ToneNS;
type Instrument = ToneNS.Sampler | ToneNS.PolySynth;

/** Salamander Grand Piano samples hosted by the Tone.js project (needs a network connection). */
const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_TIMEOUT_MS = 10_000;

function sampleUrls(): Record<string, string> {
  const urls: Record<string, string> = {};
  for (let octave = 1; octave <= 6; octave++) {
    for (const [note, file] of [['C', 'C'], ['D#', 'Ds'], ['F#', 'Fs'], ['A', 'A']]) {
      urls[`${note}${octave}`] = `${file}${octave}.mp3`;
    }
  }
  urls['C7'] = 'C7.mp3';
  return urls;
}

/**
 * Plays a Piece with Tone.js: a one-bar count-in click, then both hands.
 * Uses piano samples, falling back to a synth if they fail to load.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackService {
  readonly playing = signal(false);
  readonly loading = signal(false);
  /** True once we have fallen back to the synthesiser. */
  readonly usingSynth = signal(false);
  /** Index of the bar currently sounding, or null (count-in, stopped). */
  readonly currentBar = signal<number | null>(null);

  private tone?: Tone;
  private piano?: Instrument;
  private click?: ToneNS.Synth;
  private runId = 0;

  async play(piece: Piece, bpm: number): Promise<void> {
    this.stop();
    const run = ++this.runId;
    const Tone = await this.loadTone();
    await Tone.start();
    const piano = await this.loadPiano(Tone);
    if (run !== this.runId) return;

    const transport = Tone.getTransport();
    const draw = Tone.getDraw();
    const secondsPerTick = 60 / bpm / piece.time.beatTicks;
    const beatSeconds = secondsPerTick * piece.time.beatTicks;
    // An upbeat (chorales) is counted in from the rest of its bar.
    const barTicks = piece.bars.map((b) => b.rh.reduce((a, n) => a + n.ticks, 0));
    const clicks = (piece.time.barTicks - (barTicks[0] < piece.time.barTicks ? barTicks[0] : 0)) / piece.time.beatTicks;
    const countIn = (clicks || piece.time.beatsPerBar) * beatSeconds;

    // Count-in clicks, the first accented.
    for (let beat = 0; beat < clicks; beat++) {
      transport.schedule((time) => {
        this.click?.triggerAttackRelease(beat === 0 ? 'C6' : 'G5', 0.03, time);
      }, beat * beatSeconds);
    }

    // Fermatas hold the chord for longer and delay everything after them.
    const fermataEnds: number[] = [];
    const fermataHold = beatSeconds * 0.9;
    let t = 0;
    for (const bar of piece.bars) {
      for (const n of bar.rh) {
        if (n.fermata) fermataEnds.push(t + n.ticks);
        t += n.ticks;
      }
    }
    const timeOf = (tick: number) => countIn + tick * secondsPerTick + fermataHold * fermataEnds.filter((e) => e <= tick).length;

    const barStarts: number[] = [];
    barTicks.reduce((start, ticks, i) => ((barStarts[i] = start), start + ticks), 0);
    piece.bars.forEach((_, barIndex) => {
      transport.schedule((time) => draw.schedule(() => this.currentBar.set(barIndex), time), timeOf(barStarts[barIndex]));
    });

    // Each voice: chorales have four, piano music two (right and left hand).
    const first = piece.bars[0];
    const voices: [keyof NonNullable<typeof first.voices> | 'rh' | 'lh', number][] = first.voices
      ? [['s', 0.72], ['a', 0.5], ['t', 0.5], ['b', 0.62]]
      : [['rh', 0.75], ['lh', 0.55]];
    for (const [name, velocity] of voices) {
      const notes = piece.bars.flatMap((bar, i) => {
        const list = name === 'rh' || name === 'lh' ? bar[name] : bar.voices![name];
        let tick = barStarts[i];
        return list.map((note) => ({ note, start: (tick += note.ticks) - note.ticks }));
      });
      for (let i = 0; i < notes.length; i++) {
        const { note, start } = notes[i];
        if (note.rest) continue;
        // A tied note sounds once, for the combined length.
        let end = start + note.ticks;
        let last = note;
        while (last.tie && notes[i + 1]) {
          i++;
          last = notes[i].note;
          end = notes[i].start + last.ticks;
        }
        const names = note.pitches.map((p) => Tone.Frequency(midi(p), 'midi').toNote());
        // timeOf() already adds the fermata's hold at the end of a fermata note.
        const duration = (timeOf(end) - timeOf(start)) * 0.95;
        transport.schedule((time) => piano.triggerAttackRelease(names, duration, time, velocity), timeOf(start));
      }
    }

    const end = timeOf(t);
    transport.schedule((time) => draw.schedule(() => this.finish(run), time), end + 0.3);

    transport.position = 0;
    transport.start('+0.1');
    this.playing.set(true);
  }

  stop(): void {
    this.runId++;
    if (this.tone) {
      const transport = this.tone.getTransport();
      transport.stop();
      transport.cancel(0);
      this.piano?.releaseAll();
    }
    this.playing.set(false);
    this.currentBar.set(null);
  }

  private finish(run: number): void {
    if (run !== this.runId) return;
    this.stop();
  }

  private async loadTone(): Promise<Tone> {
    this.tone ??= await import('tone');
    return this.tone;
  }

  private async loadPiano(Tone: Tone): Promise<Instrument> {
    this.click ??= new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
      volume: -14,
    }).toDestination();
    if (this.piano) return this.piano;

    this.loading.set(true);
    const sampler = await new Promise<ToneNS.Sampler | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), SAMPLE_TIMEOUT_MS);
      const s = new Tone.Sampler({
        urls: sampleUrls(),
        baseUrl: SAMPLE_BASE_URL,
        release: 1,
        onload: () => {
          clearTimeout(timer);
          resolve(s);
        },
        onerror: () => {
          clearTimeout(timer);
          resolve(null);
        },
      }).toDestination();
    });
    this.loading.set(false);

    if (sampler) {
      this.piano = sampler;
    } else {
      this.usingSynth.set(true);
      this.piano = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0.25, release: 0.8 },
        volume: -8,
      }).toDestination();
    }
    return this.piano;
  }
}
