/**
 * Regression test for finding H1 (Sep 2026 audit): pBar and every per-bucket
 * rate used to divide rejects by cones ALONE, excluding rejects from their
 * own denominator. Real-data magnitude at the time: 5.42% shown vs 5.14%
 * correct on 2026-07-07; 2.208% vs 2.160% over the full 19-day range.
 *
 * A minimal fake pool, not a real database: getRejectSpc issues exactly two
 * queries in a fixed order (cones, then rejects), so a queue of canned
 * recordsets is enough to pin the arithmetic without standing up SQL Server.
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

describe('getRejectSpc — reject-rate denominator (finding H1)', () => {
  it('divides by cones PLUS rejects, not cones alone', async () => {
    const bucketTs = new Date('2026-07-07T00:00:00.000Z');
    const pool = fakePool([
      { recordset: [] }, // sms.source_epoch registry — empty, so every row is one generation
      { recordset: [{ bucket_ts: bucketTs, n: 100 }] }, // cone_event: 100 produced
      { recordset: [{ bucket_ts: bucketTs, n: 10 }] }, // reject_event: 10 rejects
    ]);

    const data = await getRejectSpc(pool, 1, '2026-07-07', '2026-07-07', 'day', 'all');

    // Correct: 10 / (100 + 10) = 0.090909...
    // The old, wrong formula would have produced 10 / 100 = 0.1 exactly.
    expect(data.pBar).toBeCloseTo(10 / 110, 5);
    expect(data.pBar).not.toBeCloseTo(0.1, 5);
    expect(data.buckets[0]!.rate).toBeCloseTo(10 / 110, 5);
  });

  it('matches Rejects.tsx\'s own headline formula: rejects / (produced + rejects)', async () => {
    const bucketTs = new Date('2026-07-08T00:00:00.000Z');
    const pool = fakePool([
      { recordset: [] }, // sms.source_epoch registry — empty, so every row is one generation
      { recordset: [{ bucket_ts: bucketTs, n: 1000 }] },
      { recordset: [{ bucket_ts: bucketTs, n: 25 }] },
    ]);

    const data = await getRejectSpc(pool, 1, '2026-07-08', '2026-07-08', 'day', 'all');
    const totalInspected = data.totalProduced + data.totalRejects;
    const expected = data.totalRejects / totalInspected;
    expect(data.pBar).toBeCloseTo(expected, 5);
  });
});
