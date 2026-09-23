/**
 * Reject SPC across a source-generation boundary (SEPT-2026-EPOCH-DECISION §4.4).
 *
 * IFL rebuilt their tables on 2026-08-05; the app DB holds the generation before
 * and the one after with a hole between them (10 Jul → 5 Aug). Three things go
 * wrong over such a range, all pinned here:
 *  - one p̄ pooled across both generations gives every bucket a band nothing
 *    was measured against;
 *  - "episodes" walked by array adjacency merge an out-of-control 10 Jul and an
 *    out-of-control 5 Aug into one 26-day "burst";
 *  - and the one this file's first version missed: cones and rejects live in
 *    DIFFERENT source tables, so the same generation carries DIFFERENT epoch
 *    ids on each (cones 9, rejects 11). Keyed on the epoch id, a day's cones
 *    and rejects never met and every "generation" read as p̄ 0 or p̄ 1 — the
 *    live API showed exactly that. The fixture below therefore uses distinct
 *    ids for cones and rejects, mapped to one ordinal, as the real registry does.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getRejectSpc } from './rejectSpc.js';
import { resolveGenerationScope } from './generation.js';

type Row = { source_epoch: number; bucket_ts: Date; n: number };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The registry: epoch id -> generation ordinal, per source table. */
const REGISTRY = [
  { epoch_id: 1, generation_ordinal: 1 }, // July cones
  { epoch_id: 3, generation_ordinal: 1 }, // July quality rejects
  { epoch_id: 9, generation_ordinal: 3 }, // Sept cones
  { epoch_id: 11, generation_ordinal: 3 }, // Sept quality rejects
];

/**
 * Serves getRejectSpc's queries in order: registry, produced, rejects,
 * all-rejects (only for a narrowed numerator — every test below uses
 * `quality`, so this always runs), unmatched-rejects (always, last — the 23
 * Sep 2026 denominator correction). These fixtures treat every reject as
 * UNMATCHED (the 5th arg repeats the rejects rows), which keeps this file's
 * arithmetic (540 / 14,540) unchanged: this file tests generation-boundary
 * handling, not the matched/unmatched split, which rejectSpc.test.ts covers.
 */
function fakePool(...responses: unknown[][]): ConnectionPool {
  let i = 0;
  const req = { input: () => req, query: async () => ({ recordset: responses[i++] ?? [] }) };
  return { request: () => req } as unknown as ConnectionPool;
}

// Two generations, two days each. In each, one day is out of control (400
// rejects on 7,000 cones ≈ 5.4% against that generation's p̄ ≈ 3.7% and a UCL
// ≈ 4.4%). 10 Jul (gen 1) and 5 Aug (gen 3) sit side by side in the bucket
// array and are both out of control — the pair that used to merge.
const produced: Row[] = [
  { source_epoch: 1, bucket_ts: day('2026-07-09'), n: 7000 },
  { source_epoch: 1, bucket_ts: day('2026-07-10'), n: 7000 },
  { source_epoch: 9, bucket_ts: day('2026-08-05'), n: 7000 },
  { source_epoch: 9, bucket_ts: day('2026-08-06'), n: 7000 },
];
const rejects: Row[] = [
  { source_epoch: 3, bucket_ts: day('2026-07-09'), n: 140 },
  { source_epoch: 3, bucket_ts: day('2026-07-10'), n: 400 },
  { source_epoch: 11, bucket_ts: day('2026-08-05'), n: 400 },
  { source_epoch: 11, bucket_ts: day('2026-08-06'), n: 140 },
];

describe('getRejectSpc across a generation boundary', () => {
  it('joins cones and rejects of one generation despite their different epoch ids', async () => {
    const d = await getRejectSpc(fakePool(REGISTRY, produced, rejects, rejects, rejects), 1, '2026-07-01', '2026-08-31', 'day', 'quality');

    // Four days, not eight: each day's cones and rejects are ONE cell.
    expect(d.buckets).toHaveLength(4);
    expect(d.buckets.map((b) => b.generation)).toEqual([1, 1, 3, 3]);
    expect(d.spansGenerations).toBe(true);
    expect(d.generations.map((g) => g.generation)).toEqual([1, 3]);
    // Each generation's own p̄: 540 / (14,000 + 540). Not 0, not 1.
    for (const g of d.generations) expect(g.pBar).toBeCloseTo(540 / 14540, 5);
    expect(d.pBar).toBe(d.generations[1]!.pBar);
    expect(d.buckets.map((b) => b.outOfControl)).toEqual([false, true, true, false]);
  });

  it('does NOT join out-of-control buckets across the hole into one episode', async () => {
    const d = await getRejectSpc(fakePool(REGISTRY, produced, rejects, rejects, rejects), 1, '2026-07-01', '2026-08-31', 'day', 'quality');
    expect(d.episodes).toHaveLength(2);
    expect(d.episodes.every((e) => e.bucketCount === 1)).toBe(true);
  });

  it('totalProduced/totalRejects match the SAME generation pBar describes, not the whole pooled range (RT-002/RT-029, 23 Sep 2026)', async () => {
    const d = await getRejectSpc(fakePool(REGISTRY, produced, rejects, rejects, rejects), 1, '2026-07-01', '2026-08-31', 'day', 'quality');
    // Before this fix: totalProduced/totalRejects were summed over BOTH
    // generations (28,000 / 1,080) while pBar, two lines above in
    // rejectSpc.ts, was already the NEWEST generation's alone (540/14,540) —
    // the numerator and denominator `attention.ts` prints beside pBar in one
    // sentence disagreed with pBar about which range they covered.
    expect(d.totalProduced).toBe(d.generations[1]!.totalProduced);
    expect(d.totalRejects).toBe(d.generations[1]!.totalRejects);
    expect(d.totalProduced).toBe(14000); // generation 3 (August) alone: 7,000 + 7,000
    expect(d.totalRejects).toBe(540); // generation 3 alone: 400 + 140
    expect(d.totalProduced).not.toBe(28000); // the old, pooled-across-both-generations total
    expect(d.totalRejects).not.toBe(1080);
  });

  it('is unchanged for a range inside one generation', async () => {
    const one = (rows: Row[], ...ids: number[]) => rows.filter((r) => ids.includes(r.source_epoch));
    const d = await getRejectSpc(
      fakePool(REGISTRY, one(produced, 9), one(rejects, 11), one(rejects, 11), one(rejects, 11)),
      1, '2026-08-01', '2026-08-31', 'day', 'quality',
    );
    expect(d.spansGenerations).toBe(false);
    expect(d.generations).toHaveLength(1);
    expect(d.pBar).toBeCloseTo(540 / 14540, 5);
  });
});

/**
 * WS-RG2 (23 Sep 2026 independent verification pass, gap 2) — THE DRIFT
 * PROOF `53ae8a3`'s own reasoning asked for.
 *
 * `rejectSpc.ts` keeps its own copy of the "prefer a REAL generation over a
 * simulator one, then newest ordinal" rule (its `simulatorOrdinals`/
 * `preferredOrdinals` logic, ~line 239-404) rather than calling
 * `resolveGenerationScope` (generation.ts) directly, because this file's
 * `perGen` is keyed on ORDINAL ALONE (built from data this function already
 * fetched, bucketed by generation) while `resolveGenerationScope` is keyed
 * on `(source_db, ordinal)` and issues its OWN queries — `spc.ts`'s own
 * comment on its identical call (spc.ts:501-521, "unlike rejectSpc.ts, which
 * needs an ordinal-keyed `perGen` shape the canonical ... `GenerationScope`
 * doesn't provide") already reaches the same conclusion independently. This
 * pass re-examined that reasoning rather than taking it on faith, and it
 * holds: `getRejectSpc` cannot swap in `resolveGenerationScope` without
 * reshaping its whole bucket-then-group pipeline into a second query round
 * trip per table, which `spc.ts`'s "ONE scope, ONE table" shape does not
 * need and this file's does not either — its per-bucket partitioning is the
 * reason `generation.ts`'s own file header lists `rejectSpc.ts` as the one
 * caller PARTITION-AND-REPORT is right for rather than restrict-to-one.
 *
 * generation.ts is this workstream's READ-ONLY file (see the brief), so the
 * `isSimulator` predicate itself cannot be exported and imported here either
 * — the only way to remove the duplication a different way from "import the
 * whole scope resolver" would be editing a file outside this pass's scope,
 * which is reported rather than done quietly.
 *
 * So the copy stays, and per the brief's own two-honest-outcomes rule, the
 * obligation that follows is a test that FAILS if the two rules are ever
 * deliberately made to disagree — not "they match today" (53ae8a3's own
 * fixture already proved that once and D-17 still happened). This test
 * calls BOTH rules directly, on the SAME registry shape (a simulator
 * generation ordinally NEWER than the real one — the exact live-dev-sidecar
 * arrangement `rejectRateThreeWayAgreement.test.ts`'s SIM_NEWER_REGISTRY
 * fixture already pins for production.ts/weightStations.ts), and asserts
 * they agree on WHICH generation is preferred — a fixture an ORDINAL-ONLY
 * rule (the pre-WS-GP bug) would resolve differently (it would pick the
 * simulator, ordinal 4 > 3).
 */
describe('WS-RG2 — rejectSpc.ts\'s local real-preferred rule agrees with the canonical resolveGenerationScope', () => {
  const DAY = '2026-09-10';
  const DRIFT_REGISTRY = [
    { epoch_id: 9, generation_ordinal: 3, source_db: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy' },
    { epoch_id: 11, generation_ordinal: 3, source_db: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy' },
    // Simulator, ordinally NEWER (4 > 3) — and its `provenance` is
    // mislabelled 'ifl_copy', exactly as epochs 13-16 are registered on the
    // live dev sidecar (generation.ts's own file header, "IS READ FROM
    // source_db, NOT FROM provenance"). Both predicates under test must
    // detect this from `source_db`, not `provenance`.
    { epoch_id: 13, generation_ordinal: 4, source_db: 'DATA_TP1U2_SIM', provenance: 'ifl_copy' },
    { epoch_id: 14, generation_ordinal: 4, source_db: 'DATA_TP1U2_SIM', provenance: 'ifl_copy' },
  ];
  // Real: 20 cones, 8 rejects (unmatched — this fixture is about GENERATION
  // SELECTION, not the matched/unmatched split rejectSpc.test.ts covers).
  const REAL_PRODUCED: Row[] = [{ source_epoch: 9, bucket_ts: day(DAY), n: 20 }];
  const REAL_REJECTS: Row[] = [{ source_epoch: 11, bucket_ts: day(DAY), n: 8 }];
  // Simulator: much larger, much cleaner — DILUTES a pooled/ordinal-only
  // figure rather than merely shifting it, the shape the live sidecar
  // actually shows over 21 Aug - 7 Sep.
  const SIM_PRODUCED: Row[] = [{ source_epoch: 13, bucket_ts: day(DAY), n: 1000 }];
  const SIM_REJECTS: Row[] = [{ source_epoch: 14, bucket_ts: day(DAY), n: 10 }];

  /** Answers `resolveGenerationScope`'s own two queries — the present-rows
   *  UNION ALL probe (its `AS tbl` column alias) and the WHERE-bound
   *  `sms.source_epoch` read — reusing the same routing idiom
   *  `rejectRateThreeWayAgreement.test.ts`'s `evaluateTwoGen` established. */
  function canonicalPool(produced: Row[]): ConnectionPool {
    const req = {
      input: () => req,
      query: async (sql: string) => {
        if (sql.includes('AS tbl')) {
          const m = new Map<number, number>();
          for (const r of produced) m.set(r.source_epoch, (m.get(r.source_epoch) ?? 0) + r.n);
          return { recordset: [...m.entries()].map(([epoch_id, n]) => ({ tbl: 'cone_event', epoch_id, n })) };
        }
        if (sql.includes('FROM sms.source_epoch')) {
          return { recordset: DRIFT_REGISTRY.map((r) => ({ ...r, label: null })) };
        }
        throw new Error(`unexpected query in canonicalPool: ${sql}`);
      },
    };
    return { request: () => req } as unknown as ConnectionPool;
  }

  it('rejectSpc.ts\'s own pBar lands on the REAL generation, never the ordinally-newer simulator', async () => {
    const d = await getRejectSpc(
      fakePool(DRIFT_REGISTRY, [...REAL_PRODUCED, ...SIM_PRODUCED], [...REAL_REJECTS, ...SIM_REJECTS], [...REAL_REJECTS, ...SIM_REJECTS], [...REAL_REJECTS, ...SIM_REJECTS]),
      1, DAY, DAY, 'day', 'quality',
    );
    // p̄ = rejects / (produced + unmatched) — every reject in this fixture
    // is unmatched (no cone_event counterpart), so inspected = 20 + 8 = 28.
    expect(d.pBar).toBeCloseTo(8 / 28, 5); // the real generation's own truth
    expect(d.pBar).not.toBeCloseTo(10 / 1000, 5); // what an ordinal-only rule would print (the simulator's own rate)
  });

  it('resolveGenerationScope, called directly on the SAME registry shape, also lands on the REAL generation (ordinal 3), never the simulator (ordinal 4)', async () => {
    const scope = await resolveGenerationScope(
      canonicalPool([...REAL_PRODUCED, ...SIM_PRODUCED]),
      1,
      { from: DAY, to: DAY },
      ['cone_event'],
    );
    expect(scope.generation?.ordinal).toBe(3);
    expect(scope.generation?.simulator).toBe(false);
  });

  it('the two rules AGREE: both name generation 3 as preferred, on a fixture an ordinal-only rule would resolve to generation 4', async () => {
    const spc = await getRejectSpc(
      fakePool(DRIFT_REGISTRY, [...REAL_PRODUCED, ...SIM_PRODUCED], [...REAL_REJECTS, ...SIM_REJECTS], [...REAL_REJECTS, ...SIM_REJECTS], [...REAL_REJECTS, ...SIM_REJECTS]),
      1, DAY, DAY, 'day', 'quality',
    );
    const scope = await resolveGenerationScope(canonicalPool([...REAL_PRODUCED, ...SIM_PRODUCED]), 1, { from: DAY, to: DAY }, ['cone_event']);

    // rejectSpc.ts reports its preferred generation only through its bucket
    // rows' own `generation` field and `d.generations[]`, not a top-level
    // scalar — find the one `pBar` above actually used.
    const spcPreferred = spc.generations.find((g) => g.pBar === spc.pBar);
    expect(spcPreferred?.generation).toBe(scope.generation?.ordinal);
    expect(spcPreferred?.generation).toBe(3);
  });
});
