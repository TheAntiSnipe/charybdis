import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, TapeLoad, usePlayer } from './player';
import type { Track } from './types';

class FakeAudio extends EventTarget {
  static last: FakeAudio;
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 200;
  preload = '';
  constructor() {
    super();
    FakeAudio.last = this;
  }
  play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  load() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
}

class FakeMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: unknown[];
  constructor(init: { title?: string; artist?: string; album?: string; artwork?: unknown[] }) {
    this.title = init.title ?? '';
    this.artist = init.artist ?? '';
    this.album = init.album ?? '';
    this.artwork = init.artwork ?? [];
  }
}

const session = {
  metadata: null as FakeMetadata | null,
  playbackState: 'none',
  handlers: new Map<string, unknown>(),
  setActionHandler: vi.fn((action: string, handler: unknown) => {
    session.handlers.set(action, handler);
  }),
  setPositionState: vi.fn(),
};

const track = (n: number): Track => ({
  id: `t${n}`, title: `Secret Song ${n}`, artist: 'Secret Artist', album: 'Secret Album', albumId: 'a', albumArtist: 'Secret Artist',
  trackNo: n, discNo: 1, year: '1999', genre: '', durationSec: 180, codec: 'aac', bitrate: 0, sampleRate: 0, bitDepth: 0,
  ext: '.m4a', key: `music/t${n}.m4a`,
});

const tapeOf = (overrides: Partial<TapeLoad> = {}): TapeLoad => ({
  id: 'album-aaaaaaaaaaaa', kind: 'album', label: 'Test Album', tracks: [track(1), track(2), track(3)], index: 0, positionSec: 0,
  ...overrides,
});

let now = 1_000_000;
const onProgress = vi.fn();

function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlayerProvider artFor={() => '/art/x.jpg'} onTapeProgress={onProgress}>{children}</PlayerProvider>
  );
  const hook = renderHook(() => usePlayer(), { wrapper });
  return { ...hook, audio: FakeAudio.last };
}

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('MediaMetadata', FakeMetadata);
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  session.metadata = null;
  session.handlers.clear();
  session.setActionHandler.mockClear();
  session.setPositionState.mockClear();
  onProgress.mockClear();
  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('blind tape playback', () => {
  it('keeps song details out of the player state', () => {
    const { result } = setup();
    act(() => result.current.loadTape(tapeOf()));
    expect(result.current.current).toBeNull();
    expect(result.current.tape).toEqual({ id: 'album-aaaaaaaaaaaa', kind: 'album', label: 'Test Album', slot: 0, total: 3, totalSec: 540 });
    expect(JSON.stringify(result.current.tape)).not.toContain('Secret');
    expect(result.current.upNext).toEqual([]);
  });

  it('uses a generic lock screen title for album and artist tapes', () => {
    const { result } = setup();
    act(() => result.current.loadTape(tapeOf()));
    expect(session.metadata?.title).toBe('Test Album cassette');
    act(() => result.current.loadTape(tapeOf({ id: 'artist-aaaaaaaaaaaaaaaa', kind: 'artist', label: 'Some Band' })));
    expect(session.metadata?.title).toBe('Some Band mixtape');
    expect(session.metadata?.artist).toBe('');
    expect(session.metadata?.album).toBe('');
    expect(session.metadata?.artwork).toEqual([]);
  });

  it('removes skip and seek actions from the lock screen and hides the duration', () => {
    const { result } = setup();
    act(() => result.current.loadTape(tapeOf()));
    for (const action of ['previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward']) {
      expect(session.handlers.get(action)).toBeNull();
    }
    expect(typeof session.handlers.get('play')).toBe('function');
    expect(typeof session.handlers.get('pause')).toBe('function');
    expect(session.setPositionState).toHaveBeenLastCalledWith({ duration: Infinity, position: 0, playbackRate: 1 });
  });

  it('cannot skip, seek, jump or shuffle', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    const src = audio.src;
    act(() => {
      result.current.next();
      result.current.prev();
      result.current.seek(99);
      result.current.jumpTo(0);
      result.current.toggleShuffle();
    });
    expect(audio.src).toBe(src);
    expect(audio.currentTime).toBe(0);
    expect(result.current.tape?.slot).toBe(0);
  });

  it('does not expose the song position or duration', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    act(() => {
      audio.currentTime = 50;
      audio.dispatchEvent(new Event('timeupdate'));
      audio.dispatchEvent(new Event('durationchange'));
    });
    expect(result.current.position).toBe(0);
    expect(result.current.duration).toBe(0);
  });

  it('loads paused, then plays when the user presses play', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    expect(audio.src).toBe('/music/t1.m4a');
    expect(audio.paused).toBe(true);
    act(() => result.current.toggle());
    expect(audio.paused).toBe(false);
    expect(result.current.playing).toBe(true);
  });

  it('resumes at the saved song and position', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 2, positionSec: 42 })));
    expect(audio.src).toBe('/music/t3.m4a');
    expect(result.current.tape?.slot).toBe(2);
    audio.dispatchEvent(new Event('loadedmetadata'));
    expect(audio.currentTime).toBe(42);
  });

  it('clamps a stale saved slot to the tape', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 99 })));
    expect(audio.src).toBe('/music/t3.m4a');
  });

  it('advances when a song ends and saves the new position', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    act(() => result.current.toggle());
    act(() => audio.dispatchEvent(new Event('ended')));
    expect(audio.src).toBe('/music/t2.m4a');
    expect(result.current.tape?.slot).toBe(1);
    expect(onProgress).toHaveBeenLastCalledWith('album-aaaaaaaaaaaa', 1, 0);
  });

  it('stops at the end of the tape', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 2 })));
    act(() => result.current.toggle());
    audio.ended = true;
    act(() => audio.dispatchEvent(new Event('ended')));
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe('/music/t3.m4a');
    expect(result.current.tapeEnded).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith('album-aaaaaaaaaaaa', 2, 0);
  });

  it('rewinds to the start of a song that is well under way', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 1 })));
    audio.currentTime = 80;
    let did: ReturnType<typeof result.current.rewind> = null;
    act(() => { did = result.current.rewind(); });
    expect(did).toBe('restart');
    expect(audio.currentTime).toBe(0);
    expect(audio.src).toBe('/music/t2.m4a');
    expect(result.current.tape?.slot).toBe(1);
  });

  it('goes back a song when rewound near the start, and keeps going on repeated presses', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 2 })));
    act(() => result.current.toggle());
    audio.currentTime = 2.5;
    let did: ReturnType<typeof result.current.rewind> = null;
    act(() => { did = result.current.rewind(); });
    expect(did).toBe('previous');
    expect(audio.src).toBe('/music/t2.m4a');
    expect(result.current.tape?.slot).toBe(1);
    expect(audio.paused).toBe(false); // it was playing, so it carries on
    expect(onProgress).toHaveBeenLastCalledWith('album-aaaaaaaaaaaa', 1, 0);
    audio.currentTime = 0;
    act(() => { did = result.current.rewind(); });
    expect(did).toBe('previous');
    expect(result.current.tape?.slot).toBe(0);
    expect(audio.src).toBe('/music/t1.m4a');
    expect(result.current.tapeProgress).toBe(0);
  });

  it('goes back to the previous song paused if the tape was paused', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 1 })));
    audio.currentTime = 0;
    act(() => { result.current.rewind(); });
    expect(result.current.tape?.slot).toBe(0);
    expect(audio.paused).toBe(true);
  });

  it('stops at the first song: rewinding there only restarts it', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 0 })));
    audio.currentTime = 1;
    let did: ReturnType<typeof result.current.rewind> = null;
    act(() => { did = result.current.rewind(); });
    expect(did).toBe('restart');
    expect(result.current.tape?.slot).toBe(0);
    expect(audio.currentTime).toBe(0);
  });

  it('does nothing without a tape loaded', () => {
    const { result } = setup();
    let did: ReturnType<typeof result.current.rewind> = 'restart';
    act(() => { did = result.current.rewind(); });
    expect(did).toBeNull();
  });

  it('rewinding after the end of the tape restarts the last song and clears the end state', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 2 })));
    act(() => result.current.toggle());
    audio.currentTime = 180;
    audio.ended = true;
    act(() => audio.dispatchEvent(new Event('ended')));
    expect(result.current.tapeEnded).toBe(true);
    audio.ended = false;
    act(() => { result.current.rewind(); });
    expect(result.current.tapeEnded).toBe(false);
    expect(result.current.tape?.slot).toBe(2);
    expect(audio.currentTime).toBe(0);
  });

  it('saves progress at most every 15 seconds, and on pause', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    act(() => result.current.toggle());
    now += 5_000;
    act(() => audio.dispatchEvent(new Event('timeupdate')));
    expect(onProgress).not.toHaveBeenCalled();
    now += 11_000;
    audio.currentTime = 16;
    act(() => audio.dispatchEvent(new Event('timeupdate')));
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith('album-aaaaaaaaaaaa', 0, 16);
    audio.currentTime = 20;
    act(() => result.current.toggle());
    expect(onProgress).toHaveBeenLastCalledWith('album-aaaaaaaaaaaa', 0, 20);
  });

  it('saves progress when the page is hidden', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    audio.currentTime = 33;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(onProgress).toHaveBeenLastCalledWith('album-aaaaaaaaaaaa', 0, 33);
  });

  it('ejects: saves the place and clears the deck and lock screen', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 1 })));
    act(() => result.current.toggle());
    audio.currentTime = 61;
    act(() => result.current.eject());
    expect(onProgress).toHaveBeenLastCalledWith('album-aaaaaaaaaaaa', 1, 61);
    expect(result.current.tape).toBeNull();
    expect(audio.src).toBe('');
    expect(audio.paused).toBe(true);
    expect(session.metadata).toBeNull();
  });

  it('puts the tape away when normal playback starts', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    audio.currentTime = 7;
    act(() => result.current.play([track(9)], 0));
    expect(onProgress).toHaveBeenCalledWith('album-aaaaaaaaaaaa', 0, 7);
    expect(result.current.tape).toBeNull();
    expect(result.current.current?.id).toBe('t9');
    expect(session.metadata?.title).toBe('Secret Song 9');
    expect(typeof session.handlers.get('nexttrack')).toBe('function');
    expect(session.setPositionState).toHaveBeenLastCalledWith();
  });

  it('tracks how far through the whole tape you are', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf())); // three 180s songs
    expect(result.current.tapeProgress).toBe(0);
    act(() => result.current.toggle());
    audio.currentTime = 90;
    act(() => audio.dispatchEvent(new Event('timeupdate')));
    expect(result.current.tapeProgress).toBeCloseTo(90 / 540, 4);
    act(() => audio.dispatchEvent(new Event('ended')));
    expect(result.current.tape?.slot).toBe(1);
    expect(result.current.tapeProgress).toBeCloseTo(180 / 540, 4);
    audio.currentTime = 60;
    act(() => audio.dispatchEvent(new Event('timeupdate')));
    expect(result.current.tapeProgress).toBeCloseTo(240 / 540, 4);
  });

  it('starts a resumed tape part-way through, and rewinding goes back to the start of that song', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 1, positionSec: 30 })));
    expect(result.current.tapeProgress).toBeCloseTo(210 / 540, 4);
    audio.currentTime = 100;
    act(() => audio.dispatchEvent(new Event('timeupdate')));
    act(() => { result.current.rewind(); });
    expect(result.current.tapeProgress).toBeCloseTo(180 / 540, 4);
  });

  it('reaches the end of the tape and resets on eject', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf({ index: 2 })));
    act(() => result.current.toggle());
    audio.ended = true;
    act(() => audio.dispatchEvent(new Event('ended')));
    expect(result.current.tapeProgress).toBe(1);
    act(() => result.current.eject());
    expect(result.current.tapeProgress).toBe(0);
  });

  it('does not re-render for tiny steps in progress', () => {
    const { result, audio } = setup();
    act(() => result.current.loadTape(tapeOf()));
    audio.currentTime = 10;
    act(() => audio.dispatchEvent(new Event('timeupdate')));
    const at = result.current.tapeProgress;
    audio.currentTime = 10.2; // 0.04% of the tape
    act(() => audio.dispatchEvent(new Event('timeupdate')));
    expect(result.current.tapeProgress).toBe(at);
  });

  it('renames the loaded tape, and the lock screen follows', () => {
    const { result } = setup();
    act(() => result.current.loadTape(tapeOf()));
    expect(session.metadata?.title).toBe('Test Album cassette');
    act(() => result.current.relabelTape('album-aaaaaaaaaaaa', 'Road trip'));
    expect(result.current.tape?.label).toBe('Road trip');
    expect(session.metadata?.title).toBe('Road trip cassette');
    act(() => result.current.relabelTape('some-other-tape', 'Nope'));
    expect(result.current.tape?.label).toBe('Road trip');
  });

  it('keeps normal playback unchanged', () => {
    const { result, audio } = setup();
    act(() => result.current.play([track(1), track(2)], 0, 'ordered'));
    expect(audio.src).toBe('/music/t1.m4a');
    act(() => result.current.next());
    expect(audio.src).toBe('/music/t2.m4a');
    act(() => result.current.seek(30));
    expect(audio.currentTime).toBe(30);
    expect(onProgress).not.toHaveBeenCalled();
  });
});
