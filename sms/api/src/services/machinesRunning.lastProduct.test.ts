/**
 * S3 F-1 (Stage 3, 11 Oct 2026): the product a winder was last running, for winders that are not running now.
 *
 * User impact: Product > Running listed a quiet, stale or silent winder with no product at all, so nobody could
 * see which product a stopped winder had last stamped. Owner constraint: derived at read time from sms.cone_event
 * only (no migration, no new column, no write). Real values below were measured on the read-only copy sms_audit
 * (newest reading 2026-09-07 12:00:28.860; S/stage3plan/out/f1_last.txt); here they are synthetic fixture rows.
 * Fake pool, so it runs without a database or a session.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';
import { invalidateLiveConfigCache } from './live.js';
import { getMachinesRunning } from './machinesRunning.js';

afterEach(() => invalidateLiveConfigCache());

const at = (s: string) => Date.parse(`${s}Z`);
const ANCHOR = at('2026-09-07T12:00:28.860');

const ROSTER = [3, 4, 7, 8, 14, 15].map((n) => ({ station_id: n, name: `Station ${n}`, machine_name: null, is_active: true }));

// Station 4 is running; 3 silent, 7 quiet, 8 stale (newest cone has no material), 14 stale, 15 never stamped.
const LAST_SEEN = [
  { st: 3, ms: at('2026-08-31T08:24:19.583') },
  { st: 4, ms: ANCHOR },
  { st: 7, ms: at('2026-09-07T03:47:21.277') },
  { st: 8, ms: at('2026-09-06T05:00:00.000') },
  { st: 14, ms: at('2026-09-03T13:55:55.723') },
  { st: 15, ms: at('2026-09-02T01:00:00.000') },
];
const WINDOW = [
  { st: 4, material_id: 21, product_name: 'Product 21', product_active: 1, cones: 40, on_material: 40, newest_ms: ANCHOR, since_ms: ANCHOR - 3600000, since_is_window_start: 1 },
];
const LAST_STAMPED = [
  { st: 3, material_id: 1021, product_name: 'P1021', product_active: 1, ms: at('2026-08-31T08:24:19.583') },
  { st: 7, material_id: 21, product_name: 'P21', product_active: 0, ms: at('2026-09-07T03:47:21.277') },
  { st: 8, material_id: 21, product_name: 'P21', product_active: 0, ms: at('2026-09-06T03:22:58.313') },
  { st: 14, material_id: 1022, product_name: null, product_active: null, ms: at('2026-09-03T13:55:55.723') },
];

function run(lastStamped: unknown[]) {
  const { pool, calls } = fakePositionalPool(ONE_REAL_GENERATION, [[{ ms: ANCHOR }], ROSTER, LAST_SEEN, WINDOW, lastStamped]);
  return getMachinesRunning(pool as ConnectionPool, 1, {}).then((data) => ({ data, calls }));
}

describe('getMachinesRunning - last product of a winder that is not running', () => {
  it('names the last stamped product and its time for quiet, stale and silent winders', async () => {
    const { data } = await run(LAST_STAMPED);
    const by = new Map(data.machines.map((m) => [m.station, m]));
    expect(by.get(3)).toMatchObject({ state: 'silent', lastMaterialId: 1021, lastStampedUtc: '2026-08-31T08:24:19.583Z', lastProductActive: true });
    expect(by.get(7)).toMatchObject({ state: 'quiet', lastMaterialId: 21, lastProductName: 'P21', lastProductActive: false, lastStampedUtc: '2026-09-07T03:47:21.277Z' });
    expect(by.get(14)).toMatchObject({ state: 'stale', lastMaterialId: 1022, lastProductName: 'Product 1022', lastProductActive: null });
  });

  it('keeps the newest stamped cone apart from the newest reading when the newest cone carries no product', async () => {
    const { data } = await run(LAST_STAMPED);
    const m8 = data.machines.find((m) => m.station === 8)!;
    expect(m8.lastSeenUtc).toBe('2026-09-06T05:00:00.000Z');
    expect(m8.lastStampedUtc).toBe('2026-09-06T03:22:58.313Z');
  });

  it('a winder with no stamped cone (July only) has no last product, and a running winder keeps its own product', async () => {
    const { data } = await run(LAST_STAMPED);
    const by = new Map(data.machines.map((m) => [m.station, m]));
    expect(by.get(15)).toMatchObject({ lastMaterialId: null, lastProductName: null, lastProductActive: null, lastStampedUtc: null });
    expect(by.get(4)).toMatchObject({ state: 'running', materialId: 21, lastMaterialId: null });
  });

  it('reads stamped cones only, in this generation, up to the anchor, with bound parameters', async () => {
    const { calls } = await run(LAST_STAMPED);
    const sql = calls[calls.length - 1]!.sql;
    expect(sql).toContain("attribution_method = 'source_column'");
    expect(sql).toContain('material_id IS NOT NULL');
    expect(sql).toContain('production_ts_utc_ms <= @end');
    expect(calls[calls.length - 1]!.params.get('end')).toBe(ANCHOR);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  });
});
