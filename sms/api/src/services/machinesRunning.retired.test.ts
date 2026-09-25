/**
 * RT-018 (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md): `getMachinesRunning`
 * feeds both Line's per-machine grid and Product › Running's pivot. It now
 * carries PDAS's own `MaterialActive` (mirrored to `sms.product.active_flag`)
 * through as `productActive`, sourced from the same `LEFT JOIN sms.product p`
 * the plain product name already comes from. Same fake-pool idiom as
 * machinesRunning.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';
import { invalidateLiveConfigCache } from './live.js';
import { getMachinesRunning } from './machinesRunning.js';

function fakePool(...responses: unknown[][]): ConnectionPool {
  return fakePositionalPool(ONE_REAL_GENERATION, responses).pool;
}

afterEach(() => {
  invalidateLiveConfigCache();
});

const ANCHOR = Date.UTC(2026, 8, 7, 12, 0, 0);
const ROSTER = [
  { station_id: 1, name: 'Station 1', machine_name: 'M1', is_active: true },
  { station_id: 2, name: 'Station 2', machine_name: 'M2', is_active: true },
];

describe('getMachinesRunning — RT-018 retired-material flag', () => {
  it('carries product_active through as productActive: false for a retired material, true for an active one', async () => {
    const lastSeen = [
      { st: 1, ms: ANCHOR },
      { st: 2, ms: ANCHOR },
    ];
    const windowRows = [
      // Station 1 is running MaterialId 17 — real dev-copy fact: retired in
      // PDAS (MaterialActive = 0) yet still carrying a production row.
      { st: 1, material_id: 17, product_name: 'STR-RED', product_active: false, cones: 5, on_material: 5, newest_ms: ANCHOR, since_ms: ANCHOR, since_is_window_start: 1 },
      { st: 2, material_id: 18, product_name: 'STR-BLUE', product_active: true, cones: 5, on_material: 5, newest_ms: ANCHOR, since_ms: ANCHOR, since_is_window_start: 1 },
    ];
    const pool = fakePool([{ ms: ANCHOR }], ROSTER, lastSeen, windowRows);

    const data = await getMachinesRunning(pool, 1, {});
    const byStation = new Map(data.machines.map((m) => [m.station, m]));

    expect(byStation.get(1)?.materialId).toBe(17);
    expect(byStation.get(1)?.productActive).toBe(false);
    expect(byStation.get(2)?.productActive).toBe(true);
  });

  it('a material with no sms.product row at all (LEFT JOIN NULL) is neither dropped nor duplicated — the station still appears once, with productActive null', async () => {
    // Real shape: `LEFT JOIN sms.product p ON p.product_id = n.material_id`,
    // p.product_id is the table's own PK, so this is a 1:0..1 join and can
    // neither fan a station out into extra rows nor drop it when the
    // material has no mirror row yet (a MaterialId synced by cone_event
    // before seedProducts has mirrored it, or a material PDAS never sent).
    const lastSeen = [{ st: 1, ms: ANCHOR }];
    const windowRows = [
      { st: 1, material_id: 999, product_name: null, product_active: null, cones: 5, on_material: 5, newest_ms: ANCHOR, since_ms: ANCHOR, since_is_window_start: 1 },
    ];
    const pool = fakePool([{ ms: ANCHOR }], [ROSTER[0]], lastSeen, windowRows);
    const data = await getMachinesRunning(pool, 1, {});
    expect(data.machines.length).toBe(1);
    const m = data.machines[0]!;
    expect(m.station).toBe(1);
    expect(m.materialId).toBe(999);
    expect(m.productActive).toBeNull();
  });

  it('a quiet machine with no material running carries productActive: null, never a stale flag from a prior material', async () => {
    const pool = fakePool(
      [{ ms: ANCHOR }],
      [{ station_id: 9, name: 'Station 9', machine_name: null, is_active: true }],
      [],
      [],
    );
    const data = await getMachinesRunning(pool, 1, {});
    const m = data.machines.find((x) => x.station === 9);
    expect(m?.quiet).toBe(true);
    expect(m?.productActive).toBeNull();
  });
});
