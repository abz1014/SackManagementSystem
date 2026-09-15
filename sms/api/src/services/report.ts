/**
 * Production report — the period summary IFL asked for and the app never had.
 *
 * Their requirement list says "comprehensive reporting, analytics and graphical
 * dashboards". Analytics and dashboards were built; reporting was not. There
 * was nowhere in the app that answered "how much did we make this month", which
 * is the most ordinary question a mill manager has. This is that endpoint.
 *
 * It is deliberately plain. Counts, weights, a reject rate and time lost, over
 * one clearly stated period, split by shift and by day. No OEE, no control
 * limits, no capability index. Anything that needs explaining does not belong
 * here.
 *
 * COVERAGE IS PART OF THE ANSWER, not a footnote. The supplied copy holds 19
 * production days, so "this quarter" is 19 days of a 92-day period. A report
 * that prints a total without saying that invites someone to read it as a
 * quarter's output. Every response carries how many days the period contains,
 * how many actually hold readings, and the first and last of them, so the
 * screen can say so in words before it shows a single figure.
 *
 * Periods are resolved against shift_date, the same production-day value the
 * transform stamps on every row, so a day here is exactly a day everywhere
 * else in the app.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { getProduction, type ProductionRow, type ProductionStates } from './production.js';
import { getStoppagePatterns } from './downtime.js';
import { getShiftCheck } from './shiftCheck.js';

/** Same 120 s split the downtime screen uses; see downtime.ts for why. */
export const REPORT_STOP_THRESHOLD_SECONDS = 120;

export const REPORT_PERIODS = ['day', 'week', 'month', 'quarter', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface ResolvedPeriod {
  period: ReportPeriod;
  from: string;
  to: string;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const parseDay = (s: string): Date => new Date(`${s}T00:00:00Z`);

/**
 * Turn a period name plus an anchor date into a concrete day range. Pure.
 *
 * Built in UTC on purpose: these are plain production-day labels, not
 * instants, and constructing them in the server's local zone would shift a
 * month boundary by a day on any machine east or west of UTC.
 *
 * The week is ISO (Monday to Sunday). Month and quarter are calendar, not
 * trailing-30 or trailing-90, because a manager comparing months means the
 * months on the wall calendar.
 */
export function resolvePeriod(
  period: ReportPeriod,
  anchor: string,
  from?: string,
  to?: string,
): ResolvedPeriod {
  if (period === 'custom') {
    if (!from || !to) throw new Error('custom period requires from and to');
    return { period, from, to };
  }
  const a = parseDay(anchor);
  switch (period) {
    case 'day':
      return { period, from: anchor, to: anchor };
    case 'week': {
      const mondayOffset = (a.getUTCDay() + 6) % 7; // Sunday is 0, so shift it to the end
      const start = new Date(a);
      start.setUTCDate(a.getUTCDate() - mondayOffset);
      const end = new Date(start);
      end.setUTCDate(start.getUTCDate() + 6);
      return { period, from: isoDay(start), to: isoDay(end) };
    }
    case 'month': {
      const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
      const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0)); // day 0 = last of previous
      return { period, from: isoDay(start), to: isoDay(end) };
    }
    case 'quarter': {
      const q = Math.floor(a.getUTCMonth() / 3);
      const start = new Date(Date.UTC(a.getUTCFullYear(), q * 3, 1));
      const end = new Date(Date.UTC(a.getUTCFullYear(), q * 3 + 3, 0));
      return { period, from: isoDay(start), to: isoDay(end) };
    }
  }
}

/** Calendar days in an inclusive range. */
export function daysInRange(from: string, to: string): number {
  return Math.floor((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1;
}

export interface ReportLine {
  /** Day (YYYY-MM-DD), shift code, or 'total'. */
  group: string;
  cones: number;
  rejectedCones: number;
  /** Rejects as a share of everything weighed, good and rejected. */
  rejectRatePct: number | null;
  conesInRangePct: number | null;
  sacks: number;
  sackWeightKg: number;
  avgSackKg: number | null;
  conesPerSack: number | null;
}

export interface ReportCoverage {
  daysInPeriod: number;
  daysWithData: number;
  firstDayWithData: string | null;
  lastDayWithData: string | null;
  /** Every calendar day in the period holds readings. */
  complete: boolean;
}

export interface ReportData {
  period: ResolvedPeriod;
  coverage: ReportCoverage;
  totals: ReportLine;
  byShift: ReportLine[];
  byDay: ReportLine[];
  downtime: {
    stoppageCount: number;
    stoppedSeconds: number;
    thresholdSeconds: number;
  };
  /**
   * Cones by the one classification state, and how many the population rule
   * excluded as implausible (roadmap Phase 4, 14 Sep 2026) — so the report
   * prints "N readings, of which M implausible excluded" from the same count
   * every weight statistic was computed over.
   */
  readings: ProductionStates | null;
  /**
   * Plant-stored shift versus SMS-derived shift over the period (Phase 4
   * item 5): the count that disagree, of the count compared, and the hour of
   * day they most often disagree at. Null when nothing could be compared.
   */
  shiftCheck: { compared: number; mismatched: number; mismatchPct: number; topHour: number | null } | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Derive the report's ratios from a production row. */
export function toReportLine(r: ProductionRow): ReportLine {
  const cones = r.cones ?? 0;
  const rejected = r.rejectedCones ?? 0;
  const weighed = cones + rejected;
  const sacks = r.sacks ?? 0;
  const kg = r.sackWeightKg ?? 0;
  return {
    group: r.group,
    cones,
    rejectedCones: rejected,
    rejectRatePct: weighed > 0 ? Math.round((10000 * rejected) / weighed) / 100 : null,
    conesInRangePct: r.conesInRangePct,
    sacks,
    sackWeightKg: round1(kg),
    avgSackKg: sacks > 0 ? Math.round((100 * kg) / sacks) / 100 : null,
    conesPerSack: sacks > 0 ? round1(cones / sacks) : null,
  };
}

const EMPTY_LINE: ReportLine = {
  group: 'total',
  cones: 0,
  rejectedCones: 0,
  rejectRatePct: null,
  conesInRangePct: null,
  sacks: 0,
  sackWeightKg: 0,
  avgSackKg: null,
  conesPerSack: null,
};

/** Shift order as the plant runs them, not alphabetical. */
const SHIFT_ORDER = ['morning', 'evening', 'night'];

export async function getReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
): Promise<ReportData> {
  const { from, to } = resolved;

  const [totalRes, shiftRes, dayRes, coverageRes, stops, shiftCheck] = await Promise.all([
    getProduction(pool, lineId, { from, to, groupBy: 'none', withStates: true }),
    getProduction(pool, lineId, { from, to, groupBy: 'shift' }),
    getProduction(pool, lineId, { from, to, groupBy: 'day' }),
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('from', mssql.Date, from)
      .input('to', mssql.Date, to)
      .query<{ n: number; firstDay: string | null; lastDay: string | null }>(
        `SELECT COUNT(DISTINCT shift_date) AS n,
                CONVERT(varchar(10), MIN(shift_date), 120) AS firstDay,
                CONVERT(varchar(10), MAX(shift_date), 120) AS lastDay
           FROM sms.cone_event
          WHERE line_id = @line AND shift_date BETWEEN @from AND @to`,
      ),
    getStoppagePatterns(pool, lineId, from, to, REPORT_STOP_THRESHOLD_SECONDS),
    getShiftCheck(pool, lineId, from, to),
  ]);

  const cov = coverageRes.recordset[0];
  const daysWithData = cov?.n ?? 0;
  const daysInPeriod = daysInRange(from, to);

  const byShift = shiftRes.rows
    .filter((r) => r.group !== 'total')
    .map(toReportLine)
    .sort((a, b) => SHIFT_ORDER.indexOf(a.group) - SHIFT_ORDER.indexOf(b.group));

  return {
    period: resolved,
    coverage: {
      daysInPeriod,
      daysWithData,
      firstDayWithData: cov?.firstDay ?? null,
      lastDayWithData: cov?.lastDay ?? null,
      complete: daysWithData > 0 && daysWithData === daysInPeriod,
    },
    totals: totalRes.rows[0] ? toReportLine(totalRes.rows[0]) : EMPTY_LINE,
    byShift,
    byDay: dayRes.rows.map(toReportLine),
    downtime: {
      stoppageCount: stops.stoppages.length,
      stoppedSeconds: stops.stoppages.reduce((s, g) => s + g.durationSeconds, 0),
      thresholdSeconds: REPORT_STOP_THRESHOLD_SECONDS,
    },
    readings: totalRes.states == null ? null : { states: totalRes.states, implausible: totalRes.implausible ?? 0 },
    shiftCheck:
      shiftCheck.cones - shiftCheck.noLegacyShift > 0
        ? {
            compared: shiftCheck.cones - shiftCheck.noLegacyShift,
            mismatched: shiftCheck.mismatched,
            mismatchPct: shiftCheck.mismatchPct,
            topHour: shiftCheck.topHours[0]?.hour ?? null,
          }
        : null,
  };
}
