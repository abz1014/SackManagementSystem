/**
 * Regression tests for the runner's generation gates (Sep 2026, source epochs).
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
 * These tests pin each gate AND pin that none of them fires on a healthy pass
 * or on a freshly accepted, still-empty generation.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

// One table keeps "which gate fired" unambiguous.
vi.mock('./reader/iflTables.js', () => ({
  IFL_TABLES: [
    {
      key: 'cone',
      sourceTable: 'pack1_TP1U2',
      rawTable: 'sms_raw.cone_raw',
      columns: [{ src: 'id', raw: 'src_id', type: 'int' }],
    },
  ],
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

/** What the fake source/epoch layer reports; each test rewrites what it needs. */
const world = {
  resolve: (async () => EPOCH) as () => Promise<typeof EPOCH>,
  maxId: 999_999 as number | null,
  rows: [{ src_id: 1 }] as { src_id: number }[],
};

vi.mock('./epoch.js', () => ({
  resolveEpoch: () => world.resolve(),
}));

const readSince = vi.fn(async (_afterId: number) => world.rows);
vi.mock('./reader/IflSqlAdapter.js', () => ({
  IflSqlAdapter: class {
    async maxSourceId() {
      return world.maxId;
    }
    async readSince(afterId: number) {
      return readSince(afterId);
    }
  },
}));

let watermark: number | null = 0;
const startSyncRun = vi.fn(async (_p: unknown, _s: { sourceEpoch: number }) => 1);
vi.mock('./store.js', () => ({
  getWatermark: async () => watermark,
  startSyncRun: (p: unknown, s: { sourceEpoch: number }) => startSyncRun(p, s),
  finishSyncRun: async () => undefined,
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

const { runOnce } = await import('./runner.js');

const pool = {} as ConnectionPool;
const cfg = { lineId: 1, overlapRows: 500, iflData: { server: 'localhost', database: 'DATA_TP1U2_SEP07' } } as never;

beforeEach(() => {
  world.resolve = async () => EPOCH;
  world.maxId = 999_999;
  world.rows = [{ src_id: 1 }];
  watermark = 142_511;
  readSince.mockClear();
  startSyncRun.mockClear();
  persistRaw.mockClear();
  persistFindings.mockClear();
});

describe('runOnce — generation gates', () => {
  it('halts when the generation cannot be resolved, BEFORE reading anything', async () => {
    world.resolve = async () => {
      throw new Error('Source generation changed for pack1_TP1U2. sms epoch:accept');
    };
    await expect(runOnce(pool, pool, cfg)).rejects.toThrow(/generation changed/);
    expect(readSince).not.toHaveBeenCalled();
    expect(persistRaw).not.toHaveBeenCalled();
    expect(startSyncRun).not.toHaveBeenCalled();
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
    await expect(runOnce(pool, pool, cfg)).resolves.toHaveLength(1);
    expect(persistRaw).toHaveBeenCalledTimes(1);
    // The epoch is threaded to persistRaw (last arg) and to the sync_run row.
    expect(persistRaw.mock.calls[0]![5]).toBe(EPOCH.epoch_id);
    expect(startSyncRun.mock.calls[0]![1].sourceEpoch).toBe(EPOCH.epoch_id);
  });

  it('never blocks a freshly accepted generation that has no rows yet', async () => {
    // watermark null = "no rows in this epoch". The source's max is tiny and
    // would be "below" any stale number; it must not be compared to one.
    watermark = null;
    world.maxId = 1;
    await expect(runOnce(pool, pool, cfg)).resolves.toHaveLength(1);
    expect(persistRaw).toHaveBeenCalledTimes(1);
  });

  it('floors afterId at -1 so a legitimate src_id = 0 row is read on a fresh generation', async () => {
    // rejectWeight1_TP1U2 has a real row at id 0; `id > 0` would skip it.
    watermark = null;
    world.maxId = 10;
    await runOnce(pool, pool, cfg);
    expect(readSince).toHaveBeenCalledWith(-1);
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
    await expect(runOnce(pool, pool, cfg)).resolves.toHaveLength(1);
    expect(persistFindings).not.toHaveBeenCalled();
  });
});
