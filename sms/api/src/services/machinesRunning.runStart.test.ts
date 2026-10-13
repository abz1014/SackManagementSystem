/**
 * D4 (Oct 2026): each running winder reports when its current product run began and its last product change.
 * Derived at read time from sms.cone_event; the first cone of the new product is the only evidence of a changeover.
 * Fake pool (no database); positional responses: anchor, roster, last-seen, window, [F-1], run-start.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';
import { invalidateLiveConfigCache } from './live.js';
import { getMachinesRunning, RUN_LOOKBACK_MS } from './machinesRunning.js';

afterEach(() => invalidateLiveConfigCache());

const at = (s: string) => Date.parse(`${s}Z`);
const ANCHOR = at('2026-09-07T12:00:28.860');
const ROSTER = [4, 5, 6].map((n) => ({ station_id: n, name: `Station ${n}`, machine_name: null, is_active: true }));
const LAST_SEEN = [4, 5, 6].map((st) => ({ st, ms: ANCHOR }));
const win = (st: number) => ({ st, material_id: 21, product_name: 'P21', product_active: 1, cones: 40, on_material: 40, newest_ms: ANCHOR, since_ms: ANCHOR - 3600000, since_is_window_start: 1 });
const WINDOW = [win(4), win(5), win(6)];

const RUNS = [
  // 4: changed 3 days ago from 17 (run spans far beyond the 2 h window)
  { st: 4, first_ms: ANCHOR - 5 * 86400000, change_ms: ANCHOR - 3 * 86400000, prev_mat: 17, prev_name: 'P17', before_lb: 1 },
  // 5: no change, older cones exist before the lookback: lookback limit
  { st: 5, first_ms: ANCHOR - RUN_LOOKBACK_MS + 1000, change_ms: null, prev_mat: null, prev_name: null, before_lb: 1 },
  // 6: no change, nothing earlier in the generation: the true start
  { st: 6, first_ms: at('2026-09-05T06:00:00.000'), change_ms: null, prev_mat: null, prev_name: null, before_lb: 0 },
];

function run(opts: { asOfMs?: number | null } = {}, anchor = ANCHOR) {
  const { pool, calls } = fakePositionalPool(ONE_REAL_GENERATION, [[{ ms: anchor }], ROSTER, LAST_SEEN, WINDOW, RUNS]);
  return getMachinesRunning(pool as ConnectionPool, 1, opts).then((data) => ({ data, calls }));
}

describe('getMachinesRunning - run start and last change', () => {
  it('a run longer than the 2 h window reports its first cone and the change before it', async () => {
    const { data } = await run();
    const m = data.machines.find((x) => x.station === 4)!;
    expect(m.sinceIsWindowStart).toBe(true); // existing window semantics unchanged
    expect(m.runStartUtc).toBe(new Date(ANCHOR - 3 * 86400000).toISOString());
    expect(m.runStartIsLookbackLimit).toBe(false);
    expect(m.lastChange).toEqual({ fromMaterialId: 17, fromProductName: 'P17', atUtc: m.runStartUtc });
  });

  it('a run reaching the lookback limit says so and has no last change', async () => {
    const m = (await run()).data.machines.find((x) => x.station === 5)!;
    expect(m.runStartUtc).toBe(new Date(ANCHOR - RUN_LOOKBACK_MS + 1000).toISOString());
    expect(m.runStartIsLookbackLimit).toBe(true);
    expect(m.lastChange).toBeNull();
  });

  it('never changed in the generation: true start, not a limit, lastChange null', async () => {
    const m = (await run()).data.machines.find((x) => x.station === 6)!;
    expect(m.runStartUtc).toBe('2026-09-05T06:00:00.000Z');
    expect(m.runStartIsLookbackLimit).toBe(false);
    expect(m.lastChange).toBeNull();
  });

  it('a replay caps the read at the replay instant with bound parameters, one generation', async () => {
    const asOf = at('2026-09-06T10:00:00.000');
    const { data, calls } = await run({ asOfMs: asOf }, asOf);
    expect(data.asOfUtc).toBe(new Date(asOf).toISOString());
    const c = calls[calls.length - 1]!;
    expect(c.params.get('end')).toBe(asOf);
    expect(c.params.get('lb')).toBe(asOf - RUN_LOOKBACK_MS);
    expect(c.sql).toContain('production_ts_utc_ms <= @end');
    expect(c.sql).toContain('source_epoch');
    expect(c.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  });

  it('a winder that is not running carries no run start', async () => {
    const { pool } = fakePositionalPool(ONE_REAL_GENERATION, [[{ ms: ANCHOR }], ROSTER, LAST_SEEN, [win(4)], [], RUNS]);
    const data = await getMachinesRunning(pool as ConnectionPool, 1, {});
    const m5 = data.machines.find((x) => x.station === 5)!;
    expect(m5).toMatchObject({ quiet: true, runStartUtc: null, runStartIsLookbackLimit: false, lastChange: null });
  });
});
