/** Connection-pool factory. Two logins: sms_app (app DB) + sms_readonly (IFL). */
import mssql from 'mssql';
import { toMssqlConfig, type DbConfig } from './config.js';
import { isTransient } from './reader/errorClass.js';
import { withRetry } from './util/retry.js';

export async function createPool(c: DbConfig): Promise<mssql.ConnectionPool> {
  const pool = new mssql.ConnectionPool(toMssqlConfig(c));
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
