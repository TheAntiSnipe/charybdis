import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSession, fetchLibrary } from './api';
import { friendlyError } from './auth';
import LibraryView from './Library';
import { passkeysAvailable, registerPasskey } from './passkeys';
import PlayerBar from './PlayerBar';
import { PlayerProvider } from './player';
import type { Library, Track } from './types';

const SESSION_REFRESH_MS = 60 * 60 * 1000;

export default function Home({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function onAddPasskey() {
    setNotice('');
    try {
      await registerPasskey();
      setNotice('Passkey added. You can use it next time you sign in.');
    } catch (err) {
      setNotice(friendlyError(err));
    }
    setTimeout(() => setNotice(''), 6000);
  }

  useEffect(() => {
    let cancelled = false;
    // Cookies must exist before the first /art or /music request.
    createSession()
      .then(fetchLibrary)
      .then((lib) => !cancelled && setLibrary(lib))
      .catch((err: Error) => !cancelled && setError(err.message));

    const refresh = () => createSession().catch(() => undefined);
    const timer = setInterval(refresh, SESSION_REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const albumArt = useMemo(() => new Map((library?.albums ?? []).map((a) => [a.id, a.artKey])), [library]);
  const artFor = useCallback((t: Track) => {
    const key = albumArt.get(t.albumId);
    return key ? `/${key}` : null;
  }, [albumArt]);

  return (
    <PlayerProvider artFor={artFor}>
      <div className="app">
        <header className="topbar">
          <h1>Charybdis</h1>
          <div className="topbar-actions">
            {passkeysAvailable() && <button className="link" onClick={onAddPasskey}>Add passkey</button>}
            <button className="link" onClick={onSignOut} title={email}>Sign out</button>
          </div>
        </header>
        {notice && <p className="notice" role="status">{notice}</p>}
        <main className="content">
          {error && <p className="error" role="alert">{error}</p>}
          {!library && !error && <p className="muted center-text">Loading library…</p>}
          {library && <LibraryView library={library} artFor={artFor} />}
        </main>
        <PlayerBar artFor={artFor} />
      </div>
    </PlayerProvider>
  );
}
