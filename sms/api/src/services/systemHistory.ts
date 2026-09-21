/**
 * `GET /api/system-history` (UX Phase 7 Brief 2, rank 1) — three things the
 * database already knows and no screen has ever read back:
 *
 *  - `generations`: every `sms.source_epoch` row for the line, open and
 *    CLOSED — `api/src/services/operations.ts`'s `schema` block collapses
 *    this to only the open row per table (see its comment), which is right
 *    for "is the worker enforcing a fingerprint right now" but throws away
 *    exactly the fact this endpoint exists to answer: July's 142,511 cones
 *    and September's 132,552 live under different generations, and nothing
 *    before this endpoint could say so. Modelled on the same listing
 *    `cli/src/commands/verify.ts`'s "Source generations" table builds
 *    (verify.ts:490-503), including the raw row count per generation.
 *
 *  - `rebuilds`: `sms.rebuild_audit` (migration 010, `cli/src/commands/
 *    rebuild.ts`), which records every canonical rebuild and until now had
 *    no reader anywhere — confirmed by grep, see the route's own comment in
 *    app.ts.
 *
 *  - `verifyRuns`: `sms.verify_run` (migration 039), the record `sms verify`
 *    itself now writes at the end of a run (cli/src/commands/verify.ts) so
 *    the application can finally say whether it has ever been reconciled
 *    against IFL's source, and against WHICH source — a run against the
 *    local `_SEP07` copy must never read as a run against the plant.
 *
 * All three are read-only queries against the app-owned sidecar DB only;
 * this route has no connection to IFL's database and cannot run `sms
 * verify` itself (see the route's own comment in app.ts for why that is
 * deliberately out of scope).
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

/** Display/pagination guard, not a real pagination scheme — same spirit as operations.ts's TOP 200 on dq_finding. */
export const REBUILD_CAP = 100;
export const VERIFY_RUN_CAP = 100;

export interface SourceGeneration {
  epochId: number;
  sourceTable: string;
  label: string;
  generationOrdinal: number;
  provenance: string;
  sourceServer: string;
  sourceDb: string;
  firstSeenUtc: string;
  lastSeenUtc: string | null;
  closedUtc: string | null;
  registeredBy: string;
  archivedBelowId: number | null;
  archivedObservedUtc: string | null;
  /** Raw rows this generation holds, summed across whichever raw table it belongs to. */
  rawRowCount: number;
}

export interface RebuildRun {
  rebuildId: number;
  snapshotId: string;
  fromTransformVersion: number;
  toTransformVersion: number;
  targetTable: string;
  rowsRebuilt: number;
  startedAtUtc: string;
  finishedAtUtc: string | null;
  outcome: string;
  initiatedBy: number | null;
  errorMessage: string | null;
}

export interface VerifyRun {
  verifyRunId: number;
  startedAtUtc: string;
  finishedAtUtc: string | null;
  sourceServer: string;
  sourceDb: string;
  appServer: string;
  appDb: string;
  lineId: number;
  stops: number;
  weightsChecked: boolean;
  windowFrom: string | null;
  windowTo: string | null;
  verdict: 'clean' | 'stops';
  summary: string | null;
  smsVersion: string | null;
}

export interface SystemHistory {
  generations: SourceGeneration[];
  rebuilds: RebuildRun[];
  verifyRuns: VerifyRun[];
}

/**
 * Raw row counts per generation, from the four raw tables directly rather
 * than from a source-table → raw-table name mapping: `epoch_id` is a global
 * identity in `sms.source_epoch`, and each generation's rows live under
 * exactly one of the four raw tables, so summing all four grouped by
 * `source_epoch` gives the right count per epoch without needing to know
 * which table it was (the mapping sync-worker/src/reader/iflTables.ts owns,
 * and this API does not import that package).
 */
async function rawRowCountsByEpoch(pool: ConnectionPool, lineId: number): Promise<Map<number, number>> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{ epoch_id: number | null; n: number }>(`
    SELECT source_epoch AS epoch_id, COUNT(*) AS n FROM sms_raw.cone_raw WHERE line_id = @line GROUP BY source_epoch
    UNION ALL
    SELECT source_epoch, COUNT(*) FROM sms_raw.sack_raw WHERE line_id = @line GROUP BY source_epoch
    UNION ALL
    SELECT source_epoch, COUNT(*) FROM sms_raw.reject_qcs_raw WHERE line_id = @line GROUP BY source_epoch
    UNION ALL
    SELECT source_epoch, COUNT(*) FROM sms_raw.reject_weight_raw WHERE line_id = @line GROUP BY source_epoch
  `);
  const out = new Map<number, number>();
  for (const row of r.recordset) {
    if (row.epoch_id == null) continue;
    const e = Number(row.epoch_id);
    out.set(e, (out.get(e) ?? 0) + Number(row.n));
  }
  return out;
}

async function loadGenerations(pool: ConnectionPool, lineId: number): Promise<SourceGeneration[]> {
  const [epochs, counts] = await Promise.all([
    pool.request().input('line', mssql.Int, lineId).query<{
      epoch_id: number;
      source_table: string;
      label: string;
      generation_ordinal: number;
      provenance: string;
      source_server: string;
      source_db: string;
      first_seen_utc: Date;
      last_seen_utc: Date | null;
      closed_utc: Date | null;
      registered_by: string;
      archived_below_id: number | null;
      archived_observed_utc: Date | null;
    }>(
      `SELECT epoch_id, source_table, label, generation_ordinal, provenance, source_server, source_db,
              first_seen_utc, last_seen_utc, closed_utc, registered_by, archived_below_id, archived_observed_utc
         FROM sms.source_epoch
        WHERE line_id = @line
        ORDER BY source_table, epoch_id`,
    ),
    rawRowCountsByEpoch(pool, lineId),
  ]);
  return epochs.recordset.map((e) => ({
    epochId: e.epoch_id,
    sourceTable: e.source_table,
    label: e.label,
    generationOrdinal: e.generation_ordinal,
    provenance: e.provenance,
    sourceServer: e.source_server,
    sourceDb: e.source_db,
    firstSeenUtc: e.first_seen_utc.toISOString(),
    lastSeenUtc: e.last_seen_utc ? e.last_seen_utc.toISOString() : null,
    closedUtc: e.closed_utc ? e.closed_utc.toISOString() : null,
    registeredBy: e.registered_by,
    archivedBelowId: e.archived_below_id == null ? null : Number(e.archived_below_id),
    archivedObservedUtc: e.archived_observed_utc ? e.archived_observed_utc.toISOString() : null,
    rawRowCount: counts.get(e.epoch_id) ?? 0,
  }));
}

/**
 * `sms.rebuild_audit` carries no `line_id` (migration 010 — one line existed
 * when it was written) — newest-first across the whole app database, same
 * as every other reader of it would see. Not scoped by `lineId` for that
 * reason; the parameter is accepted anyway so the call shape matches the
 * other two loaders and a future multi-line migration has one call site to
 * change, not a route.
 */
async function loadRebuilds(pool: ConnectionPool): Promise<RebuildRun[]> {
  const r = await pool.request().query<{
    rebuild_id: number;
    snapshot_id: string;
    from_transform_version: number;
    to_transform_version: number;
    target_table: string;
    rows_rebuilt: number;
    started_at_utc: Date;
    finished_at_utc: Date | null;
    outcome: string;
    initiated_by: number | null;
    error_message: string | null;
  }>(
    `SELECT TOP ${REBUILD_CAP} rebuild_id, snapshot_id, from_transform_version, to_transform_version, target_table,
            rows_rebuilt, started_at_utc, finished_at_utc, outcome, initiated_by, error_message
       FROM sms.rebuild_audit
      ORDER BY rebuild_id DESC`,
  );
  return r.recordset.map((row) => ({
    rebuildId: row.rebuild_id,
    snapshotId: row.snapshot_id,
    fromTransformVersion: row.from_transform_version,
    toTransformVersion: row.to_transform_version,
    targetTable: row.target_table,
    rowsRebuilt: row.rows_rebuilt,
    startedAtUtc: row.started_at_utc.toISOString(),
    finishedAtUtc: row.finished_at_utc ? row.finished_at_utc.toISOString() : null,
    outcome: row.outcome,
    initiatedBy: row.initiated_by,
    errorMessage: row.error_message,
  }));
}

async function loadVerifyRuns(pool: ConnectionPool, lineId: number): Promise<VerifyRun[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    verify_run_id: number;
    started_at_utc: Date;
    finished_at_utc: Date | null;
    source_server: string;
    source_db: string;
    app_server: string;
    app_db: string;
    line_id: number;
    stops: number;
    weights_checked: boolean;
    window_from: Date | null;
    window_to: Date | null;
    verdict: string;
    summary: string | null;
    sms_version: string | null;
  }>(
    `SELECT TOP ${VERIFY_RUN_CAP} verify_run_id, started_at_utc, finished_at_utc, source_server, source_db,
            app_server, app_db, line_id, stops, weights_checked, window_from, window_to, verdict, summary, sms_version
       FROM sms.verify_run
      WHERE line_id = @line
      ORDER BY verify_run_id DESC`,
  );
  return r.recordset.map((row) => ({
    verifyRunId: row.verify_run_id,
    startedAtUtc: row.started_at_utc.toISOString(),
    finishedAtUtc: row.finished_at_utc ? row.finished_at_utc.toISOString() : null,
    sourceServer: row.source_server,
    sourceDb: row.source_db,
    appServer: row.app_server,
    appDb: row.app_db,
    lineId: row.line_id,
    stops: row.stops,
    weightsChecked: Boolean(row.weights_checked),
    windowFrom: row.window_from ? row.window_from.toISOString() : null,
    windowTo: row.window_to ? row.window_to.toISOString() : null,
    verdict: row.verdict === 'clean' ? 'clean' : 'stops',
    summary: row.summary,
    smsVersion: row.sms_version,
  }));
}

export async function getSystemHistory(pool: ConnectionPool, lineId: number): Promise<SystemHistory> {
  const [generations, rebuilds, verifyRuns] = await Promise.all([
    loadGenerations(pool, lineId),
    loadRebuilds(pool),
    loadVerifyRuns(pool, lineId),
  ]);
  return { generations, rebuilds, verifyRuns };
}
