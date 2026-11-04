import { describe, expect, it } from 'vitest';
import { barcodeFor, caseNotes, stickersFor } from './jewel';
import type { Cassette, JournalEntry } from './types';

const album = { id: 'aaaaaaaaaaaa', trackIds: ['t1', 't2', 't3'] };

describe('stickersFor', () => {
  it('gives every case at least one sticker, the same ones every time', () => {
    for (let i = 0; i < 60; i++) {
      const a = { id: `album${i}`, trackIds: ['t1'] };
      const stickers = stickersFor(a);
      expect(stickers.length).toBeGreaterThan(0);
      expect(stickers).toEqual(stickersFor(a));
    }
  });

  it('never puts two stickers in the same corner or repeats a kind', () => {
    for (let i = 0; i < 200; i++) {
      const stickers = stickersFor({ id: `album${i}`, trackIds: ['t1', 't2'] });
      expect(new Set(stickers.map((s) => s.corner)).size).toBe(stickers.length);
      expect(new Set(stickers.map((s) => s.kind)).size).toBe(stickers.length);
    }
  });

  it('keeps the top-right corner and drops the generic hype sticker when the album has a hero song', () => {
    for (let i = 0; i < 200; i++) {
      const stickers = stickersFor({ id: `album${i}`, trackIds: ['t1', 't2'] }, true);
      expect(stickers.some((s) => s.corner === 'tr')).toBe(false);
      expect(stickers.some((s) => s.kind === 'hype')).toBe(false);
      expect(stickers.length).toBeGreaterThan(0);
    }
  });

  it('states the real track count, and a price that looks like a price', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      for (const s of stickersFor({ id: `album${i}`, trackIds: ['a', 'b', 'c', 'd'] })) {
        if (s.kind === 'hype') expect(s.text).toBe('4 TRACKS');
        if (s.kind === 'price') expect(s.text).toMatch(/^\$\d{1,2}\.\d\d$/);
        seen.add(s.kind);
      }
    }
    expect(seen).toEqual(new Set(['price', 'hype', 'barcode']));
  });
});

describe('barcodeFor', () => {
  it('is stable, 12 digits, and its bars stay inside the label', () => {
    const code = barcodeFor('aaaaaaaaaaaa');
    expect(code).toEqual(barcodeFor('aaaaaaaaaaaa'));
    expect(code.digits).toMatch(/^\d{12}$/);
    expect(code.bars.length).toBeGreaterThan(10);
    for (const b of code.bars) expect(b.x + b.w).toBeLessThanOrEqual(96);
  });
});

describe('caseNotes', () => {
  const tape = (extra: Partial<Cassette> = {}): Cassette => ({
    id: 'album-aaaaaaaaaaaa', kind: 'album', sourceId: 'aaaaaaaaaaaa', label: 'A', trackIds: ['t1', 't2', 't3'], pages: [],
    progress: { index: 0, positionSec: 0 }, status: 'shelf', createdAt: 1, ...extra,
  });
  const entry = (slot: number, text: string, cassetteId = 'album-aaaaaaaaaaaa'): JournalEntry => ({ cassetteId, slot, text, updatedAt: 1 });
  const titleOf = (id: string) => `Title of ${id}`;

  it('is empty when the album has no tape, or the tape has no notes', () => {
    expect(caseNotes(album.id, [], [entry(0, 'hi')], titleOf)).toEqual([]);
    expect(caseNotes(album.id, [tape()], [], titleOf)).toEqual([]);
    expect(caseNotes(album.id, [tape()], [entry(0, '   ')], titleOf)).toEqual([]);
  });

  it('lists only this album’s tape, in order, numbered from 1, without song titles until the tape is finished', () => {
    const entries = [entry(2, ' third '), entry(0, 'first'), entry(1, 'elsewhere', 'album-bbbbbbbbbbbb')];
    expect(caseNotes(album.id, [tape()], entries, titleOf)).toEqual([
      { n: 1, text: 'first', title: undefined },
      { n: 3, text: 'third', title: undefined },
    ]);
  });

  it('shows the song titles once the tape is finished', () => {
    const notes = caseNotes(album.id, [tape({ status: 'finished' })], [entry(0, 'first')], titleOf);
    expect(notes).toEqual([{ n: 1, text: 'first', title: 'Title of t1' }]);
  });
});
