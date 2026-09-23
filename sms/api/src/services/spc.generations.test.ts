/**
 * getWeightSpc's generation predicate (DEFECTS.md D-10 follow-up, 23 Sep
 * 2026). Until this pass, getWeightSpc carried NO generation filter at all —
 * unlike rejectSpc.ts, which has refused to pool p̄ across the 5 Aug rebuild
 * since roadmap Phase 5. On the dev copy that meant silently pooling real
 * epoch-9 cones with plant-simulator epoch-13 cones into one control chart
 * whenever a query's date range spanned both.
 *
 * Also pinned here: the choice is NOT simply "newest generation present" —
 * a real (ifl_copy/ifl_live) generation is preferred over a simulator one
 * even when the simulator is the more recently opened epoch, because the
 * simulator does not reproduce the plant's between-subgroup wander (see the
 * file header note in spc.ts and CLAUDE.md's live-rehearsal warning) and
 * would corrupt the MR̄ this pass's own X̄ band depends on.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getWeightSpc, type SpecLimits } from './spc.js';

interface Captured { sql: string; params: Map<string, unknown> }
type GenRow = {
  epoch_id: number | null;
  gen: number | null;
  label: string | null;
  provenance: string | null;
  source_db: string | null;
  n: number;
};

function fakePool(genRows: GenRow[]): { pool: ConnectionPool; calls: Captured[] } {
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
          calls.push({ sql, params });
          if (sql.includes('LEFT JOIN sms.source_epoch')) return { recordset: genRows };
          if (sql.includes('STDEV(CAST(') && sql.includes(') excluded')) {
            return { recordset: [{ n: 0, mean: null, sd: null, excluded: 0, minTs: null, maxTs: null, occDays: 0 }] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const SPEC: SpecLimits = { usl: null, lsl: null, nominal: null, source: 'none' };
const PLAUS = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

describe('getWeightSpc — generation predicate', () => {
  it('with one generation in the window, applies no predicate and reports nothing excluded', async () => {
    const genRows: GenRow[] = [{ epoch_id: 9, gen: 3, label: 'Sept copy', provenance: 'ifl_copy', source_db: 'DATA_TP1U2_SEP07', n: 150 }];
    const { pool, calls } = fakePool(genRows);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-06', '2026-09-06', SPEC, PLAUS);
    expect(d.generation).toEqual({ epochId: 9, ordinal: 3, label: 'Sept copy', provenance: 'ifl_copy' });
    expect(d.otherGenerationExcluded).toBe(0);
    expect(d.spansGenerations).toBe(false);
    // The predicate is still bound (idempotent — it's the only generation
    // present anyway), consistently naming epoch 9 wherever it appears.
    const bound = calls.filter((c) => c.params.has('genEpoch'));
    expect(bound.length).toBeGreaterThan(0);
    for (const c of bound) expect(c.params.get('genEpoch')).toBe(9);
  });

  it('prefers the REAL generation over a newer simulator one, and reports the excluded row count', async () => {
    // Real Sept copy (ordinal 3, 150 rows) vs a simulator run opened AFTER it
    // (ordinal 5, higher — 40 rows). Picking "newest" naively would keep the
    // simulator; the fix must keep the real data instead.
    const genRows: GenRow[] = [
      { epoch_id: 9, gen: 3, label: 'Sept copy', provenance: 'ifl_copy', source_db: 'DATA_TP1U2_SEP07', n: 150 },
      { epoch_id: 13, gen: 5, label: 'Simulator run', provenance: 'simulator', source_db: 'DATA_TP1U2_SIM', n: 40 },
    ];
    const { pool, calls } = fakePool(genRows);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-09-15', SPEC, PLAUS);
    expect(d.generation?.epochId).toBe(9);
    expect(d.generation?.provenance).toBe('ifl_copy');
    // Row counts before/after: 190 total rows in the window, 150 kept (real), 40 excluded (simulator).
    expect(d.otherGenerationExcluded).toBe(40);
    expect(d.spansGenerations).toBe(true);
    // Every downstream query bound the chosen epoch, not the simulator's.
    const bound = calls.filter((c) => c.params.has('genEpoch'));
    expect(bound.length).toBeGreaterThan(0);
    for (const c of bound) expect(c.params.get('genEpoch')).toBe(9);
    for (const c of bound) expect(c.sql).toContain('source_epoch=@genEpoch');
  });

  it('trusts source_db, not the provenance column, to identify a simulator generation — pinned against a live finding (23 Sep 2026): epoch 13 on this dev copy is registered with provenance=\'ifl_copy\' despite being scripts/simulate-plant.mjs output (source_db DATA_TP1U2_SIM)', async () => {
    const genRows: GenRow[] = [
      { epoch_id: 9, gen: 3, label: 'Sept copy', provenance: 'ifl_copy', source_db: 'DATA_TP1U2_SEP07', n: 132552 },
      // Mislabeled exactly like the real epoch 13 row: provenance says 'ifl_copy', but source_db betrays it.
      { epoch_id: 13, gen: 4, label: 'pack1_TP1U2 gen 4', provenance: 'ifl_copy', source_db: 'DATA_TP1U2_SIM', n: 212873 },
    ];
    const { pool } = fakePool(genRows);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-09-22', SPEC, PLAUS);
    // Must still pick the real generation (9), not the higher-ordinal simulator one (13),
    // even though provenance alone would have said both were 'ifl_copy'.
    expect(d.generation?.epochId).toBe(9);
    expect(d.otherGenerationExcluded).toBe(212873);
  });

  it('falls back to the newest simulator generation when no real generation is present', async () => {
    const genRows: GenRow[] = [
      { epoch_id: 13, gen: 5, label: 'Simulator run', provenance: 'simulator', source_db: 'DATA_TP1U2_SIM', n: 40 },
      { epoch_id: 7, gen: 2, label: 'Old simulator', provenance: 'simulator', source_db: 'DATA_TP1U2_SIM', n: 10 },
    ];
    const { pool } = fakePool(genRows);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-09-10', '2026-09-20', SPEC, PLAUS);
    expect(d.generation?.epochId).toBe(13);
    expect(d.generation?.provenance).toBe('simulator');
    expect(d.otherGenerationExcluded).toBe(10);
  });

  it('rows with no source_epoch at all (pre-epoch data) are excluded once a real generation is chosen', async () => {
    const genRows: GenRow[] = [
      { epoch_id: 9, gen: 3, label: 'Sept copy', provenance: 'ifl_copy', source_db: 'DATA_TP1U2_SEP07', n: 150 },
      { epoch_id: null, gen: null, label: null, provenance: null, source_db: null, n: 25 },
    ];
    const { pool } = fakePool(genRows);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-07-01', '2026-09-06', SPEC, PLAUS);
    expect(d.generation?.epochId).toBe(9);
    expect(d.otherGenerationExcluded).toBe(25);
  });

  it('with no epoch data at all (a fixture or a pre-epoch mirror), applies no predicate rather than erroring', async () => {
    const { pool } = fakePool([]);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-09-01', '2026-09-07', SPEC, PLAUS);
    expect(d.generation).toBeNull();
    expect(d.otherGenerationExcluded).toBe(0);
    expect(d.spansGenerations).toBe(false);
  });
});
