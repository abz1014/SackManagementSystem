/**
 * Data-quality checks over canonical rows (ARCHITECTURE §8). Pure computation
 * → summary findings (one per check with a count), so the Operations roll-up
 * isn't flooded. Raw offending rows stay queryable in canonical regardless.
 *
 * Every check the worker can raise, by name (CAPABILITIES.md carries the same
 * table for the reader):
 *
 *   future_timestamp        ERROR     production time more than an hour ahead of the plant wall clock
 *   stale_timestamp         WARNING   a reading hours behind the readings around it — a station clock fault
 *   nonpositive_weight      ERROR     weight <= 0
 *   outlier_weight          WARNING   below the plausibility floor
 *   no_station              WARNING   no usable station id (the source sent 0)
 *   station_not_in_roster   WARNING   a machine number that is not a station on the line — one per
 *                                     (machine, source table, generation), see stationRosterFindings
 *   merge_key_collision     INFO      rows sharing a non-unique merge key (DQ-2)
 *   raw_read_without_write  ERROR     runner.ts: a beyond-overlap batch that wrote nothing (id reuse)
 *   transform_zero_write    CRITICAL  runTransform.ts: fresh rows the insert did not land
 *   product_mirror_failed   ERROR     pipeline.ts (state): the PDAS mirror is failing; cleared when it succeeds
 *   transform_failed        CRITICAL  pipeline.ts (state): raw arrives, canonical does not; cleared on success
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { plantNowMs } from '@sms/shared';

export type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/** The check names above, so a screen or a test can enumerate them without a grep. */
export const CHECK_NAMES = [
  'future_timestamp',
  'stale_timestamp',
  'nonpositive_weight',
  'outlier_weight',
  'no_station',
  'station_not_in_roster',
  'merge_key_collision',
  'raw_read_without_write',
  'transform_zero_write',
  'product_mirror_failed',
  'transform_failed',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/**
 * Checks that raise one finding PER SUBJECT (a machine number, say) rather than
 * one per check with a count. mergeByCheck in runTransform.ts must not fold
 * these into one row, or "once per (machine, table, generation)" becomes "once
 * per pass with every subject in the detail".
 */
export const PER_SUBJECT_CHECKS: ReadonlySet<string> = new Set(['station_not_in_roster']);

export interface Finding {
  check_name: string;
  severity: Severity;
  /** Null for a finding about the pass as a whole, not one table. */
  subject_table: string | null;
  count: number;
  detail: string;
}

interface Weighted {
  production_ts_utc_ms: number;
  merge_key_is_unique?: boolean;
  source_station?: number | null;
}

/**
 * How far a reading may sit behind the newest one already seen, in ingest
 * order, before its clock is treated as faulty.
 *
 * Rows legitimately arrive slightly out of order — stations buffer at different
 * rates — so some backwards lag is normal. Measured over the 142,511-row copy:
 * median 1 min, p99 5 min, p99.99 33 min. Three hours is ~5.5x p99.99 and
 * catches 4 rows, the worst 27 hours early, which is what put a phantom
 * two-row production day in front of every date picker in the app.
 */
const STALE_TS_LAG_MS = 3 * 60 * 60 * 1000;

/** Clock-skew allowance for the future-timestamp check: a source clock a few
 *  minutes ahead of the plant PC is ordinary drift, not a data fault. */
const FUTURE_SKEW_MS = 60 * 60 * 1000;

export function computeFindings<T extends Weighted>(
  rows: T[],
  kind: 'cone' | 'sack' | 'reject',
  table: string,
  weightOf: (r: T) => number | null,
  /** Newest production_ts_utc_ms already in canonical for this stream. Seeds
   *  the stale-clock running maximum so a lagging row at the START of an
   *  incremental batch is still caught against history, not just against
   *  rows that happen to share its batch. -Infinity = no history (backfill). */
  initialMaxMs = -Infinity,
): Finding[] {
  // production_ts_utc_ms is the PLANT'S WALL CLOCK labelled as UTC (see
  // wallClock.ts / format.ts) — comparing it against real UTC Date.now()
  // would flag EVERY live reading as "future" on a UTC+5 plant, an error
  // that never fires in dev against weeks-old data and floods findings from
  // the first live pass. Compare wall clock against wall clock via
  // plantNowMs() (finding L2, Sep 2026 audit: this used to be its own third
  // independent copy of that formula, alongside api's plantClock.ts and
  // live.ts) — this process runs on the plant PC, so its own local wall time
  // IS the plant's.
  const nowMs = plantNowMs() + FUTURE_SKEW_MS;
  let future = 0;
  let stale = 0;
  let noStation = 0;
  let runningMaxMs = initialMaxMs;
  let worstLagMs = 0;
  let nonPositive = 0;
  let outlier = 0;
  let collision = 0;
  const outlierThreshold = kind === 'sack' ? 40 : 1500; // kg for sacks, g for cones

  for (const r of rows) {
    if (r.production_ts_utc_ms > nowMs) future++;
    // rows arrive in source-id order, so a reading far behind the running
    // maximum is a clock fault rather than ordinary buffering jitter
    if (runningMaxMs > -Infinity && runningMaxMs - r.production_ts_utc_ms > STALE_TS_LAG_MS) {
      stale++;
      worstLagMs = Math.max(worstLagMs, runningMaxMs - r.production_ts_utc_ms);
    }
    if (r.production_ts_utc_ms > runningMaxMs) runningMaxMs = r.production_ts_utc_ms;
    if (r.merge_key_is_unique === false) collision++;
    // normalised to null upstream when the source sent 0 or negative; counted
    // so a run of unattributable readings is visible rather than just absent
    // from every station chart
    if ('source_station' in r && r.source_station == null) noStation++;
    const w = weightOf(r);
    if (w != null) {
      if (w <= 0) nonPositive++;
      else if (w < outlierThreshold) outlier++;
    }
  }

  const findings: Finding[] = [];
  const add = (check: string, sev: Severity, count: number, detail: string) => {
    if (count > 0) findings.push({ check_name: check, severity: sev, subject_table: table, count, detail });
  };
  add('future_timestamp', 'ERROR', future, `${future} rows with production time in the future`);
  add(
    'stale_timestamp',
    'WARNING',
    stale,
    `${stale} rows timestamped more than ${Math.round(STALE_TS_LAG_MS / 3_600_000)}h behind the readings around them` +
      (worstLagMs > 0 ? ` (worst ${Math.round(worstLagMs / 3_600_000)}h)` : '') +
      ' — a station clock fault, not a production gap',
  );
  add('nonpositive_weight', 'ERROR', nonPositive, `${nonPositive} rows with weight <= 0`);
  add('outlier_weight', 'WARNING', outlier, `${outlier} rows below ${outlierThreshold}${kind === 'sack' ? 'kg' : 'g'}`);
  add(
    'no_station',
    'WARNING',
    noStation,
    `${noStation} rows carry no usable station id — they cannot appear in any station-wise view`,
  );
  add('merge_key_collision', 'INFO', collision, `${collision} rows share a non-unique merge key (DQ-2)`);
  return findings;
}

/** What the roster check needs: the line, and the station ids it knows. */
export interface StationRoster {
  lineId: number;
  stations: ReadonlySet<number>;
}

/**
 * `station_not_in_roster` — a reading from a machine number the line has no
 * station for (roadmap Phase 1, 14 Sep 2026).
 *
 * WHY. Machines are configuration now (sms.machine, Setup › Machines) and a
 * station row follows a numbered winder (seedReference.ts). A row from a
 * number with no station is therefore one of two things: a machine IFL added
 * that nobody has added in Setup yet, or a source table that belongs to a
 * different line than LINE_ID says (the cross-contamination transform.ts
 * warns about). Either way the reading is kept — nothing is dropped — but no
 * station-wise screen can show it, and the finding says which number, in
 * which table, under which generation, so the fix is one Setup action.
 *
 * ONE FINDING PER (machine number, source table, generation), not one per
 * pass: persistFindings dedups on (check, subject_table, detail), and every
 * one of those three facts is in the detail, so a standing fault is recorded
 * once when its rows are first ingested and the count is the batch that raised
 * it. `no_station` (a null id, the source sent 0) is a different fault and
 * stays a separate check.
 *
 * `subject_table` is the RAW table's short name ('cone_raw'), by contract: the
 * finding is about what the source sent, not about the canonical row.
 */
export function stationRosterFindings<T extends { source_station?: number | null; source_epoch: number }>(
  rows: T[],
  roster: StationRoster,
  rawTableShort: string,
  sourceTable: string,
): Finding[] {
  const counts = new Map<string, { machine: number; epoch: number; n: number }>();
  for (const r of rows) {
    const m = r.source_station;
    if (m == null || roster.stations.has(m)) continue;
    const k = `${r.source_epoch}|${m}`;
    const c = counts.get(k) ?? { machine: m, epoch: r.source_epoch, n: 0 };
    c.n += 1;
    counts.set(k, c);
  }
  return [...counts.values()]
    .sort((a, b) => a.epoch - b.epoch || a.machine - b.machine)
    .map((c) => ({
      check_name: 'station_not_in_roster',
      severity: 'WARNING' as const,
      subject_table: rawTableShort,
      count: c.n,
      detail:
        `machine number ${c.machine} observed in ${sourceTable} (generation ${c.epoch}) is not a ` +
        `station on line ${roster.lineId} — add it in Setup › Machines`,
    }));
}

/**
 * Remove every standing finding of one check. For the worker's own STATE
 * findings only — `product_mirror_failed`, `transform_failed` — which describe
 * a condition that is either present or not, and must disappear when it
 * clears. Ingest-time DATA findings (a future timestamp, an impossible weight)
 * are facts about rows and are never cleared by this.
 */
export async function clearFindings(pool: ConnectionPool, checkName: string): Promise<void> {
  await pool
    .request()
    .input('check', mssql.VarChar(64), checkName)
    .query(`DELETE FROM sms.dq_finding WHERE check_name = @check`);
}

export async function persistFindings(
  pool: ConnectionPool,
  runId: string,
  findings: Finding[],
): Promise<void> {
  for (const f of findings) {
    // Deduplicated on (check, table, detail). A finding that halts a pass is
    // raised again on every retry — every 60 s — and a bare INSERT would grow
    // the table by thousands of identical rows a day (4 tables x 1,440 passes).
    // Migration 016 cleaned that up once; this stops it recurring. The
    // standing state is what the Operations screen shows, not a tally.
    await pool
      .request()
      .input('run', mssql.UniqueIdentifier, runId)
      .input('check', mssql.VarChar(64), f.check_name)
      .input('sev', mssql.VarChar(10), f.severity)
      .input('tbl', mssql.VarChar(40), f.subject_table)
      .input('detail', mssql.NVarChar(500), f.detail)
      .query(
        `INSERT INTO sms.dq_finding (run_id, check_name, severity, subject_table, detail)
         SELECT @run, @check, @sev, @tbl, @detail
          WHERE NOT EXISTS (
            SELECT 1 FROM sms.dq_finding
             WHERE check_name = @check
               AND ISNULL(subject_table, '') = ISNULL(@tbl, '')
               AND ISNULL(detail, '') = ISNULL(@detail, ''))`,
      );
  }
}
