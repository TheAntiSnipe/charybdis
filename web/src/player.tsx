import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from './types';

interface PlayerApi {
  current: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  upNext: Track[];
  play: (queue: Track[], index: number, mode?: 'ordered' | 'shuffled') => void;
  jumpTo: (upNextIndex: number) => void;
  playShuffled: (queue: Track[]) => void;
  toggleShuffle: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
}

const SHUFFLE_KEY = 'charybdis.shuffle';

// Fisher-Yates over indices, so a track that appears twice in a playlist stays twice.
function shuffledOrder(length: number, first: number): number[] {
  const rest = Array.from({ length }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}

const PlayerContext = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}

export function PlayerProvider({ artFor, children }: { artFor: (t: Track) => string | null; children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.preload = 'auto';
  }
  const audio = audioRef.current;

  const queueRef = useRef<Track[]>([]);
  const originalRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(() => localStorage.getItem(SHUFFLE_KEY) === '1');
  const [queueVersion, setQueueVersion] = useState(0);
  const shuffleRef = useRef(shuffle);

  // play() must be called synchronously inside the user's tap or iOS Safari blocks it.
  const start = useCallback((index: number) => {
    const track = queueRef.current[index];
    if (!track) return;
    indexRef.current = index;
    audio.src = `/${track.key}`;
    setCurrent(track);
    setPosition(0);
    setDuration(track.durationSec);
    audio.play().catch(() => setPlaying(false));
  }, [audio]);

  const play = useCallback((queue: Track[], index: number, mode?: 'ordered' | 'shuffled') => {
    if (mode) {
      const on = mode === 'shuffled';
      shuffleRef.current = on;
      localStorage.setItem(SHUFFLE_KEY, on ? '1' : '0');
      setShuffle(on);
    }
    originalRef.current = queue;
    setQueueVersion((v) => v + 1);
    if (shuffleRef.current) {
      queueRef.current = shuffledOrder(queue.length, index).map((i) => queue[i]);
      start(0);
    } else {
      queueRef.current = queue;
      start(index);
    }
  }, [start]);

  const playShuffled = useCallback((queue: Track[]) => {
    if (queue.length) play(queue, Math.floor(Math.random() * queue.length), 'shuffled');
  }, [play]);

  const jumpTo = useCallback((upNextIndex: number) => start(indexRef.current + 1 + upNextIndex), [start]);

  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current;
    shuffleRef.current = on;
    localStorage.setItem(SHUFFLE_KEY, on ? '1' : '0');
    setShuffle(on);

    const playingTrack = queueRef.current[indexRef.current];
    if (!playingTrack) return;
    if (on) {
      // Keep what's playing now, shuffle everything else in the list.
      const original = originalRef.current;
      const at = Math.max(0, original.indexOf(playingTrack));
      queueRef.current = shuffledOrder(original.length, at).map((i) => original[i]);
      indexRef.current = 0;
    } else {
      queueRef.current = originalRef.current;
      indexRef.current = Math.max(0, originalRef.current.indexOf(playingTrack));
    }
  }, []);

  const next = useCallback(() => {
    if (indexRef.current + 1 < queueRef.current.length) {
      start(indexRef.current + 1);
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [audio, start]);

  const prev = useCallback(() => {
    if (audio.currentTime > 3 || indexRef.current <= 0) {
      audio.currentTime = 0;
    } else {
      start(indexRef.current - 1);
    }
  }, [audio, start]);

  const toggle = useCallback(() => {
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [audio]);

  const seek = useCallback((seconds: number) => {
    audio.currentTime = seconds;
    setPosition(seconds);
  }, [audio]);

  useEffect(() => {
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setPosition(audio.currentTime);
    const onDuration = () => Number.isFinite(audio.duration) && setDuration(audio.duration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('ended', next);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('ended', next);
    };
  }, [audio, next]);

  // Home unmounts on sign-out; the Audio element is detached from the DOM so it must be stopped explicitly.
  useEffect(() => () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as const) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    }
  }, [audio]);

  // Lock-screen / control-center integration
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    const art = artFor(current);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: art ? [{ src: new URL(art, location.origin).href, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
    const session = navigator.mediaSession;
    session.setActionHandler('play', () => audio.play());
    session.setActionHandler('pause', () => audio.pause());
    session.setActionHandler('previoustrack', prev);
    session.setActionHandler('nexttrack', next);
    session.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime));
  }, [audio, current, artFor, next, prev, seek]);

  // Recomputed when the track or shuffle mode changes; reads the queue refs at that moment.
  const upNext = useMemo(
    () => queueRef.current.slice(indexRef.current + 1, indexRef.current + 1 + 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, shuffle, queueVersion],
  );

  const value = useMemo(
    () => ({ current, playing, position, duration, shuffle, upNext, play, jumpTo, playShuffled, toggleShuffle, toggle, next, prev, seek }),
    [current, playing, position, duration, shuffle, upNext, play, jumpTo, playShuffled, toggleShuffle, toggle, next, prev, seek],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
