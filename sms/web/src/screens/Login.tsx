/**
 * Sign in. One centred form.
 *
 * The old login was a 326-line two-pane layout whose left half advertised the
 * plant ("14 stations · 3 shifts · 60-second sync") and carried a live
 * plant-link indicator that duplicated the footer's. None of it helped anyone
 * sign in, and the hardcoded facts were wrong the moment a station was added.
 */
import { useState } from 'react';
import { ApiError, login as apiLogin, type AuthUser } from '../api';
import { W } from '../lib/words';

export function LoginScreen({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiLogin(username, password);
      onLogin(r.user);
    } catch (err) {
      // Four states, and only two messages. It never names the field: saying
      // which one was wrong turns the form into a way to confirm an account
      // exists. A lockout, though, states a NUMBER — the server sends the
      // seconds remaining, so "try again later" would be withholding
      // something it already knows.
      const e = err instanceof ApiError ? err : null;
      if (e?.status === 429) {
        const mins = Math.max(1, Math.ceil((e.retryAfter ?? 900) / 60));
        setError(`Too many attempts. Try again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`);
      } else {
        setError('That username and password did not match.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1 className="brand">{W.brand}</h1>
        <p className="q" style={{ marginBottom: 12 }}>Sack Management System</p>

        <label className="field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            autoFocus
            required
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="acc" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
