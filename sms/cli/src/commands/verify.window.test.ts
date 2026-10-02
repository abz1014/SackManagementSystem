/**
 * C-028 (D-71): --from/--to windows are calendar days (plant clock 00:00-24:00),
 * not 06:00 production days; the printed label and the verify_run summary said
 * "production day". Window itself is unchanged.
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

describe('sms verify — window label (C-028)', () => {
  it('prints the window as calendar day(s), not production day, and records that in the summary', async () => {
    world.app = appPool([OPEN]);
    expect(await verify(['--from=2026-07-03', '--to=2026-07-03'])).toBe(0);
    const text = printed();
    expect(text).toMatch(/window\s+2026-07-03 \.\. 2026-07-03 \(calendar day, plant clock 00:00-24:00\)/);
    expect(text).not.toMatch(/production day/);
    expect(String(world.app.verifyRunInputs?.get('summary'))).toMatch(/calendar day \(plant clock 00:00-24:00\)/);
  });

  it('the --from error also says calendar day', async () => {
    world.app = appPool([OPEN]);
    await expect(verify(['--from=nope', '--to=2026-07-03'])).rejects.toThrow(/calendar day/);
  });
});
