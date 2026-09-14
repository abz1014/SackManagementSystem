/**
 * Live line state — the one endpoint the floor screens ("Now", the sack and
 * cone lists' "this shift" scope) and the wall display poll.
 *
 * Built after IFL's first reaction to the app (2 Sep 2026): nothing on screen
 * was live, and the day view opened on yesterday. This endpoint answers the
 * questions a person standing at the line actually has — is it running, what
 * shift is it, how many so far, what was the last sack — from the plant's own
 * clock, and is cheap enough to poll every ten seconds.
 *
 * CLOCK. production_ts_utc is the PLANT'S WALL CLOCK labelled as UTC (see
 * sync-worker dq.ts and web format.ts). "Now" must be expressed the same way
 * or every comparison is five hours out on this UTC+5 plant. plantNowMs(),
 * imported from plantClock.ts — the ONE place this conversion is defined
 * (finding L2, Sep 2026 audit: this file used to carry its own second,
 * independent copy of the identical formula) — assumes this process runs on
 * the plant PC, so its local wall time IS the plant's. An `asOf` override
 * exists so a past moment can be replayed — gated by config, because a wall
 * display left on a replay URL would present old numbers as live.
 *
 * RUNNING / STOPPED uses the same 120 s inter-cone split as downtime.ts:
 * normal gaps have p99 ≈ 31 s and real stops start at 180 s+, so there is no
 * ambiguous middle. "Idle" (a full shift with nothing) is separated from
 * "stopped" so that the dev copy, which ends on 10 Jul 2026, reads as "no
 * readings since …" rather than as a 54-day stoppage.
 *
 * THE ACQUISITION LAG IS THE WHOLE DIFFICULTY, and it is invisible on the
 * supplied copy. IFL's acquisition layer writes a cone's row about 18 minutes
 * after the cone was weighed (measured across 142,509 real rows: 909 s
 * minimum, 1090 s mean). So the newest production timestamp this software can
 * possibly see is a quarter of an hour old even while the line runs flat out.
 *
 * Comparing that timestamp against the wall clock — which is what this file
 * did until the 2 Sep 2026 live rehearsal — therefore reports STOPPED, always,
 * on a perfectly healthy line. It never showed up in development because the
 * only data available was weeks old and everything read "no readings" anyway.
 *
 * The fix is to judge the line against the most recent moment data COULD exist
 * for, `now - lag`, rather than against `now`. The lag is measured from the
 * data itself: `src_Date - src_ProductionDate` over recent raw rows, which is
 * IFL's own insert time against their own production time. Every "recent"
 * window is likewise anchored on the newest reading rather than on the wall
 * clock, because "cones in the last ten minutes" is otherwise guaranteed zero.
 *
 * Every range predicate is on production_ts_utc_ms, which leads the unique
 * merge index on all three event tables (line_id, production_ts_utc_ms, …),
 * so each of these queries is an index seek over one shift, not a scan.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { SHIFT_BOUNDARIES, shiftCodeFromMinutes, type NightBelongsTo, type ShiftCode } from '@sms/shared';
import { plantNowMs } from './plantClock.js';

export const STOP_THRESHOLD_SECONDS = 120;
export const IDLE_THRESHOLD_SECONDS = 8 * 3600;
/** How many recent rows the acquisition lag is measured over. */
export const LAG_SAMPLE_ROWS = 200;
/** A sane ceiling. A lag beyond this is a clock fault, not an ingestion delay,
 *  and must not be allowed to mask a genuinely stopped line indefinitely. */
export const MAX_CREDIBLE_LAG_SECONDS = 2 * 3600;
/**
 * How large a lag may be and still be REPORTED.
 *
 * These are two different ceilings, and conflating them hid a whole state.
 * MAX_CREDIBLE is the point past which a lag stops being usable for judging
 * whether the line is running. Filtering the SAMPLE at that value before
 * taking the median, which this file used to do, also meant the measured lag
 * came back null in exactly the case the screens need to warn about — so
 * "readings are arriving two hours late" could never be said, and the state
 * meant to catch it was unreachable. The lag is now measured up to a day and
 * reported as measured; only the LINE STATE gets the credible cap.
 */
export const MAX_REPORTABLE_LAG_SECONDS = 24 * 3600;

/** Never call the pipeline stale sooner than this, however fast it runs. */
export const MIN_STALE_AFTER_SECONDS = 90;
/** Missed passes before the pipeline counts as stale. */
export const STALE_CADENCE_MULTIPLE = 3;
/** Used until two successful passes exist to measure a cadence from. */
export const DEFAULT_STALE_AFTER_SECONDS = 180;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SHIFT_MS = 8 * HOUR_MS;

export interface ShiftWindow {
  code: ShiftCode;
  /** Production day the shift is counted against (shift_date). */
  shiftDate: string;
  startMs: number;
  endMs: number;
}

/**
 * The shift in progress at plant time `tMs`, with its bounds and shift_date.
 * Pure. Boundaries are the confirmed 06/14/22 (Q8); shift_date follows the
 * same night rule the transform stamps on every row, so "this shift" and
 * "today" on the floor screens agree with the Records they open into.
 */
export function shiftWindowAt(tMs: number, rule: NightBelongsTo): ShiftWindow {
  const d = new Date(tMs);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const code = shiftCodeFromMinutes(mins);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let startMs: number;
  if (code === 'morning') startMs = midnight + SHIFT_BOUNDARIES.morningStart * 60_000;
  else if (code === 'evening') startMs = midnight + SHIFT_BOUNDARIES.eveningStart * 60_000;
  else if (mins >= SHIFT_BOUNDARIES.nightStart) startMs = midnight + SHIFT_BOUNDARIES.nightStart * 60_000;
  else startMs = midnight - DAY_MS + SHIFT_BOUNDARIES.nightStart * 60_000;
  // Under start_day a 02:00 night reading belongs to the day the shift began,
  // which is the date of startMs; morning and evening start on t's own date,
  // so the same expression is right for all three codes.
  const dateAnchor = rule === 'start_day' ? startMs : tMs;
  return {
    code,
    shiftDate: new Date(dateAnchor).toISOString().slice(0, 10),
    startMs,
    endMs: startMs + SHIFT_MS,
  };
}

export type LineStatus = 'running' | 'stopped' | 'idle' | 'no_data';

/**
 * Whether the numbers on screen can be trusted right now.
 *
 * Deliberately separate from the LINE state. If the sync worker stops, the
 * newest reading keeps ageing while nothing arrives, and within two minutes
 * the line-state arithmetic reports "Stopped 3 min" about a line running flat
 * out. An amber dot in the corner does not undo a wrong headline, so when this
 * is anything but 'ok' no screen may assert running or stopped.
 */
export type LiveHealthKind = 'ok' | 'stale' | 'late' | 'no_data';

export interface SyncHealth {
  /**
   * Seconds since the OLDEST of the source tables last synced successfully.
   *
   * The oldest, not the newest: the response envelope's freshness uses
   * MAX(finished_at_utc) across all four tables, so a dead cone feed hides
   * behind three healthy ones and the app reports itself current while the
   * only table any screen reads is frozen.
   */
  ageSeconds: number | null;
  /** The table furthest behind, so Setup can name it. */
  oldestTable: string | null;
  /** The MEASURED gap between successful passes. Null until two exist. */
  cadenceSeconds: number | null;
  /** Age beyond which the pipeline counts as stale. Derived, not assumed. */
  staleAfterSeconds: number;
}

export interface LiveHealth extends SyncHealth {
  kind: LiveHealthKind;
  /** The lag past which the line state is no longer asserted. */
  lagCeilingSeconds: number;
}

/**
 * Sync freshness, measured rather than assumed.
 *
 * The cadence comes from the gaps between recent successful passes instead of
 * a hardcoded sixty seconds, so changing the worker's schedule cannot silently
 * turn every screen's freshness warning into a false alarm.
 */
export async function getSyncHealth(pool: ConnectionPool, lineId: number): Promise<SyncHealth> {
  const [oldest, gaps] = await Promise.all([
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .query<{ target_table: string; ageSeconds: number | null }>(`
        WITH last_ok AS (
          SELECT target_table, MAX(finished_at_utc) AS finished
            FROM sms.sync_run
           WHERE line_id = @line AND outcome = 'success'
           GROUP BY target_table
        )
        SELECT TOP 1 target_table, DATEDIFF(SECOND, finished, SYSUTCDATETIME()) AS ageSeconds
          FROM last_ok ORDER BY finished ASC`),
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .query<{ gapSeconds: number | null }>(`
        WITH passes AS (
          SELECT run_id, MAX(finished_at_utc) AS finished
            FROM sms.sync_run
           WHERE line_id = @line AND outcome = 'success'
           GROUP BY run_id
        ),
        recent AS (
          SELECT TOP 20 finished, LAG(finished) OVER (ORDER BY finished) AS prev
            FROM passes ORDER BY finished DESC
        )
        SELECT DATEDIFF(SECOND, prev, finished) AS gapSeconds FROM recent WHERE prev IS NOT NULL`),
  ]);

  const row = oldest.recordset[0];
  const sample = gaps.recordset
    .map((g) => Number(g.gapSeconds))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const cadenceSeconds = sample.length ? sample[Math.floor(sample.length / 2)]! : null;

  return {
    ageSeconds: row?.ageSeconds == null ? null : Number(row.ageSeconds),
    oldestTable: row?.target_table ?? null,
    cadenceSeconds,
    staleAfterSeconds:
      cadenceSeconds == null
        ? DEFAULT_STALE_AFTER_SECONDS
        : Math.max(MIN_STALE_AFTER_SECONDS, Math.round(cadenceSeconds * STALE_CADENCE_MULTIPLE)),
  };
}

/** Pure: which of the four states the pipeline is in. */
export function classifyHealth(
  dataAsOfMs: number | null,
  sync: SyncHealth,
  ingestLagSeconds: number | null,
  replay: boolean,
): LiveHealthKind {
  // A replay is pinned to a past instant on purpose and is bannered
  // separately; sync freshness says nothing about it.
  if (replay) return dataAsOfMs == null ? 'no_data' : 'ok';
  if (dataAsOfMs == null) return 'no_data';
  if (sync.ageSeconds == null || sync.ageSeconds > sync.staleAfterSeconds) return 'stale';
  if (ingestLagSeconds != null && ingestLagSeconds > MAX_CREDIBLE_LAG_SECONDS) return 'late';
  return 'ok';
}

export interface LineState {
  status: LineStatus;
  /** Wall-clock age of the newest reading — a cone, or a reject if one is
   *  more recent (finding M4: a span producing only rejects must not read as
   *  full downtime). What a person sees on a clock. */
  sinceLastReadingSeconds: number | null;
  /** How far the newest reading falls short of where it should be given the
   *  lag. This, not the wall-clock age, is how long the line has been down. */
  behindSeconds: number | null;
}

/**
 * Line state, judged against the most recent moment data could exist for.
 *
 * `lagMs` is how long IFL's acquisition layer takes to write a row. A running
 * line's newest reading sits almost exactly `lag` behind the wall clock, so
 * that is the baseline; anything further behind is the line, not the pipeline.
 * Pure.
 */
export function classifyLineState(lastReadingMs: number | null, nowMs: number, lagMs = 0): LineState {
  if (lastReadingMs == null) return { status: 'no_data', sinceLastReadingSeconds: null, behindSeconds: null };
  const lag = Math.min(Math.max(0, lagMs), MAX_CREDIBLE_LAG_SECONDS * 1000);
  const sinceLastReadingSeconds = Math.max(0, Math.round((nowMs - lastReadingMs) / 1000));
  const behindSeconds = Math.max(0, Math.round((nowMs - lag - lastReadingMs) / 1000));
  if (behindSeconds <= STOP_THRESHOLD_SECONDS) return { status: 'running', sinceLastReadingSeconds, behindSeconds };
  if (behindSeconds <= IDLE_THRESHOLD_SECONDS) return { status: 'stopped', sinceLastReadingSeconds, behindSeconds };
  return { status: 'idle', sinceLastReadingSeconds, behindSeconds };
}

export interface LiveLine {
  lineId: number;
  lineName: string;
  /** Plant wall clock at generation, in the production_ts convention. */
  plantNowUtc: string;
  /** True when the clock was moved by an `asOf` override — never live. */
  replay: boolean;
  shift: {
    code: ShiftCode;
    shiftDate: string;
    startUtc: string;
    endUtc: string;
    elapsedSeconds: number;
    remainingSeconds: number;
  };
  /**
   * The newest production time any reading carries, and how far behind the
   * wall clock the plant's own acquisition runs. Everything time-relative on
   * the live screens is anchored here rather than on the clock.
   */
  dataAsOfUtc: string | null;
  ingestLagSeconds: number | null;
  /** Whether the figures below can be trusted, and why not when they cannot. */
  health: LiveHealth;
  state: {
    status: LineStatus;
    /** Seconds since the newest cone reading, on the wall clock. */
    sinceLastReadingSeconds: number | null;
    /** How long the line has actually been down, net of the acquisition lag. */
    behindSeconds: number | null;
    /** Start of the current uninterrupted run when running; else null. */
    runStartUtc: string | null;
    stopThresholdSeconds: number;
  };
  thisShift: {
    cones: number;
    conesInRange: number;
    conesInRangePct: number | null;
    rejectedCones: number;
    sacks: number;
    sackWeightKg: number;
    conesPerHour: number | null;
  };
  /** Counted backwards from `dataAsOfUtc`, not from the wall clock: with an
   *  18-minute acquisition lag, "the last ten minutes" is always empty. */
  recent: {
    conesLast10Min: number;
    conesLastHour: number;
    sacksLastHour: number;
  };
  /** `eventId` is the canonical PK — what the register's permalink takes.
   *  `sourceRowId` is IFL's own id, kept for display: since the 2026-08-05
   *  source rebuild it names two rows (register.ts, IDENTITY). */
  lastSack: {
    ts: string;
    eventId: number;
    sourceRowId: number;
    sackNum: number | null;
    weightKg: number | null;
    inRange: boolean | null;
  } | null;
  lastCone: {
    ts: string;
    eventId: number;
    sourceRowId: number;
    station: number | null;
    weightG: number | null;
    inRange: boolean | null;
  } | null;
  lastReject: { ts: string; rejectType: string; station: number | null } | null;
  /** Cones this shift per winding station, plus when each last produced. */
  stations: { station: number; cones: number; lastTs: string }[];
}

export interface LiveData {
  lines: LiveLine[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : new Date(d).toISOString());

export async function getLive(
  pool: ConnectionPool,
  lineId: number,
  lineName: string,
  opts: { asOfMs?: number } = {},
): Promise<LiveData> {
  const replay = opts.asOfMs != null;
  const nowMs = opts.asOfMs ?? plantNowMs();

  const ruleRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ night_belongs_to: string | null }>(
      `SELECT TOP 1 night_belongs_to FROM sms.shift_rule WHERE line_id = @line ORDER BY effective_from DESC`,
    );
  const rule: NightBelongsTo =
    ruleRes.recordset[0]?.night_belongs_to === 'calendar_day' ? 'calendar_day' : 'start_day';
  const shift = shiftWindowAt(nowMs, rule);

  /**
   * Measure IFL's acquisition lag from their own two timestamps, over the most
   * recent rows. This reads the RAW layer rather than canonical because the
   * source insert time is deliberately not carried into canonical — the raw
   * layer exists to preserve exactly this kind of source fact. It is the app's
   * own database either way; nothing here touches IFL's.
   *
   * Median, not mean: a single clock-fault row in the sample would otherwise
   * drag the lag by hours and hide a genuinely stopped line.
   *
   * ORDER BY raw_id, NOT src_id. `src_id` is IFL's counter, and IFL restarts it:
   * they dropped and recreated the four wide tables on 2026-08-05 and every
   * identity went back to 1. Ordering by it means "newest" is whichever
   * GENERATION happens to hold the biggest numbers, not the newest reading —
   * so once a second generation lands, this samples the OLDER one until the new
   * one out-counts it (~68 days at 3,000 cones/day against our 204,076). The
   * whole acquisition-lag and line-state machinery would then run on stale rows
   * with no visible symptom. `raw_id` is OUR identity column: monotone by
   * ingest, never reused, never reset.
   */
  const lagRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('take', mssql.Int, LAG_SAMPLE_ROWS)
    .query<{ lagSeconds: number }>(`
      SELECT TOP (@take) DATEDIFF(SECOND, src_ProductionDate, src_Date) AS lagSeconds
        FROM sms_raw.cone_raw
       WHERE line_id = @line AND src_Date IS NOT NULL AND src_ProductionDate IS NOT NULL
       ORDER BY raw_id DESC`);
  const lagSamples = lagRes.recordset
    .map((r) => Number(r.lagSeconds))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= MAX_REPORTABLE_LAG_SECONDS)
    .sort((a, b) => a - b);
  const ingestLagSeconds = lagSamples.length ? lagSamples[Math.floor(lagSamples.length / 2)]! : null;
  // Reported as measured; capped only where it is USED to judge the line.
  const lagMs = Math.min(ingestLagSeconds ?? 0, MAX_CREDIBLE_LAG_SECONDS) * 1000;

  // One lower bound serves both the shift totals and the rolling hour: the
  // hour can begin before the shift did (twenty minutes into a shift, "last
  // hour" reaches back into the previous one), so the scan starts at the
  // earlier of the two and CASE picks each window out of the same rows.
  // The newest production time on record. Every "recent" window is measured
  // back from here, because a window measured back from the wall clock lands
  // entirely inside the acquisition lag and is always empty.
  // Cones AND rejects, because this is "the newest production time on
  // record" and a reject is a reading. Cone-only left the line able to
  // report `running` (which counts rejects since finding M4) beside a frozen
  // `dataAsOfUtc` and empty recent windows — a self-contradictory answer
  // during exactly the span M4 exists to describe: inspection rejecting
  // everything, no good cones.
  const tipRes = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('now', mssql.BigInt, nowMs)
    .query<{ tip: number | null }>(
      `SELECT MAX(tip) AS tip FROM (
         SELECT MAX(production_ts_utc_ms) AS tip FROM sms.cone_event
          WHERE line_id = @line AND production_ts_utc_ms <= @now
         UNION ALL
         SELECT MAX(production_ts_utc_ms) FROM sms.reject_event
          WHERE line_id = @line AND production_ts_utc_ms <= @now
       ) t`,
    );
  const dataAsOfMs = tipRes.recordset[0]?.tip != null ? Number(tipRes.recordset[0].tip) : null;
  const anchorMs = dataAsOfMs ?? nowMs;

  const hourAgoMs = anchorMs - HOUR_MS;
  const tenMinAgoMs = anchorMs - 10 * 60_000;
  const lo = Math.min(shift.startMs, hourAgoMs);

  const bind = (req: mssql.Request) =>
    req
      .input('line', mssql.Int, lineId)
      .input('lo', mssql.BigInt, lo)
      .input('now', mssql.BigInt, nowMs)
      .input('shiftStart', mssql.BigInt, shift.startMs)
      .input('hourAgo', mssql.BigInt, hourAgoMs)
      .input('tenAgo', mssql.BigInt, tenMinAgoMs);

  const [cones, sacks, rejects, lastCone, lastSack, lastReject, stations] = await Promise.all([
    bind(pool.request()).query<{ cones: number; inRange: number; last10: number; lastHour: number }>(`
      SELECT
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart THEN 1 ELSE 0 END) AS cones,
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart AND in_range = 1 THEN 1 ELSE 0 END) AS inRange,
        SUM(CASE WHEN production_ts_utc_ms >= @tenAgo THEN 1 ELSE 0 END) AS last10,
        SUM(CASE WHEN production_ts_utc_ms >= @hourAgo THEN 1 ELSE 0 END) AS lastHour
      FROM sms.cone_event
      WHERE line_id = @line AND production_ts_utc_ms >= @lo AND production_ts_utc_ms <= @now`),
    bind(pool.request()).query<{ sacks: number; kg: number; lastHour: number }>(`
      SELECT
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart THEN 1 ELSE 0 END) AS sacks,
        SUM(CASE WHEN production_ts_utc_ms >= @shiftStart THEN weight_kg ELSE 0 END) AS kg,
        SUM(CASE WHEN production_ts_utc_ms >= @hourAgo THEN 1 ELSE 0 END) AS lastHour
      FROM sms.sack_event
      WHERE line_id = @line AND production_ts_utc_ms >= @lo AND production_ts_utc_ms <= @now`),
    bind(pool.request()).query<{ n: number }>(`
      SELECT COUNT(*) AS n FROM sms.reject_event
      WHERE line_id = @line AND production_ts_utc_ms >= @shiftStart AND production_ts_utc_ms <= @now`),
    bind(pool.request()).query<{
      ts: Date; event_id: number; source_row_id: number; source_station: number | null; weight_g: number | null; in_range: boolean | null;
    }>(`
      SELECT TOP 1 production_ts_utc AS ts, cone_event_id AS event_id, source_row_id, source_station, weight_g, in_range
      FROM sms.cone_event WHERE line_id = @line AND production_ts_utc_ms <= @now
      ORDER BY production_ts_utc_ms DESC`),
    bind(pool.request()).query<{
      ts: Date; event_id: number; source_row_id: number; sack_num: number | null; weight_kg: number | null; in_range: boolean | null;
    }>(`
      SELECT TOP 1 production_ts_utc AS ts, sack_event_id AS event_id, source_row_id, sack_num, weight_kg, in_range
      FROM sms.sack_event WHERE line_id = @line AND production_ts_utc_ms <= @now
      ORDER BY production_ts_utc_ms DESC`),
    bind(pool.request()).query<{ ts: Date; reject_type: string; source_station: number | null }>(`
      SELECT TOP 1 production_ts_utc AS ts, reject_type, source_station
      FROM sms.reject_event WHERE line_id = @line AND production_ts_utc_ms <= @now
      ORDER BY production_ts_utc_ms DESC`),
    bind(pool.request()).query<{ station: number; cones: number; lastTs: Date }>(`
      SELECT source_station AS station, COUNT(*) AS cones, MAX(production_ts_utc) AS lastTs
      FROM sms.cone_event
      WHERE line_id = @line AND production_ts_utc_ms >= @shiftStart AND production_ts_utc_ms <= @now
        AND source_station IS NOT NULL AND source_station > 0
      GROUP BY source_station ORDER BY source_station`),
  ]);

  const sync = await getSyncHealth(pool, lineId);
  const lastConeRow = lastCone.recordset[0] ?? null;
  const lastReadingMs = lastConeRow ? new Date(lastConeRow.ts).getTime() : null;
  // Finding M4 (Sep 2026 audit): judging running/stopped on cones alone reads
  // a span producing only rejects — inspection stations active, no good
  // cones — as full downtime. classifyLineState only cares that it is given
  // the newest RELEVANT reading, not what kind it is, so the newest of
  // either stream is what "the line is producing something" actually means.
  const lastRejectRowForState = lastReject.recordset[0] ?? null;
  const lastRejectMs = lastRejectRowForState ? new Date(lastRejectRowForState.ts).getTime() : null;
  const lastActivityMs =
    lastReadingMs == null ? lastRejectMs : lastRejectMs == null ? lastReadingMs : Math.max(lastReadingMs, lastRejectMs);
  const state = classifyLineState(lastActivityMs, nowMs, lagMs);

  // Start of the current run: the newest reading that followed a gap longer
  // than the stop threshold (or the first in the 24 h window). Only
  // meaningful while running; a stopped line has no current run.
  //
  // Over cones AND rejects, matching what `status` is judged on. Cone-only
  // returned null — "running since never" — for a run carried by rejects
  // alone, and would have measured a gap as a break in the run when the line
  // was in fact producing rejects throughout it.
  let runStartUtc: string | null = null;
  if (state.status === 'running') {
    const r = await pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('lo', mssql.BigInt, nowMs - DAY_MS)
      .input('now', mssql.BigInt, nowMs)
      .input('gapMs', mssql.BigInt, STOP_THRESHOLD_SECONDS * 1000)
      .query<{ runStart: Date | null }>(`
        WITH a AS (
          SELECT production_ts_utc AS ts, production_ts_utc_ms AS ms
            FROM sms.cone_event
           WHERE line_id = @line AND production_ts_utc_ms > @lo AND production_ts_utc_ms <= @now
          UNION ALL
          SELECT production_ts_utc, production_ts_utc_ms
            FROM sms.reject_event
           WHERE line_id = @line AND production_ts_utc_ms > @lo AND production_ts_utc_ms <= @now
        ),
        c AS (
          SELECT ts, ms, LAG(ms) OVER (ORDER BY ms) AS prev_ms FROM a
        )
        SELECT MAX(ts) AS runStart FROM c WHERE prev_ms IS NULL OR ms - prev_ms > @gapMs`);
    runStartUtc = iso(r.recordset[0]?.runStart ?? null);
  }

  const c = cones.recordset[0];
  const s = sacks.recordset[0];
  const shiftCones = num(c?.cones);
  const elapsedSeconds = Math.max(0, Math.round((nowMs - shift.startMs) / 1000));
  // The rate divides by the time the counts actually COVER, which ends at the
  // data tip, not now. Dividing by wall-clock elapsed understates a running
  // line by roughly the acquisition lag every time.
  const coveredSeconds = Math.max(1, Math.round((Math.min(anchorMs, nowMs) - shift.startMs) / 1000));
  const lastSackRow = lastSack.recordset[0] ?? null;
  const lastRejectRow = lastReject.recordset[0] ?? null;

  const line: LiveLine = {
    lineId,
    lineName,
    plantNowUtc: new Date(nowMs).toISOString(),
    replay,
    shift: {
      code: shift.code,
      shiftDate: shift.shiftDate,
      startUtc: new Date(shift.startMs).toISOString(),
      endUtc: new Date(shift.endMs).toISOString(),
      elapsedSeconds,
      remainingSeconds: Math.max(0, Math.round((shift.endMs - nowMs) / 1000)),
    },
    dataAsOfUtc: dataAsOfMs != null ? new Date(dataAsOfMs).toISOString() : null,
    ingestLagSeconds,
    health: {
      ...sync,
      kind: classifyHealth(dataAsOfMs, sync, ingestLagSeconds, replay),
      lagCeilingSeconds: MAX_CREDIBLE_LAG_SECONDS,
    },
    state: {
      status: state.status,
      sinceLastReadingSeconds: state.sinceLastReadingSeconds,
      behindSeconds: state.behindSeconds,
      runStartUtc,
      stopThresholdSeconds: STOP_THRESHOLD_SECONDS,
    },
    thisShift: {
      cones: shiftCones,
      conesInRange: num(c?.inRange),
      conesInRangePct: shiftCones > 0 ? Math.round((1000 * num(c?.inRange)) / shiftCones) / 10 : null,
      rejectedCones: num(rejects.recordset[0]?.n),
      sacks: num(s?.sacks),
      sackWeightKg: Math.round(num(s?.kg) * 100) / 100,
      conesPerHour: coveredSeconds >= 600 ? Math.round((shiftCones * 3600) / coveredSeconds) : null,
    },
    recent: {
      conesLast10Min: num(c?.last10),
      conesLastHour: num(c?.lastHour),
      sacksLastHour: num(s?.lastHour),
    },
    lastSack: lastSackRow
      ? {
          ts: iso(lastSackRow.ts)!,
          eventId: Number(lastSackRow.event_id),
          sourceRowId: Number(lastSackRow.source_row_id),
          sackNum: lastSackRow.sack_num,
          weightKg: lastSackRow.weight_kg == null ? null : Number(lastSackRow.weight_kg),
          inRange: lastSackRow.in_range,
        }
      : null,
    lastCone: lastConeRow
      ? {
          ts: iso(lastConeRow.ts)!,
          eventId: Number(lastConeRow.event_id),
          sourceRowId: Number(lastConeRow.source_row_id),
          station: lastConeRow.source_station,
          weightG: lastConeRow.weight_g == null ? null : Number(lastConeRow.weight_g),
          inRange: lastConeRow.in_range,
        }
      : null,
    lastReject: lastRejectRow
      ? { ts: iso(lastRejectRow.ts)!, rejectType: lastRejectRow.reject_type, station: lastRejectRow.source_station }
      : null,
    stations: stations.recordset.map((r) => ({
      station: Number(r.station),
      cones: num(r.cones),
      lastTs: iso(r.lastTs)!,
    })),
  };

  return { lines: [line] };
}
