/**
 *   sms user:create   --username=<u> --password=<p> --role=<operator|supervisor|manager|admin>
 *   sms user:password --username=<u> --password=<p>
 *
 * The second is the recovery path for a forgotten admin password (roadmap
 * Phase 11 item 1, 14 Sep 2026) — before it, the only way back into Setup
 * was a hand-minted argon2 hash and an UPDATE in SSMS. It revokes every
 * session of the account, because a reset that leaves a stolen session alive
 * has not reset anything, and writes the audit row with no actor (the CLI
 * has none; the detail says so).
 *
 * PASSWORD POLICY. PASSWORD_MIN_LENGTH (default 10) from .env — the same key
 * the API reads — replaces the "any non-empty string" this command accepted
 * and the literal 6 the API's create route used. Length only: IFL has not
 * stated a password policy (Phase 11 clarifications), and inventing
 * composition rules they did not ask for would be over-claiming.
 */
import mssql from 'mssql';
import argon2 from 'argon2';
import { openContext, parseArgs } from '../context.js';

const ROLES = new Set(['operator', 'supervisor', 'manager', 'admin']);

/** PASSWORD_MIN_LENGTH from the environment (loadDotEnv has run by the time openContext returns), default 10. */
export function passwordMinLength(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PASSWORD_MIN_LENGTH?.trim();
  if (!raw) return 10;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 6 && n <= 128 ? n : 10;
}

/** The reason a password is refused, or null. Mirrors api/src/services/admin.ts passwordPolicyProblem. */
export function passwordPolicyProblem(password: string, minLength: number): string | null {
  return password.length < minLength ? `The password must be at least ${minLength} characters.` : null;
}

export async function userCreate(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const username = String(a.username ?? '');
  const password = String(a.password ?? '');
  const role = String(a.role ?? 'operator');
  const display = typeof a.display === 'string' ? a.display : username;

  if (!username || !password) {
    console.error('usage: sms user:create --username=<u> --password=<p> --role=<role>');
    return 2;
  }
  if (!ROLES.has(role)) {
    console.error(`--role must be one of: ${[...ROLES].join(', ')}`);
    return 2;
  }

  const ctx = await openContext();
  try {
    const policy = passwordPolicyProblem(password, passwordMinLength());
    if (policy) {
      console.error(`REFUSED: ${policy} (PASSWORD_MIN_LENGTH in .env)`);
      return 2;
    }
    const hash = await argon2.hash(password);
    await ctx.app
      .request()
      .input('u', mssql.NVarChar(64), username)
      .input('h', mssql.NVarChar(256), hash)
      .input('d', mssql.NVarChar(128), display)
      .input('r', mssql.VarChar(20), role)
      .query(
        `INSERT INTO sms.app_user (username, password_hash, display_name, role_id)
         SELECT @u, @h, @d, role_id FROM sms.role WHERE name = @r`,
      );
    // The CLI has no signed-in actor; the row says the CLI did it.
    await ctx.app
      .request()
      .input('action', mssql.VarChar(40), 'user.create')
      .input('type', mssql.VarChar(40), 'user')
      .input('target', mssql.NVarChar(64), username)
      .input('detail', mssql.NVarChar(1000), `role ${role}; by the CLI (sms user:create), no signed-in actor`)
      .query(
        `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
         VALUES (NULL, @action, @type, @target, @detail)`,
      );
    console.log(`created user '${username}' (${role})`);
    return 0;
  } catch (err) {
    console.error('user:create failed:', err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await ctx.close();
  }
}

export async function userPassword(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const username = String(a.username ?? '');
  const password = String(a.password ?? '');
  if (!username || !password) {
    console.error('usage: sms user:password --username=<u> --password=<new password>');
    return 2;
  }

  const ctx = await openContext();
  try {
    const policy = passwordPolicyProblem(password, passwordMinLength());
    if (policy) {
      console.error(`REFUSED: ${policy} (PASSWORD_MIN_LENGTH in .env)`);
      return 2;
    }
    const who = await ctx.app
      .request()
      .input('u', mssql.NVarChar(64), username)
      .query<{ user_id: number }>(`SELECT user_id FROM sms.app_user WHERE username = @u`);
    const userId = who.recordset[0]?.user_id;
    if (userId == null) {
      console.error(`no such user: ${username}`);
      return 2;
    }
    const hash = await argon2.hash(password);
    // Hash, revocation and audit row in one transaction — the same rule the
    // API's reset route follows through auditedWrite.
    const tx = ctx.app.transaction();
    await tx.begin();
    try {
      await tx
        .request()
        .input('id', mssql.Int, userId)
        .input('h', mssql.NVarChar(256), hash)
        .query(`UPDATE sms.app_user SET password_hash = @h WHERE user_id = @id`);
      const revoked = await tx
        .request()
        .input('id', mssql.Int, userId)
        .query(`DELETE FROM sms.session WHERE user_id = @id`);
      const n = revoked.rowsAffected[0] ?? 0;
      await tx
        .request()
        .input('action', mssql.VarChar(40), 'user.password_reset')
        .input('type', mssql.VarChar(40), 'user')
        .input('target', mssql.NVarChar(64), String(userId))
        .input('detail', mssql.NVarChar(1000), `username ${username}; sessions revoked: ${n}; by the CLI (sms user:password), no signed-in actor`)
        .query(
          `INSERT INTO sms.audit_log (actor_id, action, target_type, target_id, detail)
           VALUES (NULL, @action, @type, @target, @detail)`,
        );
      await tx.commit();
      console.log(`password set for '${username}'; ${n} session(s) revoked`);
      return 0;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error('user:password failed:', err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await ctx.close();
  }
}
