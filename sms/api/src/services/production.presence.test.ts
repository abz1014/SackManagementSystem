/**
 * WS-P (remediation programme following the 23 Sep 2026 red-team audit):
 * `getProduction` used bare `?? 0` / bare property reads (`c.n`, `s.kg`, …)
 * when mapping SQL recordset rows onto `ProductionRow`. A row that comes
 * back from the driver with an expected column MISSING — not SQL NULL, not
 * a real zero, the key itself absent, which is what a malformed or
 * truncated driver row looks like — silently became a literal `0` with
 * nothing on the response to say so. `GET /api/production` is the MAIN
 * production endpoint (register, exports, every report in reports/*), so
 * this was indistinguishable from "the line produced nothing".
 *
 * These tests build a fake `ConnectionPool` modelled on
 * `spc.generations.test.ts`'s `fakePool` (no `api/src/testkit/generations.ts`
 * had landed as of this pass — hand-rolled per WS-P's brief) and route each
 * query by a substring of its own SQL text, the same idiom. Every row this
 * file hands back is built by spreading a well-formed row and then
 * `delete`-ing one key — never `null` — so what's under test is a key that
 * is genuinely ABSENT from a row that IS present, not a SQL NULL (which the
 * existing `ISNULL(...)`/`SUM(CASE...)` shapes already turn into a real 0 at
 * the source, legitimately).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction } from './production.js';

interface FakeRow {
  [key: string]: unknown;
}

/**
 * Routes each query by a distinguishing substring of its SQL text, in the
 * order `getProduction` actually issues them. `overrides` replaces the
 * well-formed row(s) a named query would otherwise return, keyed the same
 * way — the malformed-row tests use it to `delete` one column from an
 * otherwise-normal row.
 */
function fakePool(overrides: Partial<Record<string, FakeRow[]>> = {}): ConnectionPool {
  const normal = {
    // resolveGenerationScope's own per-table presence count. Empty →
    // totalRows===0 → UNSCOPED, no source_epoch lookup, no epoch predicate
    // bound anywhere below — the simplest legal scope for this test.
    generationPresence: [],
    cones: [{ grp: 'total', n: 0, inr: 0 }],
    // the unmatched-rejects query (rejects.ts getUnmatchedRejects) — has its
    // own alias 're' and a NOT EXISTS against cone_event.
    unmatchedRejects: [{ grp: 'total', n: 0 }],
    rejects: [{ grp: 'total', n: 0 }],
    sacks: [{ grp: 'total', n: 0, kg: 0, judged: 0, passed: 0 }],
    weightRule: [],
  };
  const rows: Record<string, FakeRow[]> = { ...normal, ...overrides };

  const pool = {
    request: () => {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          if (sql.includes('UNION ALL') && sql.includes('GROUP BY source_epoch')) {
            return { recordset: rows.generationPresence };
          }
          if (sql.includes('FROM sms.reject_event re') && sql.includes('NOT EXISTS')) {
            return { recordset: rows.unmatchedRejects };
          }
          if (sql.includes('FROM sms.cone_event') && sql.includes('SUM(CASE WHEN in_range=1')) {
            return { recordset: rows.cones };
          }
          if (sql.includes('FROM sms.reject_event WHERE')) {
            return { recordset: rows.rejects };
          }
          if (sql.includes('FROM sms.sack_event')) {
            return { recordset: rows.sacks };
          }
          if (sql.includes('FROM sms.weight_rule')) {
            return { recordset: rows.weightRule };
          }
          throw new Error(`fakePool: unrouted query: ${sql}`);
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return pool;
}

describe('getProduction — presence of the main production numbers', () => {
  it('a real zero (a well-formed row reporting no cones/sacks this period) carries no data issue', async () => {
    const pool = fakePool();
    const result = await getProduction(pool, 1, { groupBy: 'none' });

    expect(result.rows).toEqual([
      {
        group: 'total', cones: 0, rejectedCones: 0, unmatchedRejects: 0,
        sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null,
      },
    ]);
    expect(result.dataIssues).toEqual([]);
  });

  it('a cone row missing its count entirely (key deleted, not null) must not read as a silent zero', async () => {
    const malformedCone: FakeRow = { grp: 'total', inr: 0 };
    delete malformedCone.n; // absent, not null — the shape a truncated/malformed driver row takes
    const pool = fakePool({ cones: [malformedCone] });

    const result = await getProduction(pool, 1, { groupBy: 'none' });

    // The success shape is unchanged — `cones` is still a number, not
    // undefined/missing from the JSON body.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.cones).toBe(0);
    // ...but it is NOT indistinguishable from the real-zero case above:
    // dataIssues says this 0 did not come from a real count.
    expect(result.dataIssues).toContainEqual({
      field: 'cones', group: 'total',
      reason: 'cone_event aggregate row is missing its count (n)',
    });
    expect(result.dataIssues).toContainEqual({
      field: 'conesInRangePct', group: 'total',
      reason: 'cone_event aggregate row is missing its count (n); in-range % unknowable',
    });
  });

  it('a sack row missing its weight sum is flagged without corrupting the count beside it', async () => {
    const malformedSack: FakeRow = { grp: 'total', n: 4, judged: 4, passed: 4 };
    delete malformedSack.kg;
    const pool = fakePool({ sacks: [malformedSack] });

    const result = await getProduction(pool, 1, { groupBy: 'none' });

    expect(result.rows[0]!.sacks).toBe(4); // the count itself was fine — not swept up in the same flag
    expect(result.rows[0]!.sackWeightKg).toBe(0);
    expect(result.dataIssues).toContainEqual({
      field: 'sackWeightKg', group: 'total',
      reason: 'sack_event aggregate row is missing its weight sum (kg)',
    });
  });

  it('a rejects row missing its count is flagged the same way', async () => {
    const malformedRejects: FakeRow = { grp: 'total' };
    delete malformedRejects.n;
    const pool = fakePool({ rejects: [malformedRejects] });

    const result = await getProduction(pool, 1, { groupBy: 'none' });

    expect(result.rows[0]!.rejectedCones).toBe(0);
    expect(result.dataIssues).toContainEqual({
      field: 'rejectedCones', group: 'total',
      reason: 'reject_event aggregate row is missing its count (n)',
    });
  });
});
