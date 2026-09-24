/**
 * WS-PERF4 (24 Sep 2026) — `PERFORMANCE-APP-2026-09-24.md` measured
 * `/api/weight-stations` resolving the identical `(lineId, from, to)`
 * generation scope THREE separate times in one request:
 *  - `weightStations.ts`'s `stationMaterialCounts`
 *  - `weightStations.ts`'s `rejectRatesByStation`
 *  - `productAt.ts`'s `productDisagreement`, called from `app.ts`'s own
 *    `Promise.all` for that route
 * — six extra SQL round trips (two queries per resolve: a UNION ALL
 * present-rows scan, then a `sms.source_epoch` read) beyond the endpoint's
 * real data queries.
 *
 * This file drives `getWeightStations` and `productDisagreement` together
 * the same way `app.ts`'s route does (its own `Promise.all` of the two),
 * against `testkit/generations.ts`'s `fakeGenerationPool` — which RECORDS
 * every query (unlike `fakePositionalPool`, which absorbs the two scope
 * queries silently so six sibling fixture files' positional response
 * arrays are unaffected by how many times a scope is resolved). Counting
 * `GROUP BY source_epoch` occurrences in that call log counts
 * `resolveGenerationScope` invocations directly, not by inference from
 * timing.
 *
 * TWO SCENARIOS, DELIBERATELY:
 *  - "windows coincide" mirrors this task's own measurement methodology
 *    (an explicit `from=to=periodFrom=periodTo` widest-range HTTP probe).
 *  - "windows differ" mirrors the REAL screen (`web/src/screens/Weight.tsx`):
 *    `from` is never sent by the client, so the server derives it from
 *    `trailingDays` (a fixed 14-day window ending at `to`), while
 *    `periodFrom`/`periodTo` are the reader's OWN selected period — usually
 *    a different, often much wider, window. The fix must not collapse these
 *    into one shared answer just because they were resolved in the same
 *    request: `generation.ts`'s own header names exactly this risk (the
 *    D-17/D-18 class), and `createScopeCache` is keyed on the full
 *    `(lineId, from, to, tables)` tuple for that reason. Both scenarios are
 *    exercised so a future change cannot fix one at the cost of the other.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  fakeGenerationPool,
  ONE_REAL_GENERATION,
  TWO_GENERATIONS_WITH_MISLABELLED_SIMULATOR,
  type GenerationSpecEntry,
} from '../testkit/generations.js';

vi.mock('./calibration.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calibration.js')>()),
  getStationDrift: async () => ({ days: 1, stations: [{ station: 1, n: 20, grandMean: 1950, days: [] }] }),
  listCalibrationAdjustments: async () => [],
}));
vi.mock('./admin.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./admin.js')>()),
  getPlausibilityRule: async () => ({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 }),
}));
// productDisagreement, ProductTimeline etc. stay REAL — only the DB-hitting
// loadProductTimeline is stubbed, same idiom weightStations.generations.test.ts
// uses for the sibling module (productLimits.js) below.
vi.mock('./productAt.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./productAt.js')>()),
  loadProductTimeline: async () => new (await importOriginal<typeof import('./productAt.js')>()).ProductTimeline([]),
}));
vi.mock('./productLimits.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./productLimits.js')>()),
  loadProductCatalogue: async () =>
    new (await importOriginal<typeof import('./productLimits.js')>()).ProductCatalogue([], []),
}));

const { getWeightStations } = await import('./weightStations.js');
const { productDisagreement, ProductTimeline } = await import('./productAt.js');
const { ProductCatalogue } = await import('./productLimits.js');
const { createScopeCache } = await import('./generation.js');

const LINE = 1;

/**
 * `fakeGenerationPool` answers ONLY `resolveGenerationScope`'s own two
 * queries; every other query the two services under test issue needs its
 * own canned answer here, same idiom as `spc.generations.test.ts`'s
 * `fakeSpcPool`. Deliberately generic, small fixtures — this file proves
 * INVOCATION COUNT and cross-window SAFETY, not business figures (those are
 * `weightStations.generations.test.ts` and `productAt.disagreement.test.ts`'s
 * job, both still green against this same change — see WS-PERF4's report).
 */
function fakeStationsPool(spec: readonly GenerationSpecEntry[]) {
  const base = fakeGenerationPool(spec);
  const pool = {
    request: () => {
      const req = base.pool.request() as unknown as {
        input: (n: string, t: unknown, v: unknown) => unknown;
        query: (sql: string) => Promise<{ recordset: unknown[] }>;
      };
      const orig = req.query.bind(req);
      req.query = (async (sql: string) => {
        const res = await orig(sql);
        if (res.recordset.length > 0) return res; // a scope query, already answered
        if (sql.includes('FULL OUTER JOIN')) return { recordset: [{ st: 1, cones: 20, rejects: 5 }] };
        if (sql.includes('AS cones') && sql.includes('AS rejects')) return { recordset: [{ cones: 20, rejects: 5 }] };
        if (sql.includes('material_id mat')) return { recordset: [{ st: 1, mat: 21, n: 20 }] };
        if (sql.includes('NOT EXISTS')) return { recordset: [{ grp: 'total', n: 1 }] };
        if (sql.includes('AS passedOut')) return { recordset: [{ total: 20, judged: 18, passedOut: 2, rejectedIn: 1 }] };
        return res;
      }) as typeof req.query;
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls: base.calls };
}

const scopeResolveCount = (calls: readonly { sql: string }[]) =>
  calls.filter((c) => c.sql.includes('GROUP BY source_epoch')).length;

/** Runs the route's own composition: getWeightStations + productDisagreement, via ONE per-request cache. */
async function runRoute(
  pool: ConnectionPool,
  trailing: { from: string; to: string },
  period: { from: string; to: string },
) {
  const timeline = new ProductTimeline([]);
  const catalogue = new ProductCatalogue([], []);
  const resolveScope = createScopeCache(pool);
  return Promise.all([
    getWeightStations(pool, LINE, trailing.from, trailing.to, resolveScope),
    productDisagreement(pool, LINE, timeline, period, catalogue, resolveScope),
  ]);
}

describe('WS-PERF4: /api/weight-stations resolves its generation scope at most twice per request, never three times', () => {
  it('windows coincide (this task\'s own widest-range measurement shape): 3 resolves before the fix, 2 after — never 1, because the trailing pair\'s table list (cone_event+reject_event) genuinely differs from productDisagreement\'s (cone_event alone)', async () => {
    const { pool, calls } = fakeStationsPool(ONE_REAL_GENERATION);
    await runRoute(pool, { from: '2026-08-05', to: '2026-09-07' }, { from: '2026-08-05', to: '2026-09-07' });
    const n = scopeResolveCount(calls);
    expect(n).toBeLessThanOrEqual(2);
    expect(n).toBeGreaterThan(0); // still scoped — not accidentally UNSCOPED
  });

  it('windows genuinely differ (the real screen: trailing 14-day drift window vs. the reader\'s own, usually wider, selected period): still 2 resolves, correctly NOT collapsed into 1', async () => {
    const { pool, calls } = fakeStationsPool(ONE_REAL_GENERATION);
    await runRoute(pool, { from: '2026-08-25', to: '2026-09-07' }, { from: '2026-08-05', to: '2026-09-07' });
    expect(scopeResolveCount(calls)).toBe(2);
  });

  it('CORRECTNESS GUARD: the memo must not answer a WIDER table request from a NARROWER one it already cached for the same window', async () => {
    // `testkit/generations.ts`'s fake does not model date-range filtering
    // (see its own header — it answers resolveGenerationScope's two queries
    // from the declared spec regardless of the bound @genFrom/@genTo), so
    // this guard targets the specific hazard `createScopeCache`'s own doc
    // comment names: a scope resolved for a NARROWER table list being reused
    // for a caller that needs a table NOT in that list, which would return
    // `[]` from `epochIds()` for it — "no predicate", i.e. UNSCOPED — for a
    // window that plainly has more than one generation in it. Two generations
    // on `reject_event`, so an unconstrained reject query would visibly pool
    // them.
    const spec: GenerationSpecEntry[] = [
      { epoch: 9, ordinal: 3, db: 'DATA_TP1U2_SEP07', prov: 'ifl_copy', label: 'September copy', rows: { cone_event: 200, reject_event: 100 } },
      { epoch: 13, ordinal: 4, db: 'DATA_TP1U2_SIM', prov: 'ifl_copy', label: 'simulator', rows: { reject_event: 900 } },
    ];
    const { pool, calls } = fakeStationsPool(spec);
    const resolveScope = createScopeCache(pool);

    // First call for this window: cone_event alone (stationMaterialCounts's
    // own real-world table need, in isolation).
    const narrow = await resolveScope(LINE, { from: '2026-09-01', to: '2026-09-07' }, ['cone_event']);
    expect(narrow.epochIds('reject_event')).toEqual([]); // never asked about reject_event — correctly empty, not a claim
    const beforeSecondResolve = scopeResolveCount(calls);
    expect(beforeSecondResolve).toBe(1);

    // Second call, SAME window, WIDER table list (rejectRatesByStation's own
    // real need). Exact-tuple keying means this is a genuinely separate
    // resolve, not a reuse of `narrow` — and it MUST see and constrain
    // reject_event to the chosen (real, ordinal 3) generation, excluding the
    // simulator's 900 rows.
    const wide = await resolveScope(LINE, { from: '2026-09-01', to: '2026-09-07' }, ['cone_event', 'reject_event']);
    expect(scopeResolveCount(calls)).toBe(beforeSecondResolve + 1); // a genuinely new resolve, not reused
    expect(wide.generation?.ordinal).toBe(3);
    expect(wide.epochIds('reject_event')).toEqual([9]);
    expect(wide.spansGenerations).toBe(true);
    expect(wide.otherGenerationExcluded).toBe(900); // the simulator's reject rows, correctly named as excluded

    // Repeating the WIDE request for the identical tuple must now be free —
    // the memo, not a third database round trip.
    await resolveScope(LINE, { from: '2026-09-01', to: '2026-09-07' }, ['cone_event', 'reject_event']);
    expect(scopeResolveCount(calls)).toBe(beforeSecondResolve + 1);
  });
});
