import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import CassetteArt from './CassetteArt';
import Deck, { INSERT_CLUNK_S, prefersReducedMotion } from './Deck';
import { playInsert } from './deckSound';
import { CassetteIcon } from './icons';
import Journal from './Journal';
import { useOnline } from './online';
import { Art } from './Library';
import { usePlayer } from './player';
import {
  artistGroups, CASSETTE_STYLES, displayTitle, findTape, labelLayout, MAX_CASSETTE_TRACKS, MAX_TITLE,
  spineLook, styleOf, tapeLengthLabel, type TapeStore,
} from './tapes';
import type { Cassette, CassetteStyle, Library, Track } from './types';

const WIDE_QUERY = '(min-width: 1000px)'; // keep in sync with the journal-dock rules in styles.css

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** The journal as a full-screen sheet, for screens too narrow to keep it beside the deck. */
function JournalSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  return <div className="journal-sheet" role="dialog" aria-modal="true" aria-label="Journal">{children}</div>;
}

function Spine({ tape, loaded, onPick }: { tape: Cassette; loaded: boolean; onPick: () => void }) {
  const look = spineLook(tape);
  const title = displayTitle(tape);
  const label = labelLayout(title, look);
  const style = {
    '--shell': look.shell,
    '--w': `${look.width}px`,
    '--h': `${look.height}px`,
    '--tilt': `${look.tilt}deg`,
    '--fs': `${label.fontSize}px`,
    '--lines': label.lines,
  } as CSSProperties;
  const finished = tape.status === 'finished';
  return (
    <li>
      <button
        className={`spine ${loaded ? 'loaded' : ''} ${finished ? 'finished' : ''}`}
        style={style}
        onClick={onPick}
        aria-label={`${tape.kind === 'album' ? 'Cassette' : 'Mixtape'}: ${title}${finished ? ', finished' : ''}`}
      >
        <span className="spine-paper">
          <span className="spine-title">{title}</span>
        </span>
      </button>
    </li>
  );
}

function Shelf({ title, tapes, loadedId, onPick }: {
  title: string;
  tapes: Cassette[];
  loadedId: string | undefined;
  onPick: (tape: Cassette) => void;
}) {
  if (!tapes.length) return null;
  return (
    <>
      <h2 className="section-title">{title}</h2>
      <ul className="shelf">
        {tapes.map((t) => (
          <Spine key={t.id} tape={t} loaded={t.id === loadedId} onPick={() => onPick(t)} />
        ))}
      </ul>
    </>
  );
}

function Picker({ library, tapes, onMade }: { library: Library; tapes: TapeStore; onMade: (label: string) => void }) {
  const [mode, setMode] = useState<'albums' | 'artists'>('albums');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const artists = useMemo(() => artistGroups(library.albums), [library]);
  const needle = query.trim().toLowerCase();

  async function make(kind: 'album' | 'artist', sourceId: string, label: string) {
    setBusy(true);
    setError('');
    try {
      await tapes.create(kind, sourceId);
      onMade(label);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const albums = library.albums.filter((a) => !needle || `${a.title} ${a.artist}`.toLowerCase().includes(needle));
  const artistRows = artists.filter((a) => !needle || a.name.toLowerCase().includes(needle));

  return (
    <div className="picker">
      <div className="seg" role="tablist">
        {(['albums', 'artists'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {m === 'albums' ? 'Albums' : 'Artists'}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={mode === 'albums' ? 'Find an album' : 'Find an artist'}
        aria-label="Filter"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="pick-list">
        {mode === 'albums' && albums.map((a) => {
          const exists = !!findTape(tapes.cassettes, 'album', a.id);
          return (
            <li key={a.id}>
              <button className="pick-row" disabled={busy || exists} onClick={() => make('album', a.id, a.title)}>
                <Art src={a.artKey ? `/${a.artKey}` : null} className="mini" />
                <span className="pick-text">
                  <span className="track-title">{a.title}</span>
                  <span className="track-sub">{a.artist} · {a.trackIds.length} songs</span>
                </span>
                <span className="pick-state">{exists ? 'On the shelf' : 'Make'}</span>
              </button>
            </li>
          );
        })}
        {mode === 'artists' && artistRows.map((a) => {
          const exists = !!findTape(tapes.cassettes, 'artist', a.name);
          const tooBig = a.trackCount > MAX_CASSETTE_TRACKS;
          return (
            <li key={a.name}>
              <button className="pick-row" disabled={busy || exists || tooBig} onClick={() => make('artist', a.name, a.name)}>
                <span className="pick-icon"><CassetteIcon /></span>
                <span className="pick-text">
                  <span className="track-title">{a.name}</span>
                  <span className="track-sub">{a.albumCount} {a.albumCount === 1 ? 'album' : 'albums'} · {a.trackCount} songs</span>
                </span>
                <span className="pick-state">{exists ? 'On the shelf' : tooBig ? 'Too long' : 'Make'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {((mode === 'albums' && !albums.length) || (mode === 'artists' && !artistRows.length)) && (
        <p className="muted">Nothing matches.</p>
      )}
    </div>
  );
}

/** Name the loaded tape and choose how it looks. Style applies at once; the title applies when you finish typing. */
function Customizer({ tape, tapes, covers, totalSec, noteCount, onDelete, onClose }: {
  tape: Cassette;
  tapes: TapeStore;
  covers: string[];
  totalSec: number;
  noteCount: number;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(tape.title ?? '');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const current = styleOf(tape);
  const shell = spineLook(tape).shell;

  async function save(patch: { title?: string | null; style?: CassetteStyle }) {
    setError('');
    try {
      await tapes.update(tape.id, patch);
    } catch (err) {
      setError((err as Error).message);
      if ('title' in patch) setDraft(tape.title ?? '');
    }
  }

  function commitTitle() {
    const next = draft.trim();
    if (next !== (tape.title ?? '')) void save({ title: next || null });
  }

  async function remove() {
    setDeleting(true);
    setError('');
    try {
      await onDelete(); // on success this panel goes away with the tape
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="customizer">
      <label className="customizer-field">
        <span>Title</span>
        <input
          value={draft}
          maxLength={MAX_TITLE}
          placeholder={tape.label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>

      <div className="style-options" role="radiogroup" aria-label="Cassette style">
        {CASSETTE_STYLES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-label={s.name}
            aria-checked={current === s.id}
            className={`style-option ${current === s.id ? 'on' : ''}`}
            onClick={() => void save({ style: s.id })}
          >
            <CassetteArt
              look={{ style: s.id, title: displayTitle({ title: draft.trim() || undefined, label: tape.label }), shell, seed: tape.id, covers, length: tapeLengthLabel(totalSec), progress: 0.4 }}
              playing={false}
            />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <p className="muted customizer-hint">
        Clear shows the tape moving from reel to reel, a rough sense of how far through the whole tape you are.
      </p>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="customizer-actions">
        {tape.title && (
          <button className="link" onClick={() => { setDraft(''); void save({ title: null }); }}>
            Use “{tape.label}”
          </button>
        )}
        <button className="action" onClick={() => { commitTitle(); onClose(); }}>Done</button>
      </div>

      <div className="danger-zone">
        {!confirming ? (
          <button className="link danger" onClick={() => setConfirming(true)}>Delete this cassette…</button>
        ) : (
          <div role="group" aria-label="Confirm delete" className="confirm-delete">
            <p>
              Delete “{displayTitle(tape)}”{noteCount > 0 && ` and its ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`}?
              This can’t be undone. You can make the cassette again, but it will start blank.
            </p>
            <div className="customizer-actions">
              <button className="secondary" disabled={deleting} onClick={() => setConfirming(false)}>Keep it</button>
              <button className="action danger" disabled={deleting} onClick={() => void remove()}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TapeDeck({ library, tapes, resolve, onVisible }: {
  library: Library;
  tapes: TapeStore;
  resolve: (ids: string[]) => Track[];
  onVisible?: (visible: boolean) => void;
}) {
  const player = usePlayer();
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState('');
  const deckRef = useRef<HTMLDivElement>(null);

  // Covers for the cassette face: one for an album, up to four side by side for an artist.
  const albumArt = useMemo(() => new Map(library.albums.map((a) => [a.id, a.artKey])), [library]);
  const coversFor = (tape: Cassette): string[] => {
    const keys = tape.pages.map((p) => albumArt.get(p.albumId)).filter((k): k is string => !!k);
    return [...new Set(keys)].slice(0, 4).map((k) => `/${k}`);
  };

  // While this tab is open the deck is the control surface, so the bottom tape bar steps aside.
  useEffect(() => {
    onVisible?.(true);
    return () => onVisible?.(false);
  }, [onVisible]);

  // Loading happens inside the tap so the deck's play button can start audio on iOS.
  function load(tape: Cassette) {
    const tracks = resolve(tape.trackIds);
    if (tracks.length !== tape.trackIds.length) {
      setMessage('Some songs on that tape are no longer in the library.');
      return;
    }
    setMessage('');
    playInsert(prefersReducedMotion() ? 0 : INSERT_CLUNK_S);
    const { index, positionSec } = tapes.progressOf(tape);
    player.loadTape({ id: tape.id, kind: tape.kind, label: displayTitle(tape), tracks, index, positionSec });
    deckRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  const loadedTape = tapes.cassettes.find((c) => c.id === player.tape?.id);
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => {
    if (!loadedTape) setCustomizing(false);
  }, [loadedTape]);

  const online = useOnline();

  // The server goes first: if it refuses, the tape stays in the deck and the panel says why.
  async function removeTape(tape: Cassette) {
    await tapes.remove(tape.id);
    if (player.tape?.id === tape.id) player.eject();
    setMessage(`${displayTitle(tape)} was taken off the shelf.`);
  }

  const shelf = tapes.cassettes.filter((c) => c.status !== 'finished');
  const finished = tapes.cassettes.filter((c) => c.status === 'finished');
  const byNewest = (a: Cassette, b: Cassette) => b.createdAt - a.createdAt;

  // Wide screens keep the journal beside the deck; everywhere else it is a sheet over the page.
  const wide = useMatches(WIDE_QUERY);
  const [journalOpen, setJournalOpen] = useState(false);
  useEffect(() => {
    if (!loadedTape || wide) setJournalOpen(false);
  }, [loadedTape, wide]);
  const docked = wide && !!loadedTape;

  return (
    <div className={`tapedeck-layout ${docked ? 'docked' : ''}`}>
    <div className="tapedeck">
      <div ref={deckRef}>
        <Deck cassettes={tapes.cassettes} coversFor={coversFor} />
      </div>
      <div className="customize-bar">
        {!wide && (
          <button className="action journal-open" disabled={!loadedTape} onClick={() => setJournalOpen(true)}>
            Journal
          </button>
        )}
        <button className="link" disabled={!loadedTape} aria-expanded={customizing} onClick={() => setCustomizing((c) => !c)}>
          {customizing ? 'Close' : 'Customize this cassette'}
        </button>
      </div>
      {customizing && loadedTape && player.tape && (
        <Customizer
          key={loadedTape.id}
          tape={loadedTape}
          tapes={tapes}
          covers={coversFor(loadedTape)}
          totalSec={player.tape.totalSec}
          noteCount={tapes.entries.filter((e) => e.cassetteId === loadedTape.id && e.text.trim()).length}
          onDelete={() => removeTape(loadedTape)}
          onClose={() => setCustomizing(false)}
        />
      )}
      {!online && (
        <p className="offline-note" role="status">
          You’re offline. Notes you write are kept on this device and saved when you’re back; changes to the shelf wait for a connection.
        </p>
      )}
      <div className="deck-head">
        <p className="muted deck-note">
          Pick an album or an artist, load the tape, and listen without names, skipping or a clock.
        </p>
        <button className="action" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
          <CassetteIcon /> {picking ? 'Close' : 'New cassette'}
        </button>
      </div>

      {picking && (
        <Picker
          library={library}
          tapes={tapes}
          onMade={(label) => {
            setPicking(false);
            setMessage(`${label} is on the shelf.`);
          }}
        />
      )}

      {message && <p className="notice-line" role="status">{message}</p>}
      {tapes.status === 'loading' && <p className="muted center-text">Dusting off the shelf…</p>}
      {tapes.status === 'error' && (
        <p className="error" role="alert">
          {tapes.error} <button className="link" onClick={tapes.reload}>Try again</button>
        </p>
      )}
      {tapes.status === 'ready' && !tapes.cassettes.length && !picking && (
        <p className="muted center-text">The shelf is empty. Make a cassette from any album or artist.</p>
      )}

      <Shelf
        title="To listen"
        tapes={[...shelf].sort(byNewest)}
        loadedId={player.tape?.id}
        onPick={load}
      />
      <Shelf
        title="Finished"
        tapes={[...finished].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))}
        loadedId={player.tape?.id}
        onPick={load}
      />
    </div>
    {docked && loadedTape && (
      <aside className="journal-dock">
        <Journal key={loadedTape.id} tape={loadedTape} tapes={tapes} library={library} resolve={resolve} />
      </aside>
    )}
    {journalOpen && loadedTape && (
      <JournalSheet onClose={() => setJournalOpen(false)}>
        <Journal key={loadedTape.id} tape={loadedTape} tapes={tapes} library={library} resolve={resolve} onClose={() => setJournalOpen(false)} />
      </JournalSheet>
    )}
    </div>
  );
}
