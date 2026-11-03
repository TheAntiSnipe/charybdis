import { isRetryable, saveTapeProgress } from './api';

export const PROGRESS_RETRY_MS = [5000, 15000, 30000, 60000];

interface Place {
  index: number;
  positionSec: number;
}

/**
 * Saves where each tape is up to, quietly. Only the newest place per tape matters, so a failed save is
 * simply tried again later (and replaced if a newer place arrives); nothing is shown to the listener.
 */
export function createProgressSaver(send: typeof saveTapeProgress = saveTapeProgress) {
  const latest = new Map<string, Place>();
  const inFlight = new Set<string>();
  const failures = new Map<string, number>();
  const timers = new Map<string, number>();
  const gone = new Set<string>(); // deleted tapes: a late save (e.g. from ejecting) must not be sent

  async function run(id: string): Promise<void> {
    const place = latest.get(id);
    if (!place || inFlight.has(id)) return;
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    inFlight.add(id);
    try {
      await send(id, place.index, place.positionSec);
      failures.delete(id);
      if (latest.get(id) === place) latest.delete(id);
    } catch (err) {
      if (!isRetryable(err)) {
        latest.delete(id);
        failures.delete(id);
      } else {
        const n = failures.get(id) ?? 0;
        failures.set(id, n + 1);
        timers.set(id, window.setTimeout(() => void run(id), PROGRESS_RETRY_MS[Math.min(n, PROGRESS_RETRY_MS.length - 1)]));
      }
    } finally {
      inFlight.delete(id);
      if (latest.has(id) && !timers.has(id) && latest.get(id) !== place) void run(id);
    }
  }

  return {
    save(id: string, index: number, positionSec: number) {
      if (gone.has(id)) return;
      latest.set(id, { index, positionSec });
      if (!timers.has(id)) void run(id); // while waiting out a failure, the timer sends whatever is newest
    },
    /** Try everything that failed again now, e.g. when the connection comes back. */
    retryNow() {
      for (const id of [...latest.keys()]) {
        window.clearTimeout(timers.get(id));
        timers.delete(id);
        void run(id);
      }
    },
    forget(id: string) {
      gone.add(id);
      window.clearTimeout(timers.get(id));
      timers.delete(id);
      latest.delete(id);
      failures.delete(id);
    },
    /** A tape made again after being deleted counts as a new tape. */
    revive(id: string) {
      gone.delete(id);
    },
    dispose() {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    },
  };
}
