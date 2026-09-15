/**
 * Tests for machineProducts.ts — the derivation behind IFL's key requirement
 * (Hassan sb, 15 Sep 2026): "at the morning shift machine 1 ran product A;
 * the engineer changes the product so the evening shift runs product B;
 * reports must show, per machine, which product ran in which shift."
 *
 * Two things are pinned directly on the pure exports, without a database:
 *  - cellOrder must sort shifts chronologically (morning < evening < night),
 *    not alphabetically ('evening' < 'morning' < 'night' by string compare) —
 *    a lazy `.sort()` on `shift` would pass every other test here and still
 *    misorder the matrix.
 *  - foldCells must keep two materials that ran in one shift in RUN order
 *    (first reading first), not id order — the report and the screen both
 *    read `materials[0]` as "what the shift started with".
 *
 * getMachineProductShifts itself is exercised against a recording fake pool
 * (the idiom in reports/reports.test.ts:29 and weightStations.test.ts) to
 * pin that shift/station/tsTo are bound parameters, never concatenated into
 * the WHERE clause, and that the no-station count query is skipped — not
 * just answered with a zero — once a station filter already narrows the
 * main query to that one machine.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { cellOrder, foldCells, getMachineProductShifts } from './machineProducts.js';

/* ------------------------------------------------------------- cellOrder */

describe('cellOrder — chronological, not alphabetical', () => {
  it('sorts shifts morning < evening < night within a day', () => {
    const cells = [
      { day: '2026-09-10', shift: 'evening' as const },
      { day: '2026-09-10', shift: 'night' as const },
      { day: '2026-09-10', shift: 'morning' as const },
    ];
    expect([...cells].sort(cellOrder).map((c) => c.shift)).toEqual(['morning', 'evening', 'night']);
  });

  it('is NOT the alphabetical order — evening must not sort before morning', () => {
    const cells = [
      { day: '2026-09-10', shift: 'evening' as const },
      { day: '2026-09-10', shift: 'morning' as const },
      { day: '2026-09-10', shift: 'night' as const },
    ];
    const chronological = [...cells].sort(cellOrder).map((c) => c.shift);
    const alphabetical = [...cells].sort((a, b) => a.shift.localeCompare(b.shift)).map((c) => c.shift);
    // Alphabetically 'evening' < 'morning' < 'night' — exactly the wrong order.
    expect(alphabetical).toEqual(['evening', 'morning', 'night']);
    expect(chronological).toEqual(['morning', 'evening', 'night']);
    expect(chronological).not.toEqual(alphabetical);
  });

  it('orders by day first, regardless of which shift each row carries', () => {
    const cells = [
      { day: '2026-09-11', shift: 'morning' as const },
      { day: '2026-09-10', shift: 'night' as const },
    ];
    expect([...cells].sort(cellOrder).map((c) => c.day)).toEqual(['2026-09-10', '2026-09-11']);
  });
});

/* -------------------------------------------------------------- foldCells */

describe('foldCells', () => {
  const roster = new Map([[7, { station: 7, stationName: 'Station 7', machineName: 'Machine 7' }]]);

  it('keeps two materials that ran in one shift in RUN order, not id order', () => {
    const rows = [
      // Material 99 has the LOWER first_ms (ran first) but the HIGHER id.
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 99, product_name: 'B', cones: 10, first_ms: 1_000, last_ms: 2_000 },
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 5, product_name: 'A', cones: 20, first_ms: 3_000, last_ms: 4_000 },
    ];
    const { cells } = foldCells(rows, roster);
    expect(cells).toHaveLength(1);
    // Run order: 99 then 5. Id order (the bug this guards against) would be [5, 99].
    expect(cells[0]!.materials.map((m) => m.materialId)).toEqual([99, 5]);
    expect(cells[0]!.changedDuringShift).toBe(true);
    expect(cells[0]!.cones).toBe(30);
  });

  it('on a tie in cone count, the dominant material is the one running LATER, not the first one seen', () => {
    const rows = [
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 5, product_name: 'A', cones: 15, first_ms: 1_000, last_ms: 2_000 },
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 9, product_name: 'B', cones: 15, first_ms: 3_000, last_ms: 4_000 },
    ];
    const { cells } = foldCells(rows, roster);
    expect(cells[0]!.dominantMaterialId).toBe(9);
  });

  it('records a within_shift change for each step along the shift’s material list', () => {
    const rows = [
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 5, product_name: 'A', cones: 10, first_ms: 1_000, last_ms: 2_000 },
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 9, product_name: 'B', cones: 12, first_ms: 3_000, last_ms: 4_000 },
    ];
    const { changes } = foldCells(rows, roster);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      station: 7, day: '2026-09-10', shift: 'morning',
      fromMaterialId: 5, toMaterialId: 9, kind: 'within_shift',
      firstUtc: new Date(3_000).toISOString(),
    });
  });

  it('records a between_shifts change from the END of one cell to the START of the next, for consecutive cells at the same station', () => {
    const rows = [
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 5, product_name: 'A', cones: 10, first_ms: 1_000, last_ms: 2_000 },
      { st: 7, day: '2026-09-10', shift_code: 'evening', material_id: 9, product_name: 'B', cones: 12, first_ms: 30_000, last_ms: 40_000 },
    ];
    const { changes } = foldCells(rows, roster);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      station: 7, day: '2026-09-10', shift: 'evening',
      fromMaterialId: 5, toMaterialId: 9, kind: 'between_shifts',
      firstUtc: new Date(30_000).toISOString(),
    });
  });

  it('reports no change when consecutive cells at a station share the same material', () => {
    const rows = [
      { st: 7, day: '2026-09-10', shift_code: 'morning', material_id: 5, product_name: 'A', cones: 10, first_ms: 1_000, last_ms: 2_000 },
      { st: 7, day: '2026-09-10', shift_code: 'evening', material_id: 5, product_name: 'A', cones: 12, first_ms: 30_000, last_ms: 40_000 },
    ];
    const { changes } = foldCells(rows, roster);
    expect(changes).toHaveLength(0);
  });
});

/* --------------------------------------------- getMachineProductShifts */

interface Captured { sql: string; params: Map<string, unknown> }

function fakePool(answer: (sql: string, params: Map<string, unknown>) => Record<string, unknown>[] = () => []): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { params.set(name, v); return req; },
        query: async (sql: string) => { calls.push({ sql, params }); return { recordset: answer(sql, params) }; },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

describe('getMachineProductShifts — SQL shape', () => {
  it('binds shift, station and tsTo as parameters, never concatenated into the WHERE clause, and skips the no-station count once a station filter already narrows the query', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM sms.station')) return [{ station_id: 7, name: 'S7', machine_name: 'M7', is_active: true }];
      if (sql.includes('FROM sms.cone_event c')) return [];
      return [];
    });

    const tsTo = '2026-09-07T12:00:00.000Z';
    const data = await getMachineProductShifts(pool, 1, {
      from: '2026-09-01', to: '2026-09-07', shift: 'evening', station: 7, tsTo,
    });

    const main = calls.find((c) => c.sql.includes('FROM sms.cone_event c'))!;
    expect(main.sql).toContain('c.shift_code = @shift');
    expect(main.sql).toContain('c.source_station = @station');
    expect(main.sql).toContain('c.production_ts_utc_ms <= @tsTo');
    // The values themselves must never appear literally in the SQL text.
    expect(main.sql).not.toContain('evening');
    expect(main.sql).not.toMatch(/=\s*7\b/);
    expect(main.params.get('shift')).toBe('evening');
    expect(main.params.get('station')).toBe(7);
    expect(main.params.get('tsTo')).toBe(new Date(tsTo).getTime());

    // A station filter narrows the main query to one machine already, so the
    // separate "cones with no station at all" count is skipped, not queried
    // and merely answered with a zero.
    expect(calls.some((c) => c.sql.includes('source_station IS NULL'))).toBe(false);
    expect(data.conesWithoutStation).toBe(0);
  });

  it('counts cones with no station only when no station filter is given', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM sms.station')) return [];
      if (sql.includes('source_station IS NULL')) return [{ n: 3 }];
      return [];
    });
    const data = await getMachineProductShifts(pool, 1, { from: '2026-09-01', to: '2026-09-07' });
    expect(calls.some((c) => c.sql.includes('source_station IS NULL'))).toBe(true);
    expect(data.conesWithoutStation).toBe(3);
  });
});
