/**
 * Setup — the line and what is on it, the rules this system applies, the
 * plant connection, accounts, and the audit log. Admin only, behind the gear.
 *
 * One page with sections rather than five tabs. The old Setup was an admin
 * area that read as project documentation: six question numbers in the copy,
 * "argon2-hashed" in a lede, a stale paragraph naming screens that had been
 * withdrawn, and a panel pointing at a screen that no longer existed.
 *
 * SYNC HEALTH IS THE FIRST SECTION because it is the one thing here that
 * everybody, not just an admin, has a reason to reach: the header's "readings
 * to 10:34" sentence links straight to it. It states the source in plain words
 * too, so requirement 1's real status — SQL only, no PLC — is visible in the
 * product rather than only in a document.
 *
 * THE ORDER AFTER IT is roadmap Phase 1's (14 Sep 2026): what the line IS —
 * Line, Machines, Stations, Sources — then what this system applies to it —
 * Rules, Reject codes — then who may change any of that, and the record of
 * every change. Each section is its own file under ./setup/; the two that
 * were here before (Stations, Rules) moved out when they grew forms.
 */
import { useEffect, useState } from 'react';
import { W } from '../lib/words';
import { Block, Empty, Failed, SkelLines } from '../ui/bits';
import { fmtAppInstant } from '../lib/fmt';
import {
  adminListUsers, adminCreateUser, adminUpdateUser, adminResetPassword, adminGetAuditPage, ApiError,
  type AdminUser, type AuditEntry,
} from '../api';
import { SyncHealthBlock } from './health/SyncHealthBlock';
import { LineBlock } from './setup/LineBlock';
import { MachinesBlock } from './setup/MachinesBlock';
import { StationsBlock } from './setup/StationsBlock';
import { SourcesBlock } from './setup/SourcesBlock';
import { RulesBlock } from './setup/RulesBlock';
import { RejectCodesBlock } from './setup/RejectCodesBlock';

/** The four ranks, lowest first — matches api's ROLE_RANK / requireRole. */
const ROLES = ['operator', 'supervisor', 'manager', 'admin'] as const;

export function SetupScreen({ currentUsername }: { currentUsername?: string }) {
  return (
    <>
      <div className="page">
        <p className="q">{W.question.setup}</p>
        <h1 className="wide">Setup</h1>
      </div>
      <SyncHealthBlock first isAdmin />
      <LineBlock />
      <MachinesBlock />
      <StationsBlock />
      <SourcesBlock />
      <RulesBlock />
      <RejectCodesBlock />
      <People currentUsername={currentUsername} />
      <AuditLog />
    </>
  );
}

/* ------------------------------------------------------------ sync health */
/* The block itself lives in ./health/SyncHealthBlock.tsx since 14 Sep 2026
   (roadmap Phase 11): the Health screen, open to every account, shows the
   same facts, and one component keeps them the same. */

/* ----------------------------------------------------------------- people */

function People({ currentUsername }: { currentUsername?: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    setError(null);
    adminListUsers()
      .then((r) => setUsers(r.users))
      .catch((e) => setError(String(e.message ?? e)));
  };
  useEffect(() => {
    void load();
  }, []);

  // Finding H14 (Sep 2026 audit): this used to swallow a fetch failure into
  // an empty user list, rendering as "no users" — the opposite of true — to
  // an admin who came here specifically to check who has access.
  if (error) return <Block label={W.setupTabs.people}><Failed error={error} onRetry={load} /></Block>;
  if (!users) return <Block label={W.setupTabs.people}><SkelLines n={4} short /></Block>;

  // Finding L6 (Sep 2026 audit): adminCreateUser/adminUpdateUser were already
  // built end to end (backend, and this client's own api.ts) but never wired
  // to anything — the only way to create or edit an account was the CLI's
  // `user:create`. Both now wired up below.
  // Every write here surfaces its own failure. Without the catch a 403 or a
  // dropped connection was an unhandled rejection: `load()` never ran, the
  // control snapped back to its old value, and the admin was told nothing —
  // the exact silent-failure class H14 exists to remove, two functions above.
  const write = async (userId: number, patch: { role?: string; active?: boolean }) => {
    setBusyId(userId);
    setError(null);
    try {
      await adminUpdateUser(userId, patch);
      load();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Block label={W.setupTabs.people} note="who can sign in, and what each may change">
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Active</th>
              <th>{W.health.password}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              // You may not demote or deactivate YOURSELF from here. The
              // server has no self-protection on PATCH /api/admin/users/:id,
              // so before this guard one click on your own row — or one
              // arrow-key press on your own role select — could strip the
              // last admin's access, recoverable only by running the CLI on
              // the plant PC.
              const isSelf = currentUsername != null && u.username === currentUsername;
              return (
                <tr key={u.userId}>
                  <td>{u.displayName ?? <span className="mut">—</span>}</td>
                  <td>
                    {u.username}
                    {isSelf && <span className="mut sm"> · you</span>}
                  </td>
                  <td>
                    {isSelf ? (
                      u.role
                    ) : (
                      <select
                        // defaultValue + commit on blur, NOT onChange: a
                        // <select> fires change on every arrow key, so
                        // keyboard-stepping admin→operator wrote three PATCHes
                        // and three audit rows on the way past.
                        defaultValue={u.role}
                        key={`${u.userId}:${u.role}`}
                        disabled={busyId === u.userId}
                        aria-label={`Role for ${u.username}`}
                        onBlur={(e) => {
                          if (e.target.value !== u.role) void write(u.userId, { role: e.target.value });
                        }}
                        style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {isSelf ? (
                      u.active ? 'yes' : <span className="acc">no</span>
                    ) : (
                      <button
                        type="button"
                        className="linkish sm"
                        disabled={busyId === u.userId}
                        onClick={() => void write(u.userId, { active: !u.active })}
                      >
                        {u.active ? 'yes' : <span className="acc">no</span>}
                      </button>
                    )}
                  </td>
                  <td>
                    {/* Your own password is changed from the account menu, which
                        asks for the current one; the server refuses the reset
                        route for the actor's own id (roadmap Phase 11). */}
                    {isSelf ? <span className="mut sm">{W.health.ownPasswordHint}</span> : <ResetPassword user={u} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <NewUserForm onCreated={load} />
    </Block>
  );
}

function NewUserForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('manager');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>
        New account
      </button>
    );
  }

  return (
    <form
      style={{ marginTop: 14, display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(null);
        try {
          await adminCreateUser({
            username: username.trim(),
            password,
            role,
            displayName: displayName.trim() || undefined,
          });
          setOpen(false);
          setUsername('');
          setDisplayName('');
          setPassword('');
          setRole('manager');
          onCreated();
        } catch (e) {
          // A duplicate username is the one failure worth naming specifically
          // — the server answers 409 with exactly that message — and a
          // password the policy refuses comes back as 400 with the rule in
          // `detail` (PASSWORD_MIN_LENGTH, roadmap Phase 11).
          setFailed(
            e instanceof ApiError && e.status === 409 ? e.message
              : e instanceof ApiError && e.status === 400 && e.detail ? e.detail
                : W.couldNotLoad,
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Username</span>
        <input type="text" value={username} autoFocus required onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="field">
        <span>Display name (optional)</span>
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={password} required autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="field">
        <span>Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      {failed && <p className="acc sm">{failed}</p>}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>{W.weight.save}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{W.product.cancel}</button>
      </div>
    </form>
  );
}

/**
 * An administrator's reset of someone else's password (roadmap Phase 11
 * item 1, 14 Sep 2026). Until this there was no way to recover a forgotten
 * password except SQL. The server revokes every session of the account and
 * writes `user.password_reset`; the sentence printed afterwards says so, so
 * the admin can tell the person what to expect.
 */
function ResetPassword({ user }: { user: AdminUser }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (!open) {
    return (
      <span>
        <button type="button" className="linkish sm" onClick={() => { setOpen(true); setSaid(null); }}>
          {W.health.reset}
        </button>
        {said && <span className="mut sm"> · {said}</span>}
      </span>
    );
  }
  return (
    <form
      className="row"
      style={{ gap: 6 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(null);
        try {
          const r = await adminResetPassword(user.userId, password);
          setSaid(W.health.resetDone(r.sessionsRevoked));
          setPassword('');
          setOpen(false);
        } catch (err) {
          setFailed(err instanceof ApiError && (err.status === 400 || err.status === 404) ? (err.detail ?? err.message) : W.notAllowed);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        type="password"
        value={password}
        required
        autoFocus
        autoComplete="new-password"
        aria-label={`${W.health.newPassword} for ${user.username}`}
        placeholder={W.health.newPassword}
        onChange={(e) => setPassword(e.target.value)}
        style={{ maxWidth: '14em' }}
      />
      <button type="submit" className="btn sm" disabled={busy}>{W.health.reset}</button>
      <button type="button" className="btn sm" onClick={() => setOpen(false)}>{W.product.cancel}</button>
      {failed && <span className="acc sm">{failed}</span>}
    </form>
  );
}

/* -------------------------------------------------------------- audit log */

function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keyset paged since roadmap Phase 11 (14 Sep 2026): the newest page
  // first, "Show older" appends the next. TOP 500 with no way past it used to
  // be the whole viewer, and with logins audited too that is days, not history.
  const PAGE = 40;
  const load = () => {
    setError(null);
    adminGetAuditPage(null, PAGE)
      .then((r) => { setRows(r.entries); setNextBefore(r.nextBefore); })
      .catch((e) => setError(String(e.message ?? e)));
  };
  const older = async () => {
    if (nextBefore == null) return;
    setBusy(true);
    try {
      const r = await adminGetAuditPage(nextBefore, PAGE);
      setRows((cur) => [...(cur ?? []), ...r.entries]);
      setNextBefore(r.nextBefore);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  // Finding H14 (Sep 2026 audit): this used to swallow a fetch failure into
  // an empty row list, which then rendered the FALSE-POSITIVE sentence
  // "Nothing has been changed through this application yet." — to an admin
  // specifically auditing access control, on a fetch failure.
  if (error) return <Block label={W.setupTabs.audit}><Failed error={error} onRetry={load} /></Block>;
  if (!rows) return <Block label={W.setupTabs.audit}><SkelLines n={4} short /></Block>;
  if (rows.length === 0) return <Block label={W.setupTabs.audit}><Empty message="Nothing has been changed through this application yet." /></Block>;

  return (
    <Block label={W.setupTabs.audit} note="every change made through this application">
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th style={{ width: '13em' }}>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.auditId}>
                <td>{fmtAppInstant(e.atUtc)}</td>
                {/* No actor: a failed login, or the CLI (retention, cutover,
                    user:password) — the detail says which. */}
                <td>{e.actorName ?? <span className="mut">{e.actorId == null ? W.health.noActor : '—'}</span>}</td>
                <td>{e.action}</td>
                <td className="mut">{e.detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextBefore != null && (
        <button type="button" className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => void older()}>
          {W.health.older}
        </button>
      )}
    </Block>
  );
}
