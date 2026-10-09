/**
 * C-005 (owner option A, 7 Oct 2026; DEFECTS.md D-181): the Product report with a station
 * filter must not print sack figures. Sacks carry no winder, so production.ts drops the station
 * filter for sacks and the report used to show the whole line's sacks per product beside a
 * single winder's cones (and kept products that ran no cone on that winder, only because their
 * sacks exist). Values below are the real measurements on the read-only copy (11 Aug 2026,
 * evening shift, station 4: product 20 -> 0 cones / 20 sacks; 21 -> 44 / 43; 1021 -> 69 / 0;
 * 113 cones, 4 rejects and 63 sacks in all) written as synthetic fixture rows.
 * Runs without a database: getProduction is stubbed, the report's own two queries run on a fake pool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../production.js')>();
  return { ...actual, getProduction: vi.fn() };
});
vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn() };
});
vi.mock('../coneState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../coneState.js')>();
  return { ...actual, loadStateContext: vi.fn() };
});

import { getProduction } from '../production.js';
import { loadProductCatalogue } from '../productLimits.js';
import { loadStateContext } from '../coneState.js';
import { getProductReport, productCsv, PRODUCT_CSV_HEADERS } from './product.js';
import { reportNotesOf } from './notes.js';

const PERIOD = { period: 'custom' as const, from: '2026-08-11', to: '2026-08-11' };

function fakePool(): ConnectionPool {
  return {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          if (sql.includes('GROUP BY source_epoch') || sql.includes('FROM sms.source_epoch')) return { recordset: [], rowsAffected: [0] };
          if (sql.includes('STDEV')) {
            return { recordset: [
              { grp: '21', n: 44, avg: 1951, sd: 12, mn: 1920, mx: 1985, excluded: 0 },
              { grp: '1021', n: 69, avg: 1962, sd: 10, mn: 1930, mx: 1990, excluded: 0 },
            ], rowsAffected: [0] };
          }
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

const row = (group: string, cones: number, rejectedCones: number, sacks: number, sackWeightKg: number, conesPerSack: number | null) => ({
  group, cones, rejectedCones, sacks, sackWeightKg, conesInRangePct: 98, avgSackKg: sacks ? Math.round((sackWeightKg / sacks) * 10) / 10 : null, conesPerSack,
});
// getProduction as the real service answers a station filter: cones narrowed to the winder, sacks NOT.
const STATION_4_ROWS = [row('20', 0, 0, 20, 946, 0), row('21', 44, 1, 43, 2025.9, 1), row('1021', 69, 3, 0, 0, null)];
const NO_STATION_ROWS = [row('20', 532, 15, 20, 946, 26.6), row('21', 1103, 14, 43, 2025.9, 25.7), row('1021', 278, 37, 0, 0, null)];

beforeEach(() => {
  vi.mocked(getProduction).mockReset();
  vi.mocked(loadProductCatalogue).mockReset();
  vi.mocked(loadStateContext).mockReset();
  vi.mocked(loadStateContext).mockResolvedValue({ plausibility: { loG: 1500, hiG: 2100 }, windows: [] } as never);
  vi.mocked(loadProductCatalogue).mockResolvedValue({
    product: (id: number) => ({ productId: id, label: 'P', activeFlag: true }),
    distinctLabel: (id: number) => `Product ${id}`,
    versionAt: () => null,
    versionsAscending: () => [],
    limitsAt: () => null,
    latest: () => null,
    productIds: () => [20, 21, 1021],
    isEmpty: false,
  } as never);
});

function stubProduction(rows: ReturnType<typeof row>[], ofSacksNone = 0) {
  vi.mocked(getProduction).mockResolvedValue({
    groupBy: 'product', rows, unattributed: null, states: null, implausible: null, dataIssues: [], ofSacksNone,
  } as never);
}

describe('C-005: Product report under a station filter', () => {
  it('prints no sack figure, keeps only products that ran a cone on that winder, and says why', async () => {
    stubProduction(STATION_4_ROWS);
    const d = await getProductReport(fakePool(), 1, PERIOD, { shift: 'evening', station: 4 });
    expect(d.rows.map((r) => r.productId)).toEqual([21, 1021]);
    for (const r of d.rows) {
      expect(r.sacks).toBeNull();
      expect(r.sackWeightKg).toBeNull();
      expect(r.avgSackKg).toBeNull();
      expect(r.conesPerSack).toBeNull();
      expect(r.sacksPassedScalePct ?? null).toBeNull();
    }
    expect(d.sacksOmitted).toBe(true);
    expect(d.sackNote).toContain('station 4');
    expect(d.unattributed.sacks).toBeNull();
    expect(d.unattributed.ofSacks).toBeNull();
    // cone figures are unchanged
    expect(d.rows[0]).toMatchObject({ cones: 44, rejectedCones: 1 });
    expect(d.rows[1]).toMatchObject({ cones: 69, rejectedCones: 3 });
  });

  it('control: without a station the sack figures and the sack-only product stay', async () => {
    stubProduction(NO_STATION_ROWS);
    const d = await getProductReport(fakePool(), 1, PERIOD, { shift: 'evening' });
    expect(d.rows.map((r) => r.productId)).toEqual([20, 21, 1021]);
    expect(d.rows[0]!.sacks).toBe(20);
    expect(d.sacksOmitted).toBeFalsy();
    expect(d.sackNote ?? null).toBeNull();
    expect(d.unattributed.ofSacks).toBe(63);
  });

  it('the CSV prints blank sack columns, never 0', async () => {
    stubProduction(STATION_4_ROWS);
    const d = await getProductReport(fakePool(), 1, PERIOD, { station: 4 });
    const t = productCsv(d);
    const iSacks = t.headers.indexOf('sacks');
    const iKg = t.headers.indexOf('sack_weight_kg');
    expect(iSacks).toBeGreaterThan(-1);
    expect(t.headers).toEqual(PRODUCT_CSV_HEADERS);
    for (const r of t.rows) {
      expect(r[iSacks]).toBeNull();
      expect(r[iKg]).toBeNull();
    }
  });

  it('the note travels to the exports only when it is set', async () => {
    stubProduction(STATION_4_ROWS);
    const d = await getProductReport(fakePool(), 1, PERIOD, { station: 4 });
    expect(reportNotesOf('product', d).some((n) => n.includes('station 4') && /sack/i.test(n))).toBe(true);
    stubProduction(NO_STATION_ROWS);
    const e = await getProductReport(fakePool(), 1, PERIOD, {});
    expect(reportNotesOf('product', e).some((n) => /sack scale records no winder/i.test(n))).toBe(false);
  });
});
