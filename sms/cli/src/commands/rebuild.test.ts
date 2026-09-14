/**
 * `sms rebuild` — the rows it owns are the ones stamped with the CONFIGURED
 * system code (roadmap Phase 1, 14 Sep 2026). Until then the DELETE and the
 * "from version" probe both said `WHERE source_system='ifl_sql'`, a literal
 * that a second data source would have made wrong at the one command that
 * deletes canonical rows. Now the code comes from sms.data_source through
 * loadSourceStreams and is bound as a parameter.
 *
 * The pools are fakes that record every statement with its bound inputs; the
 * worker pieces the command drives (transform, watermarks, lock) are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt { sql: string; inputs: Map<string, unknown> }

/** Records every statement; a DELETE reports 3 rows the first time, 0 after. */
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
          if (/MIN\(transform_version\)/.test(sql)) return { recordset: [{ v: 2 }], rowsAffected: [1] };
          if (/INSERT INTO sms\.rebuild_audit/.test(sql)) return { recordset: [{ id: 41 }], rowsAffected: [1] };
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

const world = {
  app: undefined as unknown as ReturnType<typeof fakePool>,
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
}));
vi.mock('../context.js', async () => {
  const real = await vi.importActual<typeof import('../context.js')>('../context.js');
  return {
    parseArgs: real.parseArgs,
    openContext: async () => ({
      cfg: { lineId: 1, app: {} },
      app: world.app,
      ifl: world.app,
      close: async () => {},
    }),
  };
});

const { rebuild } = await import('./rebuild.js');

beforeEach(() => {
  world.app = fakePool();
  runTransform.mockClear();
  resetTransformWatermarks.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('sms rebuild — deletes by the configured system code', () => {
  it('binds the code as a parameter on the DELETE and on the from-version probe; no literal anywhere', async () => {
    expect(await rebuild(['--table=cone_event', '--snapshot-id=snap-1'])).toBe(0);
    const stmts = world.app.statements;
    const deletes = stmts.filter((s) => /^DELETE TOP/.test(s.sql.trim()));
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      expect(d.sql).toMatch(/DELETE TOP \(5000\) FROM sms\.cone_event WHERE source_system IN \(@sys0\)/);
      expect(d.inputs.get('sys0')).toBe('plant_sql');
    }
    const probe = stmts.find((s) => /MIN\(transform_version\)/.test(s.sql))!;
    expect(probe.sql).toMatch(/WHERE source_system IN \(@sys0\)/);
    expect(probe.inputs.get('sys0')).toBe('plant_sql');
    for (const s of stmts) expect(s.sql).not.toMatch(/ifl_sql/);
    // the rest of the sequence is unchanged: findings cleared, watermark reset, transform run
    expect(stmts.some((s) => /DELETE FROM sms\.dq_finding WHERE subject_table=@tbl2/.test(s.sql))).toBe(true);
    expect(resetTransformWatermarks).toHaveBeenCalledWith(world.app, 'cone_event');
    expect(runTransform).toHaveBeenCalledTimes(1);
  });

  it('reject_event is fed by two kinds: both codes, distinct, in one IN list', async () => {
    await rebuild(['--table=reject_event', '--snapshot-id=snap-2']);
    const d = world.app.statements.find((s) => /^DELETE TOP/.test(s.sql.trim()))!;
    expect(d.sql).toMatch(/WHERE source_system IN \(@sys0, @sys1\)/);
    expect([d.inputs.get('sys0'), d.inputs.get('sys1')]).toEqual(['plant_sql', 'legacy_sql']);
  });

  it('still refuses without a snapshot id, before opening anything', async () => {
    expect(await rebuild(['--table=cone_event'])).toBe(2);
    expect(world.app.statements).toHaveLength(0);
  });
});
