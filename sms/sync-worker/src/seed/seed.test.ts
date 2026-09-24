/**
 * The two seeders, against a recording fake pool. Neither had a test before
 * 14 Sep 2026, although both run before every ingest pass and one of them
 * (seedProducts) is the only writer of `source = 'pdas_observed'` rows in
 * sms.product_limit_version — the history every product verdict is judged
 * against. It stopped being the ONLY writer of that table on 15 Sep 2026
 * (2e8b470): api/src/services/productLimits.ts's setLocalLimitVersion() also
 * appends rows there, source 'sms_local', from Setup, and the (still off)
 * PDAS write path appends 'sms_write' rows. seedProducts must never read
 * those other sources back as if they were its own prior observation — see
 * the comment above its "latest" query in seedProducts.ts.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { seedReference } from './seedReference.js';
import { pdasCreatedAsUtc, seedProducts, __resetPdasMirrorFreshnessForTests } from './seedProducts.js';

// WS-PERF3, Job 2 (24 Sep 2026): seedProducts now caches PDAS's MAX(id) per
// table across calls, module-level, so it can skip a full re-read when
// nothing changed (see seedProducts.ts). That cache must not leak between
// otherwise-independent test cases sharing the 'PDAS_TP1U2' key below — every
// test except the dedicated change-detection block wants the ordinary "first
// sight, always read in full" behaviour.
beforeEach(() => {
  __resetPdasMirrorFreshnessForTests();
});

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
  // TubeForm added (migration 041): AddTubeType's own duplicate check is
  // name-pattern AND form together, so the mirror must carry form too — see
  // that migration's header and changeover.ts's resolveTube.
  const tubes = { needle: 'FROM [PDAS_TP1U2].dbo.TubeTypes', rows: [{ TubeTypeId: 3, TubeType: 'Paper', TubeWeight: 62.5, TubeForm: 2 }] };
  const material = {
    MaterialId: 21, BlendId: 1, CountId: 2, TubeTypeId: 3, MaterialSetpointWeight: 1960, MaterialActive: true,
    MaterialDesc1: '205-IL0-SD', MaterialDesc2: 'PARROT', MaterialWeightOffsetMinus: 50, MaterialWeightOffsetPlus: 50,
    // dbo.Materials.Timestamp — DEFAULT (getdate()), so every real row has
    // one. This is MaterialId 21's actual value on IFL's September copy.
    Timestamp: new Date('2026-07-30T11:31:50.623Z'),
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
    // WS-PERF3, Job 2: statement 0 is now the cheap MAX(id) change-detection
    // probe (one round trip, UNION ALL across all six tables) that runs
    // before the six full reads it gates — see the dedicated describe block
    // below for that probe's own behaviour. The six full reads still follow
    // it, unconditionally, on this — the first — call.
    expect(ifl.statements).toHaveLength(7);
    expect(ifl.statements[0]!.sql).toMatch(/UNION ALL SELECT/);
    for (const s of ifl.statements) expect(s.sql.trim()).toMatch(/^SELECT/);
    expect(ifl.statements[4]!.sql).toMatch(/WHERE MaterialId > 10/);
    expect(ifl.statements[4]!.sql).toMatch(/MaterialDesc2/);
    // PackSchemas carries no vendor-seed id noise (both real rows are ids 1-2) — unfiltered.
    expect(ifl.statements[5]!.sql).toMatch(/FROM \[PDAS_TP1U2\]\.dbo\.PackSchemas/);
    expect(ifl.statements[5]!.sql).not.toMatch(/WHERE/);
    // Pallets uses the same vendor-seed convention as Materials.
    expect(ifl.statements[6]!.sql).toMatch(/FROM \[PDAS_TP1U2\]\.dbo\.Pallets WHERE PalletId > 10/);
  });

  it('mirrors each reference row with a MERGE, casting Count to int and keeping the text', async () => {
    const app = fakePool();
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const merges = app.statements.filter((s) => s.sql.includes('MERGE'));
    expect(merges.map((m) => m.sql.match(/MERGE (sms\.\w+)/)![1])).toEqual([
      'sms.blend', 'sms.yarn_count', 'sms.yarn_count', 'sms.tube_type', 'sms.product', 'sms.pack_schema', 'sms.pallet',
    ]);
    const [, c30, c230, tube, prod] = merges;
    expect(c30!.inputs.get('iv')).toBe(30);
    // '2/30' is a real IFL count that parseInt reads as 2 — kept as text beside it.
    expect(c230!.inputs.get('iv')).toBe(2);
    expect(c230!.inputs.get('v')).toBe('2/30');
    expect(prod!.inputs.get('sp')).toBe(1960);
    expect(prod!.inputs.get('col')).toBe('PARROT');
    expect(prod!.inputs.get('d')).toBe('205-IL0-SD');
    // migration 041: TubeForm mirrored onto sms.tube_type.tube_form.
    expect(tube!.inputs.get('form')).toBe(2);
    expect(tube!.sql).toMatch(/tube_form=@form/);
    expect(tube!.sql).toMatch(
      /INSERT \(tube_type_id, tube_type, tube_weight_g, tube_form\) VALUES \(@id, @v, @w, @form\)/,
    );
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

  it("dates a product's FIRST limits version from PDAS's own record of when the material was created", async () => {
    // Migration 040. Before this the first version was stamped
    // SYSUTCDATETIME() and flagged a lower bound, which on real plant data
    // meant a date AFTER every reading it was then used to judge — 275,063
    // of 275,063 cones. dbo.Materials.Timestamp is when that row, and so
    // those limits, came into existence, and a cone cannot carry a
    // MaterialId whose row does not yet exist.
    const app = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const ins = app.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(ins).toBeDefined();
    expect(ins.inputs.get('id')).toBe(21);
    expect([ins.inputs.get('sp'), ins.inputs.get('om'), ins.inputs.get('op')]).toEqual([1960, 50, 50]);
    expect(ins.inputs.get('reason')).toBe(
      'In force since this material was created in PDAS (dbo.Materials.Timestamp).',
    );
    // NOT a lower bound, and NOT stamped "now": a measured date, bound as a
    // parameter rather than written by the server clock.
    expect(ins.sql).toMatch(/@eff,\s*0, 'pdas_created'/);
    expect(ins.sql).not.toMatch(/SYSUTCDATETIME\(\)/);
    expect(ins.inputs.get('eff')).toEqual(pdasCreatedAsUtc(material.Timestamp));
  });

  it('falls back to an honest lower bound when PDAS records no creation instant', async () => {
    // Not reachable on IFL's data (the column has DEFAULT getdate() and is
    // populated on every row), but the branch must not invent a date if it
    // ever is: it says what it knows, which is only when the mirror looked.
    const noTs = fakePool([blends, counts, tubes,
      { needle: mats.needle, rows: [{ ...material, Timestamp: null }] }, packSchemas, pallets]);
    const app = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
    await seedProducts(app, noTs, 'PDAS_TP1U2');
    const ins = app.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(ins.inputs.get('reason')).toBe(
      'First seen by the mirror; PDAS records no creation instant for this material.',
    );
    expect(ins.sql).toMatch(/SYSUTCDATETIME\(\), 1, 'pdas_observed'/);
  });

  it('appends nothing when the newest version already equals the mirrored values', async () => {
    const app = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [{ sp: '1960.00', om: '50.00', op: '50.00' }] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    expect(app.statements.some((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))).toBe(false);
  });

  it('appends an "observed differing" version when PDAS changed underneath the mirror', async () => {
    const app = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [{ sp: 1950, om: 50, op: 50 }] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const ins = app.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(ins.inputs.get('sp')).toBe(1960);
    expect(ins.inputs.get('reason')).toBe('Mirror observed PDAS values differing from the newest recorded version.');
  });

  it('a null setpoint is recorded as null, not as zero', async () => {
    ifl = fakePool([blends, counts, tubes, { needle: mats.needle, rows: [{ ...material, MaterialSetpointWeight: null }] }]);
    const app = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
    await seedProducts(app, ifl, 'PDAS_TP1U2');
    const ins = app.statements.find((s) => s.sql.includes('INSERT INTO sms.product_limit_version'))!;
    expect(ins.inputs.get('sp')).toBeNull();
  });

  /**
   * WS-PERF3, Job 2 (24 Sep 2026). PERFORMANCE-SOURCE-LOAD-2026-09-24.md §1/§2
   * named seedProducts the one query class in the system with no watermark:
   * six unfiltered, unconditional reads of PDAS's reference tables, every
   * single pass, forever, regardless of whether anything changed. This drives
   * seedProducts a SECOND time with nothing different at the source and
   * proves it no longer repeats the full six-table read when nothing moved.
   */
  describe('change detection — does not re-read PDAS in full when nothing changed', () => {
    it('a second call, same source state, reads only the cheap probe — not the six full tables', async () => {
      const iflCall1 = fakePool([blends, counts, tubes, mats, packSchemas, pallets]);
      const appCall1 = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
      await seedProducts(appCall1, iflCall1, 'PDAS_TP1U2');
      // First call, nothing cached yet: the full read happens, as every other
      // test in this file already pins.
      expect(iflCall1.statements.some((s) => s.sql.includes('FROM [PDAS_TP1U2].dbo.Blends'))).toBe(true);

      const iflCall2 = fakePool([blends, counts, tubes, mats, packSchemas, pallets]);
      const appCall2 = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
      await seedProducts(appCall2, iflCall2, 'PDAS_TP1U2');

      // THE regression this test exists to catch: against the old,
      // unconditional code this second call issues the same six full-table
      // SELECTs (and six more MERGEs) even though nothing at the source
      // changed between the two calls.
      expect(iflCall2.statements.some((s) => s.sql.includes('FROM [PDAS_TP1U2].dbo.Blends'))).toBe(false);
      expect(appCall2.statements.some((s) => s.sql.includes('MERGE'))).toBe(false);
    });

    it('probeReferenceMaxIds itself reports the new MAX(id) once a row with a higher id exists', async () => {
      const { probeReferenceMaxIds } = await import('./seedProducts.js');
      const probeNeedle = "UNION ALL SELECT 'Pallets'";
      const before = fakePool([
        { needle: probeNeedle, rows: [
          { tbl: 'Blends', hi: 1 }, { tbl: 'Counts', hi: 2 }, { tbl: 'TubeTypes', hi: 3 },
          { tbl: 'Materials', hi: 21 }, { tbl: 'PackSchemas', hi: 1 }, { tbl: 'Pallets', hi: 21 },
        ] },
      ]);
      const after = fakePool([
        { needle: probeNeedle, rows: [
          { tbl: 'Blends', hi: 1 }, { tbl: 'Counts', hi: 2 }, { tbl: 'TubeTypes', hi: 3 },
          { tbl: 'Materials', hi: 22 }, { tbl: 'PackSchemas', hi: 1 }, { tbl: 'Pallets', hi: 21 },
        ] },
      ]);
      const p1 = await probeReferenceMaxIds(before, '[PDAS_TP1U2]');
      const p2 = await probeReferenceMaxIds(after, '[PDAS_TP1U2]');
      expect(p1.Materials).toBe(21);
      expect(p2.Materials).toBe(22);
      expect(p1).not.toEqual(p2);
      // one round trip, not six
      expect(before.statements).toHaveLength(1);
      expect(before.statements[0]!.sql).toMatch(/UNION ALL SELECT/);
    });

    it('the time-based backstop reads in full again after the refresh window, even with no id change — the gap a MAX(id) probe cannot see (an active-flag flip, a limits edit)', async () => {
      let clock = 1_000_000;
      const iflCall1 = fakePool([blends, counts, tubes, mats, packSchemas, pallets]);
      const appCall1 = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
      await seedProducts(appCall1, iflCall1, 'PDAS_TP1U2', { now: () => clock, fullRefreshMs: 60_000 });

      // Same source state, well within the backstop window: skipped, as the
      // first test in this block already proves generally.
      clock += 10_000;
      const iflCall2 = fakePool([blends, counts, tubes, mats, packSchemas, pallets]);
      const appCall2 = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
      await seedProducts(appCall2, iflCall2, 'PDAS_TP1U2', { now: () => clock, fullRefreshMs: 60_000 });
      expect(iflCall2.statements.some((s) => s.sql.includes('FROM [PDAS_TP1U2].dbo.Blends'))).toBe(false);

      // Past the backstop window, same source state: reads in full again —
      // this is what bounds the staleness of an in-place PDAS edit (an
      // active-flag flip, a limits UPDATE) that never changes any table's
      // MAX(id) and so the probe alone would never notice.
      clock += 60_000;
      const iflCall3 = fakePool([blends, counts, tubes, mats, packSchemas, pallets]);
      const appCall3 = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
      await seedProducts(appCall3, iflCall3, 'PDAS_TP1U2', { now: () => clock, fullRefreshMs: 60_000 });
      expect(iflCall3.statements.some((s) => s.sql.includes('FROM [PDAS_TP1U2].dbo.Blends'))).toBe(true);
    });

    it('a changed probe result forces the full read even well inside the backstop window — seedProducts end to end', async () => {
      const probeNeedle = "UNION ALL SELECT 'Pallets'";
      const probeUnchanged = {
        needle: probeNeedle,
        rows: [
          { tbl: 'Blends', hi: 1 }, { tbl: 'Counts', hi: 2 }, { tbl: 'TubeTypes', hi: 3 },
          { tbl: 'Materials', hi: 21 }, { tbl: 'PackSchemas', hi: 1 }, { tbl: 'Pallets', hi: 21 },
        ],
      };
      const probeChanged = {
        needle: probeNeedle,
        rows: [
          { tbl: 'Blends', hi: 1 }, { tbl: 'Counts', hi: 2 }, { tbl: 'TubeTypes', hi: 3 },
          // A new material was created at PDAS: MaterialId's own MAX moved.
          { tbl: 'Materials', hi: 22 }, { tbl: 'PackSchemas', hi: 1 }, { tbl: 'Pallets', hi: 21 },
        ],
      };
      let clock = 1_000_000;
      const iflCall1 = fakePool([blends, counts, tubes, mats, packSchemas, pallets, probeUnchanged]);
      const appCall1 = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
      await seedProducts(appCall1, iflCall1, 'PDAS_TP1U2', { now: () => clock, fullRefreshMs: 600_000 });

      // Ten seconds later, deep inside the ten-minute backstop window, but
      // the probe now reports a different Materials MAX: the full read must
      // run anyway, not wait for the backstop.
      clock += 10_000;
      const iflCall2 = fakePool([blends, counts, tubes, mats, packSchemas, pallets, probeChanged]);
      const appCall2 = fakePool([{ needle: 'FROM sms.product_limit_version', rows: [] }]);
      await seedProducts(appCall2, iflCall2, 'PDAS_TP1U2', { now: () => clock, fullRefreshMs: 600_000 });
      expect(iflCall2.statements.some((s) => s.sql.includes('FROM [PDAS_TP1U2].dbo.Materials'))).toBe(true);
    });
  });
});

/**
 * Regression, 2e8b470 (Setup's product-limit editor) — found the same day it
 * landed. The `fakePool` above answers a fixed script per SQL needle, blind
 * to the query's own WHERE clause, so it cannot tell the fixed comparison
 * query (`AND source = 'pdas_observed'`) apart from the buggy, unscoped one —
 * both would just be handed the same scripted rows. These tests need a fake
 * that actually evaluates the filter from the SQL text, so a test can fail
 * against the real old code and pass against the real fix.
 *
 * Row shapes below deliberately match productLimits.test.ts's
 * `withLocalChange` catalogue (pdas_observed sp=1960 from 2026-08-01,
 * sms_local sp=1970 from 2026-09-01) — that file already proves a reading
 * before/after 2026-09-01 resolves to the right version given exactly this
 * row set; what these tests add is that a sync pass leaves that row set
 * undisturbed (or correctly extends it), which is the other half of "rule 12
 * holds after a sync pass".
 */
function versionTablePool(
  seedRows: { sp: number | null; om: number | null; op: number | null; effectiveFrom: string; source: string }[],
) {
  const rows = seedRows.map((r, i) => ({ ...r, versionId: i + 1 }));
  const inserts: { sp: unknown; om: unknown; op: unknown; reason: unknown; source: string }[] = [];
  const pool = {
    rows,
    inserts,
    request() {
      const inputs = new Map<string, unknown>();
      return {
        input(name: string, _t: unknown, value: unknown) {
          inputs.set(name, value);
          return this;
        },
        async query(sql: string) {
          if (sql.includes('SELECT TOP 1') && sql.includes('FROM sms.product_limit_version')) {
            // The behaviour under test: whether the query text scopes the
            // comparison to the mirror's own prior observations.
            // Both mirror sources: 'pdas_created' (the material's creation
            // instant, migration 040) and 'pdas_observed' (a later change the
            // mirror noticed) are the two ways this seeder records what PDAS
            // itself holds. 'sms_local' and 'sms_write' are not, and must
            // stay out of the comparison — that IS the regression.
            const scoped = sql.includes("source IN ('pdas_observed', 'pdas_created')");
            const MIRROR = ['pdas_observed', 'pdas_created'];
            const candidates = scoped ? rows.filter((r) => MIRROR.includes(r.source)) : rows;
            const newest = [...candidates].sort(
              (a, b) =>
                new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime() ||
                b.versionId - a.versionId,
            )[0];
            return { recordset: newest ? [{ sp: newest.sp, om: newest.om, op: newest.op }] : [] };
          }
          if (sql.includes('INSERT INTO sms.product_limit_version')) {
            const row = {
              sp: inputs.get('sp') as number | null,
              om: inputs.get('om') as number | null,
              op: inputs.get('op') as number | null,
              // Real code writes SYSUTCDATETIME() — always newer than any
              // fixed 2026-xx-xx literal used in a seed row here.
              effectiveFrom: new Date().toISOString(),
              source: 'pdas_observed',
              versionId: rows.length + 1,
            };
            rows.push(row);
            inserts.push({ sp: row.sp, om: row.om, op: row.op, reason: inputs.get('reason'), source: row.source });
            return { recordset: [] };
          }
          // Every other statement here is a reference-table MERGE; this suite
          // only exercises the limits-history append, so those are no-ops.
          return { recordset: [] };
        },
      };
    },
  };
  return pool as unknown as ConnectionPool & { rows: typeof rows; inserts: typeof inserts };
}

describe('seedProducts — the pdas_observed comparison must not be fooled by an sms_local row (regression, 2e8b470)', () => {
  const blends = { needle: 'FROM [PDAS_TP1U2].dbo.Blends', rows: [] };
  const counts = { needle: 'FROM [PDAS_TP1U2].dbo.Counts', rows: [] };
  const tubes = { needle: 'FROM [PDAS_TP1U2].dbo.TubeTypes', rows: [] };
  const packSchemas = { needle: 'FROM [PDAS_TP1U2].dbo.PackSchemas', rows: [] };
  const pallets = { needle: 'FROM [PDAS_TP1U2].dbo.Pallets', rows: [] };
  // Unchanged from PDAS's point of view for the first test: matches the
  // pdas_observed row seeded below (sp 1960 / om 50 / op 50).
  const materialUnchanged = {
    MaterialId: 20, BlendId: 1, CountId: 2, TubeTypeId: 3, MaterialSetpointWeight: 1960, MaterialActive: true,
    MaterialDesc1: '205-IL0-SD', MaterialDesc2: null, MaterialWeightOffsetMinus: 50, MaterialWeightOffsetPlus: 50,
  };
  // A genuine PDAS change for the second test: differs from BOTH the seeded
  // pdas_observed row (1950) AND the sms_local row (1970), so a false match
  // against either one cannot make this test pass by accident.
  const materialChanged = { ...materialUnchanged, MaterialSetpointWeight: 1990 };

  const seedRowsForRegression = () => [
    { sp: 1960, om: 50, op: 50, effectiveFrom: '2026-08-01T00:00:00.000Z', source: 'pdas_observed' },
    { sp: 1970, om: 50, op: 50, effectiveFrom: '2026-09-01T00:00:00.000Z', source: 'sms_local' },
  ];

  it(
    'an engineer\'s sms_local override that differs from PDAS, with PDAS itself unchanged, ' +
      'survives a sync pass — no superseding row is written',
    async () => {
      const ifl = fakePool([blends, counts, tubes, { needle: 'FROM [PDAS_TP1U2].dbo.Materials', rows: [materialUnchanged] }, packSchemas, pallets]);
      const app = versionTablePool(seedRowsForRegression());

      await seedProducts(app, ifl, 'PDAS_TP1U2');

      // THE regression: against the unscoped (buggy) query this reads back
      // the newest row of ANY source — the sms_local row at sp=1970 — sees it
      // disagree with PDAS's real, unchanged 1960, and wrongly concludes PDAS
      // changed. Scoped to source='pdas_observed' it reads back sp=1960,
      // agrees with PDAS, and writes nothing.
      expect(app.inserts).toHaveLength(0);
      // The engineer's row is still there, still the newest for its window —
      // rule 12 holds because nothing was appended on top of it.
      expect(app.rows).toHaveLength(2);
      expect(app.rows.find((r) => r.source === 'sms_local')?.sp).toBe(1970);
    },
  );

  it('a genuine PDAS change is still recorded even though a newer sms_local row exists — the mirror is not broken by the fix', async () => {
    const ifl = fakePool([blends, counts, tubes, { needle: 'FROM [PDAS_TP1U2].dbo.Materials', rows: [materialChanged] }, packSchemas, pallets]);
    const app = versionTablePool(seedRowsForRegression());

    await seedProducts(app, ifl, 'PDAS_TP1U2');

    expect(app.inserts).toHaveLength(1);
    expect(app.inserts[0]).toMatchObject({ sp: 1990, om: 50, op: 50, source: 'pdas_observed' });
    expect(app.inserts[0]!.reason).toBe('Mirror observed PDAS values differing from the newest recorded version.');
    // The new row is timestamped after the sms_local row (SYSUTCDATETIME() vs
    // the fixed 2026-09-01 literal), so — by the ordinary newest-wins rule
    // every other version already follows, not a special case here — it
    // takes over classification going forward without touching the
    // sms_local row's own effective window. Pinned at the classification
    // layer in productLimits.test.ts ("pdas_observed after an sms_local
    // override...").
    const newest = [...app.rows].sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0];
    expect(newest?.source).toBe('pdas_observed');
    expect(newest?.sp).toBe(1990);
  });
});
