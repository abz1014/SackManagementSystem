/** `sms user:create --username=<u> --password=<p> --role=<operator|supervisor|manager|admin>` */
import mssql from 'mssql';
import argon2 from 'argon2';
import { openContext, parseArgs } from '../context.js';

const ROLES = new Set(['operator', 'supervisor', 'manager', 'admin']);

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
    console.log(`created user '${username}' (${role})`);
    return 0;
  } catch (err) {
    console.error('user:create failed:', err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await ctx.close();
  }
}
