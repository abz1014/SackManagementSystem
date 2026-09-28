/**
 * Reject filters, the per-day-per-code breakdown and the reason listing
 * (roadmap Phase 5, 14 Sep 2026). Two fakes, as the other service suites do:
 *
 *  - a RECORDING pool, which captures every statement and its bound
 *    parameters so a test can assert "the WHERE carried shift_code = @shift
 *    and @shift was 'night'" — the gap analysis found no WHERE on any code
 *    column existed anywhere, so the SQL itself is what these tests pin;
 *  - a DATASET pool for the breakdown, which serves the three grouped
 *    queries from one fake set of days so the rate arithmetic can be checked
 *    against numbers a reader can do by hand.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  bindRejectFilters, codeParamOf, getRejectPareto, getRejectsByDayCode, listRejectsOfDayCode, parseCodeParam,
  type RejectFilters,
} from './rejects.js';
import { listEvents } from './register.js';
import { UNSCOPED } from './generation.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

/** Records statements; answers each with the next canned recordset (or none). */
function recordingPool(responses: unknown[][] = []): { pool: ConnectionPool; statements: Stmt[] } {
  const statements: Stmt[] = [];
  let i = 0;
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _type: unknown, value: unknown) => {
          inputs.set(name, value);
          return req;
        },
        query: async (sql: string) => {
          // The source-generation probe (generation.ts `resolveGenerationScope`,
          // 23 Sep 2026) runs before every other query in this service. It is
          // answered here as "no epoch-tagged rows", which resolves to the
          // UNSCOPED no-op, so the cases below keep testing exactly what they
          // were written to test. It is intercepted BEFORE `statements` is
          // appended to, so it does not shift the positional assertions those
          // cases make about which query came first. The predicate itself is
          // covered by generation.test.ts and by the epoch cases at the end of
          // this file.
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) return { recordset: [] };
          statements.push({ sql, inputs: new Map(inputs) });
          return { recordset: responses[i++] ?? [], rowsAffected: [0] };
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

/** A request stub for bindRejectFilters alone. */
function fakeReq() {
  const inputs = new Map<string, unknown>();
  const req = { input: (name: string, _t: unknown, v: unknown) => { inputs.set(name, v); return req; } };
  return { req: req as unknown as import('mssql').Request, inputs };
}

describe('parseCodeParam / codeParamOf — the URL form of a reject code', () => {
  it('reads weight and tube-material pairs, with null for a missing half', () => {
    expect(parseCodeParam('weight')).toEqual({ kind: 'weight' });
    expect(parseCodeParam('1-3')).toEqual({ kind: 'quality', tube: 1, material: 3 });
    expect(parseCodeParam('null-3')).toEqual({ kind: 'quality', tube: null, material: 3 });
    expect(parseCodeParam('2-null')).toEqual({ kind: 'quality', tube: 2, material: null });
  });
  it('refuses anything else rather than matching nothing silently', () => {
    for (const bad of ['', 'tube', '1', '1-', '-3', '1-3-5', 'a-b', "1' OR 1=1--"]) {
      expect(parseCodeParam(bad), bad).toBeNull();
    }
  });
  it('round-trips through codeParamOf', () => {
    expect(codeParamOf({ rejectType: 'weight', tubeCode: null, materialCode: null })).toBe('weight');
    expect(codeParamOf({ rejectType: 'quality', tubeCode: 1, materialCode: 3 })).toBe('1-3');
    expect(parseCodeParam(codeParamOf({ rejectType: 'quality', tubeCode: null, materialCode: 7 }))).toEqual({ kind: 'quality', tube: null, material: 7 });
  });
});

describe('bindRejectFilters — one binder for every reject query', () => {
  it('with no filters binds only the line', () => {
    const { req, inputs } = fakeReq();
    expect(bindRejectFilters(req, 1, {}, 're.')).toBe('re.line_id = @line');
    expect([...inputs.keys()]).toEqual(['line']);
  });

  it('binds shift, tsTo (as epoch ms), station and product as parameters, never literals', () => {
    const { req, inputs } = fakeReq();
    const where = bindRejectFilters(req, 1, {
      from: '2026-09-01', to: '2026-09-07', shift: 'night', tsTo: '2026-09-07T11:00:00.000Z', station: 7, product: 21,
    }, 're.');
    expect(where).toContain('re.shift_date >= @from');
    expect(where).toContain('re.shift_date <= @to');
    expect(where).toContain('re.shift_code = @shift');
    expect(where).toContain('re.production_ts_utc_ms <= @tsTo');
    expect(where).toContain('re.source_station = @station');
    expect(where).toContain('re.material_id = @product');
    expect(inputs.get('shift')).toBe('night');
    expect(inputs.get('tsTo')).toBe(Date.UTC(2026, 8, 7, 11, 0, 0));
    expect(inputs.get('station')).toBe(7);
    expect(inputs.get('product')).toBe(21);
    expect(where).not.toMatch(/'night'|2026-09/);
  });

  it('a quality code binds type, tube and material through ISNULL so a null half still matches', () => {
    const { req, inputs } = fakeReq();
    const where = bindRejectFilters(req, 1, { code: { kind: 'quality', tube: null, material: 3 } }, 're.');
    expect(where).toContain('re.reject_type = @codeType');
    expect(where).toContain('ISNULL(re.tube_inspect_code, -999) = @codeTube');
    expect(where).toContain('ISNULL(re.material_inspect_code, -999) = @codeMaterial');
    expect(inputs.get('codeType')).toBe('quality');
    expect(inputs.get('codeTube')).toBe(-999);
    expect(inputs.get('codeMaterial')).toBe(3);
  });

  it('a weight code binds the type alone — weight rejects carry no code pair', () => {
    const { req, inputs } = fakeReq();
    const where = bindRejectFilters(req, 1, { code: { kind: 'weight' } });
    expect(where).toBe('line_id = @line AND reject_type = @codeType');
    expect(inputs.get('codeType')).toBe('weight');
    expect(inputs.has('codeTube')).toBe(false);
  });

  it('withCode=false drops the code and nothing else — the denominator population', () => {
    const { req, inputs } = fakeReq();
    const where = bindRejectFilters(req, 1, { shift: 'morning', code: { kind: 'quality', tube: 1, material: 1 } }, '', false);
    expect(where).toBe('line_id = @line AND shift_code = @shift');
    expect(inputs.has('codeType')).toBe(false);
  });
});

describe('getRejectPareto — each filter reaches the SQL', () => {
  const run = async (f: RejectFilters) => {
    const { pool, statements } = recordingPool([[]]);
    const out = await getRejectPareto(pool, 1, f);
    return { out, statements };
  };

  it('shift filter: the WHERE carries shift_code = @shift, bound to the shift', async () => {
    const { statements } = await run({ from: '2026-09-07', to: '2026-09-07', shift: 'evening' });
    const s = statements[0]!;
    expect(s.sql).toContain('re.shift_code = @shift');
    expect(s.inputs.get('shift')).toBe('evening');
  });

  it('tsTo filter: caps production_ts_utc_ms at the replay instant', async () => {
    const { statements } = await run({ tsTo: '2026-07-07T09:30:00Z' });
    expect(statements[0]!.sql).toContain('re.production_ts_utc_ms <= @tsTo');
    expect(statements[0]!.inputs.get('tsTo')).toBe(Date.UTC(2026, 6, 7, 9, 30, 0));
  });

  it('station filter binds source_station', async () => {
    const { statements } = await run({ station: 12 });
    expect(statements[0]!.sql).toContain('re.source_station = @station');
    expect(statements[0]!.inputs.get('station')).toBe(12);
  });

  it('code filter narrows the Pareto to one bar', async () => {
    const { statements } = await run({ code: { kind: 'quality', tube: 1, material: 3 } });
    expect(statements[0]!.sql).toContain('re.reject_type = @codeType');
    expect(statements[0]!.inputs.get('codeTube')).toBe(1);
    expect(statements[0]!.inputs.get('codeMaterial')).toBe(3);
  });

  it('the code join is per line and NULL-safe on both sides', async () => {
    const { statements } = await run({});
    expect(statements[0]!.sql).toContain('rc.line_id = re.line_id');
    expect(statements[0]!.sql).toContain('ISNULL(rc.tube_code, -999)     = ISNULL(re.tube_inspect_code, -999)');
  });

  it('without a product filter there is no unattributed count and only one query', async () => {
    const { out, statements } = await run({ from: '2026-09-01', to: '2026-09-07' });
    expect(out.unattributed).toBeNull();
    expect(statements).toHaveLength(1);
  });

  it('with a product filter, counts rejects with no material_id over the SAME range WITHOUT the product', async () => {
    const { pool, statements } = recordingPool([
      [{ reject_code_id: 5, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3, label: null, n: 40 }],
      [{ n: 300, no_attr: 120 }],
    ]);
    const out = await getRejectPareto(pool, 1, { from: '2026-07-01', to: '2026-09-07', shift: 'night', product: 21 });
    expect(out.total).toBe(40);
    expect(out.unattributed).toEqual({ rows: 120, of: 300 });
    const pareto = statements[0]!;
    const unattr = statements[1]!;
    expect(pareto.sql).toContain('re.material_id = @product');
    expect(pareto.inputs.get('product')).toBe(21);
    expect(unattr.sql).toContain('material_id IS NULL');
    expect(unattr.sql).not.toContain('@product');
    // Same range and shift as the Pareto itself, so `of` is the population the screen claims.
    expect(unattr.inputs.get('from')).toBe('2026-07-01');
    expect(unattr.inputs.get('to')).toBe('2026-09-07');
    expect(unattr.inputs.get('shift')).toBe('night');
  });

  it('displayLabel falls back to the kind or the raw pair until IFL names the code', async () => {
    const { pool } = recordingPool([[
      { reject_code_id: 1, reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3, label: 'Tube damaged', n: 60 },
      { reject_code_id: 2, reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null, label: null, n: 30 },
      { reject_code_id: null, reject_type: 'quality', tube_inspect_code: 2, material_inspect_code: 1, label: null, n: 10 },
    ]]);
    const out = await getRejectPareto(pool, 1, {});
    expect(out.reasons.map((r) => r.displayLabel)).toEqual(['Tube damaged', 'Weight out of range', 'Tube 2 · Mat 1']);
    expect(out.reasons.map((r) => r.pct)).toEqual([60, 30, 10]);
    expect(out.reasons.map((r) => r.cumulativePct)).toEqual([60, 90, 100]);
  });
});

/**
 * A fake set of two production days, served to the breakdown's three grouped
 * queries by what each asks for (its FROM table and whether it groups by
 * code), so the rate is checked against the day's own population:
 *
 *   day 06 Sep: 900 cones, 100 rejects (70 code 1-3, 30 weight)  → inspected 1000
 *   day 07 Sep: 400 cones,  20 rejects (20 code 1-3)             → inspected  420
 *
 * Code 1-3 is therefore 7.0% of everything inspected on the 6th and 4.8% on
 * the 7th; a rate over the RANGE would read 90/1420 = 6.3% on both rows.
 */
function datasetPool(withCodeFilter: boolean) {
  const statements: Stmt[] = [];
  const pool = {
    request: () => {
      const inputs = new Map<string, unknown>();
      const req = {
        input: (name: string, _type: unknown, value: unknown) => { inputs.set(name, value); return req; },
        query: async (sql: string) => {
          // The source-generation probe (generation.ts `resolveGenerationScope`,
          // 23 Sep 2026) runs before every other query in this service. It is
          // answered here as "no epoch-tagged rows", which resolves to the
          // UNSCOPED no-op, so the cases below keep testing exactly what they
          // were written to test. It is intercepted BEFORE `statements` is
          // appended to, so it does not shift the positional assertions those
          // cases make about which query came first. The predicate itself is
          // covered by generation.test.ts and by the epoch cases at the end of
          // this file.
          if (sql.includes('AS tbl, source_epoch AS epoch_id')) return { recordset: [] };
          statements.push({ sql, inputs: new Map(inputs) });
          // Checked BEFORE the plain cone_event branch: getUnmatchedRejects's
          // NOT EXISTS subquery references sms.cone_event too, so a bare
          // `.includes('FROM sms.cone_event')` would misroute it there.
          if (sql.includes('FROM sms.reject_event') && sql.includes('NOT EXISTS')) {
            // Every reject of the day, whatever its code, with none matching
            // a cone_event row — the fixture's `datasetPool` never modelled
            // cone/reject identity, so every reject here is "unmatched",
            // reproducing the same totals the pre-23-Sep-2026 formula used.
            return { recordset: [{ grp: '2026-09-06', n: 100 }, { grp: '2026-09-07', n: 20 }] };
          }
          if (sql.includes('FROM sms.cone_event')) {
            return { recordset: [{ day: '2026-09-06', n: 900 }, { day: '2026-09-07', n: 400 }] };
          }
          if (sql.includes('rc.reject_code_id')) {
            const rows = [
              { day: '2026-09-06', reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3, reject_code_id: 11, label: null, is_pass: null, n: 70 },
              { day: '2026-09-06', reject_type: 'weight', tube_inspect_code: null, material_inspect_code: null, reject_code_id: 12, label: 'Weight', is_pass: false, n: 30 },
              { day: '2026-09-07', reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 3, reject_code_id: 11, label: null, is_pass: null, n: 20 },
            ];
            return { recordset: withCodeFilter ? rows.filter((r) => r.reject_type === 'quality') : rows };
          }
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return req;
    },
  };
  return { pool: pool as unknown as ConnectionPool, statements };
}

describe('getRejectsByDayCode — rate uses that day\'s own population', () => {
  it('groups by production day and code, oldest day first, biggest reason first within a day', async () => {
    const { pool } = datasetPool(false);
    const out = await getRejectsByDayCode(pool, 1, { from: '2026-09-06', to: '2026-09-07' });
    expect(out.dayBasis).toBe('production_day');
    expect(out.denominator).toBe('cones_plus_rejects');
    expect(out.days).toBe(2);
    expect(out.total).toBe(120);
    expect(out.rows.map((r) => [r.day, r.displayLabel, r.count])).toEqual([
      ['2026-09-06', 'Tube 1 · Mat 3', 70],
      ['2026-09-06', 'Weight', 30],
      ['2026-09-07', 'Tube 1 · Mat 3', 20],
    ]);
  });

  it('each row carries ITS day\'s cones and inspected count, and the rate divides by the day', async () => {
    const { pool } = datasetPool(false);
    const out = await getRejectsByDayCode(pool, 1, { from: '2026-09-06', to: '2026-09-07' });
    const sixth = out.rows[0]!;
    const seventh = out.rows[2]!;
    expect(sixth.cones).toBe(900);
    expect(sixth.inspected).toBe(1000);
    expect(sixth.ratePct).toBe(7); // 70 / 1000
    expect(seventh.cones).toBe(400);
    expect(seventh.inspected).toBe(420);
    expect(seventh.ratePct).toBe(4.8); // 20 / 420 = 4.76
    // Not the range-wide 90 / 1420 = 6.3 on both.
    expect(sixth.ratePct).not.toBe(seventh.ratePct);
  });

  it('with a code filter, the numerator narrows but the denominator still counts every reject of the day', async () => {
    const { pool, statements } = datasetPool(true);
    const out = await getRejectsByDayCode(pool, 1, { from: '2026-09-06', to: '2026-09-07', code: { kind: 'quality', tube: 1, material: 3 } });
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]!.inspected).toBe(1000); // 900 cones + 100 rejects, the 30 weight rejects included
    expect(out.rows[0]!.ratePct).toBe(7);
    // The grouped query carries the code predicate; the two denominator queries do not.
    const grouped = statements.find((s) => s.sql.includes('rc.reject_code_id'))!;
    const all = statements.find((s) => !s.sql.includes('rc.reject_code_id') && s.sql.includes('FROM sms.reject_event'))!;
    // Excludes getUnmatchedRejects's own query: its NOT EXISTS subquery also
    // references sms.cone_event, so a bare substring match would pick it up
    // instead of the real cone count.
    const cones = statements.find((s) => s.sql.includes('FROM sms.cone_event') && !s.sql.includes('reject_event'))!;
    expect(grouped.sql).toContain('@codeTube');
    expect(all.sql).not.toContain('@codeTube');
    expect(cones.sql).not.toContain('@codeTube');
    expect(cones.sql).not.toContain('reject_type');
  });

  it('shift, station and product filters reach all three queries (the denominator moves with the numerator)', async () => {
    const { pool, statements } = datasetPool(false);
    await getRejectsByDayCode(pool, 1, { from: '2026-09-06', to: '2026-09-07', shift: 'night', station: 4, product: 21 });
    expect(statements).toHaveLength(3);
    for (const s of statements) {
      expect(s.sql).toMatch(/shift_code = @shift/);
      expect(s.sql).toMatch(/source_station = @station/);
      expect(s.sql).toMatch(/material_id = @product/);
      expect(s.inputs.get('shift')).toBe('night');
      expect(s.inputs.get('station')).toBe(4);
      expect(s.inputs.get('product')).toBe(21);
    }
  });
});

describe('listRejectsOfDayCode — the reason sheet\'s list', () => {
  it('binds the day as both bounds and the code, pages oldest-first, and carries the dictionary row', async () => {
    const { pool, statements } = recordingPool([
      [{ reject_code_id: 11, label: 'Tube damaged', is_pass: false }],
      [{ n: 2 }],
      [
        {
          event_id: 501, production_ts_utc: new Date('2026-09-06T07:12:00Z'), shift_code: 'morning', source_station: 3,
          material_id: 21, description: '205-IL0-SD', lot_code: null, weight_g: null, source_row_id: 88, epoch_label: 'Sept live - quality rejects',
          attribution_method: 'source_column',
        },
        {
          event_id: 502, production_ts_utc: new Date('2026-09-06T07:15:00Z'), shift_code: 'morning', source_station: null,
          material_id: null, description: null, lot_code: null, weight_g: null, source_row_id: 89, epoch_label: 'Sept live - quality rejects',
          attribution_method: 'none',
        },
      ],
    ]);
    const out = await listRejectsOfDayCode(pool, 1, { day: '2026-09-06', code: { kind: 'quality', tube: 1, material: 3 }, page: 1, pageSize: 200 });
    expect(out.day).toBe('2026-09-06');
    expect(out.dayBasis).toBe('production_day');
    expect(out.rejectCodeId).toBe(11);
    expect(out.label).toBe('Tube damaged');
    expect(out.displayLabel).toBe('Tube damaged');
    expect(out.isPass).toBe(false);
    expect(out.total).toBe(2);
    expect(out.rows[0]).toEqual({
      eventId: 501, productionTsUtc: '2026-09-06T07:12:00.000Z', shiftCode: 'morning', station: 3, materialId: 21,
      productLabel: '205-IL0-SD', weightG: null, sourceRowId: 88, epochLabel: 'Sept live - quality rejects',
      // The fixture carries no epoch_ordinal/epoch_source_db (predates Task
      // B, 28 Sep 2026) — null/false is the honest "not known", not a guess.
      epochOrdinal: null, epochSimulator: false,
      attributionMethod: 'source_column',
    });
    expect(out.rows[1]!.productLabel).toBeNull();

    const [codeQ, countQ, rowsQ] = statements;
    expect(codeQ!.sql).toContain('FROM sms.reject_code');
    expect(codeQ!.inputs.get('tube')).toBe(1);
    expect(codeQ!.inputs.get('material')).toBe(3);
    expect(countQ!.inputs.get('from')).toBe('2026-09-06');
    expect(countQ!.inputs.get('to')).toBe('2026-09-06');
    expect(countQ!.sql).toContain('@codeTube');
    expect(rowsQ!.sql).toContain('ORDER BY e.production_ts_utc ASC');
    expect(rowsQ!.sql).toContain('OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY');
    expect(rowsQ!.inputs.get('offset')).toBe(0);
    expect(rowsQ!.inputs.get('take')).toBe(200);
    // The generation label travels with the row id — one id, labelled.
    expect(rowsQ!.sql).toContain('ep.label AS epoch_label');
  });

  it('a weight code without a dictionary row yet has no id to rename and the kind as its label', async () => {
    const { pool } = recordingPool([[], [{ n: 0 }], []]);
    const out = await listRejectsOfDayCode(pool, 1, { day: '2026-09-06', code: { kind: 'weight' }, page: 1, pageSize: 50 });
    expect(out.rejectCodeId).toBeNull();
    expect(out.displayLabel).toBe('Weight out of range');
    expect(out.code).toEqual({ rejectType: 'weight', tubeCode: null, materialCode: null });
    expect(out.rows).toEqual([]);
  });
});

/* ---------------------------------------------- the register's reject join */

describe('the register lists a reject under ITS line\'s code row', () => {
  it('joins reject_code on the line as well as the pair — codes are per line since migration 028', async () => {
    const { pool, statements } = recordingPool([[{ n: 0 }], []]);
    await listEvents(pool, 1, 'reject', { page: 1, pageSize: 50, sort: 'time', dir: 'desc' }, UNSCOPED);
    // Both the count and the page read through the same FROM; every reject
    // query in the application (Pareto, seed, register) now matches the code
    // row on the line, so a second line's identical pair cannot double a row.
    for (const s of statements) {
      expect(s.sql).toContain('LEFT JOIN sms.reject_code c');
      expect(s.sql).toContain('c.line_id = e.line_id');
      expect(s.sql).toContain('ISNULL(c.tube_code, -999)     = ISNULL(e.tube_inspect_code, -999)');
    }
    expect(statements).toHaveLength(2);
  });
});
