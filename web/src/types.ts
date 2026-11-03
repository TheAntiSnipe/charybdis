export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  albumArtist: string;
  trackNo: number;
  discNo: number;
  year: string;
  genre: string;
  durationSec: number;
  codec: 'alac' | 'aac' | 'mp3';
  bitrate: number;
  sampleRate: number;
  bitDepth: number;
  ext: string;
  key: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: string;
  trackIds: string[];
  artKey: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
}

export interface Library {
  tracks: Track[];
  albums: Album[];
  playlists: Playlist[];
}

export type CassetteStyle = 'generated' | 'cover' | 'executive' | 'clear';

export interface Cassette {
  id: string;
  kind: 'album' | 'artist';
  sourceId: string;
  label: string;
  title?: string; // the user's own name for the tape; falls back to label
  style?: CassetteStyle; // how the cassette looks in the deck; defaults to 'generated'
  trackIds: string[];
  pages: { albumId: string; count: number }[];
  progress: { index: number; positionSec: number };
  status: 'shelf' | 'finished';
  createdAt: number;
  finishedAt?: number;
}

export interface JournalEntry {
  cassetteId: string;
  slot: number;
  text: string;
  updatedAt: number;
}
