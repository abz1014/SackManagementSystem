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
 * or every comparison is five hours out on this UTC+5 plant. plantNowMs()
 * mirrors dq.ts: this process runs on the plant PC, so its local wall time IS
 * the plant's. An `asOf` override exists so a past moment can be replayed —
 * gated by config, because a wall display left on a replay URL would present
 * old numbers as live.
 *
 * RUNNING / STOPPED uses the same 120 s inter-cone split as downtime.ts:
 * normal gaps have p99 ≈ 31 s and real stops start at 180 s+, so there is no
 * ambiguous middle. "Idle" (a full shift with nothing) is separated from
 * "stopped" so that the dev copy, which ends on 10 Jul 2026, reads as "no
 * readings since …" rather than as a 54-day stoppage.
 *
 * Every range predicate is on production_ts_utc_ms, which leads the unique
 * merge index on all three event tables (line_id, production_ts_utc_ms, …),
 * so each of these queries is an index seek over one shift, not a scan.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { SHIFT_BOUNDARIES, shiftCodeFromMinutes, type NightBelongsTo, type ShiftCode } from '@sms/shared';

export const STOP_THRESHOLD_SECONDS = 120;
export const IDLE_THRESHOLD_SECONDS = 8 * 3600;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SHIFT_MS = 8 * HOUR_MS;

/** The plant's wall clock, encoded the way production_ts_utc_ms is. */
export function plantNowMs(): number {
  return Date.now() - new Date().getTimezoneOffset() * 60_000;
}

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

/** Line state from the age of the newest cone reading. Pure. */
export function classifyLineState(
  lastConeMs: number | null,
  nowMs: number,
): { status: LineStatus; seconds: number | null } {
  if (lastConeMs == null) return { status: 'no_data', seconds: null };
  const seconds = Math.max(0, Math.round((nowMs - lastConeMs) / 1000));
  if (seconds <= STOP_THRESHOLD_SECONDS) return { status: 'running', seconds };
  if (seconds <= IDLE_THRESHOLD_SECONDS) return { status: 'stopped', seconds };
  return { status: 'idle', seconds };
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
  state: {
    status: LineStatus;
    /** Seconds since the newest cone reading. */
    sinceLastConeSeconds: number | null;
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
  recent: {
    conesLast10Min: number;
    conesLastHour: number;
    sacksLastHour: number;
  };
  lastSack: {
    ts: string;
    sourceRowId: number;
    sackNum: number | null;
    weightKg: number | null;
    inRange: boolean | null;
  } | null;
  lastCone: {
    ts: string;
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

  // One lower bound serves both the shift totals and the rolling hour: the
  // hour can begin before the shift did (twenty minutes into a shift, "last
  // hour" reaches back into the previous one), so the scan starts at the
  // earlier of the two and CASE picks each window out of the same rows.
  const hourAgoMs = nowMs - HOUR_MS;
  const tenMinAgoMs = nowMs - 10 * 60_000;
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
      ts: Date; source_row_id: number; source_station: number | null; weight_g: number | null; in_range: boolean | null;
    }>(`
      SELECT TOP 1 production_ts_utc AS ts, source_row_id, source_station, weight_g, in_range
      FROM sms.cone_event WHERE line_id = @line AND production_ts_utc_ms <= @now
      ORDER BY production_ts_utc_ms DESC`),
    bind(pool.request()).query<{
      ts: Date; source_row_id: number; sack_num: number | null; weight_kg: number | null; in_range: boolean | null;
    }>(`
      SELECT TOP 1 production_ts_utc AS ts, source_row_id, sack_num, weight_kg, in_range
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

  const lastConeRow = lastCone.recordset[0] ?? null;
  const lastConeMs = lastConeRow ? new Date(lastConeRow.ts).getTime() : null;
  const state = classifyLineState(lastConeMs, nowMs);

  // Start of the current run: the newest cone that followed a gap longer
  // than the stop threshold (or the first cone in the 24 h window). Only
  // meaningful while running; a stopped line has no current run.
  let runStartUtc: string | null = null;
  if (state.status === 'running') {
    const r = await pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('lo', mssql.BigInt, nowMs - DAY_MS)
      .input('now', mssql.BigInt, nowMs)
      .input('gapMs', mssql.BigInt, STOP_THRESHOLD_SECONDS * 1000)
      .query<{ runStart: Date | null }>(`
        WITH c AS (
          SELECT production_ts_utc AS ts, production_ts_utc_ms AS ms,
                 LAG(production_ts_utc_ms) OVER (ORDER BY production_ts_utc_ms) AS prev_ms
          FROM sms.cone_event
          WHERE line_id = @line AND production_ts_utc_ms > @lo AND production_ts_utc_ms <= @now
        )
        SELECT MAX(ts) AS runStart FROM c WHERE prev_ms IS NULL OR ms - prev_ms > @gapMs`);
    runStartUtc = iso(r.recordset[0]?.runStart ?? null);
  }

  const c = cones.recordset[0];
  const s = sacks.recordset[0];
  const shiftCones = num(c?.cones);
  const elapsedSeconds = Math.max(0, Math.round((nowMs - shift.startMs) / 1000));
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
    state: {
      status: state.status,
      sinceLastConeSeconds: state.seconds,
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
      conesPerHour: elapsedSeconds >= 600 ? Math.round((shiftCones * 3600) / elapsedSeconds) : null,
    },
    recent: {
      conesLast10Min: num(c?.last10),
      conesLastHour: num(c?.lastHour),
      sacksLastHour: num(s?.lastHour),
    },
    lastSack: lastSackRow
      ? {
          ts: iso(lastSackRow.ts)!,
          sourceRowId: Number(lastSackRow.source_row_id),
          sackNum: lastSackRow.sack_num,
          weightKg: lastSackRow.weight_kg == null ? null : Number(lastSackRow.weight_kg),
          inRange: lastSackRow.in_range,
        }
      : null,
    lastCone: lastConeRow
      ? {
          ts: iso(lastConeRow.ts)!,
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
