/**
 * Health — is this SYSTEM healthy (as distinct from the line), for every
 * signed-in account. Roadmap Phase 11 item 2 (14 Sep 2026).
 *
 * Why a screen and not a Setup section: Setup is admin-only, IFL's accounts
 * are created at manager, and the strip's data-age sentence linked to Setup
 * — so for the people who will actually use the product the sentence was a
 * dead end and the sync's state was invisible. The strip now links here.
 *
 * Four blocks, one fact each, in the order an operator asks: the plant link
 * (the same SyncHealthBlock Setup shows — one component, so the two cannot
 * disagree), the database against SQL Server Express's 10 GB cap, the
 * service's version and uptime, and the age of the newest backup file.
 * Every threshold on this page is the developer's default and the copy says
 * so where IFL's answer would change it (words.ts `health`).
 */
import { useLive, usePolling } from '../lib/live';
import { W } from '../lib/words';
import { Block, Details, Failed, SkelFigures, SkelLines } from '../ui/bits';
import { fmtAppInstant, fmtG, fmtInt, fmtSpan } from '../lib/fmt';
import { parsePeriodParams, resolvePeriod } from '../lib/period';
import { getHealth, getReconciliation, type ConeState, type WeightAggregate } from '../api';
import { SyncHealthBlock } from './health/SyncHealthBlock';
import { SystemHistoryBlock } from './health/SystemHistoryBlock';
import { PdasWriteBlock } from './health/PdasWriteBlock';

/**
 * The reconciliation figures for `Period` — a census of SMS's OWN canonical
 * readings (`sms.cone_event`), never a comparison against IFL's source; that
 * comparison is `sms verify`, a CLI command with no HTTP route.
 *
 * The period travels in the URL like everywhere else (lib/period.ts), but
 * HealthScreen has no `period` prop from App.tsx (health is admin/system
 * plumbing, not a period-scoped analysis screen) — so it is resolved here,
 * independently, from the same two inputs App.tsx uses: the URL's `p`/`from`/
 * `to` params and the plant clock `useLive()` already reports. Same anchor,
 * same rules, no prop needed.
 */
function ReconciliationBlock() {
  const { line } = useLive();
  const params = parsePeriodParams(new URLSearchParams(window.location.search));
  const period = line
    ? resolvePeriod(
        params.key,
        {
          shiftDate: line.shift.shiftDate,
          shiftCode: line.shift.code,
          shiftStartUtc: line.shift.startUtc,
          plantNowUtc: line.plantNowUtc,
          dataAsOfUtc: line.dataAsOfUtc,
        },
        params.picked,
      )
    : null;

  const rec = usePolling(
    () => (period ? getReconciliation(period.from, period.to, period.shift ?? null) : Promise.resolve(null)),
    5 * 60_000,
    `reconciliation:${period?.from ?? 'none'}:${period?.to ?? 'none'}:${period?.shift ?? 'all'}`,
  );
  const d = rec.data?.data ?? null;

  const row = (label: string, agg: WeightAggregate) => (
    <tr key={label}>
      <td>{label}</td>
      <td className="n">{fmtInt(agg.n)}</td>
      <td className="n">{fmtG(agg.avgG)}</td>
      <td className="n">{fmtG(agg.minG)}</td>
      <td className="n">{fmtG(agg.maxG)}</td>
    </tr>
  );

  const states: ConeState[] = ['within', 'low', 'high', 'rejected', 'unknown'];

  return (
    <Block label={W.health.reconciliationTitle}>
      <p className="mut sm">{W.health.reconciliationNote}</p>
      {!period || (rec.loading && !d) ? (
        <SkelFigures n={4} />
      ) : rec.error && !d ? (
        <Failed error={rec.error} onRetry={rec.refresh} />
      ) : d ? (
        <>
          <dl className="kv" style={{ marginTop: 20 }}>
            <dt>Period</dt>
            <dd>
              {d.from === d.to ? d.from : `${d.from} → ${d.to}`}
              {d.shift ? ` (${d.shift})` : ''}
            </dd>
            <dt>Plausibility window</dt>
            <dd>{fmtG(d.plausibility.loG)} – {fmtG(d.plausibility.hiG)}</dd>
          </dl>
          <Details summary="Readings by state">
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="n">N</th>
                    <th className="n">Avg</th>
                    <th className="n">Min</th>
                    <th className="n">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {row('Total', d.total)}
                  {row('Plausible', d.plausible)}
                  {row('Implausible', d.implausible)}
                  <tr>
                    <td>No weight</td>
                    <td className="n">{fmtInt(d.noWeight)}</td>
                    <td className="n">—</td>
                    <td className="n">—</td>
                    <td className="n">—</td>
                  </tr>
                  {states.map((s) => row(W.cone.state[s], d.byState[s]))}
                </tbody>
              </table>
            </div>
            {/* The server's own note, printed verbatim — it names the basis
                (as-recorded weight, no tube/tare adjustment) and that the
                plausibility window is unconfirmed by IFL. Not paraphrased,
                so a changed caveat on the server cannot go stale here. */}
            <p className="mut sm" style={{ marginTop: 12 }}>{d.note}</p>
          </Details>
        </>
      ) : null}
    </Block>
  );
}

export function HealthScreen({
  isAdmin,
  onOpenReading,
}: {
  isAdmin: boolean;
  /** UX Phase 7 Brief 3: a DQ finding's link to the source row it counts —
   *  see SyncHealthBlock's DqSourceLink. Same shape as every other screen's
   *  onOpenReading (App.tsx's `go({ sheet: { kind, id } })`). */
  onOpenReading: (type: 'cone' | 'sack' | 'reject', id: string | number) => void;
}) {
  const h = usePolling(() => getHealth(), 30_000, 'health');
  const r = h.data ?? null;

  return (
    <>
      <div className="page">
        <p className="q">{W.health.question}</p>
        <h1 className="wide">{W.health.title}</h1>
        {r && (
          <p className={r.status === 'ok' ? '' : 'acc'} style={{ fontSize: 'var(--fs-qual)', marginTop: 8 }}>
            {W.health.status[r.status]}
          </p>
        )}
      </div>

      <SyncHealthBlock first isAdmin={isAdmin} onOpenReading={onOpenReading} />

      <PdasWriteBlock report={r} error={h.error} onRetry={h.refresh} />

      <ReconciliationBlock />

      <SystemHistoryBlock />

      <Block label={W.health.database}>
        {h.error && !r ? (
          <Failed error={h.error} onRetry={h.refresh} />
        ) : !r ? (
          <SkelLines n={2} short />
        ) : (
          <>
            <p>
              {r.database.ok ? W.health.dbLatency(r.database.latencyMs ?? 0) : W.health.status.down}
            </p>
            <p style={{ marginTop: 8 }}>
              {r.database.sizeMb == null || r.database.pctOfCap == null
                ? W.health.dbSizeUnknown
                : W.health.dbSize(r.database.sizeMb.toFixed(0), r.database.pctOfCap.toFixed(1), Math.round(r.database.capMb / 1024))}
            </p>
            {r.database.pctOfCap != null && r.database.pctOfCap >= 80 && (
              <p className="acc" style={{ marginTop: 8, maxWidth: '70ch' }}>{W.health.dbNearCap}</p>
            )}
            {r.degradedReason && (
              <p className="acc sm" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{W.health.degradedBecause(r.degradedReason)}</p>
            )}
          </>
        )}
      </Block>

      <Block label={W.health.service}>
        {h.error && !r ? (
          <Failed error={h.error} onRetry={h.refresh} />
        ) : !r ? (
          <SkelLines n={2} short />
        ) : (
          <>
            <p>
              {W.health.version(r.service.version)} · {W.health.upSince(fmtSpan(r.service.uptimeSeconds))}
              {' · '}
              <span className="mut">since {fmtAppInstant(r.service.startedAtUtc)}</span>
            </p>
            <p className="mut sm" style={{ marginTop: 6 }}>{W.health.restarted}</p>
          </>
        )}
      </Block>

      <Block label={W.health.backup}>
        {h.error && !r ? (
          <Failed error={h.error} onRetry={h.refresh} />
        ) : !r ? (
          <SkelLines n={2} short />
        ) : r.backup == null ? (
          <p className="mut">{W.health.backupNone}</p>
        ) : (
          <>
            <p className={r.backup.warning ? 'acc' : ''}>
              {r.backup.newestFile && r.backup.newestAtUtc
                ? W.health.backupLast(fmtSpan(Math.round((r.backup.ageDays ?? 0) * 86_400)), r.backup.newestFile)
                : W.health.backupNone}
            </p>
            {r.backup.warning && <p className="acc sm" style={{ marginTop: 6, maxWidth: '70ch' }}>{W.health.backupWarn}</p>}
            <p className="mut sm" style={{ marginTop: 6 }}>{W.health.backupDir(r.backup.dir)}</p>
          </>
        )}
      </Block>
    </>
  );
}
