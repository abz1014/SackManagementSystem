/**
 * 16 Sep 2026 fix (defect 1): `createPool`'s `opts.pool` / `opts.requestTimeout`
 * must reach `mssql.ConnectionPool`'s constructor unchanged — that is the
 * whole mechanism by which the API (api/src/index.ts, via
 * api/src/config.ts's `apiPoolOptions`) replaces the worker's batch pool
 * profile. `mssql` is mocked so this runs with no real database: only the
 * config object handed to `new ConnectionPool(...)` is asserted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbConfig } from './config.js';

const configs: unknown[] = [];

vi.mock('mssql', () => {
  class FakeConnectionPool {
    cfg: unknown;
    constructor(cfg: unknown) {
      this.cfg = cfg;
      configs.push(cfg);
    }
    on(): this {
      return this;
    }
    async connect(): Promise<this> {
      return this;
    }
  }
  return { default: { ConnectionPool: FakeConnectionPool } };
});

const DB: DbConfig = {
  server: 'localhost',
  port: 1433,
  database: 'sms',
  user: 'u',
  password: 'p',
  encrypt: false,
  trustServerCertificate: true,
};

afterEach(() => {
  configs.length = 0;
});

describe('createPool — pool/requestTimeout overrides reach the mssql config', () => {
  it('with no opts, the worker batch defaults are used (5/0/10 min)', async () => {
    const { createPool } = await import('./db.js');
    await createPool(DB);
    const cfg = configs.at(-1) as { pool: { max: number; min: number }; requestTimeout: number };
    expect(cfg.pool).toEqual({ max: 5, min: 0, idleTimeoutMillis: 30000 });
    expect(cfg.requestTimeout).toBe(10 * 60_000);
  });

  it('an interactive-profile caller (the API) gets exactly what it passed, not the worker defaults', async () => {
    const { createPool } = await import('./db.js');
    await createPool(DB, {
      pool: { max: 10, min: 1, idleTimeoutMillis: 30000 },
      requestTimeout: 30_000,
    });
    const cfg = configs.at(-1) as { pool: { max: number; min: number; idleTimeoutMillis: number }; requestTimeout: number };
    expect(cfg.pool).toEqual({ max: 10, min: 1, idleTimeoutMillis: 30000 });
    expect(cfg.requestTimeout).toBe(30_000);
  });

  it('opts.onError is registered but never changes the pool config', async () => {
    const { createPool } = await import('./db.js');
    const onError = vi.fn();
    await createPool(DB, { onError, requestTimeout: 5_000 });
    const cfg = configs.at(-1) as { requestTimeout: number };
    expect(cfg.requestTimeout).toBe(5_000);
  });
});
