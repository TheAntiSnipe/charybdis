import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playEject, playInsert, playKey } from './deckSound';

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
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
  constructor() { contexts.push(this); }
  createOscillator() { this.oscillators++; return { ...node(), frequency: new FakeParam() }; }
  createGain() { return { ...node(), gain: new FakeParam() }; }
  createBiquadFilter() { return { ...node(), frequency: { value: 0 }, Q: { value: 0 }, type: '' }; }
  createBuffer(_c: number, frames: number) { return { getChannelData: () => new Float32Array(frames) }; }
  createBufferSource() { return { ...node(), buffer: null }; }
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

  it('schedules the insert clunk after its delay and keeps the context open until then', () => {
    playInsert(0.6);
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

  it('does nothing, and does not throw, where Web Audio is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => { playKey(); playInsert(); playEject(); }).not.toThrow();
  });

  it('survives a context that refuses to start', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('blocked'); } });
    expect(() => playKey()).not.toThrow();
  });
});
