/**
 * Acknowledge a standing DQ finding (Task W2-B, 29 Sep 2026, failure
 * analysis F-24) — migration 042's sms.dq_acknowledgement. See that
 * migration's header for why this is one row PER FINDING, not per check,
 * and shared/src/dqAck.ts for the allow-list this refuses against.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { isAcknowledgeableDqCheck } from '@sms/shared';

export type DqAckResult =
  | { ok: true; findingId: number; acknowledgedBy: number; acknowledgedUtc: string; reason: string }
  | { ok: false; code: 'NOT_FOUND'; message: string }
  | { ok: false; code: 'NOT_ALLOWED'; message: string }
  | { ok: false; code: 'ALREADY_ACKNOWLEDGED'; message: string };

/**
 * finding_id -> { checkName, ackedBy?, ackedUtc?, reason? }, for the
 * findings list to render "who acknowledged and when" — read alongside
 * sms.dq_finding, never in place of it.
 */
export interface DqAckInfo {
  findingId: number;
  acknowledgedBy: string | null;
  acknowledgedUtc: string;
  reason: string;
}

/**
 * finding_id -> ack info for every ACKNOWLEDGED finding currently in
 * sms.dq_finding (a finding row that has since aged out of the TOP-200
 * display window, or been superseded, is simply absent from the join the
 * caller does — this is a flat read of the ack table joined to app_user for
 * the display name). Returns an empty map, never throws, when the table
 * does not exist yet (migration 042 not applied) — same defensive shape as
 * dqBlockingFindings below, so a missing migration degrades a screen's
 * "who/when" detail rather than 500ing the whole findings list.
 */
export async function listDqAcknowledgements(pool: ConnectionPool): Promise<Map<number, DqAckInfo>> {
  const out = new Map<number, DqAckInfo>();
  try {
    const r = await pool.request().query<{
      finding_id: number;
      acknowledged_utc: Date;
      reason: string;
      display_name: string | null;
      username: string | null;
    }>(
      `SELECT a.finding_id, a.acknowledged_utc, a.reason, u.display_name, u.username
       FROM sms.dq_acknowledgement a
       LEFT JOIN sms.app_user u ON u.user_id = a.acknowledged_by`,
    );
    for (const row of r.recordset) {
      out.set(Number(row.finding_id), {
        findingId: Number(row.finding_id),
        acknowledgedBy: row.display_name ?? row.username ?? null,
        acknowledgedUtc: new Date(row.acknowledged_utc).toISOString(),
        reason: row.reason,
      });
    }
  } catch {
    // migration 042 not applied yet, or a transient read failure — an empty
    // map means "nothing acknowledged", the same as a genuinely clean table,
    // which is the correct degraded behaviour for a display-only join.
  }
  return out;
}

/**
 * Acknowledge one finding_id. Checks, in order: the finding exists
 * (404-shaped NOT_FOUND); its check_name is on the allow-list (409-shaped
 * NOT_ALLOWED — a system-state finding, or an unknown finding_id's check,
 * can never be silenced this way); it is not already acknowledged
 * (409-shaped ALREADY_ACKNOWLEDGED — acknowledging twice is not an error in
 * the finding's own state, but it IS in the caller's request, and silently
 * overwriting who/when/why an earlier engineer recorded would erase that
 * record for no reason). The INSERT itself relies on the PK on finding_id to
 * make double-acknowledgement race-safe even between the SELECT above and
 * the INSERT — a UNIQUE-violation from a concurrent request is treated the
 * same as the pre-check catching it.
 */
export async function acknowledgeDqFinding(
  pool: ConnectionPool,
  input: { findingId: number; actorId: number; reason: string },
): Promise<DqAckResult> {
  const found = await pool
    .request()
    .input('id', mssql.BigInt, input.findingId)
    .query<{ check_name: string }>(`SELECT check_name FROM sms.dq_finding WHERE finding_id = @id`);
  const row = found.recordset[0];
  if (!row) {
    return { ok: false, code: 'NOT_FOUND', message: `No DQ finding with id ${input.findingId}.` };
  }
  if (!isAcknowledgeableDqCheck(row.check_name)) {
    return {
      ok: false,
      code: 'NOT_ALLOWED',
      message: `'${row.check_name}' is a system-state check and cannot be acknowledged — only a data-fact finding can be.`,
    };
  }
  const existing = await pool
    .request()
    .input('id', mssql.BigInt, input.findingId)
    .query<{ n: number }>(`SELECT COUNT(*) AS n FROM sms.dq_acknowledgement WHERE finding_id = @id`);
  if (Number(existing.recordset[0]?.n ?? 0) > 0) {
    return { ok: false, code: 'ALREADY_ACKNOWLEDGED', message: 'This finding has already been acknowledged.' };
  }
  try {
    const ins = await pool
      .request()
      .input('id', mssql.BigInt, input.findingId)
      .input('by', mssql.Int, input.actorId)
      .input('reason', mssql.NVarChar(500), input.reason)
      .query<{ acknowledged_utc: Date }>(
        `INSERT INTO sms.dq_acknowledgement (finding_id, acknowledged_by, reason)
         OUTPUT inserted.acknowledged_utc
         VALUES (@id, @by, @reason)`,
      );
    const at = ins.recordset[0]!.acknowledged_utc;
    return {
      ok: true,
      findingId: input.findingId,
      acknowledgedBy: input.actorId,
      acknowledgedUtc: new Date(at).toISOString(),
      reason: input.reason,
    };
  } catch (err) {
    // A concurrent request won the race between our SELECT and this INSERT —
    // the PK on finding_id refuses the second row. Report it the same way
    // the pre-check above would have.
    if (err instanceof Error && /PK_dq_acknowledgement|violation of PRIMARY KEY/i.test(err.message)) {
      return { ok: false, code: 'ALREADY_ACKNOWLEDGED', message: 'This finding has already been acknowledged.' };
    }
    throw err;
  }
}
