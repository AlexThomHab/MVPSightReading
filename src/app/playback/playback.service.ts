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
    const countIn = piece.time.beatsPerBar * beatSeconds;

    // Count-in: one bar of clicks, the first accented.
    for (let beat = 0; beat < piece.time.beatsPerBar; beat++) {
      transport.schedule((time) => {
        this.click?.triggerAttackRelease(beat === 0 ? 'C6' : 'G5', 0.03, time);
      }, beat * beatSeconds);
    }

    piece.bars.forEach((bar, barIndex) => {
      const barStart = countIn + barIndex * piece.time.barTicks * secondsPerTick;
      transport.schedule((time) => draw.schedule(() => this.currentBar.set(barIndex), time), barStart);
      for (const [notes, velocity] of [[bar.rh, 0.75], [bar.lh, 0.55]] as const) {
        let tick = 0;
        for (const note of notes) {
          if (!note.rest) {
            const names = note.pitches.map((p) => Tone.Frequency(midi(p), 'midi').toNote());
            const duration = note.ticks * secondsPerTick * 0.95;
            transport.schedule((time) => piano.triggerAttackRelease(names, duration, time, velocity), barStart + tick * secondsPerTick);
          }
          tick += note.ticks;
        }
      }
    });

    const end = countIn + piece.bars.length * piece.time.barTicks * secondsPerTick;
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
