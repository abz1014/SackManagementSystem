/**
 * `sms verify` — the per-generation contract (SEPT-2026-EPOCH-DECISION §4.1).
 *
 * The verify this replaced compared whole tables, COUNT(source) = COUNT(raw) =
 * COUNT(canonical), and was permanently MISMATCH once raw held two generations
 * of a source that holds one. These tests pin the three assertions that
 * replaced it, and in particular that the id SUM is compared: equal COUNT,
 * MIN and MAX with one row missing and one row extra is exactly the case a
 * count-only check waves through.
 *
 * The pools are fakes routed by the SHAPE of the SQL rather than by call
 * order, so each test states what it answers to which question and does not
 * break when verify asks them in a different sequence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

// One table keeps every assertion unambiguous. Since roadmap Phase 1 verify
// loads it from sms.source_table (loadSourceTables), as the worker does.
const TABLES = [
  {
    key: 'cone',
    sourceTable: 'pack1_TP1U2',
    rawTable: 'sms_raw.cone_raw',
    systemCode: 'ifl_sql',
    columns: [{ src: 'id', raw: 'src_id', type: 'int' }],
  },
];
// The identifier guard and the raw-table shapes are the REAL ones: verify's
// `assertSafeDefs` is a point-of-use check on operator-editable configuration
// (see its comment), and faking it would make the two tests at the bottom of
// this file assert nothing.
vi.mock('@sms/sync-worker', async () => {
  const real = await vi.importActual<typeof import('@sms/sync-worker')>('@sms/sync-worker');
  return {
    loadSourceTables: () => world.tables(),
    readSourceIdentity: () => world.identity(),
    assertSourceTableName: real.assertSourceTableName,
    TABLE_SHAPES: real.TABLE_SHAPES,
    createPool: (...a: unknown[]) => world.createPool(...a),
  };
});

// parseArgs is kept REAL (importOriginal) — only openContext is faked. verify()
// calls parseVerifyArgs, which calls parseArgs internally; a bare object mock
// here would silently drop it and break every test through an unrelated path.
vi.mock('../context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context.js')>();
  return {
    ...actual,
    openContext: async () => ({
      cfg: {
        lineId: 1,
        app: { server: 'localhost', database: 'sms' },
        iflData: { server: 'localhost', database: 'DATA_TP1U2_SEP07' },
      },
      app: world.app,
      ifl: world.ifl,
      close: async () => {},
    }),
  };
});

const OPEN = {
  epoch_id: 9,
  source_table: 'pack1_TP1U2',
  source_server: 'localhost',
  source_db: 'DATA_TP1U2_SEP07',
  source_created_key: '2026-08-05T19:03:16.353Z',
  schema_fingerprint: 'bf17df27200feeb21ac65c2e5dfc39e7',
  provenance: 'ifl_copy',
  label: 'September copy',
  closed_utc: null as Date | null,
  // The archived floor (migration 037): unset by default, so every existing
  // fixture keeps today's whole-table comparison unless a test overrides it.
  archived_below_id: null as number | null,
  archived_observed_utc: null as Date | null,
};
const CLOSED = {
  ...OPEN,
  epoch_id: 1,
  source_db: 'DATA_TP1U2',
  source_created_key: '2026-06-19T11:53:05.787Z',
  schema_fingerprint: '5ba1cb11b4503f74a4abff08903d9fc1',
  label: 'July copy',
  closed_utc: new Date('2026-09-11T09:00:00Z'),
};
const IDENTITY_OF_OPEN = {
  createdKey: OPEN.source_created_key,
  fingerprint: OPEN.schema_fingerprint,
  server: OPEN.source_server,
  database: OPEN.source_db,
};

/** COUNT / MIN / MAX / SUM as the driver hands them back (BIGINT as a string). */
const stats = (ids: number[]) => ({
  n: ids.length,
  lo: ids.length ? Math.min(...ids) : null,
  hi: ids.length ? Math.max(...ids) : null,
  s: ids.length ? String(ids.reduce((a, b) => a + b, 0)) : null,
});

type Route = [RegExp, unknown[]];
type Pool = ConnectionPool & { calls: string[] };

function fakePool(routes: Route[]): Pool {
  const calls: string[] = [];
  const req = {
    input: () => req,
    query: async (sql: string) => {
      calls.push(sql);
      const hit = routes.find(([re]) => re.test(sql));
      if (!hit) throw new Error(`fake pool has no answer for:\n${sql}`);
      return { recordset: hit[1] };
    },
  };
  return { request: () => req, calls, close: async () => {} } as unknown as Pool;
}

function appPool(opts: {
  epochs: (typeof OPEN)[];
  raw: { epoch: number; ids: number[] }[];
  rawOnly?: number;
  canonOnly?: number;
  /** Answers rawStatsFiltered — the archived-floor (`src_id >= @floor`) or
   *  --from/--to (`[src_Date] >= @from`) scoped raw query. */
  scoped?: number[];
}): Pool {
  return fakePool([
    [/FROM sms\.source_epoch/, opts.epochs],
    [/GROUP BY source_epoch/, opts.raw.map((r) => ({ e: r.epoch, ...stats(r.ids) }))],
    ...(opts.scoped
      ? ([[/AND (src_id >= @floor|\[src_Date\] >= @from)/, [stats(opts.scoped)]]] as Route[])
      : []),
    // Anchored on the OUTER SELECT. Each direction's query names the OTHER
    // table inside its NOT EXISTS subquery, so a bare FROM-match sends the
    // canonical→raw query to the raw→canonical route and both read as 1.
    [/SELECT COUNT\(\*\) n FROM sms_raw\.cone_raw r/, [{ n: opts.rawOnly ?? 0 }]],
    [/SELECT COUNT\(\*\) n FROM sms\.cone_event c/, [{ n: opts.canonOnly ?? 0 }]],
    [/merge_key_is_unique/, [{ n: 0 }]],
    [/FROM sms\.dq_finding/, []],
  ]);
}

const iflPool = (ids: number[]): Pool => fakePool([[/FROM \[pack1_TP1U2\]/, [stats(ids)]]]);

const world = {
  app: undefined as unknown as Pool,
  ifl: undefined as unknown as Pool,
  altIfl: undefined as unknown as Pool,
  identity: async () => IDENTITY_OF_OPEN,
  tables: async () => TABLES,
  // --source-db: `createPool` is only ever called when the flag is given, to
  // open the alternate connection. Left throwing by default so a test that
  // forgets to pass --source-db (and so never calls it) cannot accidentally
  // pass because some earlier test's fixture leaked through.
  createPool: async (..._a: unknown[]): Promise<Pool> => {
    throw new Error('world.createPool was not configured by this test');
  },
};

const { verify } = await import('./verify.js');

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.join(' '));
  });
  world.identity = async () => IDENTITY_OF_OPEN;
  world.tables = async () => TABLES;
  world.createPool = async () => {
    throw new Error('world.createPool was not configured by this test');
  };
});
afterEach(() => vi.restoreAllMocks());
const printed = () => out.join('\n');

describe('sms verify — per-generation reconciliation', () => {
  it('exits 0 when the open epoch matches the source on count, min, max and sum', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);

    expect(await verify()).toBe(0);
    expect(printed()).toContain('create_date matches · fingerprint matches   OK');
    expect(printed()).toContain('0 raw without canonical · 0 canonical without raw   OK');
    expect(printed()).not.toContain('STOP');
    // The header names both sides, so an OK is tied to a specific source.
    expect(printed()).toContain('source   localhost/DATA_TP1U2_SEP07');
    expect(printed()).toContain('app      localhost/sms');
  });

  it('STOPs when the id SUM differs even though COUNT, MIN and MAX are equal', async () => {
    // Source holds {1,3,4}; we hold {1,2,4}. Three rows each, same range —
    // one missing, one extra. Only the sum (8 vs 7) can see it.
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 4] }] });
    world.ifl = iflPool([1, 3, 4]);

    expect(await verify()).not.toBe(0);
    expect(printed()).toContain('same count and id range, different ids');
    expect(printed()).toMatch(/raw\s+3\s+1\s+4\s+7\s+STOP/);
  });

  it('reports a closed epoch as archived, never asks the source about it, and exits 0 beside a good open one', async () => {
    world.app = appPool({
      epochs: [CLOSED, OPEN],
      raw: [
        { epoch: 1, ids: [1, 2, 3, 4, 5] },
        { epoch: 9, ids: [1, 2] },
      ],
    });
    world.ifl = iflPool([1, 2]);

    expect(await verify()).toBe(0);
    expect(printed()).toContain('epoch 1   closed  — archived — 5 rows, source generation no longer present');
    // Exactly one source query — the open epoch's stats. The closed one is
    // reconciled raw ⇄ canonical only.
    expect(world.ifl.calls).toHaveLength(1);
  });

  it('with only a closed epoch: archived, but STOPs because nothing is open for the worker to sync', async () => {
    world.app = appPool({ epochs: [CLOSED], raw: [{ epoch: 1, ids: [1, 2, 3] }] });
    world.ifl = iflPool([]);

    expect(await verify()).not.toBe(0);
    expect(printed()).toContain('archived — 3 rows');
    expect(printed()).toContain('no open generation for pack1_TP1U2');
    expect(printed()).toContain('sms epoch:accept --table=pack1_TP1U2');
    expect(world.ifl.calls).toHaveLength(0);
  });

  it('STOPs on a raw row with no canonical row even when the source triple matches', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }], rawOnly: 1 });
    world.ifl = iflPool([1, 2, 3]);

    expect(await verify()).not.toBe(0);
    expect(printed()).toContain('1 raw without canonical · 0 canonical without raw   STOP');
  });

  it('STOPs, naming epoch:accept, when the source create_date is not the open epoch’s', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    world.identity = async () => ({ ...IDENTITY_OF_OPEN, createdKey: '2026-09-30T00:00:00.000Z' });

    expect(await verify()).not.toBe(0);
    expect(printed()).toContain('not the generation this epoch describes');
    expect(printed()).toContain('sms epoch:accept --table=pack1_TP1U2 --confirm');
    // Counts are not compared against a source that is not this generation.
    expect(world.ifl.calls).toHaveLength(0);
  });
});

describe('sms verify — the tables come from configuration', () => {
  it('stops on the same "no source tables" halt as the worker, before asking either database anything', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    world.tables = async () => {
      throw new Error('No source tables are configured for line 1. Add them in Setup › Sources (sms.source_table).');
    };

    await expect(verify()).rejects.toThrow(/No source tables are configured for line 1/);
    expect(world.app.calls).toHaveLength(0);
    expect(world.ifl.calls).toHaveLength(0);
  });
});

/**
 * The archived floor (migration 037, 16 Sep 2026): the whole reason this
 * change exists. Before it, a source pruning its own oldest rows made
 * src.n < raw.n, src.lo > raw.lo and src.sum < raw.sum simultaneously — all
 * three — and verify failed PERMANENTLY on exactly the rows the sidecar is
 * for. These pin that this no longer happens once the worker has recorded a
 * floor (sync-worker/src/epoch.ts's observeArchivedFloor writes it; here it
 * arrives already on the epoch row, as it would from a real query).
 */
describe('sms verify — the archived floor', () => {
  const ARCHIVED_AT = new Date('2026-09-14T03:00:00.000Z');

  it('PASSES when the source has pruned rows below the recorded floor, and reports the remainder with its observed date', async () => {
    // We hold 1..6 (raw, unfiltered). The source has pruned 1..3 and now only
    // holds 4..6 — exactly what a floor of 4 says to expect.
    world.app = appPool({
      epochs: [{ ...OPEN, archived_below_id: 4, archived_observed_utc: ARCHIVED_AT }],
      raw: [{ epoch: 9, ids: [1, 2, 3, 4, 5, 6] }],
      scoped: [4, 5, 6],
    });
    world.ifl = iflPool([4, 5, 6]);

    expect(await verify()).toBe(0);
    expect(printed()).not.toContain('STOP');
    expect(printed()).toContain('compared over id ≥ 4 (archived floor)');
    expect(printed()).toContain('archived   3 row(s) held below id 4');
    expect(printed()).toContain(ARCHIVED_AT.toISOString());
    expect(printed()).toContain('accounted for, not compared');
    // The comparison itself is scoped — the request for it names the floor.
    expect(world.app.calls.some((c) => /AND src_id >= @floor/.test(c))).toBe(true);
  });

  it('reports zero remainder, still OK, when the floor has caught up exactly to what raw holds', async () => {
    world.app = appPool({
      epochs: [{ ...OPEN, archived_below_id: 1, archived_observed_utc: ARCHIVED_AT }],
      raw: [{ epoch: 9, ids: [1, 2, 3] }],
      scoped: [1, 2, 3],
    });
    world.ifl = iflPool([1, 2, 3]);

    expect(await verify()).toBe(0);
    expect(printed()).toContain('archived   0 row(s) held below id 1');
  });

  it('still fails a row genuinely missing INSIDE the floor-scoped range, with the same diagnosis quality as today', async () => {
    // Floor is 4. Above it, source holds {4,6,7}; we hold {4,5,7} — same
    // count (3), same range (4..7), different ids: only the sum (17 vs 16)
    // can see it, exactly like the unscoped case this mirrors.
    world.app = appPool({
      epochs: [{ ...OPEN, archived_below_id: 4, archived_observed_utc: ARCHIVED_AT }],
      raw: [{ epoch: 9, ids: [1, 2, 3, 4, 5, 7] }],
      scoped: [4, 5, 7],
    });
    world.ifl = iflPool([4, 6, 7]);

    expect(await verify()).not.toBe(0);
    expect(printed()).toContain('same count and id range, different ids');
  });

  it('STOPs, naming a reseed rather than absorbing it, when the source MIN has fallen below the recorded floor', async () => {
    // Floor was recorded at 100 on some earlier pass; the live source now
    // reports a MIN of 1 — ids do not come back, so this is not archiving.
    world.app = appPool({
      epochs: [{ ...OPEN, archived_below_id: 100, archived_observed_utc: ARCHIVED_AT }],
      raw: [{ epoch: 9, ids: [1, 2, 3] }],
      scoped: [],
    });
    world.ifl = iflPool([1, 2, 3]);

    expect(await verify()).not.toBe(0);
    expect(printed()).toContain("the source's current MIN(id) is 1, BELOW the recorded floor 100");
    expect(printed()).toContain('reseed');
    expect(printed()).toContain('sms epoch:accept --table=pack1_TP1U2 --confirm --label "<what this is>"');
  });

  it('falls back to the old whole-table comparison when no floor has been observed yet', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);

    expect(await verify()).toBe(0);
    expect(printed()).toContain('compared over whole table');
    expect(printed()).not.toContain('archived   ');
  });
});

/**
 * `--from/--to` (Part 2, 16 Sep 2026): the acceptance-engineer shape of
 * question, "reconcile this window against our own SELECT" — run at the FAT
 * beside IFL's own query. TABLES here carries no `ProductionDate` column, so
 * productionColumn() falls back to `Date`/`src_Date`, same as sack1_TP1U2.
 */
describe('sms verify — --from/--to window', () => {
  it('narrows the comparison to the window and reports the bound it used', async () => {
    world.app = appPool({
      epochs: [OPEN],
      raw: [{ epoch: 9, ids: [1, 2, 3, 4, 5] }],
      scoped: [2, 3],
    });
    world.ifl = iflPool([2, 3]);

    const code = await verify(['--from=2026-09-08', '--to=2026-09-08']);
    expect(code).toBe(0);
    expect(printed()).toContain('window   2026-09-08 .. 2026-09-08');
    expect(printed()).toContain('acquisition lag is ~18 min');
    expect(printed()).toContain('compared over window 2026-09-08..2026-09-08');
    expect(world.app.calls.some((c) => /\[src_Date\] >= @from AND \[src_Date\] < @to/.test(c))).toBe(true);
    expect(world.ifl.calls.some((c) => /\[Date\] >= @from AND \[Date\] < @to/.test(c))).toBe(true);
  });

  it('STOPs on a real mismatch inside the window, same as an unscoped run', async () => {
    world.app = appPool({
      epochs: [OPEN],
      raw: [{ epoch: 9, ids: [1, 2, 3, 4, 5] }],
      scoped: [2, 3],
    });
    world.ifl = iflPool([2, 4]); // source's window holds a different row than ours

    expect(await verify(['--from=2026-09-08', '--to=2026-09-08'])).not.toBe(0);
  });
});

/**
 * `sms.verify_run` (migration 039, UX Phase 7 Brief 2): until now `sms
 * verify` reconciled and printed but persisted nothing, so the application
 * could never say whether — or against WHICH source — it had ever been
 * reconciled. These pin what recordVerifyRun() actually binds, and that a
 * failure to write the row never changes the exit code: every OTHER test in
 * this file uses appPool(), which has no route for `INSERT INTO
 * sms.verify_run`, and every one of them still returns the exit code its
 * reconciliation earned — that absence, silently swallowed and logged, IS
 * the proof; the last case here just names it.
 */
function capturingAppPool(base: Pool): Pool & { captured: Map<string, unknown>[] } {
  const captured: Map<string, unknown>[] = [];
  const request = () => {
    const inputs = new Map<string, unknown>();
    const req = {
      input: (name: string, _type: unknown, value: unknown) => {
        inputs.set(name, value);
        return req;
      },
      query: async (sql: string) => {
        if (sql.includes('INSERT INTO sms.verify_run')) {
          captured.push(new Map(inputs));
          return { recordset: [] as unknown[] };
        }
        return base.request().query(sql);
      },
    };
    return req;
  };
  return { request, calls: base.calls, captured } as unknown as Pool & { captured: Map<string, unknown>[] };
}

describe('sms verify — records sms.verify_run (migration 039)', () => {
  it('a clean run binds the real source/app identity, 0 stops, verdict "clean" and a version string', async () => {
    const pool = capturingAppPool(appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] }));
    world.app = pool;
    world.ifl = iflPool([1, 2, 3]);

    expect(await verify()).toBe(0);
    expect(pool.captured).toHaveLength(1);
    const ins = pool.captured[0]!;
    // Exactly the four facts the header of verify() already prints
    // (verify.ts:457-458) — a run against this fixture's `DATA_TP1U2_SEP07`
    // source must never be recorded as a run against anything else.
    expect(ins.get('srcServer')).toBe('localhost');
    expect(ins.get('srcDb')).toBe('DATA_TP1U2_SEP07');
    expect(ins.get('appServer')).toBe('localhost');
    expect(ins.get('appDb')).toBe('sms');
    expect(ins.get('line')).toBe(1);
    expect(ins.get('stops')).toBe(0);
    expect(ins.get('verdict')).toBe('clean');
    expect(ins.get('weights')).toBe(false);
    expect(ins.get('wFrom')).toBeNull();
    expect(ins.get('wTo')).toBeNull();
    expect(typeof ins.get('ver')).toBe('string');
  });

  it('a STOP run binds verdict "stops" and the real stop count, not a flag', async () => {
    // Same fixture as "STOPs when the id SUM differs…" above.
    const pool = capturingAppPool(appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 4] }] }));
    world.app = pool;
    world.ifl = iflPool([1, 3, 4]);

    expect(await verify()).not.toBe(0);
    expect(pool.captured).toHaveLength(1);
    expect(pool.captured[0]!.get('verdict')).toBe('stops');
    expect(Number(pool.captured[0]!.get('stops'))).toBeGreaterThan(0);
  });

  it('--from/--to binds the window bounds, not null', async () => {
    const pool = capturingAppPool(
      appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3, 4, 5] }], scoped: [2, 3] }),
    );
    world.app = pool;
    world.ifl = iflPool([2, 3]);

    expect(await verify(['--from=2026-09-08', '--to=2026-09-08'])).toBe(0);
    expect(pool.captured[0]!.get('wFrom')).toEqual(new Date('2026-09-08T00:00:00.000Z'));
    // window_to is stored as parseVerifyArgs' EXCLUSIVE bound (the instant
    // after --to ends), matching Range.to everywhere else in this file.
    expect(pool.captured[0]!.get('wTo')).toEqual(new Date('2026-09-09T00:00:00.000Z'));
  });

  it('a failure to write the row never changes the exit code (appPool() has no INSERT route)', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    expect(await verify()).toBe(0);
  });
});

/**
 * OPERATOR-EDITABLE IDENTIFIERS (23 Sep 2026).
 *
 * `verify` interpolates `def.sourceTable` and `def.rawTable` into ten
 * statements because T-SQL cannot bind an identifier, and `sourceTable` comes
 * from `sms.source_table` — a row a rank-4 account edits in Setup › Sources.
 * That name is already gated on write (`lineConfig.updateSourceTable`) and on
 * read (`defsFromRows`); `assertSafeDefs` is a third, point-of-use check, so
 * the safety of those interpolations is visible in verify.ts itself rather
 * than only by following an import into another package. These two pin that
 * the check is real: the fake `loadSourceTables` above bypasses
 * `defsFromRows` entirely, which is exactly the shape of a future refactor
 * that hand-builds a def.
 */
describe('verify — the identifiers it interpolates are checked where they are used', () => {
  it('refuses a source table name that is not a plain identifier, before any SQL is built', async () => {
    world.tables = async () => [{ ...TABLES[0]!, sourceTable: 'pack1]; DROP TABLE x; --' }];
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    await expect(verify()).rejects.toThrow(/unsafe source table name/);
    // Nothing was asked of the source: the guard runs before the first read.
    expect(world.ifl.calls).toHaveLength(0);
  });

  it('refuses a raw table that is not the one migration fixed for that kind', async () => {
    world.tables = async () => [{ ...TABLES[0]!, rawTable: 'sms_raw.somewhere_else' }];
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    await expect(verify()).rejects.toThrow(/unexpected raw table/);
  });

  it('the real configured tables pass the guard unchanged', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    expect(await verify()).toBe(0);
  });
});

/**
 * `--source-db=<name>` (R-17, 29 Sep 2026, Task W2-D): reconciles a CLOSED,
 * backfilled epoch against a NAMED alternate database instead of leaving it
 * as "archived, unchecked" — the live source (`world.ifl`) genuinely cannot
 * corroborate a closed generation, but a backfill archive can. `createPool`
 * is mocked to hand back a second fake pool (`world.altIfl`) so these tests
 * can assert exactly what it was and was not asked.
 *
 * `--epoch=<id>[,<id>…]` is now REQUIRED alongside `--source-db` (fixed
 * 29 Sep 2026, after the R-17 end-to-end run found the un-scoped version
 * compared EVERY closed epoch sharing a source table against one archive —
 * 12 spurious STOPs on epochs 5-16 after a correct backfill of 1-4, since
 * the raw layer holds several unrelated generations under the same
 * `source_table` text (July, a sim-tombstone, September, ...) and one
 * archive is only ever a superset of ONE of them). Every fixture below that
 * exercises the reconciliation itself now names the closed epoch(s) it
 * means with --epoch.
 */
describe('sms verify — --source-db reconciles a closed/backfilled epoch', () => {
  it('passes a closed epoch that matches the alternate source on count and id-sum, alongside a clean open one', async () => {
    world.app = appPool({
      epochs: [CLOSED, OPEN],
      raw: [
        { epoch: 1, ids: [1, 2, 3, 4, 5] },
        { epoch: 9, ids: [1, 2, 3] },
      ],
    });
    world.ifl = iflPool([1, 2, 3]); // the OPEN epoch's live source
    world.altIfl = iflPool([1, 2, 3, 4, 5]); // CLOSED epoch's backfill archive: same count, same sum
    world.createPool = async () => world.altIfl;

    expect(await verify(['--source-db=R17_SRC', '--epoch=1'])).toBe(0);
    expect(printed()).toContain('source-db  R17_SRC/pack1_TP1U2');
    expect(printed()).toMatch(/raw\s+5.*OK/);
    expect(printed()).not.toContain('STOP');
    // Exactly one query against the alternate pool — the closed epoch's
    // whole-table stats. The open epoch never touches it.
    expect(world.altIfl.calls).toHaveLength(1);
  });

  it('STOPs with a clear message when the closed epoch does not reconcile against --source-db', async () => {
    world.app = appPool({ epochs: [CLOSED, OPEN], raw: [{ epoch: 1, ids: [1, 2, 3, 4, 5] }, { epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    // Alternate source has the same count but a different id-sum (6 vs 5 wrong id).
    world.altIfl = iflPool([1, 2, 3, 4, 6]);
    world.createPool = async () => world.altIfl;

    const code = await verify(['--source-db=R17_SRC', '--epoch=1']);
    expect(code).not.toBe(0);
    expect(printed()).toContain('does not reconcile against --source-db=R17_SRC');
    expect(printed()).toMatch(/count 5 vs 5, id-sum 15 vs 16/);
  });

  it('an open epoch named by --epoch is verified against the live source; --source-db plays no part in it', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    let calls = 0;
    world.createPool = async () => {
      calls++;
      return world.altIfl;
    };
    world.altIfl = fakePool([]); // never queried — would throw "no answer" if it were

    expect(await verify(['--source-db=R17_SRC', '--epoch=9'])).toBe(0);
    expect(printed()).toContain('create_date matches · fingerprint matches   OK');
    expect(printed()).not.toContain('STOP');
    // The alternate connection is opened (so a later closed epoch could use
    // it) but never queried — an OPEN epoch always compares against the live
    // source, --source-db or not.
    expect(calls).toBe(1);
  });

  it('STOPs, naming the database, when the alternate source cannot be reached — closed epoch stays unreconciled, not silently skipped', async () => {
    world.app = appPool({ epochs: [CLOSED, OPEN], raw: [{ epoch: 1, ids: [1, 2, 3] }, { epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    world.createPool = async () => {
      throw new Error('login failed for R17_SRC');
    };

    const code = await verify(['--source-db=R17_SRC', '--epoch=1']);
    expect(code).not.toBe(0);
    expect(printed()).toContain('cannot connect to');
    expect(printed()).toContain('R17_SRC');
    expect(printed()).toContain('login failed for R17_SRC');
  });

  it('rejects a bare --source-db with no database name before opening any connection', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    let called = false;
    world.createPool = async () => {
      called = true;
      throw new Error('should not be called');
    };

    await expect(verify(['--source-db'])).rejects.toThrow(/--source-db must be given a database name/);
    expect(called).toBe(false);
  });

  /**
   * The bug the R-17 end-to-end run actually found (29 Sep 2026): a table's
   * raw layer can hold MANY closed epochs sharing the same `source_table`
   * text (here: epoch 1, a correctly-backfilled July generation, PLUS epoch
   * 2, an unrelated closed generation --source-db was never built to
   * describe). Reconciling every closed epoch against one named archive
   * produced spurious STOPs on the ones it doesn't cover; --epoch scopes the
   * reconciliation to only the epoch(s) named.
   */
  it('--epoch scopes --source-db to the named closed epoch(s) only — an unrelated closed epoch is left archived, not spuriously STOPped', async () => {
    const OTHER_CLOSED = {
      ...CLOSED,
      epoch_id: 2,
      source_created_key: '2026-09-20T00:00:00.000Z',
      label: 'sim tombstone',
    };
    world.app = appPool({
      epochs: [CLOSED, OTHER_CLOSED, OPEN],
      raw: [
        { epoch: 1, ids: [1, 2, 3, 4, 5] }, // backfilled correctly — matches the archive
        { epoch: 2, ids: [100, 200] }, // unrelated generation — would NOT match the archive
        { epoch: 9, ids: [1, 2, 3] },
      ],
    });
    world.ifl = iflPool([1, 2, 3]);
    world.altIfl = iflPool([1, 2, 3, 4, 5]); // the archive only ever describes epoch 1
    world.createPool = async () => world.altIfl;

    const code = await verify(['--source-db=R17_SRC', '--epoch=1']);

    expect(code).toBe(0);
    expect(printed()).not.toContain('STOP');
    expect(printed()).toContain('not named by --epoch — skipped');
    // Only epoch 1's whole-table stats were asked of the alternate source —
    // epoch 2 never touched it, so it could not have produced a spurious STOP.
    expect(world.altIfl.calls).toHaveLength(1);
    // The unrelated OPEN epoch (9) was not named either, so it never touched
    // the live source — this is the R-17 fix's own scope, not just the
    // closed-epoch one Task W2-D already covered.
    expect(world.ifl.calls).toHaveLength(0);
  });

  it('--source-db without --epoch is a usage error, before any connection is opened', async () => {
    world.app = appPool({ epochs: [CLOSED, OPEN], raw: [{ epoch: 1, ids: [1, 2, 3] }, { epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);
    let called = false;
    world.createPool = async () => {
      called = true;
      throw new Error('should not be called');
    };

    await expect(verify(['--source-db=R17_SRC'])).rejects.toThrow(
      /--source-db requires --epoch=<id>\[,<id>,\.\.\.\]/,
    );
    expect(called).toBe(false);
  });

  it('--epoch rejects a non-integer or non-positive id', async () => {
    await expect(verify(['--source-db=R17_SRC', '--epoch=abc'])).rejects.toThrow(
      /--epoch must be a comma-separated list of positive integers/,
    );
    await expect(verify(['--source-db=R17_SRC', '--epoch=0'])).rejects.toThrow(
      /--epoch must be a comma-separated list of positive integers/,
    );
  });
});

/**
 * R-17 live run (29 Sep 2026): even after Task W2-D scoped `--source-db` to
 * the named CLOSED epoch(s), an OPEN epoch NOT named by `--epoch` was still
 * reconciled against the LIVE source unconditionally — a table's live source
 * drifts in a running system, so an operator running
 * `--source-db=<archive> --epoch=1` to verify a backfill got exit 1 and
 * STOPs that had nothing to do with the epoch they named. `--epoch` now
 * scopes an ordinary run too: it means "verify ONLY these epochs", open or
 * closed, whether or not `--source-db` is also given.
 */
describe('sms verify — R-17: --epoch scopes OPEN epochs too, not just what --source-db reconciles', () => {
  it('--source-db plus --epoch=1 does not reconcile an unnamed, drifting OPEN epoch against the live source', async () => {
    const DRIFTING_OPEN = { ...OPEN, epoch_id: 13 };
    world.app = appPool({
      epochs: [CLOSED, DRIFTING_OPEN],
      raw: [
        { epoch: 1, ids: [1, 2, 3, 4, 5] },
        { epoch: 13, ids: [1, 2, 3] },
      ],
    });
    // Drifted: if epoch 13 were compared against this, it would STOP (the
    // live source no longer matches what raw holds for it).
    world.ifl = iflPool([1, 2, 9]);
    world.altIfl = iflPool([1, 2, 3, 4, 5]); // epoch 1's archive — matches
    world.createPool = async () => world.altIfl;

    const code = await verify(['--source-db=R17_SRC', '--epoch=1']);

    expect(code).toBe(0);
    expect(printed()).not.toContain('STOP');
    expect(printed()).toMatch(/epoch 13\s+OPEN\s+not named by --epoch — skipped/);
    // The live source was never asked about epoch 13 at all.
    expect(world.ifl.calls).toHaveLength(0);
  });

  it('plain verify, without --epoch, is unchanged: every epoch — open or closed — is still verified', async () => {
    world.app = appPool({ epochs: [OPEN], raw: [{ epoch: 9, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);

    expect(await verify()).toBe(0);
    expect(printed()).toContain('create_date matches · fingerprint matches   OK');
    expect(printed()).not.toContain('skipped');
    expect(world.ifl.calls).toHaveLength(1);
  });

  it('--epoch=13 alone, with no --source-db, verifies epoch 13 against the live source', async () => {
    const NAMED_OPEN = { ...OPEN, epoch_id: 13 };
    world.app = appPool({ epochs: [NAMED_OPEN], raw: [{ epoch: 13, ids: [1, 2, 3] }] });
    world.ifl = iflPool([1, 2, 3]);

    const code = await verify(['--epoch=13']);

    expect(code).toBe(0);
    expect(printed()).toContain('create_date matches · fingerprint matches   OK');
    expect(printed()).not.toContain('skipped');
    expect(world.ifl.calls).toHaveLength(1);
  });
});
