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
  const res = await fetch('/api/cassettes', { headers: await authHeader() });
  if (!res.ok) throw new Error(`Could not load cassettes (${res.status})`);
  return res.json();
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function createCassette(kind: 'album' | 'artist', sourceId: string): Promise<Cassette> {
  const res = await fetch('/api/cassettes', {
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
  const res = await fetch(`/api/cassettes/${cassetteId}/settings`, {
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
  const res = await fetch(`/api/cassettes/${cassetteId}/entries/${slot}`, {
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
  const res = await fetch(`/api/cassettes/${cassetteId}/progress`, {
    method: 'PUT',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ index, positionSec }),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`Could not save tape position (${res.status})`);
}
