/**
 * The sync verdict, the last pass, per-table outcome with generation and
 * halted reason — the block Setup › Sync health has shown since 3 Sep 2026,
 * factored out on 14 Sep 2026 (roadmap Phase 11 item 2) so the Health
 * screen, open to every signed-in account, shows the SAME facts rather than
 * a second implementation of them. One block, two places; REDESIGN.md's rule
 * that no two screens may answer the same question differently is kept by
 * there being one component.
 *
 * `isAdmin` governs one thing: the source-table list (/api/admin/sources,
 * rank 4) that places an epoch status on the sync row of the raw table it
 * feeds. Without it the status is not lost — lib/syncHealth.ts returns it as
 * `unplaced` and it is listed under the table by name — so a manager sees
 * the halt and its reason exactly as an admin does, minus the placement.
 */
import { useLive, usePolling } from '../../lib/live';
import { W } from '../../lib/words';
import { Block, Details, SkelLines } from '../../ui/bits';
import { fmtAppInstant, fmtSpan } from '../../lib/fmt';
import { noOpenEpochs } from '../../lib/syncHealth';
import { adminGetSources, getOperations } from '../../api';
import { useResource } from '../setup/shared';

export function SyncHealthBlock({ first, isAdmin }: { first?: boolean; isAdmin: boolean }) {
  const { line } = useLive();
  const ops = usePolling(() => getOperations(), 60_000, 'operations');
  // The line's source tables, for one join only: /api/operations names a
  // sync row by its RAW table (cone_raw) and an epoch status by its SOURCE
  // table (pack1_TP1U2), and sms.source_table is the bridge. The route is
  // admin-only, so a non-admin skips it; see lib/syncHealth.ts for what a
  // missing list costs (the placement, never the fact).
  const sources = useResource(() => (isAdmin ? adminGetSources() : Promise.resolve(null)));
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
  // The severities are the database's own: CK_dq_severity allows exactly
  // INFO / WARNING / ERROR / CRITICAL. This compared against 'error' and
  // 'fault' — neither of which any row can hold — so the count read "None"
  // no matter what was standing. Found 14 Sep 2026 while making the worker's
  // halts visible; the transform_failed CRITICAL finding is the first that
  // would have been hidden by it in practice.
  const blocking = ops.data?.data.dq.findings.filter((f) => f.severity === 'ERROR' || f.severity === 'CRITICAL') ?? [];
  const mixedRules = ops.data?.data.shiftRuleRegimes?.filter((r) => r.mixed) ?? [];

  // Roadmap Phase 2 (14 Sep 2026): the source block. Absent from an API
  // built before it, in which case the probe line says so and the halted
  // sentence does not appear — `halted` read defensively for the same reason.
  const src = ops.data?.data.source ?? null;
  const halted = src?.halted ?? [];
  const lastFailure = ops.data?.data.lifetime.lastFailure ?? null;
  // The newest failed row and the newest halted row are usually the same
  // row; when they carry the same text it is printed once, under the halted
  // sentence, which is the one that says what to do.
  const failureIsTheHalt = lastFailure?.error != null && src?.lastHalt != null && lastFailure.error === src.lastHalt.reason;

  // Per source table, from the epoch register, placed on the sync row of the
  // raw table it feeds; whatever cannot be placed is listed under the table.
  const epochs = noOpenEpochs(
    ops.data?.data.schema ?? [],
    sources.data?.tables ?? null,
    (ops.data?.data.sync ?? []).map((s) => s.targetTable),
  );

  return (
    <Block first={first} label={W.setupTabs.sync}>
      <p className={h && h.kind !== 'ok' ? 'acc' : ''} style={{ fontSize: 'var(--fs-qual)' }}>{verdict}</p>
      <p className="mut sm" style={{ marginTop: 8 }}>{W.sync.source}</p>

      <dl className="kv" style={{ marginTop: 20 }}>
        <dt>{W.sync.lastPass}</dt>
        <dd>{h?.ageSeconds == null ? '—' : `${fmtSpan(h.ageSeconds)} ${W.ago}`}</dd>
        <dt>{W.sync.oldestTable}</dt>
        <dd>{h?.oldestTable ?? '—'}</dd>
        {/* What the worker found when it last tried the plant — not what this
            API can see, which is nothing: it never opens the plant connection.
            The probe instant is app-UTC, so it takes the app-instant format. */}
        {src != null && (
          <>
            <dt>{W.sync.probe}</dt>
            <dd className={src.lastProbeOk === false ? 'acc' : ''}>
              {src.lastProbeOk == null || src.lastProbeAtUtc == null
                ? W.sync.probeNotMeasured
                : src.lastProbeOk
                  ? W.sync.probeOk(fmtAppInstant(src.lastProbeAtUtc))
                  : W.sync.probeFailed(fmtAppInstant(src.lastProbeAtUtc))}
            </dd>
          </>
        )}
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
      {failures.length > 0 && lastFailure?.error && !failureIsTheHalt && (
        <p className="mut sm" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
          {W.sync.lastFailure(lastFailure.targetTable)}{' '}
          {lastFailure.error}
        </p>
      )}
      {/* Halted, as distinct from failed: the worker refused to read these
          tables and said why. The reason is printed verbatim and pre-wrapped
          because it carries the command line that clears it. */}
      {halted.length > 0 && (
        <>
          <p className="acc" style={{ marginTop: 14 }}>{W.sync.halted(halted.length, halted.join(', '))}</p>
          {src?.lastHalt && (
            <p className="mut sm" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {W.sync.lastReason} {src.lastHalt.reason}
            </p>
          )}
        </>
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
                {(ops.data?.data.sync ?? []).map((s) => {
                  // The epoch register's verdict on the SOURCE table this row
                  // copies, when it has one worth a sentence: no open
                  // generation means the worker halts here before reading.
                  // 'enforced-by-worker' says nothing extra — it is the normal
                  // state of every table.
                  const noEpochOn = epochs.byTarget.get(s.targetTable);
                  return (
                    <tr key={s.targetTable}>
                      <td>{s.targetTable}</td>
                      <td className={s.outcome === 'success' ? '' : 'acc'}>
                        {s.outcome}
                        {noEpochOn != null && (
                          <span className="acc sm" style={{ display: 'block', maxWidth: '44ch' }}>
                            {W.sync.noOpenEpoch(noEpochOn)}
                          </span>
                        )}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* A halted source table with no sync row to sit on — or none that
            could be matched, when the sources list did not load or the reader
            is not an admin — is listed here by name rather than dropped. */}
        {epochs.unplaced.map((table) => (
          <p key={table} className="acc sm" style={{ marginTop: 10 }}>{W.sync.noOpenEpoch(table)}</p>
        ))}
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
