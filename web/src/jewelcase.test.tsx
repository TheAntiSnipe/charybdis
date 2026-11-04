import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeroStore } from './heroes';
import LibraryView from './Library';
import { PlayerProvider } from './player';
import type { TapeStore } from './tapes';
import type { Cassette, JournalEntry, Library, Track } from './types';

class FakeAudio extends EventTarget {
  src = ''; paused = true; ended = false; currentTime = 0; duration = 100; preload = ''; volume = 1;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute() { this.src = ''; }
}

const track = (n: number): Track => ({
  id: `t${n}`, title: `Song ${n}`, artist: 'The Band', album: 'First Album', albumId: 'aaaaaaaaaaaa', albumArtist: 'The Band',
  trackNo: n, discNo: 1, year: '2001', genre: '', durationSec: 180, codec: 'aac', bitrate: 0, sampleRate: 0, bitDepth: 0, ext: '.m4a', key: `music/t${n}.m4a`,
});
const library: Library = {
  tracks: [track(1), track(2), track(3)],
  playlists: [],
  albums: [{ id: 'aaaaaaaaaaaa', title: 'First Album', artist: 'The Band', year: '2001', trackIds: ['t1', 't2', 't3'], artKey: null }],
};

function stores(over: { cassettes?: Cassette[]; entries?: JournalEntry[]; heroes?: Record<string, string> } = {}) {
  const toggle = vi.fn();
  const tapes = {
    cassettes: over.cassettes ?? [], entries: over.entries ?? [], status: 'ready', error: '', create: vi.fn(), reload: vi.fn(),
  } as unknown as TapeStore;
  const heroes = { heroes: over.heroes ?? {}, reviews: {}, toggle, error: '' } as HeroStore;
  return { tapes, heroes, toggle };
}

function show(over: Parameters<typeof stores>[0] = {}) {
  const s = stores(over);
  render(
    <PlayerProvider artFor={() => null}>
      <LibraryView library={library} artFor={() => null} tapes={s.tapes} heroes={s.heroes} />
    </PlayerProvider>,
  );
  return s;
}

// The case only opens flat in landscape with room to spare; motion is reduced so the open and close are instant.
function screenIs(flat: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') || (flat && query.includes('orientation: landscape')),
    addEventListener() {}, removeEventListener() {},
  }));
}

const dialog = () => screen.queryByRole('dialog');

beforeEach(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('MediaMetadata', class { constructor(public init: unknown) {} });
  vi.stubGlobal('scrollTo', vi.fn());
  Object.defineProperty(navigator, 'mediaSession', {
    value: { setActionHandler: vi.fn(), setPositionState: vi.fn(), metadata: null, playbackState: 'none' },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('album cases on the shelf', () => {
  it('shows each album as a jewel case with a title and a sticker', () => {
    screenIs(true);
    show();
    const card = screen.getByRole('button', { name: /First Album/ });
    expect(card.querySelector('.jc-front')).toBeTruthy();
    expect(card.querySelector('.jc-st')).toBeTruthy();
    expect(card.querySelector('.jc-hero')).toBeNull();
  });

  it('puts the hero song on the case as a magazine review', () => {
    screenIs(true);
    show({ heroes: { aaaaaaaaaaaa: 't2' } });
    const hero = screen.getByRole('button', { name: /First Album/ }).querySelector('.jc-hero');
    expect(hero?.querySelector('.jc-hero-title')?.textContent).toBe('Song 2');
    expect(hero?.querySelector('.jc-hero-quote')?.textContent).toMatch(/^“Song 2 .+”$/);
    expect(hero?.querySelector('.jc-hero-stars')?.textContent).toBe('★★★★★');
    expect(hero?.querySelector('.jc-hero-source')?.textContent).toBeTruthy();
  });
});

describe('opening a case', () => {
  it('opens flat in landscape: the disc lists the tracks, and tapping one plays it', () => {
    screenIs(true);
    show();
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    const open = within(dialog()!);
    expect(open.getByRole('list', { name: 'Tracks' }).querySelectorAll('li')).toHaveLength(3);
    fireEvent.click(open.getByTitle('Song 2'));
    expect(dialog()).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'First Album' })).toBeNull();
  });

  it('opens the album page instead when there is no room (portrait, phones)', () => {
    screenIs(false);
    show();
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    expect(dialog()).toBeNull();
    expect(screen.getByRole('heading', { name: 'First Album' })).toBeTruthy();
  });

  it('closes with Escape or the close button', () => {
    screenIs(true);
    show();
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close case' }));
    expect(dialog()).toBeNull();
  });

  it('shows no notes at all when the album has no tape', () => {
    screenIs(true);
    show();
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    expect(screen.queryByRole('list', { name: 'Tape deck notes' })).toBeNull();
  });

  it('shows the tape deck notes beside the pinned art, blind until the tape is finished', () => {
    screenIs(true);
    const tape: Cassette = {
      id: 'album-aaaaaaaaaaaa', kind: 'album', sourceId: 'aaaaaaaaaaaa', label: 'First Album', trackIds: ['t3', 't1', 't2'], pages: [],
      progress: { index: 0, positionSec: 0 }, status: 'shelf', createdAt: 1,
    };
    const entries: JournalEntry[] = [{ cassetteId: tape.id, slot: 0, text: 'huge drums', updatedAt: 1 }];
    show({ cassettes: [tape], entries });
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    const notes = screen.getByRole('list', { name: 'Tape deck notes' });
    expect(notes.textContent).toContain('huge drums');
    expect(notes.textContent).not.toContain('Song 3');
  });

  it('shows the song titles in the notes once the tape is finished', () => {
    screenIs(true);
    const tape: Cassette = {
      id: 'album-aaaaaaaaaaaa', kind: 'album', sourceId: 'aaaaaaaaaaaa', label: 'First Album', trackIds: ['t3', 't1', 't2'], pages: [],
      progress: { index: 0, positionSec: 0 }, status: 'finished', createdAt: 1,
    };
    show({ cassettes: [tape], entries: [{ cassetteId: tape.id, slot: 0, text: 'huge drums', updatedAt: 1 }] });
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    expect(screen.getByRole('list', { name: 'Tape deck notes' }).textContent).toContain('Song 3. huge drums');
  });
});

describe('picking the hero song', () => {
  it('stars a song on the disc', () => {
    screenIs(true);
    const { toggle } = show();
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Make “Song 2” the hero song' }));
    expect(toggle).toHaveBeenCalledWith('aaaaaaaaaaaa', 't2');
  });

  it('marks the current hero, and its star takes the sticker off', () => {
    screenIs(true);
    const { toggle } = show({ heroes: { aaaaaaaaaaaa: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    const star = within(dialog()!).getByRole('button', { name: 'Remove hero song: Song 1' });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(star);
    expect(toggle).toHaveBeenCalledWith('aaaaaaaaaaaa', 't1');
  });

  it('can be picked from the album page where cases do not open', () => {
    screenIs(false);
    const { toggle } = show();
    fireEvent.click(screen.getByRole('button', { name: /First Album/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Make “Song 3” the hero song' }));
    expect(toggle).toHaveBeenCalledWith('aaaaaaaaaaaa', 't3');
  });
});
