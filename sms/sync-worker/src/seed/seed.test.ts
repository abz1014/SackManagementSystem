/**
 * The two seeders, against a recording fake pool. Neither had a test before
 * 14 Sep 2026, although both run before every ingest pass and one of them
 * (seedProducts) is the only writer of sms.product_limit_version from the
 * PDAS side — the history every product verdict is judged against.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { seedReference } from './seedReference.js';
import { seedProducts } from './seedProducts.js';

interface Stmt { sql: string; inputs: Map<string, unknown> }

/** Records every statement; answers from a routing table keyed by a SQL needle. */
function fakePool(answers: { needle: string; rows: Record<string, unknown>[] }[] = []) {
  const statements: Stmt[] = [];
  const pool = {
    statements,
    request() {
      const inputs = new Map<string, unknown>();
      return {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return this;
        },
        async query(sql: string) {
          statements.push({ sql, inputs: new Map(inputs) });
          const a = answers.find((x) => sql.includes(x.needle));
          return { recordset: a ? a.rows : [], rowsAffected: [a ? a.rows.length : 0] };
        },
      };
    },
  };
  return pool as unknown as ConnectionPool & { statements: Stmt[] };
}

const cfg = {
  lineId: 1,
  appConfig: {
    shift: { mode: 'corrected', nightBelongsTo: 'start_day' },
    weight: { basis: 'as_recorded', coneTubeWeightG: 0, sackTareKg: 0 },
  },
} as never;

describe('seedReference', () => {
  it('seeds the four reference tables from config, every insert guarded so a re-run changes nothing', async () => {
    const pool = fakePool();
    await seedReference(pool, cfg);
    const [shift, weight, plaus, stations] = pool.statements;
    expect(shift!.sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM sms\.shift_rule WHERE line_id = @line\)/);
    expect(shift!.inputs.get('mode')).toBe('corrected');
    expect(shift!.inputs.get('night')).toBe('start_day');
    // Q8: the boundaries are confirmed constants, not config.
    expect(shift!.sql).toMatch(/'06:00', '14:00', '22:00'/);

    expect(weight!.sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM sms\.weight_rule WHERE line_id = @line\)/);
    expect(weight!.inputs.get('basis')).toBe('as_recorded');

    expect(plaus!.sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM sms\.plausibility_rule WHERE line_id = @line\)/);
    // The scale-fault window the code used to hardcode; seeded at those values.
    expect(plaus!.sql).toMatch(/VALUES \(@line, 1500, 2100, 40, 60/);

    expect(stations!.sql).toMatch(/INSERT INTO sms\.station/);
    expect(stations!.sql).toMatch(/TOP \(14\)/);
    expect(stations!.sql).toMatch(/WHERE NOT EXISTS/);
    for (const s of pool.statements) expect(s.inputs.get('line')).toBe(1);
  });
});

describe('seedProducts', () => {
  const blends = { needle: 'FROM [PDAS_TP1U2].dbo.Blends', rows: [{ BlendId: 1, Blend: 'PV 65/35' }] };
  const counts = { needle: 'FROM [PDAS_TP1U2].dbo.Counts', rows: [{ CountId: 2, Count: '30' }, { CountId: 3, Count: '2/30' }] };
  const tubes = { needle: 'FROM [PDAS_TP1U2].dbo.TubeTypes', rows: [{ TubeTypeId: 3, TubeType: 'Paper', TubeWeight: 62.5 }] };
  const material = {
    MaterialId: 21, BlendId: 1, CountId: 2, TubeTypeId: 3, MaterialSetpointWeight: 1960, MaterialActive: true,
    MaterialDesc1: '205-IL0-SD', MaterialDesc2: 'PARROT', MaterialWeightOffsetMinus: 50, MaterialWeightOffsetPlus: 50,
  };
  const mats = { needle: 'FROM [PDAS_TP1U2].dbo.Materials', rows: [material] };

  let ifl: ReturnType<typeof fakePool>;
  beforeEach(() => {
    ifl = fakePool([blends, counts, tubes, mats]);
  });

  it('refuses a database name that is not a plain identifier, before touching either pool', async () => {
    const app = fakePool();
    await expect(seedProducts(app, ifl, 'PDAS]; DROP TABLE x; --')).rejects.toThrow(/unsafe database name/);
    expect(ifl.statements).toHaveLength(0);
    expect(app.statements).toHaveLength(0);
  });

  it('reads PDAS with the vendor seed rows filtered out, and only ever SELECTs from it', async () => {
    const app = fakePool();
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    expect(ifl.statements).toHaveLength(4);
    for (const s of ifl.statements) expect(s.sql.trim()).toMatch(/^SELECT/);
    expect(ifl.statements[3]!.sql).toMatch(/WHERE MaterialId > 10/);
    expect(ifl.statements[3]!.sql).toMatch(/MaterialDesc2/);
  });

  it('mirrors each reference row with a MERGE, casting Count to int and keeping the text', async () => {
    const app = fakePool();
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const merges = app.statements.filter((s) => s.sql.includes('MERGE'));
    expect(merges.map((m) => m.sql.match(/MERGE (sms\.\w+)/)![1])).toEqual([
      'sms.blend', 'sms.yarn_count', 'sms.yarn_count', 'sms.tube_type', 'sms.product',
    ]);
    const [, c30, c230, , prod] = merges;
    expect(c30!.inputs.get('iv')).toBe(30);
    // '2/30' is a real IFL count that parseInt reads as 2 — kept as text beside it.
    expect(c230!.inputs.get('iv')).toBe(2);
    expect(c230!.inputs.get('v')).toBe('2/30');
    expect(prod!.inputs.get('sp')).toBe(1960);
    expect(prod!.inputs.get('col')).toBe('PARROT');
    expect(prod!.inputs.get('d')).toBe('205-IL0-SD');
  });

  it('appends a "first seen" limits version when the product has no history', async () => {
    const app = fakePool([{ needle: 'FROM sms.product_limit_version WHERE product_id = @id', rows: [] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const ins = app.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(ins).toBeDefined();
    expect(ins.inputs.get('id')).toBe(21);
    expect([ins.inputs.get('sp'), ins.inputs.get('om'), ins.inputs.get('op')]).toEqual([1960, 50, 50]);
    expect(ins.inputs.get('reason')).toBe('First seen by the mirror.');
    // A lower bound, observed by the mirror, never claimed as the instant of change.
    expect(ins.sql).toMatch(/SYSUTCDATETIME\(\), 1, 'pdas_observed'/);
  });

  it('appends nothing when the newest version already equals the mirrored values', async () => {
    const app = fakePool([{ needle: 'FROM sms.product_limit_version WHERE product_id = @id', rows: [{ sp: '1960.00', om: '50.00', op: '50.00' }] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    expect(app.statements.some((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))).toBe(false);
  });

  it('appends an "observed differing" version when PDAS changed underneath the mirror', async () => {
    const app = fakePool([{ needle: 'FROM sms.product_limit_version WHERE product_id = @id', rows: [{ sp: 1950, om: 50, op: 50 }] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const ins = app.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(ins.inputs.get('sp')).toBe(1960);
    expect(ins.inputs.get('reason')).toBe('Mirror observed PDAS values differing from the newest recorded version.');
  });

  it('a null setpoint is recorded as null, not as zero', async () => {
    ifl = fakePool([blends, counts, tubes, { needle: mats.needle, rows: [{ ...material, MaterialSetpointWeight: null }] }]);
    const app = fakePool([{ needle: 'FROM sms.product_limit_version WHERE product_id = @id', rows: [] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const ins = app.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(ins.inputs.get('sp')).toBeNull();
  });
});
