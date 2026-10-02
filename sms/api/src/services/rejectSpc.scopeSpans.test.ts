/**
 * C-015 (D-79): since C-009 /api/reject-spc reads ONE generation (the route passes the period's resolved scope), so the
 * series itself can only ever hold one generation and `perGen.size > 1` was always false. The Rejects screen therefore
 * never printed its "different data batch" sentence for a period that crosses the 5 Aug rebuild. The scope already knows
 * that another generation was present and dropped; `spansGenerations` must say so.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getRejectSpc } from './rejectSpc.js';
import type { GenerationScope } from './generation.js';

type Row = { source_epoch: number; bucket_ts: Date; n: number };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const REGISTRY = [
  { epoch_id: 9, generation_ordinal: 3 },
  { epoch_id: 11, generation_ordinal: 3 },
];
const produced: Row[] = [{ source_epoch: 9, bucket_ts: day('2026-08-05'), n: 7000 }, { source_epoch: 9, bucket_ts: day('2026-08-06'), n: 7000 }];
const rejects: Row[] = [{ source_epoch: 11, bucket_ts: day('2026-08-05'), n: 300 }, { source_epoch: 11, bucket_ts: day('2026-08-06'), n: 300 }];

function fakePool(): ConnectionPool {
  const responses = [REGISTRY, produced, rejects, rejects, rejects];
  let i = 0;
  const req = { input: () => req, query: async () => ({ recordset: responses[i++] ?? [] }) };
  return { request: () => req } as unknown as ConnectionPool;
}

const scope = (spans: boolean): GenerationScope => ({
  generation: null,
  spansGenerations: spans,
  otherGenerationExcluded: spans ? 500 : 0,
  excludedSimulator: 0,
  epochIds: () => [],
});

describe('getRejectSpc under a one-generation scope (C-015)', () => {
  it('reports spansGenerations when the scope dropped another generation', async () => {
    const d = await getRejectSpc(fakePool(), 1, '2026-07-01', '2026-08-20', 'day', 'quality', { scope: scope(true) });
    expect(d.generations).toHaveLength(1);
    expect(d.spansGenerations).toBe(true);
  });

  it('stays false when the scope dropped nothing', async () => {
    const d = await getRejectSpc(fakePool(), 1, '2026-08-05', '2026-08-20', 'day', 'quality', { scope: scope(false) });
    expect(d.spansGenerations).toBe(false);
  });
});
