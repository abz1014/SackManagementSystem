/**
 * Current Product (Q1). Append-only product_timeline: a Process Engineer sets
 * the running product; effective_from (actual change) is distinct from
 * changed_at (recorded). NEVER updates/deletes. Writes to OUR db only.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface ProductOption {
  productId: number;
  description: string | null;
  lotCode: string | null;
  setpointG: number | null;
}

export interface TimelineEntry {
  timelineId: number;
  productId: number;
  productLabel: string;
  effectiveFrom: string;
  changedAt: string;
  changedBy: string | null;
  reason: string | null;
}

export async function listProducts(pool: ConnectionPool): Promise<ProductOption[]> {
  const r = await pool.request().query<{ product_id: number; description: string | null; lot_code: string | null; sp: number | null }>(
    `SELECT product_id, description, lot_code, setpoint_weight_g AS sp FROM sms.product ORDER BY product_id`,
  );
  return r.recordset.map((x) => ({
    productId: x.product_id,
    description: x.description,
    lotCode: x.lot_code,
    setpointG: x.sp == null ? null : Number(x.sp),
  }));
}

function label(p: { description: string | null; lot_code: string | null; product_id: number }): string {
  return p.description || p.lot_code || `Product ${p.product_id}`;
}

export async function getCurrent(pool: ConnectionPool, lineId: number): Promise<TimelineEntry | null> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    timeline_id: number; product_id: number; description: string | null; lot_code: string | null;
    effective_from: Date; changed_at: Date; changed_by: string | null; reason: string | null;
  }>(
    `SELECT TOP 1 t.timeline_id, t.product_id, p.description, p.lot_code,
            t.effective_from, t.changed_at, u.display_name AS changed_by, t.reason
     FROM sms.product_timeline t
     LEFT JOIN sms.product p ON p.product_id = t.product_id
     LEFT JOIN sms.app_user u ON u.user_id = t.changed_by
     WHERE t.line_id = @line AND t.superseded = 0
     ORDER BY t.effective_from DESC, t.timeline_id DESC`,
  );
  const x = r.recordset[0];
  return x
    ? {
        timelineId: x.timeline_id,
        productId: x.product_id,
        productLabel: label({ description: x.description, lot_code: x.lot_code, product_id: x.product_id }),
        effectiveFrom: new Date(x.effective_from).toISOString(),
        changedAt: new Date(x.changed_at).toISOString(),
        changedBy: x.changed_by,
        reason: x.reason,
      }
    : null;
}

export async function setCurrent(
  pool: ConnectionPool,
  lineId: number,
  productId: number,
  effectiveFrom: Date,
  changedBy: number,
  reason: string | null,
): Promise<number> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .input('pid', mssql.Int, productId)
    .input('eff', mssql.DateTime2, effectiveFrom)
    .input('by', mssql.Int, changedBy)
    .input('reason', mssql.NVarChar(255), reason)
    .query<{ id: number }>(
      `INSERT INTO sms.product_timeline (line_id, product_id, effective_from, changed_by, reason)
       OUTPUT INSERTED.timeline_id id
       VALUES (@line, @pid, @eff, @by, @reason)`,
    );
  return r.recordset[0]!.id;
}
