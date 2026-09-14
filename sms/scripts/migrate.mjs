// migrate.mjs — apply db/migrations/*.sql to the APP database (ours), in order.
// Reads connection config from .env. Splits on GO batches. Idempotent SQL.
// Never touches IFL's database.
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

async function ensureHistoryTable(pool) {
  await pool.request().batch(`
    IF OBJECT_ID('sms.schema_migration', 'U') IS NULL
    BEGIN
        IF SCHEMA_ID('sms') IS NULL EXEC('CREATE SCHEMA sms');
        CREATE TABLE sms.schema_migration (
            filename       VARCHAR(255) NOT NULL CONSTRAINT PK_schema_migration PRIMARY KEY,
            applied_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_schema_migration_applied DEFAULT SYSUTCDATETIME()
        );
    END
  `);
}

async function alreadyApplied(pool, filename) {
  const r = await pool
    .request()
    .input('f', sql.VarChar(255), filename)
    .query('SELECT 1 AS x FROM sms.schema_migration WHERE filename = @f');
  return r.recordset.length > 0;
}

async function applyFile(pool, filename, raw) {
  const batches = raw.split(/^\s*GO\s*$/im).filter((b) => b.trim());
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const batch of batches) await new sql.Request(tx).batch(batch);
    await new sql.Request(tx)
      .input('f', sql.VarChar(255), filename)
      .query('INSERT INTO sms.schema_migration (filename) VALUES (@f)');
    await tx.commit();
  } catch (err) {
    // The rollback gets its own try/catch, and it must never replace `err`.
    // A batch-aborting DDL error makes SQL Server roll the transaction back
    // itself, and node-mssql then rejects rollback() with
    // TransactionError('Transaction has been aborted.', 'EABORT'). Letting
    // that escape would hide the actual SQL error naming the broken
    // migration behind a generic abort message.
    try {
      await tx.rollback();
    } catch (rollbackErr) {
      const code = rollbackErr?.code;
      if (code !== 'EABORT') {
        console.error(`  (rollback also failed: ${rollbackErr?.message ?? rollbackErr})`);
      }
    }
    throw err;
  }
}

async function main() {
  loadEnv();
  const config = {
    server: process.env.APP_DB_SERVER ?? '.\\SQLEXPRESS',
    port: process.env.APP_DB_PORT ? Number(process.env.APP_DB_PORT) : undefined,
    database: process.env.APP_DB_NAME ?? 'sms',
    user: process.env.APP_DB_USER,
    password: process.env.APP_DB_PASSWORD,
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
