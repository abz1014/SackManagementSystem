/**
 * Tests for the tenth report type — product by machine and shift
 * (reports/machineProduct.ts), IFL's key requirement in Hassan sb's own
 * example (15 Sep 2026): "at the morning shift machine 1 ran product A; the
 * engineer changes the product so the evening shift runs product B; reports
 * must show, per machine, which product ran in which shift."
 *
 * `getMachineProductReport` does no SQL of its own — it composes entirely
 * from machineProducts.ts's `getMachineProductShifts` — so, following the
 * idiom in reports/reports.test.ts:29 (mock the delegated service, drive the
 * composition with fixed answers), that one function is mocked here and the
 * pool passed through is never touched. `cellOrder`, which the report also
 * imports from the same module, is left real via the `importOriginal` spread
 * so the per-product totals sort correctly in the test as in production.
 *
 * `labelMaterials` and `machineProductCsv` are pure and are tested directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../machineProducts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../machineProducts.js')>();
  return { ...actual, getMachineProductShifts: vi.fn() };
});

import { getMachineProductShifts, type MachineShiftCell, type ShiftMaterial, type MachineProductShiftsData } from '../machineProducts.js';
import {
  getMachineProductReport,
  labelMaterials,
  machineProductCsv,
  MACHINE_PRODUCT_CSV_HEADERS,
  NO_PRODUCT_LABEL,
  type MachineProductReportData,
} from './machineProduct.js';
import { FILTERS_BY_TYPE } from './common.js';
import type { ResolvedPeriod } from '../report.js';

/* ------------------------------------------------------------- fixtures */

const PERIOD: ResolvedPeriod = { period: 'custom', from: '2026-09-10', to: '2026-09-11' };
const DUMMY_POOL = {} as ConnectionPool;

const material = (over: Partial<ShiftMaterial> = {}): ShiftMaterial => ({
  materialId: 5, productName: 'Blend A', cones: 10,
  firstUtc: '2026-09-10T01:00:00.000Z', lastUtc: '2026-09-10T02:00:00.000Z',
  ...over,
});

const cell = (over: Partial<MachineShiftCell> = {}): MachineShiftCell => ({
  station: 1, stationName: 'Station 1', machineName: 'Machine 1',
  day: '2026-09-10', shift: 'morning',
  materials: [material()], dominantMaterialId: 5, cones: 10, changedDuringShift: false,
  ...over,
});

function mockShifts(data: Partial<MachineProductShiftsData> = {}): void {
  vi.mocked(getMachineProductShifts).mockResolvedValue({
    from: PERIOD.from, to: PERIOD.to, shift: null,
    stations: [], cells: [], changes: [], conesWithoutStation: 0,
    ...data,
  });
}

beforeEach(() => {
  vi.mocked(getMachineProductShifts).mockReset();
});

/* ------------------------------------------------------- getMachineProductReport */

describe('getMachineProductReport — columns', () => {
  it('with no shift filter, every production day gets one column per shift, in shift order', async () => {
    mockShifts();
    const d = await getMachineProductReport(DUMMY_POOL, 1, PERIOD, {});
    expect(d.columns.map((c) => `${c.day}|${c.shift}`)).toEqual([
      '2026-09-10|morning', '2026-09-10|evening', '2026-09-10|night',
      '2026-09-11|morning', '2026-09-11|evening', '2026-09-11|night',
    ]);
    expect(getMachineProductShifts).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ shift: null, station: null }));
  });

  it('a shift filter narrows every day to its one column', async () => {
    mockShifts();
    const d = await getMachineProductReport(DUMMY_POOL, 1, PERIOD, { shift: 'night' });
    expect(d.columns).toEqual([
      { day: '2026-09-10', shift: 'night', cones: 0 },
      { day: '2026-09-11', shift: 'night', cones: 0 },
    ]);
    expect(getMachineProductShifts).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ shift: 'night' }));
  });
});

describe('getMachineProductReport — station filter', () => {
  it('is passed through to the derivation, which narrows the roster to that one machine', async () => {
    mockShifts({ stations: [{ station: 7, stationName: 'S7', machineName: 'M7' }] });
    const d = await getMachineProductReport(DUMMY_POOL, 1, PERIOD, { station: 7 });
    expect(getMachineProductShifts).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ station: 7 }));
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]!.station).toBe(7);
  });
});

describe('getMachineProductReport — absence vs zero', () => {
  it('a machine that weighed nothing in a cell gets null there, never 0', async () => {
    mockShifts({
      stations: [
        { station: 1, stationName: 'S1', machineName: 'M1' },
        { station: 2, stationName: 'S2', machineName: 'M2' }, // never appears in cells: quiet the whole period
      ],
      cells: [cell({ station: 1, day: '2026-09-10', shift: 'morning', cones: 10 })],
    });
    const d = await getMachineProductReport(DUMMY_POOL, 1, PERIOD, {});

    const quiet = d.rows.find((r) => r.station === 2)!;
    // The literal assertion: absence is the value null, not the number 0.
    expect(quiet.cells[0]).toBeNull();
    expect(quiet.cells[0]).not.toBe(0);
    expect(quiet.cells.every((c) => c === null)).toBe(true);
    expect(quiet.cones).toBe(0);

    const busy = d.rows.find((r) => r.station === 1)!;
    expect(busy.cells[0]).not.toBeNull();
    expect(busy.cells[0]!.cones).toBe(10);
  });
});

describe('getMachineProductReport — distinct materials', () => {
  it('materials counts distinct materials per machine, not the number of cells it ran in', async () => {
    mockShifts({
      stations: [{ station: 1, stationName: 'S1', machineName: 'M1' }],
      cells: [
        cell({ station: 1, day: '2026-09-10', shift: 'morning', materials: [material({ materialId: 5 })] }),
        cell({ station: 1, day: '2026-09-10', shift: 'evening', materials: [material({ materialId: 5 })] }), // same material again
        cell({ station: 1, day: '2026-09-11', shift: 'morning', materials: [material({ materialId: 9 })] }),
      ],
    });
    const d = await getMachineProductReport(DUMMY_POOL, 1, PERIOD, {});
    // Three cells, but only two distinct materials (5 and 9).
    expect(d.rows[0]!.materials).toBe(2);
  });

  it('does not count the unattributed (no material_id) bucket as a product', async () => {
    mockShifts({
      stations: [{ station: 1, stationName: 'S1', machineName: 'M1' }],
      cells: [
        cell({ station: 1, day: '2026-09-10', shift: 'morning', materials: [material({ materialId: 5 })] }),
        // Pre-2026-08-05 unattributed cones: no product recorded, not a second product.
        cell({ station: 1, day: '2026-09-10', shift: 'evening', materials: [material({ materialId: null, productName: null })] }),
      ],
    });
    const d = await getMachineProductReport(DUMMY_POOL, 1, PERIOD, {});
    expect(d.rows[0]!.materials).toBe(1);
  });
});

/* ------------------------------------------------------------- labelMaterials */

describe('labelMaterials', () => {
  it('appends the material id only when its description is shared by more than one material', () => {
    const cells: MachineShiftCell[] = [
      cell({ station: 1, materials: [material({ materialId: 24, productName: '205-IL0-SD' })] }),
      cell({ station: 1, materials: [material({ materialId: 31, productName: '205-IL0-SD' })] }),
      cell({ station: 1, materials: [material({ materialId: 40, productName: 'Unique Blend' })] }),
    ];
    const labels = labelMaterials(cells);
    // Six materials share one description on this line (machineProduct.ts's
    // own docstring) — this is that case, not a contrived one.
    expect(labels['24']).toBe('205-IL0-SD #24');
    expect(labels['31']).toBe('205-IL0-SD #31');
    expect(labels['40']).toBe('Unique Blend');
  });

  it('labels a reading with no material as "No product on the reading", and a material with no name as "Product <id>"', () => {
    const cells: MachineShiftCell[] = [
      cell({ station: 1, materials: [material({ materialId: null, productName: null })] }),
      cell({ station: 1, materials: [material({ materialId: 50, productName: null })] }),
    ];
    const labels = labelMaterials(cells);
    expect(labels['none']).toBe(NO_PRODUCT_LABEL);
    expect(labels['50']).toBe('Product 50');
  });
});

/* ----------------------------------------------------------- machineProductCsv */

describe('machineProductCsv', () => {
  it('is one "section" column plus the union of the cell/change/product tables, one row per material-cell, change and product', () => {
    const data: MachineProductReportData = {
      period: PERIOD,
      filters: {},
      columns: [{ day: '2026-09-10', shift: 'morning', cones: 10 }],
      rows: [{
        station: 1, stationName: 'S1', machineName: 'M1',
        cells: [cell({ station: 1, day: '2026-09-10', shift: 'morning', materials: [material({ materialId: 5, productName: 'Blend A', cones: 10 })], cones: 10 })],
        cones: 10, materials: 1,
      }],
      changes: [{
        station: 1, machineName: 'M1', day: '2026-09-10', shift: 'evening',
        fromMaterialId: 5, fromProductName: 'Blend A', toMaterialId: 9, toProductName: null,
        firstUtc: '2026-09-10T14:05:00.000Z', kind: 'within_shift',
      }],
      products: [{
        materialId: 5, label: 'Blend A', cones: 10, machines: 1, cells: 1,
        firstUtc: '2026-09-10T01:00:00.000Z', lastUtc: '2026-09-10T02:00:00.000Z',
      }],
      labels: { '5': 'Blend A' }, // material 9 deliberately absent: exercises the labelOf fallback
      conesWithoutStation: 0, machinesWeighing: 1,
      note: 'x',
    };

    const t = machineProductCsv(data);
    expect(t.headers).toEqual(MACHINE_PRODUCT_CSV_HEADERS);
    expect(t.rows.map((r) => r[0])).toEqual(['cell', 'change', 'product']);
    for (const row of t.rows) expect(row).toHaveLength(t.headers.length);

    expect(t.rows[0]).toEqual([
      'cell', 1, 'M1', '2026-09-10', 'morning', 5, 'Blend A', 10, '2026-09-10T01:00:00.000Z', '2026-09-10T02:00:00.000Z',
      false, null, null, null, null, null, null, null,
    ]);
    expect(t.rows[1]).toEqual([
      'change', 1, 'M1', '2026-09-10', 'evening', null, null, null, '2026-09-10T14:05:00.000Z', null,
      null, 5, 'Blend A', 9, 'Product 9', 'within_shift', null, null,
    ]);
    expect(t.rows[2]).toEqual([
      'product', null, null, null, null, 5, 'Blend A', 10, '2026-09-10T01:00:00.000Z', '2026-09-10T02:00:00.000Z',
      null, null, null, null, null, null, 1, 1,
    ]);
  });
});

/* ------------------------------------------------------------------ contract */

describe('the machine-product report contract (FILTERS_BY_TYPE)', () => {
  it('accepts shift and station, and specifically not product — a hidden product filter would misreport the shift', () => {
    expect(FILTERS_BY_TYPE['machine-product']).toEqual(['shift', 'station']);
    expect(FILTERS_BY_TYPE['machine-product']).not.toContain('product');
  });
});
