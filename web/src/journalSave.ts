import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { isRetryable, saveJournalEntry } from './api';
import type { Cassette, JournalEntry } from './types';

export const MAX_NOTE = 280; // mirrors api/cassettes.py
export const SAVE_DELAY_MS = 800;
export const RETRY_MS = [2000, 5000, 10000, 20000, 30000];

/** typing: waiting for a pause; saving: queued or in flight; retrying: failed, will try again; rejected: the server refused it. */
export type SlotState = 'typing' | 'saving' | 'retrying' | 'rejected';
export type JournalSync = 'saved' | 'saving' | 'retrying' | 'rejected';

interface Draft {
  cassetteId: string;
  slot: number;
  text: string;
  state: SlotState;
  queued: boolean;
  sending: boolean;
  failures: number;
  timer?: number;
  error?: string;
}

export const slotKey = (cassetteId: string, slot: number) => `${cassetteId}#${slot}`;

export const DRAFTS_KEY = 'charybdis.journal.drafts';

/** Notes not yet confirmed by the server survive the app being closed or killed; they are sent again on the next launch. */
function loadDrafts(): Draft[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((d) => d && typeof d.cassetteId === 'string' && Number.isInteger(d.slot) && d.slot >= 0 && typeof d.text === 'string')
      .map((d) => ({ cassetteId: d.cassetteId, slot: d.slot, text: d.text.slice(0, MAX_NOTE), state: 'saving' as SlotState, queued: true, sending: false, failures: 0 }));
  } catch {
    return [];
  }
}

function storeDrafts(drafts: Iterable<Draft>) {
  try {
    // A refused note is not kept: it would be refused again at every launch.
    const list = [...drafts].filter((d) => d.state !== 'rejected').map((d) => ({ cassetteId: d.cassetteId, slot: d.slot, text: d.text }));
    if (list.length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(list));
    else localStorage.removeItem(DRAFTS_KEY);
  } catch {
    // Storage can be full or blocked (private browsing); notes still save over the network.
  }
}

/**
 * Autosaves notes. Edits show at once; each slot is saved after a pause in typing, one request at a time
 * (so the server's "every slot filled" check never races), and a failed save keeps the text and retries.
 * Unsaved notes are also kept in localStorage until the server confirms them.
 */
export function useJournal(
  setEntries: Dispatch<SetStateAction<JournalEntry[]>>,
  setCassettes: Dispatch<SetStateAction<Cassette[]>>,
) {
  const drafts = useRef(new Map<string, Draft>());
  const busy = useRef(false);
  const [slots, setSlots] = useState<Record<string, { state: SlotState; error?: string }>>({});

  // Called after every change to the drafts, so the screen and the stored copy never disagree.
  const publish = useCallback(() => {
    const next: Record<string, { state: SlotState; error?: string }> = {};
    for (const [key, d] of drafts.current) next[key] = { state: d.state, error: d.error };
    setSlots(next);
    storeDrafts(drafts.current.values());
  }, []);

  const pump: (keepalive?: boolean) => Promise<void> = useCallback(
    async (keepalive = false) => {
      if (busy.current) return;
      const draft = [...drafts.current.values()].find((d) => d.queued);
      if (!draft) return;
      busy.current = true;
      draft.queued = false;
      draft.sending = true;
      draft.state = 'saving';
      const sent = draft.text;
      publish();
      try {
        const saved = await saveJournalEntry(draft.cassetteId, draft.slot, sent, keepalive);
        setCassettes((current) =>
          current.map((c) => {
            if (c.id !== draft.cassetteId) return c;
            const next: Cassette = { ...c, status: saved.status };
            if (saved.finishedAt) next.finishedAt = saved.finishedAt;
            else delete next.finishedAt;
            return next;
          }),
        );
        // Typing during the request already moved the draft on; only a draft still waiting on this request is done.
        if (draft.text === sent && drafts.current.get(slotKey(draft.cassetteId, draft.slot)) === draft && draft.state === 'saving') {
          drafts.current.delete(slotKey(draft.cassetteId, draft.slot));
        }
      } catch (err) {
        // A draft that is no longer "saving" was edited meanwhile; its own timer will send the newer text.
        if (draft.state === 'saving') {
          if (!isRetryable(err)) {
            draft.state = 'rejected';
            draft.error = (err as Error).message;
          } else {
            draft.state = 'retrying';
            draft.error = undefined;
            const wait = RETRY_MS[Math.min(draft.failures, RETRY_MS.length - 1)];
            draft.failures += 1;
            draft.timer = window.setTimeout(() => {
              draft.queued = true;
              draft.state = 'saving';
              publish();
              void pump();
            }, wait);
          }
        }
      } finally {
        draft.sending = false;
        busy.current = false;
        publish();
        void pump();
      }
    },
    [publish, setCassettes],
  );

  const edit = useCallback(
    (cassetteId: string, slot: number, text: string) => {
      const key = slotKey(cassetteId, slot);
      const draft = drafts.current.get(key) ?? { cassetteId, slot, text, state: 'typing' as SlotState, queued: false, sending: false, failures: 0 };
      window.clearTimeout(draft.timer);
      draft.text = text;
      draft.state = 'typing';
      draft.queued = false;
      draft.failures = 0;
      draft.error = undefined;
      draft.timer = window.setTimeout(() => {
        draft.queued = true;
        draft.state = 'saving';
        publish();
        void pump();
      }, SAVE_DELAY_MS);
      drafts.current.set(key, draft);
      publish();
      setEntries((current) => {
        const rest = current.filter((e) => !(e.cassetteId === cassetteId && e.slot === slot));
        return text ? [...rest, { cassetteId, slot, text, updatedAt: Math.floor(Date.now() / 1000) }] : rest;
      });
    },
    [publish, pump, setEntries],
  );

  /** Sends anything waiting right now: on leaving a field, hiding the page, or coming back online. */
  const flush = useCallback(
    (keepalive = false) => {
      for (const d of drafts.current.values()) {
        if (d.state === 'rejected' || d.sending) continue;
        window.clearTimeout(d.timer);
        d.queued = true;
        d.state = 'saving';
      }
      publish();
      void pump(keepalive);
    },
    [publish, pump],
  );

  /** Puts unsaved notes back over a fresh copy from the server, so a reload never eats what is being typed. */
  const overlay = useCallback((fresh: JournalEntry[]): JournalEntry[] => {
    if (!drafts.current.size) return fresh;
    const pending = [...drafts.current.values()];
    const kept = fresh.filter((e) => !pending.some((d) => d.cassetteId === e.cassetteId && d.slot === e.slot));
    const mine = pending
      .filter((d) => d.text)
      .map((d) => ({ cassetteId: d.cassetteId, slot: d.slot, text: d.text, updatedAt: Math.floor(Date.now() / 1000) }));
    return [...kept, ...mine];
  }, []);

  /** Drops the unsaved notes of tapes that no longer exist (deleted here or on another device). */
  const forget = useCallback(
    (gone: (cassetteId: string) => boolean) => {
      let changed = false;
      for (const [key, d] of drafts.current) {
        if (!gone(d.cassetteId)) continue;
        window.clearTimeout(d.timer);
        d.state = 'rejected'; // an in-flight save of it must not schedule a retry
        d.queued = false;
        drafts.current.delete(key);
        changed = true;
      }
      if (changed) publish();
    },
    [publish],
  );

  // Notes left unsaved by a previous visit go out first thing.
  useEffect(() => {
    let restored = false;
    for (const d of loadDrafts()) {
      const key = slotKey(d.cassetteId, d.slot);
      if (drafts.current.has(key)) continue;
      drafts.current.set(key, d);
      restored = true;
    }
    if (restored) flush();
  }, [flush]);

  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && flush(true);
    const online = () => flush();
    const pagehide = () => flush(true);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('online', online);
    const pending = drafts.current;
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', online);
      for (const d of pending.values()) window.clearTimeout(d.timer);
    };
  }, [flush]);

  const states = Object.values(slots).map((s) => s.state);
  const sync: JournalSync = states.includes('rejected')
    ? 'rejected'
    : states.includes('retrying')
      ? 'retrying'
      : states.length
        ? 'saving'
        : 'saved';

  return { slots, sync, edit, flush, overlay, forget };
}
