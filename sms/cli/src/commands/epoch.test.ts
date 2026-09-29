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
        // R-17 data-vintage guard (checkDataVintage, epoch.ts). Defaults to
        // "nothing to compare" (null/empty) so every test that does not care
        // about vintage passes the guard trivially — see world.vintage.* for
        // the knobs the R-17 tests below turn.
        if (/SELECT MAX\(\[.*\]\) hiProd, MAX\(\[id\]\) hiId FROM \[/.test(sql)) {
          return {
            recordset: [{ hiProd: world.vintage.sourceMaxProd, hiId: world.vintage.sourceMaxId }],
            rowsAffected: [1],
          };
        }
        if (/SELECT MIN\(.*\) lo FROM sms_raw\./.test(sql)) {
          return { recordset: [{ lo: world.vintage.openMinProd }], rowsAffected: [1] };
        }
        if (/SELECT epoch_id FROM sms\.source_epoch\s+WHERE line_id = @line AND source_table = @tbl AND closed_utc IS NOT NULL/.test(sql)) {
          return { recordset: world.vintage.closedEpochs.map((e) => ({ epoch_id: e })), rowsAffected: [1] };
        }
        if (/^INSERT INTO sms\.audit_log/.test(sql.trim())) {
          return { recordset: [], rowsAffected: [1] };
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
  // R-17 data-vintage guard (checkDataVintage) knobs. Defaults make the
  // guard a no-op ("nothing to compare") so every pre-existing test keeps
  // passing without knowing this guard exists.
  vintage: {
    sourceMaxProd: null as string | null,
    sourceMaxId: null as number | null,
    openMinProd: null as string | null,
    closedEpochs: [] as number[],
  },
  // overlapChecksum (sync-worker/src/backfill.ts) is mocked as a directly
  // controllable double — its own real SQL-shape behaviour is exercised by
  // backfill.test.ts; here only checkDataVintage's USE of its result matters.
  overlapChecksum: async (_ifl: unknown, _app: unknown, _def: unknown, _line: number, epochId: number) =>
    world.overlapResultFor(epochId),
  overlapResultFor: (_epochId: number) => ({ checkedIds: 0, sourceChecksum: 0, rawChecksum: 0, match: true, mode: 'full' as const }),
};

const FULL_DEF = {
  key: 'cone' as const,
  sourceTable: 'pack1_TP1U2',
  rawTable: 'sms_raw.cone_raw',
  systemCode: 'ifl_sql',
  columns: [
    { src: 'id', raw: 'src_id', type: 'int' },
    { src: 'ProductionDate', raw: 'src_ProductionDate', type: 'datetime' },
    { src: 'MaterialId', raw: 'src_MaterialId', type: 'int' },
  ],
};

vi.mock('@sms/sync-worker', async () => {
  const real = await vi.importActual<typeof import('@sms/sync-worker')>('@sms/sync-worker');
  return {
    loadSourceTables: async () => [FULL_DEF],
    readSourceIdentity: async () => world.identity,
    openEpoch: async () => world.openEpochRow,
    withTransformLock: async (_c: unknown, fn: () => Promise<unknown>) => fn(),
    assertSourceTableName: real.assertSourceTableName,
    julyDefFor: real.julyDefFor,
    overlapChecksum: (...args: Parameters<typeof world.overlapChecksum>) => world.overlapChecksum(...args),
  };
});
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

const { epochAccept, epochDrop } = await import('./epoch.js');

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
  world.vintage = { sourceMaxProd: null, sourceMaxId: null, openMinProd: null, closedEpochs: [] };
  world.overlapResultFor = () => ({ checkedIds: 0, sourceChecksum: 0, rawChecksum: 0, match: true, mode: 'full' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// --provenance is REQUIRED for any plan that registers a new generation
// (23 Sep 2026): it used to default to 'ifl_copy', and that default is how the
// dev sidecar's epochs 13-16 came to claim IFL provenance while sitting on
// DATA_TP1U2_SIM. Carried on the shared arg list so every existing case still
// exercises the path it was written for rather than tripping the new guard.
const CONFIRM = ['--table=pack1_TP1U2', '--confirm', '--provenance=ifl_copy'];

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

    const code = await epochAccept(['--table=pack1_TP1U2', '--provenance=ifl_copy']);

    expect(code).toBe(2);
    expect(world.app.transactions).toHaveLength(0);
    const sqls = world.app.statements.map((s) => s.sql);
    expect(sqls.some((q) => /^UPDATE sms\.source_epoch/.test(q.trim()))).toBe(false);
    expect(sqls.some((q) => /^INSERT INTO sms\.source_epoch/.test(q.trim()))).toBe(false);
  });
});

/**
 * Regression guard for a LIVE, MEASURED defect, not a hypothetical one
 * (23 Sep 2026).
 *
 * `sms.source_epoch` epochs 13-16 on the development sidecar are the plant
 * simulator's four tables — `source_db = 'DATA_TP1U2_SIM'`, registered
 * 2026-09-22 07:17 by `cli:epoch-accept` — and every one of them says
 * `provenance = 'ifl_copy'`. 212,873 synthetic cones, 9,715 synthetic sacks
 * and 4,868 synthetic rejects are therefore indistinguishable from IFL's own
 * data by the single column whose job is to distinguish them, and they overlap
 * IFL's real September generation IN TIME (21 Aug - 22 Sep vs 5 Aug - 7 Sep),
 * so every date-ranged query that does not constrain the generation pools them.
 *
 * Nobody typed a wrong value. `--provenance` defaulted to 'ifl_copy' when
 * omitted, and the auto-generated labels on those rows ("pack1_TP1U2 gen 4")
 * prove no optional flag was passed at all. That makes it a defect of the
 * REGISTRATION PATH, which is what makes it recur: the identical omission at
 * IFL's go-live cutover registers the plant's own LIVE generation as a copy,
 * equally silently.
 *
 * These three cases pin the two halves of the fix. Do not reintroduce a
 * default to make them pass.
 */
describe('sms epoch:accept — a generation must say what it is (epoch 13 regression)', () => {
  const NEW_GENERATION = {
    epoch_id: 3,
    source_server: 'SRV',
    source_db: 'DATA_TP1U2',
    source_created_key: '2026-07-01T00:00:00.000', // differs from world.identity -> register path
    schema_fingerprint: 'fp-old',
    label: 'July copy',
  };
  const writesOf = (p: ReturnType<typeof fakePool>) =>
    [...p.statements, ...p.transactions.flatMap((t) => t.statements)].map((s) => s.sql);

  it('--provenance omitted on a REGISTER: refuses, exits 2, writes nothing — there is no default any more', async () => {
    world.openEpochRow = NEW_GENERATION;

    const code = await epochAccept(['--table=pack1_TP1U2', '--confirm']);

    expect(code).toBe(2);
    expect(world.app.transactions).toHaveLength(0);
    expect(writesOf(world.app).some((q) => /^INSERT INTO sms\.source_epoch/.test(q.trim()))).toBe(false);
    expect(writesOf(world.app).some((q) => /UPDATE sms\.source_epoch SET closed_utc/.test(q))).toBe(false);
  });

  it('a _SIM database declared as ifl_copy — exactly how epoch 13 was written — is refused, not recorded', async () => {
    world.openEpochRow = NEW_GENERATION;
    world.identity = { ...world.identity, database: 'DATA_TP1U2_SIM' };

    const code = await epochAccept(['--table=pack1_TP1U2', '--confirm', '--provenance=ifl_copy']);

    expect(code).toBe(2);
    expect(world.app.transactions).toHaveLength(0);
    expect(writesOf(world.app).some((q) => /^INSERT INTO sms\.source_epoch/.test(q.trim()))).toBe(false);
  });

  it('the same _SIM database declared honestly as simulator registers, and the row carries "simulator"', async () => {
    world.openEpochRow = NEW_GENERATION;
    world.identity = { ...world.identity, database: 'DATA_TP1U2_SIM' };

    const code = await epochAccept(['--table=pack1_TP1U2', '--confirm', '--provenance=simulator']);

    expect(code).toBe(0);
    const tx = world.app.transactions[0]!;
    expect(tx.committed).toBe(true);
    const insert = tx.statements.find((s) => /^INSERT INTO sms\.source_epoch/.test(s.sql.trim()));
    expect(insert).toBeDefined();
    expect(insert!.inputs.get('prov')).toBe('simulator');
    expect(insert!.inputs.get('db')).toBe('DATA_TP1U2_SIM');
  });
});

/**
 * R-10, the instance the first sweep missed. `epochDrop` interpolated its
 * `--epoch=N` straight into five statements as a SQL literal — four COUNTs and
 * the DELETE that removes the epoch row. `Number.isInteger(id) && id > 0` above
 * it meant it was never exploitable, but working rule 3 admits no "unless it is
 * a number" exemption, and a future edit relaxing that filter upstream would
 * have turned a style violation into a real one. These assert the parameterised
 * shape rather than the guard, so removing the guard cannot make them pass.
 */
describe('sms epoch:drop — parameterised, never a literal id', () => {
  it('the row-count probe binds the id and carries no bare number', async () => {
    const code = await epochDrop(['--epoch=13']);
    expect(code).toBe(2); // no --confirm: would-delete only
    const probe = world.app.statements.find((s) => /FROM sms_raw\.cone_raw/.test(s.sql));
    expect(probe).toBeDefined();
    expect(probe!.sql).not.toMatch(/source_epoch = 13/);
    expect(probe!.sql).toMatch(/source_epoch IN \(@e0\)/);
    expect(probe!.inputs.get('e0')).toBe(13);
  });

  it('the DELETE binds the id too, and only runs with --confirm', async () => {
    expect(await epochDrop(['--epoch=13'])).toBe(2);
    expect(world.app.statements.some((s) => /^DELETE FROM sms\.source_epoch/.test(s.sql.trim()))).toBe(false);

    world.app = fakePool();
    expect(await epochDrop(['--epoch=13', '--confirm'])).toBe(0);
    const del = world.app.statements.find((s) => /^DELETE FROM sms\.source_epoch/.test(s.sql.trim()));
    expect(del).toBeDefined();
    expect(del!.sql).not.toMatch(/epoch_id = 13/);
    expect(del!.sql).toMatch(/epoch_id IN \(@e0\)/);
    expect(del!.inputs.get('e0')).toBe(13);
  });

  it('no CLI statement anywhere in epoch:drop interpolates a value into its SQL text', async () => {
    await epochDrop(['--epoch=13', '--confirm']);
    expect(world.app.statements.length).toBeGreaterThan(0);
    for (const s of world.app.statements) {
      expect(s.sql).not.toMatch(/(source_epoch|epoch_id)\s*(=|IN \()\s*\d/);
    }
  });
});

/**
 * R-17 chronology guard (29 Sep 2026, DEFECTS.md R-17). epoch:accept's
 * "different identity" path used to register ANY generation whose identity
 * differs from what is open, with no check on which one is chronologically
 * newer. An archive whose own create_date PREDATES the generation already
 * open (the 10 Jul - 5 Aug gap, arriving after the September rebuild is
 * already registered) must be refused here and pointed at
 * `sms epoch:backfill` instead — never registered as if it were a forward
 * move, which is the only thing generation_ordinal's MAX(...)+1 assignment
 * and every "newest ordinal wins" reader (api/src/services/generation.ts)
 * assume it always is.
 */
describe('sms epoch:accept — chronology guard (R-17)', () => {
  it('refuses a source whose createdKey is OLDER than the open epoch\'s, exit 2, zero writes', async () => {
    world.openEpochRow = {
      epoch_id: 9,
      source_server: 'SRV',
      source_db: 'DATA_TP1U2',
      source_created_key: '2026-08-05T18:54:50.000', // the September rebuild, already open
      schema_fingerprint: 'fp-old',
      label: 'September copy',
    };
    // The archive now being pointed at reports an OLDER create_date — the July generation.
    world.identity = { ...world.identity, createdKey: '2026-06-19T11:53:05.787Z' };

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(2);
    expect(world.app.transactions).toHaveLength(0);
    const sqls = world.app.statements.map((s) => s.sql);
    expect(sqls.some((q) => /^INSERT INTO sms\.source_epoch/.test(q.trim()))).toBe(false);
    expect(sqls.some((q) => /UPDATE sms\.source_epoch SET closed_utc/.test(q))).toBe(false);
    const printed = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
    expect(printed).toMatch(/epoch:backfill/);
  });

  it('a source NEWER than the open epoch still registers normally (the guard is one-directional)', async () => {
    world.openEpochRow = {
      epoch_id: 9,
      source_server: 'SRV',
      source_db: 'DATA_TP1U2',
      source_created_key: '2026-06-19T11:53:05.787Z', // an older generation still open
      schema_fingerprint: 'fp-old',
      label: 'July copy',
    };
    world.identity = { ...world.identity, createdKey: '2026-08-05T18:54:50.000' }; // newer — the rebuild

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(0);
    expect(world.app.transactions).toHaveLength(1);
    expect(world.app.transactions[0]!.committed).toBe(true);
  });

  it('with no open epoch at all, chronology cannot be violated — registers as a first registration', async () => {
    world.openEpochRow = null;
    world.identity = { ...world.identity, createdKey: '2020-01-01T00:00:00.000' }; // arbitrarily "old"

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(0);
    expect(world.app.transactions).toHaveLength(1);
    expect(world.app.transactions[0]!.committed).toBe(true);
  });
});

/**
 * R-17 DATA-VINTAGE GUARD (29 Sep 2026, DEFECTS.md R-17 continued — found by
 * the R-17 end-to-end run). The createdKey chronology guard above only ever
 * sees `sys.tables.create_date`, which a RESTORE or REBUILD resets to today
 * regardless of how old the data inside the table actually is — reproduced
 * on scratch: exit 0, 0 stops from the createdKey check alone, epochs 13-16
 * closed, 17-20 registered from data that was really the July shape.
 * `checkDataVintage` (epoch.ts) closes that gap by reading the DATA itself,
 * exactly as world.vintage.* below configures it to answer.
 */
describe('sms epoch:accept — data-vintage guard (R-17 continued)', () => {
  const OPEN_SEPTEMBER = {
    epoch_id: 9,
    source_server: 'SRV',
    source_db: 'DATA_TP1U2',
    source_created_key: '2026-08-05T18:54:50.000', // the September rebuild, already open
    schema_fingerprint: 'fp-old',
    label: 'September copy',
  };
  const TODAYS_CREATE_DATE = '2026-09-29T09:00:00.000'; // what a restore/rebuild reports TODAY, regardless of data age

  it('a fresh create_date but JULY-vintage data → refused, exit 2, zero writes', async () => {
    world.openEpochRow = OPEN_SEPTEMBER;
    // createdKey is NEWER than the open epoch's — the chronology guard above
    // (which trusts only create_date) would pass this cleanly.
    world.identity = { ...world.identity, createdKey: TODAYS_CREATE_DATE };
    // But the DATA is July-vintage: the open (September) generation's own
    // earliest reading is 2026-08-05; this "new" source's newest reading is
    // 2026-07-10 — entirely older, well past the 1-day tolerance.
    world.vintage = {
      sourceMaxProd: '2026-07-10T11:23:10.000',
      sourceMaxId: 142511,
      openMinProd: '2026-08-05T19:03:16.000',
      closedEpochs: [],
    };

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(2);
    expect(world.app.transactions).toHaveLength(0);
    const sqls = world.app.statements.map((s) => s.sql);
    expect(sqls.some((q) => /^INSERT INTO sms\.source_epoch/.test(q.trim()))).toBe(false);
    expect(sqls.some((q) => /UPDATE sms\.source_epoch SET closed_utc/.test(q))).toBe(false);
    const printed = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
    expect(printed).toMatch(/older than the generation already open/);
    expect(printed).toMatch(/epoch:backfill/);
    expect(printed).toMatch(/--i-know-this-is-a-new-generation/);
  });

  it('a genuine newer generation (later data, no id-range overlap with any closed epoch) → registers as before', async () => {
    world.openEpochRow = OPEN_SEPTEMBER;
    world.identity = { ...world.identity, createdKey: TODAYS_CREATE_DATE };
    world.vintage = {
      sourceMaxProd: '2026-09-20T00:00:00.000', // later than the open epoch's own earliest reading
      sourceMaxId: 999,
      openMinProd: '2026-08-05T19:03:16.000',
      closedEpochs: [1, 2], // some closed epochs exist, but none checksum-match this source
    };
    world.overlapResultFor = () => ({ checkedIds: 50, sourceChecksum: 111, rawChecksum: 222, match: false, mode: 'full' });

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(0);
    expect(world.app.transactions).toHaveLength(1);
    expect(world.app.transactions[0]!.committed).toBe(true);
  });

  it('an id-range checksum MATCH against a closed epoch → refused even with newer-looking production dates', async () => {
    world.openEpochRow = OPEN_SEPTEMBER;
    world.identity = { ...world.identity, createdKey: TODAYS_CREATE_DATE };
    world.vintage = {
      sourceMaxProd: '2026-09-20T00:00:00.000', // would pass check (a) on its own
      sourceMaxId: 5000,
      openMinProd: '2026-08-05T19:03:16.000',
      closedEpochs: [1],
    };
    // The source's id range checksum-matches closed epoch 1 exactly: this
    // "new" source IS that old, already-closed generation.
    world.overlapResultFor = (epochId) =>
      epochId === 1
        ? { checkedIds: 5000, sourceChecksum: 42, rawChecksum: 42, match: true, mode: 'full' }
        : { checkedIds: 0, sourceChecksum: 0, rawChecksum: 0, match: true, mode: 'full' };

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(2);
    expect(world.app.transactions).toHaveLength(0);
    const printed = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
    expect(printed).toMatch(/checksum-match CLOSED epoch 1/);
  });

  it('--i-know-this-is-a-new-generation overrides the guard and registers, with an audited row', async () => {
    world.openEpochRow = OPEN_SEPTEMBER;
    world.identity = { ...world.identity, createdKey: TODAYS_CREATE_DATE };
    // Same fixture as the refused case above — would be refused without the override.
    world.vintage = {
      sourceMaxProd: '2026-07-10T11:23:10.000',
      sourceMaxId: 142511,
      openMinProd: '2026-08-05T19:03:16.000',
      closedEpochs: [],
    };

    const code = await epochAccept([...CONFIRM, '--i-know-this-is-a-new-generation']);

    expect(code).toBe(0);
    expect(world.app.transactions).toHaveLength(1);
    expect(world.app.transactions[0]!.committed).toBe(true);
    // Audited outside the transaction, naming the override action and the
    // registered epoch id — never a silent bypass.
    const audit = world.app.statements.find((s) => /^INSERT INTO sms\.audit_log/.test(s.sql.trim()));
    expect(audit).toBeDefined();
    expect(audit!.inputs.get('action')).toBe('epoch.accept.vintage_override');
    expect(String(audit!.inputs.get('detail'))).toMatch(/vintage guard bypassed/);
  });

  it('no open epoch at all: the vintage guard has nothing to compare against and is not consulted', async () => {
    world.openEpochRow = null;
    world.identity = { ...world.identity, createdKey: TODAYS_CREATE_DATE };
    // Deliberately configured as if it WOULD fail the guard, to prove the
    // guard is skipped entirely (p.openId === null) rather than coincidentally passing.
    world.vintage = {
      sourceMaxProd: '2020-01-01T00:00:00.000',
      sourceMaxId: 1,
      openMinProd: '2026-08-05T19:03:16.000',
      closedEpochs: [],
    };

    const code = await epochAccept(CONFIRM);

    expect(code).toBe(0);
    expect(world.app.transactions).toHaveLength(1);
    expect(world.app.transactions[0]!.committed).toBe(true);
  });
});
