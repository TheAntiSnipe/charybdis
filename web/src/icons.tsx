import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
};

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.1-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" /></svg>
);

export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="6" y="4.5" width="4.5" height="15" rx="1.2" />
    <rect x="13.5" y="4.5" width="4.5" height="15" rx="1.2" />
  </svg>
);

export const PrevIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="5" width="2.6" height="14" rx="1.1" />
    <path d="M19.5 6.2v11.6a.9.9 0 0 1-1.4.75l-8.5-5.8a.9.9 0 0 1 0-1.5l8.5-5.8a.9.9 0 0 1 1.4.75Z" />
  </svg>
);

export const NextIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="16.9" y="5" width="2.6" height="14" rx="1.1" />
    <path d="M4.5 6.2v11.6a.9.9 0 0 0 1.4.75l8.5-5.8a.9.9 0 0 0 0-1.5L5.9 5.45a.9.9 0 0 0-1.4.75Z" />
  </svg>
);

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </svg>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="m5 9 7 7 7-7" />
  </svg>
);

export const ShuffleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 7h3.5c2.2 0 3.6 1.1 4.8 3l1.4 2.2c1.2 1.9 2.6 3 4.8 3H21" />
    <path d="M3 17h3.5c1.6 0 2.7-.6 3.7-1.7" />
    <path d="M13.8 8.7c1-1.1 2-1.7 3.5-1.7H21" />
    <path d="M18.5 4.5 21 7l-2.5 2.5" />
    <path d="M18.5 14.5 21 17l-2.5 2.5" />
  </svg>
);

export const EqualizerIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} className={`eq ${p.className ?? ''}`}>
    <rect className="eq-bar b1" x="4" y="8" width="4" height="12" rx="1" />
    <rect className="eq-bar b2" x="10" y="4" width="4" height="16" rx="1" />
    <rect className="eq-bar b3" x="16" y="10" width="4" height="10" rx="1" />
  </svg>
);
