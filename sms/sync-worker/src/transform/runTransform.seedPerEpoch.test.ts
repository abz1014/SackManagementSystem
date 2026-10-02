/**
 * C-024 (D-63): stale_timestamp and sack_blackout were seeded from the newest
 * canonical row of the WHOLE table, so a genuine July row arriving after a
 * September tail was measured against September. The seed is per source_epoch.
 *
 * Fake pool, mocked collaborators: this pins runTransform's wiring only. Nothing
 * opens a connection.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../reader/sourceTables.js', () => ({
  loadSourceStreams: async () => ({
    cone: { systemCode: 'ifl_sql', sourceTable: 'pack1_TP1U2' },
    sack: { systemCode: 'ifl_sql', sourceTable: 'sack1_TP1U2' },
    reject_qcs: { systemCode: 'ifl_sql', sourceTable: 'rejectQCS1_TP1U2' },
    reject_weight: { systemCode: 'ifl_sql', sourceTable: 'rejectWeight1_TP1U2' },
  }),
}));
vi.mock('./ruleHistory.js', () => ({
  loadShiftRuleHistory: async () => [],
  resolveShiftRuleAt: () => ({}),
  loadPlausibilityRuleHistory: async () => [],
  resolvePlausibilityAt: () => ({ coneLoG: 0, coneHiG: 99999, sackLoKg: 0, sackHiKg: 99999 }),
}));
vi.mock('./persistCanonical.js', () => ({
  persistCanonical: async (_p: unknown, _t: string, _c: unknown, rows: unknown[]) => ({ written: rows.length }),
  existingRawIds: async () => new Set<number>(),
  CONE_COLS: [],
  SACK_COLS: [],
  REJECT_COLS: [],
}));
vi.mock('./seedRejectCodes.js', () => ({ seedRejectCodes: async () => undefined }));
vi.mock('./shiftRuleDrift.js', () => ({ checkShiftRuleDrift: async () => [] }));
vi.mock('./isolatedDay.js', () => ({ checkIsolatedProductionDay: async () => [] }));
vi.mock('./transform.js', () => {
  const map = (r: Record<string, unknown>) => ({
    raw_id: r.raw_id,
    production_ts_utc_ms: r.ts,
    production_ts_utc: new Date(Number(r.ts)),
    source_epoch: r.epoch,
    source_row_id: r.raw_id,
    ingest_seq: 0,
    merge_key_is_unique: true,
    source_station: 1,
    weight_g: 1800,
    weight_kg: 50,
    sack_num: null,
  });
  return {
    mapCone: map,
    mapSack: map,
    mapReject: map,
    assignMergeKeys: (rows: unknown[]) => rows,
    coneKey: () => 'k',
    sackKey: () => 'k',
    rejectKey: () => 'k',
  };
});

import { runTransform } from './runTransform.js';

const H = 3_600_000;
const SEPT = Date.UTC(2026, 8, 7, 12, 0, 28); // newest canonical row, epoch 9
const JULY = Date.UTC(2026, 6, 1, 6, 0, 0);

interface Harness {
  pool: ConnectionPool;
  findings: { check: string; count: number }[];
}

/** canonical holds only epoch 9 (newest = SEPT); raw has the given cone / sack rows. */
const withDates = (rows: Record<string, unknown>[]) =>
  rows.map((r) => ({ ...r, src_ProductionDate: new Date(Number(r.ts)), src_Date: new Date(Number(r.ts)) }));

function harness(coneRaw: Record<string, unknown>[], sackRaw: Record<string, unknown>[], canonical: Record<number, number>): Harness {
  const findings: { check: string; count: number }[] = [];
  const pool = {
    request: () => {
      const inputs: Record<string, unknown> = {};
      const req = {
        input: (n: string, _t: unknown, v: unknown) => {
          inputs[n] = v;
          return req;
        },
        query: async (sql: string) => {
          if (sql.includes('INSERT INTO sms.dq_finding')) {
            findings.push({ check: String(inputs.check), count: Number(String(inputs.detail).match(/^(\d+)/)?.[1] ?? 1) });
            return { recordset: [] };
          }
          if (sql.includes('FROM sms.app_config')) return { recordset: [{ v: '0' }] };
          if (sql.includes('FROM sms.station')) return { recordset: [{ station_id: 1 }] };
          if (/FROM sms_raw\.cone_raw/.test(sql)) return { recordset: withDates(coneRaw) };
          if (/FROM sms_raw\.sack_raw/.test(sql)) return { recordset: withDates(sackRaw) };
          if (/FROM sms_raw\./.test(sql)) return { recordset: [] };
          if (sql.includes('MAX(production_ts_utc_ms)')) {
            if (sql.includes('source_epoch')) {
              // a per-generation read: only the generations canonical really holds come back
              return { recordset: Object.entries(canonical).map(([e, m]) => ({ source_epoch: Number(e), m })) };
            }
            if (sql.includes('line_id')) return { recordset: [{ m: SEPT }] }; // newest cone, any generation
            return { recordset: [{ m: Math.max(...Object.values(canonical)) }] }; // whole-table max (the defect)
          }
          if (sql.includes('TOP 1 production_ts_utc_ms')) {
            if (sql.includes('source_epoch')) {
              const m = canonical[Number(inputs.epoch)];
              return { recordset: m == null ? [] : [{ ms: m, raw_id: 1, source_row_id: 1 }] };
            }
            return { recordset: [{ ms: SEPT, raw_id: 1, source_row_id: 1 }] };
          }
          if (sql.includes('COUNT(*) n')) return { recordset: [{ n: 100 }] };
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, findings };
}

const cfg = { lineId: 1, appConfig: { shift: {} }, sackBlackoutHours: 4 } as never;

describe('runTransform seeds stale_timestamp per source_epoch (C-024)', () => {
  it('1,000 July rows (epoch 1) arriving after a September seed (epoch 9) are NOT stale', async () => {
    const cones = Array.from({ length: 1000 }, (_, i) => ({ raw_id: i + 1, ts: JULY + i * 60_000, epoch: 1 }));
    const h = harness(cones, [], { 9: SEPT });
    await runTransform(h.pool, cfg);
    expect(h.findings.filter((f) => f.check === 'stale_timestamp')).toEqual([]);
  });

  it('control: within one epoch a genuinely older row after a newer one is still flagged', async () => {
    const cones = [
      { raw_id: 1, ts: JULY + 10 * H, epoch: 1 },
      { raw_id: 2, ts: JULY, epoch: 1 }, // 10 h behind the running max
    ];
    const h = harness(cones, [], {});
    await runTransform(h.pool, cfg);
    const stale = h.findings.filter((f) => f.check === 'stale_timestamp');
    expect(stale).toHaveLength(1);
    expect(stale[0]!.count).toBe(1);
  });

  it('control: a batch row far behind its OWN epoch seed is still flagged', async () => {
    const cones = [{ raw_id: 5, ts: SEPT - 10 * H, epoch: 9 }];
    const h = harness(cones, [], { 9: SEPT });
    await runTransform(h.pool, cfg);
    expect(h.findings.filter((f) => f.check === 'stale_timestamp')).toHaveLength(1);
  });
});

describe('runTransform measures sack_blackout against the batch epoch\'s own predecessor (C-024)', () => {
  it('July sacks arriving after a September tail raise no blackout against the September sack', async () => {
    const sacks = [0, 1, 2].map((i) => ({ raw_id: i + 1, ts: JULY + i * H, epoch: 1 }));
    const h = harness([], sacks, { 9: SEPT });
    await runTransform(h.pool, cfg);
    expect(h.findings.filter((f) => f.check === 'sack_blackout')).toEqual([]);
  });
});
