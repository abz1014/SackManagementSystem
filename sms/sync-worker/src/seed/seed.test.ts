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
    // Q8: the seed boundaries are the shared default (06/14/22), bound as
    // parameters — the first rule row only; Setup › Rules appends the rest.
    expect([shift!.inputs.get('ms'), shift!.inputs.get('es'), shift!.inputs.get('ns')]).toEqual(['06:00', '14:00', '22:00']);
    expect(shift!.sql).toMatch(/VALUES \(@line, @ms, @es, @ns, @mode, @night/);

    expect(weight!.sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM sms\.weight_rule WHERE line_id = @line\)/);
    expect(weight!.inputs.get('basis')).toBe('as_recorded');

    expect(plaus!.sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM sms\.plausibility_rule WHERE line_id = @line\)/);
    // The scale-fault window the code used to hardcode; seeded at those values.
    expect(plaus!.sql).toMatch(/VALUES \(@line, 1500, 2100, 40, 60/);

    expect(stations!.sql).toMatch(/INSERT INTO sms\.station/);
    expect(stations!.sql).toMatch(/NOT EXISTS/);
    for (const s of pool.statements) expect(s.inputs.get('line')).toBe(1);
  });

  /**
   * Roadmap Phase 1: stations are reconciled from sms.machine, not counted to
   * 14. The reconciliation is one INSERT ... SELECT, so what a fake pool can
   * pin is its shape: a winder numbered 15 with no station row is exactly a
   * row of `sms.machine` that the SELECT's predicates admit and the NOT EXISTS
   * does not exclude. (The statement was also run against the development
   * sidecar inside a rolled-back transaction with such a machine: station 15
   * appeared, linked to it, 14 Sep 2026.)
   */
  it('inserts a station for a winder with machine_no 15 that has none — from sms.machine, no TOP (14)', async () => {
    const pool = fakePool();
    await seedReference(pool, cfg);
    const stations = pool.statements.find((s) => s.sql.includes('INSERT INTO sms.station'))!;
    expect(stations.sql).not.toMatch(/TOP \(14\)/);
    expect(stations.sql).not.toMatch(/sys\.all_objects/);
    // the station takes the machine's number and is linked to the machine
    expect(stations.sql).toMatch(/INSERT INTO sms\.station \(station_id, line_id, machine_id, link_source\)/);
    expect(stations.sql).toMatch(/SELECT m\.machine_no, @line, m\.machine_id, 'default_by_number'/);
    expect(stations.sql).toMatch(/FROM sms\.machine m/);
    // only the line's active, numbered winders/others — the packer has no number
    expect(stations.sql).toMatch(/m\.line_id = @line/);
    expect(stations.sql).toMatch(/m\.is_active = 1/);
    expect(stations.sql).toMatch(/m\.kind IN \('winder', 'other'\)/);
    expect(stations.sql).toMatch(/m\.machine_no IS NOT NULL/);
    // and only where no station of that number exists yet
    expect(stations.sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM sms\.station s WHERE s\.line_id = @line AND s\.station_id = m\.machine_no/);
    expect(stations.inputs.get('line')).toBe(1);
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
  // migration 036: pack_schema has no vendor-seed id filter (both real rows
  // are ids 1-2); pallet uses the same PalletId > 10 convention as Materials.
  const packSchemas = {
    needle: 'FROM [PDAS_TP1U2].dbo.PackSchemas',
    rows: [{ PackSchemaId: 1, PackSchemaDesc: 'Pallet 4x5', ConesPerLayer: 20, PackTypeId: 1 }],
  };
  const pallet = {
    PalletId: 21, MaterialId: 21, PackSchemaId: 1, Lot: 'L-100', SteamProg: 2, LabelType: 1, Routing: 0,
    PalletActive: true, PalletDesc1: 'Red', PalletDesc2: null, PalletDesc3: null, PalletDesc4: null, PalletDesc5: null,
    Timestamp: new Date('2026-09-10T08:00:00'),
  };
  const pallets = { needle: 'FROM [PDAS_TP1U2].dbo.Pallets', rows: [pallet] };

  let ifl: ReturnType<typeof fakePool>;
  beforeEach(() => {
    ifl = fakePool([blends, counts, tubes, mats, packSchemas, pallets]);
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
    expect(ifl.statements).toHaveLength(6);
    for (const s of ifl.statements) expect(s.sql.trim()).toMatch(/^SELECT/);
    expect(ifl.statements[3]!.sql).toMatch(/WHERE MaterialId > 10/);
    expect(ifl.statements[3]!.sql).toMatch(/MaterialDesc2/);
    // PackSchemas carries no vendor-seed id noise (both real rows are ids 1-2) — unfiltered.
    expect(ifl.statements[4]!.sql).toMatch(/FROM \[PDAS_TP1U2\]\.dbo\.PackSchemas/);
    expect(ifl.statements[4]!.sql).not.toMatch(/WHERE/);
    // Pallets uses the same vendor-seed convention as Materials.
    expect(ifl.statements[5]!.sql).toMatch(/FROM \[PDAS_TP1U2\]\.dbo\.Pallets WHERE PalletId > 10/);
  });

  it('mirrors each reference row with a MERGE, casting Count to int and keeping the text', async () => {
    const app = fakePool();
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const merges = app.statements.filter((s) => s.sql.includes('MERGE'));
    expect(merges.map((m) => m.sql.match(/MERGE (sms\.\w+)/)![1])).toEqual([
      'sms.blend', 'sms.yarn_count', 'sms.yarn_count', 'sms.tube_type', 'sms.product', 'sms.pack_schema', 'sms.pallet',
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

  it('mirrors pack_schema with a bound-parameter MERGE (migration 036)', async () => {
    const app = fakePool();
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const merge = app.statements.find((s) => s.sql.includes('MERGE sms.pack_schema'))!;
    expect(merge).toBeDefined();
    expect(merge.sql).toMatch(/ON t\.pack_schema_id=s\.id/);
    expect(merge.sql).toMatch(
      /INSERT \(pack_schema_id, description, cones_per_layer, pack_type_id\) VALUES \(@id, @d, @cpl, @pt\)/,
    );
    // every value is a bound parameter — no interpolated literal from the row
    // appears in the SQL text itself.
    expect(merge.sql).not.toMatch(/Pallet 4x5/);
    expect(merge.inputs.get('id')).toBe(1);
    expect(merge.inputs.get('d')).toBe('Pallet 4x5');
    expect(merge.inputs.get('cpl')).toBe(20);
    expect(merge.inputs.get('pt')).toBe(1);
  });

  it('mirrors pallet with a bound-parameter MERGE, id filter applied upstream (migration 036)', async () => {
    const app = fakePool();
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const merge = app.statements.find((s) => s.sql.includes('MERGE sms.pallet'))!;
    expect(merge).toBeDefined();
    expect(merge.sql).toMatch(/ON t\.pallet_id=s\.id/);
    // column list matches both migration 036's table definition and
    // pdasWrite.ts's mirrorPallet echo-back MERGE exactly.
    expect(merge.sql).toMatch(
      /INSERT \(pallet_id, product_id, pack_schema_id, lot, steam_prog, label_type, routing, active_flag,\s*desc1, desc2, desc3, desc4, desc5, pdas_created_at\)/,
    );
    expect(merge.sql).toMatch(
      /VALUES \(@id, @pid, @ps, @lot, @steam, @label, @routing, @a, @d1, @d2, @d3, @d4, @d5, @ts\)/,
    );
    // every value is a bound parameter — the lot string never appears literally in the SQL text.
    expect(merge.sql).not.toMatch(/L-100/);
    expect(merge.inputs.get('id')).toBe(21);
    expect(merge.inputs.get('pid')).toBe(21);
    expect(merge.inputs.get('ps')).toBe(1);
    expect(merge.inputs.get('lot')).toBe('L-100');
    expect(merge.inputs.get('a')).toBe(true);
    expect(merge.inputs.get('d1')).toBe('Red');
    expect(merge.inputs.get('ts')).toEqual(pallet.Timestamp);
    // the row-level id filter (PalletId > 10) lives in the upstream SELECT,
    // asserted above — this MERGE never re-filters, it mirrors what it was given.
    const read = ifl.statements.find((s) => s.sql.includes('FROM [PDAS_TP1U2].dbo.Pallets'))!;
    expect(read.sql).toMatch(/WHERE PalletId > 10/);
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
