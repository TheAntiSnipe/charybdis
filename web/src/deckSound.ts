// Mechanical deck sounds. Inserting and ejecting play two short recordings (web/public/sounds);
// everything else, and both of those if the recordings can't be loaded, is synthesised with Web Audio.
// A context is made per sound inside the user's tap and closed right after, so it never lingers
// next to the <audio> element that plays the music.

const CLIPS = { insert: '/sounds/cassette-insert.mp3', eject: '/sounds/cassette-eject.mp3' } as const;
type ClipName = keyof typeof CLIPS;

/** How long the music and the insert recording overlap while one fades into the other. */
export const INSERT_CROSSFADE_S = 1.3;
const SYNTH_INSERT_CROSSFADE_S = 0.4;

const clips: Partial<Record<ClipName, AudioBuffer>> = {};
let preloaded = false;

/** Fetches and decodes the recordings ahead of time so a tap can play them with no delay. Safe to call repeatedly. */
export function preloadDeckSounds(): void {
  if (preloaded) return;
  const w = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Offline || typeof fetch !== 'function') return;
  preloaded = true;
  void Promise.all((Object.keys(CLIPS) as ClipName[]).map(async (name) => {
    try {
      const response = await fetch(CLIPS[name]);
      if (!response.ok) return;
      clips[name] = await new Offline(2, 1, 44100).decodeAudioData(await response.arrayBuffer());
    } catch {
      // Falls back to the synthesised sound.
    }
  })).then(() => {
    if (!clips.insert || !clips.eject) preloaded = false; // try again next time the deck opens
  });
}

function playClip(ctx: AudioContext, buffer: AudioBuffer): GainNode {
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.start(ctx.currentTime);
  return gain;
}

function newContext(): AudioContext | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    void ctx.resume?.();
    return ctx;
  } catch {
    return null;
  }
}

function closeAfter(ctx: AudioContext, seconds: number): void {
  setTimeout(() => void ctx.close().catch(() => undefined), seconds * 1000 + 150);
}

/** A short decaying sine: the body of a latch or door "thunk". */
function thump(ctx: AudioContext, at: number, from: number, to: number, length: number, level: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** A burst of filtered noise: plastic clicks and spring rattle. */
function click(ctx: AudioContext, at: number, centre: number, length: number, level: number): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * length));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = centre;
  filter.Q.value = 1.2;
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + length);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at);
}

export interface InsertTiming {
  /** Seconds after the tap when the music should start, fading in over `fadeS` as the sound fades out. */
  musicAtS: number;
  fadeS: number;
}

/**
 * The cassette going in and the tape starting to run. Plays the recording from the tap (its first thud
 * lands as the cassette seats) and fades it out over its last `INSERT_CROSSFADE_S`; the caller starts the music
 * at the returned time. `delay` only places the synthesised stand-in's clunk, used if the recording isn't loaded.
 */
export function playInsert(delay = 0): InsertTiming {
  const clip = clips.insert;
  const ctx = newContext();
  if (!clip) {
    if (ctx) {
      const at = ctx.currentTime + delay;
      thump(ctx, at, 130, 48, 0.16, 0.9);
      click(ctx, at, 900, 0.05, 0.55);
      click(ctx, at + 0.1, 2400, 0.03, 0.4);
      closeAfter(ctx, delay + 0.4);
    }
    return { musicAtS: delay + 0.2, fadeS: SYNTH_INSERT_CROSSFADE_S };
  }
  const fadeS = Math.min(INSERT_CROSSFADE_S, clip.duration);
  const musicAtS = clip.duration - fadeS;
  if (ctx) {
    const gain = playClip(ctx, clip);
    gain.gain.setValueAtTime(1, ctx.currentTime + musicAtS);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + clip.duration);
    closeAfter(ctx, clip.duration);
  }
  return { musicAtS, fadeS };
}

/** The eject button's spring, then the cassette popping up. */
export function playEject(): void {
  const ctx = newContext();
  if (!ctx) return;
  const at = ctx.currentTime;
  if (clips.eject) {
    playClip(ctx, clips.eject);
    closeAfter(ctx, clips.eject.duration);
    return;
  }
  click(ctx, at, 2000, 0.05, 0.45);
  thump(ctx, at + 0.04, 260, 90, 0.12, 0.7);
  click(ctx, at + 0.09, 1200, 0.12, 0.35);
  closeAfter(ctx, 0.4);
}

/** A key press. */
export function playKey(): void {
  const ctx = newContext();
  if (!ctx) return;
  const at = ctx.currentTime;
  click(ctx, at, 1800, 0.025, 0.5);
  thump(ctx, at, 180, 80, 0.05, 0.35);
  closeAfter(ctx, 0.12);
}

export type RewindKind = 'restart' | 'previous';

/** How long the rewind whirr lasts, so the reels can spin backwards for exactly as long. */
export const REWIND_SOUND_S: Record<RewindKind, number> = { restart: 0.5, previous: 0.85 };

/** The key, then spools whirring backwards (rising whine, ratcheting flutter, hiss) and braking with a clunk. */
export function playRewind(kind: RewindKind = 'restart'): void {
  const ctx = newContext();
  if (!ctx) return;
  const at = ctx.currentTime;
  const length = REWIND_SOUND_S[kind];

  click(ctx, at, 1800, 0.025, 0.5);
  thump(ctx, at, 180, 80, 0.05, 0.35);

  const start = at + 0.04;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(170, start);
  osc.frequency.exponentialRampToValueAtTime(950, start + length * 0.55);
  osc.frequency.exponentialRampToValueAtTime(230, start + length);
  filter.type = 'bandpass';
  filter.frequency.value = 1100;
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.15, start + 0.07);
  gain.gain.exponentialRampToValueAtTime(0.001, start + length);
  osc.connect(filter).connect(gain).connect(ctx.destination);

  // The flutter: the volume ratchets a few dozen times a second, like spokes passing a pawl.
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = kind === 'previous' ? 24 : 30;
  depth.gain.value = 0.06;
  lfo.connect(depth).connect(gain.gain);

  osc.start(start);
  osc.stop(start + length + 0.02);
  lfo.start(start);
  lfo.stop(start + length + 0.02);

  click(ctx, start, 3200, length, 0.1);
  click(ctx, start + length, 1500, 0.03, 0.4);
  thump(ctx, start + length, 160, 70, 0.06, 0.4);
  closeAfter(ctx, length + 0.3);
}
