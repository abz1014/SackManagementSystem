/**
 * COMMIT 3, optional app-level test (Task T1, 28 Sep 2026): `createApp` sets
 * the dev-only live-scope policy from `cfg.liveSimulator?.enabled` on EVERY
 * call, not just the process's first one — `live.ts`'s policy flag is
 * module-level, so a later `createApp` in the same process (concretely: the
 * next test file in this suite) must not inherit whatever a PREVIOUS
 * `createApp` call left behind. No HTTP round trip needed: `createApp`
 * itself calls `setLiveScopeIncludesSimulator` as its first line, before any
 * route is mounted or any request is served.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { createApp } from './app.js';
import { liveScopeIncludesSimulator } from './services/live.js';
import type { ApiConfig } from './config.js';

const BASE_CFG: ApiConfig = {
  port: 0,
  lineId: 1,
  lineName: 'Test line',
  liveAllowAsOf: false,
  cacheTtlSeconds: 0,
  trustProxy: false,
  appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
  pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
};

// createApp mounts routes but issues no query at construction time — a pool
// that is never actually called is a legitimate fake for this test.
const dummyPool = {} as unknown as ConnectionPool;

describe('createApp — sets the live-scope policy on every call', () => {
  it('a flag-on config turns the policy on', () => {
    createApp(dummyPool, { ...BASE_CFG, liveSimulator: { requested: true, enabled: true, disabledReason: null } });
    expect(liveScopeIncludesSimulator()).toBe(true);
  });

  it('a following createApp with no liveSimulator field resets the policy to off', () => {
    createApp(dummyPool, BASE_CFG);
    expect(liveScopeIncludesSimulator()).toBe(false);
  });

  it('a following createApp with liveSimulator explicitly disabled also resets it', () => {
    createApp(dummyPool, { ...BASE_CFG, liveSimulator: { requested: true, enabled: true, disabledReason: null } });
    expect(liveScopeIncludesSimulator()).toBe(true);
    createApp(dummyPool, { ...BASE_CFG, liveSimulator: { requested: true, enabled: false, disabledReason: 'refused' } });
    expect(liveScopeIncludesSimulator()).toBe(false);
  });
});
