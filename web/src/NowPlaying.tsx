import { useEffect, useRef } from 'react';
import { ChevronDownIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ShuffleIcon } from './icons';
import { Art, formatTime } from './Library';
import SeekRow from './SeekRow';
import { usePlayer } from './player';
import type { Track } from './types';

const CODEC_LABEL = { alac: 'ALAC', aac: 'AAC', mp3: 'MP3' } as const;

function qualityLabel(t: Track): string {
  const rate = t.sampleRate ? `${(t.sampleRate / 1000).toFixed(t.sampleRate % 1000 ? 1 : 0)} kHz` : '';
  if (t.codec === 'alac') return [t.bitDepth ? `${t.bitDepth}-bit` : '', rate, 'Lossless'].filter(Boolean).join(' · ');
  return [t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : '', rate].filter(Boolean).join(' · ');
}

export default function NowPlaying({ artFor, onClose }: { artFor: (t: Track) => string | null; onClose: () => void }) {
  const { current, playing, shuffle, upNext, toggleShuffle, toggle, next, prev, jumpTo } = usePlayer();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll while the sheet is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (!current) return null;

  return (
    <div className="np" role="dialog" aria-modal="true" aria-label="Now playing">
      <header className="np-head">
        <button ref={closeRef} className="np-close" aria-label="Close now playing" onClick={onClose}>
          <ChevronDownIcon />
        </button>
        <h2 className="np-heading">Now playing</h2>
        <span className="np-spacer" aria-hidden />
      </header>

      <div className="np-body">
        <section className="np-main">
          <div className="np-art-box">
            <Art src={artFor(current)} className="np-art" />
          </div>
          <div className="np-meta">
            <h3 className="np-title">{current.title}</h3>
            <p className="np-artist">{current.artist || 'Unknown artist'}</p>
            <p className="np-album">{current.album}{current.year ? ` · ${current.year}` : ''}</p>
            <p className="np-quality">
              <span className={`badge ${current.codec}`}>{CODEC_LABEL[current.codec]}</span>
              {qualityLabel(current)}
            </p>
          </div>
          <SeekRow className="np-seek" />
          <div className="np-controls">
            <button aria-label="Shuffle" aria-pressed={shuffle} className={`shuffle ${shuffle ? 'on' : ''}`} onClick={toggleShuffle}>
              <ShuffleIcon />
            </button>
            <button aria-label="Previous" onClick={prev}><PrevIcon /></button>
            <button aria-label={playing ? 'Pause' : 'Play'} className="primary" onClick={toggle}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button aria-label="Next" onClick={next}><NextIcon /></button>
            <span className="np-spacer" aria-hidden />
          </div>
        </section>

        <section className="np-queue" aria-label="Up next">
          <h3 className="section-title">Up next</h3>
          {upNext.length === 0 ? (
            <p className="muted np-empty">Nothing queued after this track.</p>
          ) : (
            <ul className="tracks">
              {upNext.map((t, i) => (
                <li key={`${t.id}-${i}`}>
                  <button className="track" onClick={() => jumpTo(i)}>
                    <Art src={artFor(t)} className="mini" />
                    <span className="track-main">
                      <span className="track-title">{t.title}</span>
                      <span className="track-sub">{t.artist}</span>
                    </span>
                    <span className="track-time">{formatTime(t.durationSec)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
