/**
 * Sign in. One centred form.
 *
 * The old login was a 326-line two-pane layout whose left half advertised the
 * plant ("14 stations · 3 shifts · 60-second sync") and carried a live
 * plant-link indicator that duplicated the footer's. None of it helped anyone
 * sign in, and the hardcoded facts were wrong the moment a station was added.
 */
import { useState } from 'react';
import { login as apiLogin, type AuthUser } from '../api';
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
      // Deliberately does not say which of the two was wrong: naming the field
      // turns the form into a way to confirm that an account exists.
      setError('That username and password did not match.');
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
