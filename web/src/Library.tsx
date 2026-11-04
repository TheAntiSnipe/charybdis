import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { type HeroStore } from './heroes';
import { pickReview } from './reviews';
import { CassetteIcon, CloseIcon, EqualizerIcon, PlayIcon, SearchIcon, ShuffleIcon, StarIcon } from './icons';
import { caseNotes } from './jewel';
import { CaseFront, OpenCase, type HeroSticker } from './JewelCase';
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

function TrackRow({ track, index, queue, showArtist, hero }: {
  track: Track; index: number; queue: Track[]; showArtist: boolean;
  hero?: { isHero: boolean; onToggle: () => void };
}) {
  const player = usePlayer();
  const active = player.current?.id === track.id;
  return (
    <li className={hero ? 'with-star' : undefined}>
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
      {hero && (
        <button
          className={`hero-pick ${hero.isHero ? 'on' : ''}`}
          aria-pressed={hero.isHero}
          aria-label={hero.isHero ? `Remove hero song: ${track.title}` : `Make “${track.title}” the hero song`}
          onClick={hero.onToggle}
        >
          <StarIcon filled={hero.isHero} />
        </button>
      )}
    </li>
  );
}

function TrackList({ tracks, showArtist, columns = false, heroId, onToggleHero }: {
  tracks: Track[]; showArtist: boolean; columns?: boolean; heroId?: string; onToggleHero?: (trackId: string) => void;
}) {
  return (
    <ul className={`tracks ${columns ? 'columns' : ''}`}>
      {tracks.map((t, i) => (
        <TrackRow
          key={`${t.id}-${i}`} track={t} index={i} queue={tracks} showArtist={showArtist}
          hero={onToggleHero ? { isHero: t.id === heroId, onToggle: () => onToggleHero(t.id) } : undefined}
        />
      ))}
    </ul>
  );
}

/** An album on the shelf: its jewel case, with the title and artist underneath. */
function AlbumCard({ album, art, hero, onOpen }: { album: Album; art: string | null; hero?: HeroSticker; onOpen: () => void }) {
  return (
    <button className="card" onClick={onOpen}>
      <CaseFront album={album} art={art} hero={hero} />
      <span className="card-title">{album.title}</span>
      <span className="card-sub">{album.artist}</span>
    </button>
  );
}

// The case only opens flat where there is room for two halves side by side: landscape on an iPad or a desktop.
const OPENS_FLAT = '(orientation: landscape) and (min-width: 900px) and (min-height: 540px)';

function useCaseOpensFlat(): boolean {
  const query = () => typeof window.matchMedia === 'function' && window.matchMedia(OPENS_FLAT).matches;
  const [flat, setFlat] = useState(query);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(OPENS_FLAT);
    const onChange = () => setFlat(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return flat;
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
  results, query, albumArt, heroOf, playlistArts, onAlbum, onPlaylist,
}: {
  results: SearchResults;
  query: string;
  albumArt: (a: Album) => string | null;
  heroOf: (a: Album) => HeroSticker | undefined;
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
              <AlbumCard key={a.id} album={a} art={albumArt(a)} hero={heroOf(a)} onOpen={() => onAlbum(a.id)} />
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

export default function LibraryView({ library, artFor, tapes, heroes, onDeckVisible }: {
  library: Library;
  artFor: (t: Track) => string | null;
  tapes: TapeStore;
  heroes: HeroStore;
  onDeckVisible?: (visible: boolean) => void;
}) {
  const [view, setView] = useState<View>({ kind: 'tab', tab: 'albums' });
  const trackById = useMemo(() => new Map(library.tracks.map((t) => [t.id, t])), [library]);
  const resolve = (ids: string[]) => ids.map((id) => trackById.get(id)).filter((t): t is Track => !!t);
  const albumArt = (a: Album) => (a.artKey ? `/${a.artKey}` : null);
  const reviewOf = (albumId: string) => heroes.reviews[albumId] ?? pickReview([], albumId);
  const heroOf = (a: Album): HeroSticker | undefined => {
    const id = heroes.heroes[a.id];
    const track = id ? trackById.get(id) : undefined;
    return track ? { title: track.title, ...reviewOf(a.id) } : undefined;
  };

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

  // Where there is room the case opens like a real one; elsewhere an album opens its page.
  const flat = useCaseOpensFlat();
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const openCase = flat && openCaseId ? library.albums.find((a) => a.id === openCaseId) : undefined;

  if (view.kind === 'album') {
    const album = library.albums.find((a) => a.id === view.id);
    if (!album) return null;
    const tracks = resolve(album.trackIds);
    return (
      <section>
        <button className="back" onClick={() => setView({ kind: 'tab', tab: 'albums' })}>‹ {backLabel ?? 'Albums'}</button>
        <header className="detail-head">
          <div className="detail-case"><CaseFront album={album} art={albumArt(album)} hero={heroOf(album)} /></div>
          <div className="detail-text">
            <h2>{album.title}</h2>
            <p className="muted">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
            <PlayActions tracks={tracks} />
            <MakeCassetteButton album={album} tapes={tapes} onOpenDeck={() => setView({ kind: 'tab', tab: 'tapedeck' })} />
          </div>
        </header>
        <TrackList tracks={tracks} showArtist={false} heroId={heroes.heroes[album.id]} onToggleHero={(id) => void heroes.toggle(album.id, id)} />
        {heroes.error && <p className="error" role="alert">{heroes.error}</p>}
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
  const openAlbum = (id: string) => (flat ? setOpenCaseId(id) : setView({ kind: 'album', id }));
  const openPlaylist = (id: string) => setView({ kind: 'playlist', id });
  const caseTracks = openCase ? resolve(openCase.trackIds) : [];
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
          heroOf={heroOf}
          playlistArts={(p) => coverArts(resolve(p.trackIds), artFor)}
          onAlbum={openAlbum}
          onPlaylist={openPlaylist}
        />
      )}
      {!searching && tab === 'albums' && (
        <div className="grid">
          {library.albums.map((a) => (
            <AlbumCard key={a.id} album={a} art={albumArt(a)} hero={heroOf(a)} onOpen={() => openAlbum(a.id)} />
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
      {openCase && (
        <OpenCase
          album={openCase}
          art={albumArt(openCase)}
          tracks={caseTracks}
          notes={caseNotes(openCase.id, tapes.cassettes, tapes.entries, (id) => trackById.get(id)?.title)}
          heroId={heroes.heroes[openCase.id]}
          heroReview={reviewOf(openCase.id)}
          heroError={heroes.error}
          onToggleHero={(id) => void heroes.toggle(openCase.id, id)}
          onClose={() => setOpenCaseId(null)}
        >
          <PlayActions tracks={caseTracks} />
          <MakeCassetteButton
            album={openCase}
            tapes={tapes}
            onOpenDeck={() => {
              setOpenCaseId(null);
              setQuery('');
              setView({ kind: 'tab', tab: 'tapedeck' });
            }}
          />
        </OpenCase>
      )}
    </section>
  );
}
