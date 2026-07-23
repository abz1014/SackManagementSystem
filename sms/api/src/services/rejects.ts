/**
 * Reject analysis (Q10). Pareto of reject reasons using the RAW codes, joined
 * to the reject_code lookup for labels (NULL until IFL provides the code list).
 * Total counts/trend work now; only the reason *labels* wait on Q10.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface RejectReason {
  rejectCodeId: number | null;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
  label: string | null;
  displayLabel: string;
  count: number;
  pct: number;
  cumulativePct: number;
}

function displayFor(r: { rejectType: string; tubeCode: number | null; materialCode: number | null; label: string | null }): string {
  if (r.label) return r.label;
  if (r.rejectType === 'weight') return 'Weight out of range';
  return `Tube ${r.tubeCode ?? '—'} · Mat ${r.materialCode ?? '—'}`;
}

export async function getRejectPareto(
  pool: ConnectionPool,
  lineId: number,
  from?: string,
  to?: string,
): Promise<{ total: number; reasons: RejectReason[] }> {
  const req = pool.request().input('line', mssql.Int, lineId);
  const where = ['re.line_id = @line'];
  if (from) { where.push('re.shift_date >= @from'); req.input('from', mssql.Date, from); }
  if (to) { where.push('re.shift_date <= @to'); req.input('to', mssql.Date, to); }

  const r = await req.query<{
    reject_code_id: number | null;
    reject_type: string;
    tube_inspect_code: number | null;
    material_inspect_code: number | null;
    label: string | null;
    n: number;
  }>(`
    SELECT rc.reject_code_id, re.reject_type, re.tube_inspect_code, re.material_inspect_code,
           rc.label, COUNT(*) AS n
    FROM sms.reject_event re
    LEFT JOIN sms.reject_code rc
      ON rc.reject_type = re.reject_type
     AND ISNULL(rc.tube_code, -999)     = ISNULL(re.tube_inspect_code, -999)
     AND ISNULL(rc.material_code, -999) = ISNULL(re.material_inspect_code, -999)
    WHERE ${where.join(' AND ')}
    GROUP BY rc.reject_code_id, re.reject_type, re.tube_inspect_code, re.material_inspect_code, rc.label
    ORDER BY n DESC
  `);

  const total = r.recordset.reduce((s, x) => s + x.n, 0);
  let cum = 0;
  const reasons: RejectReason[] = r.recordset.map((x) => {
    cum += x.n;
    const base = {
      rejectType: x.reject_type,
      tubeCode: x.tube_inspect_code,
      materialCode: x.material_inspect_code,
      label: x.label,
    };
    return {
      rejectCodeId: x.reject_code_id == null ? null : Number(x.reject_code_id),
      ...base,
      displayLabel: displayFor(base),
      count: x.n,
      pct: total > 0 ? Math.round((1000 * x.n) / total) / 10 : 0,
      cumulativePct: total > 0 ? Math.round((1000 * cum) / total) / 10 : 0,
    };
  });
  return { total, reasons };
}

/** Set a reject-reason label (Q10 answer entry). Returns rows affected. */
export async function setRejectLabel(
  pool: ConnectionPool,
  rejectCodeId: number,
  label: string | null,
  isPass: boolean | null,
): Promise<number> {
  const r = await pool
    .request()
    .input('id', mssql.BigInt, rejectCodeId)
    .input('label', mssql.NVarChar(128), label)
    .input('pass', mssql.Bit, isPass)
    .query(`UPDATE sms.reject_code SET label=@label, is_pass=@pass WHERE reject_code_id=@id`);
  return r.rowsAffected[0] ?? 0;
}
