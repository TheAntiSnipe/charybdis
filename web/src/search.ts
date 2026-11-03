import type { Album, Library, Playlist, Track } from './types';

// Case- and accent-insensitive: "beyonce" finds "Beyoncé".
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

interface IndexedTrack { item: Track; title: string; artist: string; text: string }

export interface SearchIndex {
  tracks: IndexedTrack[];
  albums: { item: Album; text: string }[];
  playlists: { item: Playlist; text: string }[];
}

export interface SearchResults {
  tracks: Track[];
  totalTracks: number;
  albums: Album[];
  playlists: Playlist[];
}

export function buildIndex(library: Library): SearchIndex {
  return {
    tracks: library.tracks.map((t) => ({
      item: t,
      title: fold(t.title),
      artist: fold(t.artist),
      text: fold([t.title, t.artist, t.album, t.albumArtist, t.genre, t.year].join(' ')),
    })),
    albums: library.albums.map((a) => ({ item: a, text: fold(`${a.title} ${a.artist} ${a.year}`) })),
    playlists: library.playlists.map((p) => ({ item: p, text: fold(p.name) })),
  };
}

// Higher is better: a word-start match in the title beats a match buried in the album name.
function score(entry: IndexedTrack, tokens: string[]): number {
  let total = 0;
  for (const token of tokens) {
    if (entry.title.startsWith(token) || entry.title.includes(` ${token}`)) total += 4;
    else if (entry.title.includes(token)) total += 3;
    else if (entry.artist.includes(token)) total += 2;
    else total += 1;
  }
  return total;
}

export function search(index: SearchIndex, query: string, trackLimit = 200): SearchResults | null {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const matches = (text: string) => tokens.every((token) => text.includes(token));

  const tracks = index.tracks
    .filter((e) => matches(e.text))
    .map((e) => ({ e, s: score(e, tokens) }))
    .sort((a, b) => b.s - a.s || a.e.item.title.localeCompare(b.e.item.title));

  return {
    tracks: tracks.slice(0, trackLimit).map((x) => x.e.item),
    totalTracks: tracks.length,
    albums: index.albums.filter((e) => matches(e.text)).map((e) => e.item).sort((a, b) => a.title.localeCompare(b.title)),
    playlists: index.playlists.filter((e) => matches(e.text)).map((e) => e.item),
  };
}
