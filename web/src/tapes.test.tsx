import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import PlayerBar from './PlayerBar';
import { PlayerProvider } from './player';
import TapeDeck from './TapeDeck';
import { artistGroups, displayTitle, findTape, generatedCover, labelLayout, spineLook, styleOf, tapeLengthLabel, useTapes } from './tapes';
import type { Album, Cassette, Library, Track } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchCassettes: vi.fn(),
  createCassette: vi.fn(),
  saveTapeProgress: vi.fn(),
  saveCassetteSettings: vi.fn(),
}));

const album = (id: string, title: string, artist: string, trackIds: string[], year = '2000'): Album => ({
  id, title, artist, year, trackIds, artKey: null,
});

const tape = (overrides: Partial<Cassette> = {}): Cassette => ({
  id: 'album-aaaaaaaaaaaa', kind: 'album', sourceId: 'aaaaaaaaaaaa', label: 'Public Album', trackIds: ['t1', 't2'],
  pages: [{ albumId: 'aaaaaaaaaaaa', count: 2 }], progress: { index: 0, positionSec: 0 }, status: 'shelf', createdAt: 1, ...overrides,
});

describe('artistGroups', () => {
  it('groups by album artist with counts, sorted by name', () => {
    const groups = artistGroups([
      album('1', 'A', 'Zed', ['a', 'b']),
      album('2', 'B', 'Abe', ['c']),
      album('3', 'C', 'Zed', ['d']),
      album('4', 'D', '', ['e']),
    ]);
    expect(groups).toEqual([
      { name: 'Abe', albumCount: 1, trackCount: 1 },
      { name: 'Zed', albumCount: 2, trackCount: 3 },
    ]);
  });
});

describe('spineLook', () => {
  it('is stable per tape and stays in range', () => {
    const a = spineLook(tape());
    expect(spineLook(tape())).toEqual(a);
    expect(a.height).toBeGreaterThanOrEqual(168);
    expect(a.height).toBeLessThan(210);
    expect(Math.abs(a.tilt)).toBeLessThanOrEqual(2);
    for (let i = 0; i < 200; i++) {
      const look = spineLook(tape({ id: `artist-${i}`, trackIds: Array(i * 7).fill('x') }));
      expect(look.width).toBeLessThanOrEqual(68);
      expect(look.width).toBeGreaterThanOrEqual(48);
      expect(look.height).toBeGreaterThanOrEqual(168);
    }
  });
});

describe('labelLayout', () => {
  const narrow = { width: 48, height: 168 };
  const wide = { width: 68, height: 209 };

  it('writes short names big and long names smaller, never bigger as names grow', () => {
    expect(labelLayout('Breach', narrow).fontSize).toBeGreaterThanOrEqual(20);
    expect(labelLayout('twenty one pilots', narrow).fontSize).toBeLessThan(labelLayout('Breach', narrow).fontSize);
    expect(labelLayout('The Mighty Mighty Bosstones', narrow).fontSize).toBeLessThanOrEqual(labelLayout('twenty one pilots', narrow).fontSize);
    for (const look of [narrow, wide]) {
      let last = Infinity;
      for (let n = 1; n < 70; n++) {
        const { fontSize } = labelLayout('x'.repeat(n), look);
        expect(fontSize).toBeLessThanOrEqual(last);
        last = fontSize;
      }
    }
  });

  it('keeps every line of lettering inside the label paper', () => {
    for (const look of [narrow, wide]) {
      const paperWidth = (look.width - 6) * 0.88;
      for (const name of ['A', 'Breach', 'OK Computer', 'twenty one pilots', 'The Mighty Mighty Bosstones', 'x'.repeat(45)]) {
        const { fontSize, lines } = labelLayout(name, look);
        expect(lines * 1.05 * fontSize).toBeLessThanOrEqual(paperWidth + 0.5);
        expect(lines).toBeLessThanOrEqual(3);
      }
    }
  });

  it('allows a second line for names that do not fit on one', () => {
    expect(labelLayout('twenty one pilots', narrow).lines).toBe(2);
  });
});

describe('titles, styles and covers', () => {
  it('shows the custom title when there is one, else the album or artist', () => {
    expect(displayTitle({ label: 'Breach' })).toBe('Breach');
    expect(displayTitle({ label: 'Breach', title: 'Road trip' })).toBe('Road trip');
    expect(displayTitle({ label: 'Breach', title: '   ' })).toBe('Breach');
  });

  it('defaults to the generated cover', () => {
    expect(styleOf({})).toBe('generated');
    expect(styleOf({ style: 'clear' })).toBe('clear');
  });

  it('labels a tape with the smallest standard length it fits on', () => {
    expect(tapeLengthLabel(10 * 60)).toBe('C-46');
    expect(tapeLengthLabel(46 * 60)).toBe('C-46');
    expect(tapeLengthLabel(46 * 60 + 1)).toBe('C-60');
    expect(tapeLengthLabel(75 * 60)).toBe('C-90');
    expect(tapeLengthLabel(119 * 60)).toBe('C-120');
    expect(tapeLengthLabel(5 * 3600)).toBe('C-180');
  });

  it('generates the same cover for the same tape and different ones for different tapes', () => {
    expect(generatedCover('album-aaaaaaaaaaaa')).toEqual(generatedCover('album-aaaaaaaaaaaa'));
    const looks = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => generatedCover(`album-${k.repeat(12)}`).from));
    expect(looks.size).toBeGreaterThan(3);
    const g = generatedCover('x');
    expect(g.discX).toBeGreaterThanOrEqual(38);
    expect(g.discX).toBeLessThan(68);
  });
});

describe('useTapes.update', () => {
  beforeEach(() => {
    vi.mocked(api.fetchCassettes).mockResolvedValue({ cassettes: [tape()], entries: [] });
  });
  afterEach(() => vi.resetAllMocks());

  async function ready() {
    const hook = renderHook(() => useTapes());
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    return hook;
  }

  it('applies a new title and style immediately, then keeps what the server returns', async () => {
    let finish!: (c: Cassette) => void;
    vi.mocked(api.saveCassetteSettings).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = await ready();
    let done!: Promise<void>;
    act(() => { done = result.current.update('album-aaaaaaaaaaaa', { title: '  Road trip ', style: 'clear' }); });
    expect(result.current.cassettes[0].title).toBe('Road trip');
    expect(result.current.cassettes[0].style).toBe('clear');
    await act(async () => { finish({ ...tape(), title: 'Road trip', style: 'clear' }); await done; });
    expect(api.saveCassetteSettings).toHaveBeenCalledWith('album-aaaaaaaaaaaa', { title: '  Road trip ', style: 'clear' });
    expect(result.current.cassettes[0]).toMatchObject({ title: 'Road trip', style: 'clear' });
  });

  it('clears the title when given null or blank text', async () => {
    vi.mocked(api.fetchCassettes).mockResolvedValue({ cassettes: [tape({ title: 'Old' })], entries: [] });
    vi.mocked(api.saveCassetteSettings).mockImplementation(async () => tape());
    const { result } = await ready();
    await act(async () => { await result.current.update('album-aaaaaaaaaaaa', { title: null }); });
    expect(result.current.cassettes[0].title).toBeUndefined();
  });

  it('rolls back and reports when the server refuses', async () => {
    vi.mocked(api.fetchCassettes).mockResolvedValue({ cassettes: [tape({ title: 'Keep me', style: 'cover' })], entries: [] });
    vi.mocked(api.saveCassetteSettings).mockRejectedValue(new Error('nope'));
    const { result } = await ready();
    await act(async () => { await expect(result.current.update('album-aaaaaaaaaaaa', { title: 'Lost', style: 'clear' })).rejects.toThrow('nope'); });
    expect(result.current.cassettes[0]).toMatchObject({ title: 'Keep me', style: 'cover' });
  });
});

describe('findTape', () => {
  it('matches by kind and source', () => {
    const t = tape();
    expect(findTape([t], 'album', 'aaaaaaaaaaaa')).toBe(t);
    expect(findTape([t], 'artist', 'aaaaaaaaaaaa')).toBeUndefined();
  });
});

describe('useTapes', () => {
  beforeEach(() => {
    vi.mocked(api.fetchCassettes).mockResolvedValue({ cassettes: [tape()], entries: [] });
  });
  afterEach(() => vi.resetAllMocks());

  it('loads cassettes on mount', async () => {
    const { result } = renderHook(() => useTapes());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.cassettes).toHaveLength(1);
  });

  it('reports a load failure', async () => {
    vi.mocked(api.fetchCassettes).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('nope');
  });

  it('adds a newly made cassette', async () => {
    const made = tape({ id: 'artist-bbbbbbbbbbbbbbbb', kind: 'artist', sourceId: 'Band', label: 'Band' });
    vi.mocked(api.createCassette).mockResolvedValue(made);
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await result.current.create('artist', 'Band'); });
    expect(result.current.cassettes.map((c) => c.id)).toEqual(['album-aaaaaaaaaaaa', 'artist-bbbbbbbbbbbbbbbb']);
  });

  it('refreshes when another device already made it (409)', async () => {
    vi.mocked(api.createCassette).mockRejectedValue(new api.ApiError('exists', 409));
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    vi.mocked(api.fetchCassettes).mockClear();
    await act(async () => { await expect(result.current.create('album', 'x')).rejects.toThrow('exists'); });
    expect(api.fetchCassettes).toHaveBeenCalledTimes(1);
  });

  it('resumes from the freshest saved place, not the stale server copy', async () => {
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const t = result.current.cassettes[0];
    expect(result.current.progressOf(t)).toEqual({ index: 0, positionSec: 0 });
    act(() => result.current.recordProgress(t.id, 1, 55));
    expect(result.current.progressOf(t)).toEqual({ index: 1, positionSec: 55 });
  });
});

describe('Tape deck screen', () => {
  const track = (n: number): Track => ({
    id: `t${n}`, title: `Secret Song ${n}`, artist: 'Public Artist', album: 'Public Album', albumId: 'aaaaaaaaaaaa',
    albumArtist: 'Public Artist', trackNo: n, discNo: 1, year: '2000', genre: '', durationSec: 180, codec: 'aac',
    bitrate: 0, sampleRate: 0, bitDepth: 0, ext: '.m4a', key: `music/t${n}.m4a`,
  });
  const tracks = [track(1), track(2)];
  const library: Library = {
    tracks, playlists: [],
    albums: [album('aaaaaaaaaaaa', 'Public Album', 'Public Artist', ['t1', 't2'])],
  };
  const resolve = (ids: string[]) => ids.map((id) => tracks.find((t) => t.id === id)).filter((t): t is Track => !!t);

  function Harness({ cassettes }: { cassettes: Cassette[] }) {
    const store = {
      cassettes, entries: [], status: 'ready' as const, error: '', create: vi.fn(), update: vi.fn(), reload: vi.fn(),
      recordProgress: vi.fn(), progressOf: (t: Cassette) => t.progress,
      editEntry: vi.fn(), flushEntries: vi.fn(), entryStates: {}, journalSync: 'saved' as const,
    };
    return (
      <PlayerProvider artFor={() => null}>
        <TapeDeck library={library} tapes={store} resolve={resolve} />
        <PlayerBar artFor={() => null} hideTapeBar />
      </PlayerProvider>
    );
  }

  class FakeAudio extends EventTarget {
    src = ''; paused = true; ended = false; currentTime = 0; duration = 100; preload = '';
    play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    load() {}
    removeAttribute() { this.src = ''; }
  }

  beforeEach(() => {
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('MediaMetadata', class { constructor(public init: unknown) {} });
    Object.defineProperty(navigator, 'mediaSession', {
      value: { setActionHandler: vi.fn(), setPositionState: vi.fn(), metadata: null, playbackState: 'none' },
      configurable: true,
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows an empty-shelf hint', () => {
    render(<Harness cassettes={[]} />);
    expect(screen.getByText(/shelf is empty/i)).toBeTruthy();
  });

  it('puts unfinished and finished tapes on separate shelves', () => {
    render(<Harness cassettes={[tape(), tape({ id: 'album-bbbbbbbbbbbb', sourceId: 'bbbbbbbbbbbb', status: 'finished' })]} />);
    expect(screen.getByText('To listen')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Cassette: /i })).toHaveLength(2);
  });

  it('loads a tape on tap and never renders a song title', () => {
    render(<Harness cassettes={[tape()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Cassette: Public Album/ }));
    expect(screen.getByRole('status').textContent).toContain('Public Album cassette loaded. Song 1 of 2.');
    expect(screen.getByRole('button', { name: 'Eject tape' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /next|previous/i })).toBeNull();
    expect(document.body.textContent).not.toContain('Secret Song');
  });

  it('writes only the album title on an album cassette, and the name on an artist mixtape', () => {
    render(<Harness cassettes={[
      tape(),
      tape({ id: 'artist-bbbbbbbbbbbbbbbb', kind: 'artist', sourceId: 'Public Artist', label: 'Public Artist' }),
    ]} />);
    const labels = [...document.querySelectorAll('.spine-title')].map((n) => n.textContent);
    expect(labels).toEqual(['Public Album', 'Public Artist']);
    // The album cassette must not carry the artist name at all.
    const albumSpine = screen.getByRole('button', { name: 'Cassette: Public Album' });
    expect(albumSpine.textContent).toBe('Public Album');
  });

  it('refuses a tape whose songs are missing from the library', () => {
    render(<Harness cassettes={[tape({ trackIds: ['t1', 'gone'] })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Cassette: Public Album/ }));
    expect(screen.getByText(/no longer in the library/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Eject tape' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
