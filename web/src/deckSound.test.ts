import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playEject, playInsert, playKey, playRewind, REWIND_SOUND_S } from './deckSound';

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  value = 0;
}
const node = () => ({ connect: vi.fn(function (this: unknown, next: unknown) { return next ?? this; }), start: vi.fn(), stop: vi.fn() });

let contexts: FakeContext[];
class FakeContext {
  currentTime = 1;
  sampleRate = 8000;
  destination = {};
  close = vi.fn(() => Promise.resolve());
  resume = vi.fn(() => Promise.resolve());
  oscillators = 0;
  sources: { buffer: unknown; start: ReturnType<typeof vi.fn> }[] = [];
  gains: { gain: FakeParam }[] = [];
  constructor() { contexts.push(this); }
  createOscillator() { this.oscillators++; return { ...node(), frequency: new FakeParam() }; }
  createGain() { const g = { ...node(), gain: new FakeParam() }; this.gains.push(g); return g; }
  createBiquadFilter() { return { ...node(), frequency: { value: 0 }, Q: { value: 0 }, type: '' }; }
  createBuffer(_c: number, frames: number) { return { getChannelData: () => new Float32Array(frames) }; }
  createBufferSource() { const s = { ...node(), buffer: null as unknown }; this.sources.push(s); return s; }
}

beforeEach(() => {
  contexts = [];
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('deck sounds', () => {
  it('makes a context per sound and closes it afterwards', () => {
    playKey();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
  });

  it('schedules the synthesised insert clunk after its delay and keeps the context open until then', () => {
    const timing = playInsert(0.6);
    expect(timing.musicAtS).toBeGreaterThan(0.6);
    expect(contexts[0].oscillators).toBeGreaterThan(0);
    vi.advanceTimersByTime(500);
    expect(contexts[0].close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(contexts[0].close).toHaveBeenCalled();
  });

  it('plays an eject sound', () => {
    playEject();
    expect(contexts).toHaveLength(1);
  });

  it('plays a rewind whirr, longer when it goes back a song', () => {
    playRewind('restart');
    playRewind('previous');
    expect(contexts).toHaveLength(2);
    expect(contexts[0].oscillators).toBeGreaterThanOrEqual(3); // key thump, whine and flutter
    expect(REWIND_SOUND_S.previous).toBeGreaterThan(REWIND_SOUND_S.restart);
    vi.advanceTimersByTime(REWIND_SOUND_S.restart * 1000);
    expect(contexts[0].close).not.toHaveBeenCalled(); // still sounding
    vi.advanceTimersByTime(1000);
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
    expect(contexts[1].close).toHaveBeenCalledTimes(1);
  });

  it('does nothing, and does not throw, where Web Audio is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => { playKey(); playInsert(); playEject(); playRewind('previous'); }).not.toThrow();
  });

  it('survives a context that refuses to start', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('blocked'); } });
    expect(() => playKey()).not.toThrow();
  });

  describe('recordings', () => {
    const insert = { duration: 7 };
    const eject = { duration: 1 };

    async function withClips(ok = true) {
      vi.resetModules();
      contexts = [];
      vi.stubGlobal('OfflineAudioContext', class {
        decodeAudioData(data: ArrayBuffer) { return Promise.resolve(data.byteLength === 1 ? insert : eject); }
      });
      vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
        ok,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(url.includes('insert') ? 1 : 2)),
      })));
      const sound = await import('./deckSound');
      sound.preloadDeckSounds();
      await vi.advanceTimersByTimeAsync(0);
      return sound;
    }

    it('plays the insert recording, fading it out over the crossfade and reporting when the music should start', async () => {
      const sound = await withClips();
      const timing = sound.playInsert(0.62);
      expect(timing.fadeS).toBe(sound.INSERT_CROSSFADE_S);
      expect(timing.musicAtS).toBeCloseTo(7 - sound.INSERT_CROSSFADE_S);
      expect(contexts[0].sources[0].buffer).toBe(insert);
      expect(contexts[0].oscillators).toBe(0); // not the synthesised clunk
      const { gain } = contexts[0].gains[0];
      expect(gain.setValueAtTime).toHaveBeenCalledWith(1, 1 + timing.musicAtS);
      expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1 + 7);
      vi.advanceTimersByTime(7200);
      expect(contexts[0].close).toHaveBeenCalledTimes(1);
    });

    it('plays the eject recording', async () => {
      const sound = await withClips();
      sound.playEject();
      expect(contexts[0].sources[0].buffer).toBe(eject);
      expect(contexts[0].oscillators).toBe(0);
    });

    it('falls back to the synthesised sounds when the recordings are missing', async () => {
      const sound = await withClips(false);
      sound.playInsert();
      sound.playEject();
      expect(contexts[0].sources.every((s) => s.buffer !== insert)).toBe(true); // only noise bursts, no recording
      expect(contexts[1].sources.every((s) => s.buffer !== eject)).toBe(true);
    });

    it('retries the download next time if a recording was missing', async () => {
      const sound = await withClips(false);
      sound.preloadDeckSounds();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });
});
