/**
 * Regression tests for the reject-rate denominator.
 *
 * Finding H1 (Sep 2026 audit): pBar and every per-bucket rate used to divide
 * rejects by cones ALONE, excluding rejects from their own denominator.
 *
 * H1's OWN follow-up defect, corrected 23 Sep 2026 (see rejectSpc.ts's file
 * header for the full measurement): H1's fix, `inspected = produced +
 * allRejects`, assumed a reject_event row and a cone_event row are never the
 * same physical cone. Matching real data found that 98%+ of rejects DO share
 * a cone_event row (the cone was weighed fine, then separately rejected) — so
 * `produced` already counted them, and adding them again double-counted.
 * The denominator now adds only the rejects with NO matching cone_event row.
 *
 * A minimal fake pool, not a real database: getRejectSpc issues queries in a
 * fixed order — registry, cones, rejects, [all-rejects, only when the
 * numerator is narrowed by rejectType or code], unmatched-rejects (always,
 * last) — so a queue of canned recordsets pins the arithmetic without
 * standing up SQL Server.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getRejectSpc } from './rejectSpc.js';

function fakePool(responses: { recordset: unknown[] }[]): ConnectionPool {
  let i = 0;
  const req: { input: () => typeof req; query: () => Promise<{ recordset: unknown[] }> } = {
    input: () => req,
    query: async () => responses[i++] ?? { recordset: [] },
  };
  return { request: () => req } as unknown as ConnectionPool;
}

describe('getRejectSpc — reject-rate denominator (finding H1, then its 23 Sep 2026 correction)', () => {
  it('divides by cones PLUS UNMATCHED rejects, not cones alone and not cones plus every reject', async () => {
    const bucketTs = new Date('2026-07-07T00:00:00.000Z');
    const pool = fakePool([
      { recordset: [] }, // sms.source_epoch registry — empty, so every row is one generation
      { recordset: [{ bucket_ts: bucketTs, n: 100 }] }, // cone_event: 100 produced
      { recordset: [{ bucket_ts: bucketTs, n: 10 }] }, // reject_event (numerator): 10 rejects
      // rejectType is 'all' and no code filter, so no separate all-rejects
      // query runs (allRejectsRes reuses the numerator response above);
      // the NEXT response served is the always-run unmatched-rejects query.
      { recordset: [{ bucket_ts: bucketTs, n: 4 }] }, // 4 of the 10 have no matching cone_event row
    ]);

    const data = await getRejectSpc(pool, 1, '2026-07-07', '2026-07-07', 'day', 'all');

    // Correct: 10 / (100 + 4) = 0.096153...
    // The pre-H1 formula would have produced 10 / 100 = 0.1 exactly.
    // H1's own formula (cones + EVERY reject) would have produced 10 / 110 = 0.090909...
    expect(data.pBar).toBeCloseTo(10 / 104, 5);
    expect(data.pBar).not.toBeCloseTo(0.1, 5);
    expect(data.pBar).not.toBeCloseTo(10 / 110, 5);
    expect(data.buckets[0]!.rate).toBeCloseTo(10 / 104, 5);
    expect(data.buckets[0]!.inspected).toBe(104);
  });

  it('when every reject is unmatched, matches cones + rejects (the H1 case is a special case of this one)', async () => {
    const bucketTs = new Date('2026-07-08T00:00:00.000Z');
    const pool = fakePool([
      { recordset: [] }, // registry
      { recordset: [{ bucket_ts: bucketTs, n: 1000 }] }, // cones
      { recordset: [{ bucket_ts: bucketTs, n: 25 }] }, // rejects (numerator)
      { recordset: [{ bucket_ts: bucketTs, n: 25 }] }, // unmatched: all 25 are unmatched
    ]);

    const data = await getRejectSpc(pool, 1, '2026-07-08', '2026-07-08', 'day', 'all');
    const totalInspected = data.totalProduced + data.totalRejects;
    const expected = data.totalRejects / totalInspected;
    expect(data.pBar).toBeCloseTo(expected, 5);
  });

  it('when every reject IS matched, the denominator is cones alone (rejects add nothing extra)', async () => {
    const bucketTs = new Date('2026-07-09T00:00:00.000Z');
    const pool = fakePool([
      { recordset: [] }, // registry
      { recordset: [{ bucket_ts: bucketTs, n: 500 }] }, // cones
      { recordset: [{ bucket_ts: bucketTs, n: 20 }] }, // rejects (numerator)
      { recordset: [] }, // unmatched: none — every reject shares a cone_event row
    ]);

    const data = await getRejectSpc(pool, 1, '2026-07-09', '2026-07-09', 'day', 'all');
    expect(data.buckets[0]!.inspected).toBe(500);
    expect(data.pBar).toBeCloseTo(20 / 500, 5);
  });
});

/**
 * Two source epochs, one generation, one bucket (roadmap Phase 5, 14 Sep
 * 2026). The quality and weight reject tables are registered as different
 * epochs (11 and 12 here) sharing one generation ordinal, so a GROUP BY
 * source_epoch hands this service TWO rows for the same day. They must be
 * summed; `new Map(rows.map(...))` kept whichever came last. The unmatched
 * population is subject to the same summing rule, so these fixtures give it
 * two epoch rows too.
 */
describe('getRejectSpc — two reject epochs of one generation in one bucket', () => {
  const bucketTs = new Date('2026-09-07T00:00:00.000Z');
  const registry = [
    { epoch_id: 9, generation_ordinal: 3 },
    { epoch_id: 11, generation_ordinal: 3 },
    { epoch_id: 12, generation_ordinal: 3 },
  ];

  it('rejectType all: the combined count is the SUM of both tables, not the last one read', async () => {
    const pool = fakePool([
      { recordset: registry },
      { recordset: [{ source_epoch: 9, bucket_ts: bucketTs, n: 1000 }] },
      { recordset: [{ source_epoch: 11, bucket_ts: bucketTs, n: 30 }, { source_epoch: 12, bucket_ts: bucketTs, n: 20 }] },
      // unmatched-rejects query (always run last): 5 of the 30 quality and
      // 2 of the 20 weight rejects have no matching cone_event row.
      { recordset: [{ source_epoch: 11, bucket_ts: bucketTs, n: 5 }, { source_epoch: 12, bucket_ts: bucketTs, n: 2 }] },
    ]);
    const d = await getRejectSpc(pool, 1, '2026-09-07', '2026-09-07', 'day', 'all');
    expect(d.totalRejects).toBe(50);
    expect(d.buckets).toHaveLength(1);
    expect(d.buckets[0]!.inspected).toBe(1007); // 1000 + 5 + 2
    expect(d.pBar).toBeCloseTo(50 / 1007, 5);
  });

  it('rejectType quality: the denominator still counts the weight table\'s UNMATCHED rejects', async () => {
    const pool = fakePool([
      { recordset: registry },
      { recordset: [{ source_epoch: 9, bucket_ts: bucketTs, n: 1000 }] },
      { recordset: [{ source_epoch: 11, bucket_ts: bucketTs, n: 30 }] }, // numerator: quality only
      { recordset: [{ source_epoch: 11, bucket_ts: bucketTs, n: 30 }, { source_epoch: 12, bucket_ts: bucketTs, n: 20 }] }, // all-rejects (cell existence only)
      // unmatched-rejects query, always base-filtered (every type):
      { recordset: [{ source_epoch: 11, bucket_ts: bucketTs, n: 5 }, { source_epoch: 12, bucket_ts: bucketTs, n: 2 }] },
    ]);
    const d = await getRejectSpc(pool, 1, '2026-09-07', '2026-09-07', 'day', 'quality');
    expect(d.totalRejects).toBe(30);
    expect(d.buckets[0]!.inspected).toBe(1007); // 1000 + 5 + 2, not 1000 + 30 + 20
    expect(d.buckets[0]!.rate).toBeCloseTo(30 / 1007, 5);
  });
});
