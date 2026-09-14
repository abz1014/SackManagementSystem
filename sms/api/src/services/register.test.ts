/**
 * Regression test for SEPT-2026-EPOCH-DECISION §4.2: IFL dropped and
 * recreated the wide tables on 2026-08-05, so every source identity restarted
 * at 1 and `source_row_id` stopped identifying a cone or a sack on its own —
 * July's id 5 and September's id 5 are different physical cones nine weeks
 * apart. The detail lookup used to run `TOP 1 … WHERE source_row_id=@id` with
 * no ORDER BY over a non-unique index, which returned whichever generation
 * the seek met first, and the newer generation's rows were unreachable by
 * permalink once an older row shared the number.
 *
 * This drives the real `getEventDetail` against a fake pool that actually
 * APPLIES the query's key column to an in-memory table, rather than handing
 * back a canned row: a fake that returns the September row regardless of the
 * SQL would pass just as happily against the source_row_id lookup this test
 * exists to pin.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getEventDetail, idCol } from './register.js';

type Row = Record<string, unknown>;

/**
 * Serves getEventDetail's single query by reading the key column out of its
 * WHERE clause (`… AND e.<key>=@id`) and filtering `rows` by the bound @line
 * and @id, honouring TOP 1 in table order — the same arbitrary "first match"
 * the real seek gave.
 */
function tablePool(rows: Row[]): ConnectionPool {
  const params = new Map<string, unknown>();
  const req = {
    input: (name: string, _type: unknown, value: unknown) => {
      params.set(name, value);
      return req;
    },
    query: async (sql: string) => {
      const m = /AND\s+(?:\w+\.)?(\w+)\s*=\s*@id\b/.exec(sql);
      if (!m) throw new Error(`no @id key in: ${sql}`);
      const key = m[1]!;
      const hit = rows.filter((r) => r.line_id === params.get('line') && r[key] === params.get('id'));
      return { recordset: hit.slice(0, 1) };
    },
  };
  return { request: () => req } as unknown as ConnectionPool;
}

// Two physically different cones that share IFL's id 5: one from the July
// copy (epoch 1), one from the live September source (epoch 9).
const JULY_CONE: Row = { line_id: 1, cone_event_id: 5, source_row_id: 5, source_epoch: 1, weight_g: 1949 };
const SEPT_CONE: Row = { line_id: 1, cone_event_id: 200_001, source_row_id: 5, source_epoch: 9, weight_g: 1963 };
const JULY_SACK: Row = { line_id: 1, sack_event_id: 7, source_row_id: 7, source_epoch: 2, weight_kg: 50.1 };
const SEPT_SACK: Row = { line_id: 1, sack_event_id: 9_001, source_row_id: 7, source_epoch: 10, weight_kg: 49.6 };

describe('getEventDetail — two epochs sharing a source_row_id (§4.2)', () => {
  it('addresses a cone by cone_event_id, so the September cone is reachable at all', async () => {
    const pool = tablePool([JULY_CONE, SEPT_CONE]);
    const row = await getEventDetail(pool, 1, 'cone', 200_001);
    expect(row).not.toBeNull();
    expect(row!.source_epoch).toBe(9);
    expect(row!.weight_g).toBe(1963);
  });

  it('returns the July cone at its own PK, not whichever row the seek met first', async () => {
    // September first in seek order: a source_row_id lookup for 5 would
    // answer with it.
    const pool = tablePool([SEPT_CONE, JULY_CONE]);
    const row = await getEventDetail(pool, 1, 'cone', 5);
    expect(row).not.toBeNull();
    expect(row!.source_epoch).toBe(1);
    expect(row!.weight_g).toBe(1949);
  });

  it('addresses a sack by sack_event_id likewise', async () => {
    const pool = tablePool([JULY_SACK, SEPT_SACK]);
    expect((await getEventDetail(pool, 1, 'sack', 9_001))?.source_epoch).toBe(10);
    expect((await getEventDetail(pool, 1, 'sack', 7))?.source_epoch).toBe(2);
  });

  it('idCol is the canonical PK for every type', () => {
    expect(idCol('cone')).toBe('cone_event_id');
    expect(idCol('sack')).toBe('sack_event_id');
    expect(idCol('reject')).toBe('reject_event_id');
  });
});
