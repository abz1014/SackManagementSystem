/**
 * Unit tests for R-17's backfill module (DEFECTS.md R-17, CLAUDE.md 28 Sep
 * 2026 commit-count note). Fake pools only — see cutover.test.ts /
 * epoch.test.ts / epochIngest.test.ts for the same style used across this
 * codebase's own CLI/worker tests. Nothing here opens a real connection;
 * nothing here reads or writes DATA_TP1U2* or the live sms DB.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  ALL_ZERO_FINGERPRINT,
  julyDefFor,
  assertBackfillableEpoch,
  assertJulyShape,
  overlapChecksum,
  planTableBackfill,
  executeTableBackfill,
  type BackfillEpochRow,
} from './backfill.js';

interface Logged {
  sql: string;
  params: Record<string, unknown>;
}
interface BulkCapture {
  columns: string[];
  rows: unknown[][];
}

const CONE_DEF = julyDefFor('pack1_TP1U2', 'cone');
const SACK_DEF = julyDefFor('sack1_TP1U2', 'sack');

const JULY_COLUMNS_CONE = ['id', 'Date', 'Shift', 'Area', 'ProductionDate', 'HangerNum', 'Source', 'Lifter', 'Weight', 'inRange'];
const SEPTEMBER_COLUMNS_CONE = [...JULY_COLUMNS_CONE.filter((c) => c !== 'Source'), 'MachineNo', 'MaterialId'];
const JULY_COLUMNS_SACK = ['id', 'Date', 'Shift', 'Area', 'SackNum', 'Weight', 'inRange'];

function closedEpoch(overrides: Partial<BackfillEpochRow> = {}): BackfillEpochRow {
  return {
    epoch_id: 1,
    line_id: 1,
    source_table: 'pack1_TP1U2',
    source_server: 'localhost',
    source_db: 'DATA_TP1U2',
    source_created_key: '2026-06-19T11:53:05.787Z',
    schema_fingerprint: ALL_ZERO_FINGERPRINT,
    provenance: 'ifl_copy',
    generation_ordinal: 1,
    label: 'July copy — cones',
    closed_utc: new Date('2026-08-05T19:03:16Z'),
    ...overrides,
  };
}

/** A fake source (archive) pool. Answers by matching the SQL text, not the bound params. */
function fakeSourcePool(opts: {
  columns: string[];
  maxId: number | null;
  checksum?: { n: number; agg: number };
  tailRows?: Record<string, unknown>[];
  log?: Logged[];
}): ConnectionPool {
  const log = opts.log ?? [];
  return {
    request: () => {
      const params: Record<string, unknown> = {};
      const req = {
        input: (name: string, _t: unknown, value: unknown) => {
          params[name] = value;
          return req;
        },
        query: async (sql: string) => {
          log.push({ sql, params: { ...params } });
          if (/FROM sys\.columns c WHERE c\.object_id/.test(sql)) {
            return { recordset: opts.columns.map((name) => ({ name })) };
          }
          if (/FROM INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
            return {
              recordset: opts.columns.map((name) => ({
                COLUMN_NAME: name,
                DATA_TYPE: 'int',
                NUMERIC_PRECISION: null,
                NUMERIC_SCALE: null,
                CHARACTER_MAXIMUM_LENGTH: null,
              })),
            };
          }
          if (/CHECKSUM_AGG\(CHECKSUM\(/.test(sql)) {
            const r = opts.checksum ?? { n: 0, agg: 0 };
            return { recordset: [{ n: r.n, agg: r.agg }] };
          }
          if (/SELECT MAX\(\[id\]\) AS hi FROM/.test(sql)) {
            return { recordset: [{ hi: opts.maxId }] };
          }
          if (/ORDER BY \[id\]/.test(sql)) {
            return { recordset: opts.tailRows ?? [] };
          }
          throw new Error(`fakeSourcePool: unhandled query: ${sql}`);
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

/** A fake app pool covering the existing-max probe, the raw-side checksum, persistRaw's dedupe probe, and bulk. */
function fakeAppPool(opts: {
  existingMaxSrcId: number | null;
  checksum?: { n: number; agg: number };
  dedupeOccupied?: number[];
  log?: Logged[];
  bulkLog?: BulkCapture[];
}): ConnectionPool {
  const log = opts.log ?? [];
  const bulkLog = opts.bulkLog ?? [];
  return {
    request: () => {
      const params: Record<string, unknown> = {};
      const req = {
        input: (name: string, _t: unknown, value: unknown) => {
          params[name] = value;
          return req;
        },
        query: async (sql: string) => {
          log.push({ sql, params: { ...params } });
          if (/CHECKSUM_AGG\(CHECKSUM\(/.test(sql)) {
            const r = opts.checksum ?? { n: 0, agg: 0 };
            return { recordset: [{ n: r.n, agg: r.agg }] };
          }
          if (/SELECT MAX\(src_id\) AS hi FROM/.test(sql)) {
            return { recordset: [{ hi: opts.existingMaxSrcId }] };
          }
          if (/BETWEEN @lo AND @hi/.test(sql)) {
            return { recordset: (opts.dedupeOccupied ?? []).map((src_id) => ({ src_id })) };
          }
          throw new Error(`fakeAppPool: unhandled query: ${sql}`);
        },
        bulk: async (table: { columns: { name: string }[]; rows: unknown[][] }) => {
          bulkLog.push({ columns: table.columns.map((c) => c.name), rows: table.rows });
          return { rowsAffected: [table.rows.length] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

describe('assertBackfillableEpoch — refuses an open or unknown epoch', () => {
  it('refuses an unknown epoch', () => {
    expect(() => assertBackfillableEpoch(null, 42)).toThrow(/No such epoch: 42/);
  });

  it('refuses an OPEN epoch', () => {
    const open = closedEpoch({ closed_utc: null });
    expect(() => assertBackfillableEpoch(open, 1)).toThrow(/is OPEN/);
  });

  it('refuses when --table does not match the epoch\'s own source table', () => {
    const epoch = closedEpoch({ source_table: 'sack1_TP1U2' });
    expect(() => assertBackfillableEpoch(epoch, 1, 'pack1_TP1U2')).toThrow(/must name the same physical source table/);
  });

  it('accepts a closed epoch whose table matches', () => {
    const epoch = closedEpoch();
    expect(() => assertBackfillableEpoch(epoch, 1, 'pack1_TP1U2')).not.toThrow();
  });
});

describe('assertJulyShape — refuses the September shape', () => {
  it('refuses when MaterialId is present (the September rebuild)', async () => {
    const pool = fakeSourcePool({ columns: SEPTEMBER_COLUMNS_CONE, maxId: null });
    await expect(assertJulyShape(pool, 'pack1_TP1U2', 'cone')).rejects.toThrow(/SEPTEMBER shape/);
  });

  it('refuses when neither Source nor MaterialId is present', async () => {
    const pool = fakeSourcePool({ columns: ['id', 'Date'], maxId: null });
    await expect(assertJulyShape(pool, 'pack1_TP1U2', 'cone')).rejects.toThrow(/neither shape/);
  });

  it('accepts the July cone shape (Source present, no MaterialId)', async () => {
    const pool = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: null });
    await expect(assertJulyShape(pool, 'pack1_TP1U2', 'cone')).resolves.toBeUndefined();
  });

  it('accepts the July sack shape even with no Source column (sack1_TP1U2 never carried one)', async () => {
    const pool = fakeSourcePool({ columns: JULY_COLUMNS_SACK, maxId: null });
    await expect(assertJulyShape(pool, 'sack1_TP1U2', 'sack')).resolves.toBeUndefined();
  });
});

describe('overlapChecksum', () => {
  it('is a trivial match with nothing to overlap', async () => {
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 100 });
    const app = fakeAppPool({ existingMaxSrcId: null });
    const r = await overlapChecksum(src, app, CONE_DEF, 1, 1, 0);
    expect(r).toEqual({ checkedIds: 0, sourceChecksum: 0, rawChecksum: 0, match: true, mode: 'full' });
  });

  it('matches when both sides agree', async () => {
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100, checksum: { n: 50, agg: 777 } });
    const app = fakeAppPool({ existingMaxSrcId: 1050, checksum: { n: 50, agg: 777 } });
    const r = await overlapChecksum(src, app, CONE_DEF, 1, 1, 1050);
    expect(r.match).toBe(true);
    expect(r.checkedIds).toBe(50);
  });

  it('refuses (reports mismatch) when the aggregate checksums disagree', async () => {
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100, checksum: { n: 50, agg: 777 } });
    const app = fakeAppPool({ existingMaxSrcId: 1050, checksum: { n: 50, agg: 999 } });
    const r = await overlapChecksum(src, app, CONE_DEF, 1, 1, 1050);
    expect(r.match).toBe(false);
  });

  it('refuses (reports mismatch) when the row counts disagree', async () => {
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100, checksum: { n: 50, agg: 777 } });
    const app = fakeAppPool({ existingMaxSrcId: 1050, checksum: { n: 48, agg: 777 } });
    const r = await overlapChecksum(src, app, CONE_DEF, 1, 1, 1050);
    expect(r.match).toBe(false);
  });
});

describe('planTableBackfill', () => {
  it('refuses an open epoch before reading anything from the source', async () => {
    const epoch = closedEpoch({ closed_utc: null });
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100 });
    const app = fakeAppPool({ existingMaxSrcId: 1050 });
    await expect(planTableBackfill(app, src, CONE_DEF, 1, epoch)).rejects.toThrow(/is OPEN/);
  });

  it('refuses the September shape before checking overlap or fingerprint', async () => {
    const epoch = closedEpoch();
    const src = fakeSourcePool({ columns: SEPTEMBER_COLUMNS_CONE, maxId: 1100 });
    const app = fakeAppPool({ existingMaxSrcId: 1050 });
    await expect(planTableBackfill(app, src, CONE_DEF, 1, epoch)).rejects.toThrow(/SEPTEMBER shape/);
  });

  it('refuses on an overlap checksum mismatch — 0 writes', async () => {
    const epoch = closedEpoch();
    const srcLog: Logged[] = [];
    const src = fakeSourcePool({
      columns: JULY_COLUMNS_CONE,
      maxId: 1100,
      checksum: { n: 50, agg: 111 },
      log: srcLog,
    });
    const app = fakeAppPool({ existingMaxSrcId: 1050, checksum: { n: 50, agg: 222 } });
    await expect(planTableBackfill(app, src, CONE_DEF, 1, epoch)).rejects.toThrow(/Overlap mismatch/);
    // Nothing past the checksum queries was ever issued — no readSince, no bulk.
    expect(srcLog.some((l) => /ORDER BY \[id\]/.test(l.sql))).toBe(false);
  });

  it('happy path: plans exactly the tail range above what sms_raw already holds', async () => {
    const epoch = closedEpoch();
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100, checksum: { n: 1050, agg: 777 } });
    const app = fakeAppPool({ existingMaxSrcId: 1050, checksum: { n: 1050, agg: 777 } });
    const plan = await planTableBackfill(app, src, CONE_DEF, 1, epoch);
    expect(plan.sourceMaxId).toBe(1100);
    expect(plan.existingMaxId).toBe(1050);
    expect(plan.tailFrom).toBe(1051);
    expect(plan.tailTo).toBe(1100);
    expect(plan.tailCount).toBe(50);
    expect(plan.overlap.match).toBe(true);
  });

  it('a second run (archive already fully absorbed) plans a zero-length tail', async () => {
    const epoch = closedEpoch();
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100, checksum: { n: 1100, agg: 5 } });
    const app = fakeAppPool({ existingMaxSrcId: 1100, checksum: { n: 1100, agg: 5 } });
    const plan = await planTableBackfill(app, src, CONE_DEF, 1, epoch);
    expect(plan.tailCount).toBe(0);
  });

  it('honours the all-zeros fingerprint placeholder: overlap equality is the only gate', async () => {
    // schema_fingerprint left as ALL_ZERO_FINGERPRINT by closedEpoch() — the
    // source's REAL computed fingerprint will certainly differ from it, and
    // that must not refuse the plan.
    const epoch = closedEpoch();
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 10, checksum: { n: 0, agg: 0 } });
    const app = fakeAppPool({ existingMaxSrcId: 0, checksum: { n: 0, agg: 0 } });
    await expect(planTableBackfill(app, src, CONE_DEF, 1, epoch)).resolves.toBeDefined();
  });

  it('refuses a genuine fingerprint mismatch when the epoch does NOT hold the placeholder', async () => {
    const epoch = closedEpoch({ schema_fingerprint: 'deliberately-wrong-not-a-real-fingerprint' });
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 10, checksum: { n: 0, agg: 0 } });
    const app = fakeAppPool({ existingMaxSrcId: 0, checksum: { n: 0, agg: 0 } });
    await expect(planTableBackfill(app, src, CONE_DEF, 1, epoch)).rejects.toThrow(/Fingerprint mismatch/);
  });
});

describe('executeTableBackfill', () => {
  it('inserts only the tail ids, tagged with the plan\'s own epoch — never source_epoch of another generation', async () => {
    const epoch = closedEpoch({ epoch_id: 7 });
    const tailRows = [
      { id: 1051, Date: null, Shift: null, Area: null, ProductionDate: null, HangerNum: 1, Source: 3, Lifter: 1, Weight: 1900, inRange: true },
      { id: 1052, Date: null, Shift: null, Area: null, ProductionDate: null, HangerNum: 1, Source: 3, Lifter: 1, Weight: 1905, inRange: true },
    ];
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1052, tailRows });
    const bulkLog: BulkCapture[] = [];
    const appLog: Logged[] = [];
    const app = fakeAppPool({ existingMaxSrcId: 1050, dedupeOccupied: [], bulkLog, log: appLog });

    const plan = await planTableBackfill(
      fakeAppPool({ existingMaxSrcId: 1050, checksum: { n: 0, agg: 0 } }),
      fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1052, checksum: { n: 0, agg: 0 } }),
      CONE_DEF,
      1,
      epoch,
    );
    expect(plan.tailCount).toBe(2);

    const outcome = await executeTableBackfill(app, src, 1, 'run-id-1', plan);

    expect(outcome).toEqual({ sourceTable: 'pack1_TP1U2', epochId: 7, inserted: 2 });
    expect(bulkLog).toHaveLength(1);
    const epochIdx = bulkLog[0]!.columns.indexOf('source_epoch');
    expect(epochIdx).toBeGreaterThanOrEqual(0);
    expect(bulkLog[0]!.rows.every((r) => r[epochIdx] === 7)).toBe(true);
    const srcIdIdx = bulkLog[0]!.columns.indexOf('src_id');
    expect(bulkLog[0]!.rows.map((r) => r[srcIdIdx]).sort()).toEqual([1051, 1052]);

    // No watermark or closed_utc write of any kind — this path only ever
    // SELECTs (the dedupe probe) and bulk-inserts.
    expect(appLog.every((l) => !/UPDATE|closed_utc|watermark/i.test(l.sql))).toBe(true);
  });

  it('a second run over an already-absorbed tail inserts 0 rows and issues no source reads at all', async () => {
    const epoch = closedEpoch();
    const srcLog: Logged[] = [];
    const bulkLog: BulkCapture[] = [];
    const app = fakeAppPool({ existingMaxSrcId: 1100, bulkLog });
    const src = fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100, log: srcLog });

    const plan = await planTableBackfill(
      fakeAppPool({ existingMaxSrcId: 1100, checksum: { n: 5, agg: 1 } }),
      fakeSourcePool({ columns: JULY_COLUMNS_CONE, maxId: 1100, checksum: { n: 5, agg: 1 } }),
      CONE_DEF,
      1,
      epoch,
    );
    expect(plan.tailCount).toBe(0);

    const outcome = await executeTableBackfill(app, src, 1, 'run-id-2', plan);

    expect(outcome.inserted).toBe(0);
    expect(bulkLog).toHaveLength(0);
    expect(srcLog).toHaveLength(0); // readSince was never called — nothing to read
  });
});
