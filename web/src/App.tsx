import { FormEvent, useEffect, useState } from 'react';
import { friendlyError, resolveSession, signIn, signOut } from './auth';
import Home from './Home';
import { passkeysAvailable, signInWithPasskey } from './passkeys';

type View =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'offline' }
  | { kind: 'new-password'; complete: (pw: string) => Promise<void> }
  | { kind: 'signed-in'; email: string };

async function currentView(): Promise<View> {
  const state = await resolveSession();
  if (state.status === 'valid') {
    return { kind: 'signed-in', email: state.session.getIdToken().payload.email ?? '' };
  }
  return state.status === 'unreachable' ? { kind: 'offline' } : { kind: 'signed-out' };
}

export default function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentView().then(setView);
  }, []);

  // Offline at launch is not a logout: keep the tokens and retry once the network is back.
  useEffect(() => {
    if (view.kind !== 'offline') return;
    const retry = () => currentView().then(setView);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [view.kind]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function finishSignIn() {
    setPassword('');
    setNewPassword('');
    // Ask the browser not to evict our stored tokens under storage pressure.
    navigator.storage?.persist?.().catch(() => undefined);
    setView(await currentView());
  }

  function onSignIn(ev: FormEvent) {
    ev.preventDefault();
    run(async () => {
      const result = await signIn(email.trim(), password);
      if (result.status === 'new-password-required') {
        setView({ kind: 'new-password', complete: result.complete });
      } else {
        await finishSignIn();
      }
    });
  }

  function onPasskeySignIn() {
    if (!email.trim()) {
      setError('Enter your email first, then use your passkey.');
      return;
    }
    run(async () => {
      await signInWithPasskey(email.trim());
      await finishSignIn();
    });
  }

  function onNewPassword(ev: FormEvent) {
    ev.preventDefault();
    if (view.kind !== 'new-password') return;
    const { complete } = view;
    run(async () => {
      await complete(newPassword);
      await finishSignIn();
    });
  }

  async function onSignOut() {
    await signOut();
    setView({ kind: 'signed-out' });
  }

  if (view.kind === 'loading') return <main className="center" />;

  if (view.kind === 'offline') {
    return (
      <main className="center">
        <h1>Charybdis</h1>
        <p className="muted">Can't reach the server. You're still signed in.</p>
        <button onClick={() => currentView().then(setView)}>Retry</button>
      </main>
    );
  }

  if (view.kind === 'signed-in') {
    return <Home email={view.email} onSignOut={onSignOut} />;
  }

  return (
    <main className="center">
      <h1>Charybdis</h1>
      {view.kind === 'signed-out' ? (
        <form onSubmit={onSignIn}>
          <input
            type="email"
            autoComplete="username"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {passkeysAvailable() && (
            <button type="button" className="secondary" disabled={busy} onClick={onPasskeySignIn}>
              Sign in with passkey
            </button>
          )}
        </form>
      ) : (
        <form onSubmit={onNewPassword}>
          <p className="muted">Choose a new password (12+ characters, upper and lower case, a number).</p>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            minLength={12}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
