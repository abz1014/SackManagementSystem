/** Connection-pool factory. Two logins: sms_app (app DB) + sms_readonly (IFL). */
import mssql from 'mssql';
import { createLogger } from '@sms/shared';
import { toMssqlConfig, type DbConfig } from './config.js';
import { isTransient } from './reader/errorClass.js';
import { withRetry } from './util/retry.js';

const log = createLogger('sync-worker');

export interface CreatePoolOptions {
  /**
   * Called on the pool's 'error' event. Default: one structured error line.
   * The API passes its own handler so it can also mark itself degraded.
   */
  onError?: (err: unknown) => void;
}

/**
 * Every pool gets an 'error' listener (roadmap Phase 11 item 3, 14 Sep 2026).
 * mssql's ConnectionPool is an EventEmitter and emits 'error' for pool-level
 * failures — a connection the server closed under it, a failed reconnect.
 * An EventEmitter 'error' with no listener is thrown, and neither process
 * had one: the worker would have died on the first such event instead of
 * logging it and reconnecting on the next tick (which it does anyway — each
 * pass opens fresh pools, see pass.ts), and the API would have died with it
 * rather than answering 'degraded'.
 */
export async function createPool(c: DbConfig, opts: CreatePoolOptions = {}): Promise<mssql.ConnectionPool> {
  const pool = new mssql.ConnectionPool(toMssqlConfig(c));
  pool.on(
    'error',
    opts.onError ??
      ((err: unknown) => {
        log.error('database pool error (the next pass reconnects)', {
          database: c.database,
          server: c.server,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
  );
  await pool.connect();
  return pool;
}

/**
 * The source (IFL) connection, with the reader's retry policy (roadmap Phase 2
 * item 2): three attempts, and only for failures a retry can cure — a socket
 * that dropped, a server that took too long to answer. A refused login or an
 * unknown host fails on the first attempt with its classification, because
 * trying it twice more with backoff only delays the halt row that tells the
 * operator what to fix. `connect` is injectable so the pass can be tested
 * without a server.
 */
export async function connectSource(
  c: DbConfig,
  connect: (c: DbConfig) => Promise<mssql.ConnectionPool> = createPool,
  onRetry?: (attempt: number, err: unknown) => void,
): Promise<mssql.ConnectionPool> {
  return withRetry(() => connect(c), { retries: 2, baseMs: 1000, retryOn: isTransient, onRetry });
}
