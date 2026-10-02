/**
 * Task W1 (30 Sep 2026): the IFL-SSRS-styled 'shift-production' report; split
 * out of iflStyledReports.test.ts on 1 Oct 2026 (task W0) so each IFL report
 * has a test file of its own that exactly one worker edits. The pool is a
 * recording fake that answers by query shape; a fake cannot execute a WHERE, so
 * filters are proven by the SQL text and the parameters bound on it, and
 * arithmetic/ordering by the rows it returns. (shiftProduction.dataset.test.ts
 * holds the other kind: a fake that evaluates the SQL's filters over a real
 * dataset, which is what proves the D1 counting and the generation scoping.)
 *
 * W0 additions: the title in IFL's own words, the frozen contract fields and
 * the final CSV headers. A-R1 (1 Oct 2026): the D1 counting (each physical cone
 * counted once), day and winder totals, weighed kg and its basis, the loop line
 * and the scale-bit count.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../admin.js', () => ({ getPlausibilityRule: vi.fn(async () => ({ coneLoG: 1500, coneHiG: 2100 })) }));
vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn(async () => ({ displayName: 'Line 3', plant: { name: 'IFL' }, unit: { name: 'Unit 2' } })) }));

import {
  getShiftProductionReport, shiftProductionCsv, shiftProductionCaveats, kgBasisOf, figures,
  SHIFT_PRODUCTION_CSV_HEADERS, SHIFT_PRODUCTION_PENDING_IFL, type ShiftProductionReportData,
} from './shiftProduction.js';
import { REPORT_TYPES, REPORT_TITLES, REPORT_RANK, FILTERS_BY_TYPE } from './common.js';
import { buildReport, reportCsv } from './index.js';
import { buildHeader } from './header.js';
import { attributionRows, csvDocument } from './csv.js';
import type { ShiftRange } from '../../shiftRange.js';

interface Call { sql: string; params: Map<string, unknown> }

/**
 * Records every report query (not the epoch registry's, not the rule tables')
 * and, like the real mssql Request, REFUSES a parameter declared twice
 * (EDUPEPARAM) — the matched-cones query reuses one clause on two aliases, and
 * a double bind would be a runtime error the fake must not hide.
 */
function fakePool(answer: (sql: string) => Record<string, unknown>[]): { pool: ConnectionPool; calls: Call[] } {
  const calls: Call[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (n: string, _t: unknown, v: unknown) => {
          if (params.has(n)) throw new Error(`The parameter name ${n} has already been declared. Parameter names must be unique`);
          params.set(n, v);
          return req;
        },
        query: async (sql: string) => {
          if (sql.includes('GROUP BY source_epoch') || sql.includes('FROM sms.source_epoch')) return { recordset: [], rowsAffected: [0] };
          if (sql.includes('FROM sms.plausibility_rule') || sql.includes('FROM sms.weight_rule')) return { recordset: answer(sql), rowsAffected: [0] };
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

/** A cone cell: `n` cones, `pn` of them with a plausible weight of 1,950 g each, `sr` marked out of range by the scale. */
const cone = (day: string, sc: string, st: number | null, n: number, extra: { pn?: number; sr?: number } = {}) => {
  const pn = extra.pn ?? n;
  return { d: d(day), sc, st, n, pn, g: pn * 1950, sr: extra.sr ?? 0 };
};

// Deliberately unordered, to prove the report sorts.
const CONES = [
  cone('2026-09-02', 'morning', 1, 50, { sr: 1 }),
  cone('2026-09-01', 'night', 2, 30),
  cone('2026-09-01', 'morning', 2, 60),
  cone('2026-09-01', 'morning', 1, 40, { sr: 3 }),
  cone('2026-09-01', 'evening', 1, 20, { pn: 19 }),
  cone('2026-09-01', 'morning', null, 5),
];
const REJECTS = [
  { d: d('2026-09-01'), sc: 'morning', st: 1, n: 10 },
  { d: d('2026-09-01'), sc: 'night', st: 2, n: 3 },
  { d: d('2026-09-02'), sc: 'morning', st: 1, n: 2 },
];
// Of the weight rejects, these are ALSO cone rows (counted once, as rejects): the other 10 − 4 and 3 − 1 have no cone row.
const MATCHED = [
  { d: d('2026-09-01'), sc: 'morning', st: 1, n: 4 },
  { d: d('2026-09-01'), sc: 'night', st: 2, n: 1 },
];
const HANGERS = 296;

const isRuleSql = (sql: string) => sql.includes('FROM sms.plausibility_rule') || sql.includes('FROM sms.weight_rule');
const spAnswer = (sql: string) => {
  if (isRuleSql(sql)) return [];
  if (sql.includes('JOIN sms.cone_event')) return MATCHED;
  if (sql.includes('COUNT(DISTINCT hanger_num)')) return [{ h: HANGERS }];
  if (sql.includes('FROM sms.reject_event')) return REJECTS;
  return CONES;
};
const isMatchedSql = (c: Call) => c.sql.includes('JOIN sms.cone_event');
const isHangerSql = (c: Call) => c.sql.includes('COUNT(DISTINCT hanger_num)');
const isRejectSql = (c: Call) => c.sql.includes('FROM sms.reject_event') && !isMatchedSql(c);
const isConeSql = (c: Call) => c.sql.includes('FROM sms.cone_event') && !isMatchedSql(c) && !isHangerSql(c);

describe('shift-production: figures', () => {
  it('efficiency = pass/total x 100, rounded to 2 dp', () => {
    expect(figures(2, 1).efficiencyPct).toBe(66.67);
    expect(figures(1, 2).efficiencyPct).toBe(33.33);
    expect(figures(90, 10)).toEqual({ weighed: 90, pass: 90, weightRejects: 10, total: 100, efficiencyPct: 90, weighedKg: null });
    expect(figures(200, 1).efficiencyPct).toBe(99.5);
  });
  it('is null when the total is 0', () => {
    expect(figures(0, 0)).toEqual({ weighed: 0, pass: 0, weightRejects: 0, total: 0, efficiencyPct: null, weighedKg: null });
  });
  it('0 pass with rejects is 0, not null', () => {
    expect(figures(0, 4).efficiencyPct).toBe(0);
  });
  it('carries weighed and weighedKg beside pass: explicit values win over the defaults', () => {
    expect(figures(98, 2, 100, 196.4)).toEqual({ weighed: 100, pass: 98, weightRejects: 2, total: 100, efficiencyPct: 98, weighedKg: 196.4 });
  });
  it('the Sept-15 and Jul-03 live figures round to IFL\'s two decimals (99.98 / 99.99), never up to 100', () => {
    expect(figures(4854, 1).efficiencyPct).toBe(99.98);
    expect(figures(7922, 1).efficiencyPct).toBe(99.99);
  });
});

describe('shift-production: report', () => {
  it('each cone is counted once: pass = weighed minus the cones that carry a weight-reject record', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    const row = (date: string, shift: string, winder: number) => r.rows.find((x) => x.date === date && x.shift === shift && x.winder === winder)!;
    // morning winder 1 on the 1st: 40 cones weighed, 4 of them are the same cones as 4 of the 10 weight rejects
    expect(row('2026-09-01', 'morning', 1)).toMatchObject({ weighed: 40, pass: 36, weightRejects: 10, total: 46, efficiencyPct: 78.26 });
    // the 6 weight rejects with no cone row are rejects only: total = weighed + unmatched rejects
    expect(row('2026-09-01', 'night', 2)).toMatchObject({ weighed: 30, pass: 29, weightRejects: 3, total: 32 });
    // a cell with nothing matched keeps pass = weighed
    expect(row('2026-09-01', 'morning', 2)).toMatchObject({ weighed: 60, pass: 60, weightRejects: 0, total: 60, efficiencyPct: 100 });
  });

  it('totals equal the sums, at every level (summary, shift, day, winder, grand)', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    const weighed = CONES.reduce((a, c) => a + c.n, 0);
    const rej = REJECTS.reduce((a, c) => a + c.n, 0);
    const matched = MATCHED.reduce((a, c) => a + c.n, 0);
    expect(weighed).toBe(205);
    expect(r.grandTotal).toMatchObject({ weighed, pass: weighed - matched, weightRejects: rej, total: weighed - matched + rej });
    // total = cones weighed + the weight rejects that are NOT also a cone row
    expect(r.grandTotal.total).toBe(weighed + (rej - matched));
    const sum = (xs: { weighed: number; pass: number; weightRejects: number; total: number }[]) => ({
      weighed: xs.reduce((a, x) => a + x.weighed, 0), pass: xs.reduce((a, x) => a + x.pass, 0),
      weightRejects: xs.reduce((a, x) => a + x.weightRejects, 0), total: xs.reduce((a, x) => a + x.total, 0),
    });
    const g = r.grandTotal;
    for (const level of [r.summary, r.shiftTotals, r.dayTotals]) expect(sum(level)).toEqual({ weighed: g.weighed, pass: g.pass, weightRejects: g.weightRejects, total: g.total });
    // rows + winder totals exclude the winder-less cones, which are disclosed instead
    expect(r.withoutWinder).toEqual({ pass: 5, weightRejects: 0 });
    expect(sum(r.rows).pass + r.withoutWinder.pass).toBe(g.pass);
    expect(sum(r.winderTotals).pass + r.withoutWinder.pass).toBe(g.pass);
    expect(sum(r.rows).weightRejects + r.withoutWinder.weightRejects).toBe(g.weightRejects);
    for (const row of [...r.rows, ...r.shiftTotals, ...r.dayTotals, ...r.winderTotals, ...r.summary]) expect(row.total).toBe(row.pass + row.weightRejects);
  });

  it('per-shift summary matches by hand', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    // morning: weighed 50+60+40+5 = 155, matched 4 -> pass 151; rejects 10+2 = 12
    expect(r.summary.map((s) => s.shift)).toEqual(['morning', 'evening', 'night']);
    expect(r.summary[0]).toMatchObject({ shift: 'morning', weighed: 155, pass: 151, weightRejects: 12, total: 163 });
    expect(r.summary[1]).toMatchObject({ shift: 'evening', weighed: 20, pass: 20, weightRejects: 0, total: 20, efficiencyPct: 100 });
    expect(r.summary[2]).toMatchObject({ shift: 'night', weighed: 30, pass: 29, weightRejects: 3, total: 32 });
  });

  it('day totals add every shift and winder of a production date; winder totals add every day and shift of a winder', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.dayTotals.map((x) => x.date)).toEqual(['2026-09-01', '2026-09-02']);
    // 1 Sep: weighed 40+60+5+20+30 = 155, matched 5 -> pass 150, rejects 13
    expect(r.dayTotals[0]).toMatchObject({ weighed: 155, pass: 150, weightRejects: 13, total: 163 });
    expect(r.dayTotals[1]).toMatchObject({ weighed: 50, pass: 50, weightRejects: 2, total: 52, efficiencyPct: 96.15 });
    expect(r.winderTotals.map((x) => x.winder)).toEqual([1, 2]);
    // winder 1: weighed 40+20+50 = 110, matched 4 -> pass 106, rejects 12
    expect(r.winderTotals[0]).toMatchObject({ winder: 1, weighed: 110, pass: 106, weightRejects: 12, total: 118 });
    expect(r.winderTotals[1]).toMatchObject({ winder: 2, weighed: 90, pass: 89, weightRejects: 3, total: 92 });
  });

  it('weighed kg is the sum of plausible cone weights at every level, null (not 0) where none was plausible', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    const row = (date: string, shift: string, winder: number) => r.rows.find((x) => x.date === date && x.shift === shift && x.winder === winder)!;
    expect(row('2026-09-01', 'morning', 1).weighedKg).toBe(78); // 40 x 1,950 g
    expect(row('2026-09-01', 'evening', 1).weighedKg).toBe(37.05); // only the 19 plausible cones
    // 204 plausible cones in all (one evening cone is implausible)
    expect(r.grandTotal.weighedKg).toBe(397.8);
    expect(r.dayTotals[0]!.weighedKg).toBe(300.3); // 1 Sep: 155 cones, 1 implausible -> 154 x 1.95
    expect(r.winderTotals[0]!.weighedKg).toBe(212.55); // winder 1: 40 + 19 + 50 plausible = 109 x 1.95
    const empty = await getShiftProductionReport(fakePool(() => []).pool, 1, PERIOD, {});
    expect(empty.grandTotal.weighedKg).toBeNull();
  });

  it('the kg basis is stated, with how many cones the plausibility window left out', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.kgBasis).toEqual({ basis: 'as_recorded', label: 'as the scale recorded them', implausible: 1 });
  });

  it('scaleRejectedCones is the scale\'s own bit, separate from the weight-reject records', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.scaleRejectedCones).toBe(4); // 3 + 1 in the data above
    expect(r.grandTotal.weightRejects).toBe(15);
  });

  it('the loop line carries the hangers the period saw, computed from the data', async () => {
    const { pool, calls } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.loop).toEqual({ hangersSeen: HANGERS });
    const h = calls.find(isHangerSql)!;
    expect(h.sql).toContain('hanger_num > 0');
    expect(h.sql).toContain('FROM sms.cone_event');
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

  it('counts weight rejects only, with or without a weight: the reject query is weight-typed and not weight-gated', async () => {
    const { pool, calls } = fakePool(spAnswer);
    await getShiftProductionReport(pool, 1, PERIOD, {});
    const rej = calls.find(isRejectSql)!;
    expect(rej.sql).toContain("reject_type = 'weight'");
    // a weight reject whose weight was not recorded is still a rejected cone (D1)
    expect(rej.sql).not.toContain('weight_g IS NOT NULL');
    const cone = calls.find(isConeSql)!;
    expect(cone.sql).not.toContain('reject_type');
  });

  it('the matched-cones query joins each weight reject to its cone on the app\'s one merge predicate and counts each cone once', async () => {
    const { pool, calls } = fakePool(spAnswer);
    await getShiftProductionReport(pool, 1, PERIOD, {});
    const m = calls.find(isMatchedSql)!;
    expect(m.sql).toContain('ce.production_ts_utc_ms = re.production_ts_utc_ms');
    expect(m.sql).toContain('ISNULL(ce.hanger_num, -1) = ISNULL(re.hanger_num, -1)');
    expect(m.sql).toContain('COUNT(DISTINCT ce.cone_event_id)');
    expect(m.sql).toContain("re.reject_type = 'weight'");
    // grouped by the CONE's own cell, so pass(cell) = weighed(cell) - matched(cell)
    expect(m.sql).toContain('GROUP BY ce.shift_date, ce.shift_code, ce.source_station');
  });

  it('a pass count can never go below zero, even if a cell reports more matched cones than weighed', async () => {
    const over = [{ d: d('2026-09-01'), sc: 'morning', st: 1, n: 9 }];
    const { pool } = fakePool((sql) => (isRuleSql(sql) ? [] : sql.includes('JOIN sms.cone_event') ? over : sql.includes('COUNT(DISTINCT hanger_num)') ? [{ h: 1 }] : sql.includes('FROM sms.reject_event') ? [{ d: d('2026-09-01'), sc: 'morning', st: 1, n: 9 }] : [cone('2026-09-01', 'morning', 1, 5)]));
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.rows[0]).toMatchObject({ weighed: 5, pass: 0, weightRejects: 9, total: 9, efficiencyPct: 0 });
  });

  it('a row with pass only and none with rejects still gets an efficiency; a cell with no readings is absent', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.rows.find((x) => x.shift === 'evening')!.efficiencyPct).toBe(100);
    expect(r.rows.find((x) => x.date === '2026-09-02' && x.winder === 2)).toBeUndefined();
  });

  it('empty period: no rows, null efficiency, no kg, no loop', async () => {
    const { pool } = fakePool(() => []);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.rows).toEqual([]);
    expect(r.summary).toEqual([]);
    expect(r.dayTotals).toEqual([]);
    expect(r.winderTotals).toEqual([]);
    expect(r.grandTotal.efficiencyPct).toBeNull();
    expect(r.grandTotal.weighedKg).toBeNull();
    expect(r.loop).toEqual({ hangersSeen: 0 });
    expect(r.scaleRejectedCones).toBe(0);
  });

  it('the shift filter is bound on every table; shiftRange narrows each with its own params, declared once', async () => {
    const range: ShiftRange = { from: '2026-09-01', fromShift: 'evening', to: '2026-09-02', toShift: 'morning' };
    const { pool, calls } = fakePool(spAnswer);
    await getShiftProductionReport(pool, 1, PERIOD, { shift: 'night' }, range);
    // cones, weight rejects, matched cones, hangers
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.sql).toContain('shift_code = @shift');
      expect(c.params.get('shift')).toBe('night');
      expect(c.sql).toContain('@srFrom');
      expect(c.params.get('srFrom')).toBe('2026-09-01');
      expect(c.params.get('srFromOrd')).toBe(2);
      expect(c.params.get('srTo')).toBe('2026-09-02');
      expect(c.params.get('srToOrd')).toBe(1);
    }
    // both sides of the join carry the filter, on their own aliases
    const m = calls.find(isMatchedSql)!;
    expect(m.sql).toContain('re.shift_code = @shift');
    expect(m.sql).toContain('ce.shift_code = @shift');
    const plain = fakePool(spAnswer);
    await getShiftProductionReport(plain.pool, 1, PERIOD, {});
    for (const c of plain.calls) {
      expect(c.sql).not.toContain('@srFrom');
      expect(c.sql).not.toContain('@shift');
    }
  });

  it('CSV: one table, section column, every level present, filename/attribution carry through', async () => {
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
    expect(sections.filter((s) => s === 'day_total')).toHaveLength(2);
    expect(sections.filter((s) => s === 'winder_total')).toHaveLength(2);
    const col = (name: string) => t.headers.indexOf(name);
    const grand = t.rows.find((x) => x[0] === 'grand_total')!;
    expect(
      ['weighed', 'pass', 'weight_rejects', 'total', 'efficiency_pct', 'weighed_kg'].map((n) => grand[col(n)]),
    ).toEqual([r.grandTotal.weighed, r.grandTotal.pass, r.grandTotal.weightRejects, r.grandTotal.total, r.grandTotal.efficiencyPct, 397.8]);
    expect(reportCsv('shift-production', r)).toEqual(t);
  });
});

/* ------------------------------------------- the weight basis, as of the period end */

describe('shift-production: weighed kg basis (weight rule as of the period end)', () => {
  const NET = [{ basis: 'net', tube: 70, tare: 0.5, effective_from: new Date('2026-01-01T00:00:00Z') }];
  const withRule = (rows: Record<string, unknown>[], plaus: Record<string, unknown>[] = []) =>
    fakePool((sql) => (sql.includes('FROM sms.weight_rule') ? rows : sql.includes('FROM sms.plausibility_rule') ? plaus : spAnswer(sql)));

  it('a NET basis subtracts the cone tube from each weight in SQL (@coneAdj) and says so', async () => {
    const { pool, calls } = withRule(NET);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(calls.find(isConeSql)!.params.get('coneAdj')).toBe(70);
    expect(r.kgBasis).toMatchObject({ basis: 'net', label: 'net of the 70 g cone tube set in Setup' });
  });

  it('as_recorded and gross subtract nothing; with no rule on file the readings are used as recorded', async () => {
    for (const rows of [[{ ...NET[0], basis: 'gross' }], [{ ...NET[0], basis: 'as_recorded' }], []]) {
      const { pool, calls } = withRule(rows);
      await getShiftProductionReport(pool, 1, PERIOD, {});
      expect(calls.find(isConeSql)!.params.get('coneAdj')).toBe(0);
    }
    expect(kgBasisOf({ basis: 'gross', coneTubeWeightG: 70, sackTareKg: 0.5 })).toEqual({ basis: 'gross', label: 'gross, as the scale recorded them', tubeG: 0 });
    expect(kgBasisOf(null).basis).toBe('as_recorded');
  });

  it('a net rule with no tube weight falls back to the 70 g weights.ts uses', () => {
    expect(kgBasisOf({ basis: 'net', coneTubeWeightG: null, sackTareKg: null })).toMatchObject({ basis: 'net', tubeG: 70 });
  });

  it('the plausibility window in force at the period end bounds the weights (bound, not interpolated)', async () => {
    const { pool, calls } = withRule([], [{ cl: 1600, ch: 2000, sl: 40, sh: 60, effective_from: new Date('2026-01-01T00:00:00Z') }]);
    await getShiftProductionReport(pool, 1, PERIOD, {});
    const c = calls.find(isConeSql)!;
    expect(c.params.get('plausLo')).toBe(1600);
    expect(c.params.get('plausHi')).toBe(2000);
    expect(c.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
  });

  it('a rule changed during the period is disclosed in the note; one that predates it is not', async () => {
    const during = await getShiftProductionReport(withRule([{ ...NET[0], effective_from: new Date('2026-09-01T12:00:00Z') }, { basis: 'as_recorded', tube: 70, tare: 0.5, effective_from: new Date('2026-01-01T00:00:00Z') }]).pool, 1, PERIOD, {});
    expect(during.note).toMatch(/changed during this period/);
    const before = await getShiftProductionReport(withRule(NET).pool, 1, PERIOD, {});
    expect(before.note).not.toMatch(/changed during this period/);
  });
});

/* -------------------------------------------- the sentences, in plain strings */

describe('shift-production: the computed sentences', () => {
  const base = {
    loop: { hangersSeen: 296 },
    scaleRejectedCones: 49,
    grandTotal: { ...figures(100, 41), weighedKg: 1 },
    kgBasis: { basis: 'net' as const, label: 'net of the 70 g cone tube set in Setup', implausible: 4 },
  };

  it('says how many hanger numbers were seen (computed), that the scale bit and the reject records are separate, and the kg basis', () => {
    expect(shiftProductionCaveats(base)).toEqual([
      'CTS loop: the line’s one hanger loop — 296 hanger numbers seen in this period.',
      'The scale’s own in-range bit marked 49 cones; the weight-reject records hold 41; they are separate records and are not merged.',
      'Weighed kg is the sum of the plausible cone weights, net of the 70 g cone tube set in Setup. 4 readings outside the plausibility window are not in it.',
    ]);
  });

  it('singulars read as English, and a missing kg basis leaves the third line out', () => {
    const one = shiftProductionCaveats({ ...base, loop: { hangersSeen: 1 }, scaleRejectedCones: 1, kgBasis: { ...base.kgBasis, implausible: 1 } });
    expect(one[0]).toMatch(/1 hanger number seen/);
    expect(one[1]).toMatch(/marked 1 cone;/);
    expect(one[2]).toMatch(/1 reading outside the plausibility window is not in it/);
    expect(shiftProductionCaveats({ ...base, kgBasis: null })).toHaveLength(2);
  });
});

/* -------------------------------------------- W0: the frozen contract */

describe('shift-production: the frozen contract (task W0, 1 Oct 2026)', () => {
  it('the CSV headers are exactly IFL report 1\'s final headers', () => {
    expect([...SHIFT_PRODUCTION_CSV_HEADERS]).toEqual([
      'section', 'date', 'shift', 'winder', 'weighed', 'pass', 'weight_rejects', 'total', 'efficiency_pct', 'weighed_kg',
    ]);
  });

  it('the report carries every contract field, filled, and says what it assumes', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.dayTotals.length).toBeGreaterThan(0);
    expect(r.winderTotals.length).toBeGreaterThan(0);
    expect(r.loop.hangersSeen).toBeGreaterThan(0);
    expect(r.kgBasis).not.toBeNull();
    expect(r.pendingIfl).toEqual([...SHIFT_PRODUCTION_PENDING_IFL]);
    expect(r.pendingIfl.length).toBeGreaterThan(0);
    for (const line of r.pendingIfl) expect(typeof line).toBe('string');
    expect(r.generationNote).toBeDefined();
    for (const row of r.rows) expect(row.weighed).toBeGreaterThanOrEqual(row.pass);
  });

  it('every default IFL has not confirmed is a printed line: the loop, the counting of a cone in both records, the scale bit, and the kg basis', () => {
    const text = SHIFT_PRODUCTION_PENDING_IFL.join('\n');
    expect(text).toMatch(/CTS loop/);
    expect(text).toMatch(/counted once/);
    expect(text).toMatch(/in-range bit/);
    expect(text).toMatch(/gross or net/);
    // the hanger count is never hard-coded into an assumption line
    expect(text).not.toMatch(/299/);
  });

  it('serialises day_total and winder_total rows, padded to the header width, weighed_kg included', () => {
    const f = (pass: number, rej: number, kg: number | null) => ({ ...figures(pass, rej), weighedKg: kg });
    const data = {
      summary: [], grandTotal: f(10, 1, 21.5), rows: [], shiftTotals: [],
      dayTotals: [{ date: '2026-09-01', ...f(6, 1, 12.5) }],
      winderTotals: [{ winder: 7, ...f(4, 0, 9) }],
    } as unknown as ShiftProductionReportData;
    const t = shiftProductionCsv(data);
    for (const row of t.rows) expect(row).toHaveLength(t.headers.length);
    const col = (name: string) => t.headers.indexOf(name);
    const day = t.rows.find((x) => x[0] === 'day_total')!;
    expect([day[col('date')], day[col('shift')], day[col('winder')], day[col('weighed_kg')], day[col('total')]]).toEqual(['2026-09-01', null, null, 12.5, 7]);
    const winder = t.rows.find((x) => x[0] === 'winder_total')!;
    expect([winder[col('date')], winder[col('winder')], winder[col('weighed_kg')]]).toEqual([null, 7, 9]);
  });
});

/* ---------------------------------------------------- registration + notes */

describe('shift-production: registration and disclosure', () => {
  it('is registered in IFL\'s own words, at rank 1 with the shift filter, among 18 types with the IFL pair before the new six', () => {
    expect(REPORT_TYPES).toContain('shift-production');
    expect(REPORT_TITLES['shift-production']).toBe('Shift-wise CTS Loop Production Report');
    expect(REPORT_RANK['shift-production']).toBe(1);
    expect(FILTERS_BY_TYPE['shift-production']).toEqual(['shift']);
    expect(REPORT_TYPES).toHaveLength(18);
    expect(REPORT_TYPES.indexOf('shift-production')).toBe(10);
  });

  it('buildReport dispatches to the builder', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await buildReport(pool, 1, 'shift-production', PERIOD, {});
    expect(r.grandTotal.pass).toBeGreaterThan(0);
  });

  it('the note says quality rejects are excluded, that each cone is counted once and what total means', async () => {
    const { pool } = fakePool(spAnswer);
    const r = await getShiftProductionReport(pool, 1, PERIOD, {});
    expect(r.note).toMatch(/Quality \(inspection\) rejects are not part of this efficiency/);
    expect(r.note).toMatch(/Each cone is counted once/);
    expect(r.note).toMatch(/total is pass plus weight rejects/);
  });

  it('a simulator source is disclosed on the header, in the CSV rows and the document', async () => {
    const { pool } = fakePool(spAnswer);
    const type = 'shift-production' as const;
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
  });
});
