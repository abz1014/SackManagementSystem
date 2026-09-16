// migrate-core.mjs — the reusable core of the migration runner: the
// GO-batch split, the per-file transaction, and the sms.schema_migration
// history table. Extracted out of scripts/migrate.mjs (which imports these
// exact functions for its CLI) so that test/migrations.integration.test.ts
// can run the REAL runner against a throwaway database, not a copy of it —
// a test against a copy would only ever prove the copy works.
//
// Keep this file free of CLI concerns: no argv parsing, no .env loading, no
// process.exit. Both callers (the CLI and the integration test) must see
// identical behaviour from these four functions.

import sql from 'mssql';

export async function ensureHistoryTable(pool) {
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

export async function alreadyApplied(pool, filename) {
  const r = await pool
    .request()
    .input('f', sql.VarChar(255), filename)
    .query('SELECT 1 AS x FROM sms.schema_migration WHERE filename = @f');
  return r.recordset.length > 0;
}

export async function applyFile(pool, filename, raw) {
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
