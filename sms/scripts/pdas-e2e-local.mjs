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
 * CASES COVERED (19, up from 13 — Task P, 28 Sep 2026 extension):
 *   R1 — full changeover plan+execute (blend/count/tube/material/pallet
 *        create, retire an existing material+pallet), all 7 steps in order.
 *   R2 — updateProductLimits on the material R1 created (fresh `before`);
 *        now also asserts the RETURNED observedAfter deep-equals `after`.
 *   R3 — reactivate the retired material from R1 (SetMaterialStatusActive).
 *   R4 — reactivate the retired pallet from R1 (SetPalletStatusActive).
 *   F1 — blocker case: plan reuses the retired material's own triple ->
 *        plan blocked, execute refused, zero PDAS change.
 *   F2 — createProduct with an existing triple -> PDAS -7001, no row.
 *   F3a — addTubeType with an existing name+form ('RED') -> PDAS -5001.
 *   F3b — plan with a tube name that LIKE-collides with an existing one
 *         ('R_D' vs 'RED') -> plan blocked before any PDAS call.
 *   F3c — addTubeType with an invalid tube form (3) -> IMPLAUSIBLE, zero rows
 *         changed, procedure never called.
 *   F3d — addTubeType with an invalid tube weight (-1) -> IMPLAUSIBLE, zero
 *         rows changed, procedure never called.
 *   F4 — optimistic concurrency: fresh `before` reused for two successive
 *        updateProductLimits calls; first succeeds, second CONFLICTs.
 *   F5 — write-disabled path via a disabled-config PdasWriter -> DISABLED,
 *        zero PDAS change.
 *   F5b — same, through executeChangeover's own disabled short-circuit.
 *   F6 — plan retiring a material and recreating its own triple in the SAME
 *        plan -> blocked (retire-and-recreate can never work, by design).
 *   F7 — a fresh triple: create, retire, attempt to re-create the SAME
 *        blend/count/tube -> PDAS -7001, no row inserted; then reactivate.
 *        The live, tagged-data reproduction of the retire-and-recreate
 *        refusal F6 only shows as a plan-time blocker.
 *   T1 — resolveTube via plan-only calls: same name + same form => 'reuse'
 *        (existing tube_type_id); same name + different form => 'add'.
 *   A1 — for every tracked write in this run, exactly one sms.product_change
 *        row exists with the right operation, proc name, outcome and error
 *        code (cross-checks R1's 7 steps, R2, R3, R4, F2, F3a, F3c, F3d, and
 *        F7's four writer calls against what was actually inserted).
 *   N1 — every dbo.nhs_events row this run created has non-null Src,
 *        Severity and Logtext, a Severity value already in the vendor's own
 *        set, and the same non-null columns every vendor-authored row has.
 *
 * LOCAL ONLY, ALWAYS. This script must never run against the plant. THREE
 * layers of guard, in order:
 *   1. A static, pre-connection check (unchanged from the original version
 *      of this script): the write target's host must resolve to
 *      localhost/127.0.0.1/::1, and its database name must end in `_SEP07`
 *      or `_E2E`.
 *   2. A HARD, LIVE pre-flight (new, Task P) run immediately after
 *      connecting, before any case executes, which ABORTS unless ALL of:
 *        - `@@SERVERNAME` equals `<this machine's hostname>\SQLEXPRESS`
 *          (os.hostname() + '\SQLEXPRESS', compared case-insensitively);
 *        - `DB_NAME()` is EXACTLY `PDAS_TP1U2_SEP07` — not merely
 *          `_SEP07`-suffixed, the live value itself;
 *        - `.env`'s own PDAS_WRITE_SERVER / PDAS_WRITE_DATABASE (when set)
 *          agree with what @@SERVERNAME / DB_NAME() just reported, so a
 *          stray override (PDAS_E2E_SERVER / PDAS_E2E_DATABASE) can never
 *          silently diverge from what `.env` itself says is configured.
 *   3. A leftover-data check (new, Task P): if any row already carries this
 *      script's own tag pattern ('E2E-%', in Blends/Counts/TubeTypes/
 *      Materials.MaterialDesc1/Pallets.Lot), the run refuses — that means an
 *      earlier run's writes were never restored from backup, and running
 *      again on top of them would make every count-based assertion in this
 *      script meaningless.
 * There is no override flag for any of the three. If you need to run this
 * against a different local copy, name that copy's database `..._E2E`
 * rather than removing the guard — but note guard #2 above is scoped to
 * `PDAS_TP1U2_SEP07` specifically, so an `_E2E`-named copy now only passes
 * guard #1; tighten guard #2 too if you actually need that path.
 *
 * RUN TAGGING. Every name this script creates (blends, counts, tube types,
 * material lots) carries `PDAS_E2E_RUN_TAG` (default: a compact UTC
 * timestamp, `YYYYMMDDHHMMSS`) so a run's rows are identifiable at a glance
 * and never collide with a previous run's un-restored leftovers (which the
 * leftover-data check above would have caught anyway).
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
 *   - Writer credentials: PDAS_WRITE_USER / PDAS_WRITE_PASSWORD are read
 *     from `sms/.env` FIRST (Task P); if either is absent there, this script
 *     falls back to a local-only, gitignored `sms/.env.e2e-writer`:
 *       PDAS_WRITE_USER=sms_pdas_writer
 *       PDAS_WRITE_PASSWORD=<the password set when 12_pdas_writer.template.sql ran>
 *     Never commit that file. This script logs the resolved user NAME and
 *     which file it came from — never the password, from either source.
 *   - Needs `sms/.env` present (read for the app-DB and other base config;
 *     this script overrides PDAS_WRITE_* and APP_DB_* in-process only — it
 *     never writes to `.env` and never touches the real running API).
 *   - Optional overrides: PDAS_E2E_SERVER / PDAS_E2E_PORT (default 14330) /
 *     PDAS_E2E_DATABASE (default PDAS_TP1U2_SEP07) / PDAS_E2E_APP_DB
 *     (default sms) / PDAS_E2E_OUT_FILE (results Markdown path; stdout only
 *     if unset) / PDAS_E2E_RETIRE_MATERIAL_ID (default 1021) /
 *     PDAS_E2E_RETIRE_PALLET_ID (default 1019) / PDAS_E2E_RUN_TAG (default a
 *     compact UTC timestamp).
 *   - `node --check scripts/pdas-e2e-local.mjs` should pass with no other
 *     setup; actually running it needs the built dist, a reachable local
 *     SQLEXPRESS instance matching guard #2 above, and the writer
 *     credentials described above.
 *
 * WHAT IT NEVER DOES. Never writes to any `DATA_TP1U2*` database. Never
 * edits `sms/.env`. Never prints a password, connection string secret, or
 * absolute path specific to one contributor's machine. Never creates a
 * login (`sms_pdas_writer` must already exist, created by
 * `db/bootstrap/12_pdas_writer.template.sql` against the SAME local target
 * this guard requires).
 *
 * EXIT CODE. 0 if every case's PASS/FAIL verdict is PASS; 1 if any FAILs
 * (also 1 on any guard refusal). A CI-style "did it work" check.
 *
 * OUTPUT. Writes a results Markdown file (path from PDAS_E2E_OUT_FILE, or
 * stdout only if not set) with one JSON block per step, a PASS/FAIL verdict
 * per case, and a per-right summary table (Task P) naming, for each of the
 * nine PDAS write rights, which case exercised its happy path and which
 * exercised a failure path.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// GUARD LAYER 1 — static, pre-connection. Refuses to run against anything
// but a local, clearly-marked copy. Not configurable by an environment
// variable on purpose: the whole point is that nobody can point this script
// at the plant by accident via a stray .env edit.
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
// Never logged in full — only ever used to resolve PDAS_WRITE_USER/PASSWORD
// as a FALLBACK when .env itself does not carry them (see resolveWriterCreds).
const writerEnv = parseEnvFile(path.join(REPO, '.env.e2e-writer'));

const WRITE_SERVER = process.env.PDAS_E2E_SERVER ?? baseEnv.PDAS_WRITE_SERVER ?? 'localhost';
const WRITE_PORT = process.env.PDAS_E2E_PORT ?? baseEnv.PDAS_WRITE_PORT ?? '14330';
const WRITE_DB = process.env.PDAS_E2E_DATABASE ?? baseEnv.PDAS_WRITE_DATABASE ?? 'PDAS_TP1U2_SEP07';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const hostOnly = String(WRITE_SERVER).split('\\')[0].split(',')[0].trim().toLowerCase();

function refuse(reason) {
  console.error(`REFUSING TO RUN: ${reason}`);
  console.error(`  PDAS_E2E server resolved to: "${WRITE_SERVER}" (host: "${hostOnly}")`);
  console.error(`  PDAS_E2E database resolved to: "${WRITE_DB}"`);
  console.error('  This script only ever runs against a local, clearly-marked copy.');
  console.error('  It must never be pointed at the plant. There is no override flag.');
  process.exit(1);
}

if (!LOCAL_HOSTS.has(hostOnly)) {
  refuse(`server "${WRITE_SERVER}" does not resolve to localhost/127.0.0.1/::1.`);
}
if (!/_(SEP07|E2E)$/i.test(WRITE_DB)) {
  refuse(`database "${WRITE_DB}" does not end in _SEP07 or _E2E.`);
}

/**
 * Resolve the writer login name/password: `.env` first, `.env.e2e-writer` as
 * the fallback (Task P). Returns the source file name too, for the
 * name-only log line below — never the password.
 */
function resolveWriterCreds() {
  const envHasBoth = baseEnv.PDAS_WRITE_USER && baseEnv.PDAS_WRITE_USER.trim() !== '' && baseEnv.PDAS_WRITE_PASSWORD && baseEnv.PDAS_WRITE_PASSWORD.trim() !== '';
  if (envHasBoth) {
    return { user: baseEnv.PDAS_WRITE_USER, password: baseEnv.PDAS_WRITE_PASSWORD, source: '.env' };
  }
  return { user: writerEnv.PDAS_WRITE_USER, password: writerEnv.PDAS_WRITE_PASSWORD, source: '.env.e2e-writer' };
}
const writerCreds = resolveWriterCreds();
if (!writerCreds.user || !writerCreds.password) {
  refuse('no PDAS_WRITE_USER/PDAS_WRITE_PASSWORD found in .env or .env.e2e-writer.');
}
console.log(`PDAS writer login (name only, never the password): "${writerCreds.user}", read from ${writerCreds.source}.`);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function fileUrl(p) {
  return pathToFileURL(path.resolve(p)).href;
}

const OUT = process.env.PDAS_E2E_OUT_FILE ?? null; // optional; stdout-only if unset
const RETIRE_MATERIAL_ID = Number(process.env.PDAS_E2E_RETIRE_MATERIAL_ID ?? 1021);
const RETIRE_PALLET_ID = Number(process.env.PDAS_E2E_RETIRE_PALLET_ID ?? 1019);
// Every name this run creates carries this tag — traceable at a glance, and
// distinct from any earlier run's (the leftover-data guard below catches an
// un-restored earlier run regardless of tag value, by matching 'E2E-%').
const RUN_TAG = process.env.PDAS_E2E_RUN_TAG ?? new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
console.log('RUN_TAG:', RUN_TAG);

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
  PDAS_WRITE_USER: writerCreds.user,
  PDAS_WRITE_PASSWORD: writerCreds.password,
  APP_DB_SERVER: hostOnly,
  APP_DB_PORT: String(WRITE_PORT),
  APP_DB_NAME: process.env.PDAS_E2E_APP_DB ?? 'sms',
};
const disabledEnv = { ...enabledEnv, PDAS_WRITE_ENABLED: 'false' };

const cfgEnabled = loadApiConfig(enabledEnv);
const cfgDisabled = loadApiConfig(disabledEnv);

let log = [];
let allPass = true;
const verdicts = {}; // section name -> boolean, for the per-right summary table
function rec(section, obj) {
  log.push(`\n### ${section}\n\n\`\`\`json\n${JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n\`\`\`\n`);
  console.log(`--- ${section} ---`);
  console.log(JSON.stringify(obj, null, 2));
}
function verdict(section, pass, note) {
  if (!pass) allPass = false;
  verdicts[section] = pass;
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
  user: writerCreds.user,
  password: writerCreds.password,
  options: { encrypt: true, trustServerCertificate: true },
}).connect();
console.log('pdasRawPool connected:', pdasRawPool.connected);

async function abort(reason) {
  console.error(`REFUSING TO RUN: ${reason}`);
  for (const p of [appPool, pdasRawPool]) {
    try { await p?.close(); } catch { /* best effort */ }
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// GUARD LAYER 2 — hard, LIVE pre-flight (Task P). Must pass before ANY case
// runs. Queries the server this script is actually connected to, rather
// than trusting the strings resolved above.
// ---------------------------------------------------------------------------
{
  const pre = await pdasRawPool.request().query('SELECT @@SERVERNAME AS srv, DB_NAME() AS db');
  const liveSrv = String(pre.recordset[0]?.srv ?? '');
  const liveDb = String(pre.recordset[0]?.db ?? '');
  const expectedSrv = `${os.hostname()}\\SQLEXPRESS`;
  console.log(`Live pre-flight: @@SERVERNAME="${liveSrv}" DB_NAME()="${liveDb}" (expected "${expectedSrv}" / "PDAS_TP1U2_SEP07")`);

  if (liveSrv.toLowerCase() !== expectedSrv.toLowerCase()) {
    await abort(`@@SERVERNAME is "${liveSrv}", expected "${expectedSrv}" (this machine's hostname + \\SQLEXPRESS).`);
  }
  if (liveDb !== 'PDAS_TP1U2_SEP07') {
    await abort(`DB_NAME() is "${liveDb}", expected EXACTLY "PDAS_TP1U2_SEP07".`);
  }
  if (baseEnv.PDAS_WRITE_SERVER && baseEnv.PDAS_WRITE_SERVER.trim() !== '') {
    const envHost = baseEnv.PDAS_WRITE_SERVER.split('\\')[0].split(',')[0].trim().toLowerCase();
    const liveHost = liveSrv.split('\\')[0].split(',')[0].trim().toLowerCase();
    if (envHost !== liveHost) {
      await abort(`.env's PDAS_WRITE_SERVER ("${baseEnv.PDAS_WRITE_SERVER}") does not match the live server ("${liveSrv}").`);
    }
  }
  if (baseEnv.PDAS_WRITE_DATABASE && baseEnv.PDAS_WRITE_DATABASE.trim() !== '' && baseEnv.PDAS_WRITE_DATABASE.trim() !== liveDb) {
    await abort(`.env's PDAS_WRITE_DATABASE ("${baseEnv.PDAS_WRITE_DATABASE}") does not match the live database ("${liveDb}").`);
  }
  console.log('Live pre-flight PASSED.');
}

// ---------------------------------------------------------------------------
// GUARD LAYER 3 — refuse if E2E-tagged rows from a prior, un-restored run
// already exist (Task P). This is a generic 'E2E-%' match, independent of
// THIS run's own RUN_TAG, because the point is to catch ANY earlier run's
// leftovers, tagged or not restored.
// ---------------------------------------------------------------------------
{
  const leftover = await pdasRawPool.request().query(`
    SELECT 'Blends' t, COUNT(*) c FROM dbo.Blends WHERE Blend LIKE 'E2E-%'
    UNION ALL SELECT 'Counts', COUNT(*) FROM dbo.Counts WHERE [Count] LIKE 'E2E-%'
    UNION ALL SELECT 'TubeTypes', COUNT(*) FROM dbo.TubeTypes WHERE TubeType LIKE 'E2E-%'
    UNION ALL SELECT 'Materials', COUNT(*) FROM dbo.Materials WHERE MaterialDesc1 LIKE 'E2E-%'
    UNION ALL SELECT 'Pallets', COUNT(*) FROM dbo.Pallets WHERE Lot LIKE 'E2E-%'`);
  const dirty = leftover.recordset.filter((x) => x.c > 0);
  if (dirty.length > 0) {
    await abort(
      `E2E-tagged rows already exist from a prior run that was not restored: ${JSON.stringify(dirty)}. ` +
        `Restore ${WRITE_DB} from its pre-run backup before re-running this script.`,
    );
  }
  console.log('Leftover-data check PASSED: no E2E-tagged rows found.');
}

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
/** The rows sms.product_change gained since `c0` — the building block A1 below cross-checks against. */
async function changeRowsSince(c0) {
  const r = await appPool.request().input('c', mssql.Int, c0).query('SELECT * FROM sms.product_change WHERE change_id > @c ORDER BY change_id');
  return r.recordset;
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

/**
 * A1's tracking ledger (Task P). Every case that performs a real writer call
 * pushes one entry per call: what operation/proc/outcome/error-code was
 * EXPECTED, and the actual sms.product_change rows inserted since that
 * call's own `change_id` baseline. A1 below asserts, for every entry,
 * exactly one row exists and it matches what was expected.
 */
const A1_ENTRIES = [];

log.push(`# PDAS Write-Path Local E2E Results\n`);
log.push(`Run against ${WRITE_DB} + sms on ${hostOnly}:${WRITE_PORT} only. Actor: sms.app_user id=2 ("super", role_id=2). RUN_TAG=${RUN_TAG}. Generated ${new Date().toISOString()}.\n`);

rec('Startup — cfgEnabled.pdasWrite', { enabled: cfgEnabled.pdasWrite.enabled, disabledReason: cfgEnabled.pdasWrite.disabledReason });
rec('Startup — cfgDisabled.pdasWrite', { enabled: cfgDisabled.pdasWrite.enabled, disabledReason: cfgDisabled.pdasWrite.disabledReason });
rec('Startup — writer login (name only)', { user: writerCreds.user, source: writerCreds.source });
rec('Startup — PDAS counts before any run', await pdasCounts());

const RUN_EVENT_BASELINE = await maxEventId(); // N1's baseline: every nhs_events row created after this belongs to this run.

let __NEW_MATERIAL_ID__ = null;
let __NEW_TUBE_NAME__ = `E2E-TUBE-${RUN_TAG}`;
let __NEW_TUBE_FORM__ = 2;

// ============================================================ R1 — full changeover plan+execute
{
  const req = {
    blend: { name: `E2E-BLEND-${RUN_TAG}` },
    count: { name: `E2E-COUNT-${RUN_TAG}` },
    tubeType: { name: __NEW_TUBE_NAME__, tubeWeightG: 70, tubeForm: __NEW_TUBE_FORM__ },
    material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: `E2E-LOT-${RUN_TAG}`, ppColour: 'E2E' },
    pallet: { packSchemaId: 1, lot: `E2E-LOT-${RUN_TAG}`, sackColour: 'E2E' },
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

  // A1: one product_change row per non-reuse step, in execution order, with
  // the operation/proc-name/outcome the code actually records (createProduct
  // and setProductActive never set proc_name on their recordChange calls —
  // verified against pdasWrite.ts — so 'material'/'retire_material' expect
  // procName: null, not 'CreateMaterial'/'SetMaterialStatusActive').
  const procNameByStep = { blend: 'AddBlend', count: 'AddCount', tube_type: 'AddTubeType', material: null, pallet: 'CreatePallet', retire_material: null, retire_pallet: 'SetPalletStatusActive' };
  const operationByStep = { blend: 'add_blend', count: 'add_count', tube_type: 'add_tube_type', material: 'create', pallet: 'create_pallet', retire_material: 'set_active', retire_pallet: 'set_pallet_active' };
  const nonReuseSteps = plan.steps.filter((s) => s.action !== 'reuse');
  const sortedRows = [...rb.product_change].sort((a, b) => a.change_id - b.change_id);
  nonReuseSteps.forEach((step, i) => {
    A1_ENTRIES.push({
      label: `R1-step-${i}-${step.step}`,
      expected: { operation: operationByStep[step.step], procName: procNameByStep[step.step], outcome: 'ok', pdasErrorCode: null },
      rows: sortedRows[i] ? [sortedRows[i]] : [],
    });
  });
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
    const chRows = await changeRowsSince(c0);
    rec('R2 — product_change rows', chRows);
    // Task P: observedAfter on the RETURNED result must deep-equal `after` —
    // proves the echo-back read succeeded and matched what was requested,
    // not merely that the write was accepted.
    const observedMatches = r.ok === true && JSON.stringify(r.observedAfter) === JSON.stringify(after);
    const ok = r.ok === true && chRows.some((x) => x.outcome === 'ok' && x.operation === 'update_limits') && observedMatches;
    verdict('R2', ok, `ok=${r.ok} observedMatches=${observedMatches}`);
    A1_ENTRIES.push({ label: 'R2', expected: { operation: 'update_limits', procName: null, outcome: 'ok', pdasErrorCode: null }, rows: chRows });
  }
}

// ============================================================ R3 — reactivate the retired material
{
  const c0 = await maxChangeId();
  const r = await writer.setProductActive({ productId: RETIRE_MATERIAL_ID, active: true, reason: 'R3 reactivate retired material local e2e', actor });
  rec('R3 — result', r);
  const chRows = await changeRowsSince(c0);
  rec('R3 — product_change rows', chRows);
  const chk = await pdasRawPool.request().input('id', mssql.Int, RETIRE_MATERIAL_ID).query('SELECT MaterialActive FROM dbo.Materials WHERE MaterialId=@id');
  rec('R3 — read-back MaterialActive', chk.recordset[0]);
  verdict('R3', r.ok === true && chk.recordset[0].MaterialActive === true, `ok=${r.ok} MaterialActive=${chk.recordset[0].MaterialActive}`);
  A1_ENTRIES.push({ label: 'R3', expected: { operation: 'set_active', procName: null, outcome: 'ok', pdasErrorCode: null }, rows: chRows });
}

// ============================================================ R4 — reactivate the retired pallet (Task P)
{
  const c0 = await maxChangeId();
  const r = await writer.setPalletActive({ palletId: RETIRE_PALLET_ID, active: true, reason: 'R4 reactivate retired pallet local e2e', actor });
  rec('R4 — result', r);
  const chRows = await changeRowsSince(c0);
  rec('R4 — product_change rows', chRows);
  const chk = await pdasRawPool.request().input('id', mssql.Int, RETIRE_PALLET_ID).query('SELECT PalletActive FROM dbo.Pallets WHERE PalletId=@id');
  rec('R4 — read-back PalletActive', chk.recordset[0]);
  verdict('R4', r.ok === true && chk.recordset[0].PalletActive === true, `ok=${r.ok} PalletActive=${chk.recordset[0].PalletActive}`);
  A1_ENTRIES.push({ label: 'R4', expected: { operation: 'set_pallet_active', procName: 'SetPalletStatusActive', outcome: 'ok', pdasErrorCode: null }, rows: chRows });
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
  const c0 = await maxChangeId();
  const r = await writer.createProduct({
    blendId: BlendId, countId: CountId, tubeTypeId: TubeTypeId,
    fields: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, desc1: 'F2', desc2: null, active: true },
    bounds: { setpointLoG: 100, setpointHiG: 3000 }, reason: 'F2 direct -7001 case', actor,
  });
  rec('F2 — createProduct direct result', r);
  const chRows = await changeRowsSince(c0);
  rec('F2 — product_change rows', chRows);
  const after = await pdasCounts();
  const mb = countsMap(before).Materials, ma = countsMap(after).Materials;
  rec('F2 — Materials count before/after', { before: mb, after: ma });
  const ok = r.ok === false && r.pdasErrorCode === -7001 && mb.c === ma.c;
  verdict('F2', ok, `ok=${r.ok} code=${r.pdasErrorCode} materialsUnchanged=${mb.c === ma.c}`);
  A1_ENTRIES.push({ label: 'F2', expected: { operation: 'create', procName: null, outcome: 'pdas_error', pdasErrorCode: -7001 }, rows: chRows });
}

// ============================================================ F3a/F3b — addTubeType duplicate & LIKE-collision
{
  const before = await pdasCounts();
  const c0 = await maxChangeId();
  const r = await writer.addTubeType({ tubeType: 'RED', tubeWeightG: 70, tubeForm: 2, reason: 'F3a direct -5001 case', actor });
  rec('F3a — addTubeType direct duplicate ("RED") result', r);
  const chRows = await changeRowsSince(c0);
  rec('F3a — product_change rows', chRows);
  const after = await pdasCounts();
  const mb = countsMap(before).TubeTypes, ma = countsMap(after).TubeTypes;
  const ok1 = r.ok === false && r.pdasErrorCode === -5001 && mb.c === ma.c;
  verdict('F3a', ok1, `ok=${r.ok} code=${r.pdasErrorCode} tubeTypesUnchanged=${mb.c === ma.c}`);
  A1_ENTRIES.push({ label: 'F3a', expected: { operation: 'add_tube_type', procName: 'AddTubeType', outcome: 'pdas_error', pdasErrorCode: -5001 }, rows: chRows });

  const req = {
    blend: { name: `E2E-F3-BLEND-${RUN_TAG}` }, count: { name: `E2E-F3-COUNT-${RUN_TAG}` },
    tubeType: { name: 'R_D', tubeWeightG: 70, tubeForm: 2 },
    material: { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, lot: `E2E-F3-LOT-${RUN_TAG}`, ppColour: null },
    pallet: { packSchemaId: 1, lot: `E2E-F3-LOT-${RUN_TAG}`, sackColour: null },
    retire: { productIds: [], palletIds: [] }, reason: 'F3b LIKE-collision plan check',
  };
  const plan = await planChangeover({ pool: appPool, writer, bounds: { setpointLoG: 100, setpointHiG: 3000 } }, req);
  rec('F3b — plan with tube name "R_D" (LIKE-collides with "RED")', plan);
  const ok2 = plan.blockers.some((b) => /R_D|LIKE|RED/i.test(b));
  verdict('F3b', ok2, `blockers=${JSON.stringify(plan.blockers)}`);
}

// ============================================================ F3c/F3d — addTubeType IMPLAUSIBLE, zero rows changed (Task P)
{
  const before = await pdasCounts();
  const c0 = await maxChangeId();
  const rForm = await writer.addTubeType({ tubeType: `E2E-TUBE-F3C-${RUN_TAG}`, tubeWeightG: 70, tubeForm: 3, reason: 'F3c invalid tube form (3)', actor });
  rec('F3c — addTubeType with tubeForm=3 (invalid) result', rForm);
  const chRowsC = await changeRowsSince(c0);
  const afterC = await pdasCounts();
  const okC = rForm.ok === false && rForm.code === 'IMPLAUSIBLE' && countsEqual(countsMap(before).TubeTypes, countsMap(afterC).TubeTypes);
  verdict('F3c', okC, `ok=${rForm.ok} code=${rForm.code} tubeTypesUnchanged=${countsEqual(countsMap(before).TubeTypes, countsMap(afterC).TubeTypes)}`);
  A1_ENTRIES.push({ label: 'F3c', expected: { operation: 'add_tube_type', procName: 'AddTubeType', outcome: 'implausible', pdasErrorCode: null }, rows: chRowsC });

  const before2 = await pdasCounts();
  const c1 = await maxChangeId();
  const rWeight = await writer.addTubeType({ tubeType: `E2E-TUBE-F3D-${RUN_TAG}`, tubeWeightG: -1, tubeForm: 2, reason: 'F3d invalid tube weight (-1)', actor });
  rec('F3d — addTubeType with tubeWeightG=-1 (invalid) result', rWeight);
  const chRowsD = await changeRowsSince(c1);
  const afterD = await pdasCounts();
  const okD = rWeight.ok === false && rWeight.code === 'IMPLAUSIBLE' && countsEqual(countsMap(before2).TubeTypes, countsMap(afterD).TubeTypes);
  verdict('F3d', okD, `ok=${rWeight.ok} code=${rWeight.code} tubeTypesUnchanged=${countsEqual(countsMap(before2).TubeTypes, countsMap(afterD).TubeTypes)}`);
  A1_ENTRIES.push({ label: 'F3d', expected: { operation: 'add_tube_type', procName: 'AddTubeType', outcome: 'implausible', pdasErrorCode: null }, rows: chRowsD });
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

// ============================================================ F7 — LIVE retire-then-recreate: create, retire, re-create same triple -> -7001, reactivate (Task P)
{
  const blendName = `E2E-F7-BLEND-${RUN_TAG}`, countName = `E2E-F7-COUNT-${RUN_TAG}`, tubeName = `E2E-F7-TUBE-${RUN_TAG}`;
  const bounds = { setpointLoG: 100, setpointHiG: 3000 };

  const c0b = await maxChangeId();
  const b = await writer.addBlend({ blend: blendName, reason: 'F7 setup blend', actor });
  A1_ENTRIES.push({ label: 'F7-addBlend', expected: { operation: 'add_blend', procName: 'AddBlend', outcome: 'ok', pdasErrorCode: null }, rows: await changeRowsSince(c0b) });

  const c0c = await maxChangeId();
  const c = await writer.addCount({ count: countName, reason: 'F7 setup count', actor });
  A1_ENTRIES.push({ label: 'F7-addCount', expected: { operation: 'add_count', procName: 'AddCount', outcome: 'ok', pdasErrorCode: null }, rows: await changeRowsSince(c0c) });

  const c0t = await maxChangeId();
  const t = await writer.addTubeType({ tubeType: tubeName, tubeWeightG: 65, tubeForm: 2, reason: 'F7 setup tube', actor });
  A1_ENTRIES.push({ label: 'F7-addTubeType', expected: { operation: 'add_tube_type', procName: 'AddTubeType', outcome: 'ok', pdasErrorCode: null }, rows: await changeRowsSince(c0t) });

  rec('F7 — setup blend/count/tube', { b, c, t });
  const setupOk = b.ok && c.ok && t.ok;
  if (!setupOk) {
    verdict('F7', false, `setup failed: b.ok=${b.ok} c.ok=${c.ok} t.ok=${t.ok}`);
  } else {
    const fields = { setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, desc1: `E2E-F7-LOT-${RUN_TAG}`, desc2: null, active: true };

    const c0create = await maxChangeId();
    const created = await writer.createProduct({ blendId: b.blendId, countId: c.countId, tubeTypeId: t.tubeTypeId, fields, bounds, reason: 'F7 create material', actor });
    rec('F7 — create material', created);
    A1_ENTRIES.push({ label: 'F7-create', expected: { operation: 'create', procName: null, outcome: 'ok', pdasErrorCode: null }, rows: await changeRowsSince(c0create) });

    if (!created.ok) {
      verdict('F7', false, `create failed: ${JSON.stringify(created)}`);
    } else {
      const materialId = created.productId;

      const c0retire = await maxChangeId();
      const retired = await writer.setProductActive({ productId: materialId, active: false, reason: 'F7 retire', actor });
      rec('F7 — retire', retired);
      A1_ENTRIES.push({ label: 'F7-retire', expected: { operation: 'set_active', procName: null, outcome: 'ok', pdasErrorCode: null }, rows: await changeRowsSince(c0retire) });

      const beforeRecreate = await pdasCounts();
      const c0recreate = await maxChangeId();
      const recreate = await writer.createProduct({ blendId: b.blendId, countId: c.countId, tubeTypeId: t.tubeTypeId, fields, bounds, reason: 'F7 attempt re-create same triple', actor });
      rec('F7 — attempt re-create same triple (expect -7001)', recreate);
      A1_ENTRIES.push({ label: 'F7-recreate-fail', expected: { operation: 'create', procName: null, outcome: 'pdas_error', pdasErrorCode: -7001 }, rows: await changeRowsSince(c0recreate) });
      const afterRecreate = await pdasCounts();
      const noRowInserted = countsMap(beforeRecreate).Materials.c === countsMap(afterRecreate).Materials.c;

      const c0reactivate = await maxChangeId();
      const reactivated = await writer.setProductActive({ productId: materialId, active: true, reason: 'F7 reactivate', actor });
      rec('F7 — reactivate original material', reactivated);
      A1_ENTRIES.push({ label: 'F7-reactivate', expected: { operation: 'set_active', procName: null, outcome: 'ok', pdasErrorCode: null }, rows: await changeRowsSince(c0reactivate) });

      const chk = await pdasRawPool.request().input('id', mssql.Int, materialId).query('SELECT MaterialActive FROM dbo.Materials WHERE MaterialId=@id');
      const ok = retired.ok === true && recreate.ok === false && recreate.pdasErrorCode === -7001 && noRowInserted && reactivated.ok === true && chk.recordset[0]?.MaterialActive === true;
      verdict('F7', ok, `retired.ok=${retired.ok} recreate.ok=${recreate.ok} code=${recreate.pdasErrorCode} noRowInserted=${noRowInserted} reactivated.ok=${reactivated.ok} finalActive=${chk.recordset[0]?.MaterialActive}`);
    }
  }
}

// ============================================================ T1 — resolveTube same-name reuse vs add
{
  const mirrorRow = await appPool.request().input('tubeType', mssql.NVarChar, __NEW_TUBE_NAME__).query('SELECT tube_type_id, tube_type, tube_form FROM sms.tube_type WHERE tube_type = @tubeType');
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

// ============================================================ A1 — exactly one sms.product_change row per operation, with the right shape (Task P)
{
  let allOk = A1_ENTRIES.length > 0;
  const details = [];
  for (const entry of A1_ENTRIES) {
    const rowsHere = entry.rows;
    const exactlyOne = rowsHere.length === 1;
    const row = rowsHere[0];
    const matches = exactlyOne
      && row.operation === entry.expected.operation
      && (row.proc_name ?? null) === (entry.expected.procName ?? null)
      && row.outcome === entry.expected.outcome
      && (row.pdas_error_code ?? null) === (entry.expected.pdasErrorCode ?? null);
    if (!matches) allOk = false;
    details.push({
      label: entry.label,
      exactlyOne,
      rowCount: rowsHere.length,
      expected: entry.expected,
      actual: row ? { operation: row.operation, procName: row.proc_name, outcome: row.outcome, pdasErrorCode: row.pdas_error_code } : null,
      matches,
    });
  }
  rec('A1 — per-operation product_change row check', details);
  verdict('A1', allOk, `entries=${A1_ENTRIES.length} allOk=${allOk}`);
}

// ============================================================ N1 — every new nhs_events row matches the vendor's own shape (Task P)
{
  const vendorSample = sqlcmdJson(`SELECT TOP 200 * FROM ${WRITE_DB}.dbo.nhs_events ORDER BY EventId FOR JSON AUTO`);
  const vendorSeverities = new Set(vendorSample.map((r) => r.Severity).filter((v) => v !== null && v !== undefined));
  const vendorCols = vendorSample.length > 0 ? Object.keys(vendorSample[0]) : [];
  const vendorNonNullCols = vendorCols.filter((col) => vendorSample.every((r) => r[col] !== null && r[col] !== undefined));

  const newRows = sqlcmdJson(`SELECT * FROM ${WRITE_DB}.dbo.nhs_events WHERE EventId > ${RUN_EVENT_BASELINE} ORDER BY EventId FOR JSON AUTO`);
  const coreNonNull = newRows.every((r) => r.Src !== null && r.Src !== undefined && r.Severity !== null && r.Severity !== undefined && r.Logtext !== null && r.Logtext !== undefined);
  const severityKnown = newRows.every((r) => vendorSeverities.has(r.Severity));
  const sameShape = newRows.every((r) => vendorNonNullCols.every((col) => r[col] !== null && r[col] !== undefined));

  rec('N1 — vendor nhs_events shape (from the earliest 200 rows, i.e. vendor-authored)', { vendorSampleSize: vendorSample.length, vendorSeverities: [...vendorSeverities], vendorNonNullCols });
  rec('N1 — new nhs_events rows this run', newRows);
  const ok = newRows.length > 0 && coreNonNull && severityKnown && sameShape;
  verdict('N1', ok, `newRows=${newRows.length} coreNonNull=${coreNonNull} severityKnown=${severityKnown} sameShape=${sameShape}`);
}

// ============================================================ per-right summary table (Task P)
{
  const RIGHTS = [
    { right: 'CreateMaterial', happy: ['R1-execute (material step)', 'F7-create'], failure: ['F2 (-7001 duplicate)', 'F7-recreate-fail (-7001 after retire+recreate)'], keys: ['R1-execute', 'F2', 'F7'] },
    { right: 'SetMaterialStatusActive', happy: ['R1-execute (retire step)', 'R3 (reactivate)', 'F7-retire/F7-reactivate'], failure: [], keys: ['R1-execute', 'R3', 'F7'] },
    { right: 'AddBlend', happy: ['R1-execute (blend step)', 'F7-addBlend'], failure: [], keys: ['R1-execute', 'F7'] },
    { right: 'AddCount', happy: ['R1-execute (count step)', 'F7-addCount'], failure: [], keys: ['R1-execute', 'F7'] },
    { right: 'AddTubeType', happy: ['R1-execute (tube step)', 'F7-addTubeType'], failure: ['F3a (-5001 duplicate)', 'F3c (IMPLAUSIBLE form)', 'F3d (IMPLAUSIBLE weight)'], keys: ['R1-execute', 'F3a', 'F3c', 'F3d', 'F7'] },
    { right: 'CreatePallet', happy: ['R1-execute (pallet step)'], failure: [], keys: ['R1-execute'] },
    { right: 'SetPalletStatusActive', happy: ['R1-execute (retire pallet step)', 'R4 (reactivate)'], failure: [], keys: ['R1-execute', 'R4'] },
    { right: 'UPDATE dbo.Materials (limits)', happy: ['R2'], failure: ['F4 (CONFLICT, second call)'], keys: ['R2', 'F4'] },
    { right: 'INSERT dbo.nhs_events', happy: ['N1'], failure: [], keys: ['N1'] },
  ];
  const tableRows = RIGHTS.map((r) => {
    const status = r.keys.every((k) => verdicts[k] === true) ? 'PASS' : 'FAIL';
    return { right: r.right, happy: r.happy.join('; '), failure: r.failure.length ? r.failure.join('; ') : '(none exercised)', status };
  });
  const header = `| right | happy case | failure cases | pass/fail |\n|---|---|---|---|`;
  const md = [header, ...tableRows.map((r) => `| ${r.right} | ${r.happy} | ${r.failure} | ${r.status} |`)].join('\n');
  log.push(`\n## Per-right summary\n\n${md}\n`);
  console.log('\n--- Per-right summary ---');
  console.log(`${'right'.padEnd(32)}${'happy'.padEnd(45)}${'failure'.padEnd(45)}status`);
  for (const r of tableRows) {
    console.log(`${r.right.padEnd(32)}${r.happy.slice(0, 43).padEnd(45)}${r.failure.slice(0, 43).padEnd(45)}${r.status}`);
  }
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
