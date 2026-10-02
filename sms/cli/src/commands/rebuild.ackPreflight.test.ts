/**
 * C-011 (D-65): migration 042's FK_dq_ack_finding means an unconditional
 * `DELETE FROM sms.dq_finding` raises 547 once any finding in scope has been
 * acknowledged. `rebuild --all-generations` used to empty canonical first and
 * fail at that DELETE, leaving the watermark unchanged. It must now refuse
 * BEFORE any DELETE, naming the acknowledged finding ids.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

interface Stmt { sql: string; inputs: Map<string, unknown> }

const world = {
  app: undefined as unknown as ReturnType<typeof fakePool>,
  ackedIds: [] as number[],
};

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
          const s = sql.trim();
          if (/^DELETE TOP/.test(s)) {
            const k = deleted ? 0 : 3;
            deleted = true;
            return { recordset: [], rowsAffected: [k] };
          }
          if (/^DELETE FROM sms\.dq_finding/.test(s)) {
            if (world.ackedIds.length > 0) {
              throw new Error('The DELETE statement conflicted with the REFERENCE constraint "FK_dq_ack_finding" (547)');
            }
            return { recordset: [], rowsAffected: [4] };
          }
          if (/sms\.dq_acknowledgement/.test(s)) {
            return { recordset: world.ackedIds.map((id) => ({ id })), rowsAffected: [world.ackedIds.length] };
          }
          if (/MIN\(transform_version\)/.test(s)) return { recordset: [{ v: 2 }], rowsAffected: [1] };
          if (/FROM sms\.sync_run WHERE finished_at_utc IS NULL/.test(s)) return { recordset: [{ n: 0 }], rowsAffected: [1] };
          if (/INSERT INTO sms\.rebuild_audit/.test(s)) return { recordset: [{ id: 41 }], rowsAffected: [1] };
          if (/FROM sms\.source_epoch/.test(s)) {
            return {
              recordset: [
                { epoch_id: 1, source_table: 'pack1_TP1U2', source_db: 'D', provenance: 'ifl_copy', label: 'x', closed_utc: new Date() },
              ],
              rowsAffected: [1],
            };
          }
          if (/FROM sms_raw\./.test(s)) return { recordset: [{ e: 1, n: 100 }], rowsAffected: [1] };
          if (/COUNT\(\*\) n FROM sms\.\w+\s+WHERE line_id/.test(s)) return { recordset: [{ e: 1, n: 100 }], rowsAffected: [1] };
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

const runTransform = vi.fn(async () => [{ table: 'cone_event', read: 3, written: 3, findings: [] }]);
const resetTransformWatermarks = vi.fn(async (_p: unknown, _t: string): Promise<void> => undefined);
vi.mock('@sms/sync-worker', () => ({
  loadSourceStreams: async () => ({
    cone: { systemCode: 'plant_sql', sourceTable: 'pack1_TP1U2' },
    sack: { systemCode: 'plant_sql', sourceTable: 'sack1_TP1U2' },
    reject_qcs: { systemCode: 'plant_sql', sourceTable: 'rejectQCS1_TP1U2' },
    reject_weight: { systemCode: 'plant_sql', sourceTable: 'rejectWeight1_TP1U2' },
  }),
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
      cfg: { lineId: 1, app: { server: 's', database: 'sms' } },
      app: world.app,
      ifl: world.app,
      close: async () => {},
    }),
  };
});

const { rebuild } = await import('./rebuild.js');

let errored: string[] = [];
beforeEach(() => {
  world.app = fakePool();
  world.ackedIds = [];
  errored = [];
  runTransform.mockClear();
  resetTransformWatermarks.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errored.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

const ARGS = ['--table=cone_event', '--snapshot-id=sms_20260914_1530', '--all-generations', '--confirm'];

describe('sms rebuild --all-generations — acknowledged findings (C-011)', () => {
  it('refuses before any DELETE or audit row when a finding in scope is acknowledged, naming its id', async () => {
    world.ackedIds = [7, 9];
    const code = await rebuild(ARGS);
    expect(world.app.statements.filter((s) => /^DELETE/.test(s.sql.trim()))).toHaveLength(0);
    expect(world.app.statements.some((s) => /rebuild_audit/.test(s.sql))).toBe(false);
    expect(resetTransformWatermarks).not.toHaveBeenCalled();
    expect(runTransform).not.toHaveBeenCalled();
    expect(code).toBe(2);
    const msg = errored.join('\n');
    expect(msg).toMatch(/REFUSED/);
    expect(msg).toMatch(/acknowledg/i);
    expect(msg).toMatch(/\b7\b/);
    expect(msg).toMatch(/\b9\b/);
  });

  it('with no acknowledgement in scope it still completes (control)', async () => {
    expect(await rebuild(ARGS)).toBe(0);
    expect(world.app.statements.some((s) => /^DELETE FROM sms\.dq_finding/.test(s.sql.trim()))).toBe(true);
  });
});
