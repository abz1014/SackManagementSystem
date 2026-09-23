/**
 * Downtime across a source-generation boundary (generation.ts, 23 Sep 2026).
 *
 * This is the one place where pooling generations ERASED events rather than
 * inflating a count. Every figure `downtime.ts` produces comes from
 * `LAG(production_ts_utc)` over an ordered stream of cones; two generations
 * interleaved in time make one stream, and each fills the other's gaps, so a
 * real stoppage with another generation's cones inside it simply is not there.
 *
 * MEASURED on the development sidecar, shift_date 2026-09-01, where IFL's own
 * September generation (epoch 9, 3,089 cones) overlaps the plant simulator's
 * (epoch 13, 7,470 cones) hour for hour:
 *
 *                 stoppages >=120s   downtime    availability
 *   pooled              12             3,301 s      96.2 %
 *   epoch 9 only        65            48,032 s      44.1 %
 *
 * 53 real stoppages, and 12.4 hours of real downtime, erased — and a line
 * that was down more than half the day reported as running 96 % of it.
 *
 * What these tests can pin, with a fake pool and no SQL engine, is the
 * STRUCTURAL property that makes the fix work: the epoch predicate has to sit
 * INSIDE the `ordered` CTE, where the window function reads its rows. Applied
 * to the CTE's output instead it would compile, run, and be wrong — the gap
 * would already have been measured against the wrong previous cone, and the
 * surviving rows would carry the pooled numbers above.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getDowntime, getStoppagePatterns } from './downtime.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

function fakePool(present: { tbl: string; epoch_id: number | null; n: number }[]) {
  const statements: Stmt[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => {
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) return { recordset: present };
          if (sql.includes('FROM sms.source_epoch')) {
            return { recordset: [
              { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
              { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
              { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: 'July copy - cones' },
            ] };
          }
          statements.push({ sql, inputs: new Map(inputs) });
          if (sql.includes('COUNT(*) n, MIN(')) return { recordset: [{ n: 0, first_ts: null, last_ts: null }] };
          return { recordset: [] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

/**
 * The body of the `;WITH ordered AS ( … )` CTE, by matching parentheses — not
 * by the first `)`, which belongs to `LAG(production_ts_utc)`. The point of
 * the helper is that the assertion must fail if the predicate is moved OUTSIDE
 * the CTE, which is the plausible wrong fix.
 */
function cteBody(sql: string): string {
  const open = sql.indexOf('WITH ordered AS (') + 'WITH ordered AS '.length;
  expect(open).toBeGreaterThan('WITH ordered AS '.length - 1);
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open, i);
  }
  throw new Error('unbalanced CTE');
}

const OVERLAP = [
  { tbl: 'cone_event', epoch_id: 9, n: 3089 },
  { tbl: 'cone_event', epoch_id: 13, n: 7470 },
];

describe('getDowntime — one generation only', () => {
  it('puts the epoch predicate INSIDE the CTE, where LAG reads its rows', async () => {
    const { pool, statements } = fakePool(OVERLAP);
    await getDowntime(pool, 1, '2026-09-01', 120);

    const gapQuery = statements.find((s) => s.sql.includes('LAG(production_ts_utc)'))!;
    expect(gapQuery).toBeDefined();
    expect(cteBody(gapQuery.sql)).toContain('source_epoch = @gec0');
    // The real generation, not the newer simulator one.
    expect(gapQuery.inputs.get('gec0')).toBe(9);
  });

  it('constrains the span, the gaps and the hourly counts to the SAME generation', async () => {
    const { pool, statements } = fakePool(OVERLAP);
    await getDowntime(pool, 1, '2026-09-01', 120);

    expect(statements).toHaveLength(3); // span, gaps, hourly
    for (const s of statements) {
      expect(s.sql).toContain('source_epoch = @gec0');
      expect(s.inputs.get('gec0')).toBe(9);
    }
  });

  it('reports which generation the day was measured from, and what was left out', async () => {
    const { pool } = fakePool(OVERLAP);
    const d = await getDowntime(pool, 1, '2026-09-01', 120);
    expect(d.generationNote?.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(d.generationNote?.spansGenerations).toBe(true);
    expect(d.generationNote?.otherGenerationExcluded).toBe(7470);
  });

  it('a day inside ONE generation is unconstrained and claims no exclusion', async () => {
    const { pool, statements } = fakePool([{ tbl: 'cone_event', epoch_id: 9, n: 3089 }]);
    const d = await getDowntime(pool, 1, '2026-09-01', 120);
    expect(d.generationNote?.spansGenerations).toBe(false);
    expect(d.generationNote?.otherGenerationExcluded).toBe(0);
    for (const s of statements) expect(s.inputs.get('gec0')).toBe(9);
  });
});

describe('getStoppagePatterns — one generation only', () => {
  it('constrains the CTE, not just its output, across a range spanning IFL\'s 2026-08-05 rebuild', async () => {
    // Two REAL generations, no simulator: the case that exists at the plant.
    const { pool, statements } = fakePool([
      { tbl: 'cone_event', epoch_id: 1, n: 75178 },
      { tbl: 'cone_event', epoch_id: 9, n: 77493 },
    ]);
    const p = await getStoppagePatterns(pool, 1, '2026-07-01', '2026-08-20', 120);

    const gapQuery = statements.find((s) => s.sql.includes('LAG(production_ts_utc)'))!;
    expect(cteBody(gapQuery.sql)).toContain('source_epoch = @gec0');
    expect(gapQuery.inputs.get('gec0')).toBe(9);
    // 75,178 of IFL's own July cones are not in this gap stream. Saying so is
    // the whole obligation: excluding them is right, excluding them quietly
    // would make the period look fully represented.
    expect(p.generationNote?.otherGenerationExcluded).toBe(75178);
    expect(p.generationNote?.generation?.ordinal).toBe(3);
  });

  it('constrains the day count with the same predicate, so dayCount matches the stream', async () => {
    const { pool, statements } = fakePool(OVERLAP);
    await getStoppagePatterns(pool, 1, '2026-08-21', '2026-09-07', 120);
    const dayQuery = statements.find((s) => s.sql.includes('COUNT(DISTINCT shift_date)'))!;
    expect(dayQuery.sql).toContain('source_epoch = @gec0');
    expect(dayQuery.inputs.get('gec0')).toBe(9);
  });
});
