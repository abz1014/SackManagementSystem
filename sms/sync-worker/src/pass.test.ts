/**
 * Pool lifecycle of one supervised pass. The old entrypoint opened both pools
 * before its try/finally, so when the IFL open threw the app pool was never
 * closed — once per tick, for as long as the source stayed unreachable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { runPass, type PassDeps } from './pass.js';

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
});

const cfg = { app: { database: 'sms' }, iflData: { database: 'DATA_TP1U2' } } as never;

interface FakePool {
  name: string;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
}
function fakePool(name: string): FakePool {
  return { name, close: vi.fn<() => Promise<void>>(async () => undefined) };
}
const asPool = (p: FakePool) => p as unknown as ConnectionPool;

function deps(over: Partial<PassDeps> = {}): PassDeps & { app: FakePool; ifl: FakePool } {
  const app = fakePool('app');
  const ifl = fakePool('ifl');
  return {
    app,
    ifl,
    createPool: vi.fn(async (c: { database: string }) => asPool(c.database === 'sms' ? app : ifl)),
    runFullSync: vi.fn(async () => ({ reader: [], transform: [], productMirrorError: null, sourceProbeMs: 1 })),
    recordPassHalt: vi.fn(async () => undefined),
    ...over,
  };
}

describe('runPass — pools are closed on every path', () => {
  it('closes both after a successful pass', async () => {
    const d = deps();
    await runPass(cfg, d);
    expect(d.app.close).toHaveBeenCalledTimes(1);
    expect(d.ifl.close).toHaveBeenCalledTimes(1);
  });

  it('closes the app pool when the IFL pool cannot be opened — the leak', async () => {
    const d = deps();
    const app = d.app;
    d.createPool = vi.fn(async (c: { database: string }) => {
      if (c.database === 'sms') return asPool(app);
      throw new Error('getaddrinfo ENOTFOUND plant-sql');
    });
    await expect(runPass(cfg, d)).rejects.toThrow(/ENOTFOUND/);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('records the source-connection halt through the still-open app pool, then rethrows', async () => {
    const d = deps();
    const app = d.app;
    d.createPool = vi.fn(async (c: { database: string }) => {
      if (c.database === 'sms') return asPool(app);
      throw new Error('Login failed for user sms_readonly');
    });
    await expect(runPass(cfg, d)).rejects.toThrow(/Login failed/);
    expect(d.recordPassHalt).toHaveBeenCalledTimes(1);
    const [pool, , stage, err] = (d.recordPassHalt as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(pool).toBe(asPool(app));
    expect(stage).toBe('source connection');
    expect((err as Error).message).toMatch(/Login failed/);
    // The halt was written BEFORE the app pool was closed.
    expect((d.recordPassHalt as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      app.close.mock.invocationCallOrder[0]!,
    );
  });

  it('a failure to record the halt does not mask the connection error', async () => {
    const d = deps();
    const app = d.app;
    d.createPool = vi.fn(async (c: { database: string }) => {
      if (c.database === 'sms') return asPool(app);
      throw new Error('ECONNREFUSED');
    });
    d.recordPassHalt = vi.fn(async () => {
      throw new Error('sync_run is locked');
    });
    await expect(runPass(cfg, d)).rejects.toThrow(/ECONNREFUSED/);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('closes both when the sync itself throws', async () => {
    const d = deps({ runFullSync: vi.fn(async () => { throw new Error('gone backwards'); }) });
    await expect(runPass(cfg, d)).rejects.toThrow(/gone backwards/);
    expect(d.app.close).toHaveBeenCalledTimes(1);
    expect(d.ifl.close).toHaveBeenCalledTimes(1);
    // The runner records its own halts; the pass level must not add a second set.
    expect(d.recordPassHalt).not.toHaveBeenCalled();
  });

  it('opens the app pool first, so a source outage never even tries the source twice', async () => {
    const d = deps();
    await runPass(cfg, d);
    const order = (d.createPool as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { database: string }).database);
    expect(order).toEqual(['sms', 'DATA_TP1U2']);
  });
});

/**
 * The source connect has the reader's retry policy (roadmap Phase 2 item 2):
 * three attempts for a transient failure, one for anything else — and the
 * halt row carries the failure's class in front of the message.
 */
describe('runPass — the source connection is retried only when transient', () => {
  it('a refused login is tried once and recorded as [auth]', async () => {
    const d = deps();
    const app = d.app;
    const connect = vi.fn(async (c: { database: string }) => {
      if (c.database === 'sms') return asPool(app);
      throw Object.assign(new Error('Login failed for user sms_readonly'), { code: 'ELOGIN' });
    });
    d.createPool = connect;
    await expect(runPass(cfg, d)).rejects.toThrow(/Login failed/);
    expect(connect.mock.calls.filter((c) => c[0].database === 'DATA_TP1U2')).toHaveLength(1);
    const err = (d.recordPassHalt as ReturnType<typeof vi.fn>).mock.calls[0]![3] as Error;
    expect(err.message).toBe('[auth] Login failed for user sms_readonly');
  });

  it('a dropped socket is retried and the pass proceeds once it connects', async () => {
    const d = deps();
    const app = d.app;
    const ifl = d.ifl;
    let iflAttempts = 0;
    d.createPool = vi.fn(async (c: { database: string }) => {
      if (c.database === 'sms') return asPool(app);
      iflAttempts++;
      if (iflAttempts < 2) throw Object.assign(new Error('socket hang up'), { code: 'ESOCKET' });
      return asPool(ifl);
    });
    await runPass(cfg, d);
    expect(iflAttempts).toBe(2);
    expect(d.runFullSync).toHaveBeenCalledTimes(1);
    expect(d.recordPassHalt).not.toHaveBeenCalled();
  }, 10_000);
});
