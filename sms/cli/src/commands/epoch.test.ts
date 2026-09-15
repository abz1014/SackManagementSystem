/**
 * `sms epoch:accept` (T4, 15 Sep 2026): the close-then-insert used to run
 * outside any transaction, so a close that committed followed by an insert
 * that violated UX_source_epoch_identity left the table with NO open
 * generation — wedged, recoverable only by hand SQL or epoch:purge. Fixed two
 * ways: the close+insert for one table is now one transaction (roll back on
 * failure, never a committed close with no insert), and the documented
 * same-identity drift case (fingerprint or column-list change with server/db/
 * created_key unchanged) updates the open row in place instead of
 * closing+inserting — inserting on an unchanged identity is exactly what
 * collides with the unique index.
 *
 * Harness follows cutover.test.ts: vi.mock('@sms/sync-worker') replaces every
 * function epoch.ts imports from it with test doubles, and a fake pool
 * records statements (plus, here, per-transaction begin/commit/rollback) so
 * assertions read the SQL rather than a real database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt {
  sql: string;
  inputs: Map<string, unknown>;
}
interface TxRecord {
  begun: boolean;
  committed: boolean;
  rolledBack: boolean;
  statements: Stmt[];
}

function fakePool() {
  const statements: Stmt[] = [];
  const transactions: TxRecord[] = [];

  // `sink` is where this request's statements are recorded: the pool-level
  // `statements` array for ctx.app.request(), or one transaction's own list
  // for tx.request() — kept separate so a test can tell "ran inside the
  // transaction" from "ran directly on the pool".
  function makeRequest(sink: Stmt[]) {
    const inputs = new Map<string, unknown>();
    const req = {
      input(name: string, _t: unknown, value: unknown) {
        inputs.set(name, value);
        return req;
      },
      async query(sql: string) {
        const stmt: Stmt = { sql, inputs: new Map(inputs) };
        sink.push(stmt);

        if (/SELECT column_list FROM sms\.source_epoch/.test(sql)) {
          return { recordset: [{ column_list: world.storedColumnList }], rowsAffected: [1] };
        }
        if (/SELECT ISNULL\(MAX\(generation_ordinal\)/.test(sql)) {
          return { recordset: [{ n: world.nextOrdinal }], rowsAffected: [1] };
        }
        if (/^INSERT INTO sms\.source_epoch/.test(sql.trim())) {
          if (world.insertThrows) {
            throw Object.assign(new Error('Violation of UNIQUE KEY constraint \'UX_source_epoch_identity\''), {
              code: 'EREQUEST',
            });
          }
          return { recordset: [{ id: world.nextEpochId }], rowsAffected: [1] };
        }
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return req;
  }

  const pool = {
    statements,
    transactions,
    request: () => makeRequest(statements),
    transaction() {
      const record: TxRecord = { begun: false, committed: false, rolledBack: false, statements: [] };
      transactions.push(record);
      return {
        async begin() {
          record.begun = true;
        },
        request: () => makeRequest(record.statements),
        async commit() {
          record.committed = true;
        },
        async rollback() {
          record.rolledBack = true;
        },
      };
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[]; transactions: TxRecord[] };
}

const world = {
  app: undefined as unknown as ReturnType<typeof fakePool>,
  opened: 0,
  // What readSourceIdentity / openEpoch report — set per test.
  openEpochRow: null as null | {
    epoch_id: number;
    source_server: string;
    source_db: string;
    source_created_key: string;
    schema_fingerprint: string;
    label: string;
  },
  identity: {
    server: 'SRV',
    database: 'DATA_TP1U2',
    createdKey: '2026-08-05T18:54:50.000',
    fingerprint: 'fp-new',
    columnList: ['id', 'ProductionDate', 'MaterialId'],
  },
  storedColumnList: null as string | null,
  nextOrdinal: 1,
  nextEpochId: 99,
  insertThrows: false,
};

vi.mock('@sms/sync-worker', () => ({
  loadSourceTables: async () => [{ sourceTable: 'pack1_TP1U2' }],
  readSourceIdentity: async () => world.identity,
  openEpoch: async () => world.openEpochRow,
  withTransformLock: async (_c: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../context.js', async () => {
  const real = await vi.importActual<typeof import('../context.js')>('../context.js');
  return {
    parseArgs: real.parseArgs,
    cliLog: { error: () => {}, warn: () => {}, info: () => {}, child: () => ({}) },
    openContext: async () => {
      world.opened += 1;
      return {
        cfg: { lineId: 1, iflData: { server: 'SRV', database: 'DATA_TP1U2' } },
        app: world.app,
        ifl: world.app,
        close: async () => {},
      };
    },
  };
});

const { epochAccept } = await import('./epoch.js');

beforeEach(() => {
  world.app = fakePool();
  world.opened = 0;
  world.openEpochRow = null;
  world.storedColumnList = null;
  world.nextOrdinal = 1;
  world.nextEpochId = 99;
  world.insertThrows = false;
  world.identity = {
    server: 'SRV',
    database: 'DATA_TP1U2',
    createdKey: '2026-08-05T18:54:50.000',
    fingerprint: 'fp-new',
    columnList: ['id', 'ProductionDate', 'MaterialId'],
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const CONFIRM = ['--table=pack1_TP1U2', '--confirm'];

describe('sms epoch:accept — same identity, in-generation drift', () => {
  it('same identity, differing fingerprint: updates in place — one UPDATE, no INSERT, no closed_utc write', async () => {
    world.openEpochRow = {
      epoch_id: 7,
      source_server: 'SRV',
      source_db: 'DATA_TP1U2',
      source_created_key: '2026-08-05T18:54:50.000',
      schema_fingerprint: 'fp-old',
      label: 'September copy',
    };
    world.storedColumnList = JSON.stringify(world.identity.columnList); // columns unchanged, only fp differs

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(0);
    const sqls = world.app.statements.map((s) => s.sql);
    const updates = world.app.statements.filter((s) => /UPDATE sms\.source_epoch\s+SET schema_fingerprint/.test(s.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.inputs.get('fp')).toBe('fp-new');
    expect(sqls.some((q) => /INSERT INTO sms\.source_epoch/.test(q))).toBe(false);
    expect(sqls.some((q) => /SET closed_utc/.test(q))).toBe(false);
    expect(world.app.transactions).toHaveLength(0);
  });
});

describe('sms epoch:accept — a genuine new generation', () => {
  it('different identity: closes the old epoch and inserts the new one inside a begun-and-committed transaction', async () => {
    world.openEpochRow = {
      epoch_id: 3,
      source_server: 'SRV',
      source_db: 'DATA_TP1U2',
      source_created_key: '2026-07-01T00:00:00.000', // different createdKey -> different identity
      schema_fingerprint: 'fp-old',
      label: 'July copy',
    };

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(0);
    expect(world.app.transactions).toHaveLength(1);
    const tx = world.app.transactions[0]!;
    expect(tx.begun).toBe(true);
    expect(tx.committed).toBe(true);
    expect(tx.rolledBack).toBe(false);
    const txSqls = tx.statements.map((s) => s.sql);
    expect(txSqls.some((q) => /UPDATE sms\.source_epoch SET closed_utc/.test(q))).toBe(true);
    expect(txSqls.some((q) => /INSERT INTO sms\.source_epoch/.test(q))).toBe(true);
    // Outside the transaction, neither write happened directly on the pool.
    expect(world.app.statements.some((s) => /^UPDATE sms\.source_epoch SET closed_utc/.test(s.sql.trim()))).toBe(false);
    expect(world.app.statements.some((s) => /^INSERT INTO sms\.source_epoch/.test(s.sql.trim()))).toBe(false);
  });

  it('insert failure inside the transaction: rolls back, exits 1, and never commits the closed_utc write', async () => {
    world.openEpochRow = {
      epoch_id: 3,
      source_server: 'SRV',
      source_db: 'DATA_TP1U2',
      source_created_key: '2026-07-01T00:00:00.000',
      schema_fingerprint: 'fp-old',
      label: 'July copy',
    };
    world.insertThrows = true;

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(1);
    expect(world.app.transactions).toHaveLength(1);
    const tx = world.app.transactions[0]!;
    expect(tx.begun).toBe(true);
    expect(tx.rolledBack).toBe(true);
    expect(tx.committed).toBe(false);
    // The close ran inside the failed transaction — it must not have taken
    // effect anywhere the command can see outside that rolled-back tx.
    expect(tx.statements.some((s) => /UPDATE sms\.source_epoch SET closed_utc/.test(s.sql))).toBe(true);
  });
});

describe('sms epoch:accept — idempotence and the --confirm gate', () => {
  it('identity, fingerprint and columns all unchanged: nothing to accept, exit 0, zero writes', async () => {
    world.openEpochRow = {
      epoch_id: 7,
      source_server: 'SRV',
      source_db: 'DATA_TP1U2',
      source_created_key: '2026-08-05T18:54:50.000',
      schema_fingerprint: 'fp-new', // matches world.identity.fingerprint
      label: 'September copy',
    };
    world.storedColumnList = JSON.stringify(world.identity.columnList); // matches too

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(0);
    expect(world.app.transactions).toHaveLength(0);
    const sqls = world.app.statements.map((s) => s.sql);
    expect(sqls.some((q) => /^UPDATE sms\.source_epoch/.test(q.trim()))).toBe(false);
    expect(sqls.some((q) => /^INSERT INTO sms\.source_epoch/.test(q.trim()))).toBe(false);
  });

  it('--confirm absent: refuses and exits 2 with zero writes', async () => {
    world.openEpochRow = {
      epoch_id: 3,
      source_server: 'SRV',
      source_db: 'DATA_TP1U2',
      source_created_key: '2026-07-01T00:00:00.000',
      schema_fingerprint: 'fp-old',
      label: 'July copy',
    };

    const code = await epochAccept(['--table=pack1_TP1U2']);

    expect(code).toBe(2);
    expect(world.app.transactions).toHaveLength(0);
    const sqls = world.app.statements.map((s) => s.sql);
    expect(sqls.some((q) => /^UPDATE sms\.source_epoch/.test(q.trim()))).toBe(false);
    expect(sqls.some((q) => /^INSERT INTO sms\.source_epoch/.test(q.trim()))).toBe(false);
  });
});
