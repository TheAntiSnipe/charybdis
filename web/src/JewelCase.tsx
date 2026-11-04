import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BARCODE_WIDTH, stickersFor, type CaseNote, type Sticker } from './jewel';
import { CloseIcon, StarIcon } from './icons';
import { fitTitleSize } from './heroFit';
import type { Review } from './reviews';
import { usePlayer } from './player';
import type { Album, Track } from './types';
import { hash, wearFor } from './wear';

/** Where the scratch tiles sit, so no two cases are scuffed in the same places. */
function wearStyle(seed: string): CSSProperties {
  const h = hash(seed);
  return { '--sx': `${h % 240}px`, '--sy': `${(h >> 8) % 160}px`, '--sx2': `${(h >> 4) % 380}px`, '--sy2': `${(h >> 12) % 260}px` } as CSSProperties;
}

function CaseArt({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="jc-art-fill placeholder" aria-hidden />;
  return <img className="jc-art-fill" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export interface HeroSticker {
  title: string;
  /** What the review says about the song, written to follow the title. */
  phrase: string;
  /** The magazine it is attributed to. */
  source: string;
}

function StickerView({ sticker }: { sticker: Sticker }) {
  const style = { '--r': `${sticker.rotate}deg` } as CSSProperties;
  return (
    <span className={`jc-st jc-st-${sticker.kind} jc-at-${sticker.corner}`} style={style} aria-hidden>
      {sticker.kind === 'barcode' ? (
        <>
          <svg viewBox={`0 0 ${BARCODE_WIDTH} 38`} preserveAspectRatio="none">
            {sticker.bars?.map((b) => <rect key={b.x} x={b.x} y="3" width={b.w} height="26" />)}
          </svg>
          <span>{sticker.text}</span>
        </>
      ) : (
        sticker.text
      )}
    </span>
  );
}

const HERO_MAX = 4.6; // cqw
const HERO_MIN = 2.2;
const HERO_LINES = 2;

function HeroStickerView({ hero }: { hero: HeroSticker }) {
  const label = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = label.current;
    const el = text.current;
    if (!box || !el) return;
    const fit = () => {
      const size = fitTitleSize(HERO_MAX, HERO_MIN, (s) => {
        el.style.fontSize = `${s}cqw`;
        const px = parseFloat(getComputedStyle(el).fontSize) || 0;
        return { width: el.clientWidth, needed: el.scrollWidth, height: el.offsetHeight, maxHeight: px * 1.3 * HERO_LINES };
      });
      el.style.fontSize = `${size}cqw`;
    };
    fit();
    // The handwriting face arrives late and the sticker may be measured while hidden; refit when either changes.
    let width = box.clientWidth;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (box.clientWidth !== width) { width = box.clientWidth; fit(); }
    });
    resize?.observe(box);
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', fit);
    void fonts?.ready?.then(fit);
    return () => { resize?.disconnect(); fonts?.removeEventListener?.('loadingdone', fit); };
  }, [hero.title, hero.phrase]);

  return (
    <span className="jc-hero" ref={label} aria-hidden>
      <span className="jc-hero-quote" ref={text}>
        “<span className="jc-hero-title">{hero.title}</span> {hero.phrase}”
      </span>
      <span className="jc-hero-foot">
        <span className="jc-hero-stars">★★★★★</span>
        <span className="jc-hero-source">{hero.source}</span>
      </span>
    </span>
  );
}

/** The outside of a jewel case: the cover under clear plastic with the spine rail and whatever stickers it has collected. */
export function CaseFront({ album, art, hero }: { album: Pick<Album, 'id' | 'title' | 'artist' | 'trackIds'>; art: string | null; hero?: HeroSticker }) {
  const stickers = useMemo(() => stickersFor(album, !!hero), [album, hero]);
  return (
    <div className="jc-front" style={wearStyle(album.id)}>
      <div className="jc-spine"><span>{album.artist} · {album.title}</span></div>
      <div className="jc-art"><CaseArt src={art} /></div>
      {stickers.map((s) => <StickerView key={s.kind} sticker={s} />)}
      {hero && <HeroStickerView hero={hero} />}
      <span className="jc-plastic" aria-hidden />
    </div>
  );
}

/** Hairline scratches and dust for the faces that only show once the case is open. */
function CaseWear({ seed, paper = false }: { seed: string; paper?: boolean }) {
  const wear = useMemo(() => wearFor(seed, 30, 12), [seed]);
  return (
    <svg className="jc-wear" viewBox="0 0 200 176" preserveAspectRatio={paper ? 'none' : undefined} aria-hidden focusable="false">
      <g transform="scale(1 1.4)">
        {wear.scratches.map((s, i) => (
          <line
            key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeLinecap="round"
            stroke={paper || !s.light ? '#000' : '#fff'} strokeOpacity={paper ? s.opacity * 0.5 : s.opacity} strokeWidth={s.width}
          />
        ))}
        {wear.specks.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={paper ? '#000' : '#fff'} fillOpacity={s.opacity} />)}
      </g>
    </svg>
  );
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const OPEN_MS = 800;

export interface OpenCaseProps {
  album: Album;
  art: string | null;
  tracks: Track[];
  notes: CaseNote[];
  heroId?: string;
  heroReview: Review;
  heroError?: string;
  onToggleHero: (trackId: string) => void;
  onClose: () => void;
  children?: ReactNode; // the actions shown under the case
}

/** The case opened flat: booklet and tape-deck notes on the left, the disc with its track names on the right. */
export function OpenCase({ album, art, tracks, notes, heroId, heroReview, heroError, onToggleHero, onClose, children }: OpenCaseProps) {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (reducedMotion()) {
      setOpen(true);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setOpen(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(closing.current), []);

  function close() {
    if (closing.current) return;
    if (reducedMotion()) return onClose();
    setOpen(false);
    closing.current = window.setTimeout(onClose, OPEN_MS);
  }

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
    // close() only reads refs and the stable onClose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const hero = heroId ? tracks.find((t) => t.id === heroId) : undefined;
  const heroSticker = hero ? { title: hero.title, ...heroReview } : undefined;
  const label = `${album.title}${album.artist ? ` by ${album.artist}` : ''}`;

  return (
    <div className="jc-stage" role="dialog" aria-modal="true" aria-label={`${label}, jewel case`} onClick={(e) => e.target === e.currentTarget && close()}>
      <button ref={closeRef} className="jc-close" aria-label="Close case" onClick={close}><CloseIcon /></button>
      <div className="jc-scene" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className={`jc-book ${open ? 'open' : ''}`}>
          <div className="jc-tray-face jc-face" style={wearStyle(`${album.id}:tray`)}>
            <div className="jc-rail" aria-hidden />
            <div className="jc-tray" aria-hidden />
            <div className="jc-disc">
              <div className="jc-disc-print" style={art ? { backgroundImage: `url("${art}")` } : undefined} />
              <div className="jc-disc-shade" aria-hidden />
              <div className="jc-disc-hub" aria-hidden />
              <ol className="jc-tracks" aria-label="Tracks">
                {tracks.map((t, i) => {
                  const playing = player.current?.id === t.id;
                  const isHero = t.id === heroId;
                  return (
                    <li key={`${t.id}-${i}`} className={`${playing ? 'playing' : ''} ${isHero ? 'hero' : ''}`}>
                      <button
                        className="jc-star"
                        aria-label={isHero ? `Remove hero song: ${t.title}` : `Make “${t.title}” the hero song`}
                        aria-pressed={isHero}
                        onClick={() => onToggleHero(t.id)}
                      >
                        <StarIcon filled={isHero} />
                      </button>
                      <button className="jc-track" title={t.title} onClick={() => player.play(tracks, i, 'ordered')}>
                        <span className="jc-no">{String(i + 1).padStart(2, '0')}</span>
                        <span className="jc-name">{t.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            <CaseWear seed={`${album.id}:disc`} />
            <span className="jc-plastic" aria-hidden />
          </div>

          <div className="jc-cover">
            <div className="jc-face jc-out">
              <CaseFront album={album} art={art} hero={heroSticker} />
            </div>
            <div className="jc-face jc-in" style={wearStyle(`${album.id}:in`)}>
              <div className="jc-booklet">
                <div className="jc-pinned"><CaseArt src={art} /></div>
                {notes.length > 0 && (
                  <ol className="jc-notes" aria-label="Tape deck notes">
                    {notes.map((n) => (
                      <li key={n.n}>
                        <span className="jc-no">{String(n.n).padStart(2, '0')}</span>
                        <span>{n.title && <b>{n.title}. </b>}{n.text}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <CaseWear seed={`${album.id}:booklet`} paper />
              </div>
              <div className="jc-rail jc-rail-in" aria-hidden />
              <span className="jc-plastic" aria-hidden />
            </div>
          </div>
        </div>
      </div>
      <div className="jc-actions">
        <p className="jc-caption"><strong>{album.title}</strong>{album.artist ? ` · ${album.artist}` : ''}{album.year ? ` · ${album.year}` : ''}</p>
        {children}
        {heroError && <p className="error" role="alert">{heroError}</p>}
      </div>
    </div>
  );
}
