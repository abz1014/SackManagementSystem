/**
 * `generation.ts` — the shared source-generation predicate (23 Sep 2026).
 *
 * The defect these tests pin is IFL's own: the plant dropped and recreated
 * its four weighing tables on 2026-08-05, restarting every identity at 1, and
 * until this pass almost every query in the API read across that boundary as
 * if it were one continuous table. The plant simulator on the development
 * sidecar makes the same defect VISIBLE (its generation overlaps IFL's
 * September one in time), which is why one case below is simulator-shaped —
 * but the boundary case, `spans IFL's own 2026-08-05 rebuild`, is the one
 * that matters at the plant, and it contains no simulator at all.
 *
 * MEASURED against the live development sidecar, 23 Sep 2026 — these are the
 * numbers the fakes below reproduce, not invented ones:
 *
 *   21 Aug - 7 Sep, sms.cone_event, plausible cones
 *     pooled   190,284 cones, mean 1951.79 g   <- what the app showed
 *     epoch 9   55,058 cones, mean 1952.94 g   <- IFL's own data, 29 %
 *
 *   1 Jul - 20 Aug, sms.cone_event (NO simulator rows in this window)
 *     epoch 1 (DATA_TP1U2,       July)    75,178
 *     epoch 9 (DATA_TP1U2_SEP07, Sept)    77,493
 *   — two real generations of IFL's own, pooled into one figure.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { epochFragment, epochWhere, resolveGenerationScope, UNSCOPED } from './generation.js';

interface PresentRow {
  tbl: string;
  epoch_id: number | null;
  n: number;
}
interface EpochRow {
  epoch_id: number;
  source_db: string | null;
  generation_ordinal: number | null;
  provenance: string | null;
  label: string | null;
}

function fakePool(present: PresentRow[], epochs: EpochRow[]): { pool: ConnectionPool; sql: string[] } {
  const sql: string[] = [];
  const pool = {
    request: () => {
      const req = {
        input: () => req,
        query: async (q: string) => {
          sql.push(q);
          if (q.includes('FROM sms.source_epoch')) return { recordset: epochs };
          return { recordset: present };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, sql };
}

const JULY: EpochRow = {
  epoch_id: 1, source_db: 'DATA_TP1U2', generation_ordinal: 1,
  provenance: 'ifl_copy', label: 'July copy - cones',
};
const SEPT: EpochRow = {
  epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3,
  provenance: 'ifl_copy', label: 'September copy - cones',
};
const SEPT_SACK: EpochRow = {
  epoch_id: 10, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3,
  provenance: 'ifl_copy', label: 'September copy - sacks',
};
// The registration defect 6b76ae3 removed: this row really says 'ifl_copy'
// on the development sidecar although it is the simulator's. Left standing
// deliberately, so anything that keys off `provenance` alone is wrong.
const SIM: EpochRow = {
  epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4,
  provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4',
};
const SIM_SACK: EpochRow = {
  epoch_id: 14, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4,
  provenance: 'ifl_copy', label: 'sack1_TP1U2 gen 4',
};

describe('resolveGenerationScope — IFL\'s own 2026-08-05 rebuild', () => {
  it('a period that SPANS the rebuild keeps the newer generation and says what it dropped', async () => {
    // 1 Jul - 20 Aug on the real sidecar. No simulator row is in this window;
    // both candidates are IFL's own data, which is the case that exists at
    // the plant.
    const { pool } = fakePool(
      [
        { tbl: 'cone_event', epoch_id: 1, n: 75178 },
        { tbl: 'cone_event', epoch_id: 9, n: 77493 },
      ],
      [JULY, SEPT],
    );
    const s = await resolveGenerationScope(pool, 1, { from: '2026-07-01', to: '2026-08-20' }, ['cone_event']);

    expect(s.generation?.ordinal).toBe(3);
    expect(s.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(s.generation?.simulator).toBe(false);
    expect(s.epochIds('cone_event')).toEqual([9]);
    // Silence is the thing this whole pass exists to prevent: 75,178 real
    // cones are NOT in the answer, and the response has to say so.
    expect(s.spansGenerations).toBe(true);
    expect(s.otherGenerationExcluded).toBe(75178);
  });

  it('a period entirely inside ONE generation constrains to it and claims nothing was excluded', async () => {
    const { pool } = fakePool([{ tbl: 'cone_event', epoch_id: 1, n: 142511 }], [JULY, SEPT]);
    const s = await resolveGenerationScope(pool, 1, { from: '2026-06-22', to: '2026-07-10' }, ['cone_event']);

    expect(s.generation?.ordinal).toBe(1);
    expect(s.epochIds('cone_event')).toEqual([1]);
    expect(s.spansGenerations).toBe(false);
    expect(s.otherGenerationExcluded).toBe(0);
  });

  it('the OLDER generation is chosen when it is the only one in the window', async () => {
    const { pool } = fakePool([{ tbl: 'cone_event', epoch_id: 1, n: 10 }], [JULY, SEPT, SIM]);
    const s = await resolveGenerationScope(pool, 1, { from: '2026-06-22', to: '2026-06-23' }, ['cone_event']);
    expect(s.generation?.ordinal).toBe(1);
  });
});

describe('resolveGenerationScope — one generation spans several tables', () => {
  it('cones, sacks and rejects of ONE generation are selected together', async () => {
    const { pool } = fakePool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 55058 },
        { tbl: 'cone_event', epoch_id: 13, n: 135248 },
        { tbl: 'sack_event', epoch_id: 10, n: 2310 },
        { tbl: 'sack_event', epoch_id: 14, n: 6199 },
      ],
      [SEPT, SEPT_SACK, SIM, SIM_SACK],
    );
    const s = await resolveGenerationScope(pool, 1, { from: '2026-08-21', to: '2026-09-07' }, [
      'cone_event',
      'sack_event',
    ]);
    // Both tables land on the SAME generation — the epoch ids differ per
    // table, which is exactly why a single epoch_id is not the right key.
    expect(s.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(s.epochIds('cone_event')).toEqual([9]);
    expect(s.epochIds('sack_event')).toEqual([10]);
    expect(s.otherGenerationExcluded).toBe(135248 + 6199);
  });

  it('reject_event has TWO source epochs in one generation (QCS + weight) and keeps both', async () => {
    const qcs: EpochRow = { ...SEPT, epoch_id: 11, label: 'September copy - quality rejects' };
    const wgt: EpochRow = { ...SEPT, epoch_id: 12, label: 'September copy - weight rejects' };
    const { pool } = fakePool(
      [
        { tbl: 'reject_event', epoch_id: 11, n: 3446 },
        { tbl: 'reject_event', epoch_id: 12, n: 10 },
      ],
      [qcs, wgt],
    );
    const s = await resolveGenerationScope(pool, 1, {}, ['reject_event']);
    expect(s.epochIds('reject_event').sort((a, b) => a - b)).toEqual([11, 12]);
    expect(s.otherGenerationExcluded).toBe(0);
  });
});

describe('resolveGenerationScope — the mislabelled simulator epoch', () => {
  it('prefers the REAL generation although the simulator is newer AND claims ifl_copy', async () => {
    // The whole point: epoch 13 says provenance='ifl_copy' (cli/src/commands/
    // epoch.ts's removed default) and has the HIGHER ordinal. Choosing by
    // provenance, or by "newest", would keep 135,248 synthetic cones and drop
    // IFL's 55,058.
    const { pool } = fakePool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 55058 },
        { tbl: 'cone_event', epoch_id: 13, n: 135248 },
      ],
      [SEPT, SIM],
    );
    const s = await resolveGenerationScope(pool, 1, { from: '2026-08-21', to: '2026-09-07' }, ['cone_event']);

    expect(s.epochIds('cone_event')).toEqual([9]);
    expect(s.generation?.simulator).toBe(false);
    expect(s.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(s.otherGenerationExcluded).toBe(135248);
  });

  it('falls back to the simulator when it is the ONLY generation present, and says so', async () => {
    const { pool } = fakePool([{ tbl: 'cone_event', epoch_id: 13, n: 100 }], [SEPT, SIM]);
    const s = await resolveGenerationScope(pool, 1, { from: '2026-09-15', to: '2026-09-22' }, ['cone_event']);
    expect(s.epochIds('cone_event')).toEqual([13]);
    expect(s.generation?.simulator).toBe(true);
    expect(s.otherGenerationExcluded).toBe(0);
  });

  it('a generation honestly registered as simulator is de-preferred the same way', async () => {
    const honest: EpochRow = { ...SIM, epoch_id: 5, generation_ordinal: 2, provenance: 'simulator', source_db: 'ANYTHING' };
    const { pool } = fakePool(
      [
        { tbl: 'cone_event', epoch_id: 1, n: 10 },
        { tbl: 'cone_event', epoch_id: 5, n: 999 },
      ],
      [JULY, honest],
    );
    const s = await resolveGenerationScope(pool, 1, {}, ['cone_event']);
    expect(s.epochIds('cone_event')).toEqual([1]);
  });
});

describe('resolveGenerationScope — degenerate inputs constrain nothing rather than everything', () => {
  it('an empty window constrains nothing', async () => {
    const { pool } = fakePool([], [JULY, SEPT]);
    const s = await resolveGenerationScope(pool, 1, { from: '2030-01-01', to: '2030-01-02' });
    expect(s.generation).toBeNull();
    expect(s.epochIds('cone_event')).toEqual([]);
    expect(s.otherGenerationExcluded).toBe(0);
  });

  it('rows with NO source_epoch at all (pre-epoch-tracking sidecar) constrain nothing', async () => {
    // Not "exclude everything". A sidecar ingested before epoch tracking
    // existed would otherwise answer every screen with zero rows.
    const { pool } = fakePool([{ tbl: 'cone_event', epoch_id: null, n: 5000 }], []);
    const s = await resolveGenerationScope(pool, 1, {});
    expect(s.generation).toBeNull();
    expect(s.epochIds('cone_event')).toEqual([]);
  });

  it('rows carrying an epoch with no source_epoch row behind it constrain nothing', async () => {
    const { pool } = fakePool([{ tbl: 'cone_event', epoch_id: 77, n: 5 }], [JULY]);
    const s = await resolveGenerationScope(pool, 1, {});
    expect(s.generation).toBeNull();
  });

  it('a MIX of epoch-tagged and untagged rows keeps the tagged generation and counts the rest as excluded', async () => {
    const { pool } = fakePool(
      [
        { tbl: 'cone_event', epoch_id: 9, n: 100 },
        { tbl: 'cone_event', epoch_id: null, n: 7 },
      ],
      [SEPT],
    );
    const s = await resolveGenerationScope(pool, 1, {});
    expect(s.epochIds('cone_event')).toEqual([9]);
    expect(s.otherGenerationExcluded).toBe(7);
    expect(s.spansGenerations).toBe(true);
  });
});

describe('epochWhere / epochFragment — the predicate itself', () => {
  const scopeOf = (ids: Record<string, number[]>) => ({
    ...UNSCOPED,
    epochIds: (t: string) => ids[t] ?? [],
  }) as never;

  it('returns null and binds nothing when the scope constrains nothing', () => {
    const bound: string[] = [];
    const req = { input: (n: string) => (bound.push(n), req) } as never;
    expect(epochWhere(req, UNSCOPED, 'cone_event')).toBeNull();
    expect(bound).toEqual([]);
  });

  it('parameterises the epoch id — never interpolates it', () => {
    const bound = new Map<string, unknown>();
    const req = { input: (n: string, _t: unknown, v: unknown) => (bound.set(n, v), req) } as never;
    const sql = epochWhere(req, scopeOf({ cone_event: [9] }), 'cone_event');
    expect(sql).toBe('source_epoch = @gec0');
    expect(sql).not.toContain('9');
    expect([...bound.values()]).toEqual([9]);
  });

  it('uses IN for a generation that spans two source epochs on one table', () => {
    const req = { input: () => req } as never;
    expect(epochWhere(req, scopeOf({ reject_event: [11, 12] }), 'reject_event')).toBe(
      'source_epoch IN (@ger0, @ger1)',
    );
  });

  it('qualifies with the alias, and keeps cone and reject parameter names distinct on one request', () => {
    const req = { input: () => req } as never;
    const r = epochWhere(req, scopeOf({ reject_event: [11] }), 'reject_event', { alias: 're.' });
    const c = epochWhere(req, scopeOf({ cone_event: [9] }), 'cone_event', { alias: 'ce.', prefix: 'um' });
    expect(r).toBe('re.source_epoch = @ger0');
    expect(c).toBe('ce.source_epoch = @umc0');
    // Different parameter names, or the second binding would silently
    // overwrite the first and both tables would filter on one epoch.
    expect(r).not.toBe(c);
  });

  it('epochFragment yields the same SQL and hands back the params to bind separately', () => {
    const f = epochFragment(scopeOf({ sack_event: [10] }), 'sack_event');
    expect(f.sql).toBe('source_epoch = @ges0');
    expect(f.params).toEqual([{ name: 'ges0', id: 10 }]);
  });
});
