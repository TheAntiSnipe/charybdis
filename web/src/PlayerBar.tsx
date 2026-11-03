import { useCallback, useState } from 'react';
import { CassetteIcon, EjectIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ShuffleIcon } from './icons';
import { Art } from './Library';
import NowPlaying from './NowPlaying';
import { tapeTitle, usePlayer } from './player';
import SeekRow from './SeekRow';
import type { Track } from './types';

export default function PlayerBar({ artFor, hideTapeBar = false }: { artFor: (t: Track) => string | null; hideTapeBar?: boolean }) {
  const { current, playing, shuffle, tape, tapeEnded, toggleShuffle, toggle, next, prev, rewind, eject } = usePlayer();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Compact stand-in for the deck on other tabs: play/pause, rewind this song, eject. No names, no clock, no skipping.
  if (tape && hideTapeBar) return null;
  if (tape) {
    return (
      <footer className="player">
        <div className="player-inner">
          <span className="pick-icon" aria-hidden><CassetteIcon /></span>
          <span className="player-info">
            <span className="track-title">{tapeTitle(tape.kind, tape.label)}</span>
            <span className="track-sub">{tapeEnded ? 'End of tape' : `Song ${tape.slot + 1} of ${tape.total}`}</span>
          </span>
          <div className="controls">
            <button aria-label="Rewind" title="Rewind: restarts this song; press again to go back a song" onClick={() => rewind()}><PrevIcon /></button>
            <button aria-label={playing ? 'Pause' : 'Play'} className="primary" onClick={toggle}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button aria-label="Eject tape" onClick={eject}><EjectIcon /></button>
          </div>
        </div>
      </footer>
    );
  }

  if (!current) return null;

  return (
    <>
      <footer className="player">
        <div className="player-inner">
          <button className="np-open" aria-label="Open now playing" onClick={() => setOpen(true)}>
            <Art src={artFor(current)} className="mini" />
            <span className="player-info">
              <span className="track-title">{current.title}</span>
              <span className="track-sub">{current.artist}</span>
            </span>
          </button>
          <div className="controls">
            <button
              aria-label="Shuffle"
              aria-pressed={shuffle}
              className={`shuffle ${shuffle ? 'on' : ''}`}
              onClick={toggleShuffle}
            >
              <ShuffleIcon />
            </button>
            <button aria-label="Previous" onClick={prev}><PrevIcon /></button>
            <button aria-label={playing ? 'Pause' : 'Play'} className="primary" onClick={toggle}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button aria-label="Next" onClick={next}><NextIcon /></button>
          </div>
        </div>
        <SeekRow className="seek-row" />
      </footer>
      {open && <NowPlaying artFor={artFor} onClose={close} />}
    </>
  );
}
