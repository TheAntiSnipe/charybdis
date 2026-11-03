import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from './types';

interface TapeInfo {
  id: string;
  kind: 'album' | 'artist';
  label: string;
  slot: number; // zero-based position on the tape; deliberately the only thing the deck can learn about the song
  total: number;
  totalSec: number; // length of the whole tape: it is what a blank's "C-60" label says
}

export interface TapeLoad {
  id: string;
  kind: 'album' | 'artist';
  label: string;
  tracks: Track[];
  index: number;
  positionSec: number;
}

interface PlayerApi {
  current: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  upNext: Track[];
  tape: TapeInfo | null;
  tapeEnded: boolean;
  /** How far along the whole tape (0..1). Only the "clear" cassette style shows it, as the reels trading tape. */
  tapeProgress: number;
  play: (queue: Track[], index: number, mode?: 'ordered' | 'shuffled') => void;
  jumpTo: (upNextIndex: number) => void;
  playShuffled: (queue: Track[]) => void;
  toggleShuffle: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  loadTape: (tape: TapeLoad) => void;
  relabelTape: (id: string, label: string) => void;
  rewind: () => void;
  eject: () => void;
}

const SHUFFLE_KEY = 'charybdis.shuffle';
const TAPE_SAVE_EVERY_MS = 15_000;
const TAPE_ONLY_ACTIONS = ['previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'] as const;

export function tapeTitle(kind: 'album' | 'artist', label: string): string {
  return kind === 'album' ? `${label} cassette` : `${label} mixtape`;
}

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

export function PlayerProvider({
  artFor,
  onTapeProgress,
  children,
}: {
  artFor: (t: Track) => string | null;
  onTapeProgress?: (cassetteId: string, index: number, positionSec: number) => void;
  children: ReactNode;
}) {
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

  // Tape mode: `current` stays null so nothing that renders song details can see what is playing.
  type TapeState = { id: string; kind: 'album' | 'artist'; label: string; tracks: Track[]; index: number; starts: number[]; totalSec: number };
  const tapeRef = useRef<TapeState | null>(null);
  const [tape, setTape] = useState<TapeInfo | null>(null);
  const [tapeEnded, setTapeEnded] = useState(false);
  const [tapeProgress, setTapeProgress] = useState(0);
  const lastProgressRef = useRef(0);
  const lastSaveRef = useRef(0);
  const onTapeProgressRef = useRef(onTapeProgress);
  onTapeProgressRef.current = onTapeProgress;

  const saveTapeNow = useCallback((position?: number) => {
    const t = tapeRef.current;
    if (!t) return;
    lastSaveRef.current = Date.now();
    onTapeProgressRef.current?.(t.id, t.index, position ?? (Number.isFinite(audio.currentTime) ? audio.currentTime : 0));
  }, [audio]);

  // How far along the whole tape we are (0..1). Quantised so a quarter-second tick doesn't re-render the deck.
  const publishProgress = useCallback((seconds: number) => {
    const t = tapeRef.current;
    if (!t) return;
    const into = Math.min(Math.max(seconds, 0), t.tracks[t.index].durationSec);
    const fraction = t.totalSec > 0 ? Math.min(1, (t.starts[t.index] + into) / t.totalSec) : 0;
    if (Math.abs(fraction - lastProgressRef.current) >= 0.002 || fraction === 0 || fraction === 1) {
      lastProgressRef.current = fraction;
      setTapeProgress(fraction);
    }
  }, []);

  // Loads a tape slot; autoplay is only allowed from inside a user tap on iOS.
  const startTape = useCallback((index: number, positionSec: number, autoplay: boolean) => {
    const t = tapeRef.current;
    const track = t?.tracks[index];
    if (!t || !track) return;
    t.index = index;
    lastSaveRef.current = Date.now();
    audio.src = `/${track.key}`;
    if (positionSec > 0) {
      const src = audio.src;
      audio.addEventListener('loadedmetadata', () => { if (audio.src === src) audio.currentTime = positionSec; }, { once: true });
    }
    setTape({ id: t.id, kind: t.kind, label: t.label, slot: index, total: t.tracks.length, totalSec: t.totalSec });
    publishProgress(positionSec);
    if (autoplay) audio.play().catch(() => setPlaying(false));
  }, [audio, publishProgress]);

  const eject = useCallback(() => {
    if (!tapeRef.current) return;
    saveTapeNow();
    tapeRef.current = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setTape(null);
    setTapeEnded(false);
    setTapeProgress(0);
    lastProgressRef.current = 0;
    setPlaying(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
  }, [audio, saveTapeNow]);

  const loadTape = useCallback((load: TapeLoad) => {
    if (tapeRef.current && tapeRef.current.id !== load.id) saveTapeNow();
    audio.pause();
    queueRef.current = [];
    originalRef.current = [];
    indexRef.current = -1;
    setCurrent(null);
    setPosition(0);
    setDuration(0);
    setQueueVersion((v) => v + 1);
    setTapeEnded(false);
    const index = Math.min(Math.max(load.index, 0), Math.max(load.tracks.length - 1, 0));
    const starts: number[] = [];
    let totalSec = 0;
    for (const track of load.tracks) {
      starts.push(totalSec);
      totalSec += track.durationSec;
    }
    tapeRef.current = { id: load.id, kind: load.kind, label: load.label, tracks: load.tracks, index, starts, totalSec };
    startTape(index, load.positionSec, false);
  }, [audio, saveTapeNow, startTape]);

  // The user renamed the tape in the deck; keep the lock screen in step.
  const relabelTape = useCallback((id: string, label: string) => {
    const t = tapeRef.current;
    if (!t || t.id !== id || t.label === label) return;
    t.label = label;
    setTape((info) => (info && info.id === id ? { ...info, label } : info));
  }, []);

  const rewind = useCallback(() => {
    if (!tapeRef.current) return;
    if (audio.ended) setTapeEnded(false);
    audio.currentTime = 0;
    publishProgress(0);
  }, [audio, publishProgress]);

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
    eject(); // starting normal playback puts the tape away (saving its place first)
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
  }, [eject, start]);

  const playShuffled = useCallback((queue: Track[]) => {
    if (queue.length) play(queue, Math.floor(Math.random() * queue.length), 'shuffled');
  }, [play]);

  const jumpTo = useCallback((upNextIndex: number) => {
    if (!tapeRef.current) start(indexRef.current + 1 + upNextIndex);
  }, [start]);

  const toggleShuffle = useCallback(() => {
    if (tapeRef.current) return;
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

  // The only way a tape advances: the current song ending. Not exposed, so nothing can skip.
  const advanceTape = useCallback(() => {
    const t = tapeRef.current;
    if (!t) return;
    if (t.index + 1 < t.tracks.length) {
      startTape(t.index + 1, 0, true);
    } else {
      audio.pause();
      setTapeEnded(true);
      publishProgress(Infinity);
    }
    saveTapeNow(0);
  }, [audio, startTape, saveTapeNow, publishProgress]);

  const next = useCallback(() => {
    if (tapeRef.current) return;
    if (indexRef.current + 1 < queueRef.current.length) {
      start(indexRef.current + 1);
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [audio, start]);

  const onEnded = useCallback(() => (tapeRef.current ? advanceTape() : next()), [advanceTape, next]);

  const prev = useCallback(() => {
    if (tapeRef.current) return;
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
    if (tapeRef.current) return;
    audio.currentTime = seconds;
    setPosition(seconds);
  }, [audio]);

  // The deck only ever drives the audio element through these; the song's own timing stays out of state in tape mode.
  const tapeTimeUpdate = useCallback(() => {
    publishProgress(audio.currentTime);
    if (Date.now() - lastSaveRef.current >= TAPE_SAVE_EVERY_MS) saveTapeNow();
  }, [audio, publishProgress, saveTapeNow]);

  useEffect(() => {
    const onPlay = () => {
      setPlaying(true);
      if (tapeRef.current) setTapeEnded(false);
    };
    const onPause = () => {
      setPlaying(false);
      if (tapeRef.current && !audio.ended) saveTapeNow();
    };
    const onTime = () => {
      if (tapeRef.current) tapeTimeUpdate();
      else setPosition(audio.currentTime);
    };
    const onDuration = () => !tapeRef.current && Number.isFinite(audio.duration) && setDuration(audio.duration);
    const onHidden = () => document.visibilityState === 'hidden' && tapeRef.current && saveTapeNow();
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('ended', onEnded);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [audio, onEnded, saveTapeNow, tapeTimeUpdate]);

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
  const lockScreenTitle = tape ? tapeTitle(tape.kind, tape.label) : null;
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;

    if (lockScreenTitle) {
      // Blind mode: a generic title, no artist/album/art, no skip or seek actions, and an endless
      // duration so the lock screen has no remaining time to show.
      session.metadata = new MediaMetadata({ title: lockScreenTitle });
      session.setActionHandler('play', () => audio.play());
      session.setActionHandler('pause', () => audio.pause());
      for (const action of TAPE_ONLY_ACTIONS) session.setActionHandler(action, null);
      try {
        session.setPositionState({ duration: Infinity, position: 0, playbackRate: 1 });
      } catch {
        // Not every browser accepts an infinite duration; the handlers above still apply.
      }
      return;
    }

    if (!current) return;
    try {
      session.setPositionState();
    } catch {
      // Clearing is best-effort.
    }
    const art = artFor(current);
    session.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: art ? [{ src: new URL(art, location.origin).href, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
    session.setActionHandler('play', () => audio.play());
    session.setActionHandler('pause', () => audio.pause());
    session.setActionHandler('previoustrack', prev);
    session.setActionHandler('nexttrack', next);
    session.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime));
  }, [audio, current, lockScreenTitle, artFor, next, prev, seek]);

  // Recomputed when the track or shuffle mode changes; reads the queue refs at that moment.
  const upNext = useMemo(
    () => queueRef.current.slice(indexRef.current + 1, indexRef.current + 1 + 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, shuffle, queueVersion],
  );

  const value = useMemo(
    () => ({
      current, playing, position, duration, shuffle, upNext, tape, tapeEnded, tapeProgress,
      play, jumpTo, playShuffled, toggleShuffle, toggle, next, prev, seek, loadTape, relabelTape, rewind, eject,
    }),
    [
      current, playing, position, duration, shuffle, upNext, tape, tapeEnded, tapeProgress,
      play, jumpTo, playShuffled, toggleShuffle, toggle, next, prev, seek, loadTape, relabelTape, rewind, eject,
    ],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
