/** Operations service (ARCHITECTURE §8): sync health, schema, DQ roll-up. */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface SyncStatus {
  targetTable: string;
  outcome: string;
  /**
   * Source `id` bounds of the pass. Only meaningful WITH the epoch: IFL's
   * identities restarted at 1 on 2026-08-05, so without it the watermark
   * reads as a number that jumps from 204,076 to 1 for no reason
   * (SEPT-2026-EPOCH-DECISION §4.8). `epochId`/`epochLabel` are null for
   * passes recorded before the column existed — the screen says so.
   */
  watermarkFrom: number | null;
  watermark: number | null;
  epochId: number | null;
  epochLabel: string | null;
  rowsRead: number;
  rowsWritten: number;
  finishedAtUtc: string | null;
  ageSeconds: number | null;
}

/**
 * Schema-fingerprint status per SOURCE table, from `sms.source_epoch`.
 *
 * The fingerprint the worker enforces lives on the open epoch row (the one
 * with `closed_utc IS NULL`), and the worker — not this API — compares it to
 * the live source on every pass and halts on drift. This API cannot reach the
 * source at all, so it never reports 'ok': it reports what it can actually
 * see. 'enforced-by-worker' means an open epoch exists and carries the
 * fingerprint the worker is checking against; 'no-open-epoch' means nothing
 * is registered for that table and the worker halts on it until
 * `sms epoch:accept` runs.
 */
export interface SchemaEpoch {
  table: string;
  fingerprint: string | null;
  status: 'enforced-by-worker' | 'no-open-epoch';
  epochId: number | null;
  epochLabel: string | null;
}

/**
 * Lifetime sync figures, from every row `sms.sync_run` holds.
 *
 * `sync_run` records one row PER TABLE PER PASS, so the row count is not the
 * number of times the worker has run — on the supplied copy it is 65 rows
 * across 17 passes of 4 tables. Reporting the row count as "runs" would
 * overstate the work by ~4x, so both are returned and the screen says which
 * it is showing.
 *
 * Durations are per table-run, not per query, and are held as milliseconds.
 *
 * medianMs/p95Ms/slowestMs are over RECENT_WINDOW_DAYS, not all-time (finding
 * H9, Sep 2026 audit): PERCENTILE_CONT has to sort every row it's given, so
 * computing it over the whole, unboundedly-growing table on every 60s poll of
 * the Setup screen was a cost that grows forever for a number where "recent"
 * is what an operator actually wants anyway — a rate from a year ago tells
 * you nothing about whether today's sync is healthy. passes/tableRuns/
 * failures/firstRunUtc/lastRunUtc stay true lifetime figures: they're plain
 * COUNT/SUM/MIN/MAX, which the new index keeps cheap at any table size.
 */
/**
 * Seven days, not ninety. `sync_run` gains ~4 rows a minute (one per source
 * table per 60s pass) — about 5,800 a day — so a 90-day window would hand
 * PERCENTILE_CONT roughly half a million rows to sort TWICE on every 60s poll
 * of the Setup screen. Seven days is ~40,000 rows, and "how fast have passes
 * been running lately" is the question this figure answers anyway: a median
 * blended across a quarter of a year tells an operator nothing about today.
 */
export const RECENT_WINDOW_DAYS = 7;

export interface SyncLifetime {
  passes: number;
  tableRuns: number;
  failures: number;
  firstRunUtc: string | null;
  lastRunUtc: string | null;
  /** Over the last RECENT_WINDOW_DAYS days (7), not all-time. */
  medianMs: number | null;
  p95Ms: number | null;
  slowestMs: number | null;
  lastFailure: { targetTable: string; startedAtUtc: string; error: string | null } | null;
}

/**
 * Canonical tables that hold rows stamped with more than one night-attribution
 * rule — the H5 hazard, made visible.
 *
 * Changing the rule applies to newly-transformed rows at once, so until a
 * rebuild runs the table blends two regimes and every shift_date-keyed figure
 * silently mixes them. Nothing could detect that before migration 023 gave
 * each row a marker. `null` counts rows written before the marker existed.
 */
export interface ShiftRuleRegimes {
  table: string;
  rules: { rule: string | null; rows: number }[];
  mixed: boolean;
}

/**
 * The state of the SOURCE connection as the worker last reported it, read
 * from `sms.sync_run` (roadmap Phase 2 item 5, 14 Sep 2026). This API has no
 * connection to IFL's database at all, so everything here is second-hand:
 * the worker probes the source at the start of every pass and, when the
 * probe fails, writes one pass-level 'halted' row per table whose error_text
 * names the probe. Until this block the Setup screen could show that four
 * tables did not sync but not whether it was the connection or one table's
 * generation that stopped them.
 *
 *  - `lastProbeOk`: false when the newest pass carries a probe-failure halt,
 *    true when the newest pass has rows and none of them is one, null when
 *    sync_run is empty (nothing has ever run). The newest pass is the run_id
 *    of the newest row by started_at_utc.
 *  - `lastProbeAtUtc`: when that pass began — the probe runs first.
 *  - `lastProbeMs`: always null from this API — the worker logs the probe's
 *    round-trip in its pass summary (`sourceProbeMs`) but sync_run has no
 *    column for it, and inventing one is a schema change for a number the
 *    log already holds. Kept in the shape so the screen's type matches the
 *    build contract.
 *  - `lastHalt`: the newest 'halted' or 'failed' row — table, reason, when.
 *  - `halted`: every table whose LATEST row is 'halted' or 'failed', i.e. the
 *    tables that are not currently syncing. Empty when all are healthy.
 */
export interface SourceStatus {
  lastProbeOk: boolean | null;
  lastProbeAtUtc: string | null;
  lastProbeMs: number | null;
  lastHalt: { table: string; reason: string; atUtc: string } | null;
  halted: string[];
}

export interface OperationsData {
  sync: SyncStatus[];
  /** Non-empty only when at least one table is mixed — a rebuild is due. */
  shiftRuleRegimes: ShiftRuleRegimes[];
  lifetime: SyncLifetime;
  schema: SchemaEpoch[];
  source: SourceStatus;
  dq: {
    latestRunId: string | null;
    bySeverity: Record<string, number>;
    findings: {
      checkName: string;
      severity: string;
      subjectTable: string | null;
      detail: string | null;
      /**
       * The raw_id of the first offending row (sms.dq_finding.subject_ref,
       * migration 009; written by sync-worker/src/transform/dq.ts). Only the
       * nine row-scoped checks ever carry one — the other five (
       * source_columns_changed, raw_read_without_write, transform_zero_write,
       * product_mirror_failed, transform_failed) describe a pass or a table
       * as a whole and are written with no subject_ref, so this is null for
       * them by construction, not by an omission here. UX Phase 7 Brief 2.
       */
      subjectRef: number | null;
    }[];
  };
}

/**
 * How a probe-failure halt row is recognised. The worker writes the reason
 * as `source probe failed: <classification>: <message>`; when it goes through
 * the pass-level halt helper the text is framed as "Pass halted at source
 * probe, before any table was read. …" instead. A contains-match catches
 * both framings; a starts-with would silently miss the second and report the
 * probe as fine while every table sat halted on it.
 */
export const PROBE_HALT_PATTERN = '%source probe%';
/**
 * The other way a pass fails before any table is read: the source CONNECTION
 * itself (pass.ts connects with three transient-only attempts and writes
 * "Pass halted at source connection, before any table was read. …"). Found
 * in the 15 Sep 2026 recovery rehearsal — with the source port unreachable
 * every table sat halted on the connection and lastProbeOk still read true,
 * because only the probe phrasing was matched. Both mean the same thing to
 * an operator: the plant database could not be reached.
 */
export const CONNECT_HALT_PATTERN = '%source connection%';

/** Outcomes that mean "this table is not syncing" — see store.ts's recordHaltedRun for the distinction. */
const NOT_SYNCING = new Set(['halted', 'failed']);

export async function getOperations(pool: ConnectionPool, lineId: number): Promise<OperationsData> {
  // latest sync_run per target_table
  // LEFT JOIN, not INNER: source_epoch is NULL on every pass recorded before
  // the column existed, and those rows must still appear.
  const sync = await pool.request().input('line', mssql.Int, lineId).query<{
    target_table: string;
    outcome: string;
    watermark_from: number | null;
    watermark_to: number | null;
    source_epoch: number | null;
    epoch_label: string | null;
    rows_read: number;
    rows_written: number;
    finished_at_utc: Date | null;
    age_seconds: number | null;
    started_at_utc: Date;
    error_text: string | null;
  }>(`
    WITH latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY target_table ORDER BY sync_run_id DESC) rn
      FROM sms.sync_run WHERE line_id=@line
    )
    SELECT l.target_table, l.outcome, l.watermark_from, l.watermark_to, l.source_epoch, ep.label AS epoch_label,
           l.rows_read, l.rows_written, l.finished_at_utc,
           DATEDIFF(SECOND, l.finished_at_utc, SYSUTCDATETIME()) AS age_seconds,
           l.started_at_utc, l.error_text
    FROM latest l LEFT JOIN sms.source_epoch ep ON ep.epoch_id = l.source_epoch
    WHERE l.rn=1 ORDER BY l.target_table
  `);

  // The source block (SourceStatus). Two more reads over sync_run, both
  // seeks on IX_sync_run_line_started: the newest pass's rows, and the newest
  // row that is a halt. `halted` needs no query of its own — it is the latest
  // rows above whose outcome says the table is not syncing.
  const probe = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('probe', mssql.NVarChar(64), PROBE_HALT_PATTERN)
    .input('connect', mssql.NVarChar(64), CONNECT_HALT_PATTERN)
    .query<{ n: number; probe_failed: number; started_at_utc: Date | null }>(`
    WITH newest AS (
      SELECT TOP 1 run_id FROM sms.sync_run WHERE line_id = @line
      ORDER BY started_at_utc DESC, sync_run_id DESC
    )
    SELECT COUNT(*) AS n,
           SUM(CASE WHEN r.outcome = 'halted' AND (r.error_text LIKE @probe OR r.error_text LIKE @connect) THEN 1 ELSE 0 END) AS probe_failed,
           MIN(r.started_at_utc) AS started_at_utc
    FROM sms.sync_run r JOIN newest ON newest.run_id = r.run_id
    WHERE r.line_id = @line
  `);
  const pr = probe.recordset[0];
  const halt = await pool.request().input('line', mssql.Int, lineId).query<{
    target_table: string;
    started_at_utc: Date;
    error_text: string | null;
  }>(`
    SELECT TOP 1 target_table, started_at_utc, error_text
    FROM sms.sync_run WHERE line_id = @line AND outcome IN ('halted', 'failed')
    ORDER BY sync_run_id DESC
  `);
  const h0 = halt.recordset[0];
  const newestPassRows = Number(pr?.n ?? 0);
  const source: SourceStatus = {
    lastProbeOk: newestPassRows === 0 ? null : Number(pr?.probe_failed ?? 0) === 0,
    lastProbeAtUtc: newestPassRows > 0 && pr?.started_at_utc ? new Date(pr.started_at_utc).toISOString() : null,
    lastProbeMs: null,
    lastHalt: h0
      ? { table: h0.target_table, reason: h0.error_text ?? '', atUtc: new Date(h0.started_at_utc).toISOString() }
      : null,
    halted: sync.recordset.filter((r) => NOT_SYNCING.has(r.outcome)).map((r) => r.target_table),
  };

  // Lifetime roll-up: one pass writes one row per table, so passes and
  // table-runs are counted separately rather than conflated. Plain aggregates
  // over the whole table — cheap at any size with IX_sync_run_line_started.
  const life = await pool.request().input('line', mssql.Int, lineId).query<{
    passes: number;
    table_runs: number;
    failures: number;
    first_run: Date | null;
    last_run: Date | null;
  }>(`
    SELECT COUNT(DISTINCT run_id) AS passes,
           COUNT(*) AS table_runs,
           SUM(CASE WHEN outcome <> 'success' THEN 1 ELSE 0 END) AS failures,
           MIN(started_at_utc) AS first_run,
           MAX(started_at_utc) AS last_run
    FROM sms.sync_run WHERE line_id = @line
  `);
  const lr = life.recordset[0];

  // Timing percentiles, bounded to a recent window (finding H9) — see the
  // RECENT_WINDOW_DAYS comment on SyncLifetime for why.
  const timing = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('windowDays', mssql.Int, RECENT_WINDOW_DAYS)
    .query<{ median_ms: number | null; p95_ms: number | null; slowest_ms: number | null }>(`
    SELECT MAX(median_ms) AS median_ms, MAX(p95_ms) AS p95_ms, MAX(dur_ms) AS slowest_ms
    FROM (
      SELECT DATEDIFF(MILLISECOND, started_at_utc, finished_at_utc) AS dur_ms,
             PERCENTILE_CONT(0.50) WITHIN GROUP (
               ORDER BY DATEDIFF(MILLISECOND, started_at_utc, finished_at_utc)) OVER () AS median_ms,
             PERCENTILE_CONT(0.95) WITHIN GROUP (
               ORDER BY DATEDIFF(MILLISECOND, started_at_utc, finished_at_utc)) OVER () AS p95_ms
      FROM sms.sync_run
      WHERE line_id = @line AND started_at_utc >= DATEADD(DAY, -@windowDays, SYSUTCDATETIME())
    ) x
  `);
  const tm = timing.recordset[0];

  // the most recent failure, so "1 failure" is actionable rather than a bare count
  const fail = await pool.request().input('line', mssql.Int, lineId).query<{
    target_table: string;
    started_at_utc: Date;
    error_text: string | null;
  }>(`
    SELECT TOP 1 target_table, started_at_utc, error_text
    FROM sms.sync_run WHERE line_id = @line AND outcome <> 'success'
    ORDER BY sync_run_id DESC
  `);
  const f0 = fail.recordset[0];

  const lifetime: SyncLifetime = {
    passes: Number(lr?.passes ?? 0),
    tableRuns: Number(lr?.table_runs ?? 0),
    failures: Number(lr?.failures ?? 0),
    firstRunUtc: lr?.first_run ? lr.first_run.toISOString() : null,
    lastRunUtc: lr?.last_run ? lr.last_run.toISOString() : null,
    medianMs: tm?.median_ms != null ? Math.round(Number(tm.median_ms)) : null,
    p95Ms: tm?.p95_ms != null ? Math.round(Number(tm.p95_ms)) : null,
    slowestMs: tm?.slowest_ms != null ? Math.round(Number(tm.slowest_ms)) : null,
    lastFailure: f0
      ? { targetTable: f0.target_table, startedAtUtc: f0.started_at_utc.toISOString(), error: f0.error_text }
      : null,
  };

  // Schema fingerprints, per source table, from the epoch register. Every
  // generation of a table has its own row; the OPEN one (closed_utc IS NULL)
  // carries the fingerprint the worker enforces. Closed rows are read too so
  // a table with no open epoch still appears, flagged — otherwise a table the
  // worker is halted on would simply be missing from the list. See
  // SchemaEpoch for why the status is never 'ok'.
  const fp = await pool.request().input('line', mssql.Int, lineId).query<{
    source_table: string;
    epoch_id: number;
    label: string;
    schema_fingerprint: string;
    is_open: number;
  }>(
    `SELECT source_table, epoch_id, label, schema_fingerprint,
            CASE WHEN closed_utc IS NULL THEN 1 ELSE 0 END AS is_open
     FROM sms.source_epoch WHERE line_id = @line
     ORDER BY source_table, epoch_id`,
  );
  const schema: SchemaEpoch[] = [];
  for (const table of [...new Set(fp.recordset.map((r) => r.source_table))]) {
    const open = fp.recordset.find((r) => r.source_table === table && r.is_open === 1);
    schema.push(
      open
        ? { table, fingerprint: open.schema_fingerprint, status: 'enforced-by-worker', epochId: open.epoch_id, epochLabel: open.label }
        : { table, fingerprint: null, status: 'no-open-epoch', epochId: null, epochLabel: null },
    );
  }

  // DQ roll-up — ALL standing findings, not just the most recent run's.
  // Findings are batch-scoped since the Aug 2026 audit: each is recorded once,
  // when its rows are ingested, so a pass with nothing new records nothing.
  // "Latest run" would therefore usually be empty and HIDE the standing
  // faults; the full list is now the truthful standing state, bounded by real
  // faults (each row is one distinct ingest-time finding, deduplicated by
  // migration 016). TOP 200 is a display guard, not a pagination scheme.
  const bySeverity: Record<string, number> = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0 };
  const f = await pool.request().query<{
    run_id: string;
    check_name: string;
    severity: string;
    subject_table: string | null;
    detail: string | null;
    subject_ref: number | null;
  }>(
    `SELECT TOP 200 run_id, check_name, severity, subject_table, detail, subject_ref
     FROM sms.dq_finding
     ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
              finding_id DESC`,
  );
  for (const r of f.recordset) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
  const findings: OperationsData['dq']['findings'] = f.recordset.map((r) => ({
    checkName: r.check_name,
    severity: r.severity,
    subjectTable: r.subject_table,
    detail: r.detail,
    subjectRef: r.subject_ref == null ? null : Number(r.subject_ref),
  }));
  // kept for API-shape stability: the run that recorded the newest finding
  const latestRunId = f.recordset[0]?.run_id ?? null;

  // Which night-attribution rules the canonical rows were stamped under.
  // Cheap: three grouped counts over an indexed line_id, and only reported
  // when a table actually holds more than one.
  const regimes: ShiftRuleRegimes[] = [];
  for (const table of ['cone_event', 'sack_event', 'reject_event']) {
    // `rule` and `rows` are both reserved T-SQL keywords — unbracketed, this
    // query does not parse and the whole endpoint 500s.
    const rr = await pool.request().input('line', mssql.Int, lineId).query<{ rule: string | null; rows: number }>(
      `SELECT night_belongs_to AS [rule], COUNT(*) AS [rows]
         FROM sms.${table} WHERE line_id = @line
        GROUP BY night_belongs_to`,
    );
    const rules = rr.recordset.map((x) => ({ rule: x.rule, rows: Number(x.rows) }));
    if (rules.length > 1) regimes.push({ table, rules, mixed: true });
  }

  return {
    lifetime,
    shiftRuleRegimes: regimes,
    sync: sync.recordset.map((r) => ({
      targetTable: r.target_table,
      outcome: r.outcome,
      watermarkFrom: r.watermark_from == null ? null : Number(r.watermark_from),
      watermark: r.watermark_to == null ? null : Number(r.watermark_to),
      epochId: r.source_epoch == null ? null : Number(r.source_epoch),
      epochLabel: r.epoch_label,
      rowsRead: r.rows_read,
      rowsWritten: r.rows_written,
      finishedAtUtc: r.finished_at_utc ? new Date(r.finished_at_utc).toISOString() : null,
      ageSeconds: r.age_seconds,
    })),
    schema,
    source,
    dq: { latestRunId, bySeverity, findings },
  };
}

/* ------------------------------------------------- DQ finding destination (UX Phase 7 Brief 2) */

/**
 * `GET /api/dq-destination?table=<raw short name>&ref=<raw_id>` — where a
 * row-scoped DQ finding's offending row actually landed, so a screen can go
 * from "2 rows timestamped 27h behind" straight to the reading rather than
 * re-running the check by hand.
 *
 * `table` is the RAW table's short name, matching `subject_table` as the
 * per-row checks in sync-worker/src/transform/dq.ts write it for the cone,
 * sack and reject streams, and as `stationRosterFindings` writes it for
 * `station_not_in_roster` (sync-worker/src/reader/iflTables.ts:83,99,112,128
 * name the four raw tables this maps). It is checked against this literal
 * map only — never interpolated into SQL — so an unknown value is a 400, not
 * a query built from client input.
 *
 * `ref` is `raw_id`: every canonical table carries it
 * (003_cone_event.sql:48, 004_sack_event.sql:36, 008_reject_event.sql:32) as
 * the row's own lineage back to the raw layer, so the lookup is a single
 * indexed equality against the canonical table (migration 039's
 * `(line_id, raw_id)` index) — never against the raw table itself, which
 * this resolver has no reason to expose.
 *
 * Returns null when no canonical row carries that raw_id for this line —
 * either the id never existed, or it did and was rebuilt away
 * (`sms rebuild` deletes and re-transforms, so raw_id survives but the
 * canonical row it used to identify does not) — the caller (app.ts) turns
 * that into an explicit 404, never a silent absence.
 */
export const DQ_DESTINATION_TABLES = ['cone_raw', 'sack_raw', 'reject_qcs_raw', 'reject_weight_raw'] as const;
export type DqDestinationTable = (typeof DQ_DESTINATION_TABLES)[number];

export interface DqDestination {
  type: 'cone' | 'sack' | 'reject';
  id: number;
}

/** The one literal map from a raw table's short name to its canonical destination. */
const DQ_DESTINATION_MAP: Record<
  DqDestinationTable,
  { table: string; idCol: string; type: DqDestination['type']; typeFilter: string }
> = {
  cone_raw: { table: 'sms.cone_event', idCol: 'cone_event_id', type: 'cone', typeFilter: '' },
  sack_raw: { table: 'sms.sack_event', idCol: 'sack_event_id', type: 'sack', typeFilter: '' },
  reject_qcs_raw: { table: 'sms.reject_event', idCol: 'reject_event_id', type: 'reject', typeFilter: " AND reject_type = 'quality'" },
  reject_weight_raw: { table: 'sms.reject_event', idCol: 'reject_event_id', type: 'reject', typeFilter: " AND reject_type = 'weight'" },
};

export function isDqDestinationTable(v: string): v is DqDestinationTable {
  return (DQ_DESTINATION_TABLES as readonly string[]).includes(v);
}

export async function resolveDqDestination(
  pool: ConnectionPool,
  lineId: number,
  table: DqDestinationTable,
  ref: number,
): Promise<DqDestination | null> {
  const dest = DQ_DESTINATION_MAP[table];
  // `dest.table`, `dest.idCol` and `dest.typeFilter` all come from the literal
  // map above, keyed by a value already checked against DQ_DESTINATION_TABLES
  // — never from the caller's own string. `ref` and `lineId` are bound.
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('ref', mssql.BigInt, ref)
    .query<{ id: number }>(
      `SELECT ${dest.idCol} AS id FROM ${dest.table} WHERE line_id = @line AND raw_id = @ref${dest.typeFilter}`,
    );
  const row = r.recordset[0];
  return row ? { type: dest.type, id: Number(row.id) } : null;
}
