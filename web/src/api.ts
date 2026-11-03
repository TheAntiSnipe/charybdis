import { getSession } from './auth';
import type { Library } from './types';

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
