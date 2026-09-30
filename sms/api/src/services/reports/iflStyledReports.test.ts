/**
 * Task W1 (30 Sep 2026): the two IFL-SSRS-styled reports, 'shift-production'
 * and 'rejected-cones'. The pool is a recording fake that answers by table;
 * a fake cannot execute a WHERE, so filters are proven by the SQL text and
 * the parameters bound on it, and arithmetic/ordering by the rows it returns.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../admin.js', () => ({ getPlausibilityRule: vi.fn(async () => ({ coneLoG: 1500, coneHiG: 2100 })) }));
vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn(async () => ({ displayName: 'Line 3', plant: { name: 'IFL' }, unit: { name: 'Unit 2' } })) }));

import { getShiftProductionReport, shiftProductionCsv, figures, SHIFT_PRODUCTION_CSV_HEADERS } from './shiftProduction.js';
import { getRejectedConesReport, rejectedConesCsv, REJECTED_CONES_CSV_HEADERS } from './rejectedCones.js';
import { REPORT_TYPES, REPORT_TITLES, FILTERS_BY_TYPE } from './common.js';
import { buildReport, reportCsv } from './index.js';
import { buildHeader } from './header.js';
import { attributionRows, csvDocument } from './csv.js';
import type { ShiftRange } from '../../shiftRange.js';

interface Call { sql: string; params: Map<string, unknown> }

function fakePool(answer: (sql: string) => Record<string, unknown>[]): { pool: ConnectionPool; calls: Call[] } {
  const calls: Call[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (n: string, _t: unknown, v: unknown) => { params.set(n, v); return req; },
        query: async (sql: string) => {
          if (sql.includes('GROUP BY source_epoch') || sql.includes('FROM sms.source_epoch')) return { recordset: [], rowsAffected: [0] };
          calls.push({ sql, params });
          return { recordset: answer(sql), rowsAffected: [0] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-02' };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

// Deliberately unordered, to prove the report sorts.
const CONES = [
  { d: d('2026-09-02'), sc: 'morning', st: 1, n: 50 },
  { d: d('2026-09-01'), sc: 'night', st: 2, n: 30 },
  { d: d('2026-09-01'), sc: 'morning', st: 2, n: 60 },
  { d: d('2026-09-01'), sc: 'morning', st: 1, n: 40 },
  { d: d('2026-09-01'), sc: 'evening', st: 1, n: 20 },
  { d: d('2026-09-01'), sc: 'morning', st: null, n: 5 },
];
const REJECTS = [
  { d: d('2026-09-01'), sc: 'morning', st: 1, n: 10 },
  { d: d('2026-09-01'), sc: 'night', st: 2, n: 3 },
  { d: d('2026-09-02'), sc: 'morning', st: 1, n: 2 },
];

const spAnswer = (sql: string) => (sql.includes('sms.reject_event') ? REJECTS : CONES);

describe('shift-production: figures', () => {
  it('efficiency = pass/total x 100, rounded to 2 dp', () => {
    expect(figures(2, 1).efficiencyPct).toBe(66.67);
    expect(figures(1, 2).efficiencyPct).toBe(33.33);
    expect(figures(90, 10)).toEqual({ pass: 90, weightRejects: 10, total: 100, efficiencyPct: 90 });
    expect(figures(200, 1).efficiencyPct).toBe(99.5);
  });
  it('is null when the total is 0', () => {
    expect(figures(0, 0)).toEqual({ pass: 0, weightRejects: 0, total: 0, efficiencyPct: null });
  });
  it('0 pass with rejects is 0, not null', () => {
    expect(figures(0, 4).efficiencyPct).toBe(0);
  });
});

describe('shift-production: report', () => {
  it('totals equal the sums, at every level', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    const conesAll = CONES.reduce((a, c) => a + c.n, 0);
    const rejAll = REJECTS.reduce((a, c) => a + c.n, 0);
    expect(r.grandTotal).toEqual(figures(conesAll, rejAll));
    expect(r.summary.reduce((a, s) => a + s.pass, 0)).toBe(conesAll);
    expect(r.summary.reduce((a, s) => a + s.weightRejects, 0)).toBe(rejAll);
    expect(r.shiftTotals.reduce((a, s) => a + s.total, 0)).toBe(conesAll + rejAll);
    // rows exclude the winder-less cones, which are disclosed instead
    expect(r.withoutWinder).toEqual({ pass: 5, weightRejects: 0 });
    expect(r.rows.reduce((a, s) => a + s.pass, 0) + r.withoutWinder.pass).toBe(conesAll);
    expect(r.rows.reduce((a, s) => a + s.weightRejects, 0)).toBe(rejAll);
    for (const row of r.rows) expect(row.total).toBe(row.pass + row.weightRejects);
  });

  it('per-shift summary matches by hand', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    // morning pass: 50+60+40+5 = 155; rejects 10+2 = 12
    expect(r.summary.map((s) => s.shift)).toEqual(['morning', 'evening', 'night']);
    expect(r.summary[0]).toEqual({ shift: 'morning', ...figures(155, 12) });
    expect(r.summary[1]).toEqual({ shift: 'evening', ...figures(20, 0) });
    expect(r.summary[2]).toEqual({ shift: 'night', ...figures(30, 3) });
  });

  it('orders rows by date, shift order (morning, evening, night), then winder', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.rows.map((x) => `${x.date} ${x.shift} ${x.winder}`)).toEqual([
      '2026-09-01 morning 1', '2026-09-01 morning 2', '2026-09-01 evening 1', '2026-09-01 night 2', '2026-09-02 morning 1',
    ]);
    expect(r.shiftTotals.map((x) => `${x.date} ${x.shift}`)).toEqual([
      '2026-09-01 morning', '2026-09-01 evening', '2026-09-01 night', '2026-09-02 morning',
    ]);
  });

  it('counts weight rejects only: the reject query is weight-typed with a weight', async () => {
    const { pool, calls } = fakePool(spAnswer);
    await getShiftProductionReport(pool, 1, PERIOD, {});
    const rej = calls.find((c) => c.sql.includes('sms.reject_event'))!;
    expect(rej.sql).toContain("reject_type = 'weight'");
    expect(rej.sql).toContain('weight_g IS NOT NULL');
    const cone = calls.find((c) => c.sql.includes('sms.cone_event'))!;
    expect(cone.sql).not.toContain('reject_type');
  });

  it('a row with pass only and none with rejects still gets an efficiency; a cell with no readings is absent', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.rows.find((x) => x.shift === 'evening')!.efficiencyPct).toBe(100);
    expect(r.rows.find((x) => x.date === '2026-09-02' && x.winder === 2)).toBeUndefined();
  });

  it('empty period: no rows, null efficiency', async () => {
    const { pool } = fakePool(() => []);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.rows).toEqual([]);
    expect(r.summary).toEqual([]);
    expect(r.grandTotal.efficiencyPct).toBeNull();
  });

  it('the shift filter is bound on both tables; shiftRange narrows both with its own params', async () => {
    const range: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' };
    const { pool, calls } = fakePool(spAnswer);
    await getShiftProductionReport(pool, 1, PERIOD, { shift: 'night' }, range);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.sql).toContain('shift_code = @shift');
      expect(c.params.get('shift')).toBe('night');
      expect(c.sql).toContain('@srFrom');
      expect(c.params.get('srFrom')).toBe('2026-09-01');
      expect(c.params.get('srFromOrd')).toBe(2);
      expect(c.params.get('srTo')).toBe('2026-09-02');
      expect(c.params.get('srToOrd')).toBe(1);
    }
    const plain = fakePool(spAnswer);
    await getShiftProductionReport(plain.pool, 1, PERIOD, {});
    for (const c of plain.calls) {
      expect(c.sql).not.toContain('@srFrom');
      expect(c.sql).not.toContain('@shift');
    }
  });

  it('CSV: one table, section column, totals present, filename/attribution carry through', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    const t = shiftProductionCsv(r);
    expect(t.headers).toEqual(SHIFT_PRODUCTION_CSV_HEADERS);
    for (const row of t.rows) expect(row).toHaveLength(t.headers.length);
    const sections = t.rows.map((x) => x[0]);
    expect(sections.filter((s) => s === 'summary')).toHaveLength(3);
    expect(sections.filter((s) => s === 'grand_total')).toHaveLength(1);
    expect(sections.filter((s) => s === 'winder')).toHaveLength(5);
    expect(sections.filter((s) => s === 'shift_total')).toHaveLength(4);
    const grand = t.rows.find((x) => x[0] === 'grand_total')!;
    expect(grand.slice(4)).toEqual([r.grandTotal.pass, r.grandTotal.weightRejects, r.grandTotal.total, r.grandTotal.efficiencyPct]);
    expect(reportCsv('shift-production', r)).toEqual(t);
  });
});

/* ------------------------------------------------------- rejected cones */

const LIST = [
  { d: d('2026-09-01'), sc: 'morning', st: 3, w: 1100.5, ts: new Date('2026-09-01T07:00:00Z') },
  { d: d('2026-09-01'), sc: 'evening', st: 1, w: 2300, ts: new Date('2026-09-01T15:30:00Z') },
  { d: d('2026-09-02'), sc: 'night', st: null, w: 900, ts: new Date('2026-09-02T02:00:00Z') },
];
const RANGES = [
  { st: 1, n: 10, sm: 19500, mn: 1900, mx: 2000, bad: 1 },
  { st: 2, n: 30, sm: 58500, mn: 1920, mx: 1980, bad: 2 },
  { st: null, n: 0, sm: null, mn: null, mx: null, bad: 0 },
];
const rcAnswer = (sql: string) => (sql.includes('sms.reject_event') ? LIST : RANGES);

describe('rejected-cones: report', () => {
  it('lists weight rejects in the order the query returns them, with a total', async () => {
    const { pool, calls } = fakePool(rcAnswer);
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(r.total).toBe(3);
    expect(r.list.map((x) => [x.date, x.shift, x.winder, x.weightG])).toEqual([
      ['2026-09-01', 'morning', 3, 1100.5], ['2026-09-01', 'evening', 1, 2300], ['2026-09-02', 'night', null, 900],
    ]);
    const q = calls.find((c) => c.sql.includes('sms.reject_event'))!;
    expect(q.sql).toContain("reject_type = 'weight'");
    expect(q.sql).toContain('weight_g IS NOT NULL');
    expect(q.sql).toMatch(/ORDER BY production_ts_utc_ms/);
  });

  it('weightRange: per winder and line, over plausible cones only; implausible are counted', async () => {
    const { pool, calls } = fakePool(rcAnswer);
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const q = calls.find((c) => c.sql.includes('sms.cone_event'))!;
    // the plausibility window is bound and gates every aggregate
    expect(q.params.get('plausLo')).toBe(1500);
    expect(q.params.get('plausHi')).toBe(2100);
    expect(q.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    expect(r.weightRange.plausibility).toEqual({ loG: 1500, hiG: 2100 });
    expect(r.weightRange.excludedImplausible).toBe(3);
    expect(r.weightRange.byWinder).toEqual([
      { winder: 1, n: 10, minG: 1900, maxG: 2000, avgG: 1950 },
      { winder: 2, n: 30, minG: 1920, maxG: 1980, avgG: 1950 },
    ]);
    // line: n = 40, min of mins, max of maxes, weighted average
    expect(r.weightRange.line).toEqual({ n: 40, minG: 1900, maxG: 2000, avgG: 1950 });
  });

  it('no plausible cones: null range, not zeros', async () => {
    const { pool } = fakePool((sql) => (sql.includes('sms.reject_event') ? [] : [{ st: 4, n: 0, sm: null, mn: null, mx: null, bad: 2 }]));
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    expect(r.weightRange.line).toEqual({ n: 0, minG: null, maxG: null, avgG: null });
    expect(r.weightRange.byWinder[0]).toEqual({ winder: 4, n: 0, minG: null, maxG: null, avgG: null });
    expect(r.weightRange.excludedImplausible).toBe(2);
    expect(r.total).toBe(0);
  });

  it('shift and station filters and shiftRange are bound on both queries', async () => {
    const range: ShiftRange = { from: '2026-09-01', fromShift: 'morning', to: '2026-09-01', toShift: 'evening' };
    const { pool, calls } = fakePool(rcAnswer);
    await getRejectedConesReport(pool, 1, PERIOD, { shift: 'morning', station: 7 }, range);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.params.get('shift')).toBe('morning');
      expect(c.params.get('station')).toBe(7);
      expect(c.sql).toContain('source_station = @station');
      expect(c.params.get('srFromOrd')).toBe(1);
      expect(c.params.get('srToOrd')).toBe(2);
    }
  });

  it('CSV: list, total, ranges and excluded count', async () => {
    const { pool } = fakePool(rcAnswer);
    const r = await getRejectedConesReport(pool, 1, PERIOD, {});
    const t = rejectedConesCsv(r);
    expect(t.headers).toEqual(REJECTED_CONES_CSV_HEADERS);
    for (const row of t.rows) expect(row).toHaveLength(t.headers.length);
    const sections = t.rows.map((x) => x[0]);
    expect(sections.filter((s) => s === 'rejected_cone')).toHaveLength(3);
    expect(t.rows.find((x) => x[0] === 'total')![6]).toBe(3);
    expect(sections.filter((s) => s === 'weight_range_winder')).toHaveLength(2);
    expect(t.rows.find((x) => x[0] === 'excluded_implausible')![6]).toBe(3);
    expect(reportCsv('rejected-cones', r)).toEqual(t);
  });
});

/* ---------------------------------------------------- registration + notes */

describe('registration and disclosure', () => {
  it('both types are registered with titles, rank 1 and their filters', () => {
    expect(REPORT_TYPES).toContain('shift-production');
    expect(REPORT_TYPES).toContain('rejected-cones');
    expect(REPORT_TITLES['shift-production']).toBe('Shift Production Report');
    expect(REPORT_TITLES['rejected-cones']).toBe('Rejected Cones Report');
    expect(FILTERS_BY_TYPE['shift-production']).toEqual(['shift']);
    expect(FILTERS_BY_TYPE['rejected-cones']).toEqual(['shift', 'station']);
  });

  it('buildReport dispatches to the new builders', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await buildReport(pool, 1, 'shift-production', PERIOD, {});
    expect(r.grandTotal.pass).toBeGreaterThan(0);
  });

  it('the note says quality rejects are excluded', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.note).toMatch(/Quality \(inspection\) rejects are not part of this efficiency/);
  });

  it('a simulator source is disclosed on the header, in the CSV rows and the document', async () => {
    const { pool } = fakePool(spAnswer);
    for (const type of ['shift-production', 'rejected-cones'] as const) {
      const data = await buildReport(pool, 1, type, PERIOD, {});
      const sim = {
        ...data,
        generationNote: {
          generation: { key: 'DATA_TP1U2_SIM#1', sourceDb: 'DATA_TP1U2_SIM', ordinal: 1, label: 'pack1_TP1U2 gen 1', simulator: true },
          spansGenerations: true,
          otherGenerationExcluded: 120,
          excludedSimulator: 0,
        },
      };
      const header = await buildHeader(pool, 1, {
        reportType: type, period: PERIOD, filters: {}, user: { username: 'u', displayName: 'U' }, lineNameFallback: 'Line 3', reportData: sim,
      });
      expect(header.simulatorSource).toBe(true);
      expect(header.spansGenerations).toBe(true);
      expect(header.generationLine).toMatch(/plant simulator/i);
      const rows = attributionRows(header).map((r) => r[0]).join('\n');
      expect(rows).toMatch(/Data batch:/);
      expect(rows).toMatch(/Excluded from another data batch: 120 readings/);
      expect(csvDocument(['a'], [[1]], header)).toMatch(/Data batch:/);
      expect(header.title).toBe(REPORT_TITLES[type]);
    }
  });
});
