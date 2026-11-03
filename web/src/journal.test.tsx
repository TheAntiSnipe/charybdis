import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { DRAFTS_KEY, RETRY_MS, SAVE_DELAY_MS } from './journalSave';
import PlayerBar from './PlayerBar';
import { PlayerProvider } from './player';
import TapeDeck from './TapeDeck';
import { journalPages, useTapes } from './tapes';
import type { Album, Cassette, JournalEntry, Library, Track } from './types';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchCassettes: vi.fn(),
  saveJournalEntry: vi.fn(),
  saveTapeProgress: vi.fn(),
  deleteCassette: vi.fn(),
}));

const ID = 'album-aaaaaaaaaaaa';
const tape = (overrides: Partial<Cassette> = {}): Cassette => ({
  id: ID, kind: 'album', sourceId: 'aaaaaaaaaaaa', label: 'Public Album', trackIds: ['t1', 't2'],
  pages: [{ albumId: 'aaaaaaaaaaaa', count: 2 }], progress: { index: 0, positionSec: 0 }, status: 'shelf', createdAt: 1, ...overrides,
});
const saved = (slot: number, text: string, status: 'shelf' | 'finished' = 'shelf'): api.SavedEntry => ({
  cassetteId: ID, slot, text, updatedAt: 5, status, ...(status === 'finished' ? { finishedAt: 9 } : {}),
});

describe('journalPages', () => {
  it('numbers slots on across pages', () => {
    const pages = journalPages({ trackIds: [], pages: [{ albumId: 'a', count: 3 }, { albumId: 'b', count: 2 }] });
    expect(pages).toEqual([{ albumId: 'a', start: 0, count: 3 }, { albumId: 'b', start: 3, count: 2 }]);
  });
});

describe('journal autosave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.fetchCassettes).mockResolvedValue({ cassettes: [tape()], entries: [] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.resetAllMocks();
    localStorage.clear();
  });

  async function ready() {
    const hook = renderHook(() => useTapes());
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    vi.useFakeTimers();
    return hook;
  }
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('shows a note at once and saves it once typing pauses', async () => {
    vi.mocked(api.saveJournalEntry).mockResolvedValue(saved(0, 'hello'));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'h'));
    act(() => result.current.editEntry(ID, 0, 'hello'));
    expect(result.current.entries).toEqual([expect.objectContaining({ slot: 0, text: 'hello' })]);
    expect(result.current.journalSync).toBe('saving');
    expect(api.saveJournalEntry).not.toHaveBeenCalled();
    await wait(SAVE_DELAY_MS);
    expect(api.saveJournalEntry).toHaveBeenCalledTimes(1);
    expect(api.saveJournalEntry).toHaveBeenCalledWith(ID, 0, 'hello', false);
    expect(result.current.journalSync).toBe('saved');
  });

  it('takes the finished state from the server when the last slot is written', async () => {
    vi.mocked(api.saveJournalEntry).mockResolvedValue(saved(1, 'last', 'finished'));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 1, 'last'));
    await wait(SAVE_DELAY_MS);
    expect(result.current.cassettes[0]).toMatchObject({ status: 'finished', finishedAt: 9 });
  });

  it('reopens a finished tape when a note is cleared', async () => {
    vi.mocked(api.fetchCassettes).mockResolvedValue({
      cassettes: [tape({ status: 'finished', finishedAt: 9 })],
      entries: [{ cassetteId: ID, slot: 0, text: 'a', updatedAt: 1 }, { cassetteId: ID, slot: 1, text: 'b', updatedAt: 1 }],
    });
    vi.mocked(api.saveJournalEntry).mockResolvedValue(saved(1, '', 'shelf'));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 1, ''));
    expect(result.current.entries).toHaveLength(1);
    await wait(SAVE_DELAY_MS);
    expect(result.current.cassettes[0].status).toBe('shelf');
    expect(result.current.cassettes[0].finishedAt).toBeUndefined();
  });

  it('keeps the text and retries with a growing wait when the network fails', async () => {
    vi.mocked(api.saveJournalEntry)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new api.ApiError('busy', 503))
      .mockResolvedValue(saved(0, 'keep'));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'keep'));
    await wait(SAVE_DELAY_MS);
    expect(result.current.journalSync).toBe('retrying');
    expect(result.current.entries[0].text).toBe('keep');
    await wait(RETRY_MS[0] - 1);
    expect(api.saveJournalEntry).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(api.saveJournalEntry).toHaveBeenCalledTimes(2);
    expect(result.current.journalSync).toBe('retrying');
    await wait(RETRY_MS[1]);
    expect(api.saveJournalEntry).toHaveBeenCalledTimes(3);
    expect(result.current.journalSync).toBe('saved');
  });

  it('does not retry a note the server refused, and says so', async () => {
    vi.mocked(api.saveJournalEntry).mockRejectedValue(new api.ApiError('Entries are limited to 280 characters', 400));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'x'));
    await wait(SAVE_DELAY_MS);
    await wait(60_000);
    expect(api.saveJournalEntry).toHaveBeenCalledTimes(1);
    expect(result.current.journalSync).toBe('rejected');
    expect(result.current.entryStates[`${ID}#0`]).toMatchObject({ state: 'rejected', error: expect.stringContaining('280') });
    expect(result.current.entries[0].text).toBe('x');
  });

  it('sends one note at a time, in order', async () => {
    const releases: (() => void)[] = [];
    vi.mocked(api.saveJournalEntry).mockImplementation((_id, slot, text) => new Promise((resolve) => {
      releases.push(() => resolve(saved(slot, text)));
    }));
    const { result } = await ready();
    act(() => { result.current.editEntry(ID, 0, 'one'); result.current.editEntry(ID, 1, 'two'); });
    await wait(SAVE_DELAY_MS);
    expect(api.saveJournalEntry).toHaveBeenCalledTimes(1);
    await act(async () => releases[0]());
    expect(api.saveJournalEntry).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.saveJournalEntry).mock.calls.map((c) => c[1])).toEqual([0, 1]);
    await act(async () => releases[1]());
    expect(result.current.journalSync).toBe('saved');
  });

  it('sends the newest text when typing continues during a save', async () => {
    const releases: (() => void)[] = [];
    vi.mocked(api.saveJournalEntry).mockImplementation((_id, slot, text) => new Promise((resolve) => {
      releases.push(() => resolve(saved(slot, text)));
    }));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'a'));
    await wait(SAVE_DELAY_MS);
    act(() => result.current.editEntry(ID, 0, 'ab'));
    await act(async () => releases[0]());
    expect(result.current.journalSync).toBe('saving');
    await wait(SAVE_DELAY_MS);
    expect(vi.mocked(api.saveJournalEntry).mock.calls.map((c) => c[2])).toEqual(['a', 'ab']);
    await act(async () => releases[1]());
    expect(result.current.journalSync).toBe('saved');
  });

  it('sends unsaved notes immediately when flushed, as the page is hidden', async () => {
    vi.mocked(api.saveJournalEntry).mockResolvedValue(saved(0, 'bye'));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'bye'));
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(api.saveJournalEntry).toHaveBeenCalledWith(ID, 0, 'bye', true);
  });

  it('keeps unsaved notes when the shelf is reloaded', async () => {
    vi.mocked(api.saveJournalEntry).mockResolvedValue(saved(0, 'typed'));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'typed'));
    const stale: JournalEntry[] = [{ cassetteId: ID, slot: 0, text: 'old', updatedAt: 1 }, { cassetteId: ID, slot: 1, text: 'other', updatedAt: 1 }];
    vi.mocked(api.fetchCassettes).mockResolvedValue({ cassettes: [tape()], entries: stale });
    await act(async () => { await result.current.reload(); });
    expect(result.current.entries.find((e) => e.slot === 0)?.text).toBe('typed');
    expect(result.current.entries.find((e) => e.slot === 1)?.text).toBe('other');
  });
  it('keeps unsaved notes in storage until the server confirms them', async () => {
    let confirm!: () => void;
    vi.mocked(api.saveJournalEntry).mockImplementation(() => new Promise((resolve) => { confirm = () => resolve(saved(0, 'draft')); }));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'draft'));
    expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual([{ cassetteId: ID, slot: 0, text: 'draft' }]);
    await wait(SAVE_DELAY_MS);
    expect(localStorage.getItem(DRAFTS_KEY)).not.toBeNull();
    await act(async () => confirm());
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
  });

  it('also keeps a cleared note until the server has cleared it', async () => {
    vi.mocked(api.fetchCassettes).mockResolvedValue({ cassettes: [tape()], entries: [{ cassetteId: ID, slot: 0, text: 'old', updatedAt: 1 }] });
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, ''));
    expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual([{ cassetteId: ID, slot: 0, text: '' }]);
  });

  it('sends notes left over from an earlier visit and shows them', async () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify([{ cassetteId: ID, slot: 1, text: 'from last time' }]));
    let confirm!: () => void;
    vi.mocked(api.saveJournalEntry).mockImplementation(() => new Promise((resolve) => { confirm = () => resolve(saved(1, 'from last time')); }));
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(api.saveJournalEntry).toHaveBeenCalledWith(ID, 1, 'from last time', false));
    expect(result.current.entries).toEqual([expect.objectContaining({ slot: 1, text: 'from last time' })]);
    await act(async () => confirm());
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
  });

  it('survives the app closing while offline, then saves on the next launch', async () => {
    vi.mocked(api.saveJournalEntry).mockRejectedValue(new api.ApiError('offline', 0));
    const first = await ready();
    act(() => first.result.current.editEntry(ID, 0, 'written on a train'));
    await wait(SAVE_DELAY_MS);
    expect(first.result.current.journalSync).toBe('retrying');
    first.unmount();
    vi.useRealTimers();

    vi.mocked(api.saveJournalEntry).mockResolvedValue(saved(0, 'written on a train'));
    renderHook(() => useTapes());
    await waitFor(() => expect(api.saveJournalEntry).toHaveBeenLastCalledWith(ID, 0, 'written on a train', false));
    await waitFor(() => expect(localStorage.getItem(DRAFTS_KEY)).toBeNull());
  });

  it('does not keep a note the server refused', async () => {
    vi.mocked(api.saveJournalEntry).mockRejectedValue(new api.ApiError('no', 400));
    const { result } = await ready();
    act(() => result.current.editEntry(ID, 0, 'x'));
    await wait(SAVE_DELAY_MS);
    expect(result.current.journalSync).toBe('rejected');
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
  });

  it('ignores a damaged or foreign stored value', async () => {
    localStorage.setItem(DRAFTS_KEY, '{not json');
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    localStorage.setItem(DRAFTS_KEY, JSON.stringify([{ cassetteId: 5, slot: 'x' }, null, 'text']));
    renderHook(() => useTapes());
    await waitFor(() => expect(api.fetchCassettes).toHaveBeenCalledTimes(2));
    expect(api.saveJournalEntry).not.toHaveBeenCalled();
  });

  it('drops stored notes for a tape that no longer exists', async () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify([{ cassetteId: 'album-gone00000000', slot: 0, text: 'orphan' }]));
    vi.mocked(api.saveJournalEntry).mockRejectedValue(new api.ApiError('offline', 0));
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(localStorage.getItem(DRAFTS_KEY)).toBeNull());
    expect(result.current.entries).toEqual([]);
    expect(result.current.journalSync).toBe('saved');
  });

  it('retries a failed load when the connection comes back', async () => {
    vi.mocked(api.fetchCassettes).mockRejectedValueOnce(new api.ApiError('Can’t reach Charybdis.', 0));
    const { result } = renderHook(() => useTapes());
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.cassettes).toHaveLength(1);
  });

  describe('deleting a tape', () => {
    it('removes the tape, its notes and any unsaved draft once the server has done it', async () => {
      vi.mocked(api.fetchCassettes).mockResolvedValue({
        cassettes: [tape(), tape({ id: 'album-bbbbbbbbbbbb', sourceId: 'bbbbbbbbbbbb' })],
        entries: [{ cassetteId: ID, slot: 0, text: 'mine', updatedAt: 1 }, { cassetteId: 'album-bbbbbbbbbbbb', slot: 0, text: 'other', updatedAt: 1 }],
      });
      vi.mocked(api.deleteCassette).mockResolvedValue();
      const { result } = await ready();
      act(() => result.current.editEntry(ID, 1, 'unsaved'));
      await act(async () => { await result.current.remove(ID); });
      expect(api.deleteCassette).toHaveBeenCalledWith(ID);
      expect(result.current.cassettes.map((c) => c.id)).toEqual(['album-bbbbbbbbbbbb']);
      expect(result.current.entries.map((e) => e.text)).toEqual(['other']);
      expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
      await wait(SAVE_DELAY_MS);
      expect(api.saveJournalEntry).not.toHaveBeenCalled();
    });

    it('leaves everything alone when the server refuses', async () => {
      vi.mocked(api.deleteCassette).mockRejectedValue(new api.ApiError('Can’t reach Charybdis.', 0));
      const { result } = await ready();
      await act(async () => { await expect(result.current.remove(ID)).rejects.toThrow('Can’t reach'); });
      expect(result.current.cassettes).toHaveLength(1);
    });

    it('does not report the place of a tape that was just deleted', async () => {
      vi.mocked(api.deleteCassette).mockResolvedValue();
      vi.mocked(api.saveTapeProgress).mockResolvedValue();
      const { result } = await ready();
      await act(async () => { await result.current.remove(ID); });
      act(() => result.current.recordProgress(ID, 1, 20)); // what ejecting the tape does
      expect(api.saveTapeProgress).not.toHaveBeenCalled();
    });
  });

  it('saves the place on the tape, and keeps trying if that fails', async () => {
    vi.mocked(api.saveTapeProgress).mockRejectedValueOnce(new api.ApiError('offline', 0)).mockResolvedValue();
    const { result } = await ready();
    act(() => result.current.recordProgress(ID, 1, 30));
    await wait(0);
    expect(api.saveTapeProgress).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('online')); });
    await wait(0);
    expect(api.saveTapeProgress).toHaveBeenCalledTimes(2);
    expect(api.saveTapeProgress).toHaveBeenLastCalledWith(ID, 1, 30);
  });
});

describe('Journal screen', () => {
  const track = (n: number, albumId: string): Track => ({
    id: `t${n}`, title: `Secret Song ${n}`, artist: 'Public Artist', album: albumId === 'aaaaaaaaaaaa' ? 'Hidden Album One' : 'Hidden Album Two', albumId,
    albumArtist: 'Public Artist', trackNo: n, discNo: 1, year: '2000', genre: '', durationSec: 180, codec: 'aac',
    bitrate: 0, sampleRate: 0, bitDepth: 0, ext: '.m4a', key: `music/t${n}.m4a`,
  });
  const tracks = [track(1, 'aaaaaaaaaaaa'), track(2, 'aaaaaaaaaaaa'), track(3, 'bbbbbbbbbbbb')];
  const album = (id: string, title: string, trackIds: string[]): Album => ({ id, title, artist: 'Public Artist', year: '2000', trackIds, artKey: null });
  const library: Library = {
    tracks, playlists: [],
    albums: [album('aaaaaaaaaaaa', 'Hidden Album One', ['t1', 't2']), album('bbbbbbbbbbbb', 'Hidden Album Two', ['t3'])],
  };
  const resolve = (ids: string[]) => ids.map((id) => tracks.find((t) => t.id === id)).filter((t): t is Track => !!t);
  const mixtape = (overrides: Partial<Cassette> = {}): Cassette => tape({
    id: 'artist-bbbbbbbbbbbbbbbb', kind: 'artist', sourceId: 'Public Artist', label: 'Public Artist', trackIds: ['t1', 't2', 't3'],
    pages: [{ albumId: 'aaaaaaaaaaaa', count: 2 }, { albumId: 'bbbbbbbbbbbb', count: 1 }], ...overrides,
  });

  const editEntry = vi.fn();
  const flushEntries = vi.fn();
  const remove = vi.fn();
  function Harness({ cassettes, entries = [], sync = 'saved' }: { cassettes: Cassette[]; entries?: JournalEntry[]; sync?: 'saved' | 'saving' | 'retrying' | 'rejected' }) {
    const store = {
      cassettes, entries, status: 'ready' as const, error: '', create: vi.fn(), update: vi.fn(), remove, reload: vi.fn(),
      recordProgress: vi.fn(), progressOf: (t: Cassette) => t.progress,
      editEntry, flushEntries, entryStates: {}, journalSync: sync,
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
    vi.clearAllMocks();
  });

  const load = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
  const openJournal = () => fireEvent.click(screen.getByRole('button', { name: 'Journal' }));

  it('is closed until a tape is loaded', () => {
    render(<Harness cassettes={[mixtape()]} />);
    expect((screen.getByRole('button', { name: 'Journal' }) as HTMLButtonElement).disabled).toBe(true);
    load(/Mixtape: Public Artist/);
    expect((screen.getByRole('button', { name: 'Journal' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens as a sheet with one numbered, untitled line per song and no album names', () => {
    render(<Harness cassettes={[mixtape()]} />);
    load(/Mixtape: Public Artist/);
    openJournal();
    const sheet = screen.getByRole('dialog', { name: 'Journal' });
    expect(within(sheet).getByText('Page 1')).toBeTruthy();
    expect(within(sheet).getByText('0 of 3 songs written')).toBeTruthy();
    expect(within(sheet).getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Song 1 notes', 'Song 2 notes']);
    expect(document.body.textContent).not.toContain('Secret Song');
    expect(document.body.textContent).not.toContain('Hidden Album');
  });

  it('turns pages and numbers slots on across them', () => {
    render(<Harness cassettes={[mixtape()]} />);
    load(/Mixtape: Public Artist/);
    openJournal();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(screen.getAllByRole('textbox').map((t) => t.getAttribute('aria-label'))).toEqual(['Song 3 notes']);
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows what was written and passes edits to the store', () => {
    const entries: JournalEntry[] = [{ cassetteId: 'artist-bbbbbbbbbbbbbbbb', slot: 1, text: 'sad bass', updatedAt: 1 }];
    render(<Harness cassettes={[mixtape()]} entries={entries} />);
    load(/Mixtape: Public Artist/);
    openJournal();
    expect(screen.getByText('1 of 3 songs written')).toBeTruthy();
    expect((screen.getByLabelText('Song 2 notes') as HTMLTextAreaElement).value).toBe('sad bass');
    fireEvent.change(screen.getByLabelText('Song 1 notes'), { target: { value: 'opening' } });
    expect(editEntry).toHaveBeenCalledWith('artist-bbbbbbbbbbbbbbbb', 0, 'opening');
    fireEvent.blur(screen.getByLabelText('Song 1 notes'));
    expect(flushEntries).toHaveBeenCalled();
  });

  it('marks the song that is playing', () => {
    render(<Harness cassettes={[mixtape()]} />);
    load(/Mixtape: Public Artist/);
    openJournal();
    const rows = within(screen.getByRole('dialog', { name: 'Journal' })).getAllByRole('listitem');
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    expect(rows[1].getAttribute('aria-current')).toBeNull();
  });

  it('reveals the song and album titles once the tape is finished', () => {
    const entries: JournalEntry[] = [0, 1, 2].map((slot) => ({ cassetteId: 'artist-bbbbbbbbbbbbbbbb', slot, text: `note ${slot}`, updatedAt: 1 }));
    render(<Harness cassettes={[mixtape({ status: 'finished', finishedAt: 5 })]} entries={entries} />);
    load(/Mixtape: Public Artist, finished/);
    openJournal();
    const sheet = screen.getByRole('dialog', { name: 'Journal' });
    expect(within(sheet).getByText('Hidden Album One')).toBeTruthy();
    expect(within(sheet).getByText('Secret Song 1')).toBeTruthy();
    expect(within(sheet).getByText('Secret Song 2')).toBeTruthy();
    expect(within(sheet).getByText('Tape finished ★')).toBeTruthy();
    expect((within(sheet).getByLabelText('Song 1 notes') as HTMLTextAreaElement).value).toBe('note 0');
  });

  it('says when notes are waiting to be saved', () => {
    render(<Harness cassettes={[mixtape()]} sync="retrying" />);
    load(/Mixtape: Public Artist/);
    openJournal();
    expect(screen.getByText(/keep retrying/).getAttribute('role')).toBe('status');
  });

  it('closes with the close button', () => {
    render(<Harness cassettes={[mixtape()]} />);
    load(/Mixtape: Public Artist/);
    openJournal();
    fireEvent.click(screen.getByRole('button', { name: 'Close journal' }));
    expect(screen.queryByRole('dialog', { name: 'Journal' })).toBeNull();
  });

  describe('deleting from the customize panel', () => {
    const open = (entries: JournalEntry[] = []) => {
      render(<Harness cassettes={[mixtape()]} entries={entries} />);
      load(/Mixtape: Public Artist/);
      fireEvent.click(screen.getByRole('button', { name: 'Customize this cassette' }));
    };

    it('asks first, saying how many notes go with it, and can be called off', () => {
      const entries: JournalEntry[] = [0, 1].map((slot) => ({ cassetteId: 'artist-bbbbbbbbbbbbbbbb', slot, text: `n${slot}`, updatedAt: 1 }));
      open(entries);
      fireEvent.click(screen.getByRole('button', { name: /Delete this cassette/ }));
      const confirm = screen.getByRole('group', { name: 'Confirm delete' });
      expect(confirm.textContent).toContain('Delete “Public Artist” and its 2 notes?');
      expect(remove).not.toHaveBeenCalled();
      fireEvent.click(within(confirm).getByRole('button', { name: 'Keep it' }));
      expect(screen.queryByRole('group', { name: 'Confirm delete' })).toBeNull();
      expect(remove).not.toHaveBeenCalled();
    });

    it('does not mention notes when there are none', () => {
      open();
      fireEvent.click(screen.getByRole('button', { name: /Delete this cassette/ }));
      expect(screen.getByRole('group', { name: 'Confirm delete' }).textContent).not.toContain('note');
    });

    it('deletes, takes the tape out of the deck and says so', async () => {
      remove.mockResolvedValue(undefined);
      open();
      fireEvent.click(screen.getByRole('button', { name: /Delete this cassette/ }));
      fireEvent.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.getByText('Public Artist was taken off the shelf.')).toBeTruthy());
      expect(remove).toHaveBeenCalledWith('artist-bbbbbbbbbbbbbbbb');
      expect((screen.getByRole('button', { name: 'Eject tape' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('keeps the tape and explains when the delete fails', async () => {
      remove.mockRejectedValue(new Error('Can’t reach Charybdis. Check your connection and try again.'));
      open();
      fireEvent.click(screen.getByRole('button', { name: /Delete this cassette/ }));
      fireEvent.click(within(screen.getByRole('group', { name: 'Confirm delete' })).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Can’t reach Charybdis'));
      expect((screen.getByRole('button', { name: 'Eject tape' }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByRole('button', { name: /Delete this cassette/ })).toBeTruthy();
    });
  });

  it('says so when the device is offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      render(<Harness cassettes={[mixtape()]} />);
      expect(screen.getByText(/You’re offline/).getAttribute('role')).toBe('status');
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  });
});
