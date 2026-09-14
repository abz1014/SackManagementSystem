/**
 * The PDAS write path — product Add / Retire / Change-limits.
 * (SEPT-2026-EPOCH-DECISION §5.) The ONLY module that holds a writable
 * connection to any IFL database.
 *
 * WHY IT EXISTS. IFL's process engineers currently create and edit products by
 * hand-writing EXECs of the vendor's stored procedures in SSMS; the client
 * confirmed on 2026-09-11 that replacing that with a button in this software
 * is a required deliverable. It is OFF BY DEFAULT (PDAS_WRITE_ENABLED) and stays
 * off until IFL confirms in writing that SMS may write to
 * PDAS_TP1U2.dbo.Materials — §6.2 lists what they must answer first.
 *
 * WHAT THE VENDOR API CAN AND CANNOT DO — all verified from the proc bodies:
 *   - CreateMaterial: INSERT, keyed on (BlendId, CountId, TubeTypeId). Refuses
 *     a duplicate triple with -7001 — and its check IGNORES MaterialActive, so
 *     "retire and re-create with a new setpoint" is impossible for the same
 *     yarn. IFL's own operator proved it on 2026-08-18 (four -7001s in six
 *     minutes, then reactivated the original).
 *   - SetMaterialStatusActive: UPDATE MaterialActive only.
 *   - There is NO proc that changes a setpoint, an offset or a description.
 *   So changing limits is one parameterised, single-row UPDATE on
 *   dbo.Materials, plus one dbo.nhs_events row in the vendor's own format so
 *   their log shows it. MaterialActive is never touched by that UPDATE, so the
 *   vendor's ActiveChanged trigger is a no-op on it.
 *
 * WHAT PDAS DOES NOT KEEP. Materials.Timestamp has DEFAULT getdate() and nothing
 * touches it on UPDATE; neither trigger records old values. PDAS retains no
 * record that a setpoint was ever edited. sms.product_change and
 * sms.product_limit_version are therefore the only audit trail that will exist.
 *
 * RAILS (§5.4): single row or rollback; optimistic concurrency against the
 * before-image the operator was shown (IFL's engineers keep their SQL access,
 * so this is not hypothetical); plausibility bounds; echo-back after commit
 * with a CRITICAL finding on any difference; no DELETE, ever; no other PDAS
 * table; no schema change. Every write goes through the vendor's proc where
 * one exists, and is never a raw INSERT.
 *
 * WE DO NOT WRITE TO MACHINES. Q22 stands. Whether the PLC reads these values
 * live or only when a product is next selected is §6.2's first open question;
 * until answered, treat a limits change as a process-control write.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { PdasWriteConfig } from '../config.js';
import { appendLimitVersion } from './productLimits.js';
import { recordAudit } from './audit.js';

/** The six fields an operator sees and may change on an existing product. */
export interface ProductFields {
  setpointG: number;
  offsetMinusG: number;
  offsetPlusG: number;
  desc1: string | null;
  desc2: string | null;
  active: boolean;
}

export interface Actor {
  userId: number;
  username: string;
}

export type WriteFailure = {
  ok: false;
  code: 'DISABLED' | 'CONFLICT' | 'IMPLAUSIBLE' | 'NOT_FOUND' | 'PDAS_ERROR' | 'ERROR';
  message: string;
  /** The proc's own @error, when it returned one. */
  pdasErrorCode?: number;
};

export type CreateResult = { ok: true; productId: number } | WriteFailure;
export type ActiveResult = { ok: true; productId: number; active: boolean } | WriteFailure;
export type LimitsResult = { ok: true; productId: number; observedAfter: ProductFields } | WriteFailure;

/** Setpoint must be a plausible cone weight; each offset 0 .. setpoint/2. */
export interface SetpointBounds {
  setpointLoG: number;
  setpointHiG: number;
}

const MIN_REASON_CHARS = 10;

/** Words for the vendor's error codes, so the operator is not shown "-7001". */
function explainPdasError(proc: string, code: number, raw: string | null): string {
  switch (code) {
    case -7001:
      return proc === 'CreateMaterial'
        ? 'PDAS already has a product with this blend, count and tube type. It allows only one, ' +
            'active or not — change one of the three, or change the limits on the existing product instead.'
        : 'PDAS has no product with that number.';
    case -7002:
      return 'PDAS rejected the active flag.';
    case -7003:
      return 'PDAS rejected the weights: the setpoint and both offsets must be present and not negative.';
    case -7004:
      return 'PDAS rejected the blend, count or tube type: all three must be chosen.';
    default:
      return raw ? `PDAS refused: ${raw}` : `PDAS refused with code ${code}.`;
  }
}

export class PdasWriter {
  private writer: Promise<ConnectionPool> | null = null;

  constructor(
    private readonly appPool: ConnectionPool,
    private readonly cfg: PdasWriteConfig,
    private readonly lineId: number,
  ) {}

  get enabled(): boolean {
    return this.cfg.enabled && this.cfg.db !== null;
  }

  get disabledReason(): string | null {
    return this.cfg.disabledReason;
  }

  /** Lazily opened: nothing connects to PDAS until a write is attempted. */
  private pool(): Promise<ConnectionPool> {
    if (!this.cfg.db) throw new Error('PDAS write path is disabled');
    if (!this.writer) {
      const db = this.cfg.db;
      this.writer = new mssql.ConnectionPool({
        server: db.server,
        port: db.port,
        database: db.database,
        user: db.user,
        password: db.password,
        options: { encrypt: db.encrypt, trustServerCertificate: db.trustServerCertificate, useUTC: true },
        // Small and short-lived: these are single-row writes by a human, not a sync.
        pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
        requestTimeout: 30_000,
      }).connect();
    }
    return this.writer;
  }

  private disabled(): WriteFailure {
    return {
      ok: false,
      code: 'DISABLED',
      message: this.cfg.disabledReason ?? 'The PDAS write path is not enabled.',
    };
  }

  /** Append-only record of every attempt, successful or not. */
  private async recordChange(c: {
    productId: number | null;
    operation: 'create' | 'set_active' | 'update_limits';
    before: unknown;
    after: unknown;
    observedAfter: unknown;
    outcome: 'ok' | 'conflict' | 'implausible' | 'not_found' | 'disabled' | 'pdas_error' | 'error';
    pdasErrorCode: number | null;
    message: string | null;
    effectiveFrom: Date | null;
    actor: Actor;
    reason: string | null;
  }): Promise<void> {
    await this.appPool
      .request()
      .input('pid', mssql.Int, c.productId)
      .input('op', mssql.VarChar(20), c.operation)
      .input('before', mssql.NVarChar(mssql.MAX), c.before == null ? null : JSON.stringify(c.before))
      .input('after', mssql.NVarChar(mssql.MAX), c.after == null ? null : JSON.stringify(c.after))
      .input('obs', mssql.NVarChar(mssql.MAX), c.observedAfter == null ? null : JSON.stringify(c.observedAfter))
      .input('outcome', mssql.VarChar(20), c.outcome)
      .input('code', mssql.Int, c.pdasErrorCode)
      .input('msg', mssql.NVarChar(500), c.message)
      .input('eff', mssql.DateTime2(3), c.effectiveFrom)
      .input('by', mssql.Int, c.actor.userId)
      .input('reason', mssql.NVarChar(255), c.reason)
      .query(
        `INSERT INTO sms.product_change
           (product_id, operation, before_json, after_json, observed_after_json, outcome,
            pdas_error_code, message, effective_from, changed_by, reason)
         VALUES (@pid, @op, @before, @after, @obs, @outcome, @code, @msg, @eff, @by, @reason)`,
      );
  }

  /** Keep the mirror current now rather than on the next sync pass. */
  private async mirrorProduct(p: {
    productId: number;
    blendId: number;
    countId: number;
    tubeTypeId: number;
    fields: ProductFields;
  }): Promise<void> {
    await this.appPool
      .request()
      .input('id', mssql.Int, p.productId)
      .input('b', mssql.Int, p.blendId)
      .input('c', mssql.Int, p.countId)
      .input('tt', mssql.Int, p.tubeTypeId)
      .input('sp', mssql.Decimal(10, 2), p.fields.setpointG)
      .input('a', mssql.Bit, p.fields.active)
      .input('d', mssql.NVarChar(255), p.fields.desc1)
      .input('om', mssql.Decimal(10, 2), p.fields.offsetMinusG)
      .input('op', mssql.Decimal(10, 2), p.fields.offsetPlusG)
      .input('col', mssql.NVarChar(255), p.fields.desc2)
      .query(
        `MERGE sms.product t USING (SELECT @id id) s ON t.product_id = s.id
         WHEN MATCHED THEN UPDATE SET blend_id=@b, count_id=@c, tube_type_id=@tt, setpoint_weight_g=@sp,
                                      active_flag=@a, description=@d, weight_offset_minus_g=@om,
                                      weight_offset_plus_g=@op, color=@col
         WHEN NOT MATCHED THEN INSERT (product_id, blend_id, count_id, tube_type_id, setpoint_weight_g,
                                       active_flag, description, weight_offset_minus_g, weight_offset_plus_g, color)
              VALUES (@id, @b, @c, @tt, @sp, @a, @d, @om, @op, @col);`,
      );
  }

  private static plausibility(f: ProductFields, b: SetpointBounds): string | null {
    if (!(f.setpointG >= b.setpointLoG && f.setpointG <= b.setpointHiG)) {
      return `Setpoint ${f.setpointG} g is outside the plausible cone range ${b.setpointLoG}–${b.setpointHiG} g.`;
    }
    for (const [name, v] of [
      ['lower offset', f.offsetMinusG],
      ['upper offset', f.offsetPlusG],
    ] as const) {
      if (!(v >= 0 && v <= f.setpointG / 2)) {
        return `The ${name} ${v} g must be between 0 and half the setpoint (${f.setpointG / 2} g).`;
      }
    }
    return null;
  }

  private static checkReason(reason: string): string | null {
    return reason.trim().length >= MIN_REASON_CHARS
      ? null
      : `A reason of at least ${MIN_REASON_CHARS} characters is required.`;
  }

  // ---------------------------------------------------------------- create

  async createProduct(p: {
    blendId: number;
    countId: number;
    tubeTypeId: number;
    fields: ProductFields;
    bounds: SetpointBounds;
    reason: string;
    actor: Actor;
  }): Promise<CreateResult> {
    if (!this.enabled) {
      await this.recordChange({
        productId: null, operation: 'create', before: null, after: p, observedAfter: null,
        outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason, effectiveFrom: null,
        actor: p.actor, reason: p.reason,
      });
      return this.disabled();
    }
    const bad = PdasWriter.checkReason(p.reason) ?? PdasWriter.plausibility(p.fields, p.bounds);
    if (bad) {
      await this.recordChange({
        productId: null, operation: 'create', before: null, after: p, observedAfter: null,
        outcome: 'implausible', pdasErrorCode: null, message: bad, effectiveFrom: null,
        actor: p.actor, reason: p.reason,
      });
      return { ok: false, code: 'IMPLAUSIBLE', message: bad };
    }

    try {
      const pool = await this.pool();
      // The vendor's proc allocates the id, enforces the (blend, count, tube)
      // triple and writes its own nhs_events row. Never a raw INSERT.
      const r = await pool
        .request()
        .input('blendId', mssql.Int, p.blendId)
        .input('countId', mssql.Int, p.countId)
        .input('tubeTypeId', mssql.Int, p.tubeTypeId)
        .input('materialSetpointWeight', mssql.Float, p.fields.setpointG)
        .input('materialWeightOffsetMinus', mssql.Float, p.fields.offsetMinusG)
        .input('materialWeightOffsetPlus', mssql.Float, p.fields.offsetPlusG)
        .input('materialActive', mssql.Bit, p.fields.active)
        .input('materialDesc1', mssql.NVarChar(255), p.fields.desc1 ?? '')
        .input('materialDesc2', mssql.NVarChar(255), p.fields.desc2 ?? '')
        .output('error', mssql.Int, 0)
        .output('errorMsg', mssql.NVarChar(255))
        .output('materialId', mssql.Int)
        .execute('dbo.CreateMaterial');
      const code = Number(r.output.error ?? 0);
      const newId = Number(r.output.materialId ?? r.returnValue);
      if (code !== 0 || !(newId > 0)) {
        const message = explainPdasError('CreateMaterial', code, (r.output.errorMsg as string | null) ?? null);
        await this.recordChange({
          productId: null, operation: 'create', before: null, after: p, observedAfter: null,
          outcome: 'pdas_error', pdasErrorCode: code, message, effectiveFrom: null,
          actor: p.actor, reason: p.reason,
        });
        return { ok: false, code: 'PDAS_ERROR', message, pdasErrorCode: code };
      }

      const now = new Date();
      await this.mirrorProduct({ productId: newId, blendId: p.blendId, countId: p.countId, tubeTypeId: p.tubeTypeId, fields: p.fields });
      await appendLimitVersion(this.appPool, {
        productId: newId,
        setpointG: p.fields.setpointG,
        offsetMinusG: p.fields.offsetMinusG,
        offsetPlusG: p.fields.offsetPlusG,
        effectiveFromUtc: now,
        effectiveIsLowerBound: false,
        source: 'sms_write',
        changedBy: p.actor.userId,
        reason: p.reason,
      });
      await this.recordChange({
        productId: newId, operation: 'create', before: null, after: p.fields, observedAfter: null,
        outcome: 'ok', pdasErrorCode: null, message: null, effectiveFrom: now,
        actor: p.actor, reason: p.reason,
      });
      await recordAudit(
        this.appPool, p.actor.userId, 'product.create', 'product', newId,
        `Created product ${newId}: ${p.fields.setpointG} g ± ${p.fields.offsetMinusG}/${p.fields.offsetPlusG} — ${p.reason}`,
      );
      return { ok: true, productId: newId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({
        productId: null, operation: 'create', before: null, after: p, observedAfter: null,
        outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null, actor: p.actor, reason: p.reason,
      });
      return { ok: false, code: 'ERROR', message };
    }
  }

  // ------------------------------------------------------------ set active

  async setProductActive(p: { productId: number; active: boolean; reason: string; actor: Actor }): Promise<ActiveResult> {
    if (!this.enabled) {
      await this.recordChange({
        productId: p.productId, operation: 'set_active', before: null, after: { active: p.active },
        observedAfter: null, outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason,
        effectiveFrom: null, actor: p.actor, reason: p.reason,
      });
      return this.disabled();
    }
    const bad = PdasWriter.checkReason(p.reason);
    if (bad) return { ok: false, code: 'IMPLAUSIBLE', message: bad };

    try {
      const pool = await this.pool();
      const r = await pool
        .request()
        .input('materialId', mssql.Int, p.productId)
        .input('materialActive', mssql.Bit, p.active)
        .output('error', mssql.Int, 0)
        .output('errorMsg', mssql.NVarChar(255))
        .execute('dbo.SetMaterialStatusActive');
      const code = Number(r.output.error ?? 0);
      if (code !== 0) {
        const message = explainPdasError('SetMaterialStatusActive', code, (r.output.errorMsg as string | null) ?? null);
        await this.recordChange({
          productId: p.productId, operation: 'set_active', before: null, after: { active: p.active },
          observedAfter: null, outcome: code === -7001 ? 'not_found' : 'pdas_error', pdasErrorCode: code,
          message, effectiveFrom: null, actor: p.actor, reason: p.reason,
        });
        return { ok: false, code: code === -7001 ? 'NOT_FOUND' : 'PDAS_ERROR', message, pdasErrorCode: code };
      }
      const now = new Date();
      await this.appPool
        .request()
        .input('id', mssql.Int, p.productId)
        .input('a', mssql.Bit, p.active)
        .query(`UPDATE sms.product SET active_flag = @a WHERE product_id = @id`);
      await this.recordChange({
        productId: p.productId, operation: 'set_active', before: null, after: { active: p.active },
        observedAfter: null, outcome: 'ok', pdasErrorCode: null, message: null, effectiveFrom: now,
        actor: p.actor, reason: p.reason,
      });
      await recordAudit(
        this.appPool, p.actor.userId, p.active ? 'product.activate' : 'product.retire', 'product', p.productId,
        `${p.active ? 'Activated' : 'Retired'} product ${p.productId} — ${p.reason}`,
      );
      return { ok: true, productId: p.productId, active: p.active };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({
        productId: p.productId, operation: 'set_active', before: null, after: { active: p.active },
        observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null,
        actor: p.actor, reason: p.reason,
      });
      return { ok: false, code: 'ERROR', message };
    }
  }

  // --------------------------------------------------------- change limits

  /** Read the six operator-visible fields of one material, inside `req`'s scope. */
  private static async readFields(req: mssql.Request, productId: number): Promise<ProductFields | null> {
    const r = await req.input('id', mssql.Int, productId).query<{
      sp: number; om: number; op: number; d1: string | null; d2: string | null; a: boolean;
    }>(
      `SELECT MaterialSetpointWeight sp, MaterialWeightOffsetMinus om, MaterialWeightOffsetPlus op,
              MaterialDesc1 d1, MaterialDesc2 d2, MaterialActive a
         FROM dbo.Materials WHERE MaterialId = @id`,
    );
    const x = r.recordset[0];
    if (!x) return null;
    return {
      setpointG: Number(x.sp),
      offsetMinusG: Number(x.om),
      offsetPlusG: Number(x.op),
      desc1: x.d1 ?? null,
      desc2: x.d2 ?? null,
      active: Boolean(x.a),
    };
  }

  private static sameFields(a: ProductFields, b: ProductFields): boolean {
    return (
      a.setpointG === b.setpointG &&
      a.offsetMinusG === b.offsetMinusG &&
      a.offsetPlusG === b.offsetPlusG &&
      (a.desc1 ?? '') === (b.desc1 ?? '') &&
      (a.desc2 ?? '') === (b.desc2 ?? '') &&
      a.active === b.active
    );
  }

  async updateProductLimits(p: {
    productId: number;
    /** Exactly the six values the operator was shown. */
    before: ProductFields;
    after: ProductFields;
    bounds: SetpointBounds;
    reason: string;
    actor: Actor;
  }): Promise<LimitsResult> {
    const base = {
      productId: p.productId, operation: 'update_limits' as const, before: p.before, after: p.after,
      actor: p.actor, reason: p.reason,
    };
    if (!this.enabled) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason, effectiveFrom: null });
      return this.disabled();
    }
    // Active is not something this operation changes — that is Retire/Activate,
    // through the vendor's own proc, so its trigger sees a single-row change.
    if (p.after.active !== p.before.active) {
      const message = 'Changing the active flag is a separate action (Retire / Activate).';
      await this.recordChange({ ...base, observedAfter: null, outcome: 'implausible', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'IMPLAUSIBLE', message };
    }
    const bad = PdasWriter.checkReason(p.reason) ?? PdasWriter.plausibility(p.after, p.bounds);
    if (bad) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'implausible', pdasErrorCode: null, message: bad, effectiveFrom: null });
      return { ok: false, code: 'IMPLAUSIBLE', message: bad };
    }

    let pool: ConnectionPool;
    try {
      pool = await this.pool();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'ERROR', message };
    }

    const tx = new mssql.Transaction(pool);
    let committedAt: Date | null = null;
    try {
      await tx.begin();
      await new mssql.Request(tx).query('SET XACT_ABORT ON');

      // Optimistic concurrency: the row must still be what the operator saw.
      const current = await PdasWriter.readFields(new mssql.Request(tx), p.productId);
      if (!current) {
        await tx.rollback();
        const message = `PDAS has no product ${p.productId}.`;
        await this.recordChange({ ...base, observedAfter: null, outcome: 'not_found', pdasErrorCode: null, message, effectiveFrom: null });
        return { ok: false, code: 'NOT_FOUND', message };
      }
      if (!PdasWriter.sameFields(current, p.before)) {
        await tx.rollback();
        const message = 'Someone changed this product since you opened it. Reload and look again before changing it.';
        await this.recordChange({ ...base, observedAfter: current, outcome: 'conflict', pdasErrorCode: null, message, effectiveFrom: null });
        return { ok: false, code: 'CONFLICT', message };
      }

      // Single row, by MaterialId, and asserted: anything but exactly one row
      // is rolled back. MaterialActive deliberately not in the SET list.
      const upd = await new mssql.Request(tx)
        .input('id', mssql.Int, p.productId)
        .input('sp', mssql.Float, p.after.setpointG)
        .input('om', mssql.Float, p.after.offsetMinusG)
        .input('op', mssql.Float, p.after.offsetPlusG)
        .input('d1', mssql.NVarChar(255), p.after.desc1 ?? '')
        .input('d2', mssql.NVarChar(255), p.after.desc2 ?? '')
        .query(
          `UPDATE dbo.Materials
              SET MaterialSetpointWeight = @sp, MaterialWeightOffsetMinus = @om, MaterialWeightOffsetPlus = @op,
                  MaterialDesc1 = @d1, MaterialDesc2 = @d2
            WHERE MaterialId = @id`,
        );
      if ((upd.rowsAffected[0] ?? 0) !== 1) {
        await tx.rollback();
        const message = `Expected to change exactly one row, would have changed ${upd.rowsAffected[0] ?? 0}. Nothing was written.`;
        await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
        return { ok: false, code: 'ERROR', message };
      }

      // The vendor's own event log, in the vendor's own format, so their tools
      // show the change beside the ones their procs write.
      await new mssql.Request(tx)
        .input('src', mssql.NVarChar(510), 'SMS updateProductLimits')
        .input('sev', mssql.NVarChar(10), 'info')
        .input('txt', mssql.NVarChar(mssql.MAX),
          `Update MaterialId: ${p.productId} setpoint ${p.before.setpointG}->${p.after.setpointG} ` +
            `offsets -${p.before.offsetMinusG}/+${p.before.offsetPlusG} -> -${p.after.offsetMinusG}/+${p.after.offsetPlusG} ` +
            `by ${p.actor.username}: ${p.reason}`)
        .query(`INSERT INTO dbo.nhs_events (Src, Severity, Logtext) VALUES (@src, @sev, @txt)`);

      await tx.commit();
      committedAt = new Date();
    } catch (err) {
      try { await tx.rollback(); } catch { /* already rolled back by XACT_ABORT */ }
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'ERROR', message };
    }

    // Echo-back: what PDAS holds now, read outside the transaction. Any
    // difference from what was requested is a CRITICAL finding, not a log line.
    const observed = (await PdasWriter.readFields(pool.request(), p.productId)) ?? p.after;
    const echoOk = PdasWriter.sameFields(observed, p.after);
    if (!echoOk) {
      const detail =
        `Product ${p.productId}: PDAS holds ${JSON.stringify(observed)} after a change that requested ` +
        `${JSON.stringify(p.after)}. The write committed but the row does not read back as written.`;
      await this.appPool
        .request()
        .input('run', mssql.UniqueIdentifier, randomUUID())
        .input('check', mssql.VarChar(64), 'pdas_write_echo_mismatch')
        .input('sev', mssql.VarChar(10), 'CRITICAL')
        .input('tbl', mssql.VarChar(40), 'product')
        .input('detail', mssql.NVarChar(500), detail.slice(0, 500))
        .query(
          `INSERT INTO sms.dq_finding (run_id, check_name, severity, subject_table, detail)
           SELECT @run, @check, @sev, @tbl, @detail
            WHERE NOT EXISTS (SELECT 1 FROM sms.dq_finding WHERE check_name = @check AND detail = @detail)`,
        );
    }

    await this.mirrorProductFields(p.productId, observed);
    await appendLimitVersion(this.appPool, {
      productId: p.productId,
      setpointG: observed.setpointG,
      offsetMinusG: observed.offsetMinusG,
      offsetPlusG: observed.offsetPlusG,
      effectiveFromUtc: committedAt,
      effectiveIsLowerBound: false,
      source: 'sms_write',
      changedBy: p.actor.userId,
      reason: p.reason,
    });
    await this.recordChange({
      ...base, observedAfter: observed, outcome: 'ok', pdasErrorCode: null,
      message: echoOk ? null : 'echo-back differs from request — CRITICAL finding raised', effectiveFrom: committedAt,
    });
    await recordAudit(
      this.appPool, p.actor.userId, 'product.limits', 'product', p.productId,
      `Product ${p.productId}: ${p.before.setpointG} ± ${p.before.offsetMinusG}/${p.before.offsetPlusG} g → ` +
        `${p.after.setpointG} ± ${p.after.offsetMinusG}/${p.after.offsetPlusG} g — ${p.reason}`,
    );
    return { ok: true, productId: p.productId, observedAfter: observed };
  }

  private async mirrorProductFields(productId: number, f: ProductFields): Promise<void> {
    await this.appPool
      .request()
      .input('id', mssql.Int, productId)
      .input('sp', mssql.Decimal(10, 2), f.setpointG)
      .input('om', mssql.Decimal(10, 2), f.offsetMinusG)
      .input('op', mssql.Decimal(10, 2), f.offsetPlusG)
      .input('d', mssql.NVarChar(255), f.desc1)
      .input('col', mssql.NVarChar(255), f.desc2)
      .query(
        `UPDATE sms.product
            SET setpoint_weight_g = @sp, weight_offset_minus_g = @om, weight_offset_plus_g = @op,
                description = @d, color = @col
          WHERE product_id = @id`,
      );
  }

  /** For tests and shutdown. */
  async close(): Promise<void> {
    if (this.writer) {
      const pool = await this.writer.catch(() => null);
      await pool?.close();
      this.writer = null;
    }
  }
}
