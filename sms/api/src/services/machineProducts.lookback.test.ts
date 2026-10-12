/**
 * S3 F-2 (Stage 3, 11 Oct 2026): a product change at the very start of the period is reported.
 *
 * User impact: the machine-product report (and now the product, daily, shift and shift-production reports) listed only the
 * changes seen BETWEEN cells inside the period, so a winder whose first cone of the period already carried a new product
 * showed no change at all: one change in the 7 Sep day, three in the 11 Aug evening shift were missing two, and so on.
 * Owner constraint: derived at read time from sms.cone_event, nothing written. Values are synthetic copies of the real
 * rows measured on sms_audit (oracle S/stage3plan/out/f2_changes.txt). Fake pool, no database, no session.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';
import { foldCells, getMachineProductShifts } from './machineProducts.js';

const at = (s: string) => Date.parse(`${s}Z`);
const roster = new Map([3, 4, 5, 13].map((n) => [n, { station: n, stationName: `S${n}`, machineName: `M${n}` }]));
const row = (st: number, day: string, shift: string, m: number | null, first: string, last = first, cones = 10) => ({
  st, day, shift_code: shift, material_id: m, product_name: m == null ? null : `P${m}`, cones, first_ms: at(first), last_ms: at(last),
});

describe('foldCells - lookback to the cone before the period', () => {
  it('reports 1022 -> 20 at winder 13 on 7 Sep, timed at its first cone, from before the period', () => {
    const rows = [row(13, '2026-09-07', 'morning', 20, '2026-09-07T10:37:10.310', '2026-09-07T11:36:40.467', 120)];
    const { changes } = foldCells(rows, roster, new Map([[13, { materialId: 1022, productName: 'P1022' }]]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      station: 13, day: '2026-09-07', shift: 'morning', fromMaterialId: 1022, toMaterialId: 20,
      kind: 'between_shifts', fromBeforePeriod: true, firstUtc: '2026-09-07T10:37:10.310Z',
    });
  });

  it('11 Aug evening: winders 3, 4, 5 give the three changes in time order, none twice', () => {
    const rows = [
      row(3, '2026-08-11', 'evening', 1021, '2026-08-11T17:20:14.290', '2026-08-11T21:00:00.000', 69),
      row(4, '2026-08-11', 'evening', 21, '2026-08-11T14:05:00.000', '2026-08-11T20:03:00.000', 44),
      row(4, '2026-08-11', 'evening', 1021, '2026-08-11T20:03:28.827', '2026-08-11T21:50:00.000', 30),
      row(5, '2026-08-11', 'evening', 1021, '2026-08-11T17:48:09.570', '2026-08-11T21:00:00.000', 50),
    ];
    const before = new Map([3, 4, 5].map((n) => [n, { materialId: 21, productName: 'P21' }]));
    const { changes } = foldCells(rows, roster, before);
    expect(changes.map((c) => [c.station, c.firstUtc, c.fromBeforePeriod ?? false])).toEqual([
      [3, '2026-08-11T17:20:14.290Z', true],
      [5, '2026-08-11T17:48:09.570Z', true],
      [4, '2026-08-11T20:03:28.827Z', false],
    ]);
  });

  it('no change when the cone before the period carries the same product, or no product (July)', () => {
    const same = foldCells([row(13, '2026-09-07', 'morning', 20, '2026-09-07T10:37:10.310')], roster, new Map([[13, { materialId: 20, productName: 'P20' }]]));
    expect(same.changes).toHaveLength(0);
    const july = foldCells([row(13, '2026-07-03', 'morning', null, '2026-07-03T07:00:00.000')], roster, new Map([[13, { materialId: 21, productName: 'P21' }]]));
    expect(july.changes).toHaveLength(0);
  });

  it('with no lookback given it behaves exactly as before', () => {
    expect(foldCells([row(13, '2026-09-07', 'morning', 20, '2026-09-07T10:37:10.310')], roster).changes).toHaveLength(0);
  });
});

describe('getMachineProductShifts - the lookback read', () => {
  it('reads the newest stamped cone strictly before each winder\'s first cone, bound, in this generation, and reports the change', async () => {
    const station = [{ station_id: 13, name: 'S13', machine_name: 'M13', is_active: true }];
    const cells = [{ ...row(13, '2026-09-07', 'morning', 20, '2026-09-07T10:37:10.310', '2026-09-07T11:36:40.467', 120) }];
    const { pool, calls } = fakePositionalPool(ONE_REAL_GENERATION, [station, cells, [{ n: 0 }], [{ st: 13, material_id: 1022, product_name: 'P1022' }]]);
    const data = await getMachineProductShifts(pool as ConnectionPool, 1, { from: '2026-09-07', to: '2026-09-07' });
    const look = calls[calls.length - 1]!;
    expect(look.sql).toContain('material_id IS NOT NULL');
    expect(look.sql).toContain('c.production_ts_utc_ms < @lf0');
    expect(look.sql).toContain('ROW_NUMBER()');
    expect(look.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
    expect(look.params.get('lf0')).toBe(at('2026-09-07T10:37:10.310'));
    expect(look.params.get('ls0')).toBe(13);
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0]).toMatchObject({ fromMaterialId: 1022, toMaterialId: 20, fromBeforePeriod: true });
  });

  it('ignores a lone stray cone: the lookback candidate must have a neighbouring cone of the same winder within a day before it', async () => {
    // Real case: the September generation holds one clock-fault cone for winder 7 dated 2026-07-12 (24 days before the first real
    // cone, no cone near it). Taken as 'the product before the period' it printed a changeover that never happened (STR-RED #17 -> #21).
    const station = [{ station_id: 7, name: 'S7', machine_name: 'M7', is_active: true }];
    const cells = [{ ...row(7, '2026-08-05', 'evening', 21, '2026-08-05T14:52:50.597', '2026-08-05T20:00:00.000', 80) }];
    const { pool, calls } = fakePositionalPool(ONE_REAL_GENERATION, [station, cells, [{ n: 0 }], []]);
    const data = await getMachineProductShifts(pool as ConnectionPool, 1, { from: '2026-08-05', to: '2026-09-07' });
    const look = calls[calls.length - 1]!;
    expect(look.sql).toContain('LAG(');
    expect(look.sql).toContain('86400000');
    expect(data.changes).toHaveLength(0);
  });
});
