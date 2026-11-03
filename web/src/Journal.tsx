import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon } from './icons';
import { MAX_NOTE, slotKey, type JournalSync } from './journalSave';
import { usePlayer } from './player';
import { displayTitle, journalPages, type TapeStore } from './tapes';
import type { Cassette, Library, Track } from './types';

const SYNC_TEXT: Record<JournalSync, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  retrying: 'Can’t reach Charybdis. Your notes are kept here and will keep retrying.',
  rejected: 'A note could not be saved.',
};

function Slot({ number, title, text, state, error, playing, onChange, onBlur }: {
  number: number;
  title?: string;
  text: string;
  state: 'typing' | 'saving' | 'retrying' | 'rejected' | undefined;
  error?: string;
  playing: boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  // Grows with the note so nothing needs scrolling inside the box.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const label = String(number).padStart(2, '0');
  return (
    <li className={`slot ${playing ? 'now' : ''} ${state ?? ''}`} aria-current={playing ? 'true' : undefined}>
      <span className="slot-no" aria-hidden>{label}</span>
      <div className="slot-body">
        {title && <span className="slot-title">{title}</span>}
        <textarea
          ref={area}
          rows={1}
          value={text}
          maxLength={MAX_NOTE}
          placeholder={title ? 'No notes' : '…'}
          aria-label={`Song ${number} notes`}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoCorrect="off"
          spellCheck={false}
        />
        {text.length >= MAX_NOTE - 40 && <span className="slot-count">{text.length}/{MAX_NOTE}</span>}
        {state === 'rejected' && <span className="slot-error" role="alert">{error ?? 'Could not save this note.'}</span>}
      </div>
    </li>
  );
}

/**
 * The notebook for the loaded tape: one page per album, one numbered line per song. Song titles stay hidden
 * until every line has a note (the server decides when that is); then they are written in beside the notes.
 */
export default function Journal({ tape, tapes, library, resolve, onClose }: {
  tape: Cassette;
  tapes: TapeStore;
  library: Library;
  resolve: (ids: string[]) => Track[];
  onClose?: () => void;
}) {
  const { tape: loaded, tapeEnded } = usePlayer();
  const finished = tape.status === 'finished';
  const pages = useMemo(() => journalPages(tape), [tape]);
  const notes = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of tapes.entries) if (e.cassetteId === tape.id) map.set(e.slot, e.text);
    return map;
  }, [tapes.entries, tape.id]);
  const titles = useMemo(
    () => (finished ? resolve(tape.trackIds).map((t) => t.title) : []),
    [finished, resolve, tape.trackIds],
  );

  const playingSlot = loaded?.id === tape.id && !tapeEnded ? loaded.slot : null;
  const playingPage = playingSlot === null ? -1 : pages.findIndex((p) => playingSlot >= p.start && playingSlot < p.start + p.count);

  // The notebook opens at the song that is playing and turns the page when the tape does, until you turn it yourself.
  const [page, setPage] = useState(Math.max(playingPage, 0));
  useEffect(() => {
    if (playingPage >= 0) setPage(playingPage);
  }, [playingPage]);
  const current = pages[Math.min(page, pages.length - 1)];

  const written = [...notes.values()].filter((t) => t.trim()).length;
  const heading = finished
    ? library.albums.find((a) => a.id === current?.albumId)?.title ?? displayTitle(tape)
    : pages.length > 1 ? `Page ${page + 1}` : displayTitle(tape);

  return (
    <section className={`journal ${finished ? 'finished' : ''}`} aria-label="Journal">
      <header className="journal-head">
        <div className="journal-head-text">
          <h2 className="journal-title">{heading}</h2>
          <p className="journal-count">
            {finished ? 'Tape finished ★' : `${written} of ${tape.trackIds.length} songs written`}
          </p>
        </div>
        {onClose && (
          <button className="np-close" aria-label="Close journal" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </header>

      {pages.length > 1 && (
        <nav className="journal-pager" aria-label="Pages">
          <button className="link" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
          <span>Page {page + 1} of {pages.length}</span>
          <button className="link" disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
        </nav>
      )}

      {current && (
        <ol className="journal-page" start={current.start + 1}>
          {Array.from({ length: current.count }, (_, i) => current.start + i).map((slot) => {
            const info = tapes.entryStates[slotKey(tape.id, slot)];
            return (
              <Slot
                key={slot}
                number={slot + 1}
                title={finished ? titles[slot] || undefined : undefined}
                text={notes.get(slot) ?? ''}
                state={info?.state}
                error={info?.error}
                playing={slot === playingSlot}
                onChange={(text) => tapes.editEntry(tape.id, slot, text)}
                onBlur={() => tapes.flushEntries()}
              />
            );
          })}
        </ol>
      )}

      <p className={`journal-sync ${tapes.journalSync}`} role="status">{SYNC_TEXT[tapes.journalSync]}</p>
    </section>
  );
}
