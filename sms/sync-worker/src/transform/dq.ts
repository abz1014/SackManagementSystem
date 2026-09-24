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
 *   outlier_weight          WARNING   outside the plausibility window (sms.plausibility_rule — the
 *                                     app-owned rule, read once per pass; roadmap Phase 4)
 *   no_station              WARNING   no usable station id (the source sent 0)
 *   station_not_in_roster   WARNING   a machine number that is not a station on the line — one per
 *                                     (machine, source table, generation), see stationRosterFindings
 *   source_columns_changed  WARNING   epoch.ts: the source table's FULL column list differs from the
 *                                     one recorded when the generation was accepted; non-fatal
 *   merge_key_collision     INFO      rows sharing a non-unique merge key (DQ-2)
 *   raw_read_without_write  ERROR     runner.ts: a beyond-overlap batch that wrote nothing (id reuse)
 *   transform_zero_write    CRITICAL  runTransform.ts: fresh rows the insert did not land
 *   product_mirror_failed   ERROR     pipeline.ts (state): the PDAS mirror is failing; cleared when it succeeds
 *   transform_failed        CRITICAL  pipeline.ts (state): raw arrives, canonical does not; cleared on success
 *   sack_num_reset          INFO      SackNum went backwards within a generation — one per reset, naming
 *                                     the source row id and the time (roadmap Phase 7); see sackNumResetFindings
 *   sack_blackout           WARNING   no sack row for more than SACK_BLACKOUT_HOURS while cones were being
 *                                     weighed — the sack trigger's four-tag guard makes this a real failure
 *                                     mode (roadmap Phase 7); see sackBlackoutFindings
 *   shift_rule_drift        WARNING   RT24-04 (24 Sep 2026): a sample of stored cone_event rows' shift_code/
 *                                     shift_date does not match the sms.shift_rule version in force at each
 *                                     row's OWN production time — a rebuild spanning a rule edit restamped
 *                                     old rows under a rule they never ran under; see shiftRuleDrift.ts.
 *                                     No-op (not raised) when the line has only one shift_rule version on file.
 *   isolated_production_day WARNING   RT24-09 (24 Sep 2026): a cone_event shift_date with fewer than 5 rows
 *                                     whose ±3-day neighbourhood (same source generation) has no data at all,
 *                                     or that falls outside the generation's own coverage range — e.g. a
 *                                     well-formed but misdated row sitting inside a documented "no data" gap.
 *                                     Nothing deleted, no API change; see isolatedDay.ts.
 *
 * `subject_ref` (roadmap Phase 3 item 3, 14 Sep 2026): a finding about ROWS
 * names the raw_id of the first offending one, so an operator can go from
 * "2 rows timestamped 27h behind" to the reading itself without re-running
 * the check by hand. The count stays in `count`; the ref is one row, the
 * first in ingest order, which for a clock fault is the one to look at.
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
  'source_columns_changed',
  'merge_key_collision',
  'raw_read_without_write',
  'transform_zero_write',
  'product_mirror_failed',
  'transform_failed',
  'sack_num_reset',
  'sack_blackout',
  'shift_rule_drift',
  'isolated_production_day',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/**
 * Checks that raise one finding PER SUBJECT (a machine number, say) rather than
 * one per check with a count. mergeByCheck in runTransform.ts must not fold
 * these into one row, or "once per (machine, table, generation)" becomes "once
 * per pass with every subject in the detail".
 *
 * The two sack checks (roadmap Phase 7, 15 Sep 2026) are per subject too: one
 * row per SackNum reset, one per silent gap.
 */
export const PER_SUBJECT_CHECKS: ReadonlySet<string> = new Set(['station_not_in_roster', 'sack_num_reset', 'sack_blackout']);

/**
 * The bounds outside which a weight is a scale fault, not a reading — the
 * same app-owned rule the API's weight statistics exclude by
 * (sms.plausibility_rule, Setup › Rules). Until roadmap Phase 4 (14 Sep
 * 2026) this file hard-coded 1500 g / 40 kg as the floor and had no ceiling,
 * so an admin editing the rule changed every screen and not the finding
 * that names the faulty rows. The values on file are the developer's
 * measured defaults, not yet confirmed by IFL (Q10).
 */
export interface PlausibilityBounds {
  coneLoG: number;
  coneHiG: number;
  sackLoKg: number;
  sackHiKg: number;
}

/** What the transform applied before the rule table existed; the fallback when it is empty. */
export const DEFAULT_PLAUSIBILITY: PlausibilityBounds = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

export interface Finding {
  check_name: string;
  severity: Severity;
  /** Null for a finding about the pass as a whole, not one table. */
  subject_table: string | null;
  count: number;
  detail: string;
  /** raw_id of the first offending row, when the finding concerns rows. */
  subject_ref?: number | null;
}

interface Weighted {
  production_ts_utc_ms: number;
  merge_key_is_unique?: boolean;
  source_station?: number | null;
  /** Present on transform rows; the first offender's is written as subject_ref. */
  raw_id?: number;
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
  /**
   * The plausibility window: either one bounds object applied to every row
   * (the historical behaviour — still the default, and what every existing
   * caller passes), or a resolver keyed on a row's OWN production_ts_utc_ms
   * (RT24-04, 24 Sep 2026: ruleHistory.ts's resolvePlausibilityAt). A single
   * bounds object is what a rule that has never changed collapses to; a
   * resolver is what runTransform.ts now passes so a rebuild spanning a rule
   * edit judges each reading by the window in force at ITS OWN time, not by
   * whichever version happened to be newest when the pass ran.
   */
  plausibility: PlausibilityBounds | ((productionTsUtcMs: number) => PlausibilityBounds) = DEFAULT_PLAUSIBILITY,
): Finding[] {
  const boundsAt = typeof plausibility === 'function' ? plausibility : () => plausibility;
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
  // kg for sacks, g for cones; rejects carry a cone weight when they carry one.
  // Resolved PER ROW below (RT24-04) since a resolver may return a different
  // window for different production times; windowOf(r) is also used for the
  // finding's detail sentence, which reports the window of the LAST offending
  // row seen (the newest one), naming the count as "of N sampled" only when
  // the caller passed a resolver with more than one distinct window below.
  const windowOf = (r: Weighted) => {
    const b = boundsAt(r.production_ts_utc_ms);
    return kind === 'sack' ? { lo: b.sackLoKg, hi: b.sackHiKg } : { lo: b.coneLoG, hi: b.coneHiG };
  };
  let lastOutlierWindow = windowOf(rows[0] ?? ({ production_ts_utc_ms: 0 } as Weighted));
  // The first offending row of each check, by raw_id — subject_ref (Phase 3).
  const first: Record<string, number | null> = {};
  const note = (check: string, r: Weighted) => {
    if (!(check in first)) first[check] = r.raw_id == null ? null : Number(r.raw_id);
  };

  for (const r of rows) {
    if (r.production_ts_utc_ms > nowMs) {
      future++;
      note('future_timestamp', r);
    }
    // rows arrive in source-id order, so a reading far behind the running
    // maximum is a clock fault rather than ordinary buffering jitter
    if (runningMaxMs > -Infinity && runningMaxMs - r.production_ts_utc_ms > STALE_TS_LAG_MS) {
      stale++;
      worstLagMs = Math.max(worstLagMs, runningMaxMs - r.production_ts_utc_ms);
      note('stale_timestamp', r);
    }
    if (r.production_ts_utc_ms > runningMaxMs) runningMaxMs = r.production_ts_utc_ms;
    if (r.merge_key_is_unique === false) {
      collision++;
      note('merge_key_collision', r);
    }
    // normalised to null upstream when the source sent 0 or negative; counted
    // so a run of unattributable readings is visible rather than just absent
    // from every station chart
    if ('source_station' in r && r.source_station == null) {
      noStation++;
      note('no_station', r);
    }
    const w = weightOf(r);
    if (w != null) {
      if (w <= 0) {
        nonPositive++;
        note('nonpositive_weight', r);
      } else {
        const window = windowOf(r);
        if (w < window.lo || w > window.hi) {
          outlier++;
          lastOutlierWindow = window;
          note('outlier_weight', r);
        }
      }
    }
  }

  const findings: Finding[] = [];
  const add = (check: string, sev: Severity, count: number, detail: string) => {
    if (count > 0) {
      findings.push({
        check_name: check,
        severity: sev,
        subject_table: table,
        count,
        detail,
        subject_ref: first[check] ?? null,
      });
    }
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
  add(
    'outlier_weight',
    'WARNING',
    outlier,
    `${outlier} rows outside the plausibility window ${lastOutlierWindow.lo}-${lastOutlierWindow.hi}${kind === 'sack' ? 'kg' : 'g'}` +
      ` (window of the newest offending row; a resolver may apply a different window to earlier rows — the rule on file, not yet confirmed by IFL)`,
  );
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
/**
 * The plausibility rule on file for a line, read once per pass, the same
 * way api/src/services/admin.ts getPlausibilityRule reads it for every
 * screen. Falls back to the historical constants only when the table has no
 * row for the line — a fresh install before seedReference has run.
 */
export async function loadPlausibilityRule(pool: ConnectionPool, lineId: number): Promise<PlausibilityBounds> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ cl: number; ch: number; sl: number; sh: number }>(
      `SELECT TOP 1 cone_lo_g cl, cone_hi_g ch, sack_lo_kg sl, sack_hi_kg sh
         FROM sms.plausibility_rule WHERE line_id=@line ORDER BY effective_from DESC`,
    );
  const row = r.recordset[0];
  if (!row) return DEFAULT_PLAUSIBILITY;
  return { coneLoG: Number(row.cl), coneHiG: Number(row.ch), sackLoKg: Number(row.sl), sackHiKg: Number(row.sh) };
}

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
export function stationRosterFindings<
  T extends { source_station?: number | null; source_epoch: number; raw_id?: number },
>(
  rows: T[],
  roster: StationRoster,
  rawTableShort: string,
  sourceTable: string,
): Finding[] {
  const counts = new Map<string, { machine: number; epoch: number; n: number; first: number | null }>();
  for (const r of rows) {
    const m = r.source_station;
    if (m == null || roster.stations.has(m)) continue;
    const k = `${r.source_epoch}|${m}`;
    const c =
      counts.get(k) ?? { machine: m, epoch: r.source_epoch, n: 0, first: r.raw_id == null ? null : Number(r.raw_id) };
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
      subject_ref: c.first,
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
    // subject_ref is written but NOT part of the dedupe key: the finding is
    // about a standing condition ("rows behind their neighbours"), and the
    // first row that raised it is a pointer, not a second identity.
    await pool
      .request()
      .input('run', mssql.UniqueIdentifier, runId)
      .input('check', mssql.VarChar(64), f.check_name)
      .input('sev', mssql.VarChar(10), f.severity)
      .input('tbl', mssql.VarChar(40), f.subject_table)
      .input('ref', mssql.BigInt, f.subject_ref ?? null)
      .input('detail', mssql.NVarChar(500), f.detail)
      .query(
        `INSERT INTO sms.dq_finding (run_id, check_name, severity, subject_table, subject_ref, detail)
         SELECT @run, @check, @sev, @tbl, @ref, @detail
          WHERE NOT EXISTS (
            SELECT 1 FROM sms.dq_finding
             WHERE check_name = @check
               AND ISNULL(subject_table, '') = ISNULL(@tbl, '')
               AND ISNULL(detail, '') = ISNULL(@detail, ''))`,
      );
  }
}

/* ------------------------------------------------- sack checks (roadmap Phase 7, 15 Sep 2026) */

/**
 * `sack_num_reset` — SackNum went backwards within one generation.
 *
 * WHY. SackNum is the packer's own counter and it resets (SCHEMA DQ-3: one
 * observed reset, 5,462 distinct values over a 0-9,652 range), which is why
 * no row is ever addressed by it. The gap analysis (§9) found the reset was
 * known and recorded nowhere: an engineer reconciling the plant's sack log
 * against SMS would meet two sacks with one number and no note saying the
 * counter had restarted. This names the row where it did, and the time.
 *
 * One finding PER RESET (PER_SUBJECT_CHECKS), deduped by detail: the detail
 * carries the source row id and the generation, so a retry of the same batch
 * records nothing new. INFO, because nothing is wrong with the data — the
 * counter did what counters do, and the row is ingested and addressed by its
 * own id. `subject_ref` is the raw_id of the row that went backwards.
 *
 * Rows are compared in source-id order WITHIN a generation, never across
 * two: a September id restarting at 1 after July's 5,462 is a new generation
 * (source_epoch), not a reset. The tracker is seeded from the newest
 * canonical row of each generation in the batch (loadPriorSackNums) so a
 * reset that lands on the first row of an incremental batch is still seen.
 */
export interface SackNumPrior {
  sackNum: number | null;
  sourceRowId: number;
}

/** Plant wall clock (labelled UTC) as "YYYY-MM-DD HH:MM:SS", for a detail sentence. */
const plantTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export function sackNumResetFindings<
  T extends { sack_num: number | null; source_row_id: number; source_epoch: number; production_ts_utc: Date; raw_id?: number },
>(rows: T[], prior: ReadonlyMap<number, SackNumPrior>): Finding[] {
  const ordered = [...rows].sort((a, b) => a.source_epoch - b.source_epoch || a.source_row_id - b.source_row_id);
  const last = new Map<number, SackNumPrior>(prior);
  const out: Finding[] = [];
  for (const r of ordered) {
    if (r.sack_num == null) continue;
    const prev = last.get(r.source_epoch);
    if (prev && prev.sackNum != null && r.sack_num < prev.sackNum) {
      out.push({
        check_name: 'sack_num_reset',
        severity: 'INFO',
        subject_table: 'sack_event',
        count: 1,
        detail:
          `SackNum went backwards from ${prev.sackNum} (source row id ${prev.sourceRowId}) to ${r.sack_num} ` +
          `at source row id ${r.source_row_id}, ${plantTime(r.production_ts_utc.getTime())} plant time ` +
          `(generation ${r.source_epoch}) — the packer's counter restarted; SackNum is not a key and the row is ` +
          `ingested and addressed by its own id`,
        subject_ref: r.raw_id == null ? null : Number(r.raw_id),
      });
    }
    last.set(r.source_epoch, { sackNum: r.sack_num, sourceRowId: r.source_row_id });
  }
  return out;
}

/** The newest canonical sack of each generation in a batch, for the reset tracker's seed. */
export async function loadPriorSackNums(
  pool: ConnectionPool,
  lineId: number,
  epochs: Iterable<number>,
): Promise<Map<number, SackNumPrior>> {
  const out = new Map<number, SackNumPrior>();
  for (const epoch of new Set(epochs)) {
    const r = await pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('epoch', mssql.Int, epoch)
      .query<{ sack_num: number | null; source_row_id: number }>(
        `SELECT TOP 1 sack_num, source_row_id FROM sms.sack_event
          WHERE line_id = @line AND source_epoch = @epoch
          ORDER BY source_row_id DESC`,
      );
    const row = r.recordset[0];
    if (row) out.set(epoch, { sackNum: row.sack_num == null ? null : Number(row.sack_num), sourceRowId: Number(row.source_row_id) });
  }
  return out;
}

/**
 * `sack_blackout` — no sack row for more than N hours while cones were being
 * weighed.
 *
 * WHY THIS IS A REAL FAILURE MODE. IFL's acquisition trigger writes a sack
 * row only when all four sack tags are present; if any one tag stops
 * arriving, EVERY sack row stops, while the cone tables carry on. Nothing on
 * the cone side says anything is wrong, and a line that packs no sacks for
 * hours would otherwise show only as a quiet register. The check is anchored
 * on cones, not on the clock: a silent sack table during a stoppage is not a
 * fault, a silent sack table under a running line is.
 *
 * WHAT IS COMPARED. Sack times are IFL's insert times (DQ-5) and cone times
 * are weighing times, both on the plant's wall clock; the threshold is
 * hours, so the minutes of acquisition lag between them do not matter.
 * A gap is the span between two consecutive sack rows — the newest canonical
 * sack and the batch's first, then each pair in the batch — and, when the
 * newest cone is more than N hours past the newest sack, the OPEN gap from
 * that sack to now. Only a gap with cones inside it is a finding.
 *
 * ONE FINDING PER GAP, deduped by detail, and the detail names only where the
 * gap STARTS: an open gap re-detected on every pass while it lasts produces
 * the same sentence, and the same gap seen closed when sacks resume produces
 * it again and is dropped. `count` is the cones inside the gap when it was
 * first recorded; `subject_ref` is the raw_id of the last sack before it.
 * WARNING, not ERROR: the rows that exist are right; rows are missing.
 *
 * N is SACK_BLACKOUT_HOURS (default 4), the developer's threshold. IFL has
 * not said how long the packer can legitimately stand while winding runs.
 * Anchors before 2000 are clock-fault rows (both IFL copies carry one) and
 * are skipped, or the first real sack would open a 56-year gap.
 */
export interface SackAnchor {
  ms: number;
  rawId: number | null;
  sourceRowId: number | null;
}

export interface SackGap {
  fromMs: number;
  fromRawId: number | null;
  fromSourceRowId: number | null;
  toMs: number;
  /** True when the gap ends at the newest cone rather than at a later sack. */
  open: boolean;
}

const CLOCK_FAULT_BEFORE_MS = Date.UTC(2000, 0, 1);

/** Pure: the gaps longer than the threshold in the sack sequence, the open one last. */
export function sackGaps(
  sacks: SackAnchor[],
  prior: SackAnchor | null,
  newestConeMs: number | null,
  thresholdMs: number,
): SackGap[] {
  const anchors = [...(prior ? [prior] : []), ...sacks]
    .filter((a) => a.ms >= CLOCK_FAULT_BEFORE_MS)
    .sort((a, b) => a.ms - b.ms);
  const gaps: SackGap[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (b.ms - a.ms > thresholdMs) {
      gaps.push({ fromMs: a.ms, fromRawId: a.rawId, fromSourceRowId: a.sourceRowId, toMs: b.ms, open: false });
    }
  }
  const last = anchors[anchors.length - 1];
  if (last && newestConeMs != null && newestConeMs - last.ms > thresholdMs) {
    gaps.push({ fromMs: last.ms, fromRawId: last.rawId, fromSourceRowId: last.sourceRowId, toMs: newestConeMs, open: true });
  }
  return gaps;
}

/** Pure: one WARNING per gap that had cones inside it. `conesPerGap[i]` pairs with `gaps[i]`. */
export function sackBlackoutFindings(gaps: SackGap[], conesPerGap: number[], thresholdHours: number): Finding[] {
  const out: Finding[] = [];
  gaps.forEach((g, i) => {
    const cones = conesPerGap[i] ?? 0;
    if (cones <= 0) return;
    out.push({
      check_name: 'sack_blackout',
      severity: 'WARNING',
      subject_table: 'sack_event',
      count: cones,
      detail:
        `no sack row after ${plantTime(g.fromMs)} plant time` +
        (g.fromSourceRowId != null ? ` (source row id ${g.fromSourceRowId})` : '') +
        ` for more than ${thresholdHours} h while cones were being weighed — the sack acquisition trigger needs ` +
        `all four sack tags, so one missing tag stops every sack row, not one`,
      subject_ref: g.fromRawId,
    });
  });
  return out;
}

/** Cones weighed inside each gap (after its start, up to and including its end). */
export async function countConesInGaps(pool: ConnectionPool, lineId: number, gaps: SackGap[]): Promise<number[]> {
  const out: number[] = [];
  for (const g of gaps) {
    const r = await pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('a', mssql.BigInt, g.fromMs)
      .input('b', mssql.BigInt, g.toMs)
      .query<{ n: number }>(
        `SELECT COUNT(*) n FROM sms.cone_event
          WHERE line_id = @line AND production_ts_utc_ms > @a AND production_ts_utc_ms <= @b`,
      );
    out.push(Number(r.recordset[0]?.n ?? 0));
  }
  return out;
}

/** The newest canonical sack on the line, as a gap anchor; null on an empty table. */
export async function loadNewestSack(pool: ConnectionPool, lineId: number): Promise<SackAnchor | null> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ ms: number; raw_id: number | null; source_row_id: number | null }>(
      `SELECT TOP 1 production_ts_utc_ms AS ms, raw_id, source_row_id FROM sms.sack_event
        WHERE line_id = @line ORDER BY production_ts_utc_ms DESC`,
    );
  const row = r.recordset[0];
  if (!row) return null;
  return {
    ms: Number(row.ms),
    rawId: row.raw_id == null ? null : Number(row.raw_id),
    sourceRowId: row.source_row_id == null ? null : Number(row.source_row_id),
  };
}

/** The newest cone weighing time on the line; null on an empty table. */
export async function loadNewestConeMs(pool: ConnectionPool, lineId: number): Promise<number | null> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ m: number | null }>(`SELECT MAX(production_ts_utc_ms) m FROM sms.cone_event WHERE line_id = @line`);
  return r.recordset[0]?.m == null ? null : Number(r.recordset[0].m);
}

/**
 * The whole check for one pass: the batch's sacks (may be empty — the open
 * gap is what catches a total blackout, and it needs no new sack row),
 * anchored on the newest canonical sack BEFORE this batch was persisted.
 */
export async function detectSackBlackouts<T extends { production_ts_utc_ms: number; raw_id?: number; source_row_id: number }>(
  pool: ConnectionPool,
  lineId: number,
  batch: T[],
  priorSack: SackAnchor | null,
  thresholdHours: number,
): Promise<Finding[]> {
  const newestConeMs = await loadNewestConeMs(pool, lineId);
  const sacks: SackAnchor[] = batch.map((r) => ({
    ms: r.production_ts_utc_ms,
    rawId: r.raw_id == null ? null : Number(r.raw_id),
    sourceRowId: r.source_row_id,
  }));
  const gaps = sackGaps(sacks, priorSack, newestConeMs, thresholdHours * 3_600_000);
  if (gaps.length === 0) return [];
  const cones = await countConesInGaps(pool, lineId, gaps);
  return sackBlackoutFindings(gaps, cones, thresholdHours);
}
