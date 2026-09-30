/**
 * Rejected Cones Report — styled after IFL's own SSRS rejected-cones report
 * (30 Sep 2026).
 *
 * One row per WEIGHT reject (production date, shift, winder, weight), in
 * chronological order, plus the cone-weight range (min/max/avg) per winder and
 * for the line over every PLAUSIBLE cone weighed in the period. Implausible
 * readings are excluded with the same plausibility window the cone-weight
 * report uses, and their count is reported. Winder = station.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { ShiftCode } from '@sms/shared';
import { getPlausibilityRule } from '../admin.js';
import { plausibleWhere } from '../coneState.js';
import { andEpoch, noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import type { ResolvedPeriod } from '../report.js';
import { round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import { shiftRangeClause, type ShiftRange } from '../../shiftRange.js';

export interface RejectedConeRow {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
  /** Winder = station; null when the reading carries none. */
  winder: number | null;
  weightG: number;
  /** Plant-clock instant of the reject (production time convention). */
  producedAtUtc: string;
}

export interface WeightRangeRow {
  minG: number | null;
  maxG: number | null;
  avgG: number | null;
  /** Plausible cones the range is over. */
  n: number;
}

export interface WeightRangeByWinder extends WeightRangeRow {
  winder: number;
}

export interface RejectedConesReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  lineId: number;
  /** Weight rejects, chronological. */
  list: RejectedConeRow[];
  total: number;
  weightRange: {
    line: WeightRangeRow;
    byWinder: WeightRangeByWinder[];
    plausibility: { loG: number; hiG: number };
    /** Cone readings with a weight outside the plausibility window, excluded from every range above. */
    excludedImplausible: number;
  };
  note: string;
  generationNote: GenerationNote;
}

export const REJECTED_CONES_NOTE =
  'Lists weight rejects only (cones the weighing scale rejected); quality (inspection) rejects are not on this page. ' +
  'The weight range is over every plausible cone weighed in the period, whatever its result; readings outside the ' +
  'plausibility window are excluded and counted. Winder is the weighing station.';

const dayOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isoOf = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export async function getRejectedConesReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<RejectedConesReportData> {
  const { from, to } = resolved;
  const [scope, rule] = await Promise.all([
    resolveGenerationScope(pool, lineId, { from, to }, ['cone_event', 'reject_event']),
    getPlausibilityRule(pool, lineId),
  ]);
  const window = { loG: rule.coneLoG, hiG: rule.coneHiG };

  const base = (table: 'cone_event' | 'reject_event') => {
    const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
    let where = 'line_id = @line AND shift_date BETWEEN @from AND @to';
    if (filters.shift) {
      req.input('shift', mssql.VarChar(10), filters.shift);
      where += ' AND shift_code = @shift';
    }
    if (filters.station != null) {
      req.input('station', mssql.Int, filters.station);
      where += ' AND source_station = @station';
    }
    if (shiftRange) where += ` AND ${shiftRangeClause(shiftRange, { date: 'shift_date', code: 'shift_code' }, req)}`;
    return { req, where: andEpoch(where, req, scope, table) };
  };

  const rj = base('reject_event');
  const cn = base('cone_event');
  const plaus = plausibleWhere(cn.req, 'weight_g', window);

  const [rejects, ranges] = await Promise.all([
    rj.req.query<{ d: unknown; sc: string; st: number | null; w: number; ts: unknown }>(
      `SELECT shift_date AS d, shift_code AS sc, source_station AS st, weight_g AS w, production_ts_utc AS ts
         FROM sms.reject_event
        WHERE ${rj.where} AND reject_type = 'weight' AND weight_g IS NOT NULL
        ORDER BY production_ts_utc_ms, reject_event_id`,
    ),
    cn.req.query<{ st: number | null; n: number; sm: number | null; mn: number | null; mx: number | null; bad: number }>(
      `SELECT source_station AS st,
              SUM(CASE WHEN ${plaus} THEN 1 ELSE 0 END) AS n,
              SUM(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) AS sm,
              MIN(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) AS mn,
              MAX(CASE WHEN ${plaus} THEN CAST(weight_g AS float) END) AS mx,
              SUM(CASE WHEN weight_g IS NOT NULL AND NOT (${plaus}) THEN 1 ELSE 0 END) AS bad
         FROM sms.cone_event
        WHERE ${cn.where}
        GROUP BY source_station`,
    ),
  ]);

  const list: RejectedConeRow[] = rejects.recordset.map((r) => ({
    date: dayOf(r.d),
    shift: r.sc as ShiftCode,
    winder: r.st == null ? null : Number(r.st),
    weightG: Number(r.w),
    producedAtUtc: isoOf(r.ts),
  }));

  let lineN = 0;
  let lineSum = 0;
  let lineMin: number | null = null;
  let lineMax: number | null = null;
  let bad = 0;
  const byWinder: WeightRangeByWinder[] = [];
  for (const r of ranges.recordset) {
    const n = Number(r.n ?? 0);
    bad += Number(r.bad ?? 0);
    if (n > 0) {
      lineN += n;
      lineSum += Number(r.sm ?? 0);
      const mn = Number(r.mn);
      const mx = Number(r.mx);
      lineMin = lineMin == null ? mn : Math.min(lineMin, mn);
      lineMax = lineMax == null ? mx : Math.max(lineMax, mx);
    }
    if (r.st != null) {
      byWinder.push({
        winder: Number(r.st),
        n,
        minG: n > 0 ? round(Number(r.mn)) : null,
        maxG: n > 0 ? round(Number(r.mx)) : null,
        avgG: n > 0 ? round(Number(r.sm) / n) : null,
      });
    }
  }
  byWinder.sort((a, b) => a.winder - b.winder);

  return {
    period: resolved,
    filters,
    lineId,
    list,
    total: list.length,
    weightRange: {
      line: { n: lineN, minG: round(lineMin), maxG: round(lineMax), avgG: lineN > 0 ? round(lineSum / lineN) : null },
      byWinder,
      plausibility: window,
      excludedImplausible: bad,
    },
    note: REJECTED_CONES_NOTE,
    generationNote: noteOf(scope),
  };
}

export const REJECTED_CONES_CSV_HEADERS = [
  'section', 'date', 'shift', 'winder', 'weight_g', 'produced_at', 'n', 'min_g', 'max_g', 'avg_g',
] as const;

export function rejectedConesCsv(d: RejectedConesReportData): CsvTable {
  const rows: CsvRow[] = [
    ...d.list.map((r): CsvRow => ['rejected_cone', r.date, r.shift, r.winder, r.weightG, r.producedAtUtc, null, null, null, null]),
    ['total', null, null, null, null, null, d.total, null, null, null],
    ['weight_range_line', null, null, null, null, null, d.weightRange.line.n, d.weightRange.line.minG, d.weightRange.line.maxG, d.weightRange.line.avgG],
    ...d.weightRange.byWinder.map((w): CsvRow => ['weight_range_winder', null, null, w.winder, null, null, w.n, w.minG, w.maxG, w.avgG]),
    ['excluded_implausible', null, null, null, null, null, d.weightRange.excludedImplausible, null, null, null],
  ];
  return { headers: REJECTED_CONES_CSV_HEADERS, rows };
}
