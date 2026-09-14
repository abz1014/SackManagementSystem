/**
 * Cross-process mutual exclusion between the sync-worker's continuous 60s
 * transform pass and `sms rebuild`, which share the same canonical tables and
 * transform watermark keys (sms.app_config `transform_wm_*`). Nothing
 * coordinated them before this: a rebuild's canonical DELETE could run while
 * the service's own transform pass was mid-read of that same table, or the
 * two could race on ingest_seq / the UX_*_merge unique index. Confirmed
 * absent by grep (Sep 2026 audit, finding C1) — this is the fix.
 *
 * sp_getapplock is session-scoped: the connection that acquires the lock must
 * be the one that releases it, and the lock lives exactly as long as that
 * connection does. A pooled `ConnectionPool.request()` can be served by a
 * different underlying connection on every call, so this opens ONE dedicated
 * connection for the lifetime of the lock rather than borrowing from the
 * shared pool.
 *
 * LOCK_POOL is why that dedicated connection is also pinned. The shared pool
 * config is `{ max: 5, min: 0, idleTimeoutMillis: 30000 }`, and a lock
 * connection is IDLE for the whole time the work it is protecting runs — so
 * under that config the pool would reap it after 30 s, SQL Server would end
 * the session, and the lock would silently release mid-rebuild while the
 * rebuild still believed it held it. A full canonical rebuild takes far
 * longer than 30 s. `min: 1` keeps the reaper away from the only connection,
 * and `max: 1` guarantees acquire and release land on that same session
 * rather than merely usually doing so.
 */
import mssql from 'mssql';
import { toMssqlConfig, type DbConfig } from './config.js';

const RESOURCE = 'sms_transform_rebuild';
const LOCK_POOL = { max: 1, min: 1, idleTimeoutMillis: 24 * 60 * 60 * 1000 } as const;

export interface TransformLock {
  release(): Promise<void>;
}

/**
 * Block until the transform/rebuild lock is free, then hold it. Callers MUST
 * release it (use withTransformLock below rather than calling this directly
 * unless a bare acquire/release pair is unavoidable).
 */
export async function acquireTransformLock(
  appDb: DbConfig,
  timeoutMs = 60_000,
): Promise<TransformLock> {
  // requestTimeout must outlast @LockTimeout, or the wait is unreachable:
  // node-mssql defaults to 15 s, so a 60 s lock wait aborted client-side at
  // 15 s with a bare "Timeout: Request failed to complete in 15000ms" and the
  // caller never got the message this function crafts. A rebuild started
  // during an ordinary 20 s sync pass would have failed instead of waiting.
  const conn = new mssql.ConnectionPool({
    ...toMssqlConfig(appDb),
    pool: { ...LOCK_POOL },
    requestTimeout: timeoutMs + 30_000,
  });
  await conn.connect();
  let acquired = false;
  try {
    const result = await conn
      .request()
      .input('resource', mssql.VarChar(255), RESOURCE)
      .input('timeout', mssql.Int, timeoutMs)
      .query<{ result: number }>(
        `DECLARE @r INT;
         EXEC @r = sp_getapplock @Resource=@resource, @LockMode='Exclusive', @LockOwner='Session', @LockTimeout=@timeout;
         SELECT @r AS result;`,
      );
    const code = result.recordset[0]?.result ?? -999;
    // sp_getapplock: 0 = granted, 1 = granted after waiting, negative = failure/timeout/deadlock.
    if (code < 0) {
      throw new Error(
        `Could not acquire the transform/rebuild lock within ${timeoutMs}ms ` +
          `(sp_getapplock returned ${code}) — another sync pass or rebuild is ` +
          `already running. Try again shortly.`,
      );
    }
    acquired = true;
  } finally {
    // Same guard on the acquire path: a failing close() here would mask the
    // "could not acquire the lock" error that explains what actually happened.
    if (!acquired) await conn.close().catch(() => {});
  }
  return {
    release: async () => {
      try {
        await conn
          .request()
          .input('resource', mssql.VarChar(255), RESOURCE)
          .query(`EXEC sp_releaseapplock @Resource=@resource, @LockOwner='Session'`);
      } catch (err) {
        // Never throw out of a release: withTransformLock calls this from a
        // `finally`, so an error here would REPLACE whatever real failure the
        // protected work threw — the release would become the only thing the
        // operator ever saw. Closing the connection below ends the session,
        // which releases a session-scoped lock regardless, so the explicit
        // release failing is not itself a correctness problem.
        console.error(
          `[lock] sp_releaseapplock failed (the lock still releases when this connection closes): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      } finally {
        // Guarded for the same reason as the catch above: this sits in
        // withTransformLock's `finally`, so a rejecting close() would replace
        // the real error from the work it was protecting.
        await conn.close().catch((err) => {
          console.error(
            `[lock] closing the lock connection failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    },
  };
}

/** Acquire the lock, run `fn`, always release — even if `fn` throws. */
export async function withTransformLock<T>(appDb: DbConfig, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireTransformLock(appDb);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
