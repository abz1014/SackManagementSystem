/**
 * Reject analysis (Q10). Pareto of reject reasons using the RAW codes, joined
 * to the reject_code lookup for labels (NULL until IFL provides the code list).
 * Total counts/trend work now; only the reason *labels* wait on Q10.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { Db } from './audit.js';

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
      ON rc.line_id = re.line_id
     AND rc.reject_type = re.reject_type
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

export const REJECT_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
export type RejectSeverity = (typeof REJECT_SEVERITIES)[number];

export interface RejectCodeRow {
  rejectCodeId: number;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
  label: string | null;
  isPass: boolean | null;
  severity: RejectSeverity | null;
}

/**
 * The line's reject codes — every (type, tube, material) combination the
 * transform has observed, with whatever label / pass flag / severity has been
 * entered. Codes are per line since migration 028 (rc.line_id, and the join
 * above matches on it), because a second line's scale may use the same
 * numbers for different faults.
 */
export async function listRejectCodes(pool: ConnectionPool, lineId: number): Promise<RejectCodeRow[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    reject_code_id: number; reject_type: string; tube_code: number | null; material_code: number | null;
    label: string | null; is_pass: boolean | null; severity: string | null;
  }>(
    `SELECT reject_code_id, reject_type, tube_code, material_code, label, is_pass, severity
       FROM sms.reject_code WHERE line_id = @line
      ORDER BY reject_type, tube_code, material_code`,
  );
  return r.recordset.map((x) => ({
    rejectCodeId: Number(x.reject_code_id),
    rejectType: x.reject_type,
    tubeCode: x.tube_code == null ? null : Number(x.tube_code),
    materialCode: x.material_code == null ? null : Number(x.material_code),
    label: x.label,
    isPass: x.is_pass == null ? null : Boolean(x.is_pass),
    severity: (x.severity as RejectSeverity | null) ?? null,
  }));
}

export interface RejectCodePatch {
  /** `undefined` leaves the field alone; `null` clears it. Same for all three. */
  label?: string | null;
  isPass?: boolean | null;
  severity?: RejectSeverity | null;
}

/**
 * Update a reject code's label / pass flag / severity (Q10 answer entry).
 * The only write in this codebase that overwrites rather than versions —
 * reject_code is a small lookup table, not an event stream, so a full history
 * table would be over-engineering. What it must not do is lose the old value
 * silently: OUTPUT deleted.* captures it in the same statement so the caller
 * can put it in the audit log, which is where this row's history now lives
 * instead of nowhere.
 *
 * Only the fields PRESENT are written. The distinction matters: the Rejects
 * screen renames a label and sends no isPass at all, and until 14 Sep 2026
 * that absent value arrived here as null and was written — every rename
 * wiped the code's pass flag. Each column has its own set flag in the SQL so
 * the same mistake cannot be made for severity.
 */
export async function updateRejectCode(
  db: Db,
  lineId: number,
  rejectCodeId: number,
  p: RejectCodePatch,
): Promise<{ rowsAffected: number; oldLabel: string | null; oldIsPass: boolean | null; oldSeverity: RejectSeverity | null }> {
  const r = await db
    .request()
    .input('id', mssql.BigInt, rejectCodeId)
    .input('line', mssql.Int, lineId)
    .input('setLabel', mssql.Bit, p.label !== undefined)
    .input('label', mssql.NVarChar(128), p.label ?? null)
    .input('setPass', mssql.Bit, p.isPass !== undefined)
    .input('pass', mssql.Bit, p.isPass ?? null)
    .input('setSeverity', mssql.Bit, p.severity !== undefined)
    .input('severity', mssql.VarChar(10), p.severity ?? null)
    .query<{ old_label: string | null; old_is_pass: boolean | null; old_severity: string | null }>(
      `UPDATE sms.reject_code
          SET label = CASE WHEN @setLabel = 1 THEN @label ELSE label END,
              is_pass = CASE WHEN @setPass = 1 THEN @pass ELSE is_pass END,
              severity = CASE WHEN @setSeverity = 1 THEN @severity ELSE severity END
       OUTPUT deleted.label AS old_label, deleted.is_pass AS old_is_pass, deleted.severity AS old_severity
       WHERE reject_code_id = @id AND line_id = @line`,
    );
  const row = r.recordset[0];
  return {
    rowsAffected: r.rowsAffected[0] ?? 0,
    oldLabel: row?.old_label ?? null,
    oldIsPass: row?.old_is_pass == null ? null : Boolean(row.old_is_pass),
    oldSeverity: (row?.old_severity as RejectSeverity | null) ?? null,
  };
}
