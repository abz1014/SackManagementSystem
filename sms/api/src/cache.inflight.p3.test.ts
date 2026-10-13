import { describe, it, expect } from 'vitest';
import { TtlCache } from './cache.js';

/** Phase 3 (12 Oct 2026): identical concurrent cold requests share one load. */
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('TtlCache.getOrLoad', () => {
  it('concurrent callers for one key invoke the loader once; joiners are not hits', async () => {
    const c = new TtlCache<number>(5000);
    let calls = 0;
    const loader = async () => { calls++; await tick(); return 7; };
    const [a, b, d] = await Promise.all([c.getOrLoad('k', loader), c.getOrLoad('k', loader), c.getOrLoad('k', loader)]);
    expect(calls).toBe(1);
    expect([a.value, b.value, d.value]).toEqual([7, 7, 7]);
    expect([a.hit, b.hit, d.hit]).toEqual([false, false, false]);
    expect((await c.getOrLoad('k', loader)).hit).toBe(true);
    expect(calls).toBe(1);
  });

  it('a rejected load is shared by waiters, never cached, and the next call retries', async () => {
    const c = new TtlCache<number>(5000);
    let calls = 0;
    const bad = async () => { calls++; await tick(); throw new Error('down'); };
    const r = await Promise.allSettled([c.getOrLoad('k', bad), c.getOrLoad('k', bad)]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected']);
    expect(calls).toBe(1);
    const ok = await c.getOrLoad('k', async () => { calls++; return 1; });
    expect(ok).toEqual({ value: 1, hit: false });
    expect(calls).toBe(2);
  });

  it('ttl 0 never shares and never stores', async () => {
    const c = new TtlCache<number>(0);
    let calls = 0;
    const loader = async () => { calls++; await tick(); return 1; };
    await Promise.all([c.getOrLoad('k', loader), c.getOrLoad('k', loader)]);
    expect(calls).toBe(2);
    expect(c.size).toBe(0);
  });

  it('shouldCache false: value returned but not stored', async () => {
    const c = new TtlCache<number>(5000);
    let calls = 0;
    const loader = async () => { calls++; return 99; };
    await c.getOrLoad('k', loader, () => false);
    await c.getOrLoad('k', loader, () => false);
    expect(calls).toBe(2);
    expect(c.size).toBe(0);
  });
});
