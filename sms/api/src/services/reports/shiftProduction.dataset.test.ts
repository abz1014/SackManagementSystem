/**
 * IFL report 1, Shift-wise CTS Loop Production Report — D1 (1 Oct 2026): a
 * weight-rejected cone is ALSO a cone row, and must be counted once.
 *
 * shiftProduction.ifl.test.ts answers each query with canned rows, so it can
 * prove arithmetic and SQL text but not that the SQL COUNTS the right cones.
 * This file is the other idiom (production.unmatchedScope.test.ts,
 * weightStations.generations.test.ts): a pool that EVALUATES each query's
 * filters over a small in-memory dataset — line, period, shift filter, the
 * generation's epoch ids exactly as the SQL binds them (`ger*` on rejects,
 * `gec*` on cones), the merge key a reject is matched to its cone on — so what
 * it returns is what the SQL would have counted.
 *
 * The dataset is real-shaped on purpose: the real plant logs EVERY weight
 * reject as a cone row too (244/245 July, 31/31 September, same production
 * instant and hanger); the plant simulator writes them disjointly, which is
 * exactly what hid the double count on the dev copy. Both generations are here.
 *
 * Without the D1 fix the day below printed pass 10, rejects 2, total 12 (every
 * cone row as a pass, then the weight rejects added on top of them).
 */
import { describe, it, expect } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getShiftProductionReport } from './shiftProduction.js';

type Shift = 'morning' | 'evening' | 'night';
const LINE = 1;

interface Cone {
  cone_event_id: number; line_id: number; shift_date: string; shift_code: Shift; production_ts_utc_ms: number;
  source_epoch: number; source_station: number | null; hanger_num: number | null; weight_g: number | null; in_range: boolean | null;
}
interface Rej {
  line_id: number; shift_date: string; shift_code: Shift; production_ts_utc_ms: number; source_epoch: number;
  source_station: number | null; hanger_num: number | null; reject_type: 'weight' | 'quality'; weight_g: number | null;
}

// September copy (generation 3, real): cones 9, quality rejects 11, weight rejects 12.
// Plant simulator (generation 4): cones 13, quality 15, weight 16.
const REGISTRY = [
  { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - cones' },
  { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - quality rejects' },
  { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: 'September copy - weight rejects' },
  { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'pack1_TP1U2 gen 4' },
  { epoch_id: 15, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'rejectQCS1_TP1U2 gen 4' },
  { epoch_id: 16, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'ifl_copy', label: 'rejectWeight1_TP1U2 gen 4' },
];
const REAL_CONE = 9, REAL_QUALITY = 11, REAL_WEIGHT = 12, SIM_CONE = 13, SIM_WEIGHT = 16;

const ms = (iso: string) => new Date(iso).getTime();

let nextId = 1;
const cone = (day: string, shift: Shift, ts: string, hanger: number | null, station: number | null, weight: number | null, inRange: boolean | null, epoch = REAL_CONE): Cone => ({
  cone_event_id: nextId++, line_id: LINE, shift_date: day, shift_code: shift, production_ts_utc_ms: ms(ts),
  source_epoch: epoch, source_station: station, hanger_num: hanger, weight_g: weight, in_range: inRange,
});
const rej = (day: string, shift: Shift, ts: string, hanger: number | null, station: number | null, type: 'weight' | 'quality', weight: number | null, epoch: number): Rej => ({
  line_id: LINE, shift_date: day, shift_code: shift, production_ts_utc_ms: ms(ts), source_epoch: epoch,
  source_station: station, hanger_num: hanger, reject_type: type, weight_g: weight,
});

/* ---- 2026-09-10 (morning, winder 1): the brief's day.
 * 10 real cones (hangers 1..10); cone 3 is the one the scale rejected on weight (2,032 g). Weight rejects:
 * one on cone 3 (the same cone logged twice), one with no cone row at all. One QUALITY reject on cone 5 (not in
 * this efficiency). One simulator-generation weight reject sharing cone 7's production instant and hanger (must
 * not match, must not count). */
const D10 = '2026-09-10';
const minute = (m: number) => `2026-09-10T06:${String(m).padStart(2, '0')}:00Z`;
const CONES: Cone[] = Array.from({ length: 10 }, (_, i) =>
  cone(D10, 'morning', minute(10 + i), i + 1, 1, i === 2 ? 2032 : 1950, i !== 2),
);
const REJECTS: Rej[] = [
  rej(D10, 'morning', minute(12), 3, 1, 'weight', 2032, REAL_WEIGHT), // the same cone as CONES[2]
  rej(D10, 'morning', '2026-09-10T07:30:00Z', 250, 1, 'weight', 2040, REAL_WEIGHT), // no cone row
  rej(D10, 'morning', minute(14), 5, 1, 'quality', null, REAL_QUALITY), // quality: never part of this efficiency
  rej(D10, 'morning', minute(16), 7, 1, 'weight', 1500, SIM_WEIGHT), // simulator generation: out of scope
];
// simulator cones on the same day, same winder: out of scope
CONES.push(...Array.from({ length: 5 }, (_, i) => cone(D10, 'morning', minute(40 + i), 100 + i, 1, 1960, true, SIM_CONE)));

/* ---- 2026-09-11: the cross-generation trap. 4 real cones (hangers 1..4). A REAL weight reject whose
 * production instant and hanger equal a SIMULATOR cone's (same date, shift, winder) and no real cone's: it is a
 * reject with no cone row. A cone side that ignored the generation would "match" it to the simulator cone and
 * take a pass away from the real count. */
const D11 = '2026-09-11';
const m11 = (m: number) => `2026-09-11T06:${String(m).padStart(2, '0')}:00Z`;
CONES.push(...Array.from({ length: 4 }, (_, i) => cone(D11, 'morning', m11(10 + i), i + 1, 1, 1950, true)));
CONES.push(cone(D11, 'morning', m11(50), 50, 1, 1955, true, SIM_CONE));
REJECTS.push(rej(D11, 'morning', m11(50), 50, 1, 'weight', 2040, REAL_WEIGHT));

/* ---- 2026-09-12: several shifts and winders, a winder-less cone, a reject with no weight recorded,
 * and one scale-fault weight (2,354 g, outside the 1,500-2,100 g window). */
const D12 = '2026-09-12';
const m12 = (h: number, m: number) => `2026-09-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
CONES.push(
  cone(D12, 'morning', m12(6, 5), 11, 1, 1950, true),
  cone(D12, 'morning', m12(6, 6), 12, 1, 2040, false), // weight-rejected too (below)
  cone(D12, 'morning', m12(6, 7), 13, 2, 1950, true),
  cone(D12, 'morning', m12(6, 8), 14, null, 1950, true), // no winder recorded
  cone(D12, 'evening', m12(14, 5), 15, 1, 1950, true),
  cone(D12, 'evening', m12(14, 6), 16, 1, 2030, false), // weight-rejected too (below)
  cone(D12, 'night', m12(22, 5), 17, 3, 2354, false), // scale fault: implausible weight
  cone(D12, 'night', m12(22, 6), 17, 3, 1950, true),
);
REJECTS.push(
  rej(D12, 'morning', m12(6, 6), 12, 1, 'weight', 2040, REAL_WEIGHT),
  rej(D12, 'evening', m12(14, 6), 16, 1, 'weight', 2030, REAL_WEIGHT),
  rej(D12, 'night', m12(22, 30), 18, 3, 'weight', null, REAL_WEIGHT), // no cone row, and no weight recorded
);

interface Rules { plaus: Record<string, unknown>[]; weight: Record<string, unknown>[] }

function evaluate(sql: string, p: Map<string, unknown>, rules: Rules): Record<string, unknown>[] {
  if (sql.includes('FROM sms.source_epoch')) return REGISTRY;
  if (sql.includes('FROM sms.plausibility_rule')) return rules.plaus;
  if (sql.includes('FROM sms.weight_rule')) return rules.weight;

  if (sql.includes('GROUP BY source_epoch')) {
    const rows: Record<string, unknown>[] = [];
    const inWindow = (r: { line_id: number; shift_date: string }) =>
      r.line_id === p.get('line') && (!p.has('genFrom') || r.shift_date >= String(p.get('genFrom'))) && (!p.has('genTo') || r.shift_date <= String(p.get('genTo')));
    const byEpoch = (table: { source_epoch: number; line_id: number; shift_date: string }[], tbl: string) => {
      const m = new Map<number, number>();
      for (const r of table.filter(inWindow)) m.set(r.source_epoch, (m.get(r.source_epoch) ?? 0) + 1);
      for (const [epoch_id, n] of m) rows.push({ tbl, epoch_id, n });
    };
    if (sql.includes('FROM sms.cone_event')) byEpoch(CONES, 'cone_event');
    if (sql.includes('FROM sms.reject_event')) byEpoch(REJECTS, 'reject_event');
    return rows;
  }

  // The generation, exactly as the SQL USES it: only the epoch parameters the query TEXT names count
  // (`@ger0..` on reject_event, `@gec0..` on cone_event). A parameter bound but never referenced filters nothing.
  const idsOf = (letter: 'c' | 'r') =>
    [...sql.matchAll(new RegExp(`@(ge${letter}\\d+)`, 'g'))].map((m) => Number(p.get(m[1]!)));
  const coneIds = idsOf('c');
  const rejIds = idsOf('r');
  const base = (r: { line_id: number; shift_date: string; shift_code: string }) =>
    r.line_id === p.get('line') && r.shift_date >= String(p.get('from')) && r.shift_date <= String(p.get('to')) &&
    (!p.has('shift') || r.shift_code === p.get('shift'));
  const coneOk = (c: Cone) => base(c) && (coneIds.length === 0 || coneIds.includes(c.source_epoch));
  const rejOk = (r: Rej) => base(r) && r.reject_type === 'weight' && (rejIds.length === 0 || rejIds.includes(r.source_epoch));
  const sameKey = (c: Cone, r: Rej) => c.line_id === r.line_id && c.production_ts_utc_ms === r.production_ts_utc_ms && (c.hanger_num ?? -1) === (r.hanger_num ?? -1);

  const cell = (r: { shift_date: string; shift_code: string; source_station: number | null }) => `${r.shift_date}|${r.shift_code}|${r.source_station ?? ''}`;
  const group = <T extends { shift_date: string; shift_code: string; source_station: number | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(cell(r), [...(m.get(cell(r)) ?? []), r]);
    return [...m.values()];
  };
  const head = (r: { shift_date: string; shift_code: string; source_station: number | null }) => ({ d: r.shift_date, sc: r.shift_code, st: r.source_station });

  if (sql.includes('COUNT(DISTINCT hanger_num)')) {
    return [{ h: new Set(CONES.filter(coneOk).map((c) => c.hanger_num).filter((h): h is number => h != null && h > 0)).size }];
  }
  if (sql.includes('JOIN sms.cone_event')) {
    // the reject side, joined to a cone that passes the cone side's own filters and generation; each cone once
    const matched = CONES.filter((c) => coneOk(c) && REJECTS.some((r) => rejOk(r) && sameKey(c, r)));
    return group(matched).map((g) => ({ ...head(g[0]!), n: new Set(g.map((c) => c.cone_event_id)).size }));
  }
  if (sql.includes('FROM sms.reject_event')) {
    return group(REJECTS.filter(rejOk)).map((g) => ({ ...head(g[0]!), n: g.length }));
  }
  if (sql.includes('FROM sms.cone_event')) {
    const lo = Number(p.get('plausLo'));
    const hi = Number(p.get('plausHi'));
    const adj = Number(p.get('coneAdj'));
    return group(CONES.filter(coneOk)).map((g) => {
      const plausible = g.filter((c) => c.weight_g != null && c.weight_g >= lo && c.weight_g <= hi);
      return {
        ...head(g[0]!), n: g.length, pn: plausible.length,
        g: plausible.reduce((a, c) => a + (c.weight_g! - adj), 0), sr: g.filter((c) => c.in_range === false).length,
      };
    });
  }
  throw new Error(`unexpected query: ${sql}`);
}

function datasetPool(rules: Rules = { plaus: [], weight: [] }): ConnectionPool {
  return {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          if (inputs.has(name)) throw new Error(`The parameter name ${name} has already been declared. Parameter names must be unique`);
          inputs.set(name, v);
          return req;
        },
        query: async (sql: string) => ({ recordset: evaluate(sql, inputs, rules) }),
      };
      return req;
    },
  } as unknown as ConnectionPool;
}

const period = (from: string, to = from) => ({ period: 'custom' as const, from, to });

describe('shift-production counts each physical cone once (D1), against a dataset the plant\'s own shape', () => {
  it('2026-09-10: 10 cones, one also a weight reject, one reject with no cone row -> weighed 10, pass 9, rejects 2, total 11, efficiency 81.82', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D10), {});
    expect(r.grandTotal).toEqual({ weighed: 10, pass: 9, weightRejects: 2, total: 11, efficiencyPct: 81.82, weighedKg: 19.582 });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ date: D10, shift: 'morning', winder: 1, weighed: 10, pass: 9, weightRejects: 2, total: 11, efficiencyPct: 81.82 });
  });

  it('the quality reject on cone 5 is not part of this efficiency; the simulator-generation reject on cone 7 neither counts nor matches', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D10), {});
    // had the quality reject counted, rejects would be 3; had the simulator reject matched cone 7, pass would be 8
    expect(r.grandTotal.weightRejects).toBe(2);
    expect(r.grandTotal.pass).toBe(9);
  });

  it('the simulator\'s cones on the same day are excluded and the exclusion is stated', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D10), {});
    expect(r.generationNote.generation?.simulator).toBe(false);
    expect(r.generationNote.generation?.sourceDb).toBe('DATA_TP1U2_SEP07');
    expect(r.generationNote.spansGenerations).toBe(true);
    expect(r.generationNote.otherGenerationExcluded).toBeGreaterThan(0);
  });

  it('the scale\'s own in-range bit is reported beside the weight rejects, not merged into them', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D10), {});
    expect(r.scaleRejectedCones).toBe(1);
    expect(r.grandTotal.weightRejects).toBe(2);
  });

  it('hangers seen is computed from the cones of the period (10 here), real generation only', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D10), {});
    expect(r.loop.hangersSeen).toBe(10);
  });

  it('a real reject whose key equals a SIMULATOR cone\'s is a reject with no cone row: the cone side is generation-scoped too', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D11), {});
    // 4 real cones, none of them the rejected one; had the simulator cone matched, pass would be 3 and total 4
    expect(r.grandTotal).toMatchObject({ weighed: 4, pass: 4, weightRejects: 1, total: 5, efficiencyPct: 80 });
  });

  it('over a range, total = cones weighed + the weight rejects that have no cone row', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D10, D11), {});
    const g = r.grandTotal;
    expect(g).toMatchObject({ weighed: 14, pass: 13, weightRejects: 3 });
    // 3 weight rejects, 1 of them also a cone row -> 2 with none
    expect(g.total).toBe(g.weighed + 2);
    expect(r.dayTotals.map((x) => [x.date, x.total])).toEqual([[D10, 11], [D11, 5]]);
  });

  it('several shifts, winders and a winder-less cone: every level adds up, and a reject with no weight is still a reject', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D12), {});
    // weighed 8; cones 12 and 16 are also weight rejects; the night reject (no weight recorded, no cone row) is still a reject
    expect(r.grandTotal).toMatchObject({ weighed: 8, pass: 6, weightRejects: 3, total: 9 });
    expect(r.summary.map((s) => [s.shift, s.weighed, s.pass, s.weightRejects, s.total])).toEqual([
      ['morning', 4, 3, 1, 4], ['evening', 2, 1, 1, 2], ['night', 2, 2, 1, 3],
    ]);
    expect(r.withoutWinder).toEqual({ pass: 1, weightRejects: 0 });
    expect(r.rows.map((x) => `${x.shift} w${x.winder}: ${x.pass}/${x.weightRejects}/${x.total}`)).toEqual([
      'morning w1: 1/1/2', 'morning w2: 1/0/1', 'evening w1: 1/1/2', 'night w3: 2/1/3',
    ]);
    expect(r.winderTotals.map((x) => [x.winder, x.weighed, x.pass, x.weightRejects, x.total])).toEqual([[1, 4, 2, 2, 4], [2, 1, 1, 0, 1], [3, 2, 2, 1, 3]]);
    expect(r.dayTotals).toHaveLength(1);
    expect(r.dayTotals[0]).toMatchObject({ weighed: 8, pass: 6, weightRejects: 3, total: 9 });
    // the sum of the winder rows plus the winder-less cone is the grand total
    expect(r.rows.reduce((a, x) => a + x.pass, 0) + r.withoutWinder.pass).toBe(r.grandTotal.pass);
  });

  it('the scale-fault weight is left out of the kilograms and counted as implausible', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D12), {});
    // 7 plausible cones: 1950 x 5 + 2040 + 2030 = 13,820 g (the 2,354 g fault is out)
    expect(r.grandTotal.weighedKg).toBe(13.82);
    expect(r.kgBasis).toEqual({ basis: 'as_recorded', label: 'as the scale recorded them', implausible: 1 });
    const night = r.rows.find((x) => x.shift === 'night')!;
    expect(night.weighedKg).toBe(1.95); // only the 1,950 g cone of the two
  });

  it('a NET basis takes the cone tube off every plausible cone', async () => {
    const rules = { plaus: [], weight: [{ basis: 'net', tube: 70, tare: 0.5, effective_from: new Date('2026-01-01T00:00:00Z') }] };
    const r = await getShiftProductionReport(datasetPool(rules), LINE, period(D10), {});
    // 10 cones, each 70 g lighter: 19,582 - 700 = 18,882 g
    expect(r.grandTotal.weighedKg).toBe(18.882);
    expect(r.kgBasis?.basis).toBe('net');
  });

  it('the shift filter narrows cones, rejects and the matched cones together', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period(D12), { shift: 'evening' });
    expect(r.summary.map((s) => s.shift)).toEqual(['evening']);
    expect(r.grandTotal).toMatchObject({ weighed: 2, pass: 1, weightRejects: 1, total: 2 });
    expect(r.loop.hangersSeen).toBe(2);
  });

  it('an empty period reports nothing rather than inventing a figure', async () => {
    const r = await getShiftProductionReport(datasetPool(), LINE, period('2026-08-01'), {});
    expect(r.grandTotal).toEqual({ weighed: 0, pass: 0, weightRejects: 0, total: 0, efficiencyPct: null, weighedKg: null });
    expect(r.rows).toEqual([]);
  });
});
