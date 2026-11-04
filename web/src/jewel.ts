import { findTape } from './tapes';
import type { Album, Cassette, JournalEntry } from './types';
import { hash, random } from './wear';

// A real jewel case is 142 x 125 mm.
export const CASE_RATIO = 125 / 142;

export type StickerKind = 'price' | 'hype' | 'barcode';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface Sticker {
  kind: StickerKind;
  corner: Corner;
  rotate: number; // degrees; nobody sticks these on straight
  text: string;
  bars?: { x: number; w: number }[];
}

const PREFERRED: Record<StickerKind, Corner[]> = {
  barcode: ['bl', 'br'],
  price: ['br', 'tr', 'bl'],
  hype: ['tr', 'tl'],
};

export const BARCODE_WIDTH = 100;

/** Looks like a barcode, reads like one to the eye. Nothing scans it. */
export function barcodeFor(seed: string): { digits: string; bars: { x: number; w: number }[] } {
  const rand = random(hash(`bars:${seed}`));
  let digits = '';
  for (let i = 0; i < 12; i++) digits += Math.floor(rand() * 10);
  const bars: { x: number; w: number }[] = [];
  let x = 4;
  let ink = true;
  while (x < BARCODE_WIDTH - 4) {
    const w = 1 + Math.floor(rand() * 3);
    if (ink && x + w <= BARCODE_WIDTH - 4) bars.push({ x, w });
    x += w;
    ink = !ink;
  }
  return { digits, bars };
}

/**
 * The stickers a case has picked up: always at least one, and the same every time for the same album. An album
 * with a hero song keeps its top-right corner for that sticker and skips the generic hype one.
 */
export function stickersFor(album: Pick<Album, 'id' | 'trackIds'>, hasHero = false): Sticker[] {
  const rand = random(hash(`case:${album.id}`));
  const kinds: StickerKind[] = hasHero ? ['price', 'barcode'] : ['price', 'hype', 'barcode'];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const extra = (rand() < 0.55 ? 1 : 0) + (rand() < 0.2 ? 1 : 0);
  const taken = new Set<Corner>(hasHero ? ['tr'] : []);
  const out: Sticker[] = [];
  for (const kind of kinds.slice(0, 1 + extra)) {
    const corner = [...PREFERRED[kind], 'tl', 'bl', 'br', 'tr'].find((c) => !taken.has(c as Corner)) as Corner | undefined;
    if (!corner) break;
    taken.add(corner);
    const rotate = Math.round((rand() - 0.5) * 14);
    if (kind === 'price') {
      const cents = [99, 49, 95, 98][Math.floor(rand() * 4)];
      out.push({ kind, corner, rotate, text: `$${3 + Math.floor(rand() * 15)}.${cents}` });
    } else if (kind === 'hype') {
      const n = album.trackIds.length;
      out.push({ kind, corner, rotate, text: `${n} TRACK${n === 1 ? '' : 'S'}` });
    } else {
      const { digits, bars } = barcodeFor(album.id);
      out.push({ kind, corner, rotate, text: digits, bars });
    }
  }
  return out;
}

export interface CaseNote {
  n: number; // the line number on the tape, starting at 1
  text: string;
  title?: string; // only once the tape is finished; until then the notes stay blind
}

/** What was written on this album's cassette, line by line. Empty when there is no tape or nothing written. */
export function caseNotes(
  albumId: string,
  cassettes: Cassette[],
  entries: JournalEntry[],
  titleOf: (trackId: string) => string | undefined,
): CaseNote[] {
  const tape = findTape(cassettes, 'album', albumId);
  if (!tape) return [];
  const finished = tape.status === 'finished';
  return entries
    .filter((e) => e.cassetteId === tape.id && e.text.trim())
    .sort((a, b) => a.slot - b.slot)
    .map((e) => ({
      n: e.slot + 1,
      text: e.text.trim(),
      title: finished && tape.trackIds[e.slot] ? titleOf(tape.trackIds[e.slot]) : undefined,
    }));
}
