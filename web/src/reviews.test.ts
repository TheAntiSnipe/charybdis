import { describe, expect, it } from 'vitest';
import { MAGAZINES, PHRASES, pickReview, type Review } from './reviews';

describe('the review lists', () => {
  it('have plenty of lines and no duplicates', () => {
    expect(PHRASES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(PHRASES).size).toBe(PHRASES.length);
    expect(new Set(MAGAZINES).size).toBe(MAGAZINES.length);
  });
});

describe('pickReview', () => {
  it('is stable for the same seed and shelf', () => {
    expect(pickReview([], 'a')).toEqual(pickReview([], 'a'));
  });

  it('never repeats a quote or a magazine until every one has been used', () => {
    const taken: Review[] = [];
    for (let i = 0; i < PHRASES.length; i++) taken.push(pickReview(taken, `album${i}`));
    expect(new Set(taken.map((r) => r.phrase)).size).toBe(PHRASES.length);
    expect(new Set(taken.slice(0, MAGAZINES.length).map((r) => r.source)).size).toBe(MAGAZINES.length);
  });

  it('starts a second round, evenly, once everything has been used', () => {
    const taken: Review[] = [];
    for (let i = 0; i < PHRASES.length * 2; i++) taken.push(pickReview(taken, `album${i}`));
    const counts = new Map<string, number>();
    for (const r of taken) counts.set(r.phrase, (counts.get(r.phrase) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });

  it('fills the gap when a sticker is removed', () => {
    const taken: Review[] = [];
    for (let i = 0; i < PHRASES.length; i++) taken.push(pickReview(taken, `album${i}`));
    const [removed, ...rest] = taken;
    expect(pickReview(rest, 'new').phrase).toBe(removed.phrase);
  });
});
