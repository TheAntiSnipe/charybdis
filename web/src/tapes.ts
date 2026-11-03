import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createCassette, fetchCassettes, saveCassetteSettings } from './api';
import { useJournal } from './journalSave';
import type { Album, Cassette, CassetteStyle, JournalEntry } from './types';

export const MAX_CASSETTE_TRACKS = 2000; // mirrors api/cassettes.py
export const MAX_TITLE = 40; // mirrors api/cassettes.py

export const CASSETTE_STYLES: { id: CassetteStyle; name: string }[] = [
  { id: 'generated', name: 'Generated' },
  { id: 'cover', name: 'Album art' },
  { id: 'executive', name: 'Executive' },
  { id: 'clear', name: 'Clear' },
];

/** What the tape is called: the user's own name for it, else the album or artist. */
export function displayTitle(tape: Pick<Cassette, 'title' | 'label'>): string {
  return tape.title?.trim() || tape.label;
}

export function styleOf(tape: Pick<Cassette, 'style'>): CassetteStyle {
  return tape.style ?? 'generated';
}

/** The length printed on a blank tape: the smallest standard length the music fits on. */
export function tapeLengthLabel(totalSec: number): string {
  const minutes = Math.ceil(totalSec / 60);
  const standard = [46, 60, 90, 120].find((m) => minutes <= m);
  return `C-${standard ?? 180}`;
}

export interface ArtistGroup {
  name: string;
  albumCount: number;
  trackCount: number;
}

/** Artists as the server groups them for an artist cassette: by the album artist. */
export function artistGroups(albums: Album[]): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();
  for (const album of albums) {
    if (!album.artist) continue;
    const group = groups.get(album.artist) ?? { name: album.artist, albumCount: 0, trackCount: 0 };
    group.albumCount += 1;
    group.trackCount += album.trackIds.length;
    groups.set(album.artist, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findTape(cassettes: Cassette[], kind: 'album' | 'artist', sourceId: string): Cassette | undefined {
  return cassettes.find((c) => c.kind === kind && c.sourceId === sourceId);
}

const SHELLS = ['#e8e1cf', '#c9362f', '#2b5fb4', '#2a2a33', '#e2b32d', '#2f8f6b', '#8a4fc0'];

function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h;
}

export interface GeneratedCover {
  from: string;
  to: string;
  disc: string;
  discX: number;
  discR: number;
  ringR: number;
  band: number; // degrees
}

/** A colourful abstract cover that is the same every time for the same tape. */
export function generatedCover(seed: string): GeneratedCover {
  const h = hash(seed);
  const hue = h % 360;
  const other = (hue + 40 + ((h >>> 8) % 90)) % 360;
  return {
    from: `hsl(${hue} 72% 40%)`,
    to: `hsl(${other} 70% 20%)`,
    disc: `hsl(${(hue + 25) % 360} 90% 72%)`,
    discX: 38 + ((h >>> 12) % 30),
    discR: 24 + ((h >>> 16) % 14),
    ringR: 9 + ((h >>> 20) % 8),
    band: -20 + ((h >>> 24) % 40),
  };
}

/** Stable look for a cassette's spine, so a tape never changes colour or size between visits. */
export function spineLook(tape: Cassette) {
  const h = hash(tape.id);
  return {
    shell: SHELLS[h % SHELLS.length],
    height: 168 + (h >>> 3) % 42,
    width: Math.min(68, 48 + Math.floor(tape.trackIds.length / 6)),
    tilt: ((h >>> 9) % 5) - 2, // degrees
  };
}

const PAPER_RATIO = 0.88; // share of the spine's inner width the label paper covers (keep in sync with .spine-paper)
const LABEL_LENGTH_RATIO = 0.66; // share of the spine's height a line of lettering may use (keep in sync with .spine-title)
const AVG_GLYPH = 0.6; // marker glyph width in em, with a margin for wide letters and word wrapping
const LINE_HEIGHT = 1.05;

/**
 * Picks the biggest marker size at which a name fits on two lines (three at the smallest sizes) of the
 * label, the way a person would squeeze a long name onto a spine instead of cutting it off.
 */
export function labelLayout(text: string, look: { width: number; height: number }): { fontSize: number; lines: number } {
  const length = text.trim().length;
  const lineLength = look.height * LABEL_LENGTH_RATIO;
  const paperWidth = (look.width - 6) * PAPER_RATIO;
  for (let fontSize = 22; fontSize >= 9; fontSize--) {
    const lines = Math.max(1, Math.ceil((length * AVG_GLYPH * fontSize * 1.2) / lineLength));
    const maxLines = fontSize <= 10 ? 3 : 2;
    if (lines <= maxLines && lines * LINE_HEIGHT * fontSize <= paperWidth) return { fontSize, lines };
  }
  return { fontSize: 9, lines: 3 };
}

export function useTapes() {
  const [cassettes, setCassettes] = useState<Cassette[]>([]);
  const cassettesRef = useRef(cassettes);
  cassettesRef.current = cassettes;
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const journal = useJournal(setEntries, setCassettes);
  const { overlay } = journal;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  // Saved places move faster than state updates; this is what a re-loaded tape resumes from.
  const progress = useRef(new Map<string, Cassette['progress']>());

  const load = useCallback(async () => {
    try {
      const data = await fetchCassettes();
      setCassettes(data.cassettes);
      setEntries(overlay(data.entries));
      setStatus('ready');
      setError('');
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }, [overlay]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async (kind: 'album' | 'artist', sourceId: string): Promise<Cassette> => {
    try {
      const tape = await createCassette(kind, sourceId);
      setCassettes((current) => [...current.filter((c) => c.id !== tape.id), tape]);
      return tape;
    } catch (err) {
      // Another device may have made it first; refresh so it shows up here too.
      if (err instanceof ApiError && err.status === 409) await load();
      throw err;
    }
  }, [load]);

  const recordProgress = useCallback((id: string, index: number, positionSec: number) => {
    progress.current.set(id, { index, positionSec });
  }, []);

  // Applies at once and rolls back if the server refuses, so editing never feels laggy.
  const update = useCallback(async (id: string, patch: { title?: string | null; style?: CassetteStyle }) => {
    const apply = (c: Cassette): Cassette => {
      const next = { ...c };
      if ('title' in patch) {
        const title = (patch.title ?? '').trim();
        if (title) next.title = title;
        else delete next.title;
      }
      if (patch.style) next.style = patch.style;
      return next;
    };
    const before = cassettesRef.current.find((c) => c.id === id);
    setCassettes((current) => current.map((c) => (c.id === id ? apply(c) : c)));
    try {
      const saved = await saveCassetteSettings(id, patch);
      setCassettes((current) => current.map((c) => (c.id === id ? { ...c, ...saved } : c)));
    } catch (err) {
      if (before) setCassettes((current) => current.map((c) => (c.id === id ? before : c)));
      throw err;
    }
  }, []);

  const progressOf = useCallback(
    (tape: Cassette) => progress.current.get(tape.id) ?? tape.progress,
    [],
  );

  return {
    cassettes, entries, status, error, create, update, reload: load, recordProgress, progressOf,
    editEntry: journal.edit, flushEntries: journal.flush, entryStates: journal.slots, journalSync: journal.sync,
  };
}

export type TapeStore = ReturnType<typeof useTapes>;

export interface JournalPage {
  albumId: string;
  start: number; // first slot on the page
  count: number;
}

/** Slots run on across the whole tape; each album's page takes the next run of them. */
export function journalPages(tape: Pick<Cassette, 'pages' | 'trackIds'>): JournalPage[] {
  const pages: JournalPage[] = [];
  let start = 0;
  for (const p of tape.pages) {
    pages.push({ albumId: p.albumId, start, count: p.count });
    start += p.count;
  }
  return pages;
}
