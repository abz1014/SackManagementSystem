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
import { useLive, usePolling } from '../floor/live';
import { W } from '../lib/words';
import { Block, Details, Empty, Failed, Loading } from '../ui/bits';
import { fmtSpan } from '../floor/fmt';
import {
  adminGetAudit, adminGetRules, adminListUsers, adminSetStation, getStations,
  getOperations, type AdminUser, type AuditEntry, type Rules, type StationRow,
} from '../api';

export function SetupScreen() {
  return (
    <>
      <p className="q">{W.question.setup}</p>
      <h1 className="wide">Setup</h1>
      <SyncHealth />
      <Stations />
      <RulesBlock />
      <People />
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

      <Details summary={W.sync.perTable}>
        {ops.loading && !ops.data ? (
          <Loading />
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Outcome</th>
                  <th className="n">Rows written</th>
                  <th className="n">Age</th>
                </tr>
              </thead>
              <tbody>
                {(ops.data?.data.sync ?? []).map((s) => (
                  <tr key={s.targetTable}>
                    <td>{s.targetTable}</td>
                    <td className={s.outcome === 'success' ? '' : 'acc'}>{s.outcome}</td>
                    <td className="n">{s.rowsWritten}</td>
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
  if (!rows) return <Block label={W.setupTabs.stations}><Loading /></Block>;

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
  useEffect(() => {
    void adminGetRules().then(setRules).catch(() => setRules(null));
  }, []);
  if (!rules) return <Block label={W.setupTabs.rules}><Loading /></Block>;

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
        <dd>{rules.plausibility ? `${rules.plausibility.coneLoG} to ${rules.plausibility.coneHiG} g` : '—'}</dd>
        <dt>Plausible sack</dt>
        <dd>{rules.plausibility ? `${rules.plausibility.sackLoKg} to ${rules.plausibility.sackHiKg} kg` : '—'}</dd>
      </dl>
    </Block>
  );
}

/* ----------------------------------------------------------------- people */

function People() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  useEffect(() => {
    void adminListUsers().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);
  if (!users) return <Block label={W.setupTabs.people}><Loading /></Block>;

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
            {users.map((u) => (
              <tr key={u.userId}>
                <td>{u.displayName ?? <span className="mut">—</span>}</td>
                <td>{u.username}</td>
                <td>{u.role}</td>
                <td>{u.active ? 'yes' : <span className="acc">no</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

/* -------------------------------------------------------------- audit log */

function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    void adminGetAudit().then((r) => setRows(r.entries)).catch(() => setRows([]));
  }, []);
  if (!rows) return <Block label={W.setupTabs.audit}><Loading /></Block>;
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
