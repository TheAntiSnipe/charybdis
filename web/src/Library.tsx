import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { CassetteIcon, CloseIcon, EqualizerIcon, PlayIcon, SearchIcon, ShuffleIcon } from './icons';
import { usePlayer } from './player';
import { buildIndex, search, type SearchResults } from './search';
import TapeDeck from './TapeDeck';
import { findTape, type TapeStore } from './tapes';
import type { Album, Library, Playlist, Track } from './types';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Art({ src, className = '' }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={`art placeholder ${className}`} aria-hidden />;
  return <img className={`art ${className}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

/** Up to four distinct covers from a track list, stopping early so big playlists stay cheap. */
function coverArts(tracks: Track[], artFor: (t: Track) => string | null): string[] {
  const seen = new Set<string>();
  for (const t of tracks) {
    const art = artFor(t);
    if (art) seen.add(art);
    if (seen.size === 4) break;
  }
  return [...seen];
}

// Four distinct covers make a 2x2 tile; fewer fall back to a single cover.
function PlaylistCover({ arts, className = '' }: { arts: string[]; className?: string }) {
  if (arts.length >= 4) {
    return <div className={`mosaic ${className}`}>{arts.map((src) => <Art key={src} src={src} />)}</div>;
  }
  return <Art src={arts[0] ?? null} className={className} />;
}

function PlayActions({ tracks }: { tracks: Track[] }) {
  const player = usePlayer();
  return (
    <div className="play-actions">
      <button className="action" onClick={() => player.play(tracks, 0, 'ordered')} disabled={!tracks.length}>
        <PlayIcon /> Play
      </button>
      <button className="action alt" onClick={() => player.playShuffled(tracks)} disabled={!tracks.length}>
        <ShuffleIcon /> Shuffle
      </button>
    </div>
  );
}

const CODEC_LABEL = { alac: 'ALAC', aac: 'AAC', mp3: 'MP3' } as const;

function TrackRow({ track, index, queue, showArtist }: { track: Track; index: number; queue: Track[]; showArtist: boolean }) {
  const player = usePlayer();
  const active = player.current?.id === track.id;
  return (
    <li>
      <button className={`track ${active ? 'active' : ''}`} onClick={() => player.play(queue, index)}>
        <span className="track-no">
          {active ? <EqualizerIcon className={`eq ${player.playing ? 'on' : ''}`} width={16} height={16} /> : track.trackNo || index + 1}
        </span>
        <span className="track-main">
          <span className="track-title">{track.title}</span>
          {showArtist && <span className="track-sub">{track.artist} · {track.album}</span>}
        </span>
        <span className={`badge ${track.codec}`}>{CODEC_LABEL[track.codec]}</span>
        <span className="track-time">{formatTime(track.durationSec)}</span>
      </button>
    </li>
  );
}

function TrackList({ tracks, showArtist, columns = false }: { tracks: Track[]; showArtist: boolean; columns?: boolean }) {
  return (
    <ul className={`tracks ${columns ? 'columns' : ''}`}>
      {tracks.map((t, i) => <TrackRow key={`${t.id}-${i}`} track={t} index={i} queue={tracks} showArtist={showArtist} />)}
    </ul>
  );
}

type Tab = 'albums' | 'tracks' | 'playlists' | 'tapedeck';
const TAB_LABELS: Record<Tab, string> = { albums: 'Albums', tracks: 'Tracks', playlists: 'Playlists', tapedeck: 'Tape deck' };

type View =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'album'; id: string }
  | { kind: 'playlist'; id: string };

function MakeCassetteButton({ album, tapes, onOpenDeck }: { album: Album; tapes: TapeStore; onOpenDeck: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exists = !!findTape(tapes.cassettes, 'album', album.id);

  async function make() {
    setBusy(true);
    setError('');
    try {
      await tapes.create('album', album.id);
      onOpenDeck();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="play-actions">
        <button className="action alt" onClick={exists ? onOpenDeck : make} disabled={busy || tapes.status === 'loading'}>
          <CassetteIcon /> {exists ? 'On the shelf' : busy ? 'Making…' : 'Make cassette'}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="searchbox" role="search">
      <SearchIcon />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Enter dismisses the iOS keyboard so the results are visible.
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="Search songs, artists, albums"
        aria-label="Search library"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {value && (
        <button className="clear" aria-label="Clear search" onClick={() => onChange('')}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

const ALBUM_RESULT_LIMIT = 48;

function SearchResultsView({
  results, query, albumArt, playlistArts, onAlbum, onPlaylist,
}: {
  results: SearchResults;
  query: string;
  albumArt: (a: Album) => string | null;
  playlistArts: (p: Playlist) => string[];
  onAlbum: (id: string) => void;
  onPlaylist: (id: string) => void;
}) {
  const { tracks, totalTracks, albums, playlists } = results;
  if (!tracks.length && !albums.length && !playlists.length) {
    return <p className="muted center-text">Nothing found for “{query}”.</p>;
  }
  return (
    <div className="results">
      {albums.length > 0 && (
        <>
          <h3 className="section-title">Albums</h3>
          <div className="grid">
            {albums.slice(0, ALBUM_RESULT_LIMIT).map((a) => (
              <button key={a.id} className="card" onClick={() => onAlbum(a.id)}>
                <Art src={albumArt(a)} />
                <span className="card-title">{a.title}</span>
                <span className="card-sub">{a.artist}</span>
              </button>
            ))}
          </div>
          {albums.length > ALBUM_RESULT_LIMIT && (
            <p className="muted result-note">Showing {ALBUM_RESULT_LIMIT} of {albums.length} albums. Keep typing to narrow it down.</p>
          )}
        </>
      )}
      {playlists.length > 0 && (
        <>
          <h3 className="section-title">Playlists</h3>
          <div className="grid">
            {playlists.map((p) => (
              <button key={p.id} className="card" onClick={() => onPlaylist(p.id)}>
                <PlaylistCover arts={playlistArts(p)} />
                <span className="card-title">{p.name}</span>
                <span className="card-sub">{p.trackIds.length} tracks</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tracks.length > 0 && (
        <>
          <h3 className="section-title">Tracks</h3>
          <TrackList tracks={tracks} showArtist columns />
          {totalTracks > tracks.length && (
            <p className="muted result-note">Showing {tracks.length} of {totalTracks} tracks. Keep typing to narrow it down.</p>
          )}
        </>
      )}
    </div>
  );
}

export default function LibraryView({ library, artFor, tapes, onDeckVisible }: {
  library: Library;
  artFor: (t: Track) => string | null;
  tapes: TapeStore;
  onDeckVisible?: (visible: boolean) => void;
}) {
  const [view, setView] = useState<View>({ kind: 'tab', tab: 'albums' });
  const trackById = useMemo(() => new Map(library.tracks.map((t) => [t.id, t])), [library]);
  const resolve = (ids: string[]) => ids.map((id) => trackById.get(id)).filter((t): t is Track => !!t);
  const albumArt = (a: Album) => (a.artKey ? `/${a.artKey}` : null);

  // A new screen should start at the top, not wherever the previous list was scrolled.
  const viewKey = view.kind === 'tab' ? view.tab : `${view.kind}:${view.id}`;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewKey]);

  // Searching runs entirely in the browser over the library we already downloaded.
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searchIndex = useMemo(() => buildIndex(library), [library]);
  const results = useMemo(() => search(searchIndex, deferredQuery), [searchIndex, deferredQuery]);
  const searching = query.trim().length > 0;
  const backLabel = searching ? 'Search' : null;

  if (view.kind === 'album') {
    const album = library.albums.find((a) => a.id === view.id);
    if (!album) return null;
    const tracks = resolve(album.trackIds);
    return (
      <section>
        <button className="back" onClick={() => setView({ kind: 'tab', tab: 'albums' })}>‹ {backLabel ?? 'Albums'}</button>
        <header className="detail-head">
          <Art src={albumArt(album)} className="large" />
          <div className="detail-text">
            <h2>{album.title}</h2>
            <p className="muted">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
            <PlayActions tracks={tracks} />
            <MakeCassetteButton album={album} tapes={tapes} onOpenDeck={() => setView({ kind: 'tab', tab: 'tapedeck' })} />
          </div>
        </header>
        <TrackList tracks={tracks} showArtist={false} />
      </section>
    );
  }

  if (view.kind === 'playlist') {
    const playlist = library.playlists.find((p) => p.id === view.id);
    if (!playlist) return null;
    const tracks = resolve(playlist.trackIds);
    return (
      <section>
        <button className="back" onClick={() => setView({ kind: 'tab', tab: 'playlists' })}>‹ {backLabel ?? 'Playlists'}</button>
        <header className="detail-head">
          <PlaylistCover arts={coverArts(tracks, artFor)} className="large" />
          <div className="detail-text">
            <h2>{playlist.name}</h2>
            <p className="muted">{tracks.length} tracks</p>
            <PlayActions tracks={tracks} />
          </div>
        </header>
        <TrackList tracks={tracks} showArtist columns />
      </section>
    );
  }

  const tab = view.tab;
  const allTracks = [...library.tracks].sort((a, b) => a.title.localeCompare(b.title));
  const openAlbum = (id: string) => setView({ kind: 'album', id });
  const openPlaylist = (id: string) => setView({ kind: 'playlist', id });
  return (
    <section>
      <nav className="tabs">
        {(['albums', 'tracks', 'playlists', 'tapedeck'] as const).map((t) => (
          <button
            key={t}
            className={tab === t && !searching ? 'on' : ''}
            onClick={() => {
              setQuery('');
              setView({ kind: 'tab', tab: t });
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>
      <SearchBox value={query} onChange={setQuery} />
      {searching && results && (
        <SearchResultsView
          results={results}
          query={query.trim()}
          albumArt={albumArt}
          playlistArts={(p) => coverArts(resolve(p.trackIds), artFor)}
          onAlbum={openAlbum}
          onPlaylist={openPlaylist}
        />
      )}
      {!searching && tab === 'albums' && (
        <div className="grid">
          {library.albums.map((a) => (
            <button key={a.id} className="card" onClick={() => openAlbum(a.id)}>
              <Art src={albumArt(a)} />
              <span className="card-title">{a.title}</span>
              <span className="card-sub">{a.artist}</span>
            </button>
          ))}
        </div>
      )}
      {!searching && tab === 'tracks' && (
        <>
          <PlayActions tracks={allTracks} />
          <TrackList tracks={allTracks} showArtist columns />
        </>
      )}
      {!searching && tab === 'playlists' && (
        <div className="grid">
          {library.playlists.map((p) => (
            <button key={p.id} className="card" onClick={() => openPlaylist(p.id)}>
              <PlaylistCover arts={coverArts(resolve(p.trackIds), artFor)} />
              <span className="card-title">{p.name}</span>
              <span className="card-sub">{p.trackIds.length} tracks</span>
            </button>
          ))}
        </div>
      )}
      {!searching && tab === 'tapedeck' && <TapeDeck library={library} tapes={tapes} resolve={resolve} onVisible={onDeckVisible} />}
    </section>
  );
}
