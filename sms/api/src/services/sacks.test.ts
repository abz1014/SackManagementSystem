/**
 * The sack summary (roadmap Phase 7, 15 Sep 2026) over a dataset fake: the
 * in-range share is the scale's bit over sacks that carry one, the average
 * is over the plausible population with the excluded count stated, kg
 * follows the weight rule like production.ts, cones per sack is approximate
 * and says so, and the product filter never touches the unattributed count.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getSackSummary } from './sacks.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

/** Answers each query by what it is, from one fake set of facts. */
function datasetPool(basis: 'as_recorded' | 'net') {
  const statements: Stmt[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => {
          // The source-generation probe (generation.ts `resolveGenerationScope`,
          // 23 Sep 2026) runs before every other query in this service. It is
          // answered here as "no epoch-tagged rows", which resolves to the
          // UNSCOPED no-op, so the cases below keep testing exactly what they
          // were written to test. It is intercepted BEFORE `statements` is
          // appended to, so it does not shift the positional assertions those
          // cases make about which query came first. The predicate itself is
          // covered by generation.test.ts and by the epoch cases at the end of
          // this file.
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) return { recordset: [] };
          statements.push({ sql, inputs: new Map(inputs) });
          if (sql.includes('sms.plausibility_rule')) return { recordset: [{ cl: 1500, ch: 2100, sl: 40, sh: 60 }] };
          if (sql.includes('sms.weight_rule')) return { recordset: [{ basis, tare: 0.5 }] };
          if (sql.includes('FROM sms.cone_event')) return { recordset: [{ n: 250 }] };
          if (sql.includes('no_attr')) return { recordset: [{ n: 12, no_attr: 2 }] };
          if (sql.includes('GROUP BY e.shift_code')) {
            return { recordset: [
              { grp: 'night', n: 4, kg: 200, inr: 4, noflag: 0, implausible: 0, plaus_kg: 200, plaus_n: 4 },
              { grp: 'morning', n: 6, kg: 300.3, inr: 5, noflag: 0, implausible: 1, plaus_kg: 250, plaus_n: 5 },
            ] };
          }
          if (sql.includes('GROUP BY e.material_id')) {
            return { recordset: [
              { grp: 21, n: 8, kg: 400, inr: 7, noflag: 0, implausible: 1, plaus_kg: 350, plaus_n: 7, product_name: 'Cotton 30s' },
              { grp: null, n: 2, kg: 100.3, inr: 2, noflag: 0, implausible: 0, plaus_kg: 100.3, plaus_n: 2, product_name: null },
            ] };
          }
          // the total
          return { recordset: [{ grp: 'total', n: 10, kg: 500.3, inr: 9, noflag: 1, implausible: 1, plaus_kg: 450, plaus_n: 9 }] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

describe('getSackSummary', () => {
  it('count, kg, average over the plausible population, in-range share of the flagged, cones per sack', async () => {
    const { pool, statements } = datasetPool('as_recorded');
    const s = await getSackSummary(pool, 1, { from: '2026-09-01', to: '2026-09-07' });
    expect(s.totals.sacks).toBe(10);
    expect(s.totals.kg).toBe(500.3);
    expect(s.totals.avgKg).toBe(50); // 450 / 9 plausible
    expect(s.totals.implausible).toBe(1);
    expect(s.totals.inRange).toBe(9);
    expect(s.totals.noFlag).toBe(1);
    expect(s.totals.inRangePct).toBe(100); // 9 of the 9 that carry a bit
    expect(s.totals.cones).toBe(250);
    expect(s.totals.conesPerSack).toBe(25);
    expect(s.conesPerSackApproximate).toBe(true);
    expect(s.sackTimeIsInsertTime).toBe(true);
    expect(s.machineLevel.enabled).toBe(false);
    expect(s.plausibility).toEqual({ loKg: 40, hiKg: 60 });
    // shifts in the plant's order, not the database's
    expect(s.byShift.map((x) => x.shift)).toEqual(['morning', 'night']);
    expect(s.byShift[0]!.avgKg).toBe(50);
    expect(s.byShift[0]!.inRangePct).toBe(83.3);
    // products by count, the no-product bucket named as such
    expect(s.byProduct[0]).toMatchObject({ materialId: 21, productName: 'Cotton 30s', sacks: 8 });
    expect(s.byProduct[1]).toMatchObject({ materialId: null, productName: null, sacks: 2 });
    expect(s.unattributed).toEqual({ rows: 2, of: 12 });
    // every sack query binds the line and the period; the plausibility bounds are parameters
    for (const st of statements.filter((x) => x.sql.includes('sms.sack_event'))) {
      expect(st.inputs.get('line')).toBe(1);
      expect(st.inputs.get('from')).toBe('2026-09-01');
      expect(st.inputs.get('to')).toBe('2026-09-07');
    }
    const agg = statements.find((x) => x.sql.includes("'total' AS grp"))!;
    expect(agg.inputs.get('spLo')).toBe(40);
    expect(agg.inputs.get('spHi')).toBe(60);
    expect(agg.sql).toMatch(/e\.weight_kg BETWEEN @spLo AND @spHi/);
  });

  it('applies the net basis to kg and the average exactly as production.ts applies it to the totals', async () => {
    const { pool } = datasetPool('net');
    const s = await getSackSummary(pool, 1, { from: '2026-09-01', to: '2026-09-07' });
    expect(s.weightBasis).toBe('net');
    expect(s.totals.kg).toBe(495.3); // 500.3 − 10 × 0.5
    expect(s.totals.avgKg).toBe(49.5); // (450 − 9 × 0.5) / 9
  });

  it('a product filter reaches the sack and cone queries but not the unattributed count', async () => {
    const { pool, statements } = datasetPool('as_recorded');
    await getSackSummary(pool, 1, { from: '2026-09-01', to: '2026-09-07', product: 21, shift: 'night', tsTo: '2026-09-07T20:00:00.000Z' });
    const filtered = statements.filter((x) => x.sql.includes('material_id = @product'));
    const unattributed = statements.find((x) => x.sql.includes('no_attr'))!;
    expect(filtered.length).toBeGreaterThanOrEqual(4); // total, by shift, by product, cones
    expect(unattributed.sql).not.toMatch(/@product/);
    expect(unattributed.sql).toMatch(/shift_code = @shift/);
    expect(unattributed.inputs.get('shift')).toBe('night');
    expect(unattributed.inputs.get('tsTo')).toBe(new Date('2026-09-07T20:00:00.000Z').getTime());
  });
});

/**
 * SOURCE GENERATIONS (generation.ts, 23 Sep 2026). `getSackSummary` divides a
 * sack aggregate by a cone count. Before this pass both sides pooled every
 * generation, so over 21 Aug - 7 Sep on the development sidecar the screen
 * read 8,509 sacks and 190,306 cones when IFL's own September generation held
 * 2,310 and 55,058 — and cones-per-sack was a ratio across two physically
 * different tables.
 *
 * The two tables' epochs DIFFER inside one generation (sack1_TP1U2 gen 3 is
 * epoch 10, pack1_TP1U2 gen 3 is epoch 9), which is the thing most easily got
 * wrong, so it is asserted directly.
 */
function epochAwarePool() {
  const statements: Stmt[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => {
          statements.push({ sql, inputs: new Map(inputs) });
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) {
            return { recordset: [
              { tbl: 'cone_event', epoch_id: 9, n: 55058 },
              { tbl: 'cone_event', epoch_id: 13, n: 135248 },
              { tbl: 'sack_event', epoch_id: 10, n: 2310 },
              { tbl: 'sack_event', epoch_id: 14, n: 6199 },
            ] };
          }
          if (sql.includes('FROM sms.source_epoch')) {
            return { recordset: [
              { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
              { epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - sacks' },
              { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
              { epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4' },
            ] };
          }
          if (sql.includes('sms.plausibility_rule')) return { recordset: [{ cl: 1500, ch: 2100, sl: 40, sh: 60 }] };
          if (sql.includes('sms.weight_rule')) return { recordset: [{ basis: 'as_recorded', tare: 0 }] };
          if (sql.includes('FROM sms.cone_event')) return { recordset: [{ n: 55058 }] };
          if (sql.includes('no_attr')) return { recordset: [{ n: 2310, no_attr: 0 }] };
          return { recordset: [{ grp: 'total', n: 2310, kg: 0, inr: 0, noflag: 0, implausible: 0, plaus_kg: 0, plaus_n: 0 }] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

describe('getSackSummary — source generations', () => {
  it('binds the SACK epoch to sack queries and the CONE epoch to the cone count', async () => {
    const { pool, statements } = epochAwarePool();
    await getSackSummary(pool, 1, { from: '2026-08-21', to: '2026-09-07' });

    const sackQueries = statements.filter(
      (s) => s.sql.includes('FROM sms.sack_event') && !s.sql.includes('AS tbl'),
    );
    expect(sackQueries.length).toBeGreaterThan(0);
    for (const s of sackQueries) {
      expect(s.sql).toMatch(/source_epoch = @ges0/);
      expect(s.inputs.get('ges0')).toBe(10);
    }

    const coneQuery = statements.find(
      (s) => s.sql.includes('FROM sms.cone_event') && !s.sql.includes('AS tbl'),
    )!;
    expect(coneQuery.sql).toMatch(/source_epoch = @gec0/);
    // 9, not 10: one generation, different epoch row per source table.
    expect(coneQuery.inputs.get('gec0')).toBe(9);
  });

  it('states which generation it used and how many rows it left out', async () => {
    const { pool } = epochAwarePool();
    const s = await getSackSummary(pool, 1, { from: '2026-08-21', to: '2026-09-07' });
    expect(s.generationNote?.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(s.generationNote?.generation?.simulator).toBe(false);
    expect(s.generationNote?.spansGenerations).toBe(true);
    // 135,248 simulator cones + 6,199 simulator sacks, none of them counted.
    expect(s.generationNote?.otherGenerationExcluded).toBe(141447);
  });
});
