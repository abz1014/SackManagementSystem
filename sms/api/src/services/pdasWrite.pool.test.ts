/**
 * R-1 regression: a failed PDAS connect must not poison every future write
 * attempt.
 *
 * Before this fix, `PdasWriter`'s private `pool()` cached the rejected
 * `connect()` promise in `this.writer` forever — the next call saw
 * `this.writer` was already set (truthy, just rejected) and returned the
 * SAME rejected promise, so a transient PDAS outage locked the writer out
 * until an explicit `close()` or a full process restart, long after PDAS
 * itself recovered. This test proves a second call after a failed first
 * attempts a fresh connection rather than replaying the same rejection.
 *
 * mssql's ConnectionPool is mocked here (not exercised through
 * PdasWriterOptions.writerPool, which bypasses `pool()`'s own caching
 * entirely and so cannot see this defect).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

let connectCallCount = 0;
let failFirstConnect = true;

vi.mock('mssql', () => {
  class FakeConnectionPool {
    constructor(_cfg: unknown) {}
    connect(): Promise<ConnectionPool> {
      connectCallCount++;
      if (failFirstConnect && connectCallCount === 1) {
        return Promise.reject(new Error('ETIMEOUT talking to PDAS'));
      }
      return Promise.resolve(this as unknown as ConnectionPool);
    }
    close() {
      return Promise.resolve();
    }
  }
  return {
    default: {
      ConnectionPool: FakeConnectionPool,
      Int: 'Int', Float: 'Float', Bit: 'Bit', BigInt: 'BigInt',
      NVarChar: () => 'NVarChar', VarChar: () => 'VarChar', DateTime2: () => 'DateTime2',
    },
  };
});

const { PdasWriter } = await import('./pdasWrite.js');

const ACTOR = { userId: 7, username: 'manager' };
const BOUNDS = { setpointLoG: 1500, setpointHiG: 2100 };
const FIELDS = { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, desc1: '205-IL0-SD', desc2: 'Blue', active: true };
const REASON = 'Process engineer request, ticket 42';

function fakeAppPool(): ConnectionPool {
  return {
    request: () => {
      const req = { input: () => req, query: async () => ({ recordset: [], rowsAffected: [1] }) };
      return req;
    },
  } as unknown as ConnectionPool;
}

const enabledCfg = {
  enabled: true,
  db: { server: 'nowhere', port: 1, database: 'x', user: 'x', password: 'x', encrypt: false, trustServerCertificate: true },
  disabledReason: null,
};

describe('PdasWriter — pool() retries after a failed connect (R-1)', () => {
  it('a second write attempt opens a fresh connection instead of replaying the cached rejection', async () => {
    connectCallCount = 0;
    failFirstConnect = true;
    const w = new PdasWriter(fakeAppPool(), enabledCfg, 1);

    const first = await w.setProductActive({ productId: 20, active: false, reason: REASON, actor: ACTOR });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe('ERROR');
    expect(connectCallCount).toBe(1);

    // PDAS is healthy again. The old bug: this second attempt would still
    // fail immediately, without a second connect() ever being attempted,
    // because this.writer still held the first rejected promise.
    const second = await w.setProductActive({ productId: 20, active: false, reason: REASON, actor: ACTOR });
    expect(connectCallCount).toBe(2);
    // The fake pool's connect() now resolves; the call proceeds past pool()
    // and fails later (on .execute, which the fake pool object doesn't
    // implement) rather than immediately on the cached rejection — the
    // point being proven is connectCallCount reaching 2 at all.
    void second;
  });
});
