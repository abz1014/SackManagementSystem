/**
 * Setup — accounts, stations, the rules this system applies, the plant
 * connection, and the audit log. Admin only, behind the gear.
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
 */
import { useEffect, useState } from 'react';
import { useLive, usePolling } from '../lib/live';
import { W } from '../lib/words';
import { Block, Details, Empty, Failed, SkelLines } from '../ui/bits';
import { fmtG, fmtKg, fmtSpan } from '../lib/fmt';
import {
  adminGetAudit, adminGetRules, adminListUsers, adminCreateUser, adminUpdateUser, adminSetStation, getStations,
  getOperations, ApiError, type AdminUser, type AuditEntry, type Rules, type StationRow,
} from '../api';

/** The four ranks, lowest first — matches api's ROLE_RANK / requireRole. */
const ROLES = ['operator', 'supervisor', 'manager', 'admin'] as const;

export function SetupScreen({ currentUsername }: { currentUsername?: string }) {
  return (
    <>
      <div className="page">
        <p className="q">{W.question.setup}</p>
        <h1 className="wide">Setup</h1>
      </div>
      <SyncHealth />
      <Stations />
      <RulesBlock />
      <People currentUsername={currentUsername} />
      <AuditLog />
    </>
  );
}

/* ------------------------------------------------------------ sync health */

function SyncHealth() {
  const { line } = useLive();
  const ops = usePolling(() => getOperations(), 60_000, 'operations');
  const h = line?.health ?? null;

  const verdict =
    h == null
      ? W.loading
      : h.kind === 'stale'
        ? W.sync.stale
        : h.kind === 'late'
          ? W.lag.late(fmtSpan(line?.ingestLagSeconds ?? 0))
          : W.sync.ok;

  const failures = ops.data?.data.sync.filter((s) => s.outcome !== 'success') ?? [];
  const blocking = ops.data?.data.dq.findings.filter((f) => f.severity === 'error' || f.severity === 'fault') ?? [];
  const mixedRules = ops.data?.data.shiftRuleRegimes?.filter((r) => r.mixed) ?? [];

  return (
    <Block first label={W.setupTabs.sync}>
      <p className={h && h.kind !== 'ok' ? 'acc' : ''} style={{ fontSize: 'var(--fs-qual)' }}>{verdict}</p>
      <p className="mut sm" style={{ marginTop: 8 }}>{W.sync.source}</p>

      <dl className="kv" style={{ marginTop: 20 }}>
        <dt>{W.sync.lastPass}</dt>
        <dd>{h?.ageSeconds == null ? '—' : `${fmtSpan(h.ageSeconds)} ${W.ago}`}</dd>
        <dt>{W.sync.oldestTable}</dt>
        <dd>{h?.oldestTable ?? '—'}</dd>
        <dt>{W.sync.findings}</dt>
        <dd>{blocking.length === 0 ? W.sync.none : `${blocking.length}`}</dd>
      </dl>

      {failures.length > 0 && (
        <p className="acc" style={{ marginTop: 14 }}>
          {failures.length} of {ops.data?.data.sync.length} tables did not sync on the last pass.
        </p>
      )}
      {/* The worker's own words for why. A generation halt says which command
          to run; a connection halt names the host; a "not read this pass" row
          points at the table that stopped it. */}
      {failures.length > 0 && ops.data?.data.lifetime.lastFailure?.error && (
        <p className="mut sm" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
          {W.sync.lastFailure(ops.data.data.lifetime.lastFailure.targetTable)}{' '}
          {ops.data.data.lifetime.lastFailure.error}
        </p>
      )}

      {/* Only appears when a table genuinely holds two regimes, which can
          only happen after the night rule was changed without a rebuild. */}
      {mixedRules.length > 0 && (
        <p className="acc" style={{ marginTop: 14 }}>
          {W.sync.mixedShiftRules(mixedRules.map((r) => r.table).join(', '))}
        </p>
      )}

      <Details summary={W.sync.perTable}>
        {ops.loading && !ops.data ? (
          <SkelLines n={4} short />
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Outcome</th>
                  <th>Generation</th>
                  <th className="n">Rows written</th>
                  <th className="n">Watermark</th>
                  <th className="n">Age</th>
                </tr>
              </thead>
              <tbody>
                {(ops.data?.data.sync ?? []).map((s) => (
                  <tr key={s.targetTable}>
                    <td>{s.targetTable}</td>
                    <td className={s.outcome === 'success' ? '' : 'acc'}>{s.outcome}</td>
                    {/* The watermark is IFL's own id and IFL restarts it (their
                        2026-08-05 rebuild). Without the generation beside it
                        the number just jumps from 204,076 to 1 for no reason. */}
                    <td>{s.epochLabel ?? W.sync.preEpochPass}</td>
                    <td className="n">{s.rowsWritten}</td>
                    <td className="n">
                      {s.watermarkFrom == null || s.watermark == null ? '—' : `${s.watermarkFrom} → ${s.watermark}`}
                    </td>
                    <td className="n">{s.ageSeconds == null ? '—' : fmtSpan(s.ageSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {h?.cadenceSeconds != null && (
          <p style={{ marginTop: 12 }}>
            Passes arrive about every {fmtSpan(h.cadenceSeconds)}; the connection is called stale after{' '}
            {fmtSpan(h.staleAfterSeconds)}. Both are measured, not assumed.
          </p>
        )}
      </Details>
    </Block>
  );
}

/* ---------------------------------------------------------------- stations */

function Stations() {
  const [rows, setRows] = useState<StationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const load = () =>
    getStations()
      .then((r) => setRows(r.stations))
      .catch((e) => setError(String(e.message ?? e)));
  useEffect(() => {
    void load();
  }, []);

  if (error) return <Block label={W.setupTabs.stations}><Failed error={error} onRetry={load} /></Block>;
  if (!rows) return <Block label={W.setupTabs.stations}><SkelLines n={4} short /></Block>;

  return (
    <Block label={W.setupTabs.stations} note="the names every screen uses">
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th style={{ width: '4em' }}>#</th>
              <th>Name</th>
              <th>Machine</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.stationId}>
                <td>{s.stationId}</td>
                <td>
                  {editing === s.stationId ? (
                    <input
                      type="text"
                      value={draft}
                      autoFocus
                      aria-label={`Name for station ${s.stationId}`}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') setEditing(null);
                        if (e.key === 'Enter') {
                          await adminSetStation(s.stationId, { name: draft.trim() || null, machine: s.machine, description: s.description });
                          setEditing(null);
                          void load();
                        }
                      }}
                    />
                  ) : (
                    s.name ?? <span className="mut">not named</span>
                  )}
                </td>
                <td>{s.machine ?? <span className="mut">—</span>}</td>
                <td className="n">
                  <button type="button" className="linkish sm" onClick={() => { setEditing(s.stationId); setDraft(s.name ?? ''); }}>
                    Rename
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

/* ------------------------------------------------------------------ rules */

function RulesBlock() {
  const [rules, setRules] = useState<Rules | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    adminGetRules()
      .then(setRules)
      .catch((e) => setError(String(e.message ?? e)));
  };
  useEffect(() => {
    void load();
  }, []);

  // Finding H14 (Sep 2026 audit): this used to swallow a fetch failure into
  // `rules: null`, which renders identically to "still loading" — a
  // persistent failure here looked exactly like a slow connection forever.
  if (error) return <Block label={W.setupTabs.rules}><Failed error={error} onRetry={load} /></Block>;
  if (!rules) return <Block label={W.setupTabs.rules}><SkelLines n={4} short /></Block>;

  return (
    <Block label={W.setupTabs.rules} note="what this system applies when it reads the plant's numbers">
      <dl className="kv">
        <dt>Weight basis</dt>
        <dd>
          {rules.weight?.basis ?? '—'}
          {rules.weight?.basis === 'as_recorded' && (
            <span className="mut sm">
              {' '}— until this is confirmed, the Weight screen states the average and the target as two facts rather
              than as a difference.
            </span>
          )}
        </dd>
        <dt>Shift boundaries</dt>
        <dd>{rules.shift ? `${rules.shift.morningStart} · ${rules.shift.eveningStart} · ${rules.shift.nightStart} (${rules.shift.mode})` : '—'}</dd>
        <dt>Plausible cone</dt>
        <dd>{rules.plausibility ? `${fmtG(rules.plausibility.coneLoG)} to ${fmtG(rules.plausibility.coneHiG)}` : '—'}</dd>
        <dt>Plausible sack</dt>
        <dd>{rules.plausibility ? `${fmtKg(rules.plausibility.sackLoKg)} to ${fmtKg(rules.plausibility.sackHiKg)}` : '—'}</dd>
      </dl>
    </Block>
  );
}

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
          // — the server answers 409 with exactly that message.
          setFailed(e instanceof ApiError && e.status === 409 ? e.message : W.couldNotLoad);
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
        <input type="password" value={password} required minLength={6} onChange={(e) => setPassword(e.target.value)} />
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

/* -------------------------------------------------------------- audit log */

function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    adminGetAudit()
      .then((r) => setRows(r.entries))
      .catch((e) => setError(String(e.message ?? e)));
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
            {rows.slice(0, 40).map((e) => (
              <tr key={e.auditId}>
                <td>{new Date(e.atUtc).toLocaleString('en-GB')}</td>
                <td>{e.actorName ?? '—'}</td>
                <td>{e.action}</td>
                <td className="mut">{e.detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}
