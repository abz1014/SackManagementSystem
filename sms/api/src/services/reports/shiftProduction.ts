/**
 * Shift Production Report — styled after IFL's own SSRS shift report (30 Sep 2026).
 *
 * Per shift, per production date and per winder (winder = station, 1..14):
 * pass (cones weighed), weight rejects, total, and efficiency = pass / total.
 * Everything is grouped under the line (LINE_NAME); there is no loop concept.
 *
 * WHAT "REJECT" MEANS HERE. Only WEIGHT rejects (reject_event rows with
 * reject_type = 'weight' and a weight_g) count, as in IFL's own sheet. Quality
 * (inspection) rejects are NOT part of this efficiency and are stated as such
 * in `note`.
 *
 * One source generation, scoped once and applied to both tables, so a period
 * spanning IFL's rebuild (or the plant simulator) cannot pool two populations.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { SHIFT_CODES, type ShiftCode } from '@sms/shared';
import { andEpoch, noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
import type { ResolvedPeriod } from '../report.js';
import { round, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';
import { shiftRangeClause, type ShiftRange } from '../../shiftRange.js';

export interface ShiftProductionFigures {
  /** Cones weighed. */
  pass: number;
  /** Weight rejects (reject rows carrying a weight). */
  weightRejects: number;
  /** pass + weightRejects. */
  total: number;
  /** pass / total x 100 to 2 dp; null when total is 0. */
  efficiencyPct: number | null;
}

export interface ShiftProductionSummaryRow extends ShiftProductionFigures {
  shift: ShiftCode;
}

export interface ShiftProductionRow extends ShiftProductionFigures {
  /** Production date (shift_date), YYYY-MM-DD. */
  date: string;
  shift: ShiftCode;
  /** Winder = station, 1..14. */
  winder: number;
}

export interface ShiftProductionShiftTotal extends ShiftProductionFigures {
  date: string;
  shift: ShiftCode;
}

export interface ShiftProductionReportData {
  period: ResolvedPeriod;
  filters: ReportFilters;
  /** The report is for this line only. */
  lineId: number;
  /** One entry per shift present in the period, in shift order (morning, evening, night). */
  summary: ShiftProductionSummaryRow[];
  grandTotal: ShiftProductionFigures;
  /** Per production date, shift and winder, sorted by date, shift order, winder. */
  rows: ShiftProductionRow[];
  /** Per production date and shift, sorted by date then shift order. */
  shiftTotals: ShiftProductionShiftTotal[];
  /** Cones and weight rejects with no winder recorded: in summary/grandTotal/shiftTotals, absent from rows. */
  withoutWinder: { pass: number; weightRejects: number };
  note: string;
  generationNote: GenerationNote;
}

export const SHIFT_PRODUCTION_NOTE =
  'Pass is cones weighed; reject is weight rejects only. Quality (inspection) rejects are not part of this efficiency, ' +
  'as in IFL’s own shift report. Efficiency is pass divided by pass plus reject. Winder is the weighing station.';

const SHIFT_ORD: Record<string, number> = { morning: 1, evening: 2, night: 3 };
const ord = (s: string): number => SHIFT_ORD[s] ?? 9;

export function figures(pass: number, weightRejects: number): ShiftProductionFigures {
  const total = pass + weightRejects;
  return { pass, weightRejects, total, efficiencyPct: total > 0 ? round((pass / total) * 100, 2) : null };
}

const dayOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

interface CountRow { d: unknown; sc: string; st: number | null; n: number }

export async function getShiftProductionReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  filters: ReportFilters,
  shiftRange?: ShiftRange,
): Promise<ShiftProductionReportData> {
  const { from, to } = resolved;
  const scope = await resolveGenerationScope(pool, lineId, { from, to }, ['cone_event', 'reject_event']);

  const count = async (table: 'cone_event' | 'reject_event'): Promise<CountRow[]> => {
    const req = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
    let where = 'line_id = @line AND shift_date BETWEEN @from AND @to';
    if (table === 'reject_event') where += " AND reject_type = 'weight' AND weight_g IS NOT NULL";
    if (filters.shift) {
      req.input('shift', mssql.VarChar(10), filters.shift);
      where += ' AND shift_code = @shift';
    }
    if (shiftRange) where += ` AND ${shiftRangeClause(shiftRange, { date: 'shift_date', code: 'shift_code' }, req)}`;
    where = andEpoch(where, req, scope, table);
    const r = await req.query<CountRow>(
      `SELECT shift_date AS d, shift_code AS sc, source_station AS st, COUNT(*) AS n
         FROM sms.${table}
        WHERE ${where}
        GROUP BY shift_date, shift_code, source_station`,
    );
    return r.recordset;
  };
  const [cones, rejects] = await Promise.all([count('cone_event'), count('reject_event')]);

  type Acc = { pass: number; rej: number };
  const cell = new Map<string, Acc & { date: string; shift: ShiftCode; winder: number }>();
  const dayShift = new Map<string, Acc & { date: string; shift: ShiftCode }>();
  const byShift = new Map<ShiftCode, Acc>();
  const without = { pass: 0, weightRejects: 0 };

  const add = (r: CountRow, key: 'pass' | 'rej') => {
    const date = dayOf(r.d);
    const shift = r.sc as ShiftCode;
    const n = Number(r.n);
    const ds = dayShift.get(`${date}|${shift}`) ?? { date, shift, pass: 0, rej: 0 };
    ds[key] += n;
    dayShift.set(`${date}|${shift}`, ds);
    const bs = byShift.get(shift) ?? { pass: 0, rej: 0 };
    bs[key] += n;
    byShift.set(shift, bs);
    if (r.st == null) {
      without[key === 'pass' ? 'pass' : 'weightRejects'] += n;
      return;
    }
    const winder = Number(r.st);
    const ck = `${date}|${shift}|${winder}`;
    const c = cell.get(ck) ?? { date, shift, winder, pass: 0, rej: 0 };
    c[key] += n;
    cell.set(ck, c);
  };
  for (const r of cones) add(r, 'pass');
  for (const r of rejects) add(r, 'rej');

  const rows: ShiftProductionRow[] = [...cell.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || ord(a.shift) - ord(b.shift) || a.winder - b.winder)
    .map((c) => ({ date: c.date, shift: c.shift, winder: c.winder, ...figures(c.pass, c.rej) }));
  const shiftTotals: ShiftProductionShiftTotal[] = [...dayShift.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || ord(a.shift) - ord(b.shift))
    .map((c) => ({ date: c.date, shift: c.shift, ...figures(c.pass, c.rej) }));
  const summary: ShiftProductionSummaryRow[] = SHIFT_CODES.filter((s) => byShift.has(s)).map((s) => {
    const a = byShift.get(s)!;
    return { shift: s, ...figures(a.pass, a.rej) };
  });
  let pass = 0;
  let rej = 0;
  for (const a of byShift.values()) { pass += a.pass; rej += a.rej; }

  return {
    period: resolved,
    filters,
    lineId,
    summary,
    grandTotal: figures(pass, rej),
    rows,
    shiftTotals,
    withoutWinder: without,
    note: SHIFT_PRODUCTION_NOTE,
    generationNote: noteOf(scope),
  };
}

export const SHIFT_PRODUCTION_CSV_HEADERS = ['section', 'date', 'shift', 'winder', 'pass', 'weight_rejects', 'total', 'efficiency_pct'] as const;

export function shiftProductionCsv(d: ShiftProductionReportData): CsvTable {
  const line = (section: string, date: string | null, shift: string | null, winder: number | null, f: ShiftProductionFigures): CsvRow =>
    [section, date, shift, winder, f.pass, f.weightRejects, f.total, f.efficiencyPct];
  const rows: CsvRow[] = [
    ...d.summary.map((s) => line('summary', null, s.shift, null, s)),
    line('grand_total', null, null, null, d.grandTotal),
    ...d.rows.map((r) => line('winder', r.date, r.shift, r.winder, r)),
    ...d.shiftTotals.map((r) => line('shift_total', r.date, r.shift, null, r)),
  ];
  return { headers: SHIFT_PRODUCTION_CSV_HEADERS, rows };
}
