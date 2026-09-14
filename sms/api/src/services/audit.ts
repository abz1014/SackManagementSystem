/**
 * Cross-cutting write audit (Phase 2 security hardening). One log for every
 * admin/config write in the app, independent of the versioned rule tables
 * (weight_rule, shift_rule, plausibility_rule, product_timeline) that already
 * carry their own changed_by/changed_at/reason — those answer "what is the
 * history of this one setting"; this answers "what has this person done,
 * across the whole app."
 *
 * Two ways to write it, and the difference is the point:
 *
 *   recordAudit()   — a standalone INSERT on the pool. Fire-and-forget from
 *                     app.ts's audit() for events that are NOT configuration
 *                     (a login, an export, a product changeover already
 *                     versioned in its own table).
 *   auditedWrite()  — the change AND its audit row in ONE transaction. Every
 *                     configuration write goes through this: rules, line,
 *                     machines, stations, sources, reject codes, users.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

/**
 * Anything that hands out requests: a pool, or a transaction. The service
 * functions that write configuration take this rather than a ConnectionPool
 * so the same code runs inside auditedWrite's transaction (`tx`) or, for a
 * read, on the pool.
 */
export interface Db {
  request(): mssql.Request;
}

export interface AuditEntryInput {
  action: string;
  targetType: string;
  targetId: string | number | null;
  detail: string | null;
}

/** The INSERT itself, on whatever request source it is given. */
async function insertAudit(db: Db, actorId: number, e: AuditEntryInput): Promise<void> {
  await db
    .request()
    .input('actor', mssql.Int, actorId)
    .input('action', mssql.VarChar(40), e.action)
    .input('type', mssql.VarChar(40), e.targetType)
    .input('target', mssql.NVarChar(64), e.targetId == null ? null : String(e.targetId))
    .input('detail', mssql.NVarChar(1000), e.detail)
    .query(
      `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
       VALUES (@actor, @action, @type, @target, @detail)`,
    );
}

export async function recordAudit(
  pool: ConnectionPool,
  actorId: number,
  action: string,
  targetType: string,
  targetId: string | number | null,
  detail: string | null,
): Promise<void> {
  await insertAudit(pool, actorId, { action, targetType, targetId, detail });
}

/**
 * An audit row inside a transaction someone else owns. auditedWrite() uses it
 * for the primary row; a work function uses it when one change is honestly
 * two events (renaming a station AND re-linking it to another machine).
 */
export async function recordAuditIn(tx: mssql.Transaction, actorId: number, entry: AuditEntryInput): Promise<void> {
  await insertAudit(tx, actorId, entry);
}

/**
 * What a work function hands back. `result` is what the route answers with;
 * the rest is the audit row, decided AFTER the write, because the honest
 * "old -> new" is only known once OUTPUT deleted.* has come back, and a new
 * row's id is only known once the IDENTITY has been assigned.
 */
export interface AuditedOutcome<T> {
  result: T;
  /** Overrides entry.detail when given (undefined keeps entry.detail). */
  detail?: string | null;
  /** Overrides entry.targetId — the key of a row that did not exist before. */
  targetId?: string | number | null;
  /**
   * Nothing was changed (the row was not this line's, the id does not exist).
   * The transaction is rolled back and NO audit row is written: an audit
   * entry for a change that did not happen is the phantom the Aug 2026
   * audit found on PUT /stations/999, and it must not come back.
   */
  noop?: boolean;
}

/**
 * A configuration change and its audit row, committed together or not at all.
 *
 * WHY. Until 14 Sep 2026 every audit row was written by app.ts's audit(),
 * which is fire-and-forget by design (`void recordAudit(...).catch(log)`): the
 * change had already committed on its own request by the time the audit
 * INSERT was issued, so a failed INSERT — a dropped connection, a full log, a
 * table someone locked — left a rule change in force with no record of who
 * made it. ROADMAP-GAP-ANALYSIS.md §Security names it: "audit fire-and-forget
 * — a rule change can commit while its audit row fails." Roadmap Phase 1's
 * acceptance line is "configuration changes are audited where they affect
 * production calculations", and a log that can silently miss a row does not
 * meet it. So: one mssql.Transaction for the work and the audit INSERT;
 * either both land or neither does, and the failure reaches the caller as a
 * thrown error (a 500, not a 200 with a hole in the log).
 *
 * `pool.transaction()` and `tx.request()` are the same objects as
 * `new mssql.Transaction(pool)` and `new mssql.Request(tx)` (mssql
 * connection-pool.js:584, transaction.js:202); they are called as methods so
 * a test double can stand in for the pool without opening a connection.
 *
 * Isolation is the connection default (READ COMMITTED). These are single-row
 * configuration writes by one admin at a time; the unique indexes on
 * machine_no / username / station catch the race that matters, and the route
 * maps their violation to 409.
 */
export async function auditedWrite<T>(
  pool: ConnectionPool,
  actorId: number,
  entry: AuditEntryInput,
  work: (tx: mssql.Transaction) => Promise<AuditedOutcome<T>>,
): Promise<T> {
  const tx = pool.transaction();
  await tx.begin();
  let out: AuditedOutcome<T>;
  try {
    out = await work(tx);
    if (out.noop) {
      await tx.rollback();
      return out.result;
    }
    await recordAuditIn(tx, actorId, {
      action: entry.action,
      targetType: entry.targetType,
      targetId: out.targetId !== undefined ? out.targetId : entry.targetId,
      detail: out.detail !== undefined ? out.detail : entry.detail,
    });
    await tx.commit();
  } catch (err) {
    // A failed commit may already have rolled back server-side (ENOTBEGUN on
    // the second rollback); the original error is the one worth reporting.
    try {
      await tx.rollback();
    } catch {
      /* already rolled back */
    }
    throw err;
  }
  return out.result;
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
