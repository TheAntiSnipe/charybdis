// Mechanical deck sounds, synthesised with Web Audio so the app ships no audio files.
// A context is made per sound inside the user's tap and closed right after, so it never lingers
// next to the <audio> element that plays the music.

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

/** The cassette seating and the door latching, `delay` seconds from now. */
export function playInsert(delay = 0): void {
  const ctx = newContext();
  if (!ctx) return;
  const at = ctx.currentTime + delay;
  thump(ctx, at, 130, 48, 0.16, 0.9);
  click(ctx, at, 900, 0.05, 0.55);
  click(ctx, at + 0.1, 2400, 0.03, 0.4);
  closeAfter(ctx, delay + 0.4);
}

/** The eject button's spring, then the cassette popping up. */
export function playEject(): void {
  const ctx = newContext();
  if (!ctx) return;
  const at = ctx.currentTime;
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
