/**
 * Regression tests for resolveEpoch — the generation gate (Sep 2026).
 *
 * Every branch here is a way the sync worker used to be silently wrong. The
 * one that matters most is the last: a source that reports the SAME
 * create_date but a different database is "pointed at the wrong copy", and it
 * must halt exactly like a vendor rebuild does. That is why server and
 * database are part of the epoch's identity rather than decoration.
 *
 * resolveEpoch never guesses. There is no default epoch: defaulting to "the
 * newest" or to 1 reproduces the original blackout, and auto-registering would
 * have re-ingested the simulator a second time the moment its tables were
 * rebuilt. So every mismatch throws, and the message names `sms epoch:accept`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

const source = {
  createdKey: '2026-08-05T19:03:16.353Z' as string | null,
  fingerprint: 'bf17df27200feeb21ac65c2e5dfc39e7',
  columns: ['id int', 'Date datetime', 'MaterialId int'] as string[],
  /** WS-PERF3, Job 1: counts every real columnList() round trip the mocked
   *  adapter answers, so a test can prove the catalogue is not queried twice
   *  per table per pass. */
  columnListCalls: 0,
};
// The registry (createAdapter) hands out this class for 'ifl_sql'.
vi.mock('./reader/IflSqlAdapter.js', () => ({
  IflSqlAdapter: class {
    constructor(_pool: unknown, readonly def: unknown) {}
    async sourceEpoch() {
      return source.createdKey;
    }
    async fingerprint() {
      return source.fingerprint;
    }
    async columnList() {
      source.columnListCalls++;
      return source.columns;
    }
  },
}));

const { resolveEpoch, checkColumnDrift, readSourceIdentity } = await import('./epoch.js');

const OPEN = {
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
};

/** App pool whose only query is openEpoch's; returns whatever `openRows` holds. */
let openRows: (typeof OPEN)[] = [OPEN];
const appPool = {
  request: () => {
    const req = { input: () => req, query: async () => ({ recordset: openRows }) };
    return req;
  },
} as unknown as ConnectionPool;
const iflPool = {} as ConnectionPool;
const def = { key: 'cone', sourceTable: 'pack1_TP1U2', rawTable: 'sms_raw.cone_raw', systemCode: 'ifl_sql', columns: [] } as never;
const iflDb = { server: 'localhost', database: 'DATA_TP1U2_SEP07' } as never;

beforeEach(() => {
  openRows = [OPEN];
  source.createdKey = OPEN.source_created_key;
  source.fingerprint = OPEN.schema_fingerprint;
  source.columnListCalls = 0;
});

describe('resolveEpoch', () => {
  it('returns the open epoch, plus the live column list it already read, when server, database, create_date and fingerprint all match', async () => {
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).resolves.toMatchObject({
      epoch: { epoch_id: 9 },
      columnList: ['id int', 'Date datetime', 'MaterialId int'],
    });
  });

  it('halts when no generation is open, and names the command that fixes it', async () => {
    openRows = [];
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/No open source generation/);
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/sms epoch:accept/);
  });

  it('halts when the source table was recreated (create_date moved)', async () => {
    // IFL's 2026-08-05 rebuild, seen from an app DB still open on the July generation.
    source.createdKey = '2026-09-30T08:00:00.000Z';
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/generation changed/);
  });

  it('halts when the same create_date is reported by a DIFFERENT database (wrong copy)', async () => {
    // A create_date alone cannot tell "vendor rebuilt the table" from
    // "IFL_DB_NAME_DATA points at the wrong database". This is the case a
    // create_date-only gate would have waved through.
    await expect(
      resolveEpoch(appPool, iflPool, def, 1, { server: 'localhost', database: 'DATA_TP1U2' } as never),
    ).rejects.toThrow(/generation changed/);
  });

  it('halts on column drift within a live generation', async () => {
    source.fingerprint = '00000000000000000000000000000000';
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/Schema drift/);
  });

  it('halts, rather than defaulting, when the source reports no create_date at all', async () => {
    source.createdKey = null;
    await expect(resolveEpoch(appPool, iflPool, def, 1, iflDb)).rejects.toThrow(/Cannot read create_date/);
  });

  // D-8 fix (22 Sep 2026): migration 025 defined last_seen_utc but nothing
  // ever wrote it. resolveEpoch is the one place that has already proven,
  // this pass, that the source IS the open generation — so it is the right
  // place to stamp it.
  it('stamps last_seen_utc on the resolved epoch once identity and schema both match', async () => {
    const statements: { sql: string; inputs: Map<string, unknown> }[] = [];
    const trackingPool = {
      request: () => {
        const inputs = new Map<string, unknown>();
        const req = {
          input: (name: string, _t: unknown, value: unknown) => {
            inputs.set(name, value);
            return req;
          },
          query: async (sql: string) => {
            statements.push({ sql, inputs: new Map(inputs) });
            return { recordset: openRows };
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;

    await resolveEpoch(trackingPool, iflPool, def, 1, iflDb);

    const upd = statements.find((s) => /UPDATE sms\.source_epoch SET last_seen_utc/.test(s.sql));
    expect(upd).toBeDefined();
    expect(upd!.sql).toMatch(/WHERE epoch_id = @id/);
    expect(upd!.inputs.get('id')).toBe(OPEN.epoch_id);
  });
});

describe('readSourceIdentity', () => {
  it('carries the FULL column list, so epoch:accept can record the baseline', async () => {
    const id = await readSourceIdentity(iflPool, def, iflDb);
    expect(id.columnList).toEqual(['id int', 'Date datetime', 'MaterialId int']);
    expect(id.createdKey).toBe(OPEN.source_created_key);
  });
});

/**
 * Column-list drift (roadmap Phase 2 item 4): the fingerprint sees only the
 * columns SMS reads, so this is how a column IFL ADDS becomes visible. Stored
 * on first sight (the migration's contract for generations accepted before
 * 029), compared afterwards; a difference is one WARNING finding and never
 * a halt.
 */
describe('checkColumnDrift', () => {
  interface Stmt { sql: string; inputs: Map<string, unknown> }
  function pool(recorded: string | null) {
    const statements: Stmt[] = [];
    const p = {
      statements,
      request() {
        const inputs = new Map<string, unknown>();
        const req = {
          input(name: string, _t: unknown, value: unknown) {
            inputs.set(name, value);
            return req;
          },
          async query(sql: string) {
            statements.push({ sql, inputs: new Map(inputs) });
            if (/SELECT column_list/.test(sql)) return { recordset: [{ column_list: recorded }] };
            return { recordset: [], rowsAffected: [1] };
          },
        };
        return req;
      },
    };
    return p as unknown as ConnectionPool & { statements: Stmt[] };
  }
  // WS-PERF3, Job 1: checkColumnDrift no longer calls adapter.columnList()
  // itself — it takes the live list its caller already read via resolveEpoch.
  const def = { key: 'cone', sourceTable: 'pack1_TP1U2', rawTable: 'sms_raw.cone_raw', systemCode: 'ifl_sql', columns: [] };
  const live = source.columns;

  it('first sight: stores the list on the epoch row (guarded IS NULL) and raises nothing', async () => {
    const p = pool(null);
    expect(await checkColumnDrift(p, live, OPEN as never, def)).toBeNull();
    const upd = p.statements.find((s) => /UPDATE sms\.source_epoch SET column_list = @json/.test(s.sql))!;
    expect(upd).toBeDefined();
    expect(upd.sql).toMatch(/WHERE epoch_id = @id AND column_list IS NULL/);
    expect(upd.inputs.get('id')).toBe(9);
    expect(JSON.parse(String(upd.inputs.get('json')))).toEqual(['id int', 'Date datetime', 'MaterialId int']);
  });

  it('same list afterwards: nothing stored, nothing raised', async () => {
    const p = pool(JSON.stringify(['id int', 'Date datetime', 'MaterialId int']));
    expect(await checkColumnDrift(p, live, OPEN as never, def)).toBeNull();
    expect(p.statements.some((s) => /UPDATE/.test(s.sql))).toBe(false);
  });

  it('a different list: one WARNING naming what was added and removed, on the raw table, and the row is NOT overwritten', async () => {
    const p = pool(JSON.stringify(['id int', 'Date datetime', 'Source int']));
    const f = await checkColumnDrift(p, live, OPEN as never, def);
    expect(f).toMatchObject({ check_name: 'source_columns_changed', severity: 'WARNING', subject_table: 'cone_raw', count: 2 });
    expect(f!.detail).toBe(
      'columns added: [MaterialId int]; removed: [Source int] on pack1_TP1U2 (generation 9) — the fingerprint of ' +
        'the columns SMS reads is unchanged, so ingestion continues; review whether SMS should read the new columns',
    );
    expect(p.statements.some((s) => /UPDATE/.test(s.sql))).toBe(false);
  });
});

/**
 * WS-PERF3, Job 1 (24 Sep 2026). PERFORMANCE-SOURCE-LOAD-2026-09-24.md §1
 * found `columnList()` issued twice per table per pass, identical query,
 * identical parameters: once inside `resolveEpoch` (via `readSourceIdentity`),
 * once again in the immediately-following `checkColumnDrift` call — the exact
 * sequence `runner.ts` runs for every table, every 60 seconds. This drives
 * that real sequence (create the adapter once, resolve the epoch, then run
 * the drift check) against the mocked adapter's own call counter, so it fails
 * if the redundancy comes back.
 */
describe('resolveEpoch + checkColumnDrift together (Job 1: no duplicate catalogue read)', () => {
  it('reads the live column list only once per table per pass', async () => {
    const { epoch, columnList } = await resolveEpoch(appPool, iflPool, def, 1, iflDb);
    await checkColumnDrift(appPool, columnList, epoch, def);
    expect(source.columnListCalls).toBe(1);
  });
});
