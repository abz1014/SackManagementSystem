/**
 * C-018 / D-84 (2 Oct 2026 audit): five services judged a PERIOD by the
 * plausibility rule "in force right now" (`getPlausibilityRule`, admin.ts's
 * DEPRECATED latest-row reader) instead of the rule in force at that period's
 * own end (`getPlausibilityRuleAsOf`, ruleAsOf.ts — RT24-04). A Setup edit
 * made AFTER the period then silently re-judged it: the station table's n
 * moved while `getWeights` (as-of) did not.
 *
 * The fixture is a two-version history whose NEWER version (lo 1,960 g) takes
 * effect after the period. Each of the five functions must judge the earlier
 * period by the earlier version (lo 1,500 g).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { fakePositionalPool, ONE_REAL_GENERATION } from '../testkit/generations.js';

const stationDriftSpy = vi.fn();

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async (...args: unknown[]) => {
    stationDriftSpy(...args);
    return { days: 0, stations: [] };
  },
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./productAt.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./productAt.js')>()),
  loadProductTimeline: async () => ({ entries: [], at: () => null, isEmpty: true }),
}));
vi.mock('./productLimits.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./productLimits.js')>()),
  loadProductCatalogue: async () => ({
    product: () => null,
    versionAt: () => null,
    limitsAt: () => null,
    latest: () => null,
    productIds: () => [],
    versionsAscending: () => [],
    isEmpty: true,
  }),
}));
vi.mock('./rejectSpc.js', () => ({
  getRejectSpc: async () => ({ buckets: [], pBar: null, episodes: [] }),
}));
vi.mock('./weights.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./weights.js')>()),
  getWeights: async () => ({
    basis: 'as_recorded',
    cone: { count: 0, implausible: 0, avg: null, stdev: null, min: null, max: null, bucketSize: 20, histogram: [], median: 1900 },
  }),
}));
vi.mock('./production.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./production.js')>()),
  getProduction: async () => ({ rows: [], states: null }),
}));
vi.mock('./reports/ranProducts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reports/ranProducts.js')>()),
  productsRanInPeriod: async () => [],
}));

const { loadStateContext } = await import('./coneState.js');
const { productDisagreement } = await import('./productAt.js');
const { getWeightStations } = await import('./weightStations.js');
const { getAttention } = await import('./attention.js');
const { getConeWeightReport } = await import('./reports/coneWeight.js');

/** Newest first, as `ORDER BY effective_from DESC` returns it. The newer version begins AFTER the 10 Aug period. */
const HISTORY = [
  { cl: 1960, ch: 2100, sl: 40, sh: 60, effective_from: new Date('2026-09-01T00:00:00Z') },
  { cl: 1500, ch: 2100, sl: 40, sh: 60, effective_from: new Date('2026-06-01T00:00:00Z') },
];
const DAY = '2026-08-10';

function pool(): ConnectionPool {
  const inner = fakePositionalPool(ONE_REAL_GENERATION, []).pool;
  return {
    request: () => {
      const innerReq = inner.request();
      const req = {
        input: (n: string, t: unknown, v: unknown) => {
          (innerReq as unknown as { input: (...a: unknown[]) => unknown }).input(n, t, v);
          return req;
        },
        query: async (sql: string) => {
          if (sql.includes('FROM sms.plausibility_rule')) {
            // The "now" reader selects TOP 1 (latest); the as-of loader reads the whole history.
            return { recordset: sql.includes('TOP 1') ? [HISTORY[0]] : HISTORY };
          }
          if (sql.includes('AS passedOut')) return { recordset: [{ total: 0, judged: 0, passedOut: 0, rejectedIn: 0 }] };
          return innerReq.query(sql);
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('C-018 — a period is judged by the plausibility rule in force at its own end', () => {
  it('coneState.loadStateContext', async () => {
    const ctx = await loadStateContext(pool(), 1, { from: DAY, to: DAY });
    expect(ctx.plausibility.loG).toBe(1500);
  });

  it('productAt.productDisagreement binds the as-of bounds', async () => {
    const binds = new Map<string, unknown>();
    const base = pool();
    const wrapped = {
      request: () => {
        const r = (base as unknown as { request: () => { input: (...a: unknown[]) => unknown; query: (s: string) => Promise<unknown> } }).request();
        const req = {
          input: (n: string, t: unknown, v: unknown) => {
            binds.set(n, v);
            r.input(n, t, v);
            return req;
          },
          query: (s: string) => r.query(s),
        };
        return req;
      },
    } as unknown as ConnectionPool;
    await productDisagreement(wrapped, 1, { entries: [], at: () => null, isEmpty: true } as never, { from: DAY, to: DAY });
    expect(binds.get('plausLo')).toBe(1500);
  });

  it('weightStations.getWeightStations hands the drift query the as-of rule', async () => {
    stationDriftSpy.mockClear();
    await getWeightStations(pool(), 1, DAY, DAY);
    const plausibility = stationDriftSpy.mock.calls[0]![4] as { coneLoG: number };
    expect(plausibility.coneLoG).toBe(1500);
  });

  it('attention.getAttention hands the drift query the as-of rule', async () => {
    stationDriftSpy.mockClear();
    await getAttention(pool(), 1, { from: DAY, to: DAY }, { from: DAY, to: DAY });
    const plausibility = stationDriftSpy.mock.calls[0]![4] as { coneLoG: number };
    expect(plausibility.coneLoG).toBe(1500);
  });

  it('reports/coneWeight prints the as-of window', async () => {
    const data = await getConeWeightReport(
      pool(), 1,
      { from: DAY, to: DAY } as never,
      {} as never,
    );
    expect(data.plausibility.loG).toBe(1500);
  });
});
