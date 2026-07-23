/**
 * Shift analysis (Q7): cones per shift computed BOTH ways —
 *   corrected  = from real production time (our fix)
 *   legacy     = IFL's stored value (derived from insert time, ~3.8h lagged)
 * plus the count of cones whose shift actually differs between the two.
 * This turns the shift bug into something IFL can see and decide on.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface ShiftCount {
  shift: string;
  cones: number;
}
export interface ShiftAnalysisData {
  corrected: ShiftCount[];
  legacy: ShiftCount[];
  mismatch: { differing: number; total: number; pct: number };
}

const ORDER = ['morning', 'evening', 'night'];
const sortShift = (a: ShiftCount, b: ShiftCount) =>
  ORDER.indexOf(a.shift) - ORDER.indexOf(b.shift);

export async function getShiftAnalysis(
  pool: ConnectionPool,
  lineId: number,
  from?: string,
  to?: string,
): Promise<ShiftAnalysisData> {
  const where = ['line_id = @line'];
  const bind = (r: mssql.Request) => {
    r.input('line', mssql.Int, lineId);
    if (from) r.input('from', mssql.Date, from);
    if (to) r.input('to', mssql.Date, to);
    return r;
  };
  if (from) where.push('shift_date >= @from');
  if (to) where.push('shift_date <= @to');
  const w = where.join(' AND ');

  const corrected = await bind(pool.request()).query<{ shift: string; cones: number }>(
    `SELECT shift_code AS shift, COUNT(*) AS cones FROM sms.cone_event WHERE ${w} GROUP BY shift_code`,
  );
  const legacy = await bind(pool.request()).query<{ shift: string; cones: number }>(
    `SELECT shift_code_legacy AS shift, COUNT(*) AS cones FROM sms.cone_event
     WHERE ${w} AND shift_code_legacy IS NOT NULL GROUP BY shift_code_legacy`,
  );
  const mm = await bind(pool.request()).query<{ diff: number; total: number }>(
    `SELECT SUM(CASE WHEN shift_code <> shift_code_legacy THEN 1 ELSE 0 END) AS diff,
            COUNT(*) AS total
     FROM sms.cone_event WHERE ${w} AND shift_code_legacy IS NOT NULL`,
  );
  const diff = mm.recordset[0]?.diff ?? 0;
  const total = mm.recordset[0]?.total ?? 0;

  return {
    corrected: corrected.recordset.sort(sortShift),
    legacy: legacy.recordset.sort(sortShift),
    mismatch: { differing: diff, total, pct: total > 0 ? Math.round((10000 * diff) / total) / 100 : 0 },
  };
}
