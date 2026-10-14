/**
 * The simulator's live loop once sat idle forever on a dropped SQL connection
 * (14 Oct 2026). These tests drive the watchdog helpers with fake promises;
 * no database is touched.
 */
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain .mjs script, no type declarations
import { withTimeout, backoffMs, recoverPool } from '../scripts/simulate-plant.mjs';

describe('simulate-plant watchdog', () => {
  it('rejects a promise that never settles', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'writeAll')).rejects.toThrow(/writeAll timed out/);
  });
  it('passes through a promise that settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
  it('backs off 5 s, 15 s, then caps at 30 s', () => {
    expect([1, 2, 3, 4, 9].map(backoffMs)).toEqual([5000, 15000, 30000, 30000, 30000]);
  });
  it('closes the dead pool, retries a failing reconnect, and returns the fresh state', async () => {
    const dead = { close: vi.fn(() => new Promise(() => {})) }; // close itself hangs
    const fresh = { close: vi.fn() };
    const connect = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(fresh);
    const loadState = vi.fn().mockResolvedValue({ ids: { cone: 5 } });
    const sleeps: number[] = [];
    const logs: string[] = [];
    vi.useFakeTimers();
    const p = recoverPool(
      { connect, loadState, sleep: async (ms: number) => { sleeps.push(ms); }, log: (m: string) => logs.push(m), opTimeoutMs: 100 },
      dead, 1,
    );
    await vi.advanceTimersByTimeAsync(6000); // let the hung close time out
    const r = await p;
    vi.useRealTimers();
    expect(r.pool).toBe(fresh);
    expect(r.state.ids.cone).toBe(5);
    expect(sleeps).toEqual([5000, 15000]);
    expect(logs[0]).toMatch(/reconnect failed: down/);
  });
});
