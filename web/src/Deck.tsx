import { useEffect, useRef, useState } from 'react';
import CassetteArt, { type CassetteLook } from './CassetteArt';
import { playEject, playKey, playRewind, REWIND_SOUND_S } from './deckSound';
import { EjectIcon, PauseIcon, PlayIcon, PrevIcon } from './icons';
import { tapeTitle, usePlayer } from './player';
import { displayTitle, spineLook, styleOf, tapeLengthLabel } from './tapes';
import type { Cassette } from './types';

type Phase = 'idle' | 'inserting' | 'loaded' | 'ejecting';

export const INSERT_MS = 900;
export const EJECT_MS = 650;
export const INSERT_CLUNK_S = 0.62; // when the cassette seats, so the sound lands on the animation

interface Shown {
  id: string;
  title: string; // remembered for the moment after the tape leaves the store's reach
  totalSec: number;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default function Deck({ cassettes, coversFor }: { cassettes: Cassette[]; coversFor: (tape: Cassette) => string[] }) {
  const { tape, playing, tapeEnded, tapeProgress, toggle, rewind, eject, relabelTape } = usePlayer();

  const [shown, setShown] = useState<Shown | null>(() => (tape ? { id: tape.id, title: tape.label, totalSec: tape.totalSec } : null));
  const [phase, setPhase] = useState<Phase>(tape ? 'loaded' : 'idle');
  const shownId = useRef<string | undefined>(shown?.id);
  const timer = useRef<number | undefined>(undefined);
  const rewindTimer = useRef<number | undefined>(undefined);
  const [rewinding, setRewinding] = useState(false);
  const lastProgress = useRef(0);
  if (tape) lastProgress.current = tapeProgress;

  // A different tape arriving animates in; a tape already in the deck on arrival just sits there.
  useEffect(() => {
    if (tape && tape.id !== shownId.current) {
      window.clearTimeout(timer.current);
      shownId.current = tape.id;
      setShown({ id: tape.id, title: tape.label, totalSec: tape.totalSec });
      if (prefersReducedMotion()) {
        setPhase('loaded');
      } else {
        setPhase('inserting');
        timer.current = window.setTimeout(() => setPhase('loaded'), INSERT_MS);
      }
    } else if (!tape && phase !== 'ejecting' && shownId.current) {
      // Ejected from elsewhere, e.g. normal playback started.
      shownId.current = undefined;
      setShown(null);
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tape?.id]);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(rewindTimer.current);
  }, []);

  // The reels run backwards for as long as the rewind sound lasts.
  function onRewind() {
    const kind = rewind() ?? 'restart';
    playRewind(kind);
    window.clearTimeout(rewindTimer.current);
    if (prefersReducedMotion()) return;
    setRewinding(true);
    rewindTimer.current = window.setTimeout(() => setRewinding(false), REWIND_SOUND_S[kind] * 1000);
  }

  // Renaming the tape in the customize panel should change the lock screen too.
  const match = shown ? cassettes.find((c) => c.id === shown.id) : undefined;
  const liveTitle = match ? displayTitle(match) : undefined;
  useEffect(() => {
    if (tape && liveTitle) relabelTape(tape.id, liveTitle);
  }, [tape?.id, liveTitle, relabelTape]); // eslint-disable-line react-hooks/exhaustive-deps

  function onEject() {
    if (!tape) return;
    playEject();
    window.clearTimeout(timer.current);
    if (prefersReducedMotion()) {
      shownId.current = undefined;
      setShown(null);
      setPhase('idle');
    } else {
      setPhase('ejecting');
      timer.current = window.setTimeout(() => {
        shownId.current = undefined;
        setShown(null);
        setPhase('idle');
      }, EJECT_MS);
    }
    eject();
  }

  const look: CassetteLook | null = shown
    ? {
        style: match ? styleOf(match) : 'generated',
        title: liveTitle ?? shown.title,
        shell: match ? spineLook(match).shell : '#e8e1cf',
        seed: shown.id,
        covers: match ? coversFor(match) : [],
        length: tapeLengthLabel(tape?.totalSec ?? shown.totalSec),
        progress: tape ? tapeProgress : lastProgress.current,
      }
    : null;

  const slot = tape ? String(tape.slot + 1).padStart(2, '0') : '--';
  const readout = tapeEnded ? 'END' : slot;
  const status = !tape
    ? 'No tape loaded'
    : `${tapeTitle(tape.kind, tape.label)} loaded. ${tapeEnded ? 'End of tape.' : `Song ${tape.slot + 1} of ${tape.total}.`} ${playing ? 'Playing.' : 'Stopped.'}`;

  return (
    <section className="deck" aria-label="Tape deck">
      <div className={`deck-bay ${phase}`}>
        {shown && look ? (
          <div key={shown.id} className={`cassette-wrap ${phase}`}>
            <CassetteArt look={look} playing={playing && phase === 'loaded'} rewinding={rewinding} />
          </div>
        ) : (
          <p className="deck-empty">Insert a cassette</p>
        )}
        <div className="deck-door" aria-hidden />
      </div>

      <div className="deck-panel">
        <div className="deck-readout">
          <span className={`deck-led ${playing ? 'on' : ''}`} aria-hidden />
          <span className="deck-lcd" aria-hidden>{readout}</span>
        </div>
        <div className="deck-keys">
          <button
            className="deck-key"
            aria-label="Rewind"
            title="Rewind: restarts this song; press again to go back a song"
            disabled={!tape}
            onClick={onRewind}
          >
            <PrevIcon />
          </button>
          <button className="deck-key play" aria-label={playing ? 'Pause' : 'Play'} disabled={!tape} onClick={() => { playKey(); toggle(); }}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="deck-key" aria-label="Eject tape" disabled={!tape} onClick={onEject}>
            <EjectIcon />
          </button>
        </div>
      </div>
      <p className="sr-only" role="status">{status}</p>
    </section>
  );
}
