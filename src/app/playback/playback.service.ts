import { Injectable, signal } from '@angular/core';
import type * as ToneNS from 'tone';
import { Piece } from '../music/generator';
import { PlayOptions, buildSchedule } from './schedule';

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

export interface PlaybackRequest extends PlayOptions {
  /** Play the same bars again, without a count-in, until stopped. */
  loop?: boolean;
}

/**
 * Plays a Piece, or a range of its bars, with Tone.js: a count-in click, then the music.
 * Uses piano samples, falling back to a synth if they fail to load.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackService {
  /** True while playing or paused (i.e. until stopped or finished). */
  readonly playing = signal(false);
  readonly paused = signal(false);
  readonly loading = signal(false);
  /** True once we have fallen back to the synthesiser. */
  readonly usingSynth = signal(false);
  /** Index of the bar currently sounding, or null (count-in, stopped). */
  readonly currentBar = signal<number | null>(null);
  /** True while the count-in clicks are sounding. */
  readonly countingIn = signal(false);

  private tone?: Tone;
  private piano?: Instrument;
  private click?: ToneNS.Synth;
  private runId = 0;

  async play(piece: Piece, bpm: number, request: PlaybackRequest = {}): Promise<void> {
    this.stop();
    const run = ++this.runId;
    const Tone = await this.loadTone();
    await Tone.start();
    const piano = await this.loadPiano(Tone);
    if (run !== this.runId) return;

    const transport = Tone.getTransport();
    // UI updates run on a timer lined up with the audio clock. (Tone's Draw waits for
    // animation frames, which never come while the window is in the background.)
    const atAudioTime = (time: number, fn: () => void) => {
      setTimeout(() => {
        if (run === this.runId) fn();
      }, Math.max(0, (time - Tone.immediate()) * 1000));
    };
    const schedule = buildSchedule(piece, bpm, request);

    this.countingIn.set(schedule.clicks.length > 0);
    for (const c of schedule.clicks) {
      transport.schedule((time) => this.click?.triggerAttackRelease(c.accent ? 'C6' : 'G5', 0.03, time), c.time);
    }
    for (const b of schedule.bars) {
      transport.schedule(
        (time) =>
          atAudioTime(time, () => {
            this.countingIn.set(false);
            this.currentBar.set(b.bar);
          }),
        b.time,
      );
    }
    for (const n of schedule.notes) {
      const names = n.midis.map((m) => Tone.Frequency(m, 'midi').toNote());
      transport.schedule((time) => piano.triggerAttackRelease(names, n.duration, time, n.velocity), n.time);
    }
    transport.schedule(
      (time) =>
        atAudioTime(time, () => {
          if (request.loop) {
            // Repeat the selection straight away, without counting in again.
            void this.play(piece, bpm, { ...request, countIn: false });
          } else {
            this.stop();
          }
        }),
      schedule.end + (request.loop ? 0.6 : 0.3),
    );

    transport.position = 0;
    transport.start('+0.1');
    this.playing.set(true);
  }

  pause(): void {
    if (!this.tone || !this.playing() || this.paused()) return;
    this.tone.getTransport().pause();
    this.piano?.releaseAll();
    this.paused.set(true);
  }

  resume(): void {
    if (!this.tone || !this.paused()) return;
    this.tone.getTransport().start();
    this.paused.set(false);
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
    this.paused.set(false);
    this.countingIn.set(false);
    this.currentBar.set(null);
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
