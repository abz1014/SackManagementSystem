/**
 * C-119 (D-101, 2 Oct 2026): three exports carried plant-clock instants under
 * a `_utc` name and with an ISO `Z`: cone-weight and product
 * `target_in_force_at_utc`, machine-product `first_utc`/`last_utc`. D-38's
 * convention: a plant-clock instant goes in a `*_plant_time` column as
 * `YYYY-MM-DD HH:mm:ss`, no zone. JSON keys are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { coneWeightCsv, type ConeWeightReportData } from './coneWeight.js';
import { productCsv, PRODUCT_CSV_HEADERS, type ProductReportData } from './product.js';
import { machineProductCsv, MACHINE_PRODUCT_CSV_HEADERS, type MachineProductReportData } from './machineProduct.js';

const ISO_Z = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*Z/;
const WALL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('plant-clock instants in the exports', () => {
  it('cone-weight: the target instant is a target_in_force_at_plant_time row, wall-clock, no Z', () => {
    const d = {
      cones: 1, weighed: 1, implausible: 0, meanG: 1, medianG: 1, sdG: 0, minG: 1, maxG: 1, states: null, histogram: [], byStation: [],
      plausibility: { loG: 1500, hiG: 2100 },
      target: { setpointG: 1960, source: 'in_force_at_period_end', inForceAtUtc: '2026-08-18T10:24:59.930Z', inForceIsLowerBound: false, omittedReason: null, productActive: true },
    } as unknown as ConeWeightReportData;
    const rows = coneWeightCsv(d).rows;
    expect(rows.some((r) => r[1] === 'target_in_force_at_utc')).toBe(false);
    const row = rows.find((r) => r[1] === 'target_in_force_at_plant_time')!;
    expect(row).toBeDefined();
    expect(row[2]).toBe('2026-08-18 10:24:59');
    expect(String(row[2])).toMatch(WALL);
  });

  it('cone-weight: no target instant leaves the cell empty', () => {
    const d = {
      cones: 1, weighed: 1, implausible: 0, meanG: 1, medianG: 1, sdG: 0, minG: 1, maxG: 1, states: null, histogram: [], byStation: [],
      plausibility: { loG: 1500, hiG: 2100 },
      target: { setpointG: null, source: 'none', inForceAtUtc: null, inForceIsLowerBound: false, omittedReason: null, productActive: null },
    } as unknown as ConeWeightReportData;
    expect(coneWeightCsv(d).rows.find((r) => r[1] === 'target_in_force_at_plant_time')![2]).toBeNull();
  });

  it('product: the header is target_in_force_at_plant_time and the value is wall-clock, no Z', () => {
    expect(PRODUCT_CSV_HEADERS.some((h) => h.endsWith('_utc'))).toBe(false);
    const at = PRODUCT_CSV_HEADERS.indexOf('target_in_force_at_plant_time' as never);
    expect(at).toBeGreaterThan(-1);
    const d = {
      rows: [{
        productId: 1022, productLabel: 'p', cones: 1, conesInRangePct: 1, rejectedCones: 0, rejectRatePct: 0, sacks: 0, sackWeightKg: 0,
        weight: { n: 1, avgG: 1, sdG: 0, minG: 1, maxG: 1 }, states: { within: 1, low: 0, high: 0, rejected: 0, unknown: 0 }, implausible: 0,
        target: { setpointG: 1960, loG: 1900, hiG: 2000, inForceAtUtc: '2026-08-18T10:24:59.930Z', inForceIsLowerBound: false, limitsChangedInPeriod: 0 },
        vsTargetG: 0, targetOmittedReason: null, productActive: true,
      }],
    } as unknown as ProductReportData;
    const cell = productCsv(d).rows[0]![at];
    expect(cell).toBe('2026-08-18 10:24:59');
    expect(String(cell)).not.toMatch(ISO_Z);
  });

  it('machine-product: first/last are *_plant_time columns with wall-clock values, no Z', () => {
    expect(MACHINE_PRODUCT_CSV_HEADERS.some((h) => h.endsWith('_utc'))).toBe(false);
    const first = MACHINE_PRODUCT_CSV_HEADERS.indexOf('first_plant_time' as never);
    const last = MACHINE_PRODUCT_CSV_HEADERS.indexOf('last_plant_time' as never);
    expect(first).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(-1);
    const m = { materialId: 1022, cones: 5, firstUtc: '2026-08-18T10:24:59.000Z', lastUtc: '2026-08-18T13:01:02.000Z' };
    const d = {
      labels: {},
      rows: [{ station: 3, machineName: 'W3', cells: [{ day: '2026-08-18', shift: 'morning', changedDuringShift: false, materials: [m] }] }],
      changes: [{ station: 3, machineName: 'W3', day: '2026-08-18', shift: 'morning', firstUtc: '2026-08-18T11:00:00.000Z', fromMaterialId: 1, toMaterialId: 2, kind: 'x' }],
      products: [{ materialId: 1022, label: 'p', cones: 5, machines: 1, cells: 1, firstUtc: m.firstUtc, lastUtc: m.lastUtc }],
    } as unknown as MachineProductReportData;
    const rows = machineProductCsv(d).rows;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      for (const at of [first, last]) {
        if (r[at] == null) continue;
        expect(String(r[at])).toMatch(WALL);
        expect(String(r[at])).not.toMatch(ISO_Z);
      }
    }
    expect(rows[0]![first]).toBe('2026-08-18 10:24:59');
    expect(rows[0]![last]).toBe('2026-08-18 13:01:02');
  });
});
