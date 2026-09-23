/**
 * A SECOND defect, in a different function of the same file (23 Sep 2026,
 * WS-R, flagged mid-pass by a parallel worker and confirmed here before any
 * fix): `foldGenerationTally` and `countEvents` both read a SQL COUNT
 * column with a bare `Number(r.n)` / `Number(res.recordset[0]?.n ?? 0)`.
 * `production.ts` (WS-P, `71757a3`, the same day) established the shape this
 * repeats: a recordset row that comes back with an expected column ABSENT —
 * not SQL NULL, the key itself missing, what a malformed/truncated driver
 * row looks like — must never read as a real zero.
 *
 * THE CHAIN THIS FILE PROVES, end to end, not merely at the `Number()` call:
 *  1. `Number(undefined)` is `NaN`.
 *  2. `JSON.stringify({ total: NaN })` serialises as `{"total":null}` — a
 *     silent type change at the API boundary, asserted directly below.
 *  3. `web/src/screens/Sacks.tsx`'s history block reads
 *     `rows.data?.data.total ?? 0` and renders `<Empty>` when that is `0` —
 *     `null ?? 0` is `0`, so a malformed tally row reads as "no sacks this
 *     period" even while `listEvents`' OWN `rows` array (a separate read,
 *     unaffected by the tally) holds real ones. The web half of this fix is
 *     not in this file — `Sacks.tsx` is out of this pass's ownership — but
 *     the SERVER must stop being able to emit the `NaN` in the first place,
 *     and must say when it could not read a count, on the same terms
 *     `production.ts`'s `dataIssues` already does.
 *
 * RED, captured before any fix (this file's own history — see the commit
 * this file ships in): `foldGenerationTally`'s "malformed tally row" test
 * failed `expected NaN to be 0`; `countEvents`'s malformed-count test failed
 * `expected NaN to be 0`. Fixed below with a local `readNum`, mirroring
 * `production.ts`'s own idiom rather than inventing a second one — not
 * imported, because `production.ts` does not export it; register.ts has no
 * dependency on production.ts otherwise and this pass does not add one.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { countEvents, foldGenerationTally, listEvents, type RegisterDataIssue } from './register.js';

describe('NaN -> null: the exact serialisation this whole file exists to prevent', () => {
  it('Number(undefined) is NaN, and JSON.stringify renders a NaN field as null — the chain Sacks.tsx inherits if register.ts ever emits one', () => {
    expect(Number(undefined)).toBeNaN();
    expect(JSON.stringify({ total: Number(undefined) })).toBe('{"total":null}');
  });
});

describe('foldGenerationTally — a tally row missing its count (n) must not read as a real zero', () => {
  it('a well-formed tally (a real, present count of 0) carries no data issue', () => {
    const r = foldGenerationTally([
      { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: null, n: 0 },
    ]);
    expect(r.total).toBe(0);
    expect(r.dataIssues).toEqual([]);
  });

  it('a tally row with n absent (key deleted, not null) does not corrupt total into NaN', () => {
    const malformed: { epoch_id: number; source_db: string; generation_ordinal: number; provenance: string; label: null; n?: number } =
      { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: null, n: 4 };
    delete malformed.n; // absent, not null — the shape a truncated/malformed driver row takes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = foldGenerationTally([malformed as any]);

    expect(r.total).not.toBeNaN();
    expect(r.total).toBe(0); // the success shape is unchanged: a number, never undefined/NaN
    expect(r.generations[0]!.rows).toBe(0);
    expect(r.dataIssues).toContainEqual<RegisterDataIssue>({
      field: 'total', generation: 'DATA_TP1U2_SEP07#3',
      reason: 'tally row is missing its count (n)',
    });
    // The serialisation this whole chain was about: no longer possible once total is a real number.
    expect(JSON.parse(JSON.stringify({ total: r.total })).total).toBe(0);
  });

  it('one malformed generation among several does not corrupt the others\' counts', () => {
    const good = { epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1, provenance: 'ifl_copy', label: null, n: 62 };
    const bad: { epoch_id: number; source_db: string; generation_ordinal: number; provenance: string; label: null; n?: number } =
      { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: null, n: 54 };
    delete bad.n;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = foldGenerationTally([good, bad as any]);
    expect(r.total).toBe(62); // 62 + 0 (malformed), never NaN
    expect(r.generations.find((g) => g.key === 'DATA_TP1U2#1')!.rows).toBe(62);
    expect(r.generations.find((g) => g.key === 'DATA_TP1U2_SEP07#3')!.rows).toBe(0);
    expect(r.dataIssues).toHaveLength(1);
    expect(r.dataIssues[0]!.generation).toBe('DATA_TP1U2_SEP07#3');
  });
});

/** A minimal listEvents-shaped fake pool: answers the tally query and the rows query, nothing else. */
function listingPool(tallyRows: Record<string, unknown>[]): ConnectionPool {
  const req = () => {
    const r = {
      input: () => r,
      query: async (sql: string) => {
        if (/AS epoch_id/.test(sql) && /GROUP BY/.test(sql)) return { recordset: tallyRows };
        return { recordset: [] }; // the rows SELECT — not under test here
      },
    };
    return r;
  };
  return { request: req } as unknown as ConnectionPool;
}

describe('listEvents — the malformed tally row cannot reach the wire as a false empty period', () => {
  it('total is a real number (0), with a dataIssue naming the affected generation, never NaN/null', async () => {
    const malformed: Record<string, unknown> = {
      epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: null, n: 2,
    };
    delete malformed.n;
    const page = await listEvents(listingPool([malformed]), 1, 'sack', { sort: 'time', dir: 'desc', page: 1, pageSize: 50 });
    expect(page.total).toBe(0);
    expect(page.total).not.toBeNaN();
    expect(JSON.parse(JSON.stringify(page)).total).toBe(0); // never coerces to null on the wire
    expect(page.dataIssues).toContainEqual({
      field: 'total', generation: 'DATA_TP1U2_SEP07#3', reason: 'tally row is missing its count (n)',
    });
  });
});

/** A minimal countEvents-shaped fake pool: answers resolveGenerationScope's two queries (empty -> UNSCOPED) and the COUNT query. */
function countPool(countRow: Record<string, unknown>): ConnectionPool {
  const req = () => {
    const r = {
      input: () => r,
      query: async (sql: string) => {
        if (sql.includes('GROUP BY source_epoch')) return { recordset: [] }; // resolveGenerationScope: nothing present -> UNSCOPED
        if (sql.includes('FROM sms.source_epoch')) return { recordset: [] };
        if (sql.startsWith('SELECT COUNT(*) n FROM')) return { recordset: [countRow] };
        return { recordset: [] };
      },
    };
    return r;
  };
  return { request: req } as unknown as ConnectionPool;
}

describe('countEvents — its own COUNT row missing n cannot silently become a real-looking 0', () => {
  it('a well-formed zero carries no data issue', async () => {
    const r = await countEvents(countPool({ n: 0 }), 1, 'sack', { inRange: false });
    expect(r.count).toBe(0);
    expect(r.dataIssues).toEqual([]);
  });

  it('n absent (key deleted, not null) still returns a real number, flagged', async () => {
    const row: { n?: number } = { n: 17 };
    delete row.n;
    const r = await countEvents(countPool(row), 1, 'sack', { inRange: false });
    expect(r.count).not.toBeNaN();
    expect(r.count).toBe(0);
    expect(JSON.parse(JSON.stringify(r)).count).toBe(0); // never null on the wire
    expect(r.dataIssues).toContainEqual({
      field: 'count', generation: null, reason: 'countEvents aggregate row is missing its count (n)',
    });
  });
});
