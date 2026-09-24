/**
 * The changeover — IFL's PDAS procedure run as ONE server-side sequence, with
 * a dry run that shows the plan before anything is written. Roadmap Phase 6
 * completed (Wave F, 15 Sep 2026).
 *
 * THE PROCEDURE IT REPLACES (IFL's SOP "QCS ID Creation by P-DAS", relayed by
 * Hassan sb on 15 Sep 2026). In SSMS the process engineer:
 *   1. runs GetAllBlends / GetAllCounts / GetAllTubeTypes and adds whatever is
 *      missing with AddBlend / AddCount / AddTubeType;
 *   2. runs CreateMaterial (blend, count, tube, setpoint 1960, WT+ 30, WT− 30,
 *      active 1, Desc1 = lot name, Desc2 = PP colour) → a Material ID;
 *   3. runs CreatePallet (material, pack schema 1, lot, active,
 *      PalletDesc1 = sack colour) → a Pallet ID;
 *   4. retires what the new one replaces: SetMaterialStatusActive 0 and
 *      SetPalletStatusActive 0.
 * The QCS panel then lists the active materials and pallets, the operator
 * selects them on each machine at the shift change, and the panel reads the
 * material's setpoint and offsets at that moment. SMS does not select on the
 * machine and does not talk to the PLC (Q63): its job ends when the ids are
 * on the panel, and the result sentence says exactly that.
 *
 * WHY A PLAN FIRST. Two of the vendor's refusals are only knowable in
 * advance from the mirror: CreateMaterial is expected to refuse a (blend,
 * count, tube) triple that already exists, active or not (-7001), and
 * CreatePallet is expected to refuse a (material, schema, lot) that exists
 * (-8001) — both EXPECTED, not established fact: the 15 Sep 2026 audit found
 * the field notes these were cited from (IFL's engineer, 18 Aug 2026) contain
 * no error of any kind, every executed call shown returning @error/@errorMsg
 * = NULL/NULL. The real behaviour is to be established by an offline proof
 * against the local `_SEP07` copy, not repeated as fact until it is. The plan
 * checks both against the mirror and names the existing row regardless, so
 * the sequence is refused before step 1 rather than failing at step 4 with
 * three rows already written — if the refusal proves not to behave as
 * expected, the plan's check is still a harmless, conservative one.
 *
 * NO ROLLBACK IS POSSIBLE. Each vendor proc commits its own row and writes
 * its own nhs_events line; there is no transaction across them and no
 * DELETE (CLAUDE.md: no DELETE, ever). So the execute path runs the steps in
 * order, STOPS at the first failure, and reports what was done and what was
 * not — the engineer then finishes by hand or retries with the ids already
 * allocated (a retry reuses them: the plan sees them in the mirror).
 *
 * THE DRY RUN NEVER OPENS THE WRITER POOL. It reads the sidecar mirror only,
 * so it works with PDAS_WRITE_ENABLED=false — which is how it is exercised
 * until IFL's written authorisation arrives.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import type { Actor, PalletFields, PdasWriter, SetpointBounds, TubeForm, WriteFailure } from './pdasWrite.js';
import { findPalletByKey, listPallets } from './pallets.js';
import { recordAudit } from './audit.js';
import { likeMatches } from './likePattern.js';

/* ------------------------------------------------------------- the request */

export type RefChoice = { id: number } | { name: string };
export type TubeChoice = { id: number } | { name: string; tubeWeightG: number; tubeForm?: TubeForm };

export interface ChangeoverRequest {
  blend: RefChoice;
  count: RefChoice;
  tubeType: TubeChoice;
  material: {
    setpointG: number;
    offsetMinusG: number;
    offsetPlusG: number;
    /** MaterialDesc1 — the lot name, per the SOP. */
    lot: string;
    /** MaterialDesc2 — the PP colour, per the SOP. */
    ppColour: string | null;
  };
  pallet: {
    /** PackSchemaId; the SOP says 1. */
    packSchemaId: number;
    /** Defaults to the material's lot. */
    lot: string | null;
    /** PalletDesc1 — the sack colour, per the SOP. */
    sackColour: string | null;
  };
  retire: {
    productIds: number[];
    palletIds: number[];
  };
  reason: string;
}

/* ---------------------------------------------------------------- the plan */

export type StepKind = 'blend' | 'count' | 'tube_type' | 'material' | 'pallet' | 'retire_material' | 'retire_pallet';
export type StepAction = 'reuse' | 'add' | 'create' | 'retire';

export interface PlanStep {
  step: StepKind;
  action: StepAction;
  /** The vendor procedure this step executes; null when nothing is written (reuse). */
  proc: string | null;
  /** What the reader sees: the name, or "product 1021 · 205-IL0-SD". */
  label: string;
  /** The existing id for reuse / retire; null for something to be created. */
  id: number | null;
  /** Step-specific facts the review screen prints (limits, lot, colours, tube weight…). */
  detail: Record<string, string | number | boolean | null>;
}

export interface ChangeoverPlan {
  writesEnabled: boolean;
  disabledReason: string | null;
  steps: PlanStep[];
  /** Why execute would refuse before writing anything. Empty = the plan can run. */
  blockers: string[];
  warnings: string[];
  /** Printed verbatim on the review step. */
  noRollback: string;
  /** The limits the new material will carry, ready to print. */
  limits: { setpointG: number; offsetMinusG: number; offsetPlusG: number; label: string };
  /**
   * The honesty contract (CLAUDE.md, Q63/pdasWrite.ts header): a changeover
   * makes ids selectable in PDAS; it never selects them on a machine. Always
   * false — there is no path in this module that could make it true.
   */
  reachesMachine: false;
  /** Printed verbatim by the UI. Carried forward from this file's own header, not invented. */
  operatorNote: string;
}

/** The honesty-contract sentence — verbatim on every plan, never reworded per caller. */
export const OPERATOR_SELECTS_ON_MACHINE =
  'This makes the product available in PDAS and records what was intended. ' +
  'The operator still selects it on the QCS panel at the machine.';

export interface StepDone extends PlanStep {
  /** The id PDAS allocated (or confirmed). */
  resultId: number;
}

export interface StepFailed extends PlanStep {
  error: { code: WriteFailure['code']; message: string; pdasErrorCode: number | null };
}

export interface ChangeoverOutcome {
  ok: boolean;
  done: StepDone[];
  failed: StepFailed | null;
  notDone: PlanStep[];
  materialId: number | null;
  palletId: number | null;
  noRollback: string;
}

export const NO_ROLLBACK =
  'PDAS has no transaction across its procedures and SMS never deletes: a step that succeeds stays written even if a later step fails. ' +
  'If that happens, the ids already created are listed here, and a retry reuses them.';

/** What the orchestration needs; narrow so tests can hand it fakes. */
export interface ChangeoverDeps {
  pool: ConnectionPool;
  writer: Pick<PdasWriter, 'enabled' | 'disabledReason' | 'addBlend' | 'addCount' | 'addTubeType' | 'createProduct' | 'createPallet' | 'setProductActive' | 'setPalletActive'>;
  bounds: SetpointBounds;
}

const MIN_REASON_CHARS = 10;
const fmtG = (n: number) => Math.round(n).toLocaleString('en-US');
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Defect B4: the first row (if any) whose stored name would be matched by
 * `requestedName` if PDAS ran it as a `LIKE` pattern — the same guard
 * `AddBlend`/`AddCount`/`AddTubeType` put around their own INSERT (see
 * likePattern.ts's header for the verified proc text). Only called once an
 * EXACT (case-insensitive, trimmed) match has already been ruled out, so a
 * hit here means: not the same name, but PDAS would still refuse it.
 */
function findLikeCollision<T extends { name: string }>(rows: T[], requestedName: string): T | undefined {
  return rows.find((r) => likeMatches(r.name, requestedName));
}

/* ------------------------------------------------------------ the mirror */

interface Mirror {
  blends: { id: number; name: string }[];
  counts: { id: number; name: string }[];
  tubeTypes: { id: number; name: string; tubeWeightG: number | null }[];
  products: { id: number; blendId: number | null; countId: number | null; tubeTypeId: number | null; active: boolean | null; label: string }[];
  pallets: Awaited<ReturnType<typeof listPallets>>;
}

async function readMirror(pool: ConnectionPool): Promise<Mirror> {
  const [b, c, t, p, pallets] = await Promise.all([
    pool.request().query<{ id: number; name: string }>(`SELECT blend_id id, blend name FROM sms.blend`),
    pool.request().query<{ id: number; name: string }>(`SELECT count_id id, count_text name FROM sms.yarn_count`),
    pool.request().query<{ id: number; name: string; w: number | null }>(`SELECT tube_type_id id, tube_type name, tube_weight_g w FROM sms.tube_type`),
    pool.request().query<{ product_id: number; blend_id: number | null; count_id: number | null; tube_type_id: number | null; active_flag: boolean | null; description: string | null; lot_code: string | null }>(
      `SELECT product_id, blend_id, count_id, tube_type_id, active_flag, description, lot_code FROM sms.product`,
    ),
    listPallets(pool),
  ]);
  return {
    blends: b.recordset.map((x) => ({ id: Number(x.id), name: String(x.name) })),
    counts: c.recordset.map((x) => ({ id: Number(x.id), name: String(x.name) })),
    tubeTypes: t.recordset.map((x) => ({ id: Number(x.id), name: String(x.name), tubeWeightG: x.w == null ? null : Number(x.w) })),
    products: p.recordset.map((x) => ({
      id: Number(x.product_id),
      blendId: x.blend_id == null ? null : Number(x.blend_id),
      countId: x.count_id == null ? null : Number(x.count_id),
      tubeTypeId: x.tube_type_id == null ? null : Number(x.tube_type_id),
      active: x.active_flag == null ? null : Boolean(x.active_flag),
      label: x.description || x.lot_code || `Product ${x.product_id}`,
    })),
    pallets,
  };
}

/* ------------------------------------------------------------ planning */

function resolveRef(
  what: 'blend' | 'count',
  choice: RefChoice,
  rows: { id: number; name: string }[],
  blockers: string[],
  warnings: string[],
): { step: PlanStep; id: number | null } {
  const proc = what === 'blend' ? 'AddBlend' : 'AddCount';
  if ('id' in choice) {
    const row = rows.find((r) => r.id === choice.id);
    if (!row) {
      blockers.push(`No ${what} with number ${choice.id} is known to the mirror.`);
      return { step: { step: what, action: 'reuse', proc: null, label: `${what} ${choice.id}`, id: choice.id, detail: {} }, id: choice.id };
    }
    return { step: { step: what, action: 'reuse', proc: null, label: row.name, id: row.id, detail: { name: row.name } }, id: row.id };
  }
  const name = choice.name.trim();
  if (name.length === 0) {
    blockers.push(`The new ${what} has no name.`);
  }
  // PDAS's own duplicate check is LIKE (case-insensitive): a name that
  // exists in another case would be refused there, so it is reused here.
  const existing = rows.find((r) => norm(r.name) === norm(name));
  if (existing) {
    warnings.push(`"${name}" already exists as ${what} ${existing.id} ("${existing.name}") and will be used as it is.`);
    return { step: { step: what, action: 'reuse', proc: null, label: existing.name, id: existing.id, detail: { name: existing.name, matchedByName: true } }, id: existing.id };
  }
  // B4: not an exact duplicate, but `${proc}` guards its INSERT with
  // `<col> LIKE @newName` — a name that is only a wildcard-pattern match for
  // an existing row (e.g. "R_D" against "RED") is refused by PDAS exactly
  // like a real duplicate, just later — mid-sequence, after earlier steps
  // may already have written. Block it here instead of silently planning to
  // add it, and name the row it collides with rather than reusing it.
  const likeCollision = findLikeCollision(rows, name);
  if (likeCollision) {
    blockers.push(
      `"${name}" would be refused by PDAS: as a wildcard pattern it matches the existing ${what} ${likeCollision.id} ` +
        `("${likeCollision.name}"), the same LIKE check ${proc} runs before it inserts. Use a different, non-matching name, ` +
        `or reuse ${what} ${likeCollision.id} instead.`,
    );
  }
  return { step: { step: what, action: 'add', proc, label: name, id: null, detail: { name, ...(likeCollision ? { likeCollisionWith: likeCollision.id } : {}) } }, id: null };
}

function resolveTube(choice: TubeChoice, rows: Mirror['tubeTypes'], blockers: string[], warnings: string[]): { step: PlanStep; id: number | null } {
  if ('id' in choice) {
    const row = rows.find((r) => r.id === choice.id);
    if (!row) {
      blockers.push(`No tube type with number ${choice.id} is known to the mirror.`);
      return { step: { step: 'tube_type', action: 'reuse', proc: null, label: `tube type ${choice.id}`, id: choice.id, detail: {} }, id: choice.id };
    }
    return { step: { step: 'tube_type', action: 'reuse', proc: null, label: row.name, id: row.id, detail: { name: row.name, tubeWeightG: row.tubeWeightG } }, id: row.id };
  }
  const name = choice.name.trim();
  if (name.length === 0) blockers.push('The new tube type has no name.');
  if (!(Number.isFinite(choice.tubeWeightG) && choice.tubeWeightG > 0)) blockers.push('The new tube type needs a tube weight above zero.');
  const form: TubeForm = choice.tubeForm ?? 2;
  const existing = rows.find((r) => norm(r.name) === norm(name));
  if (existing) {
    warnings.push(`"${name}" already exists as tube type ${existing.id} ("${existing.name}") and will be used as it is.`);
    return { step: { step: 'tube_type', action: 'reuse', proc: null, label: existing.name, id: existing.id, detail: { name: existing.name, tubeWeightG: existing.tubeWeightG, matchedByName: true } }, id: existing.id };
  }
  // B4: AddTubeType guards its INSERT with
  // `TubeType LIKE @tubeType AND TubeForm = @tubeForm` (verified against the
  // proc body, likePattern.ts's header) — a compound key, name pattern AND
  // exact form. `sms.tube_type` (the sidecar mirror, db/migrations/006_
  // reference.sql) carries no tube_form column, so this check cannot include
  // form and is deliberately conservative: it blocks on a name-pattern
  // collision alone, regardless of the existing row's form. That can only
  // over-block (flag a pattern collision PDAS might actually accept because
  // the forms differ) — the safe direction, never the silent-refusal defect
  // this fix exists to close. Narrowing it needs tube_form added to the
  // mirror and its sync, which is a schema change, not this fix's scope.
  const likeCollision = findLikeCollision(rows, name);
  if (likeCollision) {
    blockers.push(
      `"${name}" would be refused by PDAS: as a wildcard pattern it matches the existing tube type ${likeCollision.id} ` +
        `("${likeCollision.name}"), the same LIKE check AddTubeType runs before it inserts. Use a different, non-matching name, ` +
        `or reuse tube type ${likeCollision.id} instead.`,
    );
  }
  return {
    step: {
      step: 'tube_type',
      action: 'add',
      proc: 'AddTubeType',
      label: name,
      id: null,
      detail: { name, tubeWeightG: choice.tubeWeightG, tubeForm: form, ...(likeCollision ? { likeCollisionWith: likeCollision.id } : {}) },
    },
    id: null,
  };
}

/**
 * The plan: what will be reused, what will be added, the material and pallet
 * that will be created, what will be retired — and every reason the run
 * would be refused. Reads the mirror only; never PDAS.
 */
export async function planChangeover(deps: ChangeoverDeps, req: ChangeoverRequest): Promise<ChangeoverPlan> {
  const m = await readMirror(deps.pool);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const steps: PlanStep[] = [];

  if (req.reason.trim().length < MIN_REASON_CHARS) blockers.push(`A reason of at least ${MIN_REASON_CHARS} characters is required.`);

  const blend = resolveRef('blend', req.blend, m.blends, blockers, warnings);
  const count = resolveRef('count', req.count, m.counts, blockers, warnings);
  const tube = resolveTube(req.tubeType, m.tubeTypes, blockers, warnings);
  steps.push(blend.step, count.step, tube.step);

  // The material. Plausibility mirrors PdasWriter's own so the plan refuses
  // what the writer would, one step earlier.
  const { setpointG, offsetMinusG, offsetPlusG } = req.material;
  const lot = req.material.lot.trim();
  if (!(setpointG >= deps.bounds.setpointLoG && setpointG <= deps.bounds.setpointHiG)) {
    blockers.push(`Setpoint ${setpointG} g is outside the plausible cone range ${deps.bounds.setpointLoG}–${deps.bounds.setpointHiG} g.`);
  }
  for (const [name, v] of [['lower offset', offsetMinusG], ['upper offset', offsetPlusG]] as const) {
    if (!(v >= 0 && v <= setpointG / 2)) blockers.push(`The ${name} ${v} g must be between 0 and half the setpoint (${setpointG / 2} g).`);
  }
  if (lot.length === 0) blockers.push('The lot name is required: it becomes the material\'s description and the pallet\'s lot.');

  // CreateMaterial refuses an existing (blend, count, tube) triple, active or
  // not. Only knowable when all three already exist.
  if (blend.id != null && count.id != null && tube.id != null) {
    const clash = m.products.find((p) => p.blendId === blend.id && p.countId === count.id && p.tubeTypeId === tube.id);
    if (clash) {
      blockers.push(
        `PDAS allows only one product per blend + count + tube type, active or not: ${blend.step.label} · ${count.step.label} · ${tube.step.label} ` +
          `already exists as product ${clash.id} (${clash.label}${clash.active === false ? ', retired' : ''}). ` +
          `Change one of the three, or change the limits on product ${clash.id} instead.`,
      );
    }
  }
  const symmetric = offsetMinusG === offsetPlusG;
  const limitsLabel = symmetric ? `${fmtG(setpointG)} ± ${fmtG(offsetPlusG)} g` : `${fmtG(setpointG - offsetMinusG)} to ${fmtG(setpointG + offsetPlusG)} g`;
  steps.push({
    step: 'material',
    action: 'create',
    proc: 'CreateMaterial',
    label: `${blend.step.label} · ${count.step.label} · ${tube.step.label}`,
    id: null,
    detail: { setpointG, offsetMinusG, offsetPlusG, limits: limitsLabel, lot, ppColour: req.material.ppColour ?? null, active: true },
  });

  // The pallet. Its key includes the material, which does not exist yet, so a
  // duplicate is impossible on the create path — checked anyway, in case a
  // retry lands after the material was created and the pallet was not.
  const palletLot = (req.pallet.lot ?? '').trim() || lot;
  if (!(Number.isInteger(req.pallet.packSchemaId) && req.pallet.packSchemaId >= 0)) blockers.push('The pack schema number must be 0 or more.');
  steps.push({
    step: 'pallet',
    action: 'create',
    proc: 'CreatePallet',
    label: `${palletLot}${req.pallet.sackColour ? ` · ${req.pallet.sackColour}` : ''}`,
    id: null,
    detail: { packSchemaId: req.pallet.packSchemaId, lot: palletLot, sackColour: req.pallet.sackColour ?? null, active: true, labelType: 1 },
  });

  // Retirements: only rows the mirror knows; already-retired ones are noted, not blocked.
  for (const id of req.retire.productIds) {
    const p = m.products.find((x) => x.id === id);
    if (!p) {
      blockers.push(`No product ${id} is known to the mirror, so it cannot be retired.`);
      continue;
    }
    if (p.active === false) warnings.push(`Product ${id} (${p.label}) is already retired; retiring it again changes nothing.`);
    steps.push({ step: 'retire_material', action: 'retire', proc: 'SetMaterialStatusActive', label: `product ${id} · ${p.label}`, id, detail: { active: false } });
  }
  for (const id of req.retire.palletIds) {
    const pl = m.pallets.find((x) => x.palletId === id);
    if (!pl) {
      blockers.push(`No pallet ${id} is known to the mirror, so it cannot be retired.`);
      continue;
    }
    if (pl.active === false) warnings.push(`Pallet ${id} is already retired; retiring it again changes nothing.`);
    steps.push({
      step: 'retire_pallet',
      action: 'retire',
      proc: 'SetPalletStatusActive',
      label: `pallet ${id} · ${pl.productLabel ?? `product ${pl.productId}`}${pl.lot ? ` · ${pl.lot}` : ''}${pl.sackColour ? ` · ${pl.sackColour}` : ''}`,
      id,
      detail: { active: false, productId: pl.productId },
    });
  }

  return {
    writesEnabled: deps.writer.enabled,
    disabledReason: deps.writer.enabled ? null : deps.writer.disabledReason,
    steps,
    blockers,
    warnings,
    noRollback: NO_ROLLBACK,
    limits: { setpointG, offsetMinusG, offsetPlusG, label: limitsLabel },
    reachesMachine: false,
    operatorNote: OPERATOR_SELECTS_ON_MACHINE,
  };
}

/* ------------------------------------------------------------- executing */

const failureOf = (f: WriteFailure) => ({ code: f.code, message: f.message, pdasErrorCode: f.pdasErrorCode ?? null });

/**
 * A row in sms.product_change for a changeover that never reached PDAS — the
 * flag was off, so no vendor proc ran. Same table PdasWriter's own recordChange
 * writes to (migration 027/036), same shape, written directly here because
 * this whole-sequence attempt has no single PdasWriter method to record it
 * through: 'create' is the closest of the CHECK-constrained operation values
 * (CK_pc_operation, migration 036) — a changeover's first real write, had the
 * flag been on, would have been CreateMaterial.
 */
async function recordDisabledAttempt(pool: ConnectionPool, req: ChangeoverRequest, actor: Actor, message: string): Promise<void> {
  await pool
    .request()
    .input('pid', mssql.Int, null)
    .input('pallet', mssql.Int, null)
    .input('proc', mssql.VarChar(40), 'CreateMaterial')
    .input('op', mssql.VarChar(20), 'create')
    .input('before', mssql.NVarChar(mssql.MAX), null)
    .input('after', mssql.NVarChar(mssql.MAX), JSON.stringify(req))
    .input('obs', mssql.NVarChar(mssql.MAX), null)
    .input('outcome', mssql.VarChar(20), 'disabled')
    .input('code', mssql.Int, null)
    .input('msg', mssql.NVarChar(500), message)
    .input('eff', mssql.DateTime2(3), null)
    .input('by', mssql.Int, actor.userId)
    .input('reason', mssql.NVarChar(255), req.reason)
    .query(
      `INSERT INTO sms.product_change
         (product_id, pallet_id, proc_name, operation, before_json, after_json, observed_after_json, outcome,
          pdas_error_code, message, effective_from, changed_by, reason)
       VALUES (@pid, @pallet, @proc, @op, @before, @after, @obs, @outcome, @code, @msg, @eff, @by, @reason)`,
    );
}

/**
 * Run the plan in order, stopping at the first failure. The caller has
 * already checked `plan.blockers` is empty and the flag is on (the route
 * answers 409 otherwise); this re-checks both so it cannot be misused.
 */
export async function executeChangeover(deps: ChangeoverDeps, req: ChangeoverRequest, actor: Actor): Promise<ChangeoverOutcome | { refused: string }> {
  const plan = await planChangeover(deps, req);
  if (!deps.writer.enabled) {
    const message = deps.writer.disabledReason ?? 'The PDAS write path is not enabled.';
    await recordDisabledAttempt(deps.pool, req, actor, message);
    return { refused: message };
  }
  if (plan.blockers.length > 0) return { refused: plan.blockers.join(' ') };

  const done: StepDone[] = [];
  let failed: StepFailed | null = null;
  let materialId: number | null = null;
  let palletId: number | null = null;
  let blendId: number | null = null;
  let countId: number | null = null;
  let tubeTypeId: number | null = null;
  const reason = req.reason.trim();
  const pending = [...plan.steps];

  const fail = (step: PlanStep, f: WriteFailure) => {
    failed = { ...step, error: failureOf(f) };
  };

  while (pending.length > 0 && failed === null) {
    const step = pending.shift()!;
    switch (step.step) {
      case 'blend': {
        if (step.action === 'reuse') { blendId = step.id; done.push({ ...step, resultId: step.id! }); break; }
        const r = await deps.writer.addBlend({ blend: String(step.detail.name), reason, actor });
        if (!r.ok) { fail(step, r); break; }
        blendId = r.blendId; done.push({ ...step, resultId: r.blendId }); break;
      }
      case 'count': {
        if (step.action === 'reuse') { countId = step.id; done.push({ ...step, resultId: step.id! }); break; }
        const r = await deps.writer.addCount({ count: String(step.detail.name), reason, actor });
        if (!r.ok) { fail(step, r); break; }
        countId = r.countId; done.push({ ...step, resultId: r.countId }); break;
      }
      case 'tube_type': {
        if (step.action === 'reuse') { tubeTypeId = step.id; done.push({ ...step, resultId: step.id! }); break; }
        const r = await deps.writer.addTubeType({
          tubeType: String(step.detail.name), tubeWeightG: Number(step.detail.tubeWeightG), tubeForm: Number(step.detail.tubeForm) === 1 ? 1 : 2, reason, actor,
        });
        if (!r.ok) { fail(step, r); break; }
        tubeTypeId = r.tubeTypeId; done.push({ ...step, resultId: r.tubeTypeId }); break;
      }
      case 'material': {
        // A retry after a partial run: the triple now exists in the mirror
        // as the material the earlier run created. Reuse it rather than let
        // CreateMaterial refuse with -7001.
        const r = await deps.writer.createProduct({
          blendId: blendId!, countId: countId!, tubeTypeId: tubeTypeId!,
          fields: {
            setpointG: req.material.setpointG, offsetMinusG: req.material.offsetMinusG, offsetPlusG: req.material.offsetPlusG,
            desc1: req.material.lot.trim(), desc2: req.material.ppColour ?? null, active: true,
          },
          bounds: deps.bounds, reason, actor,
        });
        if (!r.ok) { fail(step, r); break; }
        materialId = r.productId; done.push({ ...step, resultId: r.productId }); break;
      }
      case 'pallet': {
        const lot = String(step.detail.lot);
        const existing = await findPalletByKey(deps.pool, materialId!, Number(step.detail.packSchemaId), lot);
        if (existing) {
          // Only reachable on a retry; CreatePallet would answer -8001.
          palletId = existing.palletId; done.push({ ...step, action: 'reuse', proc: null, resultId: existing.palletId }); break;
        }
        const fields: PalletFields = {
          productId: materialId!, packSchemaId: Number(step.detail.packSchemaId), lot, active: true,
          desc1: step.detail.sackColour == null ? null : String(step.detail.sackColour),
        };
        const r = await deps.writer.createPallet({ fields, reason, actor });
        if (!r.ok) { fail(step, r); break; }
        palletId = r.palletId; done.push({ ...step, resultId: r.palletId }); break;
      }
      case 'retire_material': {
        const r = await deps.writer.setProductActive({ productId: step.id!, active: false, reason, actor });
        if (!r.ok) { fail(step, r); break; }
        done.push({ ...step, resultId: step.id! }); break;
      }
      case 'retire_pallet': {
        const r = await deps.writer.setPalletActive({ palletId: step.id!, active: false, reason, actor });
        if (!r.ok) { fail(step, r); break; }
        done.push({ ...step, resultId: step.id! }); break;
      }
    }
  }

  const outcome: ChangeoverOutcome = { ok: failed === null, done, failed, notDone: pending, materialId, palletId, noRollback: NO_ROLLBACK };
  const f: StepFailed | null = failed;
  await recordAudit(
    deps.pool, actor.userId, outcome.ok ? 'changeover.run' : 'changeover.partial', 'product', materialId,
    outcome.ok
      ? `Changeover: material ${materialId}, pallet ${palletId}; ${done.length} steps — ${reason}`
      : `Changeover stopped at ${f!.step} (${f!.error.message}); done: ${done.map((d) => `${d.step}=${d.resultId}`).join(', ') || 'nothing'}; not done: ${pending.map((s) => s.step).join(', ') || 'nothing'} — ${reason}`,
  );
  return outcome;
}
