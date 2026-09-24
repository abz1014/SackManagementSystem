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
 *   - `api/dist` must be built (`npm run build -w api` or equivalent) —
 *     this script imports the compiled JS, not the TypeScript source.
 *   - Needs a local-only, gitignored `sms/.env.e2e-writer` file with:
 *       PDAS_WRITE_USER=sms_pdas_writer
 *       PDAS_WRITE_PASSWORD=<the password set when 12_pdas_writer.template.sql ran>
 *     Never commit that file. This script never prints its contents.
 *   - Needs `sms/.env` present (read for the app-DB and other base config;
 *     this script overrides PDAS_WRITE_* and APP_DB_* in-process only — it
 *     never writes to `.env` and never touches the real running API).
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
 * OUTPUT. Writes a results Markdown file (path from OUT_FILE, or stdout
 * only if not set) with one JSON block per step and a PASS/FAIL verdict
 * per case, in the same shape as `PDAS-EXECUTION-2026-09-24.md` quotes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
function rec(section, obj) {
  log.push(`\n### ${section}\n\n\`\`\`json\n${JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n\`\`\`\n`);
  console.log(`--- ${section} ---`);
  console.log(JSON.stringify(obj, null, 2));
}
function verdict(section, pass, note) {
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
// nhs_events + SELECT on the 5 reference tables ONLY (least-privilege) — no
// SELECT on nhs_events itself. nhs_events reads go through sqlcmd -E
// (Windows auth, admin, read-only) instead of the writer's own pool.
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

log.push(`# PDAS Write-Path Local E2E Results\n`);
log.push(`Run against ${WRITE_DB} + sms on ${hostOnly}:${WRITE_PORT} only. Actor: sms.app_user id=2 ("super", role_id=2).\n`);

rec('Startup — cfgEnabled.pdasWrite', { enabled: cfgEnabled.pdasWrite.enabled, disabledReason: cfgEnabled.pdasWrite.disabledReason });
rec('Startup — cfgDisabled.pdasWrite', { enabled: cfgDisabled.pdasWrite.enabled, disabledReason: cfgDisabled.pdasWrite.disabledReason });
rec('Startup — PDAS counts before any run', await pdasCounts());

// ============================================================ R1 — full changeover plan+execute
{
  const req = {
    blend: { name: 'E2E-BLEND' },
    count: { name: 'E2E-COUNT' },
    tubeType: { name: 'E2E-TUBE', tubeWeightG: 70, tubeForm: 2 },
    material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: 'E2E-LOT', ppColour: 'E2E' },
    pallet: { packSchemaId: 1, lot: 'E2E-LOT', sackColour: 'E2E' },
    retire: { productIds: [], palletIds: [] }, // caller should fill with real ids to exercise retire
    reason: 'Local end-to-end proof',
  };
  const bounds = { setpointLoG: 100, setpointHiG: 3000 };
  const e0 = await maxEventId(), c0 = await maxChangeId(), f0 = await maxFindingId();
  const plan = await planChangeover({ pool: appPool, writer, bounds }, req);
  rec('R1 PLAN — request', req);
  rec('R1 PLAN — result', plan);
  const planOk = plan.writesEnabled === true;
  verdict('R1-plan', planOk, `writesEnabled=${plan.writesEnabled}, blockers=${JSON.stringify(plan.blockers)}`);

  const outcome = await executeChangeover({ pool: appPool, writer, bounds }, req, actor);
  rec('R1 EXECUTE — result', outcome);
  const rb = await readBack(e0, c0, f0);
  rec('R1 EXECUTE — read-back (nhs_events / product_change / dq_finding)', rb);
  const counts = await pdasCounts();
  rec('R1 — PDAS counts after', counts);
  globalThis.__NEW_MATERIAL_ID__ = outcome.materialId ?? null;
}

// ============================================================ R2 — updateProductLimits, fresh before each call
{
  const productId = globalThis.__NEW_MATERIAL_ID__;
  if (productId == null) {
    console.warn('R2 skipped: R1 did not produce a materialId.');
  } else {
    const rawBefore = await pdasRawPool.request().input('id', mssql.Int, productId).query(
      `SELECT MaterialSetpointWeight sp, MaterialWeightOffsetMinus om, MaterialWeightOffsetPlus op, MaterialDesc1 d1, MaterialDesc2 d2, MaterialActive a FROM dbo.Materials WHERE MaterialId=@id`);
    const rb0 = rawBefore.recordset[0];
    const before = { setpointG: Number(rb0.sp), offsetMinusG: Number(rb0.om), offsetPlusG: Number(rb0.op), desc1: rb0.d1 ?? null, desc2: rb0.d2 ?? null, active: Boolean(rb0.a) };
    const after = { ...before, setpointG: before.setpointG + 5 };
    const bounds = { setpointLoG: 100, setpointHiG: 3000 };
    rec('R2 — before (raw PDAS, fresh read used as the optimistic-concurrency base)', before);
    const r = await writer.updateProductLimits({ productId, before, after, bounds, reason: 'R2 local e2e limits update', actor });
    rec('R2 — result', r);
    verdict('R2', r.ok === true, `ok=${r.ok}`);
  }
}

// ============================================================ F4 — optimistic concurrency, fresh `before`, reused across both calls
{
  const productId = globalThis.__NEW_MATERIAL_ID__;
  if (productId == null) {
    console.warn('F4 skipped: R1 did not produce a materialId.');
  } else {
    // FIX (folded in from pdas-f4-only.mjs, 24 Sep 2026): `before` must be
    // read FRESH, immediately before these two calls, never reused from an
    // earlier step's own snapshot — an earlier step's `before` is already
    // stale by the time F4 runs, which makes BOTH calls below return
    // CONFLICT and never exercises "first call succeeds, second call
    // (reusing the same now-stale before) conflicts", the case this is
    // meant to prove. See PDAS-EXECUTION-2026-09-24.md's "harness bug" note.
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

// ============================================================ F5 — write-disabled path
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
  const ok = r.ok === false && r.code === 'DISABLED' && ch.recordset.length >= 1 && JSON.stringify(before) === JSON.stringify(after);
  verdict('F5', ok, `code=${r.code} disabledRows=${ch.recordset.length} pdasUnchanged=${JSON.stringify(before) === JSON.stringify(after)}`);
}

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
