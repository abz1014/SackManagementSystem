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
vi.mock('@sms/sync-worker', () => ({
  loadSourceTables: () => world.tables(),
  readSourceIdentity: () => world.identity(),
}));

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
  return { request: () => req, calls } as unknown as Pool;
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
  identity: async () => IDENTITY_OF_OPEN,
  tables: async () => TABLES,
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
