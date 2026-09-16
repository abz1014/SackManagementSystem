// test/migrations.integration.test.ts — proves the REAL migration runner
// (scripts/migrate-core.mjs, imported here unmodified — not a copy of it)
// builds the full 001..036 schema from zero against a real SQL Server, and
// that a handful of objects the query surface actually depends on come out
// the other end. Every other test in this repo runs against hand-written
// fake pools; a mismatch between a query string and the schema the
// migrations build cannot fail any of them. This is the one test that runs
// the migrations for real.
//
// OPT-IN ONLY (`describe.skipIf(!process.env.SMS_TEST_DB_SERVER)`). With
// SMS_TEST_DB_SERVER unset, this file collects but nothing inside it runs —
// the suite behaves exactly as it did before this file existed, so CI
// (which has no SQL Server) stays green.
//
// ENV KEYS THIS FILE READS, AND ONLY THESE:
//   SMS_TEST_DB_SERVER, SMS_TEST_DB_PORT, SMS_TEST_DB_NAME,
//   SMS_TEST_DB_USER, SMS_TEST_DB_PASSWORD, SMS_TEST_DB_ENCRYPT,
//   SMS_TEST_DB_TRUST_SERVER_CERTIFICATE.
// It never reads IFL_DB_* (the plant source) or APP_DB_* (the dev sidecar) —
// grep this file for either prefix and you will find nothing. That is the
// enforcement mechanism: this file simply never names those keys, so there
// is no code path by which it could open one of those connections.
//
// THIS SUITE NEVER CONNECTS TO DATA_TP1U2, PDAS_TP1U2, OR ANY *_TP1U2
// DATABASE. It connects to `master` only to CREATE/DROP its own scratch
// database, and to that scratch database to run migrations against. The
// scratch database's name MUST start with `sms_test_` — the same guard
// shape scripts/simulate-plant.mjs uses for its `_SIM` suffix rule — and
// testDbName() throws, before any connection is opened, if it does not.
// That guard is what makes it safe for this database to be dropped in
// afterAll: nothing bearing that prefix is ever real data.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sql from 'mssql';
import { alreadyApplied, applyFile, ensureHistoryTable } from '../scripts/migrate-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

const RUN = Boolean(process.env.SMS_TEST_DB_SERVER);

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

// Same guard shape as scripts/simulate-plant.mjs's `_SIM` rule: refuse,
// loudly, before connecting to anything, rather than trust the caller.
function testDbName() {
  const name =
    process.env.SMS_TEST_DB_NAME ??
    `sms_test_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  if (!/^sms_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `refusing to use database "${name}": this suite only ever creates and drops a database whose ` +
        `name starts with "sms_test_" and is otherwise plain alphanumerics/underscores. IFL's databases ` +
        `and the app's own sidecar are never touched by this suite.`,
    );
  }
  return name;
}

function poolConfig(database) {
  return {
    server: process.env.SMS_TEST_DB_SERVER,
    port: process.env.SMS_TEST_DB_PORT ? Number(process.env.SMS_TEST_DB_PORT) : undefined,
    database,
    user: process.env.SMS_TEST_DB_USER,
    password: process.env.SMS_TEST_DB_PASSWORD,
    options: {
      encrypt: (process.env.SMS_TEST_DB_ENCRYPT ?? 'true') === 'true',
      trustServerCertificate: (process.env.SMS_TEST_DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true',
    },
    // Mirrors migrate.mjs's own ten-minute ceiling — some of these files run
    // a size-of-data rewrite or an index build, not just metadata DDL.
    requestTimeout: 10 * 60_000,
  };
}

/** Runs the real per-file loop once; returns how many files it actually applied (vs. skipped). */
async function applyAll(pool) {
  await ensureHistoryTable(pool);
  let applied = 0;
  for (const file of migrationFiles()) {
    if (await alreadyApplied(pool, file)) continue;
    const raw = readFileSync(join(migrationsDir, file), 'utf8');
    await applyFile(pool, file, raw);
    applied++;
  }
  return applied;
}

describe.skipIf(!RUN)('migrations — real SQL Server, from zero', () => {
  let DB_NAME = '';
  let adminPool;
  let dbPool;
  let dbCreated = false;

  beforeAll(async () => {
    DB_NAME = testDbName();
    adminPool = await new sql.ConnectionPool(poolConfig('master')).connect();
    // Bracketed identifier, not a parameter: CREATE DATABASE takes no
    // parameters. Safe because testDbName() has already restricted DB_NAME
    // to sms_test_ plus [A-Za-z0-9_] — nothing else can reach this string.
    await adminPool.request().batch(`CREATE DATABASE [${DB_NAME}]`);
    dbCreated = true;
    dbPool = await new sql.ConnectionPool(poolConfig(DB_NAME)).connect();
  }, 120_000);

  afterAll(async () => {
    if (dbPool) {
      await dbPool.close();
    }
    if (adminPool) {
      if (dbCreated) {
        // SINGLE_USER WITH ROLLBACK IMMEDIATE first: this test's own pool
        // should already be closed by here, but a prior crashed run, or a
        // reporting tool that reopened a connection, must not be able to
        // block the drop and leave an sms_test_* database stranded.
        await adminPool.request().batch(`
          IF DB_ID('${DB_NAME}') IS NOT NULL
          BEGIN
              ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
              DROP DATABASE [${DB_NAME}];
          END
        `);
      }
      await adminPool.close();
    }
  }, 120_000);

  test('applies every migration file from zero and records one history row each, in filename order', async () => {
    const files = migrationFiles();
    const appliedCount = await applyAll(dbPool);
    expect(appliedCount).toBe(files.length);

    const r = await dbPool.request().query('SELECT filename FROM sms.schema_migration ORDER BY filename');
    expect(r.recordset.map((row) => row.filename)).toEqual(files);
  }, 300_000);

  test('the objects the query surface depends on all exist, including the pallet_id column', async () => {
    const r = await dbPool.request().query(`
      SELECT
        OBJECT_ID('sms.cone_event')      AS cone_event,
        OBJECT_ID('sms.sack_event')      AS sack_event,
        OBJECT_ID('sms.source_epoch')    AS source_epoch,
        OBJECT_ID('sms.product_change')  AS product_change,
        OBJECT_ID('sms.pallet')          AS pallet,
        OBJECT_ID('sms.pack_schema')     AS pack_schema,
        COL_LENGTH('sms.product_change', 'pallet_id') AS pallet_id_col
    `);
    const row = r.recordset[0];
    expect(row.cone_event).not.toBeNull();
    expect(row.sack_event).not.toBeNull();
    expect(row.source_epoch).not.toBeNull();
    expect(row.product_change).not.toBeNull();
    expect(row.pallet).not.toBeNull();
    expect(row.pack_schema).not.toBeNull();
    // sms.product_change has existed since migration 027; pallet_id was
    // only added in 036. A schema that stopped short of 036 (or applied it
    // out of order) silently omits this column — the exact mismatch that
    // had three live product routes returning 500.
    expect(row.pallet_id_col).not.toBeNull();
  });

  test('both source_epoch uniqueness indexes exist', async () => {
    const r = await dbPool.request().query(`
      SELECT name FROM sys.indexes
      WHERE object_id = OBJECT_ID('sms.source_epoch')
        AND name IN ('UX_source_epoch_identity', 'UX_source_epoch_open')
    `);
    expect(r.recordset.map((row) => row.name).sort()).toEqual([
      'UX_source_epoch_identity',
      'UX_source_epoch_open',
    ]);
  });

  test('a second full run applies nothing', async () => {
    const before = await dbPool.request().query('SELECT COUNT(*) AS n FROM sms.schema_migration');
    const appliedCount = await applyAll(dbPool);
    expect(appliedCount).toBe(0);
    const after = await dbPool.request().query('SELECT COUNT(*) AS n FROM sms.schema_migration');
    expect(after.recordset[0].n).toBe(before.recordset[0].n);
  }, 120_000);
});
