import { useCallback, useState } from 'react';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, ShuffleIcon } from './icons';
import { Art } from './Library';
import NowPlaying from './NowPlaying';
import { usePlayer } from './player';
import SeekRow from './SeekRow';
import type { Track } from './types';

export default function PlayerBar({ artFor }: { artFor: (t: Track) => string | null }) {
  const { current, playing, shuffle, toggleShuffle, toggle, next, prev } = usePlayer();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
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
