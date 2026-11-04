import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHeroes, saveHero } from './api';
import { pickReview, type Review } from './reviews';

export type { Review } from './reviews';

/** albumId to the one song that album is known for. */
export type Heroes = Record<string, string>;

export function useHeroes() {
  const [heroes, setHeroes] = useState<Heroes>({});
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [error, setError] = useState('');
  const heroesRef = useRef(heroes);
  heroesRef.current = heroes;
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;
  // Albums changed here since the first load started; the slower, older answer from the server must not undo them.
  const touched = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const list = await fetchHeroes();
      const nextHeroes: Heroes = {};
      const nextReviews: Record<string, Review> = {};
      for (const h of list) {
        if (touched.current.has(h.albumId)) continue;
        nextHeroes[h.albumId] = h.trackId;
        if (h.phrase && h.source) nextReviews[h.albumId] = { phrase: h.phrase, source: h.source };
      }
      for (const id of touched.current) {
        if (!(id in heroesRef.current)) continue;
        nextHeroes[id] = heroesRef.current[id];
        if (id in reviewsRef.current) nextReviews[id] = reviewsRef.current[id];
      }
      // Heroes from before reviews existed get one now, chosen so it does not repeat, and it is saved so it stays.
      const taken = Object.values(nextReviews);
      for (const [albumId, trackId] of Object.entries(nextHeroes)) {
        if (nextReviews[albumId]) continue;
        const review = pickReview(taken, albumId);
        taken.push(review);
        nextReviews[albumId] = review;
        void saveHero(albumId, trackId, review).catch(() => {});
      }
      setHeroes(nextHeroes);
      setReviews(nextReviews);
    } catch {
      // Stickers are decoration; a failed load just means none show until the next attempt.
    }
  }, []);

  useEffect(() => {
    void load();
    const onOnline = () => void load();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load]);

  /** Picking the current hero again takes the sticker off. Shows at once and rolls back if the server refuses. */
  const toggle = useCallback(async (albumId: string, trackId: string) => {
    const before = heroesRef.current[albumId];
    const beforeReview = reviewsRef.current[albumId];
    const after = before === trackId ? null : trackId;
    // A new sticker gets wording nobody else on the shelf has (until every line has been used); a changed song keeps its review.
    const others = Object.entries(reviewsRef.current).filter(([id]) => id !== albumId).map(([, r]) => r);
    const review = after ? beforeReview ?? pickReview(others, `${albumId}:${after}`) : undefined;
    touched.current.add(albumId);
    setError('');
    const apply = (track: string | undefined, rev: Review | undefined) => {
      const update = <T,>(current: Record<string, T>, value: T | undefined) => {
        const next = { ...current };
        if (value) next[albumId] = value;
        else delete next[albumId];
        return next;
      };
      setHeroes((current) => update(current, track));
      setReviews((current) => update(current, rev));
    };
    apply(after ?? undefined, review);
    try {
      await saveHero(albumId, after, review);
    } catch (err) {
      apply(before, beforeReview);
      setError((err as Error).message);
    }
  }, []);

  return { heroes, reviews, toggle, error };
}

export type HeroStore = ReturnType<typeof useHeroes>;
