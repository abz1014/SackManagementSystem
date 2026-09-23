/**
 * getWeightSpc's generation scope (DEFECTS.md D-10 follow-up, 23 Sep 2026;
 * REWRITTEN WS-SP, 23 Sep 2026). getWeightSpc used to carry its own
 * hand-rolled copy of the "prefer a real generation over a simulator one,
 * then newest ordinal" rule, tested here against a fake pool that answered
 * ITS OWN one-shot `LEFT JOIN sms.source_epoch` query. That query shape is
 * gone — spc.ts now calls the shared `resolveGenerationScope` (generation.ts)
 * exactly like the other 18 call sites, so this file is rewritten against
 * `testkit/generations.ts`'s `fakeGenerationPool`, which answers
 * `resolveGenerationScope`'s own two-query protocol (a UNION ALL present-rows
 * count, then a `sms.source_epoch` read) — see that module's header for why
 * the old SQL-matching fixture here could not serve a caller going through
 * the shared resolver.
 *
 * Also pinned here: the choice is NOT simply "newest generation present" —
 * a real (ifl_copy/ifl_live) generation is preferred over a simulator one
 * even when the simulator is the more recently opened epoch, because the
 * simulator does not reproduce the plant's between-subgroup wander (see the
 * file header note in spc.ts and CLAUDE.md's live-rehearsal warning) and
 * would corrupt the MR̄ this pass's own X̄ band depends on.
 */
import type { ConnectionPool } from 'mssql';
import { describe, expect, it } from 'vitest';
import { getWeightSpc, type SpecLimits } from './spc.js';
import {
  fakeGenerationPool,
  ONE_REAL_GENERATION,
  TWO_GENERATIONS_WITH_MISLABELLED_SIMULATOR,
  type GenerationSpecEntry,
} from '../testkit/generations.js';

const SPEC: SpecLimits = { usl: null, lsl: null, nominal: null, source: 'none' };
const PLAUS = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

/**
 * `fakeGenerationPool` answers ONLY `resolveGenerationScope`'s own two
 * queries and returns `{recordset: []}` for anything else — by design (see
 * that module's header: "the caller stubs those itself"). `getWeightSpc`'s
 * own summary query (`sumRes.recordset[0]!`) is destructured unconditionally,
 * so it needs a non-empty stub the way this file's old hand-rolled `fakePool`
 * gave it. Every other downstream query (median, subgroups, stations,
 * histogram) tolerates an empty recordset, so only the summary query needs
 * this.
 */
function fakeSpcPool(spec: readonly GenerationSpecEntry[]) {
  const base = fakeGenerationPool(spec);
  const pool = {
    request: () => {
      const req = base.pool.request() as unknown as {
        input: (n: string, t: unknown, v: unknown) => unknown;
        query: (sql: string) => Promise<{ recordset: unknown[] }>;
      };
      const origQuery = req.query.bind(req);
      req.query = (async (sql: string) => {
        const res = await origQuery(sql);
        if (res.recordset.length === 0 && sql.includes('STDEV(CAST(') && sql.includes(') excluded')) {
          return { recordset: [{ n: 0, mean: null, sd: null, excluded: 0, minTs: null, maxTs: null, occDays: 0 }] };
        }
        return res;
      }) as typeof req.query;
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls: base.calls };
}

describe('getWeightSpc — generation scope (via the shared resolveGenerationScope)', () => {
  it('with one generation in the window, applies no predicate and reports nothing excluded', async () => {
    const { pool, calls } = fakeSpcPool(ONE_REAL_GENERATION);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-06', '2026-09-06', SPEC, PLAUS);
    expect(d.generation).toEqual({ epochId: 9, ordinal: 3, label: 'September copy', provenance: 'ifl_copy' });
    expect(d.otherGenerationExcluded).toBe(0);
    expect(d.spansGenerations).toBe(false);
    // The predicate is still bound (idempotent — it's the only generation
    // present anyway), consistently naming epoch 9 wherever it appears.
    const bound = calls.filter((c) => c.params.has('gec0'));
    expect(bound.length).toBeGreaterThan(0);
    for (const c of bound) expect(c.params.get('gec0')).toBe(9);
  });

  it('prefers the REAL generation over a newer simulator one, and reports the excluded row count', async () => {
    // Real September copy (ordinal 3, epoch 9, 55,058 cones in this window)
    // vs a simulator run at a HIGHER ordinal (4, epoch 13, 135,226 cones).
    // Picking "newest" or "most rows" naively would keep the simulator; the
    // rule must keep the real data instead.
    const { pool, calls } = fakeSpcPool(TWO_GENERATIONS_WITH_MISLABELLED_SIMULATOR);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-09-22', SPEC, PLAUS);
    expect(d.generation?.epochId).toBe(9);
    expect(d.generation?.provenance).toBe('ifl_copy');
    expect(d.otherGenerationExcluded).toBe(135_226);
    expect(d.spansGenerations).toBe(true);
    // Every downstream query bound the chosen (real) epoch, not the simulator's.
    const bound = calls.filter((c) => c.params.has('gec0'));
    expect(bound.length).toBeGreaterThan(0);
    for (const c of bound) expect(c.params.get('gec0')).toBe(9);
    for (const c of bound) expect(c.sql).toContain('source_epoch = @gec0');
  });

  it('trusts source_db, not the provenance column, to identify a simulator generation — pinned against a live finding (23 Sep 2026): epoch 13 on this dev copy is registered with provenance=\'ifl_copy\' despite being scripts/simulate-plant.mjs output (source_db DATA_TP1U2_SIM)', async () => {
    const spec: GenerationSpecEntry[] = [
      {
        epoch: 9,
        ordinal: 3,
        db: 'DATA_TP1U2_SEP07',
        prov: 'ifl_copy',
        label: 'September copy',
        rows: { cone_event: 132_552 },
      },
      // Mislabeled exactly like the real epoch 13 row: provenance says 'ifl_copy', but source_db betrays it.
      {
        epoch: 13,
        ordinal: 4,
        db: 'DATA_TP1U2_SIM',
        prov: 'ifl_copy',
        label: 'pack1_TP1U2 gen 4',
        rows: { cone_event: 212_873 },
      },
    ];
    const { pool } = fakeSpcPool(spec);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-08-01', '2026-09-22', SPEC, PLAUS);
    // Must still pick the real generation (9), not the higher-ordinal simulator one (13),
    // even though provenance alone would have said both were 'ifl_copy'.
    expect(d.generation?.epochId).toBe(9);
    expect(d.otherGenerationExcluded).toBe(212_873);
  });

  it('falls back to the newest simulator generation when no real generation is present', async () => {
    const spec: GenerationSpecEntry[] = [
      { epoch: 13, ordinal: 5, db: 'DATA_TP1U2_SIM', prov: 'simulator', label: 'Simulator run', rows: { cone_event: 40 } },
      { epoch: 7, ordinal: 2, db: 'DATA_TP1U2_SIM', prov: 'simulator', label: 'Old simulator', rows: { cone_event: 10 } },
    ];
    const { pool } = fakeSpcPool(spec);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-09-10', '2026-09-20', SPEC, PLAUS);
    expect(d.generation?.epochId).toBe(13);
    expect(d.generation?.provenance).toBe('simulator');
    expect(d.otherGenerationExcluded).toBe(10);
  });

  it('with no epoch data at all (a fixture or a pre-epoch mirror), applies no predicate rather than erroring', async () => {
    const { pool } = fakeSpcPool([]);
    const d = await getWeightSpc(pool, 1, 'cone', '2026-09-01', '2026-09-07', SPEC, PLAUS);
    expect(d.generation).toBeNull();
    expect(d.otherGenerationExcluded).toBe(0);
    expect(d.spansGenerations).toBe(false);
  });

  it('sack queries scope on sack_event, independently of cone_event\'s own generation mix', async () => {
    // cone_event has two generations in this window; sack_event has only one.
    // A sack chart must not be starved or misscoped by cone_event's shape —
    // resolveGenerationScope is called with `[eventTable]` alone (23 Sep 2026
    // fix), so each type resolves against its OWN table's rows only.
    const spec: GenerationSpecEntry[] = [
      {
        epoch: 9,
        ordinal: 3,
        db: 'DATA_TP1U2_SEP07',
        prov: 'ifl_copy',
        label: 'September copy',
        rows: { cone_event: 55_058, sack_event: 5_435 },
      },
      {
        epoch: 13,
        ordinal: 4,
        db: 'DATA_TP1U2_SIM',
        prov: 'ifl_copy',
        label: 'pack1_TP1U2 gen 4',
        rows: { cone_event: 135_226 }, // no sack_event rows for this generation
      },
    ];
    const { pool, calls } = fakeSpcPool(spec);
    const d = await getWeightSpc(pool, 1, 'sack', '2026-08-01', '2026-09-22', SPEC, PLAUS);
    expect(d.generation?.epochId).toBe(9);
    expect(d.otherGenerationExcluded).toBe(0); // no other sack_event rows to exclude
    expect(d.spansGenerations).toBe(false);
    const bound = calls.filter((c) => c.params.has('ges0'));
    expect(bound.length).toBeGreaterThan(0);
    for (const c of bound) expect(c.params.get('ges0')).toBe(9);
  });
});
