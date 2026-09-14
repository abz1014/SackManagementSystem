/**
 * Pool lifecycle of one supervised pass. The old entrypoint opened both pools
 * before its try/finally, so when the IFL open threw the app pool was never
 * closed — once per tick, for as long as the source stayed unreachable.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { runPass, type PassDeps } from './pass.js';

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
    runFullSync: vi.fn(async () => ({ reader: [], transform: [], productMirrorError: null })),
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
