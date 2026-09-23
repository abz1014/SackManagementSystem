/**
 * Mirror PDAS reference data into sms.product/blend/yarn_count/tube_type/
 * pack_schema/pallet so the Current Product selector (Q1) and a changeover
 * dry run (migration 036) have real options. Vendor seed rows filtered
 * (MaterialId>10 / PalletId>10 per SCHEMA rule; dbo.PackSchemas carries no
 * such seed noise — both its rows, ids 1 and 2, are real plant data, so it
 * is read unfiltered). Reads PDAS read-only via the IFL pool.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { plantOffsetMinutes } from '@sms/shared';

/**
 * A database NAME is an object identifier, and T-SQL cannot bind identifiers as
 * parameters — so "parameterise it" is not available here. The defensible
 * equivalent is to validate it against a strict identifier pattern and bracket-
 * quote it, which is what this does. The value comes from IFL_DB_NAME_PDAS in
 * .env (operator-controlled, not user input), so this was not exploitable; it is
 * fixed so that CLAUDE.md rule 3 / DEPLOY.md hard rule 3 hold without an
 * unwritten exception, and so a bad .env fails loudly instead of injecting.
 */
function safeDbName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(name)) {
    throw new Error(
      `refusing to build SQL with an unsafe database name: ${JSON.stringify(name)} — ` +
        `IFL_DB_NAME_PDAS must be a plain SQL Server identifier`,
    );
  }
  return `[${name}]`;
}

export async function seedProducts(
  appPool: ConnectionPool,
  iflPool: ConnectionPool,
  pdasDb: string,
): Promise<void> {
  const db = safeDbName(pdasDb);
  // read PDAS reference (read-only login)
  const blends = (await iflPool.request().query(`SELECT BlendId, Blend FROM ${db}.dbo.Blends`)).recordset;
  const counts = (await iflPool.request().query(`SELECT CountId, Count FROM ${db}.dbo.Counts`)).recordset;
  const tubes = (await iflPool.request().query(`SELECT TubeTypeId, TubeType, TubeWeight FROM ${db}.dbo.TubeTypes`)).recordset;
  const mats = (
    await iflPool.request().query(
      // MaterialDesc2 added for finding M10 (Sep 2026 audit): real color data
      // (e.g. 'PARROT', 'Khaki-2' on this line) was silently dropped before —
      // MaterialDesc1 alone was selected and never MaterialDesc2.
      // `Timestamp` added 23 Sep 2026 (migration 040). DEFAULT (getdate()) on
      // PDAS, never listed by CreateMaterial's INSERT and never written by
      // either trigger, so it is the instant that material's row — and
      // therefore its limits — came into existence. See migration 040 for the
      // five checks that establish this, and the limits-history block below
      // for what it is used for.
      `SELECT MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight, MaterialActive, MaterialDesc1, MaterialDesc2,
              MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, Timestamp
       FROM ${db}.dbo.Materials WHERE MaterialId > 10`,
    )
  ).recordset;
  // No id-range seed noise on this table (verified 16 Sep 2026 against the
  // September copy: only PackSchemaId 1 "Pallet 4x5" and 2 "Sack 3x4" exist,
  // both real) — read unfiltered, unlike Materials/Pallets.
  const packSchemas = (
    await iflPool.request().query(
      `SELECT PackSchemaId, PackSchemaDesc, ConesPerLayer, PackTypeId FROM ${db}.dbo.PackSchemas`,
    )
  ).recordset;
  const pallets = (
    await iflPool.request().query(
      // Same vendor-seed convention as Materials (MaterialId > 10): migration
      // 036's mirrored columns and api/src/services/pdasWrite.ts's readPallet
      // (the source of the post-write echo-back MERGE) agree on this exact
      // column list.
      `SELECT PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive,
              PalletDesc1, PalletDesc2, PalletDesc3, PalletDesc4, PalletDesc5, Timestamp
       FROM ${db}.dbo.Pallets WHERE PalletId > 10`,
    )
  ).recordset;

  const up = async (sql: string, binds: (r: mssql.Request) => void) => {
    const r = appPool.request();
    binds(r);
    await r.query(sql);
  };

  for (const b of blends) {
    await up(
      `MERGE sms.blend t USING (SELECT @id id) s ON t.blend_id=s.id
       WHEN MATCHED THEN UPDATE SET blend=@v
       WHEN NOT MATCHED THEN INSERT (blend_id, blend) VALUES (@id, @v);`,
      (r) => { r.input('id', mssql.Int, b.BlendId); r.input('v', mssql.NVarChar(255), b.Blend); },
    );
  }
  for (const c of counts) {
    const asInt = Number.parseInt(String(c.Count), 10);
    await up(
      `MERGE sms.yarn_count t USING (SELECT @id id) s ON t.count_id=s.id
       WHEN MATCHED THEN UPDATE SET count_val=@iv, count_text=@v
       WHEN NOT MATCHED THEN INSERT (count_id, count_val, count_text) VALUES (@id, @iv, @v);`,
      (r) => { r.input('id', mssql.Int, c.CountId); r.input('iv', mssql.Int, Number.isNaN(asInt) ? null : asInt); r.input('v', mssql.NVarChar(255), String(c.Count)); },
    );
  }
  for (const t of tubes) {
    await up(
      `MERGE sms.tube_type t USING (SELECT @id id) s ON t.tube_type_id=s.id
       WHEN MATCHED THEN UPDATE SET tube_type=@v, tube_weight_g=@w
       WHEN NOT MATCHED THEN INSERT (tube_type_id, tube_type, tube_weight_g) VALUES (@id, @v, @w);`,
      (r) => { r.input('id', mssql.Int, t.TubeTypeId); r.input('v', mssql.NVarChar(255), t.TubeType); r.input('w', mssql.Decimal(10, 2), t.TubeWeight); },
    );
  }
  for (const m of mats) {
    await up(
      `MERGE sms.product t USING (SELECT @id id) s ON t.product_id=s.id
       WHEN MATCHED THEN UPDATE SET blend_id=@b, count_id=@c, tube_type_id=@tt, setpoint_weight_g=@sp, active_flag=@a, description=@d,
                                     weight_offset_minus_g=@om, weight_offset_plus_g=@op, color=@col, pdas_created_at=@ts
       WHEN NOT MATCHED THEN INSERT (product_id, blend_id, count_id, tube_type_id, setpoint_weight_g, active_flag, description, weight_offset_minus_g, weight_offset_plus_g, color, pdas_created_at)
         VALUES (@id, @b, @c, @tt, @sp, @a, @d, @om, @op, @col, @ts);`,
      (r) => {
        r.input('id', mssql.Int, m.MaterialId);
        r.input('b', mssql.Int, m.BlendId);
        r.input('c', mssql.Int, m.CountId);
        r.input('tt', mssql.Int, m.TubeTypeId);
        r.input('sp', mssql.Decimal(10, 2), m.MaterialSetpointWeight);
        r.input('a', mssql.Bit, m.MaterialActive);
        r.input('d', mssql.NVarChar(255), m.MaterialDesc1);
        r.input('om', mssql.Decimal(10, 2), m.MaterialWeightOffsetMinus);
        r.input('op', mssql.Decimal(10, 2), m.MaterialWeightOffsetPlus);
        r.input('col', mssql.NVarChar(255), m.MaterialDesc2 || null);
        // pdas_created_at = Materials.Timestamp: PDAS's own getdate(), i.e.
        // the plant wall clock — NOT app UTC (the two-clocks rule). Stored
        // as-is, exactly as sms.pallet.pdas_created_at is; the conversion to
        // a genuine UTC instant happens once, below, where it is compared
        // against app-written time.
        r.input('ts', mssql.DateTime2(3), m.Timestamp ?? null);
      },
    );
  }
  for (const ps of packSchemas) {
    await up(
      `MERGE sms.pack_schema t USING (SELECT @id id) s ON t.pack_schema_id=s.id
       WHEN MATCHED THEN UPDATE SET description=@d, cones_per_layer=@cpl, pack_type_id=@pt
       WHEN NOT MATCHED THEN INSERT (pack_schema_id, description, cones_per_layer, pack_type_id) VALUES (@id, @d, @cpl, @pt);`,
      (r) => {
        r.input('id', mssql.Int, ps.PackSchemaId);
        r.input('d', mssql.NVarChar(255), ps.PackSchemaDesc);
        r.input('cpl', mssql.Int, ps.ConesPerLayer);
        r.input('pt', mssql.Int, ps.PackTypeId);
      },
    );
  }
  for (const p of pallets) {
    await up(
      // Column list matches migration 036's sms.pallet definition and
      // pdasWrite.ts's mirrorPallet echo-back MERGE (:972-980) exactly —
      // both were checked against this statement before it was written.
      `MERGE sms.pallet t USING (SELECT @id id) s ON t.pallet_id=s.id
       WHEN MATCHED THEN UPDATE SET product_id=@pid, pack_schema_id=@ps, lot=@lot, steam_prog=@steam, label_type=@label,
                                     routing=@routing, active_flag=@a, desc1=@d1, desc2=@d2, desc3=@d3, desc4=@d4, desc5=@d5,
                                     pdas_created_at=@ts
       WHEN NOT MATCHED THEN INSERT (pallet_id, product_id, pack_schema_id, lot, steam_prog, label_type, routing, active_flag,
                                     desc1, desc2, desc3, desc4, desc5, pdas_created_at)
         VALUES (@id, @pid, @ps, @lot, @steam, @label, @routing, @a, @d1, @d2, @d3, @d4, @d5, @ts);`,
      (r) => {
        r.input('id', mssql.Int, p.PalletId);
        r.input('pid', mssql.Int, p.MaterialId);
        r.input('ps', mssql.Int, p.PackSchemaId);
        r.input('lot', mssql.NVarChar(255), p.Lot);
        r.input('steam', mssql.Int, p.SteamProg);
        r.input('label', mssql.Int, p.LabelType);
        r.input('routing', mssql.Int, p.Routing);
        r.input('a', mssql.Bit, p.PalletActive);
        r.input('d1', mssql.NVarChar(255), p.PalletDesc1);
        r.input('d2', mssql.NVarChar(255), p.PalletDesc2);
        r.input('d3', mssql.NVarChar(255), p.PalletDesc3);
        r.input('d4', mssql.NVarChar(255), p.PalletDesc4);
        r.input('d5', mssql.NVarChar(255), p.PalletDesc5);
        // pdas_created_at = Pallets.Timestamp: the PDAS server's own
        // getdate(), i.e. the plant wall clock — NOT app UTC (the two-clocks
        // rule, CLAUDE.md). Stored as-is, for ordering/display only; never
        // compared to a UTC instant. Not nullable at the source, so no
        // COALESCE-on-null guard is needed here (unlike the echo-back MERGE,
        // which reads through an optional field).
        r.input('ts', mssql.DateTime2(3), p.Timestamp);
      },
    );
  }

  // Limits HISTORY, not just the mirror. sms.product is overwritten above on
  // every pass, so on its own it cannot say what a product's limits WERE when
  // a reading was taken — and PDAS keeps no history either (Materials.Timestamp
  // is never touched on UPDATE). Whenever the mirrored values differ from the
  // newest recorded version, append a new one. It is a LOWER BOUND on when the
  // change took effect: the mirror noticed it now; it may have happened any
  // time since the last pass. api/src/services/productLimits.ts reads these.
  //
  // REGRESSION FIXED HERE (found the same day it landed, 2e8b470 →
  // setLocalLimitVersion, roadmap Phase 4 item 2). This mirror's only job is
  // to track what PDAS itself says. "Has PDAS changed?" must therefore be
  // answered by comparing PDAS's current values against the newest row THIS
  // MIRROR ITSELF WROTE — source = 'pdas_observed' — never against the newest
  // row of any source. Before this fix the comparison was unscoped: an
  // engineer's 'sms_local' override (deliberately different from PDAS, by
  // design — that is the whole point of a local override) is newer than any
  // 'pdas_observed' row, so the very next sync pass after an engineer edited
  // limits from Setup read that sms_local row back as "the mirror's last
  // known value", saw it disagree with PDAS's unchanged live values, wrongly
  // concluded PDAS had changed, and appended a fresh 'pdas_observed' row
  // stamped now — which then outranked the engineer's row by recency and
  // silently undid the edit within one sync interval (60s). An sms_local row
  // is a deliberate local decision, not evidence about what PDAS holds, and
  // must never feed this comparison.
  //
  // What happens when PDAS genuinely changes AFTER an sms_local override
  // exists (step 2 of the fix): this comparison still only looks at
  // 'pdas_observed' rows, so it still correctly detects the real change and
  // appends a new 'pdas_observed' row — the mirror's job is to report what
  // PDAS now holds, and that must never be suppressed just because a local
  // override happens to exist. That new row is stamped SYSUTCDATETIME(), so
  // by ordinary recency (ProductCatalogue.versionAt — newest effective_from
  // wins) it becomes the version in force for readings from that moment
  // onward, superseding the earlier sms_local override. This is the correct
  // outcome, not a reopening of the bug: the bug was the mirror FABRICATING a
  // change that never happened at PDAS; a genuinely newer, genuinely true
  // observation of PDAS's own master data is real news and is allowed to
  // govern classification going forward, exactly as any other newer version
  // would (SOURCE_PRIORITY only breaks an exact-instant tie — it is not a
  // cross-time precedence rule). Nothing here reclassifies any reading
  // already judged under the sms_local version: that version's effective_from
  // is untouched and still governs every reading between it and the new
  // pdas_observed row (roadmap rule 12).
  //
  // THE FIRST VERSION IS NO LONGER A GUESS (23 Sep 2026, migration 040).
  // Until now a product's first recorded version was stamped
  // SYSUTCDATETIME() — the instant the mirror happened to look — and flagged
  // as a lower bound, because nothing better was known. Something better IS
  // known: PDAS's own `Materials.Timestamp` is the instant that row was
  // inserted, and the row's limits have existed since exactly then. Migration
  // 040 sets out the five checks behind that. So when the material carries a
  // creation instant, the first version is written with THAT as its
  // effective_from, source 'pdas_created', and `effective_is_lower_bound = 0`
  // — a measured date from IFL's own record, not an observation of our own.
  //
  // A reading cannot predate it: `MaterialId` is an IDENTITY and a cone can
  // only carry an id whose row already exists. Verified on source generation
  // 9 (the September copy, real IFL data): all seven products appearing on a
  // cone were created in PDAS before their own first reading.
  //
  // A SUBSEQUENT change is still only a lower bound and still 'pdas_observed'
  // — Materials.Timestamp is NOT touched by an update, so if the values move
  // underneath us the only thing we can honestly say is when we noticed.
  // Hence two sources, not one, and the "has PDAS changed?" comparison below
  // reads BOTH: they are the two ways this mirror records what PDAS itself
  // holds, as against 'sms_local' (an engineer's deliberate local override,
  // which must never feed this comparison — see the long note above) and
  // 'sms_write' (a change we made to PDAS). Leaving 'pdas_created' out of
  // that IN-list would make every pass find no prior mirror row and append a
  // fresh duplicate every 60 seconds.
  for (const m of mats) {
    const sp = m.MaterialSetpointWeight == null ? null : Number(m.MaterialSetpointWeight);
    const om = m.MaterialWeightOffsetMinus == null ? null : Number(m.MaterialWeightOffsetMinus);
    const op = m.MaterialWeightOffsetPlus == null ? null : Number(m.MaterialWeightOffsetPlus);
    const latest = await appPool
      .request()
      .input('id', mssql.Int, m.MaterialId)
      .query<{ sp: number | null; om: number | null; op: number | null }>(
        `SELECT TOP 1 setpoint_g sp, offset_minus_g om, offset_plus_g op
           FROM sms.product_limit_version
          WHERE product_id = @id AND source IN ('pdas_observed', 'pdas_created')
          ORDER BY effective_from DESC, version_id DESC`,
      );
    const l = latest.recordset[0];
    const same =
      l != null &&
      (l.sp == null ? null : Number(l.sp)) === sp &&
      (l.om == null ? null : Number(l.om)) === om &&
      (l.op == null ? null : Number(l.op)) === op;
    if (same) continue;

    const createdAtUtc = l == null ? pdasCreatedAsUtc(m.Timestamp) : null;
    const req = appPool
      .request()
      .input('id', mssql.Int, m.MaterialId)
      .input('sp', mssql.Decimal(10, 2), sp)
      .input('om', mssql.Decimal(10, 2), om)
      .input('op', mssql.Decimal(10, 2), op);

    if (createdAtUtc) {
      await req
        .input('eff', mssql.DateTime2(3), createdAtUtc)
        .input('reason', mssql.NVarChar(255),
          'In force since this material was created in PDAS (dbo.Materials.Timestamp).')
        .query(
          `INSERT INTO sms.product_limit_version
             (product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from,
              effective_is_lower_bound, source, reason)
           VALUES (@id, @sp, @om, @op, @eff, 0, 'pdas_created', @reason)`,
        );
      continue;
    }

    await req
      .input('reason', mssql.NVarChar(255), l == null
        ? 'First seen by the mirror; PDAS records no creation instant for this material.'
        : 'Mirror observed PDAS values differing from the newest recorded version.')
      .query(
        `INSERT INTO sms.product_limit_version
           (product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from,
            effective_is_lower_bound, source, reason)
         VALUES (@id, @sp, @om, @op, SYSUTCDATETIME(), 1, 'pdas_observed', @reason)`,
      );
  }
}

/**
 * `Materials.Timestamp` as a genuine UTC instant, for storing in
 * product_limit_version.effective_from.
 *
 * THE TWO CLOCKS. Timestamp is PDAS's own `getdate()` — the plant's wall
 * clock — while effective_from is defined as a genuine UTC instant, which
 * productLimits.ts converts back through toPlantMs() before comparing it
 * against a reading. So the plant offset must come OFF here, or the version
 * would take effect five hours late on this plant and a changeover's readings
 * would be judged against the previous material's limits.
 *
 * Exported for the test beside this file: this conversion is the one piece of
 * arithmetic in the limits-provenance path that a wrong sign would make
 * silently, plausibly wrong rather than loudly broken.
 */
export function pdasCreatedAsUtc(timestamp: Date | string | null | undefined): Date | null {
  if (timestamp == null) return null;
  const plantMs = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  if (!Number.isFinite(plantMs)) return null;
  return new Date(plantMs - plantOffsetMinutes(new Date(plantMs)) * 60_000);
}
