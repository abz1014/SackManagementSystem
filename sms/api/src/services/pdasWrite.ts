/**
 * The PDAS write path — product Add / Retire / Change-limits.
 * (SEPT-2026-EPOCH-DECISION §5.) The ONLY module that holds a writable
 * connection to any IFL database.
 *
 * WHY IT EXISTS. IFL's process engineers currently create and edit products by
 * hand-writing EXECs of the vendor's stored procedures in SSMS; the client
 * confirmed on 2026-09-11 that replacing that with a button in this software
 * is a required deliverable. It is OFF BY DEFAULT (PDAS_WRITE_ENABLED=false) and
 * stays off until the local end-to-end proof passes — §6.2 lists what that
 * needs. IFL's written grant to write to PDAS_TP1U2.dbo.Materials was given
 * 19 Sep 2026 (DEFECTS.md D-12, handover/PDAS-WRITE-GRANT-2026-09-19.md); the
 * flag staying false is a build-readiness gate now, not a wait on IFL.
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
 * WE DO NOT WRITE TO MACHINES. Q22 stands. IFL answered §6.2's first question
 * on 15 Sep 2026: the QCS panel fetches a material's setpoint and offsets at
 * the moment the operator selects it on the machine (FuncGetConeWeight in the
 * panel's own event log), so a limits change reaches a machine on the next
 * reselect. It is still a process-control write and is treated as one.
 *
 * THE WHOLE PROCEDURE, NOT THREE OPERATIONS OF IT (roadmap Phase 6 completed,
 * Wave F, 15 Sep 2026). IFL's SOP "QCS ID Creation by P-DAS" runs, in SSMS:
 * GetAllBlends/Counts/TubeTypes → AddBlend/AddCount/AddTubeType for anything
 * missing → CreateMaterial → CreatePallet (material, pack schema 1, lot,
 * active, PalletDesc1 = sack colour) → SetMaterialStatusActive 0 /
 * SetPalletStatusActive 0 on what it replaces. The panel then lists active
 * materials AND active pallets, and the operator selects both on the machine.
 * Five operations were added for the steps this file did not cover, each the
 * same shape as the first three: flag check first, the vendor's proc with its
 * OUTPUT @error/@errorMsg, an echo-back read of the row PDAS now holds, the
 * app-side mirror refreshed, and one sms.product_change row whatever happened.
 * Verified from the proc bodies in PDAS_TP1U2_SEP07 (read-only, 15 Sep 2026).
 * The 16 Sep 2026 introspection task could not confirm AddTubeType's own
 * signature this way (see below); a 21 Sep 2026 follow-up did, by a different
 * route — see the AddTubeType bullet below and PROC_PARAMS' own comment:
 *   - AddBlend / AddCount: INSERT, duplicate check `name LIKE @name` (so the
 *     vendor's own compare is case-insensitive and treats '_' and '%' as
 *     wildcards), -4001/-6001 "already exist", -4004/-6004 "empty" — a check
 *     written `= NULL` that can never fire; the empty case is refused here.
 *   - AddTubeType: `@tubeForm int = 0` whose own validation refuses 0 (-5002:
 *     must be 1 or 2), so a form is always passed; -5001 duplicate (name AND
 *     form), -5003 weight <= 0. 26 of the 27 tube types on this line are form
 *     2. Its OUTPUT parameter is bound below as `@typeTypeId` — presumed to be
 *     the vendor's own typo, by analogy with every other Add* proc's pattern.
 *     No screenshot of it exists (Desktop/SPS unzip/SPS/*.jpg has one for each
 *     of the other six), and the 16 Sep 2026 introspection attempt against
 *     PDAS_TP1U2_SEP07 found that IFL_DB_USER holds only db_datareader there
 *     — no EXECUTE/VIEW DEFINITION on any procedure — so sys.parameters and
 *     OBJECT_DEFINITION returned nothing for it, or for any of the twelve
 *     (scripts/pdas-introspect.mjs; the grant that would fix this is proposed,
 *     not applied, at db/bootstrap/11_pdas_procedure_metadata.template.sql).
 *     **VERIFIED 21 Sep 2026 by a different route:** a direct Windows-auth
 *     (`sqlcmd -E`, read-only) query of `sys.procedures`/`sys.parameters`/
 *     `sys.types` on `PDAS_TP1U2_SEP07` reads the system catalogue directly
 *     and needs no `db_datareader`-level grant at all, so the proposed
 *     template grant above was never required for this purpose (it may still
 *     matter for the plant's own `sms_readonly`, which is a separate
 *     question). The result was an exact match, in name and parameter order,
 *     to `PROC_PARAMS.AddTubeType` below — `typeTypeId` is confirmed, not
 *     presumed. That 21 Sep verification was signature-only, from
 *     sys.parameters — it did not run the procedure and said so.
 *     **UPDATE, 23 Sep 2026 (PDAS-EXECUTION-2026-09-23.md, WS-PDAS1/WS-PDAS2,
 *     owner-authorised):** AddTubeType and CreateMaterial were then actually
 *     executed — the first PDAS procedure executions in this project's
 *     history — against the local `PDAS_TP1U2_SEP07` copy ONLY, never the
 *     plant, via `sqlcmd -E` under the current Windows identity (not this
 *     app's own connection path). A proven-restorable backup was taken
 *     first and the copy was restored to its exact pre-execution state
 *     afterwards. `PDAS_WRITE_ENABLED` was not touched and stays `false`;
 *     `/api/changeover/execute` was never called; no `sms_pdas_writer`
 *     login exists, so this module's own code path remains unexercised.
 *     The -5001/-5002/-5003 codes above were observed firing exactly as the
 *     proc body predicts (AddTubeType's uniqueness check is (TubeType,
 *     TubeForm) together). See PDAS-EXECUTION-2026-09-23.md for the
 *     verbatim inputs/outputs.
 *   - CreatePallet: INSERT keyed on (MaterialId, PackSchemaId, Lot), -8001
 *     "Pallet already exist" regardless of PalletActive, -8004 when material,
 *     schema or lot is empty, -8002 bad active bit; @labelType defaults to 1
 *     and every real pallet on this line has 1.
 *   - SetPalletStatusActive: UPDATE PalletActive only; -8001 = no such pallet
 *     (the same code CreatePallet uses for a duplicate — explained per proc).
 * The orchestration of those steps is services/changeover.ts; this file only
 * knows how to perform one step safely.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { PdasWriteConfig } from '../config.js';
import { appendLimitVersion } from './productLimits.js';
import { recordAudit } from './audit.js';

/**
 * The only seven vendor procedures this module ever calls, and the only
 * values `execProc`'s `proc` parameter accepts (see execProc below) — a
 * procedure identifier can never come from anywhere else.
 */
export type VendorProc =
  | 'CreateMaterial'
  | 'SetMaterialStatusActive'
  | 'AddBlend'
  | 'AddCount'
  | 'AddTubeType'
  | 'CreatePallet'
  | 'SetPalletStatusActive';

/**
 * Every parameter each vendor procedure declares — the ground truth this
 * whole file's `.input()` / `.output()` calls must stay a subset of (see
 * pdasWrite.test.ts's "proc bindings match PROC_PARAMS" test, which exercises
 * every method through a fake writer pool and checks exactly that).
 *
 * PROVENANCE, per procedure, from the 16 Sep 2026 PDAS introspection task:
 *
 *   - CreateMaterial, SetMaterialStatusActive, AddBlend, AddCount,
 *     CreatePallet, SetPalletStatusActive — READ DIRECTLY off the real plant
 *     server's own metadata: SSMS's "Execute Procedure..." parameter grid
 *     (which SSMS builds from sys.parameters, exactly what this task's own
 *     script queries), captured 7 Sep 2026 against TP1-PDAS\PDAS as
 *     screenshots at Desktop/SPS unzip/SPS/*.jpg ("Create Material Proc.jpg",
 *     "Add blend proc.jpg", "Add Count.jpg", "Create Pallet.jpg",
 *     "Set Material Active.jpg", "Set PalletStatus.jpg"). This is what
 *     PROVED CreateMaterial has five @materialDesc parameters, not two —
 *     the code bound only materialDesc1/2 until this task (see createProduct
 *     above). Every OTHER parameter on these six procedures — names, types,
 *     which are OUTPUT — matches what the code already bound; nothing else
 *     changed.
 *   - AddTubeType — NOT confirmed by the 16 Sep 2026 task. No screenshot of it
 *     exists, and sms/scripts/pdas-introspect.mjs (SELECT-only, against the
 *     local PDAS_TP1U2_SEP07 copy, using the existing read-only IFL_DB_*
 *     login) could not read it either: that login holds only db_datareader
 *     there — by design, per db/bootstrap/10_ifl_readonly_login.template.sql —
 *     which carries no EXECUTE / VIEW DEFINITION on ANY procedure, so
 *     sys.parameters and OBJECT_DEFINITION returned nothing for all twelve
 *     procedures alike, not just this one
 *     (db/bootstrap/11_pdas_procedure_metadata.template.sql proposes the
 *     metadata-only grant that would fix this; it has not been applied). The
 *     three input names (tubeType, tubeForm, tubeWeight) follow the pattern
 *     every confirmed Add* proc uses and were never in question.
 *     **VERIFIED 21 Sep 2026**, closing this gap by a route that needed no
 *     new grant: a Windows-authenticated (`sqlcmd -E`, read-only) query of
 *     `sys.procedures` joined to `sys.parameters` and `sys.types` on
 *     `PDAS_TP1U2_SEP07` reads the system catalogue directly, bypassing the
 *     `IFL_DB_USER` login's `db_datareader`-only grant entirely — this is
 *     what the 16 Sep task lacked, not a missing server-side grant. Result:
 *     `@error int OUTPUT, @errorMsg nvarchar(255) OUTPUT, @typeTypeId int
 *     OUTPUT, @tubeType nvarchar(255), @tubeForm int, @tubeWeight float`, in
 *     that parameter_id order — an exact match to the binding below. The
 *     OUTPUT id name 'typeTypeId' is now CONFIRMED as the vendor's own typo,
 *     not merely presumed. That confirmed the procedure's SIGNATURE only;
 *     runtime behaviour was still just read from the proc body as of 21 Sep.
 *     **UPDATE, 23 Sep 2026:** AddTubeType has since been executed —
 *     against the local `PDAS_TP1U2_SEP07` copy only, never the plant, never
 *     through this app's own connection path (no `sms_pdas_writer` login
 *     exists), under explicit owner authorisation, with a proven-restorable
 *     backup taken first and the copy restored afterwards.
 *     `PDAS_WRITE_ENABLED` remains `false`. The binding below (parameter
 *     names, order and OUTPUT flags) is now confirmed both by signature and
 *     by a successful call plus a refused duplicate, matching exactly. See
 *     PDAS-EXECUTION-2026-09-23.md (repo root) for the verbatim inputs and
 *     outputs and CLAUDE.md's dated section for the summary.
 *
 * has_default_value could not be read for any procedure (same permission gap)
 * — CreateMaterial is called with all five @materialDesc parameters bound
 * explicitly for exactly that reason: it is correct whether or not defaults
 * exist, so the missing evidence does not block the fix.
 */
export const PROC_PARAMS: Record<VendorProc, readonly string[]> = {
  CreateMaterial: [
    'error', 'errorMsg', 'materialId',
    'blendId', 'countId', 'tubeTypeId',
    'materialSetpointWeight', 'materialWeightOffsetMinus', 'materialWeightOffsetPlus',
    'materialActive',
    'materialDesc1', 'materialDesc2', 'materialDesc3', 'materialDesc4', 'materialDesc5',
  ],
  SetMaterialStatusActive: ['error', 'errorMsg', 'materialId', 'materialActive'],
  AddBlend: ['error', 'errorMsg', 'blendId', 'blend'],
  AddCount: ['error', 'errorMsg', 'countId', 'count'],
  // Signature confirmed 21 Sep 2026, executed (local copy only) 23 Sep 2026 — see the provenance note above.
  AddTubeType: ['error', 'errorMsg', 'typeTypeId', 'tubeType', 'tubeForm', 'tubeWeight'],
  CreatePallet: [
    'error', 'errorMsg', 'palletId',
    'materialId', 'packSchemaId', 'lot', 'steamProg', 'labelType', 'routing', 'palletActive',
    'palletDesc1', 'palletDesc2', 'palletDesc3', 'palletDesc4', 'palletDesc5',
  ],
  SetPalletStatusActive: ['error', 'errorMsg', 'palletId', 'palletActive'],
};

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

/* ---- Phase 6: the reference rows and the pallet (Wave F, 15 Sep 2026) ---- */

export type AddBlendResult = { ok: true; blendId: number } | WriteFailure;
export type AddCountResult = { ok: true; countId: number } | WriteFailure;
export type AddTubeTypeResult = { ok: true; tubeTypeId: number } | WriteFailure;
export type CreatePalletResult = { ok: true; palletId: number } | WriteFailure;
export type PalletActiveResult = { ok: true; palletId: number; active: boolean } | WriteFailure;

/** PDAS TubeTypes.TubeForm: the proc accepts 1 or 2 and nothing else. What the two codes mean is not in the database. */
export type TubeForm = 1 | 2;

/** What CreatePallet takes. Defaults match the proc's own and every real pallet on this line. */
export interface PalletFields {
  productId: number;
  packSchemaId: number;
  lot: string;
  active: boolean;
  /** PalletDesc1 = the sack colour, per IFL's SOP. */
  desc1: string | null;
  desc2?: string | null;
  desc3?: string | null;
  desc4?: string | null;
  desc5?: string | null;
  steamProg?: number;
  labelType?: number;
  routing?: number;
}

/** A writer pool can be injected so the proc calls run over a fake in tests; production opens the real one lazily. */
export interface PdasWriterOptions {
  writerPool?: () => Promise<ConnectionPool>;
}

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
    // AddBlend (-4xxx), AddTubeType (-5xxx), AddCount (-6xxx) — each proc's own
    // range, verified from the bodies. Their duplicate check is `LIKE`, so a
    // name that differs only in case, or by a character where the existing
    // name has '_', is "already there" to PDAS.
    case -4001:
      return 'PDAS already has a blend with this name (it compares names case-insensitively, and an underscore matches any one character). Choose the existing blend instead.';
    case -4004:
      return 'PDAS rejected the blend: the name is empty.';
    case -6001:
      return 'PDAS already has a count with this name (compared case-insensitively). Choose the existing count instead.';
    case -6004:
      return 'PDAS rejected the count: the name is empty.';
    case -5001:
      return 'PDAS already has a tube type with this name and form (compared case-insensitively). Choose the existing tube type instead.';
    case -5002:
      return 'PDAS rejected the tube form: it must be 1 or 2.';
    case -5003:
      return 'PDAS rejected the tube weight: it must be more than zero.';
    case -5004:
      return 'PDAS rejected the tube type: the name is empty.';
    // CreatePallet and SetPalletStatusActive share -8001 with opposite meanings.
    case -8001:
      return proc === 'CreatePallet'
        ? 'PDAS already has a pallet for this material, pack schema and lot. It allows only one, active or not — ' +
            'change the lot, or activate the existing pallet instead.'
        : 'PDAS has no pallet with that number.';
    case -8002:
      return 'PDAS rejected the active flag.';
    case -8004:
      return 'PDAS rejected the pallet: the material, the pack schema and the lot are all required.';
    default:
      return raw ? `PDAS refused: ${raw}` : `PDAS refused with code ${code}.`;
  }
}

/** The operations sms.product_change records (migration 027, widened by 036). */
export type ChangeOperation =
  | 'create' | 'set_active' | 'update_limits'
  | 'add_blend' | 'add_count' | 'add_tube_type' | 'create_pallet' | 'set_pallet_active';
export type ChangeOutcome = 'ok' | 'conflict' | 'implausible' | 'not_found' | 'disabled' | 'pdas_error' | 'error' | 'mismatch';

/** The vendor's duplicate checks use LIKE; a '%' or '[' in a name would match anything. Refused here, never sent. */
function checkName(what: string, value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return `The ${what} is empty.`;
  if (v.length > 255) return `The ${what} is longer than 255 characters.`;
  if (/[%[]/.test(v)) return `The ${what} must not contain '%' or '[' — PDAS compares names with LIKE, and either would match everything.`;
  return null;
}

export class PdasWriter {
  private writer: Promise<ConnectionPool> | null = null;

  constructor(
    private readonly appPool: ConnectionPool,
    private readonly cfg: PdasWriteConfig,
    private readonly lineId: number,
    private readonly opts: PdasWriterOptions = {},
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
    if (this.opts.writerPool) return this.opts.writerPool();
    if (!this.writer) {
      const db = this.cfg.db;
      const connecting = new mssql.ConnectionPool({
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
      // R-1 fix: a failed connect must not poison every future write attempt.
      // Without this, a transient PDAS outage cached the rejected promise
      // forever (until process restart or an explicit close()), so every
      // subsequent write failed immediately without ever retrying the
      // connection once PDAS came back.
      connecting.catch(() => {
        if (this.writer === connecting) this.writer = null;
      });
      this.writer = connecting;
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
    operation: ChangeOperation;
    before: unknown;
    after: unknown;
    observedAfter: unknown;
    outcome: ChangeOutcome;
    pdasErrorCode: number | null;
    message: string | null;
    effectiveFrom: Date | null;
    actor: Actor;
    reason: string | null;
    /** Phase 6 (migration 036): the pallet a pallet row is about, and the vendor proc executed. */
    palletId?: number | null;
    procName?: string | null;
  }): Promise<void> {
    await this.appPool
      .request()
      .input('pid', mssql.Int, c.productId)
      .input('pallet', mssql.Int, c.palletId ?? null)
      .input('proc', mssql.VarChar(40), c.procName ?? null)
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
           (product_id, pallet_id, proc_name, operation, before_json, after_json, observed_after_json, outcome,
            pdas_error_code, message, effective_from, changed_by, reason)
         VALUES (@pid, @pallet, @proc, @op, @before, @after, @obs, @outcome, @code, @msg, @eff, @by, @reason)`,
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
        // CreateMaterial has FIVE @materialDesc parameters, not two (confirmed
        // 16 Sep 2026 — see PROC_PARAMS below). ProductFields only carries
        // desc1/desc2 (the two IFL's own SOP populates), so 3-5 are bound to
        // an empty string, matching IFL's own runbook practice rather than
        // leaving mssql to fail the call over parameters this app has no value
        // for. Before this fix these three were never bound at all.
        .input('materialDesc3', mssql.NVarChar(255), '')
        .input('materialDesc4', mssql.NVarChar(255), '')
        .input('materialDesc5', mssql.NVarChar(255), '')
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
      // R-2 fix: the vendor proc has already committed the new material in
      // PDAS by this point (newId is real). Bookkeeping from here on is
      // this app's own follow-up, not the write itself — a failure here must
      // not be recorded (or returned) as though the PDAS write failed, or a
      // caller retrying "the failed create" would hit CreateMaterial's own
      // duplicate refusal against a product that in fact already exists.
      try {
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
      } catch (bookkeepingErr) {
        const bkMessage = bookkeepingErr instanceof Error ? bookkeepingErr.message : String(bookkeepingErr);
        // Best-effort: still record the change as the successful PDAS write
        // it was, with the bookkeeping gap named in the message, rather than
        // as 'error' (which would misleadingly imply the write itself
        // failed). Swallow a failure here too — we already have newId and
        // must still return it to the caller either way.
        await this.recordChange({
          productId: newId, operation: 'create', before: null, after: p.fields, observedAfter: null,
          outcome: 'ok', pdasErrorCode: null,
          message: `PDAS write succeeded (product ${newId}) but local bookkeeping failed: ${bkMessage}`,
          effectiveFrom: now, actor: p.actor, reason: p.reason,
        }).catch(() => {});
      }
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
    // B2 fix: this check read used to be unguarded — a failure here (e.g. no
    // SELECT on dbo.Materials for an EXECUTE-only role) threw out of the
    // route entirely (500, no sms.product_change row) for an UPDATE that had
    // already committed. It is now the app's own follow-up, caught on its
    // own, never conflated with the write itself failing.
    let observed: ProductFields;
    let checkReadFailed = false;
    let checkErrMessage = '';
    let echoOk = true;
    try {
      observed = (await PdasWriter.readFields(pool.request(), p.productId)) ?? p.after;
      echoOk = PdasWriter.sameFields(observed, p.after);
      if (!echoOk) {
        await this.raiseEchoMismatch(
          'product',
          `Product ${p.productId}: PDAS holds ${JSON.stringify(observed)} after a change that requested ` +
            `${JSON.stringify(p.after)}. The write committed but the row does not read back as written.`,
        );
      }
    } catch (checkErr) {
      checkReadFailed = true;
      checkErrMessage = checkErr instanceof Error ? checkErr.message : String(checkErr);
      observed = p.after;
      await this.raiseReadbackFailed(
        'product',
        `Product ${p.productId}: updateProductLimits committed but the follow-up check read failed: ${checkErrMessage}`,
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
      message: checkReadFailed
        ? `updateProductLimits committed but the follow-up check read failed: ${checkErrMessage}`
        : echoOk ? null : 'echo-back differs from request — CRITICAL finding raised',
      effectiveFrom: committedAt,
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

  /* ================================================================== Phase 6
   * The reference rows (blend, count, tube type) and the pallet — the steps
   * of IFL's procedure the three operations above did not cover. Same rails:
   * flag first, plausibility before any connection, the vendor's proc and
   * never a raw INSERT, an echo-back read, the mirror refreshed, and one
   * product_change row for every attempt. See the file header for what each
   * proc was verified to do.
   */

  /**
   * One row in sms.dq_finding, deduped on the detail text. check_name is
   * VARCHAR(64) free text (no CHECK constraint — verified against
   * 009_dq_finding.sql before adding a second name here), so a second
   * check_name alongside 'pdas_write_echo_mismatch' needs no migration.
   */
  private async raiseDqFinding(
    checkName: string,
    severity: 'WARNING' | 'CRITICAL',
    subjectTable: 'product' | 'pallet' | 'blend' | 'yarn_count' | 'tube_type',
    detail: string,
  ): Promise<void> {
    await this.appPool
      .request()
      .input('run', mssql.UniqueIdentifier, randomUUID())
      .input('check', mssql.VarChar(64), checkName)
      .input('sev', mssql.VarChar(10), severity)
      .input('tbl', mssql.VarChar(40), subjectTable)
      .input('detail', mssql.NVarChar(500), detail.slice(0, 500))
      .query(
        `INSERT INTO sms.dq_finding (run_id, check_name, severity, subject_table, detail)
         SELECT @run, @check, @sev, @tbl, @detail
          WHERE NOT EXISTS (SELECT 1 FROM sms.dq_finding WHERE check_name = @check AND detail = @detail)`,
      );
  }

  /**
   * A CRITICAL finding when the row PDAS holds after a committed write is not
   * what was requested.
   */
  private async raiseEchoMismatch(subjectTable: 'product' | 'pallet' | 'blend' | 'yarn_count' | 'tube_type', detail: string): Promise<void> {
    await this.raiseDqFinding('pdas_write_echo_mismatch', 'CRITICAL', subjectTable, detail);
  }

  /**
   * B1/B2 fix: a WARNING finding when the vendor proc committed the write but
   * the app's own follow-up check-read (echo-back SELECT) then failed — e.g.
   * the plant's EXECUTE-only role has no SELECT on the PDAS table. This is
   * NOT a mismatch (we never learned what PDAS holds), so it is a different,
   * lower-severity check_name than raiseEchoMismatch's, and it must never be
   * conflated with a proc-level failure: the row really was written.
   */
  private async raiseReadbackFailed(subjectTable: 'product' | 'pallet' | 'blend' | 'yarn_count' | 'tube_type', detail: string): Promise<void> {
    await this.raiseDqFinding('pdas_write_readback_failed', 'WARNING', subjectTable, detail);
  }

  /**
   * Execute one vendor proc that answers through OUTPUT @error/@errorMsg and
   * (for the creates) an OUTPUT id. `idParam` is the proc's own name for that
   * parameter — AddTubeType's is bound as `typeTypeId`, the vendor's own
   * typo, CONFIRMED 21 Sep 2026 (see the file header and PROC_PARAMS) — and
   * mssql binds by name so it must be spelled the vendor's way.
   *
   * `proc` is a `VendorProc`, not `string`: the only seven names that may ever
   * reach `dbo.${proc}` below are the module's own literals, never a value
   * built or passed in from outside it.
   */
  private async execProc(
    proc: VendorProc,
    bind: (r: mssql.Request) => mssql.Request,
    idParam: string | null,
  ): Promise<{ code: number; raw: string | null; id: number | null }> {
    const pool = await this.pool();
    let req = pool.request().output('error', mssql.Int, 0).output('errorMsg', mssql.NVarChar(255));
    if (idParam) req = req.output(idParam, mssql.Int);
    const r = await bind(req).execute(`dbo.${proc}`);
    const code = Number(r.output.error ?? 0);
    const raw = (r.output.errorMsg as string | null) ?? null;
    // The creates RETURN the new id as well as setting the OUTPUT; either is fine.
    const outId = idParam ? r.output[idParam] : undefined;
    const id = outId != null && Number(outId) > 0 ? Number(outId) : r.returnValue != null && Number(r.returnValue) > 0 ? Number(r.returnValue) : null;
    return { code, raw, id };
  }

  // ------------------------------------------------------------- add blend

  async addBlend(p: { blend: string; reason: string; actor: Actor }): Promise<AddBlendResult> {
    const base = { productId: null, operation: 'add_blend' as const, procName: 'AddBlend', before: null, after: { blend: p.blend }, actor: p.actor, reason: p.reason };
    if (!this.enabled) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason, effectiveFrom: null });
      return this.disabled();
    }
    const bad = PdasWriter.checkReason(p.reason) ?? checkName('blend name', p.blend);
    if (bad) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'implausible', pdasErrorCode: null, message: bad, effectiveFrom: null });
      return { ok: false, code: 'IMPLAUSIBLE', message: bad };
    }
    const blend = p.blend.trim();
    try {
      const r = await this.execProc('AddBlend', (q) => q.input('blend', mssql.NVarChar(255), blend), 'blendId');
      if (r.code !== 0 || r.id == null) {
        const message = explainPdasError('AddBlend', r.code, r.raw);
        await this.recordChange({ ...base, observedAfter: null, outcome: 'pdas_error', pdasErrorCode: r.code, message, effectiveFrom: null });
        return { ok: false, code: 'PDAS_ERROR', message, pdasErrorCode: r.code };
      }
      const now = new Date();
      const pool = await this.pool();
      // B1 fix: AddBlend has already committed (r.id is real). This
      // check-read is the app's own follow-up, not the write itself — a
      // permission-denied (or any) failure here must not be reported as
      // though the write failed, or a retry would hit AddBlend's own
      // duplicate refusal (-4001) against a blend that already exists.
      let observed: string | null = null;
      let checkReadFailed = false;
      let checkErrMessage = '';
      let echoOk = false;
      try {
        const echo = await pool.request().input('id', mssql.Int, r.id).query<{ Blend: string }>(`SELECT Blend FROM dbo.Blends WHERE BlendId = @id`);
        observed = echo.recordset[0]?.Blend ?? null;
        echoOk = observed != null && observed.trim() === blend;
        if (!echoOk) {
          await this.raiseEchoMismatch('blend', `Blend ${r.id}: PDAS holds ${JSON.stringify(observed)} after AddBlend requested ${JSON.stringify(blend)}.`);
        }
      } catch (checkErr) {
        checkReadFailed = true;
        checkErrMessage = checkErr instanceof Error ? checkErr.message : String(checkErr);
        await this.raiseReadbackFailed('blend', `Blend ${r.id}: AddBlend committed but the follow-up check read failed: ${checkErrMessage}`);
      }
      await this.appPool
        .request()
        .input('id', mssql.Int, r.id)
        .input('v', mssql.NVarChar(255), observed ?? blend)
        .query(
          `MERGE sms.blend t USING (SELECT @id id) s ON t.blend_id=s.id
           WHEN MATCHED THEN UPDATE SET blend=@v
           WHEN NOT MATCHED THEN INSERT (blend_id, blend) VALUES (@id, @v);`,
        );
      await this.recordChange({
        ...base, observedAfter: { blendId: r.id, blend: observed }, outcome: checkReadFailed ? 'ok' : echoOk ? 'ok' : 'mismatch', pdasErrorCode: null,
        message: checkReadFailed
          ? `AddBlend committed (blend ${r.id}) but the follow-up check read failed: ${checkErrMessage}`
          : echoOk ? null : 'echo-back differs from request — CRITICAL finding raised',
        effectiveFrom: now,
      });
      await recordAudit(this.appPool, p.actor.userId, 'product.add_blend', 'blend', r.id, `Added blend ${r.id} "${blend}" — ${p.reason}`);
      return { ok: true, blendId: r.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'ERROR', message };
    }
  }

  // ------------------------------------------------------------- add count

  async addCount(p: { count: string; reason: string; actor: Actor }): Promise<AddCountResult> {
    const base = { productId: null, operation: 'add_count' as const, procName: 'AddCount', before: null, after: { count: p.count }, actor: p.actor, reason: p.reason };
    if (!this.enabled) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason, effectiveFrom: null });
      return this.disabled();
    }
    const bad = PdasWriter.checkReason(p.reason) ?? checkName('count', p.count);
    if (bad) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'implausible', pdasErrorCode: null, message: bad, effectiveFrom: null });
      return { ok: false, code: 'IMPLAUSIBLE', message: bad };
    }
    const count = p.count.trim();
    try {
      const r = await this.execProc('AddCount', (q) => q.input('count', mssql.NVarChar(255), count), 'countId');
      if (r.code !== 0 || r.id == null) {
        const message = explainPdasError('AddCount', r.code, r.raw);
        await this.recordChange({ ...base, observedAfter: null, outcome: 'pdas_error', pdasErrorCode: r.code, message, effectiveFrom: null });
        return { ok: false, code: 'PDAS_ERROR', message, pdasErrorCode: r.code };
      }
      const now = new Date();
      const pool = await this.pool();
      // B1 fix: same rationale as addBlend — AddCount has already committed;
      // a failure in this follow-up check-read must not read as a failed write.
      let observed: string | null = null;
      let checkReadFailed = false;
      let checkErrMessage = '';
      let echoOk = false;
      try {
        const echo = await pool.request().input('id', mssql.Int, r.id).query<{ Count: string }>(`SELECT [Count] FROM dbo.Counts WHERE CountId = @id`);
        observed = echo.recordset[0]?.Count == null ? null : String(echo.recordset[0].Count);
        echoOk = observed != null && observed.trim() === count;
        if (!echoOk) {
          await this.raiseEchoMismatch('yarn_count', `Count ${r.id}: PDAS holds ${JSON.stringify(observed)} after AddCount requested ${JSON.stringify(count)}.`);
        }
      } catch (checkErr) {
        checkReadFailed = true;
        checkErrMessage = checkErr instanceof Error ? checkErr.message : String(checkErr);
        await this.raiseReadbackFailed('yarn_count', `Count ${r.id}: AddCount committed but the follow-up check read failed: ${checkErrMessage}`);
      }
      // Same cast rule as the sync's seed: the int where the text is one, the text always.
      const text = observed ?? count;
      const asInt = Number.parseInt(text, 10);
      await this.appPool
        .request()
        .input('id', mssql.Int, r.id)
        .input('iv', mssql.Int, Number.isNaN(asInt) ? null : asInt)
        .input('v', mssql.NVarChar(255), text)
        .query(
          `MERGE sms.yarn_count t USING (SELECT @id id) s ON t.count_id=s.id
           WHEN MATCHED THEN UPDATE SET count_val=@iv, count_text=@v
           WHEN NOT MATCHED THEN INSERT (count_id, count_val, count_text) VALUES (@id, @iv, @v);`,
        );
      await this.recordChange({
        ...base, observedAfter: { countId: r.id, count: observed }, outcome: checkReadFailed ? 'ok' : echoOk ? 'ok' : 'mismatch', pdasErrorCode: null,
        message: checkReadFailed
          ? `AddCount committed (count ${r.id}) but the follow-up check read failed: ${checkErrMessage}`
          : echoOk ? null : 'echo-back differs from request — CRITICAL finding raised',
        effectiveFrom: now,
      });
      await recordAudit(this.appPool, p.actor.userId, 'product.add_count', 'yarn_count', r.id, `Added count ${r.id} "${count}" — ${p.reason}`);
      return { ok: true, countId: r.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'ERROR', message };
    }
  }

  // --------------------------------------------------------- add tube type

  async addTubeType(p: { tubeType: string; tubeWeightG: number; tubeForm?: TubeForm; reason: string; actor: Actor }): Promise<AddTubeTypeResult> {
    // 2 unless told otherwise: 26 of the 27 tube types on this line are form
    // 2, and the proc's own default (0) is refused by its own check.
    const tubeForm: TubeForm = p.tubeForm ?? 2;
    const after = { tubeType: p.tubeType, tubeWeightG: p.tubeWeightG, tubeForm };
    const base = { productId: null, operation: 'add_tube_type' as const, procName: 'AddTubeType', before: null, after, actor: p.actor, reason: p.reason };
    if (!this.enabled) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason, effectiveFrom: null });
      return this.disabled();
    }
    const bad =
      PdasWriter.checkReason(p.reason) ??
      checkName('tube type name', p.tubeType) ??
      (Number.isFinite(p.tubeWeightG) && p.tubeWeightG > 0 && p.tubeWeightG <= 1000
        ? null
        : `The tube weight ${p.tubeWeightG} g must be more than 0 and at most 1000 g.`) ??
      (tubeForm === 1 || tubeForm === 2 ? null : 'The tube form must be 1 or 2.');
    if (bad) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'implausible', pdasErrorCode: null, message: bad, effectiveFrom: null });
      return { ok: false, code: 'IMPLAUSIBLE', message: bad };
    }
    const name = p.tubeType.trim();
    try {
      const r = await this.execProc(
        'AddTubeType',
        (q) => q.input('tubeType', mssql.NVarChar(255), name).input('tubeForm', mssql.Int, tubeForm).input('tubeWeight', mssql.Float, p.tubeWeightG),
        // CONFIRMED 21 Sep 2026 by a Windows-auth catalogue read of
        // PDAS_TP1U2_SEP07 (the 16 Sep 2026 introspection task's IFL_DB_USER
        // login could not see any procedure's metadata; a direct sqlcmd -E
        // query bypasses that grant entirely — see the file header and
        // PROC_PARAMS above). 'typeTypeId' is the vendor's own typo, and the
        // exact match to this binding's name and order is what confirms it.
        'typeTypeId',
      );
      if (r.code !== 0 || r.id == null) {
        const message = explainPdasError('AddTubeType', r.code, r.raw);
        await this.recordChange({ ...base, observedAfter: null, outcome: 'pdas_error', pdasErrorCode: r.code, message, effectiveFrom: null });
        return { ok: false, code: 'PDAS_ERROR', message, pdasErrorCode: r.code };
      }
      const now = new Date();
      const pool = await this.pool();
      // B1 fix: same rationale as addBlend/addCount — AddTubeType has already
      // committed; a failure in this follow-up check-read must not read as a
      // failed write.
      let observed: { tubeType: string; tubeWeightG: number; tubeForm: number | null } | null = null;
      let checkReadFailed = false;
      let checkErrMessage = '';
      let echoOk = false;
      try {
        const echo = await pool
          .request()
          .input('id', mssql.Int, r.id)
          .query<{ TubeType: string; TubeWeight: number; TubeForm: number | null }>(`SELECT TubeType, TubeWeight, TubeForm FROM dbo.TubeTypes WHERE TubeTypeId = @id`);
        const row = echo.recordset[0];
        observed = row ? { tubeType: row.TubeType, tubeWeightG: Number(row.TubeWeight), tubeForm: row.TubeForm == null ? null : Number(row.TubeForm) } : null;
        echoOk = observed != null && observed.tubeType.trim() === name && observed.tubeWeightG === p.tubeWeightG && observed.tubeForm === tubeForm;
        if (!echoOk) {
          await this.raiseEchoMismatch('tube_type', `Tube type ${r.id}: PDAS holds ${JSON.stringify(observed)} after AddTubeType requested ${JSON.stringify(after)}.`);
        }
      } catch (checkErr) {
        checkReadFailed = true;
        checkErrMessage = checkErr instanceof Error ? checkErr.message : String(checkErr);
        await this.raiseReadbackFailed('tube_type', `Tube type ${r.id}: AddTubeType committed but the follow-up check read failed: ${checkErrMessage}`);
      }
      await this.appPool
        .request()
        .input('id', mssql.Int, r.id)
        .input('v', mssql.NVarChar(255), observed?.tubeType ?? name)
        .input('w', mssql.Decimal(10, 2), observed?.tubeWeightG ?? p.tubeWeightG)
        .query(
          `MERGE sms.tube_type t USING (SELECT @id id) s ON t.tube_type_id=s.id
           WHEN MATCHED THEN UPDATE SET tube_type=@v, tube_weight_g=@w
           WHEN NOT MATCHED THEN INSERT (tube_type_id, tube_type, tube_weight_g) VALUES (@id, @v, @w);`,
        );
      await this.recordChange({
        ...base, observedAfter: observed == null ? null : { tubeTypeId: r.id, ...observed }, outcome: checkReadFailed ? 'ok' : echoOk ? 'ok' : 'mismatch', pdasErrorCode: null,
        message: checkReadFailed
          ? `AddTubeType committed (tube type ${r.id}) but the follow-up check read failed: ${checkErrMessage}`
          : echoOk ? null : 'echo-back differs from request — CRITICAL finding raised',
        effectiveFrom: now,
      });
      await recordAudit(this.appPool, p.actor.userId, 'product.add_tube_type', 'tube_type', r.id, `Added tube type ${r.id} "${name}" ${p.tubeWeightG} g form ${tubeForm} — ${p.reason}`);
      return { ok: true, tubeTypeId: r.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'ERROR', message };
    }
  }

  // --------------------------------------------------------- create pallet

  /** Read the pallet row as the QCS panel would see it, for echo-back and the mirror. */
  private static async readPallet(req: mssql.Request, palletId: number): Promise<(PalletFields & { palletId: number; pdasCreatedAt: Date | null }) | null> {
    const r = await req.input('id', mssql.Int, palletId).query<{
      MaterialId: number; PackSchemaId: number; Lot: string; SteamProg: number | null; LabelType: number | null; Routing: number | null;
      PalletActive: boolean; PalletDesc1: string | null; PalletDesc2: string | null; PalletDesc3: string | null; PalletDesc4: string | null;
      PalletDesc5: string | null; Timestamp: Date | null;
    }>(
      `SELECT MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive,
              PalletDesc1, PalletDesc2, PalletDesc3, PalletDesc4, PalletDesc5, Timestamp
         FROM dbo.Pallets WHERE PalletId = @id`,
    );
    const x = r.recordset[0];
    if (!x) return null;
    return {
      palletId,
      productId: Number(x.MaterialId),
      packSchemaId: Number(x.PackSchemaId),
      lot: x.Lot ?? '',
      active: Boolean(x.PalletActive),
      desc1: x.PalletDesc1 || null,
      desc2: x.PalletDesc2 || null,
      desc3: x.PalletDesc3 || null,
      desc4: x.PalletDesc4 || null,
      desc5: x.PalletDesc5 || null,
      steamProg: x.SteamProg == null ? 0 : Number(x.SteamProg),
      labelType: x.LabelType == null ? 1 : Number(x.LabelType),
      routing: x.Routing == null ? 0 : Number(x.Routing),
      pdasCreatedAt: x.Timestamp ? new Date(x.Timestamp) : null,
    };
  }

  /** Keep the pallet mirror current now rather than on the next sync pass (migration 036). */
  private async mirrorPallet(f: PalletFields & { palletId: number; pdasCreatedAt: Date | null }): Promise<void> {
    await this.appPool
      .request()
      .input('id', mssql.Int, f.palletId)
      .input('pid', mssql.Int, f.productId)
      .input('ps', mssql.Int, f.packSchemaId)
      .input('lot', mssql.NVarChar(255), f.lot)
      .input('steam', mssql.Int, f.steamProg ?? 0)
      .input('label', mssql.Int, f.labelType ?? 1)
      .input('routing', mssql.Int, f.routing ?? 0)
      .input('a', mssql.Bit, f.active)
      .input('d1', mssql.NVarChar(255), f.desc1)
      .input('d2', mssql.NVarChar(255), f.desc2 ?? null)
      .input('d3', mssql.NVarChar(255), f.desc3 ?? null)
      .input('d4', mssql.NVarChar(255), f.desc4 ?? null)
      .input('d5', mssql.NVarChar(255), f.desc5 ?? null)
      .input('ts', mssql.DateTime2(3), f.pdasCreatedAt)
      .query(
        `MERGE sms.pallet t USING (SELECT @id id) s ON t.pallet_id = s.id
         WHEN MATCHED THEN UPDATE SET product_id=@pid, pack_schema_id=@ps, lot=@lot, steam_prog=@steam, label_type=@label,
                                      routing=@routing, active_flag=@a, desc1=@d1, desc2=@d2, desc3=@d3, desc4=@d4, desc5=@d5,
                                      pdas_created_at=COALESCE(@ts, t.pdas_created_at)
         WHEN NOT MATCHED THEN INSERT (pallet_id, product_id, pack_schema_id, lot, steam_prog, label_type, routing, active_flag,
                                       desc1, desc2, desc3, desc4, desc5, pdas_created_at)
              VALUES (@id, @pid, @ps, @lot, @steam, @label, @routing, @a, @d1, @d2, @d3, @d4, @d5, @ts);`,
      );
  }

  private static samePallet(a: PalletFields, b: PalletFields): boolean {
    return (
      a.productId === b.productId &&
      a.packSchemaId === b.packSchemaId &&
      a.lot.trim() === b.lot.trim() &&
      a.active === b.active &&
      (a.desc1 ?? '') === (b.desc1 ?? '') &&
      (a.desc2 ?? '') === (b.desc2 ?? '') &&
      (a.desc3 ?? '') === (b.desc3 ?? '') &&
      (a.desc4 ?? '') === (b.desc4 ?? '') &&
      (a.desc5 ?? '') === (b.desc5 ?? '') &&
      (a.steamProg ?? 0) === (b.steamProg ?? 0) &&
      (a.labelType ?? 1) === (b.labelType ?? 1) &&
      (a.routing ?? 0) === (b.routing ?? 0)
    );
  }

  async createPallet(p: { fields: PalletFields; reason: string; actor: Actor }): Promise<CreatePalletResult> {
    const f: PalletFields = {
      ...p.fields,
      lot: p.fields.lot.trim(),
      steamProg: p.fields.steamProg ?? 0,
      labelType: p.fields.labelType ?? 1,
      routing: p.fields.routing ?? 0,
    };
    const base = { productId: f.productId, operation: 'create_pallet' as const, procName: 'CreatePallet', before: null, after: f, actor: p.actor, reason: p.reason };
    if (!this.enabled) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason, effectiveFrom: null });
      return this.disabled();
    }
    const bad =
      PdasWriter.checkReason(p.reason) ??
      (Number.isInteger(f.productId) && f.productId > 0 ? null : 'A material (product) number is required.') ??
      (Number.isInteger(f.packSchemaId) && f.packSchemaId >= 0 ? null : 'The pack schema number must be 0 or more.') ??
      checkName('lot', f.lot) ??
      ([f.desc1, f.desc2, f.desc3, f.desc4, f.desc5].every((d) => (d ?? '').length <= 255) ? null : 'A pallet description is longer than 255 characters.');
    if (bad) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'implausible', pdasErrorCode: null, message: bad, effectiveFrom: null });
      return { ok: false, code: 'IMPLAUSIBLE', message: bad };
    }
    try {
      const r = await this.execProc(
        'CreatePallet',
        (q) =>
          q
            .input('materialId', mssql.Int, f.productId)
            .input('packSchemaId', mssql.Int, f.packSchemaId)
            .input('lot', mssql.NVarChar(255), f.lot)
            .input('steamProg', mssql.Int, f.steamProg)
            .input('labelType', mssql.Int, f.labelType)
            .input('routing', mssql.Int, f.routing)
            .input('palletActive', mssql.Bit, f.active)
            .input('palletDesc1', mssql.NVarChar(255), f.desc1 ?? '')
            .input('palletDesc2', mssql.NVarChar(255), f.desc2 ?? '')
            .input('palletDesc3', mssql.NVarChar(255), f.desc3 ?? '')
            .input('palletDesc4', mssql.NVarChar(255), f.desc4 ?? '')
            .input('palletDesc5', mssql.NVarChar(255), f.desc5 ?? ''),
        'palletId',
      );
      if (r.code !== 0 || r.id == null) {
        const message = explainPdasError('CreatePallet', r.code, r.raw);
        await this.recordChange({ ...base, observedAfter: null, outcome: 'pdas_error', pdasErrorCode: r.code, message, effectiveFrom: null });
        return { ok: false, code: 'PDAS_ERROR', message, pdasErrorCode: r.code };
      }
      const now = new Date();
      const pool = await this.pool();
      // B1 fix: same rationale as addBlend/addCount/addTubeType — CreatePallet
      // has already committed; a failure in this follow-up check-read must
      // not read as a failed write.
      let observed: Awaited<ReturnType<typeof PdasWriter.readPallet>> = null;
      let checkReadFailed = false;
      let checkErrMessage = '';
      let echoOk = false;
      try {
        observed = await PdasWriter.readPallet(pool.request(), r.id);
        echoOk = observed != null && PdasWriter.samePallet(observed, f);
        if (!echoOk) {
          await this.raiseEchoMismatch('pallet', `Pallet ${r.id}: PDAS holds ${JSON.stringify(observed)} after CreatePallet requested ${JSON.stringify(f)}.`);
        }
      } catch (checkErr) {
        checkReadFailed = true;
        checkErrMessage = checkErr instanceof Error ? checkErr.message : String(checkErr);
        await this.raiseReadbackFailed('pallet', `Pallet ${r.id}: CreatePallet committed but the follow-up check read failed: ${checkErrMessage}`);
      }
      await this.mirrorPallet(observed ?? { ...f, palletId: r.id, pdasCreatedAt: null });
      await this.recordChange({
        ...base, palletId: r.id, observedAfter: observed, outcome: checkReadFailed ? 'ok' : echoOk ? 'ok' : 'mismatch', pdasErrorCode: null,
        message: checkReadFailed
          ? `CreatePallet committed (pallet ${r.id}) but the follow-up check read failed: ${checkErrMessage}`
          : echoOk ? null : 'echo-back differs from request — CRITICAL finding raised',
        effectiveFrom: now,
      });
      await recordAudit(
        this.appPool, p.actor.userId, 'pallet.create', 'pallet', r.id,
        `Created pallet ${r.id} for product ${f.productId}, schema ${f.packSchemaId}, lot "${f.lot}"${f.desc1 ? `, ${f.desc1}` : ''} — ${p.reason}`,
      );
      return { ok: true, palletId: r.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'ERROR', message };
    }
  }

  // ----------------------------------------------------- set pallet active

  async setPalletActive(p: { palletId: number; active: boolean; reason: string; actor: Actor }): Promise<PalletActiveResult> {
    const base = {
      productId: null, palletId: p.palletId, operation: 'set_pallet_active' as const, procName: 'SetPalletStatusActive',
      before: null, after: { active: p.active }, actor: p.actor, reason: p.reason,
    };
    if (!this.enabled) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'disabled', pdasErrorCode: null, message: this.cfg.disabledReason, effectiveFrom: null });
      return this.disabled();
    }
    const bad = PdasWriter.checkReason(p.reason) ?? (Number.isInteger(p.palletId) && p.palletId > 0 ? null : 'A pallet number is required.');
    if (bad) {
      await this.recordChange({ ...base, observedAfter: null, outcome: 'implausible', pdasErrorCode: null, message: bad, effectiveFrom: null });
      return { ok: false, code: 'IMPLAUSIBLE', message: bad };
    }
    try {
      const r = await this.execProc(
        'SetPalletStatusActive',
        (q) => q.input('palletId', mssql.Int, p.palletId).input('palletActive', mssql.Bit, p.active),
        null,
      );
      if (r.code !== 0) {
        const message = explainPdasError('SetPalletStatusActive', r.code, r.raw);
        await this.recordChange({
          ...base, observedAfter: null, outcome: r.code === -8001 ? 'not_found' : 'pdas_error', pdasErrorCode: r.code, message, effectiveFrom: null,
        });
        return { ok: false, code: r.code === -8001 ? 'NOT_FOUND' : 'PDAS_ERROR', message, pdasErrorCode: r.code };
      }
      const now = new Date();
      const pool = await this.pool();
      // B1 fix: same rationale as the other four operations — SetPalletStatusActive
      // has already committed; a failure in this follow-up check-read must not
      // read as a failed write.
      let observed: Awaited<ReturnType<typeof PdasWriter.readPallet>> = null;
      let checkReadFailed = false;
      let checkErrMessage = '';
      let echoOk = false;
      try {
        observed = await PdasWriter.readPallet(pool.request(), p.palletId);
        echoOk = observed != null && observed.active === p.active;
        if (!echoOk) {
          await this.raiseEchoMismatch('pallet', `Pallet ${p.palletId}: PDAS holds active=${observed?.active ?? 'missing'} after SetPalletStatusActive requested ${p.active}.`);
        }
      } catch (checkErr) {
        checkReadFailed = true;
        checkErrMessage = checkErr instanceof Error ? checkErr.message : String(checkErr);
        await this.raiseReadbackFailed('pallet', `Pallet ${p.palletId}: SetPalletStatusActive committed but the follow-up check read failed: ${checkErrMessage}`);
      }
      if (observed) {
        await this.mirrorPallet(observed);
      } else {
        await this.appPool.request().input('id', mssql.Int, p.palletId).input('a', mssql.Bit, p.active).query(`UPDATE sms.pallet SET active_flag = @a WHERE pallet_id = @id`);
      }
      await this.recordChange({
        ...base, observedAfter: observed == null ? null : { active: observed.active }, outcome: checkReadFailed ? 'ok' : echoOk ? 'ok' : 'mismatch', pdasErrorCode: null,
        message: checkReadFailed
          ? `SetPalletStatusActive committed (pallet ${p.palletId}) but the follow-up check read failed: ${checkErrMessage}`
          : echoOk ? null : 'echo-back differs from request — CRITICAL finding raised',
        effectiveFrom: now,
      });
      await recordAudit(
        this.appPool, p.actor.userId, p.active ? 'pallet.activate' : 'pallet.retire', 'pallet', p.palletId,
        `${p.active ? 'Activated' : 'Retired'} pallet ${p.palletId} — ${p.reason}`,
      );
      return { ok: true, palletId: p.palletId, active: p.active };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordChange({ ...base, observedAfter: null, outcome: 'error', pdasErrorCode: null, message, effectiveFrom: null });
      return { ok: false, code: 'ERROR', message };
    }
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
