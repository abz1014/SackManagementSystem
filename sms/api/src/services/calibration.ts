/**
 * Calibration advisory (Phase 5 — roadmap table). Two questions the existing
 * Weight screen cannot answer:
 *
 *  1. Is any ONE station's scale drifting, even while the line-wide mean
 *     looks fine? spc.ts's per-station analysis (StationStat) gives a single
 *     mean over the whole selected range — it can tell you a station runs
 *     light, but not whether that offset has been GROWING. A scale creeping
 *     out of calibration shows up as a trend day-over-day, which a one-number
 *     summary erases by averaging it away.
 *  2. Has anyone actually recalibrated a station, and when? Nothing recorded
 *     that before — sms.calibration_adjustment (below) is the ledger.
 *
 * Cone-only: sacks carry no station column, same restriction as spc.ts's
 * per-station analysis.
 *
 * Deliberately reuses spc.ts's plausibility guard and nelson.ts's engine
 * rather than reimplementing either — this is the same statistics applied at
 * a different grain (per station, per day), not a different method.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { PlausibilityRule } from './admin.js';
import { nelsonViolations, type NelsonRuleId } from './nelson.js';

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** I-MR sigma for a sequence of individual points: mean moving range / d2.
 *  d2 = 1.128 is the standard constant for a 2-point moving range (Montgomery,
 *  Introduction to Statistical Quality Control). 0 with fewer than 2 points —
 *  there is no "day to day" to measure yet. */
export function individualsSigma(values: number[]): number {
  if (values.length < 2) return 0;
  let sumMr = 0;
  for (let i = 1; i < values.length; i++) sumMr += Math.abs(values[i]! - values[i - 1]!);
  const mrBar = sumMr / (values.length - 1);
  return mrBar / 1.128;
}

export interface StationDriftDay {
  date: string; // YYYY-MM-DD (shift_date)
  n: number;
  mean: number;
  nelson: NelsonRuleId[];
}

export interface StationDrift {
  station: number;
  n: number;
  grandMean: number;
  /** Informational only — the within-DAY spread of individual cone weights.
   *  NOT what the Nelson zones are measured against; see sigmaDayToDay. */
  stdevWithin: number;
  /** The I-MR sigma actually used for Nelson zone widths — how much this
   *  station's daily mean normally moves day to day. */
  sigmaDayToDay: number;
  days: StationDriftDay[];
  /** Any day in range triggered a Nelson rule — the actionable subset, same
   *  distinction spc.ts draws between "distinguishable" and "flagged". */
  flagged: boolean;
}

export interface CalibrationData {
  unit: 'g';
  from: string;
  to: string;
  days: number; // distinct production days in range — the practical ceiling on which Nelson rules can ever fire (see nelson.ts)
  stations: StationDrift[];
  flaggedStationCount: number;
}

export async function getStationDrift(
  pool: ConnectionPool,
  lineId: number,
  from: string,
  to: string,
  plausibility: PlausibilityRule,
): Promise<CalibrationData> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('from', mssql.Date, from)
    .input('to', mssql.Date, to)
    .input('plausLo', mssql.Float, plausibility.coneLoG)
    .input('plausHi', mssql.Float, plausibility.coneHiG)
    .query<{ st: number; d: Date; n: number; mean: number; sd: number | null }>(
      `SELECT source_station st, shift_date d, COUNT(*) n,
              AVG(CAST(weight_g AS float)) mean, STDEV(CAST(weight_g AS float)) sd
       FROM sms.cone_event
       WHERE line_id=@line AND shift_date BETWEEN @from AND @to
         AND weight_g IS NOT NULL AND weight_g BETWEEN @plausLo AND @plausHi
         AND source_station IS NOT NULL
       GROUP BY source_station, shift_date
       ORDER BY source_station, shift_date`,
    );

  const byStation = new Map<number, { d: Date; n: number; mean: number; sd: number | null }[]>();
  for (const row of r.recordset) {
    const list = byStation.get(row.st) ?? [];
    list.push(row);
    byStation.set(row.st, list);
  }

  const daySet = new Set(r.recordset.map((row) => new Date(row.d).toISOString().slice(0, 10)));

  const stations: StationDrift[] = [...byStation.entries()]
    .sort(([a], [b]) => a - b)
    .map(([station, rows]) => {
      const totalN = rows.reduce((s, x) => s + x.n, 0);
      const grandMean = totalN > 0 ? rows.reduce((s, x) => s + x.n * x.mean, 0) / totalN : 0;
      let pooledNum = 0;
      let pooledDen = 0;
      for (const x of rows) {
        if (x.sd != null && x.n > 1) {
          pooledNum += (x.n - 1) * x.sd * x.sd;
          pooledDen += x.n - 1;
        }
      }
      const stdevWithin = pooledDen > 0 ? Math.sqrt(pooledNum / pooledDen) : 0;

      // Nelson zones need the sigma of a DAY'S MEAN moving day to day, not
      // stdevWithin/√n — that sampling-error estimate shrinks toward zero as
      // more cones are weighed in a day and would flag ordinary day-to-day
      // wobble as an extreme pattern. Verified on real data: with ~650
      // cones/station/day the naive SE was ~0.28g against real day-to-day
      // swings of 1-8g, flagging all 14 of 14 stations — an obviously wrong
      // "everything is drifting" result. The correct sigma for a sequence of
      // individual points (here: one mean per day) is the classic I-MR
      // estimator — average moving range / d2 (1.128 for a 2-point range).
      const sigmaDayToDay = individualsSigma(rows.map((x) => x.mean));

      const nelson = nelsonViolations(
        rows.map((x) => ({ value: x.mean, se: sigmaDayToDay })),
        grandMean,
      );

      const days: StationDriftDay[] = rows.map((x, i) => ({
        date: new Date(x.d).toISOString().slice(0, 10),
        n: x.n,
        mean: round(x.mean, 2),
        nelson: nelson[i]!,
      }));

      return {
        station,
        n: totalN,
        grandMean: round(grandMean, 2),
        stdevWithin: round(stdevWithin, 3),
        sigmaDayToDay: round(sigmaDayToDay, 3),
        days,
        flagged: days.some((d) => d.nelson.length > 0),
      };
    });

  return {
    unit: 'g',
    from,
    to,
    days: daySet.size,
    stations,
    flaggedStationCount: stations.filter((s) => s.flagged).length,
  };
}

// ---- adjustment ledger ----

export interface CalibrationAdjustment {
  adjustmentId: number;
  stationId: number | null;
  adjustedAtUtc: string;
  recordedAtUtc: string;
  recordedBy: string | null;
  reason: string | null;
  note: string | null;
}

export async function listCalibrationAdjustments(pool: ConnectionPool, lineId: number, limit = 200): Promise<CalibrationAdjustment[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).input('n', mssql.Int, limit).query<{
    adjustment_id: number; station_id: number | null; adjusted_at_utc: Date; recorded_at_utc: Date;
    recorded_by: string | null; reason: string | null; note: string | null;
  }>(
    `SELECT TOP (@n) a.adjustment_id, a.station_id, a.adjusted_at_utc, a.recorded_at_utc,
            u.display_name AS recorded_by, a.reason, a.note
     FROM sms.calibration_adjustment a
     LEFT JOIN sms.app_user u ON u.user_id = a.recorded_by
     WHERE a.line_id=@line
     ORDER BY a.adjusted_at_utc DESC, a.adjustment_id DESC`,
  );
  return r.recordset.map((x) => ({
    adjustmentId: x.adjustment_id,
    stationId: x.station_id,
    adjustedAtUtc: new Date(x.adjusted_at_utc).toISOString(),
    recordedAtUtc: new Date(x.recorded_at_utc).toISOString(),
    recordedBy: x.recorded_by,
    reason: x.reason,
    note: x.note,
  }));
}

export async function recordCalibrationAdjustment(
  pool: ConnectionPool,
  lineId: number,
  stationId: number | null,
  adjustedAtUtc: Date,
  recordedBy: number,
  reason: string | null,
  note: string | null,
): Promise<number> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('station', mssql.Int, stationId)
    .input('adj', mssql.DateTime2, adjustedAtUtc)
    .input('by', mssql.Int, recordedBy)
    .input('reason', mssql.NVarChar(255), reason)
    .input('note', mssql.NVarChar(500), note)
    .query<{ id: number }>(
      `INSERT INTO sms.calibration_adjustment (line_id, station_id, adjusted_at_utc, recorded_by, reason, note)
       OUTPUT INSERTED.adjustment_id id
       VALUES (@line, @station, @adj, @by, @reason, @note)`,
    );
  return r.recordset[0]!.id;
}
