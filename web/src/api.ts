import { getSession } from './auth';
import type { Cassette, CassetteStyle, JournalEntry, Library } from './types';

async function authHeader(): Promise<HeadersInit> {
  const session = await getSession();
  if (!session) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.getAccessToken().getJwtToken()}` };
}

/** Asks the API to set the CloudFront signed cookies that unlock /music, /art and /index. */
export async function createSession(): Promise<void> {
  const res = await fetch('/api/session', { method: 'POST', headers: await authHeader() });
  if (!res.ok) throw new Error(`Could not start session (${res.status})`);
}

export async function fetchLibrary(): Promise<Library> {
  const res = await fetch('/api/library', { headers: await authHeader() });
  if (!res.ok) throw new Error(`Could not load library (${res.status})`);
  return res.json();
}

export async function fetchCassettes(): Promise<{ cassettes: Cassette[]; entries: JournalEntry[] }> {
  const res = await reach('/api/cassettes', { headers: await authHeader() });
  if (!res.ok) throw new ApiError(`Could not load cassettes (${res.status})`, res.status);
  return res.json();
}

export class ApiError extends Error {
  status: number; // 0 means the request never reached the server
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const OFFLINE_MESSAGE = 'Can’t reach Charybdis. Check your connection and try again.';

/** fetch that reports a network failure as an ApiError with status 0 and a plain message. */
async function reach(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }
}

/** A failure worth trying again later: no connection, timeout, throttling, an auth hiccup or a server error. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status >= 500 || [401, 403, 408, 429].includes(err.status);
}

export async function createCassette(kind: 'album' | 'artist', sourceId: string): Promise<Cassette> {
  const res = await reach('/api/cassettes', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, sourceId }),
  });
  if (res.ok) return res.json();
  if (res.status === 409) throw new ApiError('That cassette is already on your shelf.', 409);
  const detail = await res.json().then((b: { error?: string }) => b.error).catch(() => undefined);
  throw new ApiError(detail ?? `Could not make the cassette (${res.status})`, res.status);
}

/** Pass `title: null` to go back to the album or artist name. */
export async function saveCassetteSettings(
  cassetteId: string,
  patch: { title?: string | null; style?: CassetteStyle },
): Promise<Cassette> {
  const res = await reach(`/api/cassettes/${cassetteId}/settings`, {
    method: 'PUT',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (res.ok) return res.json();
  const detail = await res.json().then((b: { error?: string }) => b.error).catch(() => undefined);
  throw new ApiError(detail ?? `Could not save the cassette (${res.status})`, res.status);
}

export interface SavedEntry {
  cassetteId: string;
  slot: number;
  text: string;
  updatedAt: number;
  status: 'shelf' | 'finished';
  finishedAt?: number;
}

/** Empty text clears the slot. The reply says whether this save finished (or reopened) the tape. */
export async function saveJournalEntry(cassetteId: string, slot: number, text: string, keepalive = false): Promise<SavedEntry> {
  const res = await reach(`/api/cassettes/${cassetteId}/entries/${slot}`, {
    method: 'PUT',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    keepalive,
  });
  if (res.ok) return res.json();
  const detail = await res.json().then((b: { error?: string }) => b.error).catch(() => undefined);
  throw new ApiError(detail ?? `Could not save your note (${res.status})`, res.status);
}

/** keepalive lets the final save go out while the page is being hidden or closed. */
export async function saveTapeProgress(cassetteId: string, index: number, positionSec: number): Promise<void> {
  const res = await reach(`/api/cassettes/${cassetteId}/progress`, {
    method: 'PUT',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ index, positionSec }),
    keepalive: true,
  });
  if (!res.ok) throw new ApiError(`Could not save tape position (${res.status})`, res.status);
}

/** Removes the cassette and every note written on it. Deleting one that is already gone succeeds. */
export async function deleteCassette(cassetteId: string): Promise<void> {
  const res = await reach(`/api/cassettes/${cassetteId}`, { method: 'DELETE', headers: await authHeader() });
  if (res.ok) return;
  const detail = await res.json().then((b: { error?: string }) => b.error).catch(() => undefined);
  throw new ApiError(detail ?? `Could not delete the cassette (${res.status})`, res.status);
}
