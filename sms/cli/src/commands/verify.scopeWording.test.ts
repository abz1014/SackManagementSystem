/**
 * C-027 (D-70): a verify scoped by --epoch / --source-db only checks a subset,
 * but its closing line claimed "every open generation reconciles". The line
 * and the recorded sms.verify_run summary must name the scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const TABLES = [
  { key: 'cone', sourceTable: 'pack1_TP1U2', rawTable: 'sms_raw.cone_raw', systemCode: 'ifl_sql', columns: [{ src: 'id', raw: 'src_id', type: 'int' }, { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' }] },
];
vi.mock('@sms/sync-worker', async () => {
  const real = await vi.importActual<typeof import('@sms/sync-worker')>('@sms/sync-worker');
  return {
    loadSourceTables: async () => TABLES,
    readSourceIdentity: async () => IDENTITY,
    assertSourceTableName: real.assertSourceTableName,
    TABLE_SHAPES: real.TABLE_SHAPES,
    createPool: async () => world.ifl,
  };
});
vi.mock('../context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context.js')>();
  return {
    ...actual,
    openContext: async () => ({
      cfg: { lineId: 1, app: { server: 'localhost', database: 'sms' }, iflData: { server: 'localhost', database: 'DATA_TP1U2_SEP07' } },
      app: world.app,
      ifl: world.ifl,
      close: async () => {},
    }),
  };
});

const OPEN = {
  epoch_id: 9, source_table: 'pack1_TP1U2', source_server: 'localhost', source_db: 'DATA_TP1U2_SEP07',
  source_created_key: 'k9', schema_fingerprint: 'fp9', provenance: 'ifl_copy', label: 'September copy',
  closed_utc: null as Date | null, archived_below_id: null as number | null, archived_observed_utc: null as Date | null,
};
const CLOSED = { ...OPEN, epoch_id: 1, source_db: 'DATA_TP1U2', source_created_key: 'k1', schema_fingerprint: 'fp1', label: 'July copy', closed_utc: new Date('2026-09-11T09:00:00Z') };
const IDENTITY = { createdKey: 'k9', fingerprint: 'fp9', server: 'localhost', database: 'DATA_TP1U2_SEP07' };
const S3 = { n: 3, lo: 1, hi: 3, s: '6' };

interface Pool { request(): unknown; verifyRunInputs: Map<string, unknown> | null; close(): Promise<void> }
function fakePool(routes: [RegExp, unknown[]][]): Pool {
  const pool: Pool = { verifyRunInputs: null, close: async () => {}, request: () => req };
  const inputs = new Map<string, unknown>();
  const req = {
    input: (k: string, _t: unknown, v: unknown) => { inputs.set(k, v); return req; },
    query: async (sql: string) => {
      if (/INSERT INTO sms\.verify_run/.test(sql)) { pool.verifyRunInputs = new Map(inputs); return { recordset: [] }; }
      const hit = routes.find(([re]) => re.test(sql));
      if (!hit) throw new Error(`fake pool has no answer for:\n${sql}`);
      return { recordset: hit[1] };
    },
  };
  return pool;
}
const appPool = (epochs: (typeof OPEN)[]) =>
  fakePool([
    [/FROM sms\.source_epoch/, epochs],
    [/GROUP BY source_epoch/, epochs.map((x) => ({ e: x.epoch_id, ...S3 }))],
    [/AND \[src_ProductionDate\] >= @from/, [S3]],
    [/SELECT COUNT\(\*\) n FROM sms_raw\.cone_raw r/, [{ n: 0 }]],
    [/SELECT COUNT\(\*\) n FROM sms\.cone_event c/, [{ n: 0 }]],
    [/merge_key_is_unique/, [{ n: 0 }]],
    [/FROM sms\.dq_finding/, []],
  ]);
const world = { app: undefined as unknown as Pool, ifl: undefined as unknown as Pool };
const { verify } = await import('./verify.js');

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
  world.ifl = fakePool([[/FROM \[pack1_TP1U2\]/, [S3]]]);
});
afterEach(() => vi.restoreAllMocks());
const printed = () => out.join('\n');

describe('sms verify — scoped runs say they are scoped (C-027)', () => {
  it('--epoch=9: the closing line names the epoch checked and does not claim every generation', async () => {
    world.app = appPool([CLOSED, OPEN]);
    expect(await verify(['--epoch=9'])).toBe(0);
    const text = printed();
    expect(text).not.toMatch(/every open generation reconciles/);
    expect(text).toMatch(/✓ every generation checked in this run \(epoch 9\) reconciles/);
    expect(String(world.app.verifyRunInputs?.get('summary'))).toMatch(/scope: epoch 9/);
  });

  it('unscoped run keeps the original wording and records no scope', async () => {
    world.app = appPool([OPEN]);
    expect(await verify([])).toBe(0);
    expect(printed()).toMatch(/✓ every open generation reconciles with its source/);
    expect(String(world.app.verifyRunInputs?.get('summary'))).not.toMatch(/scope:/);
  });
});
