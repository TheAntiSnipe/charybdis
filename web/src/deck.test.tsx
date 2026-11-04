import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EJECT_MS, INSERT_CLUNK_S, INSERT_MS } from './Deck';
import * as sound from './deckSound';
import PlayerBar from './PlayerBar';
import { PlayerProvider, usePlayer } from './player';
import TapeDeck from './TapeDeck';
import type { TapeStore } from './tapes';
import type { Cassette, CassetteStyle, Library, Track } from './types';

vi.mock('./deckSound', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deckSound')>()),
  playInsert: vi.fn(() => ({ musicAtS: 2, fadeS: 1 })),
  playEject: vi.fn(),
  playKey: vi.fn(),
  playRewind: vi.fn(),
}));

class FakeAudio extends EventTarget {
  static last: FakeAudio;
  src = ''; paused = true; ended = false; currentTime = 0; duration = 100; preload = ''; volume = 1;
  constructor() { super(); FakeAudio.last = this; }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  load() {}
  removeAttribute() { this.src = ''; }
}

const track = (n: number): Track => ({
  id: `t${n}`, title: `Secret Song ${n}`, artist: 'Public Artist', album: 'Public Album', albumId: 'aaaaaaaaaaaa',
  albumArtist: 'Public Artist', trackNo: n, discNo: 1, year: '2000', genre: '', durationSec: 180, codec: 'aac',
  bitrate: 0, sampleRate: 0, bitDepth: 0, ext: '.m4a', key: `music/t${n}.m4a`,
});
const tracks = [track(1), track(2), track(3)];
const album = (id: string, artKey: string | null) => ({ id, title: 'x', artist: 'y', year: '2000', trackIds: ['t1', 't2', 't3'], artKey });
const noArt: Library = { tracks, playlists: [], albums: [] };
const resolve = (ids: string[]) => ids.map((id) => tracks.find((t) => t.id === id)).filter((t): t is Track => !!t);
const tape = (id = 'album-aaaaaaaaaaaa', label = 'Public Album'): Cassette => ({
  id, kind: 'album', sourceId: id.slice(6), label, trackIds: ['t1', 't2', 't3'], pages: [],
  progress: { index: 1, positionSec: 30 }, status: 'shelf', createdAt: 1,
});
const withStyle = (style: CassetteStyle, extra: Partial<Cassette> = {}): Cassette => ({ ...tape(), style, ...extra });

let playerApi: ReturnType<typeof usePlayer>;
function Probe() {
  playerApi = usePlayer();
  return null;
}

const onVisible = vi.fn();
const update = vi.fn();

function Harness({ cassettes, library = noArt }: { cassettes: Cassette[]; library?: Library }) {
  const [deckOpen, setDeckOpen] = useState(true);
  const [list, setList] = useState(cassettes);
  const store = {
    cassettes: list, entries: [], status: 'ready' as const, error: '', create: vi.fn(), reload: vi.fn(),
    recordProgress: vi.fn(), progressOf: (t: Cassette) => t.progress,
    update: async (id: string, patch: { title?: string | null; style?: CassetteStyle }) => {
      await update(id, patch);
      setList((all) => all.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c };
        if ('title' in patch) {
          if (patch.title) next.title = patch.title;
          else delete next.title;
        }
        if (patch.style) next.style = patch.style;
        return next;
      }));
    },
  } as unknown as TapeStore;
  return (
    <PlayerProvider artFor={() => null}>
      <Probe />
      <button onClick={() => setDeckOpen((o) => !o)}>toggle deck tab</button>
      {deckOpen && <TapeDeck library={library} tapes={store} resolve={resolve} onVisible={onVisible} />}
      <PlayerBar artFor={() => null} hideTapeBar={deckOpen} />
    </PlayerProvider>
  );
}

const bay = () => document.querySelector('.deck-bay') as HTMLElement;
const lcd = () => document.querySelector('.deck-lcd')?.textContent;
const cassetteEl = () => document.querySelector('.cassette') as HTMLElement;
const label = () => document.querySelector('.cassette-label')?.textContent;
const spine = (name = 'Cassette: Public Album') => screen.getByRole('button', { name });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const lockScreenTitle = () => (navigator.mediaSession.metadata as unknown as { init: { title: string } } | null)?.init.title;
const pack = (side: 'left' | 'right') => Number(document.querySelector(`[data-pack="${side}"]`)?.getAttribute('r'));

function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
}

const TIMING = { musicAtS: 2, fadeS: 1 }; // what the mocked insert sound reports
const STARTUP_MS = (TIMING.musicAtS + TIMING.fadeS) * 1000 + 1;

// The tape starts itself once the insert sound has faded; this waits that out and stops it, as a user who pauses would.
async function loadAndSettle(name?: string) {
  fireEvent.click(spine(name));
  advance(STARTUP_MS);
  act(() => FakeAudio.last.pause());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('MediaMetadata', class { constructor(public init: unknown) {} });
  Object.defineProperty(navigator, 'mediaSession', {
    value: { setActionHandler: vi.fn(), setPositionState: vi.fn(), metadata: null, playbackState: 'none' },
    configurable: true,
  });
  motion(false);
  localStorage.clear();
  vi.clearAllMocks();
  update.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Deck', () => {
  it('starts empty with the keys disabled', () => {
    render(<Harness cassettes={[tape()]} />);
    expect(screen.getByText('Insert a cassette')).toBeTruthy();
    expect(lcd()).toBe('--');
    for (const name of ['Play', 'Rewind', 'Eject tape']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('inserts a tape: animates, clunks on cue, then settles', () => {
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    expect(sound.playInsert).toHaveBeenCalledWith(INSERT_CLUNK_S);
    expect(bay().className).toContain('inserting');
    expect(label()).toBe('Public Album');
    advance(INSERT_MS - 1);
    expect(bay().className).toContain('inserting');
    advance(2);
    expect(bay().className).toContain('loaded');
    expect(lcd()).toBe('02'); // resumes on the saved song (index 1)
  });

  it('starts the tape itself as the insert sound fades, fading the music in and keeping the keys locked until then', () => {
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    const audio = FakeAudio.last;
    const keys = () => [/^(Play|Pause)$/, 'Rewind', 'Eject tape'].map((name) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled);
    advance(INSERT_MS + 1);
    expect(keys()).toEqual([true, true, true]);
    expect(audio.paused).toBe(true);
    expect(playerApi.playing).toBe(false);
    advance(TIMING.musicAtS * 1000 - INSERT_MS - 1);
    expect(audio.paused).toBe(false);
    expect(playerApi.playing).toBe(true);
    expect(audio.volume).toBeLessThan(0.1);
    advance(TIMING.fadeS * 500);
    expect(audio.volume).toBeGreaterThan(0.5);
    expect(keys()).toEqual([true, true, true]);
    advance(TIMING.fadeS * 500 + 100);
    expect(audio.volume).toBe(1);
    expect(keys()).toEqual([false, false, false]);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('does not start the tape if normal playback takes over during the insert', () => {
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    act(() => playerApi.play([track(1)], 0));
    advance(STARTUP_MS);
    expect(playerApi.tape).toBeNull();
    expect(playerApi.tapeStarting).toBe(false);
    expect(FakeAudio.last.volume).toBe(1);
  });

  it('spins the reels only while playing', () => {
    render(<Harness cassettes={[tape()]} />);
    loadAndSettle();
    expect(document.querySelector('.cassette.playing')).toBeNull();
    expect(document.querySelector('.deck-led.on')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(sound.playKey).toHaveBeenCalled();
    expect(document.querySelector('.cassette.playing')).not.toBeNull();
    expect(document.querySelector('.deck-led.on')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(document.querySelector('.cassette.playing')).toBeNull();
  });

  describe('rewind', () => {
    const press = () => fireEvent.click(screen.getByRole('button', { name: 'Rewind' }));

    it('restarts a song that is well under way, with the short whirr', () => {
      render(<Harness cassettes={[tape()]} />);
      loadAndSettle();
      FakeAudio.last.currentTime = 77;
      press();
      expect(FakeAudio.last.currentTime).toBe(0);
      expect(lcd()).toBe('02');
      expect(sound.playRewind).toHaveBeenLastCalledWith('restart');
    });

    it('keeps going back a song at a time on repeated presses, then stops at the first', () => {
      render(<Harness cassettes={[tape()]} />);
      loadAndSettle();
      FakeAudio.last.currentTime = 77;
      press(); // restart song 2
      expect(lcd()).toBe('02');
      press(); // now near the start: back to song 1
      expect(lcd()).toBe('01');
      expect(FakeAudio.last.src).toContain('/music/t1.m4a');
      expect(sound.playRewind).toHaveBeenLastCalledWith('previous');
      FakeAudio.last.currentTime = 1;
      press(); // nowhere earlier to go: just restarts
      expect(lcd()).toBe('01');
      expect(FakeAudio.last.currentTime).toBe(0);
      expect(sound.playRewind).toHaveBeenLastCalledWith('restart');
    });

    it('spins the reels backwards for as long as the whirr lasts', () => {
      render(<Harness cassettes={[tape()]} />);
      loadAndSettle();
      expect(document.querySelector('.cassette.rewinding')).toBeNull();
      FakeAudio.last.currentTime = 77;
      press();
      expect(document.querySelector('.cassette.rewinding')).not.toBeNull();
      advance(sound.REWIND_SOUND_S.restart * 1000 + 1);
      expect(document.querySelector('.cassette.rewinding')).toBeNull();
    });

    it('does not animate for people who prefer reduced motion, but still makes the sound', () => {
      motion(true);
      render(<Harness cassettes={[tape()]} />);
      loadAndSettle();
      press();
      expect(document.querySelector('.cassette.rewinding')).toBeNull();
      expect(sound.playRewind).toHaveBeenCalled();
    });
  });

  it('ejects: sound, animation, then an empty deck, with the tape put away', () => {
    render(<Harness cassettes={[tape()]} />);
    loadAndSettle();
    fireEvent.click(screen.getByRole('button', { name: 'Eject tape' }));
    expect(sound.playEject).toHaveBeenCalledTimes(1);
    expect(bay().className).toContain('ejecting');
    expect(label()).toBe('Public Album'); // still on its way out
    expect(playerApi.tape).toBeNull();
    advance(EJECT_MS + 1);
    expect(bay().className).toContain('idle');
    expect(screen.getByText('Insert a cassette')).toBeTruthy();
    expect(lcd()).toBe('--');
  });

  it('can reload the same tape after ejecting it', () => {
    render(<Harness cassettes={[tape()]} />);
    loadAndSettle();
    fireEvent.click(screen.getByRole('button', { name: 'Eject tape' }));
    advance(EJECT_MS + 1);
    fireEvent.click(spine());
    expect(bay().className).toContain('inserting');
    expect(playerApi.tape?.id).toBe('album-aaaaaaaaaaaa');
  });

  it('swapping tapes animates the new one in', () => {
    render(<Harness cassettes={[tape(), tape('album-bbbbbbbbbbbb', 'Other Album')]} />);
    loadAndSettle();
    fireEvent.click(spine('Cassette: Other Album'));
    expect(bay().className).toContain('inserting');
    expect(label()).toBe('Other Album');
  });

  it('clears when normal playback takes over the player', () => {
    render(<Harness cassettes={[tape()]} />);
    loadAndSettle();
    act(() => playerApi.play([track(1)], 0));
    expect(screen.getByText('Insert a cassette')).toBeTruthy();
    expect(bay().className).toContain('idle');
  });

  it('skips the animation for people who prefer reduced motion, but still clunks', () => {
    motion(true);
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    expect(bay().className).toContain('loaded');
    expect(sound.playInsert).toHaveBeenCalledWith(0);
    advance(STARTUP_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Eject tape' }));
    expect(bay().className).toContain('idle');
  });

  it('keeps a loaded tape in the deck, without replaying the animation, when you come back to the tab', () => {
    render(<Harness cassettes={[tape()]} />);
    loadAndSettle();
    fireEvent.click(screen.getByRole('button', { name: 'toggle deck tab' }));
    expect(document.querySelector('.deck')).toBeNull();
    expect(screen.getByRole('button', { name: 'Eject tape' })).toBeTruthy(); // the compact tape bar takes over
    fireEvent.click(screen.getByRole('button', { name: 'toggle deck tab' }));
    expect(bay().className).toContain('loaded');
    expect(label()).toBe('Public Album');
  });

  it('tells the page when the deck is on screen, so only one set of controls shows', () => {
    render(<Harness cassettes={[tape()]} />);
    expect(onVisible).toHaveBeenLastCalledWith(true);
    fireEvent.click(spine());
    expect(screen.getAllByRole('button', { name: 'Eject tape' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'toggle deck tab' }));
    expect(onVisible).toHaveBeenLastCalledWith(false);
  });

  it('never shows a song title, even while playing', () => {
    render(<Harness cassettes={[tape()]} />);
    loadAndSettle();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(document.body.textContent).not.toContain('Secret Song');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('has no mute control', () => {
    render(<Harness cassettes={[tape()]} />);
    expect(screen.queryByRole('button', { name: /sound/i })).toBeNull();
  });

  it('refuses a damaged tape without making a sound', () => {
    render(<Harness cassettes={[{ ...tape(), trackIds: ['t1', 'gone'] }]} />);
    fireEvent.click(spine());
    expect(sound.playInsert).not.toHaveBeenCalled();
    expect(screen.getByText('Insert a cassette')).toBeTruthy();
  });
});

describe('cassette styles', () => {
  const artLibrary: Library = { ...noArt, albums: [album('aaaaaaaaaaaa', 'art/a.jpg')] };
  const pages = [{ albumId: 'aaaaaaaaaaaa', count: 3 }];

  it('defaults to a generated cover, with no real album art', () => {
    render(<Harness cassettes={[{ ...tape(), pages }]} library={artLibrary} />);
    fireEvent.click(spine());
    expect(cassetteEl().className).toContain('cassette-generated');
    expect(document.querySelector('.cassette-genart')).not.toBeNull();
    expect(document.querySelector('.cassette-covers')).toBeNull();
    expect(label()).toBe('Public Album');
  });

  it('generates the same cover for a tape every time', () => {
    const shapes = () => [...document.querySelectorAll('.cassette-genart circle, .cassette-genart rect[transform]')].map((n) => n.outerHTML);
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    const first = shapes();
    expect(first.length).toBeGreaterThan(2);
    cleanup();
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    expect(shapes()).toEqual(first);
    cleanup();
    render(<Harness cassettes={[tape('album-bbbbbbbbbbbb', 'Other')]} />);
    fireEvent.click(spine('Cassette: Other'));
    expect(shapes()).not.toEqual(first);
  });

  it('the cover style puts the album cover on the face', () => {
    render(<Harness cassettes={[withStyle('cover', { pages })]} library={artLibrary} />);
    fireEvent.click(spine());
    expect(cassetteEl().className).toContain('cassette-cover');
    expect([...document.querySelectorAll('.cassette-covers img')].map((i) => i.getAttribute('src'))).toEqual(['/art/a.jpg']);
    expect(document.querySelector('.cassette-genart')).toBeNull();
    expect(label()).toBe('Public Album');
  });

  it('lays an artist mixtape out as a strip of up to four distinct covers', () => {
    const albums = ['a', 'b', 'c', 'd', 'e'].map((k) => album(k.repeat(12), `art/${k}.jpg`));
    const library: Library = { ...noArt, albums: [...albums, album('f'.repeat(12), 'art/a.jpg')] };
    const mix: Cassette = {
      ...tape('artist-bbbbbbbbbbbbbbbb', 'Some Band'), kind: 'artist', sourceId: 'Some Band', style: 'cover',
      pages: [...albums, album('f'.repeat(12), 'art/a.jpg')].map((a) => ({ albumId: a.id, count: 1 })),
    };
    render(<Harness cassettes={[mix]} library={library} />);
    fireEvent.click(spine('Mixtape: Some Band'));
    expect([...document.querySelectorAll('.cassette-covers img')].map((i) => i.getAttribute('src')))
      .toEqual(['/art/a.jpg', '/art/b.jpg', '/art/c.jpg', '/art/d.jpg']);
  });

  it('the cover style falls back to the generated cover with no art, or when the image fails to load', () => {
    render(<Harness cassettes={[withStyle('cover')]} />);
    fireEvent.click(spine());
    expect(document.querySelector('.cassette-genart')).not.toBeNull();
    cleanup();

    render(<Harness cassettes={[withStyle('cover', { pages })]} library={artLibrary} />);
    fireEvent.click(spine());
    fireEvent.error(document.querySelector('.cassette-covers img') as HTMLImageElement);
    expect(document.querySelector('.cassette-covers')).toBeNull();
    expect(document.querySelector('.cassette-genart')).not.toBeNull();
  });

  it('the executive style is a blue-label blank with the title on the first line and the tape length printed', () => {
    render(<Harness cassettes={[withStyle('executive', { title: 'Road trip' })]} />);
    fireEvent.click(spine('Cassette: Road trip'));
    expect(cassetteEl().className).toContain('cassette-executive');
    const text = document.querySelector('.cassette-print')?.textContent ?? '';
    expect(text).toContain('Road trip');
    expect(text).toContain('C-46'); // three 3-minute songs
    expect(text).toContain('SIDE');
    expect(text).toContain('HIGH ENERGY');
    expect(document.querySelector('.cassette-face')).toBeNull();
  });

  it('the executive blank does not carry anyone else\'s logo or phone number', () => {
    render(<Harness cassettes={[withStyle('executive')]} />);
    fireEvent.click(spine());
    const text = document.querySelector('.cassette-print')?.textContent ?? '';
    expect(text).not.toMatch(/EVC|EXECUTIVE|\(\d{3}\)|\d{3}-\d{4}/);
  });

  it('the clear style has no label, with the title written on the plastic', () => {
    render(<Harness cassettes={[withStyle('clear')]} />);
    fireEvent.click(spine());
    expect(cassetteEl().className).toContain('cassette-clear');
    expect(document.querySelector('.cassette-face')).toBeNull();
    expect(document.querySelector('.cassette-print')).toBeNull();
    expect(label()).toBe('Public Album');
  });

  it('the clear style shows tape moving from the left reel to the right as the tape plays', () => {
    render(<Harness cassettes={[withStyle('clear', { progress: { index: 0, positionSec: 0 } })]} />);
    loadAndSettle();
    expect(pack('left')).toBeCloseTo(26.5, 1);
    expect(pack('right')).toBeCloseTo(9.2, 1);

    FakeAudio.last.currentTime = 90; // halfway through the first of three equal songs
    act(() => { FakeAudio.last.dispatchEvent(new Event('timeupdate')); });
    expect(playerApi.tapeProgress).toBeCloseTo(90 / 540, 3);
    expect(pack('left')).toBeLessThan(26.5);
    expect(pack('right')).toBeGreaterThan(9.2);

    // equal tape on both reels at the midpoint, and it keeps the same total amount of tape
    FakeAudio.last.currentTime = 90;
    act(() => { playerApi.loadTape({ id: 'album-aaaaaaaaaaaa', kind: 'album', label: 'Public Album', tracks, index: 1, positionSec: 90 }); });
    expect(pack('left')).toBeCloseTo(pack('right'), 0);
  });

  it('the clear style starts a resumed tape part-way through', () => {
    render(<Harness cassettes={[withStyle('clear')]} />); // saved at song 2, 30s in
    loadAndSettle();
    expect(playerApi.tapeProgress).toBeCloseTo((180 + 30) / 540, 3);
    expect(pack('left')).toBeLessThan(pack('right') + 20);
    expect(pack('left')).toBeGreaterThan(pack('right'));
  });

  it('only the clear style shows progress; other styles keep their reels the same size', () => {
    render(<Harness cassettes={[withStyle('executive', { progress: { index: 0, positionSec: 0 } })]} />);
    loadAndSettle();
    const before = pack('left');
    FakeAudio.last.currentTime = 150;
    act(() => { FakeAudio.last.dispatchEvent(new Event('timeupdate')); });
    expect(pack('left')).toBe(before);
    expect(pack('right')).toBe(before);
  });
});

describe('customizing a cassette', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Customize this cassette' }));
  const title = () => screen.getByLabelText('Title') as HTMLInputElement;

  it('needs a loaded tape', () => {
    render(<Harness cassettes={[tape()]} />);
    expect((screen.getByRole('button', { name: 'Customize this cassette' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(spine());
    expect((screen.getByRole('button', { name: 'Customize this cassette' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('closes by itself when the tape is ejected', () => {
    render(<Harness cassettes={[tape()]} />);
    loadAndSettle();
    open();
    expect(title()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eject tape' }));
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('shows the custom title on the spine, the cassette, the lock screen and the status', () => {
    render(<Harness cassettes={[tape()]} />);
    expect(screen.getAllByRole('button', { name: 'Cassette: Public Album' })).toHaveLength(1);
    cleanup();
    render(<Harness cassettes={[{ ...tape(), title: 'Road trip' }]} />);
    fireEvent.click(spine('Cassette: Road trip'));
    expect(label()).toBe('Road trip');
    expect(lockScreenTitle()).toBe('Road trip cassette');
    expect(screen.getByRole('status').textContent).toContain('Road trip cassette loaded');
  });

  it('renames the tape everywhere, live, and tells the server', async () => {
    vi.useRealTimers();
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    open();
    expect(title().placeholder).toBe('Public Album');
    fireEvent.change(title(), { target: { value: '  Late night  ' } });
    fireEvent.blur(title());
    await waitFor(() => expect(update).toHaveBeenCalledWith('album-aaaaaaaaaaaa', { title: 'Late night' }));
    await waitFor(() => expect(label()).toBe('Late night'));
    expect(screen.getByRole('button', { name: 'Cassette: Late night' })).toBeTruthy();
    await waitFor(() => expect(lockScreenTitle()).toBe('Late night cassette'));
  });

  it('does not call the server when the title has not changed', async () => {
    vi.useRealTimers();
    render(<Harness cassettes={[{ ...tape(), title: 'Same' }]} />);
    fireEvent.click(spine('Cassette: Same'));
    open();
    fireEvent.blur(title());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(update).not.toHaveBeenCalled();
  });

  it('a blank title, or the reset link, goes back to the album name', async () => {
    vi.useRealTimers();
    render(<Harness cassettes={[{ ...tape(), title: 'Mine' }]} />);
    fireEvent.click(spine('Cassette: Mine'));
    open();
    fireEvent.change(title(), { target: { value: '   ' } });
    fireEvent.blur(title());
    await waitFor(() => expect(update).toHaveBeenCalledWith('album-aaaaaaaaaaaa', { title: null }));
    await waitFor(() => expect(label()).toBe('Public Album'));

    cleanup();
    update.mockClear();
    render(<Harness cassettes={[{ ...tape(), title: 'Mine' }]} />);
    fireEvent.click(spine('Cassette: Mine'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Use “Public Album”' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('album-aaaaaaaaaaaa', { title: null }));
  });

  it('limits the title length in the box', () => {
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    open();
    expect(title().maxLength).toBe(40);
  });

  it('offers every style, marks the current one, and switches at once', async () => {
    vi.useRealTimers();
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    open();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.querySelector(':scope > span')?.textContent)).toEqual(['Generated', 'Album art', 'Executive', 'Clear']);
    expect(screen.getByRole('radio', { name: /Generated/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Clear/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('album-aaaaaaaaaaaa', { style: 'clear' }));
    await waitFor(() => expect(document.querySelector('.deck-bay .cassette-clear')).not.toBeNull());
    expect(screen.getByRole('radio', { name: /Clear/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Executive/ }));
    await waitFor(() => expect(document.querySelector('.deck-bay .cassette-executive')).not.toBeNull());
  });

  it('shows each style on a little preview of this very tape', () => {
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    open();
    const previews = [...document.querySelectorAll('.style-option .cassette')].map((c) => c.className.split(' ').find((n) => n.startsWith('cassette-')));
    expect(previews).toEqual(['cassette-generated', 'cassette-cover', 'cassette-executive', 'cassette-clear']);
    expect([...document.querySelectorAll('.style-option .cassette-label')].every((l) => l.textContent === 'Public Album')).toBe(true);
  });

  it('reports a failed save and puts the title back', async () => {
    vi.useRealTimers();
    update.mockRejectedValue(new Error('Could not save the cassette (500)'));
    render(<Harness cassettes={[{ ...tape(), title: 'Original' }]} />);
    fireEvent.click(spine('Cassette: Original'));
    open();
    fireEvent.change(title(), { target: { value: 'Broken' } });
    fireEvent.blur(title());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save the cassette'));
    expect(title().value).toBe('Original');
    expect(label()).toBe('Original');
  });

  it('Done saves a pending title and closes the panel', async () => {
    vi.useRealTimers();
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(spine());
    open();
    fireEvent.change(title(), { target: { value: 'Quick' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('album-aaaaaaaaaaaa', { title: 'Quick' }));
    expect(screen.queryByLabelText('Title')).toBeNull();
  });
});
