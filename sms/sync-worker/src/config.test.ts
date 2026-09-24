/**
 * The three numeric env keys used to go through a bare `Number()`, and NaN
 * passed every guard downstream: `Math.max(5, NaN)` is NaN and Node runs a
 * NaN `setTimeout` delay as 1 ms, so a typo in SYNC_INTERVAL_SECONDS turned
 * the 60 s loop into a tight loop against both databases, silently. These pin
 * that a bad value refuses to start and names the key, and that the defaults
 * and legitimate values still load.
 */
import { describe, expect, it } from 'vitest';
import { loadSyncConfig, toMssqlConfig, SYNC_REQUEST_TIMEOUT_MS, SYNC_POOL_DEFAULT, type DbConfig } from './config.js';

const BASE: NodeJS.ProcessEnv = {
  APP_DB_SERVER: 'localhost',
  APP_DB_PORT: '14330',
  APP_DB_NAME: 'sms',
  APP_DB_USER: 'u',
  APP_DB_PASSWORD: 'p',
  APP_DB_ENCRYPT: 'false',
  APP_DB_TRUST_SERVER_CERTIFICATE: 'true',
  IFL_DB_SERVER: 'localhost',
  IFL_DB_PORT: '14330',
  IFL_DB_NAME_DATA: 'DATA_TP1U2_SEP07',
  IFL_DB_USER: 'u',
  IFL_DB_PASSWORD: 'p',
  IFL_DB_ENCRYPT: 'false',
  IFL_DB_TRUST_SERVER_CERTIFICATE: 'true',
};

describe('loadSyncConfig — numeric keys', () => {
  it('applies the documented defaults when the keys are absent or blank', () => {
    const c = loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '' });
    expect(c.lineId).toBe(1);
    expect(c.overlapRows).toBe(500);
    expect(c.intervalSeconds).toBe(60);
    // WS-PERF3, Job 2: the PDAS mirror's full-read backstop, 10 minutes by default.
    expect(c.pdasMirrorRefreshSeconds).toBe(600);
  });

  it('reads a configured PDAS_MIRROR_REFRESH_SECONDS and refuses a bad one', () => {
    expect(loadSyncConfig({ ...BASE, PDAS_MIRROR_REFRESH_SECONDS: '120' }).pdasMirrorRefreshSeconds).toBe(120);
    expect(() => loadSyncConfig({ ...BASE, PDAS_MIRROR_REFRESH_SECONDS: '2' })).toThrow(/at least 5/);
    expect(() => loadSyncConfig({ ...BASE, PDAS_MIRROR_REFRESH_SECONDS: 'soon' })).toThrow(/PDAS_MIRROR_REFRESH_SECONDS must be a whole number/);
  });

  it('reads legitimate values, including a zero overlap', () => {
    const c = loadSyncConfig({ ...BASE, LINE_ID: '2', SYNC_OVERLAP_ROWS: '0', SYNC_INTERVAL_SECONDS: ' 30 ' });
    expect(c.lineId).toBe(2);
    expect(c.overlapRows).toBe(0);
    expect(c.intervalSeconds).toBe(30);
  });

  it('refuses a non-numeric interval instead of running a tight loop', () => {
    expect(() => loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '6O' })).toThrow(/SYNC_INTERVAL_SECONDS must be a whole number/);
    expect(() => loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '1.5' })).toThrow(/whole number/);
  });

  it('enforces the 5 s interval floor the old Math.max meant to', () => {
    expect(() => loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '2' })).toThrow(/at least 5/);
    expect(loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '5' }).intervalSeconds).toBe(5);
  });

  it('refuses a non-numeric or negative overlap', () => {
    expect(() => loadSyncConfig({ ...BASE, SYNC_OVERLAP_ROWS: 'five hundred' })).toThrow(/SYNC_OVERLAP_ROWS/);
    expect(() => loadSyncConfig({ ...BASE, SYNC_OVERLAP_ROWS: '-1' })).toThrow(/at least 0/);
  });

  it('refuses a non-positive LINE_ID — every row is stamped with it', () => {
    expect(() => loadSyncConfig({ ...BASE, LINE_ID: '0' })).toThrow(/LINE_ID must be at least 1/);
    expect(() => loadSyncConfig({ ...BASE, LINE_ID: 'one' })).toThrow(/LINE_ID must be a whole number/);
  });
});

/**
 * 16 Sep 2026 fix (defect 1): the API used to call sync-worker's `createPool`
 * with no override and silently inherited the worker's batch profile — 5
 * connections, a ten-minute requestTimeout. `toMssqlConfig` now takes an
 * `overrides` parameter the API supplies (api/src/config.ts's
 * `apiPoolOptions`); these pin that (a) the worker's OWN callers — pass.ts,
 * sync-worker/index.ts, the CLI — get byte-identical config to before this
 * parameter existed, since none of them pass overrides, and (b) a caller that
 * does pass overrides gets exactly what it asked for, not a partial merge
 * that silently keeps a worker default it meant to replace.
 */
describe('toMssqlConfig — pool/requestTimeout overrides', () => {
  const DB: DbConfig = {
    server: 'localhost',
    port: 1433,
    database: 'sms',
    user: 'u',
    password: 'p',
    encrypt: false,
    trustServerCertificate: true,
  };

  it('with no overrides, reproduces the worker batch defaults exactly', () => {
    const cfg = toMssqlConfig(DB);
    expect(cfg.pool).toEqual(SYNC_POOL_DEFAULT);
    expect(cfg.pool).toEqual({ max: 5, min: 0, idleTimeoutMillis: 30000 });
    expect(cfg.requestTimeout).toBe(SYNC_REQUEST_TIMEOUT_MS);
    expect(cfg.requestTimeout).toBe(10 * 60_000);
  });

  it('a full pool override replaces every field, and requestTimeout independently', () => {
    const cfg = toMssqlConfig(DB, { pool: { max: 10, min: 1, idleTimeoutMillis: 30000 }, requestTimeout: 30_000 });
    expect(cfg.pool).toEqual({ max: 10, min: 1, idleTimeoutMillis: 30000 });
    expect(cfg.requestTimeout).toBe(30_000);
  });

  it('a partial pool override merges onto the worker defaults, field by field', () => {
    const cfg = toMssqlConfig(DB, { pool: { max: 20 } });
    expect(cfg.pool).toEqual({ max: 20, min: 0, idleTimeoutMillis: 30000 });
    // requestTimeout untouched when the override does not mention it.
    expect(cfg.requestTimeout).toBe(SYNC_REQUEST_TIMEOUT_MS);
  });

  it('every other field (server/database/user/options) is unaffected by overrides', () => {
    const withOverride = toMssqlConfig(DB, { pool: { max: 1 }, requestTimeout: 1 });
    const withoutOverride = toMssqlConfig(DB);
    expect(withOverride.server).toBe(withoutOverride.server);
    expect(withOverride.database).toBe(withoutOverride.database);
    expect(withOverride.user).toBe(withoutOverride.user);
    expect(withOverride.options).toEqual(withoutOverride.options);
  });
});
