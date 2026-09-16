/**
 * The first reader of `sms.product_change` (UX Phase 6 Brief 3, 16 Sep 2026).
 *
 * The table has existed since migration 027 (widened by 036) and is written
 * in two places — `pdasWrite.ts`'s `recordChange` (every real PDAS write
 * attempt: create / set_active / update_limits / add_blend / add_count /
 * add_tube_type / create_pallet / set_pallet_active) and
 * `changeover.ts`'s `recordDisabledAttempt` (a whole-sequence changeover
 * attempted while `PDAS_WRITE_ENABLED` was false, recorded as
 * `outcome='disabled'` before any vendor proc could run) — but until this
 * file, nothing ever read it back: `grep product_change api/src cli/src`
 * turned up only writers, tests and comments.
 *
 * Keyset paging on `change_id` (the IDENTITY, monotone with insertion),
 * mirroring `services/audit.ts`'s `listAuditPage` exactly rather than
 * inventing a second paging idiom in the same codebase.
 *
 * `changed_at` and `effective_from` are APP-WRITTEN instants — genuine UTC,
 * not the plant wall clock (`api/src/services/plantClock.ts`'s header). The
 * caller renders them with the app-UTC formatter, never the plant-clock one.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export interface ProductChangeEntry {
  changeId: number;
  productId: number | null;
  palletId: number | null;
  procName: string | null;
  operation: string;
  outcome: string;
  pdasErrorCode: number | null;
  message: string | null;
  reason: string | null;
  /** app_user.display_name; null when changed_by is null or the account is gone. */
  changedByName: string | null;
  /** Genuine UTC (SYSUTCDATETIME() at INSERT time) — see the file header. */
  changedAtUtc: string;
  /** Genuine UTC; null until/unless PDAS accepted the write. */
  effectiveFromUtc: string | null;
}

export interface ProductChangePage {
  entries: ProductChangeEntry[];
  /** Pass back as `before` to fetch the next (older) page; null when this was the last page. */
  nextBefore: number | null;
}

interface Row {
  change_id: number;
  product_id: number | null;
  pallet_id: number | null;
  proc_name: string | null;
  operation: string;
  outcome: string;
  pdas_error_code: number | null;
  message: string | null;
  reason: string | null;
  changed_by_name: string | null;
  changed_at: Date;
  effective_from: Date | null;
}

function mapRow(x: Row): ProductChangeEntry {
  return {
    changeId: Number(x.change_id),
    productId: x.product_id == null ? null : Number(x.product_id),
    palletId: x.pallet_id == null ? null : Number(x.pallet_id),
    procName: x.proc_name,
    operation: x.operation,
    outcome: x.outcome,
    pdasErrorCode: x.pdas_error_code == null ? null : Number(x.pdas_error_code),
    message: x.message,
    reason: x.reason,
    changedByName: x.changed_by_name,
    changedAtUtc: new Date(x.changed_at).toISOString(),
    effectiveFromUtc: x.effective_from == null ? null : new Date(x.effective_from).toISOString(),
  };
}

/**
 * The newest `limit` rows, or the `limit` rows older than `before` — same
 * shape as `listAuditPage`. Parameterised throughout; no string
 * concatenation anywhere in this file (CLAUDE.md's SQL rule).
 */
export async function listProductChangePage(pool: ConnectionPool, opts: { limit?: number; before?: number | null } = {}): Promise<ProductChangePage> {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000);
  const r = await pool
    .request()
    .input('n', mssql.Int, limit + 1)
    .input('before', mssql.BigInt, opts.before ?? null)
    .query<Row>(
      `SELECT TOP (@n) c.change_id, c.product_id, c.pallet_id, c.proc_name, c.operation, c.outcome,
              c.pdas_error_code, c.message, c.reason, u.display_name AS changed_by_name,
              c.changed_at, c.effective_from
       FROM sms.product_change c
       LEFT JOIN sms.app_user u ON u.user_id = c.changed_by
       WHERE (@before IS NULL OR c.change_id < @before)
       ORDER BY c.change_id DESC`,
    );
  const rows = r.recordset.slice(0, limit).map(mapRow);
  const more = r.recordset.length > limit;
  return { entries: rows, nextBefore: more && rows.length ? rows[rows.length - 1]!.changeId : null };
}
