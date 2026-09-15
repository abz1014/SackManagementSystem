/**
 * Account — the caller's own password, changed from the account menu.
 * Roadmap Phase 11 item 1 (14 Sep 2026): there was no way to change a
 * password in the product; a forgotten one meant SQL.
 *
 * A sheet, not a route: it has no period, no data of its own, and it must
 * be reachable from every screen without leaving it — the same reason the
 * product overlay is a sheet. Opened by Bar's user menu, so App.tsx carries
 * nothing for it.
 *
 * The server verifies the current password, applies PASSWORD_MIN_LENGTH,
 * refuses reuse, and signs the account out everywhere ELSE; this sheet says
 * how many sessions that was, so a person who changed their password at a
 * desk knows the wall display they also signed in on will ask again.
 */
import { useState } from 'react';
import { ApiError, changePassword } from '../api';
import { W } from '../lib/words';
import { Sheet } from '../ui/Sheet';

export function AccountSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <Sheet title={W.health.changePassword} eyebrow={W.health.account} onClose={onClose}>
      <h2>{W.health.changePassword}</h2>
      {done ? (
        <p role="status" style={{ marginTop: 14 }}>{done}</p>
      ) : (
        <form
          style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: '26em' }}
          onSubmit={async (e) => {
            e.preventDefault();
            setFailed(null);
            if (next !== again) {
              setFailed(W.health.mismatch);
              return;
            }
            setBusy(true);
            try {
              const r = await changePassword(current, next);
              setDone(W.health.changed(r.otherSessionsRevoked));
              setCurrent('');
              setNext('');
              setAgain('');
            } catch (err) {
              if (err instanceof ApiError && err.status === 403) setFailed(W.health.wrongCurrent);
              else if (err instanceof ApiError && err.status === 400) setFailed(err.detail ?? err.message);
              else setFailed(W.couldNotLoad);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>{W.health.currentPassword}</span>
            <input type="password" value={current} required autoFocus autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="field">
            <span>{W.health.newPassword}</span>
            <input type="password" value={next} required autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="field">
            <span>{W.health.confirmPassword}</span>
            <input type="password" value={again} required autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
          </label>
          {failed && <p className="acc sm" role="alert">{failed}</p>}
          <div className="row">
            <button type="submit" className="btn primary" disabled={busy}>{W.weight.save}</button>
            <button type="button" className="btn" onClick={onClose}>{W.product.cancel}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
