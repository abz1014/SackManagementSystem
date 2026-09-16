/**
 * observeArchivedFloor — Part 1 of "sms verify survives the day IFL prunes
 * its first row" (16 Sep 2026).
 *
 * Kept apart from epoch.test.ts's resolveEpoch suite deliberately: that
 * suite's `iflPool` is `{}` (source reads there go through the mocked
 * IflSqlAdapter, never the pool directly), which is exactly why this new
 * function's own source read is written to fail soft rather than throw —
 * see the last test below, and the comment on observeArchivedFloor in
 * epoch.ts for the full reasoning. These tests drive the function directly
 * against fake pools that record what was asked.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { observeArchivedFloor, type EpochRow } from './epoch.js';

interface Stmt {
  sql: string;
  inputs: Map<string, unknown>;
}

/** A pool whose every query returns the same one row, and that records every
 *  statement + its inputs so a test can assert on what was (or wasn't) sent. */
function fakePool(row: unknown): { pool: ConnectionPool; statements: Stmt[] } {
  const statements: Stmt[] = [];
  const p = {
    request() {
      const inputs = new Map<string, unknown>();
      const req = {
        input(name: string, _type: unknown, value: unknown) {
          inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          statements.push({ sql, inputs: new Map(inputs) });
          return { recordset: [row] };
        },
      };
      return req;
    },
  };
  return { pool: p as unknown as ConnectionPool, statements };
}

const def = {
  key: 'cone',
  sourceTable: 'pack1_TP1U2',
  rawTable: 'sms_raw.cone_raw',
  systemCode: 'ifl_sql',
  columns: [],
} as never;

const epoch = (archivedBelowId: number | null): EpochRow =>
  ({
    epoch_id: 9,
    line_id: 1,
    source_table: 'pack1_TP1U2',
    source_server: 'localhost',
    source_db: 'DATA_TP1U2_SEP07',
    source_created_key: '2026-08-05T19:03:16.353Z',
    schema_fingerprint: 'bf17df27200feeb21ac65c2e5dfc39e7',
    provenance: 'ifl_copy',
    generation_ordinal: 3,
    label: 'September copy',
    archived_below_id: archivedBelowId,
    archived_observed_utc: null,
  }) as never;

const updateOf = (statements: Stmt[]) => statements.find((s) => /UPDATE sms\.source_epoch/.test(s.sql));

describe('observeArchivedFloor', () => {
  it('raises the floor from NULL on first observation and stamps archived_observed_utc', async () => {
    const ifl = fakePool({ lo: 5001 });
    const app = fakePool({});
    await observeArchivedFloor(app.pool, ifl.pool, def, epoch(null));

    expect(ifl.statements[0]!.sql).toMatch(/SELECT MIN\(\[id\]\) lo FROM \[pack1_TP1U2\]/);
    const upd = updateOf(app.statements);
    expect(upd).toBeDefined();
    expect(upd!.sql).toMatch(/SET archived_below_id = @min, archived_observed_utc = SYSUTCDATETIME\(\)/);
    expect(upd!.sql).toMatch(/WHERE epoch_id = @id AND \(archived_below_id IS NULL OR archived_below_id < @min\)/);
    expect(upd!.inputs.get('id')).toBe(9);
    expect(upd!.inputs.get('min')).toBe(5001);
  });

  it('raises the floor further when a later pass observes a higher MIN', async () => {
    const ifl = fakePool({ lo: 5300 });
    const app = fakePool({});
    await observeArchivedFloor(app.pool, ifl.pool, def, epoch(5001));
    expect(updateOf(app.statements)!.inputs.get('min')).toBe(5300);
  });

  it('does NOT re-stamp when a later pass observes the SAME MIN', async () => {
    const ifl = fakePool({ lo: 5001 });
    const app = fakePool({});
    await observeArchivedFloor(app.pool, ifl.pool, def, epoch(5001));
    expect(updateOf(app.statements)).toBeUndefined();
  });

  it('halts, naming a reseed/restore/rebuild rather than a prune, when MIN falls below the recorded floor', async () => {
    const ifl = fakePool({ lo: 90 });
    const app = fakePool({});
    await expect(observeArchivedFloor(app.pool, ifl.pool, def, epoch(5001))).rejects.toThrow(
      /reseed.*restore.*rebuild/s,
    );
    await expect(observeArchivedFloor(app.pool, ifl.pool, def, epoch(5001))).rejects.toThrow(/epoch:accept/);
    // Never lowers the floor to match a fall — no UPDATE is issued.
    expect(updateOf(app.statements)).toBeUndefined();
  });

  it('does nothing (no halt, no update) when the source table is currently empty', async () => {
    const ifl = fakePool({ lo: null });
    const app = fakePool({});
    await expect(observeArchivedFloor(app.pool, ifl.pool, def, epoch(5001))).resolves.toBeUndefined();
    expect(app.statements).toHaveLength(0);
  });

  it('logs and resolves, rather than halting the pass, when the source read itself fails', async () => {
    const ifl = { request: () => { throw new Error('ETIMEOUT talking to DATA_TP1U2'); } } as unknown as ConnectionPool;
    const app = fakePool({});
    await expect(observeArchivedFloor(app.pool, ifl, def, epoch(5001))).resolves.toBeUndefined();
    expect(app.statements).toHaveLength(0);
  });
});
