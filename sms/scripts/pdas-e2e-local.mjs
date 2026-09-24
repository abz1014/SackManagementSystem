/**
 * PDAS write-path local end-to-end harness.
 *
 * WHAT THIS IS. Exercises the REAL app code — `PdasWriter` and
 * `planChangeover`/`executeChangeover` from `api/dist/services/` — against a
 * local copy of PDAS and the local `sms` sidecar database, driving all nine
 * PDAS write rights (AddBlend, AddCount, AddTubeType, CreateMaterial,
 * CreatePallet, SetMaterialStatusActive, SetPalletStatusActive, the guarded
 * single-row UPDATE dbo.Materials for a setpoint change, and its paired
 * INSERT dbo.nhs_events row) plus the refusal/blocker/conflict/disabled
 * paths, and reads back `sms.product_change` / `sms.product_limit_version` /
 * `nhs_events` / PDAS's own tables to prove what actually happened rather
 * than trusting the app's own claim.
 *
 * CASES COVERED (13):
 *   R1 — full changeover plan+execute (blend/count/tube/material/pallet
 *        create, retire an existing material+pallet), all 7 steps in order.
 *   R2 — updateProductLimits on the material R1 created (fresh `before`).
 *   R3 — reactivate the retired material from R1 (SetMaterialStatusActive).
 *   F1 — blocker case: plan reuses the retired material's own triple ->
 *        plan blocked, execute refused, zero PDAS change.
 *   F2 — createProduct with an existing triple -> PDAS -7001, no row.
 *   F3a — addTubeType with an existing name+form ('RED') -> PDAS -5001.
 *   F3b — plan with a tube name that LIKE-collides with an existing one
 *         ('R_D' vs 'RED') -> plan blocked before any PDAS call.
 *   F4 — optimistic concurrency: fresh `before` reused for two successive
 *        updateProductLimits calls; first succeeds, second CONFLICTs.
 *   F5 — write-disabled path via a disabled-config PdasWriter -> DISABLED,
 *        zero PDAS change.
 *   F5b — same, through executeChangeover's own disabled short-circuit.
 *   F6 — plan retiring a material and recreating its own triple in the SAME
 *        plan -> blocked (retire-and-recreate can never work, by design).
 *   T1 — resolveTube via plan-only calls: same name + same form => 'reuse'
 *        (existing tube_type_id); same name + different form => 'add'.
 *
 * LOCAL ONLY, ALWAYS. This script must never run against the plant. The
 * guard block below refuses to proceed unless the write target resolves to
 * localhost/127.0.0.1/::1 AND the PDAS database name ends in `_SEP07` or
 * `_E2E` — the same shape of guard `simulate-plant.mjs` uses for its own
 * local-only rule, applied here to writes instead of just a sim source.
 * There is no override flag. If you need to run this against a different
 * local copy, name that copy's database `..._E2E` rather than removing the
 * guard.
 *
 * MUST BE PRECEDED BY A BACKUP AND FOLLOWED BY A RESTORE — NEVER A DELETE.
 * This script never issues DELETE and never restores anything itself; that
 * is a deliberate omission, not an oversight. Before running it:
 *   1. BACKUP DATABASE <pdas copy> ... WITH COPY_ONLY, CHECKSUM, INIT
 *   2. BACKUP DATABASE sms         ... WITH COPY_ONLY, CHECKSUM, INIT
 *   3. RESTORE VERIFYONLY on both, WITH CHECKSUM
 *   4. Prove restorability into a scratch database name, compare counts,
 *      drop the scratch database.
 * After running it, RESTORE both databases from the pre-run backup — never
 * hand-delete the rows this script wrote. `RESTORE DATABASE ... WITH
 * REPLACE` (single-user during the restore, multi-user after) is the
 * pattern used throughout this project's PDAS execution passes; see
 * `PDAS-EXECUTION-2026-09-24.md` and `PDAS-EXECUTION-2026-09-23.md` for the
 * exact commands used each time.
 *
 * HOW TO RUN.
 *   - cwd must be `sms/` (this script resolves its imports relative to the
 *     current working directory via `process.cwd()`, never an absolute
 *     user path).
 *   - `api/dist` must be built (`npm run build` or `npm run build -w api`).
 *   - Needs a local-only, gitignored `sms/.env.e2e-writer` file with:
 *       PDAS_WRITE_USER=sms_pdas_writer
 *       PDAS_WRITE_PASSWORD=<the password set when 12_pdas_writer.template.sql ran>
 *     Never commit that file. This script never prints its contents.
 *   - Needs `sms/.env` present (read for the app-DB and other base config;
 *     this script overrides PDAS_WRITE_* and APP_DB_* in-process only — it
 *     never writes to `.env` and never touches the real running API).
 *   - Optional overrides: PDAS_E2E_SERVER / PDAS_E2E_PORT (default 14330) /
 *     PDAS_E2E_DATABASE (default PDAS_TP1U2_SEP07) / PDAS_E2E_APP_DB
 *     (default sms) / PDAS_E2E_OUT_FILE (results Markdown path; stdout only
 *     if unset) / PDAS_E2E_RETIRE_MATERIAL_ID (default 1021) /
 *     PDAS_E2E_RETIRE_PALLET_ID (default 1019).
 *   - `node --check scripts/pdas-e2e-local.mjs` should pass with no other
 *     setup; actually running it needs the built dist and the writer env
 *     file above.
 *
 * WHAT IT NEVER DOES. Never writes to any `DATA_TP1U2*` database. Never
 * edits `sms/.env`. Never prints a password, connection string secret, or
 * absolute path specific to one contributor's machine. Never creates a
 * login (`sms_pdas_writer` must already exist, created by
 * `db/bootstrap/12_pdas_writer.template.sql` against the SAME local target
 * this guard requires).
 *
 * EXIT CODE. 0 if every case's PASS/FAIL verdict is PASS; 1 if any FAILs
 * (also 1 on the startup guard refusal). A CI-style "did it work" check.
 *
 * OUTPUT. Writes a results Markdown file (path from PDAS_E2E_OUT_FILE, or
 * stdout only if not set) with one JSON block per step and a PASS/FAIL
 * verdict per case, in the same shape as `PDAS-EXECUTION-2026-09-24.md`
 * quotes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------
// HARD GUARD — refuses to run against anything but a local, clearly-marked
// copy. This is not configurable by an environment variable on purpose:
// the whole point is that nobody can point this script at the plant by
// accident via a stray .env edit.
// ---------------------------------------------------------------------------
function parseEnvFile(p) {
  const text = readFileSync(p, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const REPO = process.cwd(); // must be run with cwd() === sms/
const baseEnv = parseEnvFile(path.join(REPO, '.env'));
const writerEnv = parseEnvFile(path.join(REPO, '.env.e2e-writer')); // never logged

const WRITE_SERVER = process.env.PDAS_E2E_SERVER ?? baseEnv.PDAS_WRITE_SERVER ?? 'localhost';
const WRITE_PORT = process.env.PDAS_E2E_PORT ?? baseEnv.PDAS_WRITE_PORT ?? '14330';
const WRITE_DB = process.env.PDAS_E2E_DATABASE ?? baseEnv.PDAS_WRITE_DATABASE ?? 'PDAS_TP1U2_SEP07';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const hostOnly = String(WRITE_SERVER).split('\\')[0].split(',')[0].trim().toLowerCase();

function refuse(reason) {
  console.error(`REFUSING TO RUN: ${reason}`);
  console.error(`  PDAS_E2E server resolved to: "${WRITE_SERVER}" (host: "${hostOnly}")`);
  console.error(`  PDAS_E2E database resolved to: "${WRITE_DB}"`);
  console.error('  This script only ever runs against a local, _SEP07- or _E2E-named copy.');
  console.error('  It must never be pointed at the plant. There is no override flag.');
  process.exit(1);
}

if (!LOCAL_HOSTS.has(hostOnly)) {
  refuse(`server "${WRITE_SERVER}" does not resolve to localhost/127.0.0.1/::1.`);
}
if (!/_(SEP07|E2E)$/i.test(WRITE_DB)) {
  refuse(`database "${WRITE_DB}" does not end in _SEP07 or _E2E.`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function fileUrl(p) {
  return pathToFileURL(path.resolve(p)).href;
}

const OUT = process.env.PDAS_E2E_OUT_FILE ?? null; // optional; stdout-only if unset
const RETIRE_MATERIAL_ID = Number(process.env.PDAS_E2E_RETIRE_MATERIAL_ID ?? 1021);
const RETIRE_PALLET_ID = Number(process.env.PDAS_E2E_RETIRE_PALLET_ID ?? 1019);

const mssql = (await import(fileUrl(path.join(REPO, 'node_modules/mssql/index.js')))).default;
const { loadApiConfig } = await import(fileUrl(path.join(REPO, 'api/dist/config.js')));
const { createPool } = await import(fileUrl(path.join(REPO, 'node_modules/@sms/sync-worker/dist/db.js')));
const { PdasWriter } = await import(fileUrl(path.join(REPO, 'api/dist/services/pdasWrite.js')));
const { planChangeover, executeChangeover } = await import(fileUrl(path.join(REPO, 'api/dist/services/changeover.js')));

const enabledEnv = {
  ...baseEnv,
  PDAS_WRITE_ENABLED: 'true',
  PDAS_WRITE_SERVER: hostOnly,
  PDAS_WRITE_PORT: String(WRITE_PORT),
  PDAS_WRITE_DATABASE: WRITE_DB,
  PDAS_WRITE_USER: writerEnv.PDAS_WRITE_USER,
  PDAS_WRITE_PASSWORD: writerEnv.PDAS_WRITE_PASSWORD,
  APP_DB_SERVER: hostOnly,
  APP_DB_PORT: String(WRITE_PORT),
  APP_DB_NAME: process.env.PDAS_E2E_APP_DB ?? 'sms',
};
const disabledEnv = { ...enabledEnv, PDAS_WRITE_ENABLED: 'false' };

const cfgEnabled = loadApiConfig(enabledEnv);
const cfgDisabled = loadApiConfig(disabledEnv);

let log = [];
let allPass = true;
function rec(section, obj) {
  log.push(`\n### ${section}\n\n\`\`\`json\n${JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n\`\`\`\n`);
  console.log(`--- ${section} ---`);
  console.log(JSON.stringify(obj, null, 2));
}
function verdict(section, pass, note) {
  if (!pass) allPass = false;
  const line = `\n**VERDICT [${section}]: ${pass ? 'PASS' : 'FAIL'}** — ${note}\n`;
  log.push(line);
  console.log(line);
}

const appPool = await createPool(cfgEnabled.appDb, {});
console.log('appPool connected:', appPool.connected);

const pdasRawPool = await new mssql.ConnectionPool({
  server: hostOnly,
  port: Number(WRITE_PORT),
  database: WRITE_DB,
  user: writerEnv.PDAS_WRITE_USER,
  password: writerEnv.PDAS_WRITE_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true },
}).connect();
console.log('pdasRawPool connected:', pdasRawPool.connected);

const writer = new PdasWriter(appPool, cfgEnabled.pdasWrite, cfgEnabled.lineId);
const writerDisabled = new PdasWriter(appPool, cfgDisabled.pdasWrite, cfgDisabled.lineId);

const actor = { userId: 2, username: 'super' }; // sms.app_user id=2, role_id=2 (engineer, rank>=2)

// sms_pdas_writer holds EXECUTE on the 7 procs + UPDATE Materials + INSERT
// nhs_events + SELECT on the 5 reference tables + SELECT on nhs_events
// (least-privilege reader grant added for the UNVERIFIED read-back check).
// nhs_events full-table reads still go through sqlcmd -E (Windows auth,
// admin, read-only) for parity with prior execution passes.
const { execSync } = await import('node:child_process');
function sqlcmdJson(query) {
  const out = execSync(
    `sqlcmd -S "tcp:${hostOnly},${WRITE_PORT}" -E -y 0 -Q "SET NOCOUNT ON; ${query.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  const lines = out.split(/\r?\n/);
  const body = lines.filter(
    (l) => !/^-+\s*$/.test(l.trim()) && l.trim() !== 'JSON_F52E2957-146C-11D1-B1E1-00C04FC2A0A9' && !/^\(\d+ rows? affected\)$/.test(l.trim()),
  );
  const text = body.join('').trim();
  if (!text) return [];
  try { return JSON.parse(text); } catch { return [{ raw: text }]; }
}
async function maxEventId() {
  const r = await pdasRawPool.request().query('SELECT MAX(EventId) mx FROM dbo.nhs_events').catch(() => null);
  if (r) return r.recordset[0].mx ?? 0;
  const j = sqlcmdJson(`SELECT MAX(EventId) mx FROM ${WRITE_DB}.dbo.nhs_events FOR JSON AUTO`);
  return j[0]?.mx ?? 0;
}
async function maxChangeId() {
  const r = await appPool.request().query('SELECT MAX(change_id) mx FROM sms.product_change');
  return r.recordset[0].mx ?? 0;
}
async function maxFindingId() {
  const r = await appPool.request().query('SELECT MAX(finding_id) mx FROM sms.dq_finding');
  return r.recordset[0].mx ?? 0;
}
async function readBack(afterEvent, afterChange, afterFinding) {
  const evRows = sqlcmdJson(`SELECT * FROM ${WRITE_DB}.dbo.nhs_events WHERE EventId > ${afterEvent} ORDER BY EventId FOR JSON AUTO`);
  const ch = await appPool.request().input('c', mssql.Int, afterChange).query('SELECT * FROM sms.product_change WHERE change_id > @c ORDER BY change_id');
  const fd = await appPool.request().input('f', mssql.Int, afterFinding).query('SELECT * FROM sms.dq_finding WHERE finding_id > @f ORDER BY finding_id');
  return { nhs_events: evRows, product_change: ch.recordset, dq_finding: fd.recordset };
}
async function pdasCounts() {
  const r = await pdasRawPool.request().query(`
    SELECT 'Materials' t, COUNT(*) c, MAX(MaterialId) mx FROM dbo.Materials
    UNION ALL SELECT 'Blends', COUNT(*), MAX(BlendId) FROM dbo.Blends
    UNION ALL SELECT 'Counts', COUNT(*), MAX(CountId) FROM dbo.Counts
    UNION ALL SELECT 'TubeTypes', COUNT(*), MAX(TubeTypeId) FROM dbo.TubeTypes
    UNION ALL SELECT 'Pallets', COUNT(*), MAX(PalletId) FROM dbo.Pallets`);
  return r.recordset;
}
function countsMap(rows) { return Object.fromEntries(rows.map((r) => [r.t, r])); }
function countsEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

log.push(`# PDAS Write-Path Local E2E Results\n`);
log.push(`Run against ${WRITE_DB} + sms on ${hostOnly}:${WRITE_PORT} only. Actor: sms.app_user id=2 ("super", role_id=2). Generated ${new Date().toISOString()}.\n`);

rec('Startup — cfgEnabled.pdasWrite', { enabled: cfgEnabled.pdasWrite.enabled, disabledReason: cfgEnabled.pdasWrite.disabledReason });
rec('Startup — cfgDisabled.pdasWrite', { enabled: cfgDisabled.pdasWrite.enabled, disabledReason: cfgDisabled.pdasWrite.disabledReason });
rec('Startup — PDAS counts before any run', await pdasCounts());

let __NEW_MATERIAL_ID__ = null;
let __NEW_TUBE_NAME__ = 'E2E-TUBE-0924';
let __NEW_TUBE_FORM__ = 2;

// ============================================================ R1 — full changeover plan+execute
{
  const req = {
    blend: { name: 'E2E-BLEND-0924' },
    count: { name: 'E2E-COUNT-0924' },
    tubeType: { name: __NEW_TUBE_NAME__, tubeWeightG: 70, tubeForm: __NEW_TUBE_FORM__ },
    material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: 'E2E-LOT-0924', ppColour: 'E2E' },
    pallet: { packSchemaId: 1, lot: 'E2E-LOT-0924', sackColour: 'E2E' },
    retire: { productIds: [RETIRE_MATERIAL_ID], palletIds: [RETIRE_PALLET_ID] },
    reason: 'Local end-to-end proof — full case coverage re-run',
  };
  const bounds = { setpointLoG: 100, setpointHiG: 3000 };
  const cBefore = await pdasCounts();
  const e0 = await maxEventId(), c0 = await maxChangeId(), f0 = await maxFindingId();
  const plan = await planChangeover({ pool: appPool, writer, bounds }, req);
  rec('R1 PLAN — request', req);
  rec('R1 PLAN — result', plan);
  const planOk = plan.writesEnabled === true && plan.blockers.length === 0;
  verdict('R1-plan', planOk, planOk ? 'writesEnabled=true, blockers empty' : `writesEnabled=${plan.writesEnabled}, blockers=${JSON.stringify(plan.blockers)}`);

  const outcome = await executeChangeover({ pool: appPool, writer, bounds }, req, actor);
  rec('R1 EXECUTE — result', outcome);
  const rb = await readBack(e0, c0, f0);
  rec('R1 EXECUTE — read-back (nhs_events / product_change / dq_finding)', rb);

  const expectedOrder = ['blend', 'count', 'tube_type', 'material', 'pallet', 'retire_material', 'retire_pallet'];
  const stepsOk = 'ok' in outcome && outcome.ok === true && outcome.done?.length === 7 &&
    outcome.done.map((d) => d.step).join(',') === expectedOrder.join(',');

  const cAfter = await pdasCounts();
  rec('R1 — PDAS counts after', cAfter);
  const mb = countsMap(cBefore), ma = countsMap(cAfter);
  const countsOk = ma.Blends.c === mb.Blends.c + 1 && ma.Counts.c === mb.Counts.c + 1 &&
    ma.TubeTypes.c === mb.TubeTypes.c + 1 && ma.Materials.c === mb.Materials.c + 1 && ma.Pallets.c === mb.Pallets.c + 1;

  const matRow = await pdasRawPool.request().input('id', mssql.Int, RETIRE_MATERIAL_ID).query('SELECT MaterialActive FROM dbo.Materials WHERE MaterialId=@id');
  const palRow = await pdasRawPool.request().input('id', mssql.Int, RETIRE_PALLET_ID).query('SELECT PalletActive FROM dbo.Pallets WHERE PalletId=@id');
  const retiredOk = matRow.recordset[0]?.MaterialActive === false && palRow.recordset[0]?.PalletActive === false;

  // No UNVERIFIED read-back and no pdas_write_unverified finding — the
  // writer's SELECT grant on the reference tables + nhs_events means every
  // read-back this pass should succeed cleanly.
  const noUnverifiedMsg = !rb.product_change.some((c) => typeof c.message === 'string' && c.message.startsWith('UNVERIFIED'));
  const noUnverifiedFinding = !rb.dq_finding.some((f) => f.check_name === 'pdas_write_unverified');
  const noMismatch = !rb.dq_finding.some((f) => f.check_name === 'pdas_write_echo_mismatch' || f.check_name === 'pdas_write_readback_failed');

  const newMaterialId = outcome.materialId ?? null;
  rec('R1 — derived checks', { stepsOk, countsOk, retiredOk, noUnverifiedMsg, noUnverifiedFinding, noMismatch, newMaterialId, newPalletId: outcome.palletId ?? null });
  verdict('R1-execute', stepsOk && countsOk && retiredOk && noUnverifiedMsg && noUnverifiedFinding && noMismatch,
    `stepsOk=${stepsOk} countsOk=${countsOk} retiredOk=${retiredOk} noUnverifiedMsg=${noUnverifiedMsg} noUnverifiedFinding=${noUnverifiedFinding} noMismatch=${noMismatch}`);

  __NEW_MATERIAL_ID__ = newMaterialId;
}

// ============================================================ R2 — updateProductLimits, fresh before each call
{
  if (__NEW_MATERIAL_ID__ == null) {
    console.warn('R2 skipped: R1 did not produce a materialId.');
    verdict('R2', false, 'skipped — no materialId from R1');
  } else {
    const productId = __NEW_MATERIAL_ID__;
    const rawBefore = await pdasRawPool.request().input('id', mssql.Int, productId).query(
      `SELECT MaterialSetpointWeight sp, MaterialWeightOffsetMinus om, MaterialWeightOffsetPlus op, MaterialDesc1 d1, MaterialDesc2 d2, MaterialActive a FROM dbo.Materials WHERE MaterialId=@id`);
    const rb0 = rawBefore.recordset[0];
    const before = { setpointG: Number(rb0.sp), offsetMinusG: Number(rb0.om), offsetPlusG: Number(rb0.op), desc1: rb0.d1 ?? null, desc2: rb0.d2 ?? null, active: Boolean(rb0.a) };
    const after = { ...before, setpointG: before.setpointG + 5 };
    const bounds = { setpointLoG: 100, setpointHiG: 3000 };
    rec('R2 — before (raw PDAS, fresh read used as the optimistic-concurrency base)', before);
    const c0 = await maxChangeId();
    const r = await writer.updateProductLimits({ productId, before, after, bounds, reason: 'R2 local e2e limits update', actor });
    rec('R2 — result', r);
    const ch = await appPool.request().input('c', mssql.Int, c0).query("SELECT * FROM sms.product_change WHERE change_id > @c ORDER BY change_id");
    rec('R2 — product_change rows', ch.recordset);
    const ok = r.ok === true && ch.recordset.some((x) => x.outcome === 'ok' && x.operation === 'update_limits');
    verdict('R2', ok, `ok=${r.ok}`);
  }
}

// ============================================================ R3 — reactivate the retired material
{
  const r = await writer.setProductActive({ productId: RETIRE_MATERIAL_ID, active: true, reason: 'R3 reactivate retired material local e2e', actor });
  rec('R3 — result', r);
  const chk = await pdasRawPool.request().input('id', mssql.Int, RETIRE_MATERIAL_ID).query('SELECT MaterialActive FROM dbo.Materials WHERE MaterialId=@id');
  rec('R3 — read-back MaterialActive', chk.recordset[0]);
  verdict('R3', r.ok === true && chk.recordset[0].MaterialActive === true, `ok=${r.ok} MaterialActive=${chk.recordset[0].MaterialActive}`);
}

// ============================================================ F1 — blocker: reuse retired material's own triple
{
  const mat = await pdasRawPool.request().input('id', mssql.Int, RETIRE_MATERIAL_ID).query('SELECT BlendId, CountId, TubeTypeId FROM dbo.Materials WHERE MaterialId=@id');
  const { BlendId, CountId, TubeTypeId } = mat.recordset[0];
  const req = {
    blend: { id: BlendId }, count: { id: CountId }, tubeType: { id: TubeTypeId },
    material: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, lot: 'F1-LOT', ppColour: null },
    pallet: { packSchemaId: 1, lot: 'F1-LOT', sackColour: null },
    retire: { productIds: [], palletIds: [] }, reason: 'F1 blocker case — reused retired-material triple',
  };
  const bounds = { setpointLoG: 100, setpointHiG: 3000 };
  const plan = await planChangeover({ pool: appPool, writer, bounds }, req);
  rec('F1 — plan (reused retired-material triple)', plan);
  const cBefore = await pdasCounts();
  const e0 = await maxEventId();
  const outcome = await executeChangeover({ pool: appPool, writer, bounds }, req, actor);
  rec('F1 — execute attempt result', outcome);
  const cAfter = await pdasCounts();
  const eAfter = await maxEventId();
  const zeroChange = countsEqual(cBefore, cAfter) && e0 === eAfter;
  rec('F1 — counts before/after (must be identical)', { cBefore, cAfter, e0, eAfter });
  const ok = plan.blockers.length > 0 && 'refused' in outcome && zeroChange;
  verdict('F1', ok, `blockers=${plan.blockers.length} refused=${'refused' in outcome} zeroChange=${zeroChange}`);
}

// ============================================================ F2 — createProduct duplicate triple -> -7001
{
  const mat = await pdasRawPool.request().input('id', mssql.Int, RETIRE_MATERIAL_ID).query('SELECT BlendId, CountId, TubeTypeId FROM dbo.Materials WHERE MaterialId=@id');
  const { BlendId, CountId, TubeTypeId } = mat.recordset[0];
  const before = await pdasCounts();
  const r = await writer.createProduct({
    blendId: BlendId, countId: CountId, tubeTypeId: TubeTypeId,
    fields: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, desc1: 'F2', desc2: null, active: true },
    bounds: { setpointLoG: 100, setpointHiG: 3000 }, reason: 'F2 direct -7001 case', actor,
  });
  rec('F2 — createProduct direct result', r);
  const after = await pdasCounts();
  const mb = countsMap(before).Materials, ma = countsMap(after).Materials;
  rec('F2 — Materials count before/after', { before: mb, after: ma });
  const ok = r.ok === false && r.pdasErrorCode === -7001 && mb.c === ma.c;
  verdict('F2', ok, `ok=${r.ok} code=${r.pdasErrorCode} materialsUnchanged=${mb.c === ma.c}`);
}

// ============================================================ F3a/F3b — addTubeType duplicate & LIKE-collision
{
  const before = await pdasCounts();
  const r = await writer.addTubeType({ tubeType: 'RED', tubeWeightG: 70, tubeForm: 2, reason: 'F3a direct -5001 case', actor });
  rec('F3a — addTubeType direct duplicate ("RED") result', r);
  const after = await pdasCounts();
  const mb = countsMap(before).TubeTypes, ma = countsMap(after).TubeTypes;
  const ok1 = r.ok === false && r.pdasErrorCode === -5001 && mb.c === ma.c;
  verdict('F3a', ok1, `ok=${r.ok} code=${r.pdasErrorCode} tubeTypesUnchanged=${mb.c === ma.c}`);

  const req = {
    blend: { name: 'F3-BLEND' }, count: { name: 'F3-COUNT' },
    tubeType: { name: 'R_D', tubeWeightG: 70, tubeForm: 2 },
    material: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, lot: 'F3-LOT', ppColour: null },
    pallet: { packSchemaId: 1, lot: 'F3-LOT', sackColour: null },
    retire: { productIds: [], palletIds: [] }, reason: 'F3b LIKE-collision plan check',
  };
  const plan = await planChangeover({ pool: appPool, writer, bounds: { setpointLoG: 100, setpointHiG: 3000 } }, req);
  rec('F3b — plan with tube name "R_D" (LIKE-collides with "RED")', plan);
  const ok2 = plan.blockers.some((b) => /R_D|LIKE|RED/i.test(b));
  verdict('F3b', ok2, `blockers=${JSON.stringify(plan.blockers)}`);
}

// ============================================================ F4 — optimistic concurrency, fresh `before`, reused across both calls
{
  if (__NEW_MATERIAL_ID__ == null) {
    console.warn('F4 skipped: R1 did not produce a materialId.');
    verdict('F4', false, 'skipped — no materialId from R1');
  } else {
    const productId = __NEW_MATERIAL_ID__;
    const rawNow = await pdasRawPool.request().input('id', mssql.Int, productId).query(
      `SELECT MaterialSetpointWeight sp, MaterialWeightOffsetMinus om, MaterialWeightOffsetPlus op, MaterialDesc1 d1, MaterialDesc2 d2, MaterialActive a FROM dbo.Materials WHERE MaterialId=@id`);
    const rn = rawNow.recordset[0];
    const before = { setpointG: Number(rn.sp), offsetMinusG: Number(rn.om), offsetPlusG: Number(rn.op), desc1: rn.d1 ?? null, desc2: rn.d2 ?? null, active: Boolean(rn.a) };
    rec('F4 — fresh `before` snapshot used for both calls', before);
    const bounds = { setpointLoG: 100, setpointHiG: 3000 };
    const c0 = await maxChangeId();
    const r1 = await writer.updateProductLimits({ productId, before, after: { ...before, setpointG: before.setpointG + 5 }, bounds, reason: 'F4 first call, fresh before', actor });
    rec('F4 — first call result', r1);
    const r2 = await writer.updateProductLimits({ productId, before, after: { ...before, setpointG: before.setpointG + 15 }, bounds, reason: 'F4 second call, SAME before reused', actor });
    rec('F4 — second call result (same before reused, no re-read between calls)', r2);
    const ch = await appPool.request().input('c', mssql.Int, c0).query("SELECT * FROM sms.product_change WHERE change_id > @c AND operation='update_limits' ORDER BY change_id");
    rec('F4 — product_change rows', ch.recordset);
    const rawAfter = await pdasRawPool.request().input('id', mssql.Int, productId).query(`SELECT MaterialSetpointWeight sp FROM dbo.Materials WHERE MaterialId=@id`);
    rec('F4 — PDAS row after both calls (only ONE update should have landed)', rawAfter.recordset[0]);
    const oneUpdate = ch.recordset.filter((x) => x.outcome === 'ok').length === 1;
    const oneConflict = ch.recordset.some((x) => x.outcome === 'conflict');
    const ok = r1.ok === true && r2.ok === false && r2.code === 'CONFLICT' && oneUpdate && oneConflict;
    verdict('F4', ok, `r1.ok=${r1.ok} r2.ok=${r2.ok} r2.code=${r2.code ?? 'n/a'} oneUpdate=${oneUpdate} oneConflict=${oneConflict} finalSetpoint=${rawAfter.recordset[0].sp}`);
  }
}

// ============================================================ F5/F5b — write-disabled path
{
  const bounds = { setpointLoG: 100, setpointHiG: 3000 };
  const before = await pdasCounts();
  const c0 = await maxChangeId();
  const r = await writerDisabled.createProduct({
    blendId: 2, countId: 3, tubeTypeId: 4,
    fields: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, desc1: 'F5', desc2: null, active: true },
    bounds, reason: 'F5 write-disabled direct createProduct call', actor,
  });
  rec('F5 — createProduct via writerDisabled result', r);
  const ch = await appPool.request().input('c', mssql.Int, c0).query("SELECT * FROM sms.product_change WHERE change_id > @c AND outcome='disabled' ORDER BY change_id");
  rec('F5 — product_change disabled row(s)', ch.recordset);
  const after = await pdasCounts();
  const ok = r.ok === false && r.code === 'DISABLED' && ch.recordset.length >= 1 && countsEqual(before, after);
  verdict('F5', ok, `code=${r.code} disabledRows=${ch.recordset.length} pdasUnchanged=${countsEqual(before, after)}`);

  const req2 = {
    blend: { id: 2 }, count: { id: 3 }, tubeType: { id: 4 },
    material: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, lot: 'F5b', ppColour: null },
    pallet: { packSchemaId: 1, lot: 'F5b', sackColour: null },
    retire: { productIds: [], palletIds: [] }, reason: 'F5b changeover execute via disabled writer',
  };
  const out2 = await executeChangeover({ pool: appPool, writer: writerDisabled, bounds }, req2, actor);
  rec('F5b — executeChangeover via disabled writer result', out2);
  verdict('F5b', 'refused' in out2, `refused=${'refused' in out2 ? out2.refused : 'NO — unexpected'}`);
}

// ============================================================ F6 — retire+recreate same triple in one plan
{
  const mat = await pdasRawPool.request().input('id', mssql.Int, RETIRE_MATERIAL_ID).query('SELECT BlendId, CountId, TubeTypeId FROM dbo.Materials WHERE MaterialId=@id');
  const { BlendId, CountId, TubeTypeId } = mat.recordset[0];
  const req = {
    blend: { id: BlendId }, count: { id: CountId }, tubeType: { id: TubeTypeId },
    material: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, lot: 'F6-LOT', ppColour: null },
    pallet: { packSchemaId: 1, lot: 'F6-LOT', sackColour: null },
    retire: { productIds: [RETIRE_MATERIAL_ID], palletIds: [] }, reason: 'F6 retire-and-recreate same triple in one plan',
  };
  const plan = await planChangeover({ pool: appPool, writer, bounds: { setpointLoG: 100, setpointHiG: 3000 } }, req);
  rec('F6 — plan (retire + recreate its own triple)', plan);
  const ok = plan.blockers.length > 0;
  verdict('F6', ok, `blockers=${JSON.stringify(plan.blockers)}`);
}

// ============================================================ T1 — resolveTube same-name reuse vs add
{
  const mirrorRow = await appPool.request().query(`SELECT tube_type_id, tube_type, tube_form FROM sms.tube_type WHERE tube_type = '${__NEW_TUBE_NAME__}'`);
  rec('T1 — mirror row for the tube R1 created', mirrorRow.recordset);
  const bounds = { setpointLoG: 100, setpointHiG: 3000 };
  async function planWith(tubeForm, label) {
    const req = {
      blend: { id: 2 }, count: { id: 3 },
      tubeType: { name: __NEW_TUBE_NAME__, tubeWeightG: 70, tubeForm },
      material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: 'T1-PLANONLY', ppColour: 'T1' },
      pallet: { id: 1 },
      retire: { productIds: [], palletIds: [] },
      reason: `T1 plan-only tube_form check (${label})`,
    };
    const plan = await planChangeover({ pool: appPool, writer, bounds }, req);
    const tubeStep = plan.steps?.find((s) => s.step === 'tube_type') ?? null;
    return { tubeStep, blockers: plan.blockers, warnings: plan.warnings };
  }
  const same = await planWith(__NEW_TUBE_FORM__, 'same form -> expect reuse');
  const diff = await planWith(__NEW_TUBE_FORM__ === 2 ? 1 : 2, 'different form -> expect add');
  rec('T1 — plan (same name, same form)', same);
  rec('T1 — plan (same name, different form)', diff);
  const sameOk = same.tubeStep && same.tubeStep.action === 'reuse' && same.tubeStep.id === mirrorRow.recordset[0]?.tube_type_id;
  const diffOk = diff.tubeStep && diff.tubeStep.action === 'add';
  verdict('T1', Boolean(sameOk && diffOk), `sameForm.action=${same.tubeStep?.action} diffForm.action=${diff.tubeStep?.action}`);
}

log.push(`\n## Summary\n\nOverall: **${allPass ? 'ALL PASS' : 'SOME FAILED — see verdicts above'}**\n`);

if (OUT) {
  writeFileSync(OUT, log.join('\n'));
  console.log('\nWrote', OUT);
} else {
  console.log('\nPDAS_E2E_OUT_FILE not set; results printed to stdout only.');
}

await writer.close();
await writerDisabled.close();
await pdasRawPool.close();
await appPool.close();

console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
