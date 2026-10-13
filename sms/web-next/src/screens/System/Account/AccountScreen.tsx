/**
 * System > Account (task E12; no mockup, decision E-8: same page template, built from the design-system parts).
 * Who you are signed in as, your role, the password form (POST /api/auth/password, rank 1) and Sign out.
 * Nothing is shown before the server answers: a wrong current password (403) and a refused new one (400, the policy
 * sentence in `detail`) are printed as the server says them.
 */
import { useState } from 'react';
import { ApiError, changePassword, logout } from '../../../bridge/api';
import { SystemTabs } from '../SystemTabs';
import type { ScreenProps } from '../../registry';
import { SY } from '../systemCopy';
import '../system.css';

const A = SY.account;

export function AccountScreen({ route, rank, user, go }: ScreenProps) {
  return (
    <div className="sy-page">
      <SystemTabs route={route} rank={rank} go={go} />
      <header className="sy-head">
        <h1 className="sy-title">{A.title}</h1>
        <p className="sy-sentence">{A.sentence}</p>
      </header>
      <div className="sy-two">
        <section className="card sy-card" aria-labelledby="ac-who">
          <div className="sy-card__head"><h2 id="ac-who" className="sy-card__title">{A.who}</h2></div>
          <dl className="sy-kv">
            <dt>{A.name}</dt>
            <dd>{user.displayName ?? '—'}</dd>
            <dt>{A.username}</dt>
            <dd>{user.username}</dd>
            <dt>{A.role}</dt>
            <dd>{`${user.role} · ${A.rank(rank)}`}</dd>
          </dl>
          <p className="sy-note">{A.roleRead}</p>
          <SignOut />
        </section>
        <section className="card sy-card" aria-labelledby="ac-pw">
          <div className="sy-card__head"><h2 id="ac-pw" className="sy-card__title">{A.password}</h2></div>
          <PasswordForm />
        </section>
      </div>
    </div>
  );
}

function SignOut() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="sy-actions">
      <button
        type="button"
        className="wr-btn"
        onClick={() => {
          setErr(null);
          logout().then(
            () => window.location.reload(),
            () => setErr(A.signOutFailed),
          );
        }}
      >
        {A.signOut}
      </button>
      {err && <span className="wr-field__error" role="alert">{err}</span>}
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setFailed(null);
    setDone(null);
    if (next !== again) {
      setFailed(A.mismatch);
      return;
    }
    setBusy(true);
    try {
      const r = await changePassword(current, next);
      setDone(A.changed(r.otherSessionsRevoked));
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setFailed(A.wrongCurrent);
      else if (e instanceof ApiError) setFailed(e.detail ?? e.message);
      else setFailed(A.failed);
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div className="wr-field">
      <label className="wr-field__label" htmlFor={id}>{label}</label>
      <input id={id} className="wr-input" type="password" value={value} required autoComplete={auto} disabled={busy} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <form
      className="sy-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {field('ac-cur', A.current, current, setCurrent, 'current-password')}
      {field('ac-new', A.next, next, setNext, 'new-password')}
      {field('ac-again', A.again, again, setAgain, 'new-password')}
      {failed && <p className="wr-field__error" role="alert">{failed}</p>}
      {done && <p className="wr-count wr-count--ok" role="status">{done}</p>}
      <div className="sy-actions">
        <button type="submit" className="ui-btn" disabled={busy || current === '' || next === '' || again === ''}>{A.save}</button>
      </div>
    </form>
  );
}
