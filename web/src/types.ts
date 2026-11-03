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
