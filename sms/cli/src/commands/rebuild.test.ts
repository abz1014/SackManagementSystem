/**
 * `sms rebuild` — the rows it owns are the ones stamped with the CONFIGURED
 * system code (roadmap Phase 1, 14 Sep 2026) AND belonging to the SOURCE
 * GENERATION the operator named (23 Sep 2026).
 *
 * The second half is the one these tests exist for. Until 23 Sep 2026 the
 * DELETE read `WHERE source_system IN (...)` and nothing else, so one
 * `sms rebuild --table=cone_event` deleted and re-derived every generation of
 * cone_event at once — on the development sidecar, 487,936 rows across IFL's
 * July copy, IFL's September copy and the simulator, when the operator meant
 * one of them. `sms.source_epoch` is the entire defence against mixing those
 * generations; the command most able to undo it must be the one that names
 * them explicitly.
 *
 * The pools are fakes that record every statement with its bound inputs; the
 * worker pieces the command drives (transform, watermarks, lock) are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt { sql: string; inputs: Map<string, unknown> }

/**
 * Records every statement. A DELETE reports rows the first time it is seen and
 * 0 after, so the chunk loop terminates; the counts per (table, generation)
 * are the real ones measured on the development sidecar on 23 Sep 2026, so a
 * plan assertion below is checking against numbers that actually exist.
 */
const CANON = { 1: 142511, 9: 132552, 13: 212873 } as Record<number, number>;

function fakePool() {
  const statements: Stmt[] = [];
  let deleted = false;
  const pool = {
    statements,
    request() {
      const inputs = new Map<string, unknown>();
      const req = {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return req;
        },
        async query(sql: string) {
          statements.push({ sql, inputs: new Map(inputs) });
          if (/^DELETE TOP/.test(sql.trim())) {
            const n = deleted ? 0 : 3;
            deleted = true;
            return { recordset: [], rowsAffected: [n] };
          }
          if (/^DELETE FROM sms\.dq_finding/.test(sql.trim())) return { recordset: [], rowsAffected: [4] };
          if (/MIN\(transform_version\)/.test(sql)) return { recordset: [{ v: 2 }], rowsAffected: [1] };
          if (/FROM sms\.sync_run WHERE finished_at_utc IS NULL/.test(sql)) return { recordset: [{ n: world.inFlight }], rowsAffected: [1] };
          if (/INSERT INTO sms\.rebuild_audit/.test(sql)) return { recordset: [{ id: 41 }], rowsAffected: [1] };
          if (/FROM sms\.source_epoch/.test(sql)) return { recordset: world.epochs, rowsAffected: [world.epochs.length] };
          if (/FROM sms_raw\./.test(sql)) return { recordset: world.rawCounts, rowsAffected: [1] };
          if (/COUNT\(\*\) n FROM sms\.\w+\s+WHERE line_id/.test(sql)) {
            return { recordset: world.canonCounts, rowsAffected: [1] };
          }
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

const CONE_EPOCHS = [
  { epoch_id: 1, source_table: 'pack1_TP1U2', source_db: 'DATA_TP1U2', provenance: 'ifl_copy', label: 'July copy - cones', closed_utc: new Date() },
  { epoch_id: 9, source_table: 'pack1_TP1U2', source_db: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: 'September copy - cones', closed_utc: new Date() },
  { epoch_id: 13, source_table: 'pack1_TP1U2', source_db: 'DATA_TP1U2_SIM', provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4', closed_utc: null },
];

const world = {
  app: undefined as unknown as ReturnType<typeof fakePool>,
  /** sync_run rows with no finished_at_utc — a worker pass in progress. */
  inFlight: 0,
  epochs: CONE_EPOCHS as { epoch_id: number; source_table: string; source_db: string; provenance: string; label: string; closed_utc: Date | null }[],
  canonCounts: [
    { e: 1, n: CANON[1] },
    { e: 9, n: CANON[9] },
    { e: 13, n: CANON[13] },
  ] as { e: number; n: number }[],
  rawCounts: [
    { e: 1, n: CANON[1] },
    { e: 9, n: CANON[9] },
    { e: 13, n: CANON[13] },
  ] as { e: number; n: number }[],
  streams: {
    cone: { systemCode: 'plant_sql', sourceTable: 'pack1_TP1U2' },
    sack: { systemCode: 'plant_sql', sourceTable: 'sack1_TP1U2' },
    reject_qcs: { systemCode: 'plant_sql', sourceTable: 'rejectQCS1_TP1U2' },
    reject_weight: { systemCode: 'legacy_sql', sourceTable: 'rejectWeight1_TP1U2' },
  },
};

const runTransform = vi.fn(async () => [{ table: 'cone_event', read: 3, written: 3, findings: [] }]);
const resetTransformWatermarks = vi.fn(async (_p: unknown, _t: string): Promise<void> => undefined);
vi.mock('@sms/sync-worker', () => ({
  loadSourceStreams: async () => world.streams,
  runTransform: () => runTransform(),
  resetTransformWatermarks: (_p: unknown, t: string) => resetTransformWatermarks(_p, t),
  withTransformLock: (_c: unknown, fn: () => Promise<unknown>) => fn(),
  TABLE_SHAPES: {
    cone: { rawTable: 'sms_raw.cone_raw' },
    sack: { rawTable: 'sms_raw.sack_raw' },
    reject_qcs: { rawTable: 'sms_raw.reject_qcs_raw' },
    reject_weight: { rawTable: 'sms_raw.reject_weight_raw' },
  },
}));
vi.mock('../context.js', async () => {
  const real = await vi.importActual<typeof import('../context.js')>('../context.js');
  return {
    parseArgs: real.parseArgs,
    cliLog: { error: () => {} },
    openContext: async () => ({
      cfg: { lineId: 1, app: { server: 'localhost\\SQLEXPRESS', database: 'sms' } },
      app: world.app,
      ifl: world.app,
      close: async () => {},
    }),
  };
});

const { rebuild, parseEpochList, planLines } = await import('./rebuild.js');

let logged: string[] = [];
let errored: string[] = [];

beforeEach(() => {
  world.app = fakePool();
  world.inFlight = 0;
  world.epochs = CONE_EPOCHS;
  logged = [];
  errored = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
  runTransform.mockClear();
  resetTransformWatermarks.mockClear();
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logged.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errored.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

const BASE = ['--table=cone_event', '--snapshot-id=sms_20260914_1530'];
const deletesOf = (p: ReturnType<typeof fakePool>) => p.statements.filter((s) => /^DELETE TOP/.test(s.sql.trim()));

describe('sms rebuild — deletes by the configured system code', () => {
  it('binds the code as a parameter on the DELETE and on the from-version probe; no literal anywhere', async () => {
    expect(await rebuild([...BASE, '--epoch=9', '--confirm'])).toBe(0);
    const stmts = world.app.statements;
    const deletes = deletesOf(world.app);
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      expect(d.sql).toMatch(/DELETE TOP \(5000\) FROM sms\.cone_event/);
      expect(d.sql).toMatch(/source_system IN \(@sys0\)/);
      expect(d.inputs.get('sys0')).toBe('plant_sql');
    }
    const probe = stmts.find((s) => /MIN\(transform_version\)/.test(s.sql))!;
    expect(probe.sql).toMatch(/source_system IN \(@sys0\)/);
    expect(probe.inputs.get('sys0')).toBe('plant_sql');
    for (const s of stmts) expect(s.sql).not.toMatch(/ifl_sql/);
    expect(resetTransformWatermarks).toHaveBeenCalledWith(world.app, 'cone_event');
    expect(runTransform).toHaveBeenCalledTimes(1);
  });

  it('reject_event is fed by two kinds: both codes, distinct, in one IN list', async () => {
    world.epochs = [
      { epoch_id: 3, source_table: 'rejectQCS1_TP1U2', source_db: 'DATA_TP1U2', provenance: 'ifl_copy', label: 'July - quality', closed_utc: new Date() },
      { epoch_id: 4, source_table: 'rejectWeight1_TP1U2', source_db: 'DATA_TP1U2', provenance: 'ifl_copy', label: 'July - weight', closed_utc: new Date() },
    ];
    await rebuild(['--table=reject_event', '--snapshot-id=sms_20260914_1531', '--epoch=3', '--confirm']);
    const d = deletesOf(world.app)[0]!;
    expect(d.sql).toMatch(/source_system IN \(@sys0, @sys1\)/);
    expect([d.inputs.get('sys0'), d.inputs.get('sys1')]).toEqual(['plant_sql', 'legacy_sql']);
  });

  it('still refuses without a snapshot id, before opening anything', async () => {
    expect(await rebuild(['--table=cone_event'])).toBe(2);
    expect(world.app.statements).toHaveLength(0);
  });
});

/**
 * The two Phase 3 gates (roadmap item 5, 14 Sep 2026): a snapshot id must
 * look like the name of a snapshot, and no worker pass may be in flight —
 * the transform lock covers the transform, this covers the reader.
 */
describe('sms rebuild — snapshot id and in-flight pass gates', () => {
  it('refuses a snapshot id that is not a plausible name, before opening anything', async () => {
    for (const bad of ['x', 'snap-1', '-20260914', 'a b c d e f g h', 'sms/2026']) {
      expect(await rebuild(['--table=cone_event', `--snapshot-id=${bad}`, '--epoch=9', '--confirm'])).toBe(2);
    }
    expect(world.app.statements).toHaveLength(0);
    expect(runTransform).not.toHaveBeenCalled();
  });

  it('accepts the names a backup or a tag would have, recording the id as given', async () => {
    expect(await rebuild([...BASE, '--epoch=9', '--confirm'])).toBe(0);
    const audit = world.app.statements.find((s) => /INSERT INTO sms\.rebuild_audit/.test(s.sql))!;
    expect(audit.inputs.get('snap')).toBe('sms_20260914_1530');
    world.app = fakePool();
    expect(
      await rebuild(['--table=cone_event', '--snapshot-id=v0.1.0-baseline:2026-09-14T15.30', '--epoch=9', '--confirm']),
    ).toBe(0);
  });

  it('refuses while a worker pass is in progress, before the audit row or any DELETE', async () => {
    world.inFlight = 2;
    expect(await rebuild([...BASE, '--epoch=9', '--confirm'])).toBe(2);
    const sqls = world.app.statements.map((s) => s.sql);
    expect(sqls.some((q) => /finished_at_utc IS NULL/.test(q))).toBe(true);
    expect(sqls.some((q) => /rebuild_audit/.test(q))).toBe(false);
    expect(sqls.some((q) => /^DELETE/.test(q.trim()))).toBe(false);
    expect(runTransform).not.toHaveBeenCalled();
    expect(resetTransformWatermarks).not.toHaveBeenCalled();
  });
});

/**
 * THE GENERATION SCOPE (23 Sep 2026). These are the regression guards for the
 * defect this file's header describes. Do not reintroduce a default scope to
 * make any of them pass.
 */
describe('sms rebuild — a generation must be named, and only it is touched', () => {
  it('neither --epoch nor --all-generations: refuses, exits 2, deletes nothing, and lists the real generations', async () => {
    expect(await rebuild([...BASE, '--confirm'])).toBe(2);
    const msg = errored.join('\n');
    expect(msg).toMatch(/must be told WHICH source generation/);
    expect(msg).toMatch(/--epoch=1\s+pack1_TP1U2\s+DATA_TP1U2\s/);
    expect(msg).toMatch(/--epoch=9/);
    expect(msg).toMatch(/--epoch=13/);
    // the total it would once have deleted, named so the operator sees the size of the old behaviour
    expect(msg).toMatch(/487,936/);
    expect(deletesOf(world.app)).toHaveLength(0);
    expect(world.app.statements.some((s) => /rebuild_audit/.test(s.sql))).toBe(false);
    expect(runTransform).not.toHaveBeenCalled();
  });

  it('--epoch and --all-generations together: refuses before opening anything', async () => {
    expect(await rebuild([...BASE, '--epoch=9', '--all-generations', '--confirm'])).toBe(2);
    expect(world.app.statements).toHaveLength(0);
  });

  it('an epoch that is not a generation of this table: refuses and names the ones that are', async () => {
    expect(await rebuild([...BASE, '--epoch=2', '--confirm'])).toBe(2);
    expect(errored.join('\n')).toMatch(/epoch\(s\) 2 are not generations of pack1_TP1U2/);
    expect(deletesOf(world.app)).toHaveLength(0);
    expect(runTransform).not.toHaveBeenCalled();
  });

  it('without --confirm: prints the plan and changes nothing', async () => {
    expect(await rebuild([...BASE, '--epoch=9'])).toBe(2);
    expect(logged.join('\n')).toMatch(/re-run with --confirm/);
    expect(deletesOf(world.app)).toHaveLength(0);
    expect(world.app.statements.some((s) => /rebuild_audit/.test(s.sql))).toBe(false);
    expect(runTransform).not.toHaveBeenCalled();
  });

  /** The acceptance case: one generation named, the other two left alone. */
  it('a targeted rebuild deletes ONLY that generation — the other generations are not in the DELETE at all', async () => {
    expect(await rebuild([...BASE, '--epoch=9', '--confirm'])).toBe(0);
    const deletes = deletesOf(world.app);
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      expect(d.sql).toMatch(/AND source_epoch IN \(@ep0\)/);
      expect(d.inputs.get('ep0')).toBe(9);
      // the two generations NOT named are nowhere in the statement's epoch bindings
      const eps = [...d.inputs.entries()].filter(([k]) => /^ep\d+$/.test(k)).map(([, v]) => v);
      expect(eps).toEqual([9]);
      // and the line is scoped too — it never was before
      expect(d.sql).toMatch(/WHERE line_id = @line/);
      expect(d.inputs.get('line')).toBe(1);
    }
    const plan = logged.join('\n');
    expect(plan).toMatch(/WILL DELETE\s+132,552 row\(s\) from sms\.cone_event, generation\(s\) 9/);
    expect(plan).toMatch(/WILL LEAVE\s+355,384 row\(s\) of generation\(s\) 1, 13 untouched/);
  });

  it('--epoch=9,13 scopes to exactly those two, in one bound IN list', async () => {
    expect(await rebuild([...BASE, '--epoch=13,9', '--confirm'])).toBe(0);
    const d = deletesOf(world.app)[0]!;
    expect(d.sql).toMatch(/AND source_epoch IN \(@ep0, @ep1\)/);
    expect([d.inputs.get('ep0'), d.inputs.get('ep1')]).toEqual([9, 13]);
  });

  it('--all-generations names every one of them, and says so in the plan', async () => {
    expect(await rebuild([...BASE, '--all-generations', '--confirm'])).toBe(0);
    const d = deletesOf(world.app)[0]!;
    expect([d.inputs.get('ep0'), d.inputs.get('ep1'), d.inputs.get('ep2')]).toEqual([1, 9, 13]);
    expect(logged.join('\n')).toMatch(/WILL DELETE\s+487,936 row\(s\)/);
  });

  it('the generation scope is recorded in sms.audit_log, which rebuild_audit has no column for', async () => {
    await rebuild([...BASE, '--epoch=9', '--confirm']);
    const a = world.app.statements.find((s) => /INSERT INTO sms\.audit_log/.test(s.sql))!;
    expect(a.inputs.get('action')).toBe('rebuild.run');
    expect(String(a.inputs.get('detail'))).toMatch(/generation\(s\) 9 of 1,9,13/);
  });
});

/**
 * `sms.dq_finding` carries no generation. Deleting by subject_table therefore
 * takes findings belonging to generations a targeted rebuild is not
 * re-deriving, and nothing puts them back; and it used to take CRITICAL ones,
 * including `transform_zero_write` — the alarm that says rows were NOT written
 * (runTransform.ts:375), on exactly these subject_table values.
 */
describe('sms rebuild — dq_finding is no longer collateral', () => {
  it('a targeted rebuild deletes no dq_finding rows at all, and says so', async () => {
    await rebuild([...BASE, '--epoch=9', '--confirm']);
    expect(world.app.statements.some((s) => /DELETE FROM sms\.dq_finding/.test(s.sql))).toBe(false);
    expect(logged.join('\n')).toMatch(/dq_finding NOT cleared/);
  });

  it('--all-generations clears findings for the table but NEVER a CRITICAL one', async () => {
    await rebuild([...BASE, '--all-generations', '--confirm']);
    const d = world.app.statements.find((s) => /DELETE FROM sms\.dq_finding/.test(s.sql))!;
    expect(d).toBeDefined();
    expect(d.sql).toMatch(/severity <> 'CRITICAL'/);
    expect(d.inputs.get('tbl2')).toBe('cone_event');
  });
});

describe('sms rebuild — argument helpers', () => {
  it('parseEpochList takes a comma list, dedupes, sorts, and drops anything that is not a positive integer', () => {
    expect(parseEpochList('13,9,9,0,-2,abc, 11 ')).toEqual([9, 11, 13]);
    expect(parseEpochList(undefined)).toEqual([]);
    expect(parseEpochList(true)).toEqual([]);
  });

  it('planLines warns, loudly, when canonical exceeds raw — those rows cannot come back', () => {
    const lines = planLines(
      'cone_event',
      'srv/sms',
      1,
      'sms_20260914_1530',
      2,
      [{ epochId: 9, sourceTable: 'pack1_TP1U2', sourceDb: 'D', provenance: 'ifl_copy', open: false, label: 'x', canonicalRows: 100, rawRows: 40 }],
      [9],
    ).join('\n');
    expect(lines).toMatch(/MORE CANONICAL THAN RAW \(100 vs 40\)/);
    expect(lines).toMatch(/WILL BE LOST/);
  });
});
