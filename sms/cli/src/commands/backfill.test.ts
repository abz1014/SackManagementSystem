/**
 * `sms epoch:backfill` CLI orchestration tests (R-17). `@sms/sync-worker` is
 * fully mocked — the actual planning/overlap/insert logic is covered by
 * sync-worker/src/backfill.test.ts against fake pools; this file is only
 * about what the CLI does with those results: which refusals it prints and
 * for which exit code, that nothing is written without --confirm, that the
 * transform lock is held for the whole insert phase, and that exactly one
 * audit_log row is written per run. Follows the same harness style as
 * cli/src/commands/epoch.test.ts (vi.mock('@sms/sync-worker'), a fake pool
 * that records statements).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt {
  sql: string;
  inputs: Map<string, unknown>;
}

function fakeAppPool() {
  const statements: Stmt[] = [];
  const pool = {
    statements,
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          statements.push({ sql, inputs: new Map(inputs) });
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

const order: string[] = [];

const world = {
  app: undefined as unknown as ReturnType<typeof fakeAppPool>,
  sourcePool: { closed: false },
  sourcePoolClosed: false,
  configured: [
    { key: 'cone', sourceTable: 'pack1_TP1U2' },
    { key: 'sack', sourceTable: 'sack1_TP1U2' },
    { key: 'reject_qcs', sourceTable: 'rejectQCS1_TP1U2' },
    { key: 'reject_weight', sourceTable: 'rejectWeight1_TP1U2' },
  ],
  epochsById: new Map<number, unknown>(),
  siblingsOf: [] as unknown[],
  planThrows: null as string | null,
  planTailCount: 5,
  executeInserted: 5,
};

vi.mock('@sms/sync-worker', () => ({
  createPool: async () => {
    world.sourcePoolClosed = false;
    return { close: async () => { world.sourcePoolClosed = true; } };
  },
  loadSourceTables: async () => world.configured,
  withTransformLock: async (_c: unknown, fn: () => Promise<unknown>) => {
    order.push('lock-acquired');
    const r = await fn();
    order.push('lock-released');
    return r;
  },
  getEpochById: async (_pool: unknown, id: number) => world.epochsById.get(id) ?? null,
  siblingEpochs: async () => world.siblingsOf,
  julyDefFor: (sourceTable: string, kind: string) => ({ key: kind, sourceTable, systemCode: 'ifl_sql', rawTable: `sms_raw.${kind}_raw`, columns: [] }),
  planTableBackfill: async (_app: unknown, _src: unknown, def: { sourceTable: string }, _lineId: number, epoch: { epoch_id: number }) => {
    if (world.planThrows) throw new Error(world.planThrows);
    return {
      def,
      epoch,
      sourceMaxId: 1100,
      existingMaxId: 1100 - world.planTailCount,
      overlap: { checkedIds: 10, sourceChecksum: 1, rawChecksum: 1, match: true, mode: 'full' },
      tailFrom: 1101 - world.planTailCount,
      tailTo: 1100,
      tailCount: world.planTailCount,
    };
  },
  executeTableBackfill: async (_app: unknown, _src: unknown, _lineId: number, _run: string, plan: { def: { sourceTable: string }; epoch: { epoch_id: number } }) => {
    order.push('insert:' + plan.def.sourceTable);
    return { sourceTable: plan.def.sourceTable, epochId: plan.epoch.epoch_id, inserted: world.executeInserted };
  },
  shortRawTable: (def: { rawTable: string }) => def.rawTable.replace('sms_raw.', ''),
}));

vi.mock('../context.js', async () => {
  const real = await vi.importActual<typeof import('../context.js')>('../context.js');
  return {
    parseArgs: real.parseArgs,
    cliLog: { error: () => {}, warn: () => {}, info: () => {}, child: () => ({}) },
    openContext: async () => ({
      cfg: { lineId: 1, app: { server: 'APPSRV', database: 'sms' }, iflData: { server: 'SRV', database: 'DATA_TP1U2', port: 1433, user: 'u', password: 'p', encrypt: true, trustServerCertificate: true } },
      app: world.app,
      ifl: world.app,
      close: async () => {},
    }),
  };
});

const { epochBackfill } = await import('./backfill.js');

function epoch(overrides: Record<string, unknown> = {}) {
  return {
    epoch_id: 1,
    line_id: 1,
    source_table: 'pack1_TP1U2',
    source_server: 'SRV',
    source_db: 'DATA_TP1U2',
    source_created_key: '2026-06-19T11:53:05.787Z',
    schema_fingerprint: '00000000000000000000000000000000',
    provenance: 'ifl_copy',
    generation_ordinal: 1,
    label: 'July copy — cones',
    closed_utc: new Date('2026-08-05T19:03:16Z'),
    ...overrides,
  };
}

beforeEach(() => {
  world.app = fakeAppPool();
  world.epochsById = new Map([[1, epoch()]]);
  world.siblingsOf = [];
  world.planThrows = null;
  world.planTailCount = 5;
  world.executeInserted = 5;
  order.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const BASE = ['--table=pack1_TP1U2', '--epoch=1', '--source-db=DATA_TP1U2_SEP07'];

describe('sms epoch:backfill — argument and epoch gates', () => {
  it('refuses with no --table and no --all', async () => {
    const code = await epochBackfill(['--epoch=1', '--source-db=x']);
    expect(code).toBe(2);
  });

  it('refuses with no --epoch, naming that a new historic generation is deferred', async () => {
    const code = await epochBackfill(['--table=pack1_TP1U2', '--source-db=x']);
    expect(code).toBe(2);
    const printed = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
    expect(printed).toMatch(/deferred/);
  });

  it('refuses with no --source-db', async () => {
    const code = await epochBackfill(['--table=pack1_TP1U2', '--epoch=1']);
    expect(code).toBe(2);
  });

  it('refuses an unknown epoch id', async () => {
    world.epochsById = new Map();
    const code = await epochBackfill(BASE);
    expect(code).toBe(2);
    expect(order).toHaveLength(0); // no lock, no insert
  });

  it('refuses when --table does not match the named epoch\'s own source table', async () => {
    world.epochsById = new Map([[1, epoch({ source_table: 'sack1_TP1U2' })]]);
    const code = await epochBackfill(BASE);
    expect(code).toBe(2);
    expect(order).toHaveLength(0);
  });

  it('propagates a plan refusal (e.g. September shape / overlap mismatch) as exit 2 with 0 writes', async () => {
    world.planThrows = 'Overlap mismatch on pack1_TP1U2: refusing';
    const code = await epochBackfill(BASE);
    expect(code).toBe(2);
    expect(order).toHaveLength(0);
    expect(world.app.statements.some((s) => /INSERT INTO sms\.audit_log/.test(s.sql))).toBe(false);
  });
});

describe('sms epoch:backfill — dry run vs --confirm', () => {
  it('a dry run (no --confirm) plans but writes nothing', async () => {
    const code = await epochBackfill(BASE);
    expect(code).toBe(2);
    expect(order).toHaveLength(0); // withTransformLock/executeTableBackfill never called
    expect(world.app.statements.some((s) => /INSERT INTO sms\.audit_log/.test(s.sql))).toBe(false);
  });

  it('nothing-to-backfill (tail count 0) exits 0 without requiring --confirm', async () => {
    world.planTailCount = 0;
    const code = await epochBackfill(BASE);
    expect(code).toBe(0);
    expect(order).toHaveLength(0);
  });

  it('--confirm holds the transform lock for the whole insert and writes exactly one audit_log row', async () => {
    const code = await epochBackfill([...BASE, '--confirm']);
    expect(code).toBe(0);
    expect(order).toEqual(['lock-acquired', 'insert:pack1_TP1U2', 'lock-released']);
    const auditRows = world.app.statements.filter((s) => /INSERT INTO sms\.audit_log/.test(s.sql));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.inputs.get('action')).toBe('epoch.backfill');
  });

  it('--all backfills every sibling epoch under one lock and one audit_log row', async () => {
    world.epochsById = new Map([[1, epoch()]]);
    world.siblingsOf = [
      epoch({ epoch_id: 1, source_table: 'pack1_TP1U2' }),
      epoch({ epoch_id: 2, source_table: 'sack1_TP1U2' }),
      epoch({ epoch_id: 3, source_table: 'rejectQCS1_TP1U2' }),
      epoch({ epoch_id: 4, source_table: 'rejectWeight1_TP1U2' }),
    ];
    const code = await epochBackfill(['--all', '--epoch=1', '--source-db=DATA_TP1U2_SEP07', '--confirm']);
    expect(code).toBe(0);
    expect(order[0]).toBe('lock-acquired');
    expect(order[order.length - 1]).toBe('lock-released');
    expect(order.filter((o) => o.startsWith('insert:'))).toHaveLength(4);
    const auditRows = world.app.statements.filter((s) => /INSERT INTO sms\.audit_log/.test(s.sql));
    expect(auditRows).toHaveLength(1);
  });
});
