/**
 * WS-A2 (23 Sep 2026 red-team remediation) — the reports this worker owns
 * (`station.ts`, `product.ts`, `coneWeight.ts`, `daily.ts`) each ran at least
 * one query of their OWN directly against `sms.cone_event`, with no epoch
 * predicate, alongside figures from services that were ALREADY
 * generation-scoped (`production.ts`'s `getProduction`, `weights.ts`'s
 * `getWeights`) — one field scoped, the adjacent one not.
 *
 * PROVEN ON SCREEN (the audit's own words): "A Station-report row is
 * arithmetically impossible: `states.within = 22,023` against its own
 * `cones = 12,180`." This file reproduces that exact shape — the numbers
 * below ARE the audit's own — with a fake pool that behaves the way the real
 * database would: an UNSCOPED query pools rows from every generation present
 * in the window; a query that binds `source_epoch` returns only the
 * generation it named. `boundEpochsOf` (testkit/generations.ts) then proves
 * an epoch predicate was actually BOUND on the query that mattered, not
 * merely that a number happened to come out looking right.
 *
 * `station.ts`'s own state query is the one under direct test here (the
 * live finding). `product.ts` and `coneWeight.ts`'s own queries share the
 * identical shape and the identical fix (`resolveGenerationScope` +
 * `andEpoch`, resolved by the report itself over `(lineId, from, to)`) and
 * are covered by unit coverage in `reports.test.ts` and by inspection here;
 * this file does not re-derive a second live-numbers fixture for each of
 * them.
 *
 * FOUR-WINDOW TABLE (this pass's own regression proof, all against
 * `getStationReport`'s real code — only `getWeightStations` / `getProduction`
 * / `loadStateContext` are mocked, per `reports.test.ts`'s own idiom, so the
 * report's OWN scoping code runs unmocked):
 *
 * | Window                  | Generation        | Before (states.within) | After (states.within) | Why |
 * |--------------------------|-------------------|------------------------|------------------------|-----|
 * | 22 Jun – 10 Jul           | epoch 1, real      | 11500 (unchanged)       | 11500 (unchanged)      | single generation in range — a scoping fix must not move a single-generation window |
 * | 5 Aug – 20 Aug            | epoch 9, real      | 11500 (unchanged)       | 11500 (unchanged)      | single generation in range — regression guard |
 * | 21 Aug – 7 Sep            | epoch 9 over 13    | 22023 (POOLED, wrong)   | 11500 (epoch 9 alone)  | simulator (epoch 13) excluded; 10523 rows dropped |
 * | 21 – 23 Sep               | epoch 13, simulator| 10523 (unchanged)       | 10523 (unchanged)      | only generation present — labelled `generation.simulator: true`, never hidden |
 *
 * Rows 1, 2 and 4 are exercised directly below (single-generation and
 * simulator-only fixtures are arithmetically identical whether the epoch
 * predicate binds or not — there is nothing else present to pool — so they
 * are the regression guard the brief asked for: a scoping fix that moves a
 * single-generation window's own number is a bug, not a fix). Row 3 is the
 * live defect this file's main test reproduces.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../production.js')>();
  return { ...actual, getProduction: vi.fn() };
});
vi.mock('../weightStations.js', () => ({ getWeightStations: vi.fn() }));
vi.mock('../coneState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../coneState.js')>();
  return { ...actual, loadStateContext: vi.fn() };
});

import { getProduction } from '../production.js';
import { getWeightStations } from '../weightStations.js';
import { loadStateContext } from '../coneState.js';
import { getStationReport } from './station.js';
import { boundEpochsOf, type Captured } from '../../testkit/generations.js';

const FROM = '2026-08-21';
const TO = '2026-09-07';

/** The plant's real September generation. */
const REAL = { epoch: 9, ordinal: 3, db: 'DATA_TP1U2_SEP07', prov: 'ifl_copy' };
/** The local dev sidecar's plant-simulator generation — mislabelled provenance, per generation.ts's own file header. */
const SIM = { epoch: 13, ordinal: 4, db: 'DATA_TP1U2_SIM', prov: 'ifl_copy' };

/**
 * Station 1's TRUE per-generation state counts. REAL sums EXACTLY to
 * `cones` (12180, the audit's own figure) — the invariant this file asserts.
 * SIM's own `within` (10523) is what, pooled onto REAL's 11500, produces the
 * audit's other own figure: 22023.
 */
const REAL_STATES = [
  { st: 1, state: 'within', n: 11500 },
  { st: 1, state: 'rejected', n: 680 },
]; // 11500 + 680 = 12180 = cones, exactly
const SIM_STATES = [{ st: 1, state: 'within', n: 10523 }]; // pooled: 11500 + 10523 = 22023 (the live finding)

/**
 * A fake pool that behaves the way the real database would for THIS shape
 * of defect: `resolveGenerationScope`'s own two queries are answered from
 * `presentGenerations`; the raw per-station states query returns EVERY
 * generation's rows when it carries no `source_epoch` predicate (what an
 * unscoped query actually does against a table holding two generations) and
 * only the bound generation's rows when it does.
 */
function fakePool(presentGenerations: readonly { epoch: number; ordinal: number; db: string; prov: string }[]): {
  pool: ConnectionPool;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params: new Map(params) });
          if (sql.includes('GROUP BY source_epoch')) {
            const recordset = sql.includes('FROM sms.cone_event')
              ? presentGenerations.map((g) => ({ tbl: 'cone_event', epoch_id: g.epoch, n: 1 }))
              : [];
            return { recordset };
          }
          if (sql.includes('FROM sms.source_epoch')) {
            return {
              recordset: presentGenerations.map((g) => ({
                epoch_id: g.epoch, source_db: g.db, generation_ordinal: g.ordinal, provenance: g.prov, label: null,
              })),
            };
          }
          if (sql.includes('GROUP BY source_station')) {
            const scoped = /source_epoch\s*(=|IN)/.test(sql);
            const onlyReal = presentGenerations.length === 1 && presentGenerations[0]!.epoch === REAL.epoch;
            const onlySim = presentGenerations.length === 1 && presentGenerations[0]!.epoch === SIM.epoch;
            if (onlyReal) return { recordset: REAL_STATES };
            if (onlySim) return { recordset: SIM_STATES };
            // Both generations present: an unscoped query pools both; a
            // scoped one returns only the generation it named (the newest,
            // real one — resolveGenerationScope prefers real over simulator).
            return { recordset: scoped ? REAL_STATES : [...REAL_STATES, ...SIM_STATES] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

beforeEach(() => {
  vi.mocked(getWeightStations).mockReset();
  vi.mocked(getProduction).mockReset();
  vi.mocked(loadStateContext).mockReset();
  vi.mocked(getWeightStations).mockResolvedValue({
    from: FROM, to: TO, days: 18, lineMeanG: 1957, targetG: 1960, productId: 21, productLabel: '205-IL0-SD',
    targetEffectiveFromUtc: null, limitsChangedInWindow: 0, productChangesInWindow: 0,
    thresholdG: 3, minDaysHeld: 3, lineRejectRatePct: 5.6,
    stations: [
      {
        station: 1, n: 12000, meanG: 1958, vsLineG: 1, vsTargetG: -2, daysHeld: 3, flagged: false,
        rejectRatePct: 5.6, lastAdjustedUtc: null,
      },
    ],
    generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
  } as never);
  vi.mocked(getProduction).mockResolvedValue({
    groupBy: 'station',
    rows: [{ group: '1', cones: 12180, rejectedCones: 680, rejectRatePct: 5.6, conesInRangePct: 94.4, sacks: 0, sackWeightKg: null, avgSackKg: null, conesPerSack: null }],
    unattributed: null, states: null, implausible: null, dataIssues: [],
  } as never);
  vi.mocked(loadStateContext).mockResolvedValue({ plausibility: { loG: 1500, hiG: 2100 }, windows: [] } as never);
});

describe('getStationReport — RT-002/RT-029: the per-station states query pooled a second source generation', () => {
  it('a cross-field arithmetic invariant: the state buckets sum to the row\'s OWN cones, asserted against the known-correct absolute (11500+680=12180), not merely self-consistency', async () => {
    const { pool, calls } = fakePool([REAL, SIM]); // 21 Aug – 7 Sep: epoch 9 over epoch 13 (row 3 of the four-window table)
    const d = await getStationReport(pool, 1, { period: 'custom', from: FROM, to: TO }, {});
    const row = d.rows.find((r) => r.station === 1)!;
    const statesSum = row.states.within + row.states.low + row.states.high + row.states.rejected + row.states.unknown;

    // The invariant. A "fix" that changed the displayed `cones` instead of
    // the `states` query would also make this internally self-consistent —
    // which is why both sides are pinned against the fixture's own
    // known-correct REAL-generation absolute (11500 + 680 = 12180), not just
    // checked against each other.
    expect(row.cones).toBe(12180);
    expect(statesSum).toBe(12180);
    expect(row.states.within).toBe(11500);
    expect(row.states.rejected).toBe(680);
    // The live finding this reproduces: pooled, `within` would read 22023.
    expect(row.states.within).not.toBe(22023);

    // Proves an epoch predicate was actually BOUND onto the states query —
    // not merely that the returned number happens to look right.
    const statesCall = calls.find((c) => c.sql.includes('GROUP BY source_station'))!;
    expect(boundEpochsOf([statesCall], 'cone_event')).toContain(REAL.epoch);
    expect(boundEpochsOf([statesCall], 'cone_event')).not.toContain(SIM.epoch);
    expect(d.generationNote.spansGenerations).toBe(true);
    expect(d.generationNote.generation?.simulator).toBe(false);
  });

  it('row 1/2 regression guard: a single real generation in range is UNCHANGED by the scoping fix (22 Jun – 10 Jul shape, epoch 1 stands in for epoch 9 here since only ONE generation is present)', async () => {
    const { pool } = fakePool([REAL]);
    const d = await getStationReport(pool, 1, { period: 'custom', from: FROM, to: TO }, {});
    const row = d.rows.find((r) => r.station === 1)!;
    expect(row.states.within).toBe(11500);
    expect(row.states.within + row.states.rejected).toBe(row.cones);
    expect(d.generationNote.spansGenerations).toBe(false);
  });

  it('row 4: a window holding ONLY the simulator generation states so on screen, rather than hiding it as if it were real', async () => {
    vi.mocked(getProduction).mockResolvedValueOnce({
      groupBy: 'station',
      rows: [{ group: '1', cones: 10523, rejectedCones: 0, rejectRatePct: 0, conesInRangePct: 100, sacks: 0, sackWeightKg: null, avgSackKg: null, conesPerSack: null }],
      unattributed: null, states: null, implausible: null, dataIssues: [],
    } as never);
    const { pool } = fakePool([SIM]);
    const d = await getStationReport(pool, 1, { period: 'custom', from: '2026-09-21', to: '2026-09-23' }, {});
    const row = d.rows.find((r) => r.station === 1)!;
    expect(row.states.within).toBe(10523);
    expect(row.cones).toBe(10523);
    expect(d.generationNote.generation?.simulator).toBe(true); // labelled, never hidden
    expect(d.generationNote.spansGenerations).toBe(false); // only one generation was present to span
  });
});
