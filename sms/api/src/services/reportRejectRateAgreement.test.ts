/**
 * The regression this pass exists to close (23 Sep 2026): the Rejects screen
 * (rejectSpc.ts's p̄) and the management summary / daily / product / sack
 * reports (report.ts's toReportLine, built on production.ts) must print the
 * SAME reject rate for the SAME period. Both used to divide by cones +
 * every reject; rejectSpc.ts was corrected first, report.ts separately
 * (production.ts now supplies `unmatchedRejects`, and toReportLine divides
 * by cones + that, not cones + every reject). This file drives BOTH real
 * services against ONE fake dataset that includes rejects which DO and do
 * NOT match an existing cone_event row, so a regression to the old
 * cones-plus-every-reject formula in EITHER path fails here — a dataset
 * where every reject is unmatched (as rejectsAgreement.test.ts uses) cannot
 * tell the two formulas apart, because they agree in that special case.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction } from './production.js';
import { toReportLine } from './report.js';
import { getRejectSpc } from './rejectSpc.js';

const ms = (iso: string) => new Date(iso).getTime();
const DAY = '2026-09-10';

interface Row {
  line_id: number;
  shift_date: string;
  shift_code: 'morning';
  production_ts_utc_ms: number;
  source_epoch: number;
  source_station: number | null;
  material_id: number | null;
  hanger_num: number;
  in_range?: boolean;
}

// 20 cones. 8 rejects: 5 share a (production_ts_utc_ms, hanger_num) with an
// existing cone (already counted once); 3 do not (hanger 900-902, a time no
// cone was ever logged at). Correct denominator: 20 + 3 = 23, not 20 + 8 = 28.
const CONES: Row[] = Array.from({ length: 20 }, (_, i) => ({
  line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-10T06:00:00Z') + i * 60_000,
  source_epoch: 9, source_station: 1, material_id: 21, in_range: true, hanger_num: i + 1,
}));
const MATCHED_REJECTS: Row[] = CONES.slice(0, 5).map((c) => ({ ...c, source_epoch: 11 }));
const UNMATCHED_REJECTS: Row[] = Array.from({ length: 3 }, (_, i) => ({
  line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-10T09:00:00Z') + i * 60_000,
  source_epoch: 11, source_station: 1, material_id: 21, hanger_num: 900 + i,
}));
const REJECTS: Row[] = [...MATCHED_REJECTS, ...UNMATCHED_REJECTS];
const REGISTRY = [{ epoch_id: 9, generation_ordinal: 5 }, { epoch_id: 11, generation_ordinal: 5 }];

function evaluate(sql: string, p: Map<string, unknown>): Record<string, unknown>[] {
  if (sql.includes('FROM sms.source_epoch')) return REGISTRY;
  if (sql.includes('FROM sms.weight_rule') || sql.includes('FROM sms.sack_event')) return [];
  const table = sql.includes('FROM sms.reject_event') ? REJECTS : sql.includes('FROM sms.cone_event') ? CONES : null;
  if (!table) throw new Error(`unexpected query: ${sql}`);

  const uses = (param: string) => sql.includes(`@${param}`);
  let rows = table.filter((r) => {
    if (uses('line') && r.line_id !== p.get('line')) return false;
    if (uses('from') && r.shift_date < String(p.get('from'))) return false;
    if (uses('to') && r.shift_date > String(p.get('to'))) return false;
    return true;
  });
  if (sql.includes('NOT EXISTS') && sql.includes('sms.cone_event')) {
    rows = rows.filter((r) => !CONES.some(
      (c) => c.production_ts_utc_ms === r.production_ts_utc_ms && c.hanger_num === r.hanger_num,
    ));
  }
  if (sql.includes('AS bucket_ts')) {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.source_epoch}|${r.shift_date}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].map(([k, rs]) => {
      const [epoch, day] = k.split('|');
      return { source_epoch: Number(epoch), bucket_ts: new Date(`${day}T00:00:00.000Z`), n: rs.length };
    });
  }
  // production.ts groupBy 'none' (cones/rejects) and getUnmatchedRejects's
  // own ungrouped total both land here: one aggregate row.
  return [{ grp: 'total', n: rows.length, inr: rows.filter((r) => r.in_range).length }];
}

function datasetPool(): ConnectionPool {
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; },
        query: async (sql: string) => ({ recordset: evaluate(sql, inputs) }),
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool;
}

describe('report.ts (management summary / daily / product / sack) agrees with rejectSpc.ts (the Rejects screen) on the SAME period', () => {
  it('both divide by cones + UNMATCHED rejects only, not cones + every reject', async () => {
    const prod = await getProduction(datasetPool(), 1, { from: DAY, to: DAY, groupBy: 'none' });
    const line = toReportLine(prod.rows[0]!);
    const spc = await getRejectSpc(datasetPool(), 1, DAY, DAY, 'day', 'all');

    // Sanity: the raw counts this whole test rests on.
    expect(prod.rows[0]!.cones).toBe(20);
    expect(prod.rows[0]!.rejectedCones).toBe(8);
    expect(prod.rows[0]!.unmatchedRejects).toBe(3);

    // The correct rate: 8 / (20 + 3) = 34.7826...%
    const correctPct = Math.round((10000 * 8) / 23) / 100;
    expect(line.rejectRatePct).toBe(correctPct);
    expect(spc.pBar).toBeCloseTo(8 / 23, 5);
    expect(line.rejectRatePct).toBeCloseTo((spc.pBar ?? 0) * 100, 1);

    // What a regression to the OLD formula (cones + every reject, 8/28 =
    // 28.57%) would have printed on one screen while the other read 34.78% —
    // this is the exact divergence this pass closed. If either path
    // regresses to the old formula, this assertion catches it.
    const oldBuggyPct = Math.round((10000 * 8) / 28) / 100;
    expect(line.rejectRatePct).not.toBe(oldBuggyPct);
  });
});
