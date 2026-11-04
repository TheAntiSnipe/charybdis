import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { fitTitleSize, type TitleMeasure } from './heroFit';
import { useHeroes } from './heroes';

vi.mock('./api', () => ({ fetchHeroes: vi.fn(), saveHero: vi.fn() }));
const fetchHeroes = vi.mocked(api.fetchHeroes);
const saveHero = vi.mocked(api.saveHero);

describe('fitTitleSize', () => {
  // A fake title: each character is 0.8em wide, lines are 1.05em tall, and it wraps between words only.
  const fake = (title: string, width: number, maxHeight: number) => (size: number): TitleMeasure => {
    const perLine = Math.max(1, Math.floor(width / (size * 0.8)));
    const words = title.split(' ');
    let lines = 1;
    let used = 0;
    for (const w of words) {
      if (used && used + 1 + w.length > perLine) { lines++; used = w.length; } else used += (used ? 1 : 0) + w.length;
    }
    const widest = Math.max(...words.map((w) => w.length)) * size * 0.8;
    return { width, needed: Math.max(widest, Math.min(width, title.length * size * 0.8)), height: lines * size * 1.05, maxHeight };
  };

  it('leaves a short title at the maximum size', () => {
    expect(fitTitleSize(11, 4, fake('Hi', 66, 24))).toBe(11);
  });

  it('shrinks a single long word until it fits on one line', () => {
    const size = fitTitleSize(11, 4, fake('RAWFEAR', 40, 24));
    expect(size).toBeLessThan(11);
    expect(size * 0.8 * 'RAWFEAR'.length).toBeLessThanOrEqual(40);
  });

  it('shrinks a long multi-word title until it fits the height', () => {
    const size = fitTitleSize(11, 4, fake('The Ballad of Someone Who Never Stopped Talking', 66, 24));
    const m = fake('The Ballad of Someone Who Never Stopped Talking', 66, 24)(size);
    expect(m.height).toBeLessThanOrEqual(24);
  });

  it('never goes below the floor', () => {
    expect(fitTitleSize(11, 4, fake('Supercalifragilisticexpialidocious', 20, 6))).toBe(4);
  });

  it('gives up quietly when nothing is laid out yet', () => {
    expect(fitTitleSize(11, 4, () => ({ width: 0, needed: 0, height: 0, maxHeight: 0 }))).toBe(11);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchHeroes.mockResolvedValue([]);
  saveHero.mockResolvedValue(undefined);
});

describe('useHeroes', () => {
  const review = { phrase: 'is a masterpiece', source: 'NME' };

  it('loads the saved hero songs and their reviews', async () => {
    fetchHeroes.mockResolvedValue([{ albumId: 'a', trackId: 't1', ...review }]);
    const { result } = renderHook(() => useHeroes());
    await waitFor(() => expect(result.current.heroes).toEqual({ a: 't1' }));
    expect(result.current.reviews).toEqual({ a: review });
    expect(saveHero).not.toHaveBeenCalled();
  });

  it('gives heroes from before reviews existed a review that differs from the others, and saves it', async () => {
    fetchHeroes.mockResolvedValue([
      { albumId: 'a', trackId: 't1', ...review },
      { albumId: 'b', trackId: 't2' },
      { albumId: 'c', trackId: 't3' },
    ]);
    const { result } = renderHook(() => useHeroes());
    await waitFor(() => expect(Object.keys(result.current.reviews).sort()).toEqual(['a', 'b', 'c']));
    const phrases = Object.values(result.current.reviews).map((r) => r.phrase);
    expect(new Set(phrases).size).toBe(3);
    expect(result.current.reviews.a).toEqual(review);
    expect(saveHero.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c']);
    expect(saveHero).toHaveBeenCalledWith('b', 't2', result.current.reviews.b);
  });

  it('stays quiet when the load fails', async () => {
    fetchHeroes.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useHeroes());
    await act(async () => {});
    expect(result.current.heroes).toEqual({});
    expect(result.current.error).toBe('');
  });

  it('keeps one hero per album: a new pick replaces the old, the same pick clears it', async () => {
    const { result } = renderHook(() => useHeroes());
    await act(async () => {});
    await act(() => result.current.toggle('a', 't1'));
    expect(result.current.heroes).toEqual({ a: 't1' });
    const first = result.current.reviews.a;
    await act(() => result.current.toggle('a', 't2'));
    expect(result.current.heroes).toEqual({ a: 't2' });
    expect(result.current.reviews.a).toEqual(first);
    await act(() => result.current.toggle('b', 't9'));
    expect(result.current.heroes).toEqual({ a: 't2', b: 't9' });
    expect(result.current.reviews.b.phrase).not.toBe(first.phrase);
    await act(() => result.current.toggle('a', 't2'));
    expect(result.current.heroes).toEqual({ b: 't9' });
    expect(Object.keys(result.current.reviews)).toEqual(['b']);
    expect(saveHero.mock.calls.map((c) => c.slice(0, 2))).toEqual([['a', 't1'], ['a', 't2'], ['b', 't9'], ['a', null]]);
    expect(saveHero.mock.calls[0][2]).toEqual(first);
  });

  it('shows the pick at once and puts things back if the server refuses', async () => {
    let refuse!: (e: Error) => void;
    saveHero.mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
    fetchHeroes.mockResolvedValue([{ albumId: 'a', trackId: 't1', ...review }]);
    const { result } = renderHook(() => useHeroes());
    await waitFor(() => expect(result.current.heroes).toEqual({ a: 't1' }));

    let pending!: Promise<void>;
    act(() => { pending = result.current.toggle('a', 't2'); });
    expect(result.current.heroes).toEqual({ a: 't2' });
    await act(async () => { refuse(new Error('That song is not on this album')); await pending; });
    expect(result.current.heroes).toEqual({ a: 't1' });
    expect(result.current.reviews).toEqual({ a: review });
    expect(result.current.error).toBe('That song is not on this album');
  });

  it('does not let a slow first load undo a pick made while it was in flight', async () => {
    let answer!: (list: api.HeroRecord[]) => void;
    fetchHeroes.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useHeroes());
    await act(() => result.current.toggle('a', 't2'));
    await act(async () => { answer([{ albumId: 'a', trackId: 't1', ...review }, { albumId: 'b', trackId: 't5', ...review }]); });
    expect(result.current.heroes).toEqual({ a: 't2', b: 't5' });
    expect(result.current.reviews.b).toEqual(review);
    expect(result.current.reviews.a).not.toEqual(review);
  });
});
