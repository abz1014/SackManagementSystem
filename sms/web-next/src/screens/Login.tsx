import { useState, type FormEvent } from 'react';
import { ApiError, login as apiLogin, type AuthUser } from '../bridge/api';
import { C } from '../copy';
import '../ui/components/write.css';
import '../ui/components/shared.css';
import './login.css';

/**
 * Sign in. Same behaviour as the old Login: it never names which field was wrong
 * (that would confirm an account exists); a lockout states the minutes the server
 * sent. There is no account creation here, ever.
 */
export function LoginScreen({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiLogin(username, password);
      onLogin(r.user);
    } catch (err) {
      const e2 = err instanceof ApiError ? err : null;
      if (e2?.status === 429) setError(C.login.tooMany(Math.max(1, Math.ceil((e2.retryAfter ?? 900) / 60))));
      else setError(C.login.mismatch);
      setBusy(false);
    }
  }

  return (
    <div className="lg-page">
      <form className="lg-card" onSubmit={submit}>
        <h1 className="lg-brand">{C.shell.appName}</h1>
        <p className="lg-sub">{C.login.subtitle}</p>
        <div className="wr-field">
          <label className="wr-field__label" htmlFor="lg-user">{C.login.username}</label>
          <input id="lg-user" className="wr-input" type="text" value={username} autoComplete="username" autoFocus required
            onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="wr-field">
          <label className="wr-field__label" htmlFor="lg-pass">{C.login.password}</label>
          <input id="lg-pass" className="wr-input" type="password" value={password} autoComplete="current-password" required
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="wr-field__error" role="alert">{error}</div>}
        <button type="submit" className="ui-btn" disabled={busy}>
          {busy ? C.login.busy : C.login.submit}
        </button>
      </form>
    </div>
  );
}
