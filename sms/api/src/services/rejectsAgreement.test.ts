/**
 * Line and Rejects must count the SAME rejects for the same period (roadmap
 * Phase 5 item 2, 14 Sep 2026).
 *
 * The gap analysis (§7) found the two screens disagreeing on their default
 * period: Line counts one shift up to the plant instant through
 * /api/production (`shift` + `tsTo`), while the Rejects headline came from
 * /api/reject-spc, which accepted neither and so counted the whole production
 * day — the same period on screen, two different numbers underneath it.
 *
 * This drives the real production.ts, rejectSpc.ts and rejects.ts against ONE
 * fake dataset through a pool that APPLIES the predicates each query binds —
 * a canned recordset would pass whether or not the WHERE existed, which is the
 * defect this file exists to pin. The evaluator applies a predicate only when
 * the SQL actually references the parameter, so a service that binds @shift
 * and never uses it fails here rather than passing by accident.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { getProduction } from './production.js';
import { getRejectSpc } from './rejectSpc.js';
import { getRejectPareto, getRejectsByDayCode } from './rejects.js';

interface Row {
  line_id: number;
  shift_date: string;
  shift_code: 'morning' | 'evening' | 'night';
  production_ts_utc_ms: number;
  source_epoch: number;
  source_station: number | null;
  material_id: number | null;
  reject_type?: 'quality' | 'weight';
  tube_inspect_code?: number | null;
  material_inspect_code?: number | null;
  in_range?: boolean;
  /**
   * Never colliding between REJECTS and CONES below (rejects use 900+, cones
   * use 1-70) — every reject in this file is deliberately UNMATCHED, so the
   * 23 Sep 2026 denominator correction (cones + only unmatched rejects)
   * reduces to cones + every reject here, exactly the totals this file's
   * assertions were already written against. This file exists to pin
   * shift/tsTo/station/product/code filter AGREEMENT between screens, not
   * the matched/unmatched split — rejectSpc.test.ts covers that.
   */
  hanger_num?: number;
}

const ms = (iso: string) => new Date(iso).getTime();
const DAY = '2026-09-07';
const NEXT = '2026-09-08';

// The morning shift of 7 Sep runs 06:00-14:00 plant time; the replay instant
// is 09:30. Rejects: five in the morning before 09:30 (the answer), two in
// the morning after 09:30, two on the evening shift, one on the next day.
const REJECTS_RAW: Row[] = [
  { line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-07T06:10:00Z'), source_epoch: 11, source_station: 1, material_id: 21, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 },
  { line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-07T07:00:00Z'), source_epoch: 11, source_station: 2, material_id: 21, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 },
  { line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-07T08:20:00Z'), source_epoch: 11, source_station: 2, material_id: 21, reject_type: 'quality', tube_inspect_code: 2, material_inspect_code: 1 },
  { line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-07T09:00:00Z'), source_epoch: 12, source_station: 3, material_id: 21, reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null },
  { line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-07T09:29:59Z'), source_epoch: 12, source_station: 3, material_id: null, reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null },
  // after the replay instant, same shift
  { line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-07T10:00:00Z'), source_epoch: 11, source_station: 1, material_id: 21, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 },
  { line_id: 1, shift_date: DAY, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-07T13:00:00Z'), source_epoch: 11, source_station: 1, material_id: 21, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 },
  // evening shift of the same day
  { line_id: 1, shift_date: DAY, shift_code: 'evening', production_ts_utc_ms: ms('2026-09-07T15:00:00Z'), source_epoch: 11, source_station: 1, material_id: 21, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 },
  { line_id: 1, shift_date: DAY, shift_code: 'evening', production_ts_utc_ms: ms('2026-09-07T16:00:00Z'), source_epoch: 12, source_station: 4, material_id: 21, reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null },
  // next production day
  { line_id: 1, shift_date: NEXT, shift_code: 'morning', production_ts_utc_ms: ms('2026-09-08T07:00:00Z'), source_epoch: 11, source_station: 1, material_id: 21, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3 },
];
// hanger_num 900+ on every reject, 1-70 on every cone below: the two ranges
// never collide, so every reject in this file is deliberately UNMATCHED (see
// the Row.hanger_num doc comment above).
const REJECTS: Row[] = REJECTS_RAW.map((r, i) => ({ ...r, hanger_num: 900 + i }));
const CONES: Row[] = [
  ...Array.from({ length: 40 }, (_, i) => ({
    line_id: 1, shift_date: DAY, shift_code: 'morning' as const, production_ts_utc_ms: ms('2026-09-07T06:00:00Z') + i * 5 * 60_000,
    source_epoch: 9, source_station: (i % 4) + 1, material_id: 21, in_range: true, hanger_num: i + 1,
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    line_id: 1, shift_date: DAY, shift_code: 'evening' as const, production_ts_utc_ms: ms('2026-09-07T14:00:00Z') + i * 5 * 60_000,
    source_epoch: 9, source_station: 1, material_id: 21, in_range: true, hanger_num: i + 41,
  })),
];

const REGISTRY = [
  { epoch_id: 9, generation_ordinal: 3 },
  { epoch_id: 11, generation_ordinal: 3 },
  { epoch_id: 12, generation_ordinal: 3 },
];

/**
 * Applies every predicate the SQL references to the rows of the table it
 * reads, then shapes the result the way the query's SELECT list asks for.
 */
function datasetPool(): ConnectionPool {
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _type: unknown, value: unknown) => { inputs.set(name, value); return req; },
        query: async (sql: string) => ({ recordset: evaluate(sql, inputs) }),
      };
      return req;
    },
  };
  return pool as unknown as ConnectionPool;
}

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
    if (uses('shift') && r.shift_code !== p.get('shift')) return false;
    if (uses('tsTo') && r.production_ts_utc_ms > Number(p.get('tsTo'))) return false;
    if (uses('station') && r.source_station !== p.get('station')) return false;
    if (uses('product') && r.material_id !== p.get('product')) return false;
    if (uses('rejType') && r.reject_type !== p.get('rejType')) return false;
    if (uses('codeType') && r.reject_type !== p.get('codeType')) return false;
    if (uses('codeTube') && (r.tube_inspect_code ?? -999) !== p.get('codeTube')) return false;
    if (uses('codeMaterial') && (r.material_inspect_code ?? -999) !== p.get('codeMaterial')) return false;
    return true;
  });
  // rejectSpc.ts's unmatched-rejects query (23 Sep 2026 denominator
  // correction): a reject row survives only when NO cone_event row shares
  // its (production_ts_utc_ms, hanger_num). Every fixture reject's
  // hanger_num is chosen never to collide with a cone's, so this is a no-op
  // here — see the Row.hanger_num doc comment — but it is evaluated for
  // real, not assumed, so a regression that broke the join would fail this
  // file's counts too.
  if (sql.includes('NOT EXISTS') && sql.includes('sms.cone_event')) {
    rows = rows.filter((r) => !CONES.some(
      (c) => c.production_ts_utc_ms === r.production_ts_utc_ms && (c.hanger_num ?? -1) === (r.hanger_num ?? -1),
    ));
  }

  const groupBy = <K>(key: (r: Row) => string, shape: (k: string, rs: Row[]) => K): K[] => {
    const m = new Map<string, Row[]>();
    for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return [...m.entries()].map(([k, rs]) => shape(k, rs));
  };

  if (sql.includes('AS bucket_ts')) {
    // rejectSpc: (source_epoch, day) cells
    return groupBy((r) => `${r.source_epoch}|${r.shift_date}`, (k, rs) => ({
      source_epoch: Number(k.split('|')[0]), bucket_ts: new Date(`${k.split('|')[1]}T00:00:00.000Z`), n: rs.length,
    }));
  }
  if (sql.includes('rc.reject_code_id') && sql.includes('AS day')) {
    return groupBy((r) => `${r.shift_date}|${r.reject_type}|${r.tube_inspect_code ?? ''}|${r.material_inspect_code ?? ''}`, (k, rs) => {
      const [day, type, tube, mat] = k.split('|');
      return { day, reject_type: type, tube_inspect_code: tube === '' ? null : Number(tube), material_inspect_code: mat === '' ? null : Number(mat), reject_code_id: null, label: null, is_pass: null, n: rs.length };
    });
  }
  if (sql.includes('rc.reject_code_id')) {
    return groupBy((r) => `${r.reject_type}|${r.tube_inspect_code ?? ''}|${r.material_inspect_code ?? ''}`, (k, rs) => {
      const [type, tube, mat] = k.split('|');
      return { reject_code_id: null, reject_type: type, tube_inspect_code: tube === '' ? null : Number(tube), material_inspect_code: mat === '' ? null : Number(mat), label: null, n: rs.length };
    });
  }
  if (sql.includes('AS day')) {
    return groupBy((r) => r.shift_date, (day, rs) => ({ day, n: rs.length }));
  }
  // one aggregate row (production.ts groupBy 'none', the unattributed counts)
  return [{
    grp: 'total',
    n: rows.length,
    inr: rows.filter((r) => r.in_range).length,
    no_attr: rows.filter((r) => r.material_id == null).length,
  }];
}

const PERIOD = { from: DAY, to: DAY, shift: 'morning' as const, tsTo: '2026-09-07T09:30:00.000Z' };
const EXPECTED = 5; // the five morning rejects at or before 09:30, by hand

describe('Line and Rejects count the same rejects for the same period', () => {
  it('/api/production (Line) counts five', async () => {
    const out = await getProduction(datasetPool(), 1, { ...PERIOD, groupBy: 'none' });
    expect(out.rows[0]!.rejectedCones).toBe(EXPECTED);
    expect(out.rows[0]!.cones).toBe(40);
  });

  it('/api/reject-spc (the Rejects headline), quality + weight, counts the same five', async () => {
    const q = await getRejectSpc(datasetPool(), 1, DAY, DAY, 'day', 'quality', { shift: PERIOD.shift, tsTo: PERIOD.tsTo });
    const w = await getRejectSpc(datasetPool(), 1, DAY, DAY, 'day', 'weight', { shift: PERIOD.shift, tsTo: PERIOD.tsTo });
    expect(q.totalRejects + w.totalRejects).toBe(EXPECTED);
    expect(q.totalRejects).toBe(3);
    expect(w.totalRejects).toBe(2);
    // The denominator is the same population Line's figures divide by.
    expect(q.totalProduced).toBe(40);
    expect(q.buckets[0]!.inspected).toBe(45);
  });

  it('/api/rejects (the Pareto) and /api/rejects/by-day-code total the same five', async () => {
    const pareto = await getRejectPareto(datasetPool(), 1, PERIOD);
    const byDay = await getRejectsByDayCode(datasetPool(), 1, PERIOD);
    expect(pareto.total).toBe(EXPECTED);
    expect(byDay.total).toBe(EXPECTED);
    expect(byDay.rows[0]!.cones).toBe(40);
    expect(byDay.rows[0]!.inspected).toBe(45);
  });

  it('without shift and tsTo the trend counts the whole production day — the old disagreement', async () => {
    const q = await getRejectSpc(datasetPool(), 1, DAY, DAY, 'day', 'all');
    expect(q.totalRejects).toBe(9);
    expect(q.totalRejects).not.toBe(EXPECTED);
  });

  it('all four agree under a station filter too', async () => {
    const f = { ...PERIOD, station: 1 };
    const prod = await getProduction(datasetPool(), 1, { ...f, groupBy: 'none' });
    const spc = await getRejectSpc(datasetPool(), 1, DAY, DAY, 'day', 'all', { shift: f.shift, tsTo: f.tsTo, station: 1 });
    const pareto = await getRejectPareto(datasetPool(), 1, f);
    const byDay = await getRejectsByDayCode(datasetPool(), 1, f);
    expect([prod.rows[0]!.rejectedCones, spc.totalRejects, pareto.total, byDay.total]).toEqual([1, 1, 1, 1]);
    // and the cones under the same station, on both sides
    expect(prod.rows[0]!.cones).toBe(10);
    expect(spc.totalProduced).toBe(10);
  });

  it('a code filter narrows the numerator only: the rate is that code\'s share of everything inspected', async () => {
    const spc = await getRejectSpc(datasetPool(), 1, DAY, DAY, 'day', 'all', {
      shift: PERIOD.shift, tsTo: PERIOD.tsTo, code: { kind: 'quality', tube: 1, material: 3 },
    });
    expect(spc.totalRejects).toBe(2);
    expect(spc.buckets[0]!.inspected).toBe(45); // 40 cones + all 5 rejects, not 40 + 2
    expect(spc.buckets[0]!.rate).toBeCloseTo(2 / 45, 5);
  });

  it('a product filter reports the rejects that predate product recording, on both /api/production and /api/rejects', async () => {
    const prod = await getProduction(datasetPool(), 1, { ...PERIOD, product: 21, groupBy: 'none' });
    expect(prod.rows[0]!.rejectedCones).toBe(4); // the 09:29:59 weight reject has no material_id
    expect(prod.unattributed).toEqual({ cones: { rows: 0, of: 40 }, rejects: { rows: 1, of: 5 } });
    const pareto = await getRejectPareto(datasetPool(), 1, { ...PERIOD, product: 21 });
    expect(pareto.total).toBe(4);
    expect(pareto.unattributed).toEqual({ rows: 1, of: 5 });
  });
});
