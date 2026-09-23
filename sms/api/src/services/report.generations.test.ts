/**
 * getReport's coverageReq generation predicate (WS-GF, 23 Sep 2026
 * red-team remediation — DEFECT 1, `generationScope.guard.test.ts`'s
 * KNOWN_DEFECTS entry for `report.ts::getReport`).
 *
 * getReport's day-coverage query (`coverageReq` — `COUNT(DISTINCT
 * shift_date)` plus `MIN`/`MAX(shift_date)` over `sms.cone_event`) carried
 * NO epoch predicate and called no scoping helper, unlike its five sibling
 * queries in the same `Promise.all` (totals/byShift/byDay via
 * `getProduction`, `stops` via `getStoppagePatterns`, `shiftCheck` via
 * `getShiftCheck` — all already `resolveGenerationScope`-scoped). A period
 * spanning IFL's 5 Aug 2026 rebuild, or spanning the dev sidecar's
 * plant-simulator generation (21 Aug - 22 Sep, `DATA_TP1U2_SIM`) over real
 * September (5 Aug - 7 Sep, `DATA_TP1U2_SEP07`), pooled both generations'
 * days into one coverage count and one first/last-day pair.
 *
 * `getReport` resolves its OWN scope, over the SAME `(lineId, from, to)` key
 * every other caller of `resolveGenerationScope` uses — no scope is threaded
 * through `getProduction`/`getStoppagePatterns`/`getShiftCheck`'s own
 * signatures; each of those already resolves the same deterministic answer
 * independently (`generation.ts`'s own documented guarantee).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('./production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./production.js')>();
  return { ...actual, getProduction: vi.fn() };
});
vi.mock('./downtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./downtime.js')>();
  return { ...actual, getStoppagePatterns: vi.fn() };
});
vi.mock('./shiftCheck.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shiftCheck.js')>();
  return { ...actual, getShiftCheck: vi.fn() };
});

import { getProduction } from './production.js';
import { getStoppagePatterns } from './downtime.js';
import { getShiftCheck } from './shiftCheck.js';
import { getReport } from './report.js';

/** The plant's real September generation. */
const REAL = { epoch: 9, ordinal: 3, db: 'DATA_TP1U2_SEP07', prov: 'ifl_copy' };
/** The dev sidecar's plant-simulator generation — mislabelled provenance, per generation.ts's own file header. */
const SIM = { epoch: 13, ordinal: 4, db: 'DATA_TP1U2_SIM', prov: 'ifl_copy' };

const EMPTY_PRODUCTION = {
  groupBy: 'none' as const,
  rows: [],
  unattributed: null,
  states: null,
  implausible: null,
  dataIssues: [],
};

beforeEach(() => {
  vi.mocked(getProduction).mockReset().mockResolvedValue(EMPTY_PRODUCTION as never);
  vi.mocked(getStoppagePatterns).mockReset().mockResolvedValue({
    from: '', to: '', thresholdSeconds: 120, dayCount: 0, stoppages: [],
  } as never);
  vi.mocked(getShiftCheck).mockReset().mockResolvedValue({
    from: '', to: '', cones: 0, mismatched: 0, mismatchPct: 0, noLegacyShift: 0, byDay: [], topHours: [], note: '',
  } as never);
});

/**
 * A fake pool answering resolveGenerationScope's two queries from `spec`
 * (via fakeGenerationPool), plus the coverageReq's own raw
 * `COUNT(DISTINCT shift_date)` query: an UNSCOPED query pools every
 * generation's days (real behaviour before this fix), a query that binds
 * `source_epoch` returns only the days of the generation it named.
 */
function fakePool(
  spec: readonly { epoch: number; ordinal: number; db: string; prov: string }[],
  daysByEpoch: Record<number, { n: number; first: string; last: string }>,
): { pool: ConnectionPool; calls: { sql: string; params: Map<string, unknown> }[] } {
  const calls: { sql: string; params: Map<string, unknown> }[] = [];
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
          // resolveGenerationScope's present-rows query.
          if (sql.includes('GROUP BY source_epoch')) {
            const recordset = sql.includes('FROM sms.cone_event')
              ? spec.map((g) => ({ tbl: 'cone_event', epoch_id: g.epoch, n: 1 }))
              : [];
            return { recordset };
          }
          // resolveGenerationScope's second query: the line's sms.source_epoch rows.
          if (sql.includes('FROM sms.source_epoch')) {
            return {
              recordset: spec.map((g) => ({
                epoch_id: g.epoch, source_db: g.db, generation_ordinal: g.ordinal, provenance: g.prov, label: null,
              })),
            };
          }
          if (sql.includes('COUNT(DISTINCT shift_date)')) {
            const scoped = /source_epoch\s*(=|IN)/.test(sql);
            const epochs = spec.map((s) => s.epoch);
            const chosen = scoped ? epochs.filter((e) => [...params.values()].includes(e)) : epochs;
            const rows = chosen.map((e) => daysByEpoch[e]).filter((x): x is { n: number; first: string; last: string } => !!x);
            if (rows.length === 0) return { recordset: [{ n: 0, firstDay: null, lastDay: null }] };
            const n = rows.reduce((s, r) => s + r.n, 0);
            const first = rows.map((r) => r.first).sort()[0]!;
            const last = rows.map((r) => r.last).sort().slice(-1)[0]!;
            return { recordset: [{ n, firstDay: first, lastDay: last }] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

describe('getReport — coverageReq generation predicate (KNOWN_DEFECTS entry, generationScope.guard.test.ts)', () => {
  it('RED: a two-generation window pools BOTH generations\' days into coverage (the live defect, pre-fix)', async () => {
    const { pool } = fakePool(
      [REAL, SIM],
      {
        [REAL.epoch]: { n: 10, first: '2026-08-21', last: '2026-08-30' },
        [SIM.epoch]: { n: 13, first: '2026-08-21', last: '2026-09-07' },
      },
    );
    const d = await getReport(pool, 1, { period: 'custom', from: '2026-08-21', to: '2026-09-07' });
    // The scoped, correct answer is 10 days (epoch 9 alone, preferred as the
    // real generation) — NOT 23 (10 + 13 pooled). This assertion is the RED:
    // it fails against the unfixed coverageReq, which pools both.
    expect(d.coverage.daysWithData).toBe(10);
    expect(d.coverage.firstDayWithData).toBe('2026-08-21');
    expect(d.coverage.lastDayWithData).toBe('2026-08-30');
  });

  it('row 1 regression guard: a single real generation (22 Jun - 10 Jul, epoch 1 stands in) is UNCHANGED by the scoping fix', async () => {
    const { pool } = fakePool(
      [{ epoch: 1, ordinal: 1, db: 'DATA_TP1U2', prov: 'ifl_copy' }],
      { 1: { n: 19, first: '2026-06-22', last: '2026-07-10' } },
    );
    const d = await getReport(pool, 1, { period: 'custom', from: '2026-06-22', to: '2026-07-10' });
    expect(d.coverage.daysWithData).toBe(19);
    expect(d.coverage.firstDayWithData).toBe('2026-06-22');
    expect(d.coverage.lastDayWithData).toBe('2026-07-10');
  });

  it('row 2 regression guard: a single real generation (5 Aug - 20 Aug, epoch 9 alone) is UNCHANGED by the scoping fix', async () => {
    const { pool } = fakePool(
      [REAL],
      { [REAL.epoch]: { n: 16, first: '2026-08-05', last: '2026-08-20' } },
    );
    const d = await getReport(pool, 1, { period: 'custom', from: '2026-08-05', to: '2026-08-20' });
    expect(d.coverage.daysWithData).toBe(16);
    expect(d.coverage.firstDayWithData).toBe('2026-08-05');
    expect(d.coverage.lastDayWithData).toBe('2026-08-20');
  });

  it('row 3: 21 Aug - 7 Sep pools epoch 9 over epoch 13 pre-fix; scoped, only epoch 9\'s days count', async () => {
    const { pool } = fakePool(
      [REAL, SIM],
      {
        [REAL.epoch]: { n: 10, first: '2026-08-21', last: '2026-08-30' },
        [SIM.epoch]: { n: 18, first: '2026-08-21', last: '2026-09-07' },
      },
    );
    const d = await getReport(pool, 1, { period: 'custom', from: '2026-08-21', to: '2026-09-07' });
    expect(d.coverage.daysWithData).toBe(10); // NOT 28 (10 + 18 pooled)
    expect(d.generationNote?.spansGenerations).toBe(true);
    expect(d.generationNote?.generation?.simulator).toBe(false);
  });

  it('row 4: a window holding ONLY the simulator generation states so on screen, rather than hiding it as if it were real', async () => {
    const { pool } = fakePool(
      [SIM],
      { [SIM.epoch]: { n: 3, first: '2026-09-21', last: '2026-09-23' } },
    );
    const d = await getReport(pool, 1, { period: 'custom', from: '2026-09-21', to: '2026-09-23' });
    expect(d.coverage.daysWithData).toBe(3);
    expect(d.generationNote?.generation?.simulator).toBe(true); // labelled, never hidden
    expect(d.generationNote?.spansGenerations).toBe(false); // only one generation was present to span
  });

  it('an epoch predicate is actually BOUND onto the coverage query, not merely a coincidentally-right number', async () => {
    const { pool, calls } = fakePool(
      [REAL, SIM],
      {
        [REAL.epoch]: { n: 10, first: '2026-08-21', last: '2026-08-30' },
        [SIM.epoch]: { n: 18, first: '2026-08-21', last: '2026-09-07' },
      },
    );
    await getReport(pool, 1, { period: 'custom', from: '2026-08-21', to: '2026-09-07' });
    const coverageCall = calls.find((c) => c.sql.includes('COUNT(DISTINCT shift_date)'));
    expect(coverageCall).toBeTruthy();
    expect(coverageCall!.sql).toMatch(/source_epoch\s*(=|IN)/);
  });

  it('no epoch data at all (fixture/pre-epoch mirror): applies no predicate, coverage still computed', async () => {
    const { pool } = fakePool([], {});
    const d = await getReport(pool, 1, { period: 'custom', from: '2026-09-01', to: '2026-09-07' });
    expect(d.coverage.daysWithData).toBe(0);
    expect(d.generationNote?.generation ?? null).toBeNull();
  });
});
