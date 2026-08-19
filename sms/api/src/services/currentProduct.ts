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
  // Was never selected before — the picker showed only description/lotCode/
  // setpoint, so a supervisor confirming a changeover had no way to see the
  // product's own tolerance or blend/tube composition without leaving the
  // page. All of this already exists in PDAS's product master; it was simply
  // never joined and returned.
  blend: string | null;
  countText: string | null;
  tubeType: string | null;
  tubeWeightG: number | null;
  weightOffsetMinusG: number | null;
  weightOffsetPlusG: number | null;
  /** PDAS MaterialActive — informational only, never enforced by us. Surfaced
   *  so a supervisor sees it before confirming, not to block the choice: PDAS
   *  being stale is at least as likely as the product genuinely being retired. */
  activeFlag: boolean | null;
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
  const r = await pool.request().query<{
    product_id: number; description: string | null; lot_code: string | null; sp: number | null;
    blend: string | null; count_text: string | null; tube_type: string | null; tube_weight_g: number | null;
    om: number | null; op: number | null; active: boolean | null;
  }>(
    `SELECT p.product_id, p.description, p.lot_code, p.setpoint_weight_g AS sp,
            b.blend, y.count_text, t.tube_type, t.tube_weight_g,
            p.weight_offset_minus_g AS om, p.weight_offset_plus_g AS op, p.active_flag AS active
     FROM sms.product p
     LEFT JOIN sms.blend b ON b.blend_id = p.blend_id
     LEFT JOIN sms.yarn_count y ON y.count_id = p.count_id
     LEFT JOIN sms.tube_type t ON t.tube_type_id = p.tube_type_id
     ORDER BY p.product_id`,
  );
  return r.recordset.map((x) => ({
    productId: x.product_id,
    description: x.description,
    lotCode: x.lot_code,
    setpointG: x.sp == null ? null : Number(x.sp),
    blend: x.blend,
    countText: x.count_text,
    tubeType: x.tube_type,
    tubeWeightG: x.tube_weight_g == null ? null : Number(x.tube_weight_g),
    weightOffsetMinusG: x.om == null ? null : Number(x.om),
    weightOffsetPlusG: x.op == null ? null : Number(x.op),
    activeFlag: x.active == null ? null : Boolean(x.active),
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

/**
 * Every changeover ever recorded, newest first — the timeline history that
 * getCurrent() never exposed (it only ever returns the single latest row).
 * Not filtered on `superseded`: that column is written but never set to 1 by
 * anything in this codebase, so filtering on it would silently drop nothing
 * today and silently drop rows the moment something starts setting it —
 * "history" means every row, regardless of what superseded is meant to track.
 * TOP (@n) is a defensive cap, not a UI control: this table grows at most a
 * few rows a day, so 200 is years of history, not a pagination limit anyone
 * should ever hit in practice.
 */
export async function listTimeline(pool: ConnectionPool, lineId: number, limit = 200): Promise<TimelineEntry[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).input('n', mssql.Int, limit).query<{
    timeline_id: number; product_id: number; description: string | null; lot_code: string | null;
    effective_from: Date; changed_at: Date; changed_by: string | null; reason: string | null;
  }>(
    `SELECT TOP (@n) t.timeline_id, t.product_id, p.description, p.lot_code,
            t.effective_from, t.changed_at, u.display_name AS changed_by, t.reason
     FROM sms.product_timeline t
     LEFT JOIN sms.product p ON p.product_id = t.product_id
     LEFT JOIN sms.app_user u ON u.user_id = t.changed_by
     WHERE t.line_id = @line
     ORDER BY t.effective_from DESC, t.timeline_id DESC`,
  );
  return r.recordset.map((x) => ({
    timelineId: x.timeline_id,
    productId: x.product_id,
    productLabel: label({ description: x.description, lot_code: x.lot_code, product_id: x.product_id }),
    effectiveFrom: new Date(x.effective_from).toISOString(),
    changedAt: new Date(x.changed_at).toISOString(),
    changedBy: x.changed_by,
    reason: x.reason,
  }));
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
