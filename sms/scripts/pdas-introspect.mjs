// pdas-introspect.mjs — READ-ONLY introspection of the vendor's PDAS stored
// procedures and views, run against a LOCAL copy of PDAS only.
//
// WHY. sms/api/src/services/pdasWrite.ts binds parameters to seven vendor
// procs by NAME (mssql binds by name, not position). Two of those bindings
// were never verified against a real server: CreateMaterial's five
// @materialDesc1..5 parameters (the code bound only two) and AddTubeType's
// OUTPUT parameter, whose name was a guess from a comment ("// sic — the
// vendor's parameter name"). This script settles both by reading the
// procedure's own catalogue entry — sys.parameters — rather than trusting the
// code or a screenshot.
//
// SAFETY RAIL (non-negotiable, enforced below, not just documented):
//   1. The script issues nothing but SELECT. No EXEC of any vendor proc, no
//      INSERT/UPDATE/DELETE, ever, anywhere in this file.
//   2. It refuses to run unless the target database name matches
//      /_SEP\d+$|_SIM$/ — i.e. a local, disposable copy such as
//      PDAS_TP1U2_SEP07 or a *_SIM database. It is impossible to point this
//      at a plant server (which would be named plain PDAS_TP1U2 or similar,
//      with no _SEPnn / _SIM suffix) without the guard refusing first.
//   3. It connects with the existing read-only IFL_DB_* login from .env —
//      never a writer login, and PDAS_WRITE_ENABLED is never read or set here.
//
// Usage:  node scripts/pdas-introspect.mjs   (from sms/, or anywhere — path is __dirname-relative)
//
// Prints, for each of the seven write procedures, the five GetAll* procedures
// and the three views, a parameter/column table (name, type, max_length,
// precision, scale, is_output, has_default_value) and — for the procedures —
// OBJECT_DEFINITION(OBJECT_ID(...)).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mssql from 'mssql';

const here = dirname(fileURLToPath(import.meta.url));
const smsRoot = join(here, '..');

// ---- minimal .env loader (no dependency), identical in spirit to the other
// scripts/*.mjs loaders (data-dictionary.mjs, backfill-source-epoch.mjs). ----
function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(smsRoot, '.env'), 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    console.warn('No .env found — relying on process environment.');
  }
  return { ...out, ...process.env };
}

/** The seven vendor write procedures pdasWrite.ts calls. */
const WRITE_PROCS = [
  'CreateMaterial',
  'SetMaterialStatusActive',
  'AddBlend',
  'AddCount',
  'AddTubeType',
  'CreatePallet',
  'SetPalletStatusActive',
];

/** Read-side procs the app also depends on (not written to, listed for completeness). */
const GETALL_PROCS = ['GetAllMaterials', 'GetAllBlends', 'GetAllCounts', 'GetAllTubeTypes', 'GetAllPallets'];

const VIEWS = ['dbo.ActiveMaterials', 'dbo.GetMaterialsData', 'dbo.Events'];

const SAFE_DB_PATTERN = /_SEP\d+$|_SIM$/;

function assertSafeDatabase(name) {
  if (typeof name !== 'string' || !SAFE_DB_PATTERN.test(name)) {
    throw new Error(
      `Refusing to introspect database ${JSON.stringify(name)} — it does not match ` +
        `${SAFE_DB_PATTERN} (a local, disposable "_SEPnn" or "_SIM" copy). This script must never run ` +
        `against a plant server. Point IFL_DB_NAME_PDAS at a local copy such as PDAS_TP1U2_SEP07 and retry.`,
    );
  }
}

/** True read-only guard: reject anything that is not a SELECT statement, belt-and-braces beside the code review above. */
function assertSelectOnly(sql) {
  const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^select\b/i.test(stripped)) {
    throw new Error(`Refusing to run a non-SELECT statement: ${sql.slice(0, 80)}...`);
  }
}

async function select(pool, sql) {
  assertSelectOnly(sql);
  const r = await pool.request().query(sql);
  return r.recordset;
}

function printTable(rows, cols) {
  if (rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
  console.log('  ' + line(cols));
  console.log('  ' + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log('  ' + line(cols.map((c) => r[c] ?? '')));
}

async function paramsOf(pool, procName) {
  const rows = await select(
    pool,
    `SELECT p.name AS param_name, TYPE_NAME(p.user_type_id) AS data_type, p.max_length, p.precision, p.scale,
            p.is_output, p.has_default_value, p.default_value
       FROM sys.parameters p
       JOIN sys.objects o ON o.object_id = p.object_id
      WHERE o.name = '${procName.replace(/'/g, "''")}' AND SCHEMA_NAME(o.schema_id) = 'dbo'
      ORDER BY p.parameter_id`,
  );
  return rows;
}

async function columnsOf(pool, viewName) {
  const [schema, name] = viewName.includes('.') ? viewName.split('.') : ['dbo', viewName];
  const rows = await select(
    pool,
    `SELECT c.name AS column_name, TYPE_NAME(c.user_type_id) AS data_type, c.max_length, c.precision, c.scale,
            c.is_nullable
       FROM sys.columns c
       JOIN sys.objects o ON o.object_id = c.object_id
      WHERE o.name = '${name.replace(/'/g, "''")}' AND SCHEMA_NAME(o.schema_id) = '${schema.replace(/'/g, "''")}'
      ORDER BY c.column_id`,
  );
  return rows;
}

async function definitionOf(pool, objectName) {
  const rows = await select(
    pool,
    `SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.${objectName.replace(/[^A-Za-z0-9_]/g, '')}')) AS def`,
  );
  return rows[0]?.def ?? null;
}

async function main() {
  const env = loadEnv();
  const database = env.IFL_DB_NAME_PDAS;
  assertSafeDatabase(database);

  const config = {
    server: env.IFL_DB_SERVER ?? 'localhost',
    port: env.IFL_DB_PORT ? Number(env.IFL_DB_PORT) : undefined,
    database,
    user: env.IFL_DB_USER,
    password: env.IFL_DB_PASSWORD,
    options: {
      encrypt: (env.IFL_DB_ENCRYPT ?? 'true') === 'true',
      trustServerCertificate: (env.IFL_DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true',
    },
  };

  console.log(`PDAS introspection — READ-ONLY (SELECT / sys.* / OBJECT_DEFINITION only)`);
  console.log(`Target: ${config.server}${config.port ? ',' + config.port : ''} / ${config.database}`);
  console.log(`Login:  ${config.user} (the sync worker's existing read-only IFL_DB_* login)`);
  console.log('');

  const pool = await new mssql.ConnectionPool(config).connect();
  try {
    // Sanity: also assert against the server's own reported database name, in
    // case IFL_DB_NAME_PDAS and the actual connection ever disagree.
    const [{ actual }] = await select(pool, 'SELECT DB_NAME() AS actual');
    assertSafeDatabase(actual);
    if (actual !== database) {
      console.warn(`NOTE: connected database (${actual}) differs from IFL_DB_NAME_PDAS (${database}); using ${actual}.`);
    }

    console.log('='.repeat(100));
    console.log('SEVEN WRITE PROCEDURES — parameters, from sys.parameters');
    console.log('='.repeat(100));
    let totalParamRows = 0;
    for (const proc of WRITE_PROCS) {
      console.log(`\n--- dbo.${proc} ---`);
      const params = await paramsOf(pool, proc);
      totalParamRows += params.length;
      printTable(params, ['param_name', 'data_type', 'max_length', 'precision', 'scale', 'is_output', 'has_default_value', 'default_value']);
      const def = await definitionOf(pool, proc);
      console.log(`\n  OBJECT_DEFINITION(dbo.${proc}):`);
      if (def == null) {
        console.log('  (NULL — object not found, or definition not visible to this login)');
      } else {
        for (const line of def.split(/\r?\n/)) console.log('  | ' + line);
      }
    }

    // DIAGNOSTIC, not a workaround: sys.parameters and OBJECT_DEFINITION are
    // both governed by SQL Server's metadata visibility rules — a login sees a
    // procedure's parameters/body only if it holds VIEW DEFINITION, EXECUTE,
    // ALTER or CONTROL on that specific object (or owns it). db_datareader
    // (what db/bootstrap/10_ifl_readonly_login.template.sql grants IFL_DB_USER,
    // by design: "Nothing here grants any write, any EXECUTE, or any right on
    // any other database") gives none of those. So an all-zero result below
    // does NOT mean the procedures are absent — it means this login cannot see
    // procedure metadata at all, which this block checks and reports plainly
    // rather than leaving the reader to guess.
    if (totalParamRows === 0) {
      const roles = await select(
        pool,
        `SELECT dp.name AS role_name
           FROM sys.database_role_members rm
           JOIN sys.database_principals dp ON dp.principal_id = rm.role_principal_id
           JOIN sys.database_principals mp ON mp.principal_id = rm.member_principal_id
          WHERE mp.name = '${String(config.user).replace(/'/g, "''")}'`,
      );
      console.log('\n' + '-'.repeat(100));
      console.log(`DIAGNOSTIC: every write procedure above returned 0 parameter rows and a NULL definition.`);
      console.log(`Login ${config.user}'s database roles: ${roles.map((r) => r.role_name).join(', ') || '(none)'}`);
      console.log(
        'This matches SQL Server metadata-visibility rules, not proof the procedures are missing: a login with\n' +
          'only db_datareader (SELECT on tables/views) has no EXECUTE / VIEW DEFINITION / ALTER / CONTROL on any\n' +
          'procedure, so sys.parameters and OBJECT_DEFINITION show nothing for ANY procedure name, real or not,\n' +
          'to this login — the three views above worked because db_datareader DOES cover them.\n' +
          'To unblock scripted introspection, grant VIEW DEFINITION ONLY (never EXECUTE) on the twelve procedures\n' +
          `to ${config.user} — see db/bootstrap/11_pdas_procedure_metadata.template.sql. That grant is metadata-only:\n` +
          'it lets this login read a procedure\'s definition and parameter list; it does not let it call the procedure.',
      );
      console.log('-'.repeat(100));
    }

    console.log('\n' + '='.repeat(100));
    console.log('FIVE GetAll* PROCEDURES — parameters, from sys.parameters');
    console.log('='.repeat(100));
    for (const proc of GETALL_PROCS) {
      console.log(`\n--- dbo.${proc} ---`);
      const params = await paramsOf(pool, proc);
      printTable(params, ['param_name', 'data_type', 'max_length', 'precision', 'scale', 'is_output', 'has_default_value', 'default_value']);
    }

    console.log('\n' + '='.repeat(100));
    console.log('THREE VIEWS — columns, from sys.columns');
    console.log('='.repeat(100));
    for (const view of VIEWS) {
      console.log(`\n--- ${view} ---`);
      const cols = await columnsOf(pool, view);
      printTable(cols, ['column_name', 'data_type', 'max_length', 'precision', 'scale', 'is_nullable']);
    }

    console.log('\nDone. Nothing was written; no EXEC of any vendor procedure occurred.');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
