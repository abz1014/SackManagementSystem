/**
 * Populate sms.reject_code with the distinct (type, tube, material) code pairs
 * actually present in reject_event — labels left NULL until IFL answers Q10.
 * Idempotent. Ensures the reject Pareto always has a lookup row to join to.
 */
import type { ConnectionPool } from 'mssql';

export async function seedRejectCodes(pool: ConnectionPool): Promise<void> {
  await pool.request().query(`
    INSERT INTO sms.reject_code (reject_type, tube_code, material_code)
    SELECT DISTINCT re.reject_type, re.tube_inspect_code, re.material_inspect_code
    FROM sms.reject_event re
    WHERE NOT EXISTS (
      SELECT 1 FROM sms.reject_code rc
      WHERE rc.reject_type = re.reject_type
        AND ISNULL(rc.tube_code, -999)     = ISNULL(re.tube_inspect_code, -999)
        AND ISNULL(rc.material_code, -999) = ISNULL(re.material_inspect_code, -999)
    );
  `);
}
