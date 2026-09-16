/**
 * 16 Sep 2026 fix (defects 1 & 2, see CLAUDE.md task): the API used to call
 * `createPool` with no override and silently inherited the sync worker's
 * batch pool profile — 5 connections, a ten-minute requestTimeout — sized for
 * a single-threaded sync pass, not N concurrent interactive readers. These
 * pin the API's OWN profile (`apiPoolOptions`/`loadApiConfig`), its env
 * overrides, and that it is genuinely distinct from the worker's defaults —
 * plus the one shared `MAX_RANGE_DAYS` constant defect 2 unifies.
 */
import { describe, expect, it } from 'vitest';
import {
  loadApiConfig,
  apiPoolOptions,
  MAX_RANGE_DAYS,
  DEFAULT_DB_POOL_MAX,
  DEFAULT_DB_POOL_MIN,
  DEFAULT_DB_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_DB_REQUEST_TIMEOUT_MS,
} from './config.js';

// The sync worker's own batch defaults (sync-worker/src/config.ts's
// SYNC_POOL_DEFAULT / SYNC_REQUEST_TIMEOUT_MS), inlined rather than imported:
// that file is out of this task's touchable set to modify, and its own
// config.test.ts (sms/sync-worker/src/config.test.ts) already pins these
// exact values against the real exported constants. What matters here is
// only that the API's own profile is NOT this one.
const WORKER_POOL_DEFAULT = { max: 5, min: 0, idleTimeoutMillis: 30000 };
const WORKER_REQUEST_TIMEOUT_MS = 10 * 60_000;

const BASE: NodeJS.ProcessEnv = {
  APP_DB_SERVER: 'localhost',
  APP_DB_PORT: '14330',
  APP_DB_NAME: 'sms',
  APP_DB_USER: 'u',
  APP_DB_PASSWORD: 'p',
  APP_DB_ENCRYPT: 'false',
  APP_DB_TRUST_SERVER_CERTIFICATE: 'true',
};

describe('loadApiConfig / apiPoolOptions — the API pool profile', () => {
  it('defaults to 10/1/30000 pool + 30s requestTimeout — distinct from the sync worker', () => {
    const cfg = loadApiConfig(BASE);
    expect(cfg.dbPoolMax).toBe(10);
    expect(cfg.dbPoolMin).toBe(1);
    expect(cfg.dbPoolIdleTimeoutMs).toBe(30_000);
    expect(cfg.dbRequestTimeoutMs).toBe(30_000);

    const opts = apiPoolOptions(cfg);
    expect(opts).toEqual({ pool: { max: 10, min: 1, idleTimeoutMillis: 30_000 }, requestTimeout: 30_000 });
  });

  it('the API defaults are NOT the sync worker defaults (the bug this fixes)', () => {
    const apiOpts = apiPoolOptions(loadApiConfig(BASE));
    // Worker: 5 connections, 10-minute requestTimeout — batch-sized, wrong for the API.
    expect(apiOpts.pool.max).not.toBe(WORKER_POOL_DEFAULT.max);
    expect(apiOpts.pool.min).not.toBe(WORKER_POOL_DEFAULT.min);
    expect(apiOpts.requestTimeout).not.toBe(WORKER_REQUEST_TIMEOUT_MS);
    expect(apiOpts.requestTimeout).toBeLessThan(WORKER_REQUEST_TIMEOUT_MS);
  });

  it('every value is overridable by env, without a rebuild', () => {
    const cfg = loadApiConfig({
      ...BASE,
      API_DB_POOL_MAX: '25',
      API_DB_POOL_MIN: '5',
      API_DB_POOL_IDLE_TIMEOUT_MS: '60000',
      API_DB_REQUEST_TIMEOUT_MS: '15000',
    });
    expect(apiPoolOptions(cfg)).toEqual({ pool: { max: 25, min: 5, idleTimeoutMillis: 60000 }, requestTimeout: 15000 });
  });

  it('apiPoolOptions falls back to the DEFAULT_* constants when a hand-built ApiConfig omits the fields', () => {
    // Mirrors how test fixtures elsewhere (app.log.test.ts etc.) build an
    // ApiConfig literal by hand without every optional field set.
    const opts = apiPoolOptions({});
    expect(opts).toEqual({
      pool: { max: DEFAULT_DB_POOL_MAX, min: DEFAULT_DB_POOL_MIN, idleTimeoutMillis: DEFAULT_DB_POOL_IDLE_TIMEOUT_MS },
      requestTimeout: DEFAULT_DB_REQUEST_TIMEOUT_MS,
    });
  });
});

/**
 * Defect 2: MAX_RANGE_DAYS used to be defined separately in five places
 * (app.ts + routes/cone.ts, routes/rejects.ts, routes/reports.ts,
 * routes/sacks.ts) — all five agreed at 366 before this fix (no numeric
 * disagreement was found), but a change to one could silently diverge from
 * the other four. This pins the ONE exported definition; app.ts imports it
 * (see app.rangeCap.test.ts for app.ts's validateRange enforcing this exact
 * number). The four route files above are out of this task's scope (owned by
 * another worker) and still hold their own local `const MAX_RANGE_DAYS = 366`
 * — unified only in the two files this task was allowed to touch.
 */
describe('MAX_RANGE_DAYS — the one shared definition', () => {
  it('is 366, unchanged (unproven above the 53 days ever seen — see the comment on the constant)', () => {
    expect(MAX_RANGE_DAYS).toBe(366);
  });
});
