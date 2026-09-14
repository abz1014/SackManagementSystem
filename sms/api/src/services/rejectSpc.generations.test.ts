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

type Row = { source_epoch: number; bucket_ts: Date; n: number };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The registry: epoch id -> generation ordinal, per source table. */
const REGISTRY = [
  { epoch_id: 1, generation_ordinal: 1 }, // July cones
  { epoch_id: 3, generation_ordinal: 1 }, // July quality rejects
  { epoch_id: 9, generation_ordinal: 3 }, // Sept cones
  { epoch_id: 11, generation_ordinal: 3 }, // Sept quality rejects
];

/** Serves getRejectSpc's queries in order: registry, produced, rejects, all rejects. */
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
    const d = await getRejectSpc(fakePool(REGISTRY, produced, rejects, rejects), 1, '2026-07-01', '2026-08-31', 'day', 'quality');

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
    const d = await getRejectSpc(fakePool(REGISTRY, produced, rejects, rejects), 1, '2026-07-01', '2026-08-31', 'day', 'quality');
    expect(d.episodes).toHaveLength(2);
    expect(d.episodes.every((e) => e.bucketCount === 1)).toBe(true);
  });

  it('is unchanged for a range inside one generation', async () => {
    const one = (rows: Row[], ...ids: number[]) => rows.filter((r) => ids.includes(r.source_epoch));
    const d = await getRejectSpc(
      fakePool(REGISTRY, one(produced, 9), one(rejects, 11), one(rejects, 11)),
      1, '2026-08-01', '2026-08-31', 'day', 'quality',
    );
    expect(d.spansGenerations).toBe(false);
    expect(d.generations).toHaveLength(1);
    expect(d.pBar).toBeCloseTo(540 / 14540, 5);
  });
});
