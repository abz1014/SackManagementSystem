/** Connection-pool factory. Two logins: sms_app (app DB) + sms_readonly (IFL). */
import mssql from 'mssql';
import { toMssqlConfig, type DbConfig } from './config.js';

export async function createPool(c: DbConfig): Promise<mssql.ConnectionPool> {
  const pool = new mssql.ConnectionPool(toMssqlConfig(c));
  await pool.connect();
  return pool;
}
