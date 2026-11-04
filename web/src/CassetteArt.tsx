import { CSSProperties, ReactNode, useId, useMemo, useState } from 'react';
import { generatedCover } from './tapes';
import { LEFT_X, REEL_Y, RIGHT_X, tapeGeometry } from './tapeGeometry';
import type { CassetteStyle } from './types';
import { wearFor } from './wear';

export interface CassetteLook {
  style: CassetteStyle;
  title: string;
  shell: string;
  seed: string; // drives the generated cover
  covers: string[]; // album art, used by the "cover" style
  length: string; // printed on an "executive" blank, e.g. C-60
  progress: number; // 0..1 through the whole tape; only the "clear" style shows it
}

/** Hand-lettered titles shrink for long names so they still wrap onto two lines. */
function labelScale(title: string): number {
  const length = title.trim().length;
  if (length <= 14) return 1;
  if (length <= 28) return 0.78;
  return 0.6;
}

const HUB_TEETH = [0, 60, 120, 180, 240, 300];

function Reel({ cx, pack }: { cx: number; pack: number }) {
  return (
    <g>
      <circle data-pack={cx < 100 ? 'left' : 'right'} cx={cx} cy={REEL_Y} r={pack} fill="#2d2019" />
      <circle cx={cx} cy={REEL_Y} r={pack} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" />
      <g className="reel">
        <circle cx={cx} cy={REEL_Y} r="8.4" fill="#eee7d6" />
        <circle cx={cx} cy={REEL_Y} r="5" fill="#2b1f1a" />
        {HUB_TEETH.map((deg) => (
          <rect key={deg} x={cx - 1} y={REEL_Y - 5.1} width="2" height="2.9" fill="#eee7d6" transform={`rotate(${deg} ${cx} ${REEL_Y})`} />
        ))}
      </g>
    </g>
  );
}

/** The pill-shaped window with both reels, as on a real cassette. */
function PillWindow({ uid, pack = 12.4 }: { uid: string; pack?: number }) {
  return (
    <>
      <rect x="43.5" y="43.5" width="113" height="27.5" rx="13.75" fill="var(--shell)" stroke="rgba(0,0,0,0.3)" strokeWidth="0.8" />
      <rect x="43.5" y="43.5" width="113" height="27.5" rx="13.75" fill={`url(#${uid}s)`} />
      <Reel cx={LEFT_X} pack={pack} />
      <Reel cx={RIGHT_X} pack={pack} />
      <rect x="78.5" y="46" width="43" height="22.5" rx="2" fill="#171021" />
      <rect x="78.5" y="55.6" width="43" height="3" fill="#5a4033" />
    </>
  );
}

function Defs({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
        <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.24" />
      </linearGradient>
      <pattern id={`${uid}r`} width="2.4" height="2.4" patternUnits="userSpaceOnUse">
        <path d="M0 .6H2.4M.6 0V2.4" stroke="#000" strokeOpacity="0.1" strokeWidth="0.5" />
      </pattern>
    </defs>
  );
}

const HOLES = (
  <>
    <circle cx="52" cy="113.5" r="3.3" fill="#1a1020" />
    <rect x="67.5" y="110.2" width="7" height="6.6" rx="1.1" fill="#1a1020" />
    <rect x="125.5" y="110.2" width="7" height="6.6" rx="1.1" fill="#1a1020" />
    <circle cx="148" cy="113.5" r="3.3" fill="#1a1020" />
  </>
);

/** Opaque, ribbed plastic shell shared by the printed-label styles. */
function SolidShell({ uid }: { uid: string }) {
  return (
    <svg className="cassette-shell" viewBox="0 0 200 126" aria-hidden focusable="false">
      <Defs uid={uid} />
      <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" fill="var(--shell)" />
      <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" fill={`url(#${uid}r)`} />
      <path d="M38 124.8 52 95h96l14 29.8Z" fill="rgba(0,0,0,0.11)" stroke="rgba(0,0,0,0.22)" strokeWidth="0.6" />
      {HOLES}
      <circle cx="11" cy="116" r="2.3" fill="rgba(0,0,0,0.3)" />
      <circle cx="189" cy="116" r="2.3" fill="rgba(0,0,0,0.3)" />
      <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" fill={`url(#${uid}s)`} />
      <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" fill="none" stroke="#240657" strokeWidth="2.4" />
    </svg>
  );
}

function Screw({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="3.1" fill="#b9c0c6" stroke="#6c747a" strokeWidth="0.6" />
      <path d={`M${x - 1.8} ${y - 0.3}h3.6`} stroke="#6c747a" strokeWidth="0.7" />
    </g>
  );
}

/** Whole shell see-through: you can watch the tape move from the left reel to the right as it plays. */
function ClearCassette({ uid, progress }: { uid: string; progress: number }) {
  const g = tapeGeometry(progress);
  return (
    <svg className="cassette-shell" viewBox="0 0 200 126" aria-hidden focusable="false">
      <Defs uid={uid} />
      <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" fill="rgba(214,230,242,0.13)" />
      <rect x="5.5" y="5.5" width="189" height="89" rx="5" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
      <path d="M38 124.8 52 95h96l14 29.8Z" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.38)" strokeWidth="0.7" />
      {HOLES}
      <Reel cx={LEFT_X} pack={g.leftPack.r} />
      <Reel cx={RIGHT_X} pack={g.rightPack.r} />
      <path d={g.path} fill="none" stroke="#2d2019" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={g.leftRoller.x} cy={g.leftRoller.y} r={g.leftRoller.r} fill="#aab2b8" stroke="#6c747a" strokeWidth="0.7" />
      <circle cx={g.rightRoller.x} cy={g.rightRoller.y} r={g.rightRoller.r} fill="#aab2b8" stroke="#6c747a" strokeWidth="0.7" />
      <rect x="91" y="96.5" width="18" height="9" rx="1.5" fill="#7a6a4a" stroke="rgba(0,0,0,0.35)" strokeWidth="0.6" />
      <rect x="88" y="105" width="24" height="2" rx="1" fill="#aab2b8" />
      {[[9, 9], [191, 9], [9, 117], [191, 117], [69, 103], [131, 103]].map(([x, y]) => <Screw key={`${x}-${y}`} x={x} y={y} />)}
      <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" fill={`url(#${uid}s)`} opacity="0.55" />
      <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" />
    </svg>
  );
}

function ExecutiveLabel({ uid, title, length }: { uid: string; title: string; length: string }) {
  const size = 8.4 * labelScale(title);
  const squeeze = title.trim().length * 0.56 * size > 166; // squeeze very long titles onto the line instead of running off it
  return (
    <svg className="cassette-print" viewBox="0 0 200 126" aria-hidden focusable="false">
      <rect x="6" y="7" width="188" height="88" rx="4" fill="#2b2f34" />
      <rect x="8.6" y="9.3" width="182.8" height="82.7" rx="2.5" fill="#9fc6ee" />
      <rect x="8.6" y="9.3" width="182.8" height="82.7" rx="2.5" fill={`url(#${uid}s)`} opacity="0.5" />
      {[19, 28.5, 38].map((y) => <line key={y} x1="13" x2="187" y1={y} y2={y} stroke="#14264a" strokeWidth="0.55" />)}
      <text
        x="15" y="17.6" fill="#101c3a" fontFamily="'Permanent Marker', 'Segoe Print', cursive" fontSize={size}
        {...(squeeze ? { textLength: 166, lengthAdjust: 'spacingAndGlyphs' as const } : {})}
      >
        {title}
      </text>
      <PillWindow uid={uid} />
      <text x="12" y="59.5" fill="#0d1b3a" fontFamily="system-ui, Arial, sans-serif" fontWeight="800" fontSize="9">{length}</text>
      <text x="162" y="58" fill="#0d1b3a" fontFamily="system-ui, Arial, sans-serif" fontWeight="700" fontSize="6">SIDE</text>
      <text x="177" y="57.4" fill="#101c3a" fontFamily="'Permanent Marker', cursive" fontSize="8">A</text>
      <line x1="175" x2="190" y1="59.2" y2="59.2" stroke="#0d1b3a" strokeWidth="0.5" />
      <path d="M30 76.5 38.5 82 30 87.5 21.5 82Z" fill="none" stroke="#0d1b3a" strokeWidth="0.9" />
      <text x="30" y="84.1" textAnchor="middle" fill="#0d1b3a" fontFamily="system-ui, Arial, sans-serif" fontWeight="800" fontSize="5.6">C</text>
      <text x="100" y="79" textAnchor="middle" fill="#0d1b3a" fontFamily="system-ui, Arial, sans-serif" fontWeight="800" fontSize="5.4" letterSpacing="0.3">QUALITY CASSETTE</text>
      <text x="100" y="85.6" textAnchor="middle" fill="#0d1b3a" fontFamily="system-ui, Arial, sans-serif" fontWeight="600" fontSize="4.6" letterSpacing="0.5">CHARYBDIS</text>
      <text x="188" y="82.2" textAnchor="end" fill="#0d1b3a" fontFamily="system-ui, Arial, sans-serif" fontWeight="700" fontSize="4.4">HIGH ENERGY</text>
      <text x="188" y="87.2" textAnchor="end" fill="#0d1b3a" fontFamily="system-ui, Arial, sans-serif" fontWeight="700" fontSize="4.4">MASTERING</text>
    </svg>
  );
}

/** Years of handling: hairline scratches, dust and a faint amber cast. The clear shell yellows and scratches most. */
function WearOverlay({ uid, seed, clear }: { uid: string; seed: string; clear: boolean }) {
  const wear = useMemo(() => wearFor(seed, clear ? 34 : 26), [seed, clear]);
  return (
    <svg className="cassette-wear" viewBox="0 0 200 126" aria-hidden focusable="false">
      <defs>
        <clipPath id={`${uid}c`}>
          <rect x="1.2" y="1.2" width="197.6" height="123.6" rx="9" />
        </clipPath>
        <radialGradient id={`${uid}y`} cx="0.5" cy="0.4" r="0.75">
          <stop offset="0.45" stopColor="#d9a93a" stopOpacity={clear ? 0.06 : 0.02} />
          <stop offset="1" stopColor="#8a5a10" stopOpacity={clear ? 0.26 : 0.17} />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${uid}c)`}>
        <rect width="200" height="126" fill={`url(#${uid}y)`} />
        {wear.scratches.map((s, i) => (
          <line
            key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeLinecap="round"
            stroke={s.light ? '#fff' : '#000'} strokeOpacity={s.opacity} strokeWidth={s.width}
          />
        ))}
        {wear.specks.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" fillOpacity={s.opacity} />)}
      </g>
    </svg>
  );
}

/** A colourful abstract cover, the same every time for the same tape. */
function GeneratedArt({ uid, seed }: { uid: string; seed: string }) {
  const g = generatedCover(seed);
  return (
    <svg className="cassette-genart" viewBox="0 0 183 83" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={g.from} />
          <stop offset="1" stopColor={g.to} />
        </linearGradient>
      </defs>
      <rect width="183" height="83" fill={`url(#${uid}g)`} />
      <rect x="-20" y="58" width="230" height="16" fill={g.to} opacity="0.5" transform={`rotate(${g.band} 91 66)`} />
      <circle cx={g.discX * 2.4} cy="48" r={g.discR * 1.7} fill={g.disc} opacity="0.85" />
      <circle cx={g.discX * 2.4} cy="48" r={g.discR * 0.95} fill={g.to} />
      <circle cx={g.discX * 2.4} cy="48" r={g.ringR} fill="none" stroke={g.disc} strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}

export default function CassetteArt({ look, playing, rewinding = false }: { look: CassetteLook; playing: boolean; rewinding?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [artFailed, setArtFailed] = useState(false);
  const style = { '--shell': look.style === 'executive' ? '#e4ebf0' : look.shell, '--scale': labelScale(look.title) } as CSSProperties;
  const covers = look.style === 'cover' && !artFailed ? look.covers : [];
  const classes = `cassette cassette-${look.style} ${playing ? 'playing' : ''} ${rewinding ? 'rewinding' : ''}`;
  let body: ReactNode;

  if (look.style === 'clear') {
    body = (
      <>
        <ClearCassette uid={uid} progress={look.progress} />
        <span className="cassette-label">{look.title}</span>
        <WearOverlay uid={uid} seed={look.seed} clear />
      </>
    );
  } else if (look.style === 'executive') {
    body = (
      <>
        <SolidShell uid={uid} />
        <ExecutiveLabel uid={uid} title={look.title} length={look.length} />
        <WearOverlay uid={uid} seed={look.seed} clear={false} />
      </>
    );
  } else {
    body = (
      <>
        <SolidShell uid={uid} />
        <div className="cassette-face">
          {covers.length > 0 ? (
            <div className="cassette-covers">
              {covers.map((src) => (
                <img key={src} src={src} alt="" draggable={false} onError={() => setArtFailed(true)} />
              ))}
            </div>
          ) : (
            <GeneratedArt uid={uid} seed={look.seed} />
          )}
          <span className="cassette-label">{look.title}</span>
          <span className="cassette-side" aria-hidden>SIDE A</span>
        </div>
        <svg className="cassette-window" viewBox="0 0 200 126" aria-hidden focusable="false">
          <PillWindow uid={uid} />
        </svg>
        <WearOverlay uid={uid} seed={look.seed} clear={false} />
      </>
    );
  }

  return <div className={classes} style={style}>{body}</div>;
}
