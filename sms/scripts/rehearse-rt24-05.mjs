/**
 * RT24-05 rehearsal script — one `updateProductLimits` call through the REAL
 * `PdasWriter`, under an EXECUTE-only ("ibrahim"-shaped) PDAS login, against
 * the LOCAL `PDAS_TP1U2_SEP07` (or `_E2E`) copy only.
 *
 * Modelled on `scripts/pdas-e2e-local.mjs` — same local-only guard in spirit
 * (localhost + `_SEP07`/`_E2E` database name, no override flag), same way of
 * loading `api/dist`/`sync-worker/dist` by file URL relative to `cwd()`, same
 * refusal to touch `.env`. It is a single-write rehearsal, not the 13-case
 * harness that script is.
 *
 * WHAT IT DOES.
 *   1. Reads the CURRENT six operator-visible fields of one Materials row
 *      (`--material <id>`, default 1024 — a REAL row on the LOCAL COPY,
 *      restored afterwards by the backup/restore steps in
 *      `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md`; never touches the
 *      plant) through the SAME login `q.mjs` uses for read-only queries
 *      against PDAS — `.env`'s `IFL_DB_*`, which is provisioned with SELECT
 *      and nothing else, exactly the read path this project already trusts
 *      for read-only PDAS access.
 *   2. Builds `after` as the identical six fields with `setpointG` + 1 —
 *      the smallest change that is still a genuine, checkable write.
 *   3. Resolves `bounds` the way the app does: `getPlausibilityRule(pool,
 *      lineId)` against the local `sms` app database (`api/src/routes/
 *      changeover.ts`'s own `setpointBounds()` helper, reproduced here
 *      rather than imported because it is a route-local closure, not an
 *      exported function).
 *   4. Opens a `PdasWriter` whose PDAS connection uses the OWNER'S
 *      EXECUTE-only rehearsal login, taken from four process env vars named
 *      below — never `.env`'s own `PDAS_WRITE_*` (which stays `false`/unset
 *      for the real app) and never `.env.e2e-writer` (that file is
 *      `pdas-e2e-local.mjs`'s own, for `sms_pdas_writer`, which DOES have
 *      SELECT — using it here would defeat the entire rehearsal).
 *   5. Calls `writer.updateProductLimits(...)`, then prints: the call's own
 *      result, the newest `sms.product_change` row, every
 *      `pdas_write_unverified` row in `sms.dq_finding`, and
 *      `writer.probePermissions()`'s own verdict (`pdasPermissions.ts`).
 *
 * ENV VARS THIS SCRIPT READS (exact names — distinct from `.env`'s own
 * `PDAS_WRITE_*`, on purpose, so a copy-paste mistake can never make this
 * rehearsal script accidentally pick up the real app's disabled writer
 * config, or vice versa):
 *   RT2405_WRITE_SERVER    default 'localhost'
 *   RT2405_WRITE_PORT      default '1433'
 *   RT2405_WRITE_DATABASE  default '.env's IFL_DB_NAME_PDAS, else PDAS_TP1U2_SEP07'
 *   RT2405_WRITE_USER      REQUIRED, no default — the EXECUTE-only login's name
 *   RT2405_WRITE_PASSWORD  REQUIRED, no default — never printed, never logged
 *
 * GUARD, VERBATIM IN SPIRIT FROM pdas-e2e-local.mjs. Refuses to run unless
 * the resolved server is localhost/127.0.0.1/::1 AND the resolved database
 * name ends in `_SEP07` or `_E2E`. No override flag, checked BEFORE the
 * missing-credentials check and before opening any connection at all —
 * running this against the wrong target is refused even with no
 * credentials set.
 *
 * WHAT IT NEVER DOES. Never edits `.env`. Never creates a login (the
 * EXECUTE-only login must already exist — see
 * `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md` §3 for the SQL that creates
 * it). Never runs BACKUP/RESTORE itself (do those by hand first — same file,
 * §§2 and 7). Never prints `RT2405_WRITE_PASSWORD` or any other secret.
 *
 * HOW TO RUN (cwd must be `sms/`; `api/dist` and `sync-worker/dist` must be
 * built — `npm run build --workspace @sms/api` from `sms/`):
 *   node scripts/rehearse-rt24-05.mjs [--material <id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fileUrl(p) {
  return pathToFileURL(path.resolve(p)).href;
}

function parseEnvFile(p) {
  const text = fs.readFileSync(p, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function parseArgs(argv) {
  const out = { material: 1024 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--material') out.material = Number(argv[++i]);
  }
  return out;
}

const REPO = process.cwd(); // must be run with cwd() === sms/
const baseEnv = parseEnvFile(path.join(REPO, '.env'));
const args = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// GUARD — resolved and checked BEFORE anything else, including the
// missing-credentials check below. No environment variable overrides this;
// there is no override flag, matching pdas-e2e-local.mjs's own guard.
// ---------------------------------------------------------------------------
const WRITE_SERVER = process.env.RT2405_WRITE_SERVER ?? 'localhost';
const WRITE_PORT = process.env.RT2405_WRITE_PORT ?? '1433';
const WRITE_DB = process.env.RT2405_WRITE_DATABASE ?? baseEnv.IFL_DB_NAME_PDAS ?? 'PDAS_TP1U2_SEP07';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const hostOnly = String(WRITE_SERVER).split('\\')[0].split(',')[0].trim().toLowerCase();

function refuse(reason) {
  console.error(`REFUSING TO RUN: ${reason}`);
  console.error(`  RT2405 server resolved to: "${WRITE_SERVER}" (host: "${hostOnly}")`);
  console.error(`  RT2405 database resolved to: "${WRITE_DB}"`);
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
// Credentials check — SECOND, after the guard, and BEFORE any connection is
// opened. This is deliberately the last thing checked without touching the
// network, so "wrong target" and "missing credentials" are always reported
// separately and neither hides the other.
// ---------------------------------------------------------------------------
const WRITE_USER = process.env.RT2405_WRITE_USER;
const WRITE_PASSWORD = process.env.RT2405_WRITE_PASSWORD;
if (!WRITE_USER || !WRITE_PASSWORD) {
  console.error('REFUSING TO RUN: RT2405_WRITE_USER and/or RT2405_WRITE_PASSWORD is not set.');
  console.error("  This script needs the EXECUTE-only rehearsal login's own credentials —");
  console.error('  never sms_pdas_writer, never any value from .env or .env.e2e-writer.');
  console.error('  Set both (see handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md §4) and re-run.');
  process.exit(1);
}

console.log(`Target: ${hostOnly}:${WRITE_PORT} / ${WRITE_DB} (guard passed)`);
console.log(`Material to change: ${args.material}`);

// ---------------------------------------------------------------------------
// From here on, real connections are opened. Nothing above this line ever
// touches the network.
// ---------------------------------------------------------------------------
const mssql = (await import(fileUrl(path.join(REPO, 'node_modules/mssql/index.js')))).default;
const { loadApiConfig } = await import(fileUrl(path.join(REPO, 'api/dist/config.js')));
const { createPool } = await import(fileUrl(path.join(REPO, 'node_modules/@sms/sync-worker/dist/db.js')));
const { PdasWriter } = await import(fileUrl(path.join(REPO, 'api/dist/services/pdasWrite.js')));
const { getPlausibilityRule } = await import(fileUrl(path.join(REPO, 'api/dist/services/admin.js')));

// The app DB config comes from the real .env (read-only queries + the one
// guarded write this rehearsal performs, both to the LOCAL sms database
// baseEnv.APP_DB_* already points at — never edited by this script).
const cfgApp = loadApiConfig(baseEnv);
const appPool = await createPool(cfgApp.appDb, {});
console.log('appPool connected:', appPool.connected);

// The READ of the current Materials row uses .env's IFL_DB_* login — the
// same read-only credential q.mjs uses for PDAS reads, provisioned with
// SELECT and nothing else. This is intentionally NOT the EXECUTE-only
// rehearsal login: `before` must be read reliably regardless of whether the
// write login can read anything at all (the whole point of this rehearsal
// is that it cannot).
const readPool = await new mssql.ConnectionPool({
  server: hostOnly,
  port: Number(WRITE_PORT),
  database: WRITE_DB,
  user: baseEnv.IFL_DB_USER,
  password: baseEnv.IFL_DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true },
}).connect();
console.log('readPool (IFL_DB_* login) connected:', readPool.connected);

const row = await readPool
  .request()
  .input('id', mssql.Int, args.material)
  .query(
    `SELECT MaterialSetpointWeight sp, MaterialWeightOffsetMinus om, MaterialWeightOffsetPlus op,
            MaterialDesc1 d1, MaterialDesc2 d2, MaterialActive a
       FROM dbo.Materials WHERE MaterialId = @id`,
  );
const x = row.recordset[0];
if (!x) {
  console.error(`No Materials row with MaterialId = ${args.material} on ${WRITE_DB}. Pick a real id (--material <id>) and re-run.`);
  process.exit(1);
}
const before = {
  setpointG: Number(x.sp),
  offsetMinusG: Number(x.om),
  offsetPlusG: Number(x.op),
  desc1: x.d1 ?? null,
  desc2: x.d2 ?? null,
  active: Boolean(x.a),
};
const after = { ...before, setpointG: before.setpointG + 1 };
console.log('before:', JSON.stringify(before));
console.log('after: ', JSON.stringify(after));
await readPool.close();

// Bounds, the way the app does it (routes/changeover.ts's own setpointBounds()).
const rule = await getPlausibilityRule(appPool, cfgApp.lineId);
const bounds = { setpointLoG: rule.coneLoG, setpointHiG: rule.coneHiG };
console.log('bounds:', JSON.stringify(bounds));

// The writer itself — PDAS connection uses the EXECUTE-only rehearsal login.
const pdasWriteCfg = {
  enabled: true,
  disabledReason: null,
  db: {
    server: hostOnly,
    port: Number(WRITE_PORT),
    database: WRITE_DB,
    user: WRITE_USER,
    password: WRITE_PASSWORD,
    encrypt: true,
    trustServerCertificate: true,
  },
};
const writer = new PdasWriter(appPool, pdasWriteCfg, cfgApp.lineId);

// sms.app_user id=2, role_id=2 (engineer, rank>=2) — same fixture actor
// pdas-e2e-local.mjs uses, read-verified this pass via `node q.mjs sms
// "SELECT user_id, username, role_id FROM sms.app_user WHERE user_id=2"`.
const actor = { userId: 2, username: 'super' };

const result = await writer.updateProductLimits({
  productId: args.material,
  before,
  after,
  bounds,
  reason: 'RT24-05 rehearsal — EXECUTE-only readback-failure proof, reverted by restore',
  actor,
});
console.log('\n--- updateProductLimits result ---');
console.log(JSON.stringify(result, null, 2));

const change = await appPool.request().query(
  `SELECT TOP 3 change_id, product_id, operation, outcome, message, before_json, after_json, observed_after_json, changed_at
     FROM sms.product_change ORDER BY changed_at DESC`,
);
console.log('\n--- newest sms.product_change rows ---');
console.log(JSON.stringify(change.recordset, null, 2));

const findings = await appPool.request().query(
  `SELECT TOP 5 run_id, check_name, severity, subject_table, detail, detected_at_utc
     FROM sms.dq_finding WHERE check_name = 'pdas_write_unverified' ORDER BY detected_at_utc DESC`,
);
console.log('\n--- sms.dq_finding: pdas_write_unverified ---');
console.log(JSON.stringify(findings.recordset, null, 2));

const perms = await writer.probePermissions();
console.log('\n--- pdasPermissions probe ---');
console.log(JSON.stringify(perms, null, 2));

await appPool.close();
console.log('\nDone. Now restore PDAS_TP1U2_SEP07 and sms from the pre-run backups (see REHEARSAL-RT24-05-EXECUTE-ONLY.md §7).');
