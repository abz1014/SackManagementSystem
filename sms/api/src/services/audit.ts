/**
 * Cross-cutting write audit (Phase 2 security hardening). One log for every
 * admin/config write in the app, independent of the versioned rule tables
 * (weight_rule, shift_rule, plausibility_rule, product_timeline) that already
 * carry their own changed_by/changed_at/reason — those answer "what is the
 * history of this one setting"; this answers "what has this person done,
 * across the whole app."
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

export async function recordAudit(
  pool: ConnectionPool,
  actorId: number,
  action: string,
  targetType: string,
  targetId: string | number | null,
  detail: string | null,
): Promise<void> {
  await pool
    .request()
    .input('actor', mssql.Int, actorId)
    .input('action', mssql.VarChar(40), action)
    .input('type', mssql.VarChar(40), targetType)
    .input('target', mssql.NVarChar(64), targetId == null ? null : String(targetId))
    .input('detail', mssql.NVarChar(1000), detail)
    .query(
      `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
       VALUES (@actor, @action, @type, @target, @detail)`,
    );
}

export interface AuditEntry {
  auditId: number;
  atUtc: string;
  actorId: number | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string | null;
}

export async function listAudit(pool: ConnectionPool, limit = 500): Promise<AuditEntry[]> {
  const r = await pool.request().input('n', mssql.Int, limit).query<{
    audit_id: number; at_utc: Date; actor_id: number | null; actor_name: string | null;
    action: string; target_type: string; target_id: string | null; detail: string | null;
  }>(
    `SELECT TOP (@n) a.audit_id, a.at_utc, a.actor_id, u.display_name AS actor_name,
            a.action, a.target_type, a.target_id, a.detail
     FROM sms.audit_log a
     LEFT JOIN sms.app_user u ON u.user_id = a.actor_id
     ORDER BY a.at_utc DESC, a.audit_id DESC`,
  );
  return r.recordset.map((x) => ({
    auditId: x.audit_id,
    atUtc: new Date(x.at_utc).toISOString(),
    actorId: x.actor_id,
    actorName: x.actor_name,
    action: x.action,
    targetType: x.target_type,
    targetId: x.target_id,
    detail: x.detail,
  }));
}
