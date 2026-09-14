/**
 * Mirror PDAS reference data into sms.product/blend/yarn_count/tube_type so the
 * Current Product selector (Q1) has real options. Vendor seed rows filtered
 * (MaterialId>10 per SCHEMA rule). Reads PDAS read-only via the IFL pool.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';

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
      `SELECT MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight, MaterialActive, MaterialDesc1, MaterialDesc2,
              MaterialWeightOffsetMinus, MaterialWeightOffsetPlus
       FROM ${db}.dbo.Materials WHERE MaterialId > 10`,
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
                                     weight_offset_minus_g=@om, weight_offset_plus_g=@op, color=@col
       WHEN NOT MATCHED THEN INSERT (product_id, blend_id, count_id, tube_type_id, setpoint_weight_g, active_flag, description, weight_offset_minus_g, weight_offset_plus_g, color)
         VALUES (@id, @b, @c, @tt, @sp, @a, @d, @om, @op, @col);`,
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
  for (const m of mats) {
    const sp = m.MaterialSetpointWeight == null ? null : Number(m.MaterialSetpointWeight);
    const om = m.MaterialWeightOffsetMinus == null ? null : Number(m.MaterialWeightOffsetMinus);
    const op = m.MaterialWeightOffsetPlus == null ? null : Number(m.MaterialWeightOffsetPlus);
    const latest = await appPool
      .request()
      .input('id', mssql.Int, m.MaterialId)
      .query<{ sp: number | null; om: number | null; op: number | null }>(
        `SELECT TOP 1 setpoint_g sp, offset_minus_g om, offset_plus_g op
           FROM sms.product_limit_version WHERE product_id = @id
          ORDER BY effective_from DESC, version_id DESC`,
      );
    const l = latest.recordset[0];
    const same =
      l != null &&
      (l.sp == null ? null : Number(l.sp)) === sp &&
      (l.om == null ? null : Number(l.om)) === om &&
      (l.op == null ? null : Number(l.op)) === op;
    if (same) continue;
    await appPool
      .request()
      .input('id', mssql.Int, m.MaterialId)
      .input('sp', mssql.Decimal(10, 2), sp)
      .input('om', mssql.Decimal(10, 2), om)
      .input('op', mssql.Decimal(10, 2), op)
      .input('reason', mssql.NVarChar(255), l == null
        ? 'First seen by the mirror.'
        : 'Mirror observed PDAS values differing from the newest recorded version.')
      .query(
        `INSERT INTO sms.product_limit_version
           (product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from,
            effective_is_lower_bound, source, reason)
         VALUES (@id, @sp, @om, @op, SYSUTCDATETIME(), 1, 'pdas_observed', @reason)`,
      );
  }
}
