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
import { useState } from 'react';
import { useLive, usePolling } from '../../lib/live';
import { W } from '../../lib/words';
import { Block, Details, Failed, SkelLines } from '../../ui/bits';
import { fmtAppInstant, fmtClock, fmtSpan } from '../../lib/fmt';
import { healthExcludedLine, healthGenerationLine } from '../../lib/generationWords';
import { batchName } from '../../lib/batchName';
import { noOpenEpochs } from '../../lib/syncHealth';
import { adminGetSources, getOperations, getDqDestination, ApiError, type DqFinding } from '../../api';
import { useResource } from '../setup/shared';

/**
 * A DQ finding's link to the first offending row it counts (UX Phase 7
 * Brief 3, over Brief 2's `/api/dq-destination`). Brief 2's own contract for
 * this endpoint turned out to be wrong once checked against real data —
 * `subject_table` is the CANONICAL name ('cone_event'/'sack_event') for 8 of
 * the 9 row-scoped checks, not the raw short name the endpoint takes, and
 * `reject_event` findings are genuinely ambiguous between the QCS and
 * weight-scale raw tables (sync-worker/src/transform/dq.ts:210 vs :312-314).
 * This maps the wire's canonical name to the raw name the endpoint actually
 * wants, and refuses to guess for reject_event at all.
 */
const RAW_TABLES = ['cone_raw', 'sack_raw', 'reject_qcs_raw', 'reject_weight_raw'] as const;
type RawDqTable = (typeof RAW_TABLES)[number];
function isRawDqTable(v: string): v is RawDqTable {
  return (RAW_TABLES as readonly string[]).includes(v);
}
function dqRawTableFor(subjectTable: string | null): RawDqTable | null {
  if (subjectTable == null) return null;
  if (subjectTable === 'cone_event') return 'cone_raw';
  if (subjectTable === 'sack_event') return 'sack_raw';
  if (subjectTable === 'reject_event') return null; // ambiguous — never guess (see comment above)
  // station_not_in_roster already writes the raw short name directly.
  return isRawDqTable(subjectTable) ? subjectTable : null;
}
function DqSourceLink({
  finding,
  onOpenReading,
}: {
  finding: DqFinding;
  /** Absent on Setup's copy of this block, which has no sheet to open into
   *  (SyncHealthBlock is shared with Setup.tsx, outside this brief's file
   *  ownership) — the row is then named but not clickable, never silently
   *  dropped. */
  onOpenReading?: (type: 'cone' | 'sack' | 'reject', id: string | number) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'gone'>('idle');

  if (finding.subjectRef == null) return <span className="mut">—</span>;
  if (finding.subjectTable === 'reject_event') {
    return <span className="mut sm">{W.health.dqRejectSourceUnresolvable}</span>;
  }
  const raw = dqRawTableFor(finding.subjectTable);
  if (raw == null) return <span className="mut">—</span>;
  if (state === 'gone') return <span className="mut sm">{W.health.sourceRowGone}</span>;
  if (!onOpenReading) return <span className="mut sm">{W.health.dqFindingSourceRow}</span>;

  return (
    <button
      type="button"
      className="linkish"
      disabled={state === 'loading'}
      onClick={async () => {
        setState('loading');
        try {
          const dest = await getDqDestination(raw, finding.subjectRef!);
          onOpenReading(dest.type, dest.id);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) setState('gone');
          else setState('idle'); // transient failure — leave the control live so a click can retry
        }
      }}
    >
      {state === 'loading' ? W.loading : W.health.dqFindingSourceRow}
    </button>
  );
}

export function SyncHealthBlock({
  first,
  isAdmin,
  onOpenReading,
}: {
  first?: boolean;
  isAdmin: boolean;
  /** UX Phase 7 Brief 3: opens the canonical row a DQ finding's subjectRef
   *  resolves to, the same sheet Line/Readings/Sacks open theirs in. Health
   *  always passes one; Setup's copy of this block does not (see
   *  DqSourceLink's comment). */
  onOpenReading?: (type: 'cone' | 'sack' | 'reject', id: string | number) => void;
}) {
  const { line } = useLive();
  const ops = usePolling(() => getOperations(), 60_000, 'operations');
  // The line's source tables, for one join only: /api/operations names a
  // sync row by its RAW table (cone_raw) and an epoch status by its SOURCE
  // table (pack1_TP1U2), and sms.source_table is the bridge. The route is
  // admin-only, so a non-admin skips it; see lib/syncHealth.ts for what a
  // missing list costs (the placement, never the fact).
  const sources = useResource(() => (isAdmin ? adminGetSources() : Promise.resolve(null)));
  const h = line?.health ?? null;

  // Exhaustive over LiveHealthKind (web/src/api.ts:1113: 'ok'|'stale'|'late'|
  // 'lag_unknown'|'no_data') — found live, not a fuzz-only edge case: this
  // used to branch on 'stale'/'late' only and fall through to W.sync.ok for
  // anything else, so a real 'lag_unknown' or 'no_data' response printed a
  // false all-clear on the one screen whose job is to report breakage. The
  // final `default` covers a value this union does not admit today (a
  // future kind added server-side before this switch is updated) — it must
  // say "could not be read", never OK, exactly like every other case here.
  const verdict =
    h == null
      ? W.loading
      : h.kind === 'stale'
        ? W.sync.stale
        : h.kind === 'late'
          ? W.lag.late(fmtSpan(line?.ingestLagSeconds ?? 0))
          : h.kind === 'lag_unknown'
            ? W.sync.lagUnknown
            : h.kind === 'no_data'
              ? W.lag.noData
              : h.kind === 'ok'
                ? W.sync.ok
                : W.sync.unknownKind;

  const failures = ops.data?.data.sync.filter((s) => s.outcome !== 'success') ?? [];
  // The severities are the database's own: CK_dq_severity allows exactly
  // INFO / WARNING / ERROR / CRITICAL. This compared against 'error' and
  // 'fault' — neither of which any row can hold — so the count read "None"
  // no matter what was standing. Found 14 Sep 2026 while making the worker's
  // halts visible; the transform_failed CRITICAL finding is the first that
  // would have been hidden by it in practice.
  const blocking = ops.data?.data.dq.findings.filter((f) => f.severity === 'ERROR' || f.severity === 'CRITICAL') ?? [];
  const mixedRules = ops.data?.data.shiftRuleRegimes?.filter((r) => r.mixed) ?? [];

  // Every finding, not only the blocking ones counted above — grouped by the
  // table it is about, '—' for the (rare) finding with none.
  const allFindings = ops.data?.data.dq.findings ?? [];
  const findingsByTable = new Map<string, typeof allFindings>();
  for (const f of allFindings) {
    const key = f.subjectTable ?? '—';
    const existing = findingsByTable.get(key);
    if (existing) existing.push(f);
    else findingsByTable.set(key, [f]);
  }

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
      {/* D-11, 23 Sep 2026. Health is the screen whose job is to report
          breakage, and it reported freshness and the acquisition lag from
          whichever generation happened to hold the newest rows. Both figures
          are now measured from ONE generation — the newest real one — and
          this states which, and what was left out of it. Without the second
          sentence a reader looking at a quiet Line or Wall screen has no way
          to tell "the plant stopped" from "the generation I am reading
          ended"; with it, the two are different sentences. */}
      {line?.generation && (
        <>
          <p className="mut sm" style={{ marginTop: 6 }}>{healthGenerationLine(line.generation)}</p>
          {healthExcludedLine(
            line.generation,
            line.generation.newerElsewhereUtc ? fmtClock(line.generation.newerElsewhereUtc) : null,
          ) && (
            <p className={line.generation.newerElsewhereUtc ? 'acc sm' : 'mut sm'} style={{ marginTop: 6 }}>
              {healthExcludedLine(
                line.generation,
                line.generation.newerElsewhereUtc ? fmtClock(line.generation.newerElsewhereUtc) : null,
              )}
            </p>
          )}
        </>
      )}

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
        {/* THE defect this phase exists to close (CLAUDE.md): a count that
            could not be read must never render identically to a count of
            zero. ops.error with no data at all means this figure was never
            answered, not that nothing is blocking. */}
        {/* 23 Sep 2026 sweep: the failed case was closed by Phase 7, the
            PENDING case was not. With no error yet and no data yet,
            `blocking.length === 0` is trivially true and this printed "None"
            — the same false all-clear, from the same absence of an answer,
            differing only in whether the first fetch had come back yet. The
            <Details> list immediately below already drew a skeleton in that
            state, so the count and its own itemisation disagreed. */}
        <dd>
          {ops.error && !ops.data
            ? W.health.dqBlockingCouldNotLoad
            : !ops.data
              ? W.loading
              : blocking.length === 0
                ? W.sync.none
                : `${blocking.length}`}
        </dd>
      </dl>

      {/* UX Phase 6 Brief 4 (16 Sep 2026): the findings themselves, not just
          their count. Every DqFinding already arrives on the wire
          (/api/operations dq.findings) — this lists ALL of them, not only the
          ERROR/CRITICAL ones counted above, grouped by the table each one is
          about, so a finding sits beside the per-table sync rows below rather
          than in a second, disconnected list. */}
      <Details summary={W.health.dqFindings}>
        {ops.error && !ops.data ? (
          <Failed error={ops.error} onRetry={ops.refresh} />
        ) : ops.loading && !ops.data ? (
          <SkelLines n={3} short />
        ) : allFindings.length === 0 ? (
          <p className="mut">{W.health.dqFindingsNone}</p>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Check</th>
                  <th>Severity</th>
                  <th>Detail</th>
                  <th>Source row</th>
                </tr>
              </thead>
              <tbody>
                {[...findingsByTable.entries()].flatMap(([table, findings]) =>
                  findings.map((f, i) => (
                    <tr key={`${table}:${f.checkName}:${i}`}>
                      <td>{i === 0 ? table : ''}</td>
                      <td>{f.checkName}</td>
                      <td className={f.severity === 'ERROR' || f.severity === 'CRITICAL' ? 'acc' : ''}>{f.severity}</td>
                      <td>{f.detail ?? '—'}</td>
                      <td>
                        <DqSourceLink finding={f} onOpenReading={onOpenReading} />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Details>

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
        {ops.error && !ops.data ? (
          <Failed error={ops.error} onRetry={ops.refresh} />
        ) : ops.loading && !ops.data ? (
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
                          the number just jumps from 204,076 to 1 for no reason.
                          Health defect 4 (28 Sep 2026): this used to print
                          `s.epochLabel` verbatim — `sms.source_epoch.label`,
                          the raw vendor table name plus an internal generation
                          count ("pack1_TP1U2 gen 4") meant for debugging the
                          sidecar, not for a plant manager. `batchName` reads
                          the same two facts a reader actually needs. */}
                      <td>
                        {s.epochId == null
                          ? W.sync.preEpochPass
                          : batchName({ ordinal: s.epochOrdinal ?? null, simulator: s.epochSimulator ?? false })}
                      </td>
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
        {/* Unit 2 (Brief 3): a failed /api/admin/sources fetch and "not an
            admin, so this was never fetched" both end up with the same
            epochs.unplaced list above (noOpenEpochs treats a null tables
            list identically either way) — but they are not the same fact,
            and only one of them is a problem worth a sentence. */}
        {isAdmin && sources.error && (
          <p className="acc sm" style={{ marginTop: 10 }}>{W.health.sourceListCouldNotLoad}</p>
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
