/**
 * Regression tests for the runner's generation gates (Sep 2026, source epochs)
 * and its per-table isolation (roadmap Phase 2, 14 Sep 2026).
 *
 * IFL dropped and recreated the four wide tables on 2026-08-05 (~18:55-19:03) and
 * every identity restarted at 1. The schema fingerprint could not see it: it
 * hashes only the depended-on COLUMNS, and sack1_TP1U2's signature is
 * byte-identical across that wipe. With a July watermark of 142,511 the reader
 * asked for `id > 142011`, got nothing back, and recorded outcome='success'
 * forever while the plant ran 3,000 cones a day.
 *
 * The runner now (1) resolves WHICH generation it is reading via resolveEpoch —
 * which halts on an unknown generation, a changed server/database, or column
 * drift within a live generation — (2) reads a PER-EPOCH watermark, (3) halts
 * if that watermark is above everything the source holds (a restore/reseed
 * inside one generation, which epoch resolution cannot see), and (4) halts,
 * rather than warns, when a beyond-overlap batch writes nothing.
 *
 * Since Phase 2 a halt is PER TABLE: the halting table gets its row, the
 * others are still read and written, and one TableHaltsError listing every
 * halt is thrown after. The tests pin each gate AND that none fires on a
 * healthy pass or on a freshly accepted, still-empty generation.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

// Two tables: the gates are exercised on the first, and the second exists so
// isolation can be asserted — it is read and written whatever the first did.
//
// Since roadmap Phase 1 the runner loads its tables from sms.source_table
// (loadSourceTables) at the start of every pass; the fake answers with these
// two, or throws when a test says the line has none configured.
const TABLES = [
  {
    key: 'cone',
    sourceTable: 'pack1_TP1U2',
    rawTable: 'sms_raw.cone_raw',
    systemCode: 'ifl_sql',
    columns: [{ src: 'id', raw: 'src_id', type: 'int' }],
  },
  {
    key: 'sack',
    sourceTable: 'sack1_TP1U2',
    rawTable: 'sms_raw.sack_raw',
    systemCode: 'ifl_sql',
    columns: [{ src: 'id', raw: 'src_id', type: 'int' }],
  },
];
const loadSourceTables = vi.fn(async (_p: unknown, _line: number) => TABLES);
vi.mock('./reader/sourceTables.js', () => ({
  loadSourceTables: (p: unknown, line: number) => loadSourceTables(p, line),
}));

const EPOCH = {
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

interface Def { sourceTable: string; systemCode: string }
interface Drift { check_name: string; severity: string; subject_table: string; count: number; detail: string }

/** What the fake source/epoch layer reports; each test rewrites what it needs. */
const world = {
  resolve: (async (_def: Def) => EPOCH) as (def: Def) => Promise<typeof EPOCH>,
  maxId: 999_999 as number | null,
  rows: [{ src_id: 1 }] as { src_id: number }[],
  drift: null as Drift | null,
};

vi.mock('./epoch.js', () => ({
  resolveEpoch: (_app: unknown, _ifl: unknown, def: Def) => world.resolve(def),
  checkColumnDrift: async () => world.drift,
}));

const readSince = vi.fn(async (_afterId: number, _def?: Def) => world.rows);
// The registry is faked so a test can configure any system code; a code of
// 'plc_direct' throws the real registry's refusal, to pin what the runner
// does with a table it has no adapter for.
vi.mock('./reader/SourceAdapter.js', async () => {
  const real = await vi.importActual<typeof import('./reader/SourceAdapter.js')>('./reader/SourceAdapter.js');
  return {
    ...real,
    createAdapter: (code: string, _pool: unknown, def: Def) => {
      if (code === 'plc_direct') return real.createAdapter(code, _pool as never, def as never);
      return {
        systemCode: code,
        def,
        async maxSourceId() {
          return world.maxId;
        },
        async readSince(afterId: number) {
          return readSince(afterId, def);
        },
      };
    },
  };
});

let watermark: number | null = 0;
const startSyncRun = vi.fn(async (_p: unknown, _s: { runId: string; sourceEpoch: number; adapter: string; targetTable: string }) => 1);
interface Halt {
  runId: string;
  adapter: string;
  targetTable: string;
  sourceEpoch: number | null;
  watermarkFrom: number | null;
  error: string;
}
const recordHaltedRun = vi.fn(async (_p: unknown, _h: Halt): Promise<void> => undefined);
const finishSyncRun = vi.fn(async (_p: unknown, _id: number, _f: { outcome: string; error?: string }): Promise<void> => undefined);
vi.mock('./store.js', () => ({
  getWatermark: async () => watermark,
  startSyncRun: (p: unknown, s: { runId: string; sourceEpoch: number; adapter: string; targetTable: string }) => startSyncRun(p, s),
  finishSyncRun: (p: unknown, id: number, f: { outcome: string; error?: string }) => finishSyncRun(p, id, f),
  recordHaltedRun: (p: unknown, h: Halt) => recordHaltedRun(p, h),
}));

interface DqFinding {
  check_name: string;
  severity: string;
  subject_table: string;
  count: number;
  detail: string;
}
const persistRaw = vi.fn(
  async (..._a: unknown[]): Promise<{ read: number; written: number }> => ({ read: 1, written: 1 }),
);
vi.mock('./raw/persistRaw.js', () => ({ persistRaw: (...a: unknown[]) => persistRaw(...a) }));
const persistFindings = vi.fn(
  async (_pool: unknown, _runId: string, _f: DqFinding[]): Promise<void> => undefined,
);
vi.mock('./transform/dq.js', () => ({
  persistFindings: (p: unknown, r: string, f: DqFinding[]) => persistFindings(p, r, f),
}));

const { runOnce, TableHaltsError } = await import('./runner.js');

const pool = {} as ConnectionPool;
const cfg = { lineId: 1, overlapRows: 500, iflData: { server: 'localhost', database: 'DATA_TP1U2_SEP07' } } as never;

beforeEach(() => {
  world.resolve = async () => EPOCH;
  world.maxId = 999_999;
  world.rows = [{ src_id: 1 }];
  world.drift = null;
  watermark = 142_511;
  loadSourceTables.mockClear();
  loadSourceTables.mockResolvedValue(TABLES);
  readSince.mockClear();
  startSyncRun.mockClear();
  finishSyncRun.mockClear();
  recordHaltedRun.mockClear();
  persistRaw.mockClear();
  persistFindings.mockClear();
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
});

const halts = () => recordHaltedRun.mock.calls.map((c) => c[1]);
/** Make only the cone table trip its generation gate. */
const coneResolveFails = (message: string) => {
  world.resolve = async (def) => {
    if (def.sourceTable === 'pack1_TP1U2') throw new Error(message);
    return EPOCH;
  };
};

describe('runOnce — generation gates', () => {
  it('halts the table whose generation cannot be resolved, BEFORE reading it', async () => {
    coneResolveFails('Source generation changed for pack1_TP1U2. sms epoch:accept');
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/generation changed/);
    // cone was never read; sack still was (isolation) — see the next describe.
    expect(readSince.mock.calls.map((c) => c[1]!.sourceTable)).toEqual(['sack1_TP1U2']);
    expect(startSyncRun.mock.calls.map((c) => c[1].targetTable)).toEqual(['sack_raw']);
  });

  it('halts when the watermark is above everything the source holds (restore/reseed)', async () => {
    // The real numbers: our cone watermark vs the September copy's highest id.
    watermark = 204_076;
    world.maxId = 132_552;
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/gone backwards/);
    expect(persistRaw).not.toHaveBeenCalled();
  });

  it('halts when the source table is empty but we hold rows for this generation', async () => {
    watermark = 142_511;
    world.maxId = null;
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/table empty/);
    expect(persistRaw).not.toHaveBeenCalled();
  });

  it('does NOT fire on a healthy pass, and records the generation on the sync run', async () => {
    watermark = 100;
    world.maxId = 5_000;
    await expect(runOnce(pool, pool, cfg)).resolves.toHaveLength(2);
    expect(persistRaw).toHaveBeenCalledTimes(2);
    // The epoch is threaded to persistRaw (last arg) and to the sync_run row.
    expect(persistRaw.mock.calls[0]![5]).toBe(EPOCH.epoch_id);
    expect(startSyncRun.mock.calls[0]![1].sourceEpoch).toBe(EPOCH.epoch_id);
    // A healthy pass writes no halt row for anyone.
    expect(recordHaltedRun).not.toHaveBeenCalled();
    // The tables came from configuration, for this line, once per pass.
    expect(loadSourceTables).toHaveBeenCalledTimes(1);
    expect(loadSourceTables).toHaveBeenCalledWith(pool, 1);
  });

  it("the sync_run adapter is the table's configured system code, not a literal", async () => {
    watermark = 100;
    world.maxId = 5_000;
    loadSourceTables.mockResolvedValue(TABLES.map((t) => ({ ...t, systemCode: 'plant_sql' })));
    await runOnce(pool, pool, cfg);
    expect(startSyncRun.mock.calls.map((c) => c[1].adapter)).toEqual(['plant_sql', 'plant_sql']);
  });

  it('never blocks a freshly accepted generation that has no rows yet', async () => {
    // watermark null = "no rows in this epoch". The source's max is tiny and
    // would be "below" any stale number; it must not be compared to one.
    watermark = null;
    world.maxId = 1;
    await expect(runOnce(pool, pool, cfg)).resolves.toHaveLength(2);
    expect(persistRaw).toHaveBeenCalledTimes(2);
  });

  it('floors afterId at -1 so a legitimate src_id = 0 row is read on a fresh generation', async () => {
    // rejectWeight1_TP1U2 has a real row at id 0; `id > 0` would skip it.
    watermark = null;
    world.maxId = 10;
    await runOnce(pool, pool, cfg);
    expect(readSince.mock.calls[0]![0]).toBe(-1);
  });

  it('halts, with an ERROR finding, when a beyond-overlap batch writes nothing', async () => {
    // With the probe epoch-scoped, this can only mean the id space was reused
    // INSIDE one generation. It is a fault to stop on, not a curiosity to log.
    watermark = 100;
    world.maxId = 5_000;
    persistRaw.mockResolvedValueOnce({ read: 2_346, written: 0 });
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/none written/);
    expect(persistFindings).toHaveBeenCalledTimes(1);
    const f = persistFindings.mock.calls[0]![2][0]!;
    expect(f.check_name).toBe('raw_read_without_write');
    expect(f.severity).toBe('ERROR');
    expect(f.count).toBe(2_346);
  });

  it('stays quiet when a no-write batch is within the overlap window', async () => {
    // Re-reading the last 500 rows and writing none is exactly what the overlap
    // is for — it must not cry wolf every single pass.
    watermark = 100;
    world.maxId = 5_000;
    persistRaw.mockResolvedValueOnce({ read: 500, written: 0 });
    await expect(runOnce(pool, pool, cfg)).resolves.toHaveLength(2);
    expect(persistFindings).not.toHaveBeenCalled();
  });
});

/**
 * Roadmap Phase 1: a line with no enabled source tables must not read
 * anything — and must not fall back to line 1's tables, which is the
 * cross-contamination a LINE_ID=2 worker pointed at the wrong rows would
 * cause. It halts with the message that names the screen to fix it in.
 */
describe('runOnce — configuration gate', () => {
  it('halts with the "no source tables" message, before touching the source', async () => {
    loadSourceTables.mockRejectedValue(
      new Error('No source tables are configured for line 1. Add them in Setup › Sources (sms.source_table).'),
    );
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/No source tables are configured for line 1/);
    expect(readSince).not.toHaveBeenCalled();
    expect(persistRaw).not.toHaveBeenCalled();
    expect(startSyncRun).not.toHaveBeenCalled();
  });

  it('leaves a halt row for every raw table the schema has, since none is configured', async () => {
    loadSourceTables.mockRejectedValue(new Error('No source tables are configured for line 1. Add them in Setup › Sources (sms.source_table).'));
    await runOnce(pool, pool, cfg).catch(() => {});
    const h = halts();
    // Not the two the fake would have configured — the configuration is
    // exactly what could not be read, so the halt owes a row per raw table.
    expect(h.map((x) => x.targetTable)).toEqual(['cone_raw', 'sack_raw', 'reject_qcs_raw', 'reject_weight_raw']);
    expect(new Set(h.map((x) => x.runId)).size).toBe(1);
    for (const x of h) {
      expect(x.error).toMatch(/Setup › Sources/);
      expect(x.adapter).toBe('unknown');
      expect(x.sourceEpoch).toBeNull();
      expect(x.watermarkFrom).toBeNull();
    }
  });
});

/**
 * Every halt used to write NOTHING to sms.sync_run. The newest row per table
 * stayed the last good one — outcome 'success' — so the Setup screen's
 * "N of 4 tables did not sync" line could never fire on a halt, and the only
 * symptom was a rising age. These pin that every exit path from runOnce now
 * leaves a row for the table that halted, saying why.
 */
describe('runOnce — every halt leaves a row for its table', () => {
  it('generation gate: a halt row for the halting table, with no epoch and no watermark', async () => {
    coneResolveFails('Source generation changed for pack1_TP1U2. sms epoch:accept');
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/generation changed/);
    const h = halts();
    expect(h.map((x) => x.targetTable)).toEqual(['cone_raw']);
    // Nothing had been established when it fired, and nothing is invented.
    expect(h[0]!.sourceEpoch).toBeNull();
    expect(h[0]!.watermarkFrom).toBeNull();
    expect(h[0]!.error).toMatch(/generation changed/);
    // The other table opened its own run row in the same pass.
    expect(startSyncRun).toHaveBeenCalledTimes(1);
    expect(startSyncRun.mock.calls[0]![1].targetTable).toBe('sack_raw');
  });

  it('backwards gate: the halt row carries the epoch and the watermark it compared', async () => {
    watermark = 204_076;
    world.maxId = 132_552;
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/gone backwards/);
    const h = halts();
    expect(h[0]!.targetTable).toBe('cone_raw');
    expect(h[0]!.sourceEpoch).toBe(EPOCH.epoch_id);
    expect(h[0]!.watermarkFrom).toBe(204_076);
    expect(h[0]!.error).toMatch(/204076.*132552/);
  });

  it('an in-run failure finishes its own row as failed and does NOT add a halt row for itself', async () => {
    watermark = 100;
    world.maxId = 5_000;
    persistRaw.mockRejectedValueOnce(new Error('deadlock victim'));
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/deadlock/);
    // cone's row is 'failed'; sack's is 'success'; nobody gets a 'halted' row.
    expect(finishSyncRun).toHaveBeenCalledTimes(2);
    expect(finishSyncRun.mock.calls.map((c) => c[2].outcome)).toEqual(['failed', 'success']);
    expect(halts()).toEqual([]);
  });

  it('a halt on the LAST table writes exactly one row, with nobody after it', async () => {
    // Cone passes; sack hits the backwards gate. The fake source's max is
    // swapped between the two resolutions so only the second table trips.
    watermark = 1_000;
    let calls = 0;
    const adapterMax = [5_000, 10];
    world.resolve = async () => {
      world.maxId = adapterMax[calls++] ?? 5_000;
      return EPOCH;
    };
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/gone backwards/);
    expect(halts().map((x) => x.targetTable)).toEqual(['sack_raw']);
    expect(startSyncRun).toHaveBeenCalledTimes(1);
  });
});

/**
 * Per-table isolation (roadmap Phase 2 item 3). One stale generation on a
 * reject table used to stop every cone and sack from reaching a screen: the
 * tables after the halt were not read, and the transform did not run.
 */
describe('runOnce — per-table isolation', () => {
  it('table 1 halts, table 2 is still read and written, and the aggregate is thrown AFTER', async () => {
    watermark = 100;
    world.maxId = 5_000;
    coneResolveFails('Source generation changed for pack1_TP1U2. sms epoch:accept');
    let thrown: unknown;
    try {
      await runOnce(pool, pool, cfg);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TableHaltsError);
    const e = thrown as InstanceType<typeof TableHaltsError>;
    // sack was written, and its outcome travels with the error for the transform.
    expect(persistRaw).toHaveBeenCalledTimes(1);
    expect(persistRaw.mock.calls[0]![1]).toMatchObject({ sourceTable: 'sack1_TP1U2' });
    expect(e.outcomes.map((o) => o.table)).toEqual(['sms_raw.sack_raw']);
    // the halt is named, once, with its reason
    expect(e.halts).toHaveLength(1);
    expect(e.halts[0]).toMatchObject({ sourceTable: 'pack1_TP1U2', targetTable: 'cone_raw' });
    expect(e.halts[0]!.reason).toMatch(/generation changed/);
    expect(e.message).toMatch(/^1 of 2 source table\(s\) did not sync this pass:/);
    expect(e.message).toMatch(/pack1_TP1U2 → cone_raw: Source generation changed/);
    // the halt row was written BEFORE the other table was read
    expect(recordHaltedRun.mock.invocationCallOrder[0]).toBeLessThan(persistRaw.mock.invocationCallOrder[0]!);
    // and there is no "Not read this pass" row for sack — it WAS read
    expect(halts().map((x) => x.targetTable)).toEqual(['cone_raw']);
  });

  it('every table halting lists every table, in configuration order', async () => {
    watermark = 204_076;
    world.maxId = 132_552;
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/2 of 2 source table\(s\) did not sync/);
    expect(halts().map((x) => x.targetTable)).toEqual(['cone_raw', 'sack_raw']);
  });

  it('a table whose system code has no adapter halts alone, naming the code', async () => {
    watermark = 100;
    world.maxId = 5_000;
    loadSourceTables.mockResolvedValue([{ ...TABLES[0]!, systemCode: 'plc_direct' }, TABLES[1]!]);
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/No adapter is registered for source system "plc_direct"/);
    expect(halts().map((x) => x.targetTable)).toEqual(['cone_raw']);
    expect(halts()[0]!.adapter).toBe('plc_direct');
    expect(persistRaw).toHaveBeenCalledTimes(1);
  });
});

/**
 * Retry with classification (roadmap Phase 2 item 2): the runner retries only
 * what a retry can cure. A refused login fails the table on the FIRST read,
 * and its class is in front of the message on the row Setup shows.
 */
describe('runOnce — classified failures', () => {
  it('an auth failure on the read is not retried and its row says [auth]', async () => {
    watermark = 100;
    world.maxId = 5_000;
    readSince.mockImplementationOnce(async () => {
      throw Object.assign(new Error("The SELECT permission was denied on the object 'pack1_TP1U2'"), {
        code: 'EREQUEST',
        number: 229,
      });
    });
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/\[auth\] The SELECT permission was denied/);
    // one read attempt for cone, then sack's — no retries
    expect(readSince).toHaveBeenCalledTimes(2);
    expect(finishSyncRun.mock.calls[0]![2]).toMatchObject({ outcome: 'failed' });
    expect(finishSyncRun.mock.calls[0]![2].error).toMatch(/^\[auth\] /);
  });

  it('a schema failure resolving the generation lands classified on the halt row', async () => {
    world.resolve = async (def) => {
      if (def.sourceTable === 'pack1_TP1U2') {
        throw Object.assign(new Error("Invalid object name 'pack1_TP1U2'"), { code: 'EREQUEST', number: 208 });
      }
      return EPOCH;
    };
    await runOnce(pool, pool, cfg).catch(() => {});
    expect(halts()[0]!.error).toBe("[schema] Invalid object name 'pack1_TP1U2'");
  });

  it("a gate's own message is not prefixed: it already says what to do", async () => {
    coneResolveFails('Source generation changed for pack1_TP1U2. sms epoch:accept');
    await runOnce(pool, pool, cfg).catch(() => {});
    expect(halts()[0]!.error).toMatch(/^Source generation changed/);
  });
});

/** Column-list drift (roadmap Phase 2 item 4): a WARNING finding, never a halt. */
describe('runOnce — column-list drift is recorded and the table still syncs', () => {
  it('persists the drift finding under the pass run id and carries on', async () => {
    watermark = 100;
    world.maxId = 5_000;
    world.drift = {
      check_name: 'source_columns_changed',
      severity: 'WARNING',
      subject_table: 'cone_raw',
      count: 1,
      detail: 'columns added: [Note nvarchar]; removed: [] on pack1_TP1U2 (generation 9) — …',
    };
    await expect(runOnce(pool, pool, cfg)).resolves.toHaveLength(2);
    expect(persistFindings).toHaveBeenCalledTimes(2); // once per table, same fake
    expect(persistFindings.mock.calls[0]![2][0]!.check_name).toBe('source_columns_changed');
    // under the PASS run id, the same one the sync_run rows carry
    expect(persistFindings.mock.calls[0]![1]).toBe(startSyncRun.mock.calls[0]![1].runId);
    expect(recordHaltedRun).not.toHaveBeenCalled();
    expect(persistRaw).toHaveBeenCalledTimes(2);
  });

  it('no drift, no finding', async () => {
    watermark = 100;
    world.maxId = 5_000;
    await runOnce(pool, pool, cfg);
    expect(persistFindings).not.toHaveBeenCalled();
  });
});
