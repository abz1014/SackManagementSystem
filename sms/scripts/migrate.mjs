// migrate.mjs — apply db/migrations/*.sql to the APP database (ours), in order.
// Reads connection config from .env. Splits on GO batches. Idempotent SQL.
// Never touches IFL's database.
//
// Usage:
//   node scripts/migrate.mjs                            apply every unapplied file, in order
//   node scripts/migrate.mjs --mark-applied-through=022 record files 001..022 as applied WITHOUT
//                                                       running them, then apply the rest normally
//
// WHICH LOGIN THIS CONNECTS AS (fixes defect R-13, HIGH, 22 Sep 2026):
// this file, and only this file among the app's runtime code, needs a login
// with db_ddladmin — every migration is schema DDL. Every OTHER caller
// (the API, the sync worker, the CLI's other commands) connects as sms_app,
// which since db/bootstrap/00_create_app_database.sql's R-13 fix no longer
// holds db_ddladmin — see that file's header for why an unattended runtime
// login must not be able to alter or drop the append-only trigger migration
// 030 puts on sms.audit_log. So this runner prefers MIGRATE_DB_USER /
// MIGRATE_DB_PASSWORD (the sms_migrate login, db_ddladmin, used only for
// this one command, run by hand at install/upgrade time) and falls back to
// APP_DB_USER / APP_DB_PASSWORD only when those are unset — which keeps a
// dev machine or CI box that has not yet provisioned sms_migrate working
// exactly as before, and is why this fallback is not itself the fix: it is
// the operator's job to actually SET MIGRATE_DB_USER/PASSWORD on a real
// install so the fallback is never what actually runs there. The server,
// port, database and TLS options are still shared with APP_DB_* — sms_app
// and sms_migrate are two logins on the same [sms] database, not two
// different databases.
//
// --mark-applied-through exists for ONE situation: a database that was migrated by
// the pre-Sep-2026 runner, which kept no history table. On such a database this
// runner's first run would see an empty sms.schema_migration and re-apply every
// file from 001 — and NOT every file is a no-op on re-run: 016 is a bare DELETE and
// 026 has seven unguarded ALTER COLUMN ... NOT NULL statements plus a THROW guard, so
// the re-run fails inside 026 and rolls that file back. Marking the already-applied
// range first avoids that. Never use it on a database whose real state you do not
// know; it asserts, it does not verify.
//
// Fixes finding M2 (Sep 2026 audit): each file used to run as a series of
// separate auto-commit batches with no history table — if a later batch in a
// file failed (e.g. an index statement after its table's CREATE succeeded),
// the table was left permanently missing that index, and because every
// object is guarded by its own `IF OBJECT_ID(...) IS NULL`, the NEXT run saw
// the table already existed and skipped the whole file forever, with no
// error and no record that anything was ever wrong. Each file's batches now
// run inside one explicit transaction — a failure partway through rolls back
// the whole file, so a retry starts clean rather than from a stranded half
// state — and sms.schema_migration records which files have actually
// completed, independent of what objects happen to exist.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sql from 'mssql';
import { applyFile, ensureHistoryTable, alreadyApplied } from './migrate-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

// minimal .env loader (no dependency) --------------------------------------
function loadEnv() {
  try {
    const text = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    console.warn('No .env found — relying on process environment.');
  }
}

function parseArgs(argv) {
  const out = { markThrough: null };
  for (const a of argv) {
    const m = a.match(/^--mark-applied-through=(\d{3})$/);
    if (m) out.markThrough = m[1];
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
  }
  return out;
}

async function markApplied(pool, filename) {
  await pool
    .request()
    .input('f', sql.VarChar(255), filename)
    .query('INSERT INTO sms.schema_migration (filename) VALUES (@f)');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  const config = {
    server: process.env.APP_DB_SERVER ?? '.\\SQLEXPRESS',
    port: process.env.APP_DB_PORT ? Number(process.env.APP_DB_PORT) : undefined,
    database: process.env.APP_DB_NAME ?? 'sms',
    // See the file header: prefer the migration-only login (db_ddladmin),
    // fall back to the runtime login only when the former is not set.
    user: process.env.MIGRATE_DB_USER ?? process.env.APP_DB_USER,
    password: process.env.MIGRATE_DB_PASSWORD ?? process.env.APP_DB_PASSWORD,
    options: {
      encrypt: (process.env.APP_DB_ENCRYPT ?? 'true') === 'true',
      trustServerCertificate:
        (process.env.APP_DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true',
    },
    // node-mssql defaults this to 15 seconds, and every migration FILE runs
    // inside ONE explicit transaction here. A migration that touches real data
    // — an ALTER that rewrites rows, a CREATE INDEX over 204,076 of them, a
    // backfill — takes longer than that on a plant PC, and the timeout rolls
    // the whole file back. The failure looks like a broken migration rather
    // than a too-short clock, which is the worst way to spend an evening.
    // Ten minutes is a maintenance-path ceiling, not a per-statement target.
    requestTimeout: 10 * 60_000,
  };

  if (!process.env.MIGRATE_DB_USER) {
    console.warn(
      `MIGRATE_DB_USER not set — connecting as ${config.user ?? '(no user configured)'} (APP_DB_USER fallback). ` +
        'If that login no longer holds db_ddladmin (defect R-13 fix), this will fail on any file with DDL. ' +
        'Set MIGRATE_DB_USER/MIGRATE_DB_PASSWORD to the sms_migrate login for this run.',
    );
  }
  console.log(`Connecting to ${config.server}/${config.database} as ${config.user ?? '(no user configured)'}`);

  const pool = await sql.connect(config);
  await ensureHistoryTable(pool);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (await alreadyApplied(pool, file)) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }
    if (args.markThrough !== null && file.slice(0, 3) <= args.markThrough) {
      await markApplied(pool, file);
      console.log(`Marked ${file} as applied (NOT executed; --mark-applied-through=${args.markThrough})`);
      continue;
    }
    const raw = readFileSync(join(migrationsDir, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    await applyFile(pool, file, raw);
    console.log('ok');
  }

  await pool.close();
  console.log('All migrations applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
