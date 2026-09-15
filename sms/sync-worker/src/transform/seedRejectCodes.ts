/**
 * Populate sms.reject_code with the distinct (type, tube, material) code pairs
 * actually present in reject_event — labels left NULL until IFL answers Q10.
 * Idempotent. Ensures the reject Pareto always has a lookup row to join to.
 *
 * PER LINE (roadmap Phase 5, 14 Sep 2026). Migration 028 gave reject_code a
 * line_id and re-keyed its unique index on (line, type, tube, material),
 * because a second line's scale may use the same numbers for different
 * faults — but this seed still inserted without a line and matched existing
 * rows without one, so on the day a second line is added its codes would
 * have landed on line 1's rows (the DEFAULT 1) or been skipped as "already
 * known" because line 1 had the same pair. The line is now the process's
 * configured line, the same value every canonical row is stamped with, and
 * both the INSERT and the NOT EXISTS carry it.
 *
 * ISNULL(..., -999) on both sides: a weight reject's pair is NULL/NULL on the
 * event and on its code row, and `NULL = NULL` is never true in SQL, so a
 * plain equality would re-insert the weight code on every pass and hit the
 * unique index.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export async function seedRejectCodes(pool: ConnectionPool, lineId: number): Promise<number> {
  const r = await pool.request().input('line', mssql.Int, lineId).query(`
    INSERT INTO sms.reject_code (line_id, reject_type, tube_code, material_code)
    SELECT DISTINCT re.line_id, re.reject_type, re.tube_inspect_code, re.material_inspect_code
    FROM sms.reject_event re
    WHERE re.line_id = @line
      AND NOT EXISTS (
        SELECT 1 FROM sms.reject_code rc
        WHERE rc.line_id = re.line_id
          AND rc.reject_type = re.reject_type
          AND ISNULL(rc.tube_code, -999)     = ISNULL(re.tube_inspect_code, -999)
          AND ISNULL(rc.material_code, -999) = ISNULL(re.material_inspect_code, -999)
      );
  `);
  return r.rowsAffected?.[0] ?? 0;
}
