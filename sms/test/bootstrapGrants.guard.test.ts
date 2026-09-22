// test/bootstrapGrants.guard.test.ts — guards defect R-13 (HIGH): the
// runtime login (sms_app) must never be granted db_ddladmin, and the
// migration runner must prefer a separate migration-only login.
//
// This is a text-level guard, not a live-database test: it reads the
// bootstrap SQL and the migration runner off disk and asserts on their
// content. Nothing here opens a SQL connection — consistent with this pass
// never creating a login or running DDL against any live instance (dev
// sidecar included; other work was running against it at the time this was
// written). test/migrations.integration.test.ts is the suite that exercises
// a real SQL Server, opt-in via SMS_TEST_DB_SERVER; this file runs always.
//
// Proven to fail on the pre-fix shape: run this against a checkout of
// db/bootstrap/00_create_app_database.sql from before 22 Sep 2026 (the
// version that ran `ALTER ROLE db_ddladmin ADD MEMBER [sms_app];` with no
// sms_migrate login at all) and the first two tests below fail.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bootstrapSql = readFileSync(
  join(__dirname, '..', 'db', 'bootstrap', '00_create_app_database.sql'),
  'utf8',
);
const migrateMjs = readFileSync(join(__dirname, '..', 'scripts', 'migrate.mjs'), 'utf8');

describe('defect R-13 guard — runtime login must not hold db_ddladmin', () => {
  test('sms_app is never added to db_ddladmin', () => {
    // The only db_ddladmin grant statements in the file must name
    // sms_migrate, never sms_app.
    const ddladminGrants = bootstrapSql
      .split('\n')
      .filter((line) => /ALTER ROLE db_ddladmin\s+ADD MEMBER/i.test(line));
    expect(ddladminGrants.length).toBeGreaterThan(0);
    for (const line of ddladminGrants) {
      expect(line).toMatch(/\[sms_migrate\]/);
      expect(line).not.toMatch(/\[sms_app\]/);
    }
  });

  test('sms_app keeps db_datareader and db_datawriter', () => {
    expect(bootstrapSql).toMatch(/ALTER ROLE db_datareader ADD MEMBER \[sms_app\]/);
    expect(bootstrapSql).toMatch(/ALTER ROLE db_datawriter ADD MEMBER \[sms_app\]/);
  });

  test('a dedicated sms_migrate login is created, separate from sms_app', () => {
    expect(bootstrapSql).toMatch(/CREATE LOGIN \[sms_migrate\]/);
    expect(bootstrapSql).toMatch(/CREATE USER \[sms_migrate\] FOR LOGIN \[sms_migrate\]/);
    expect(bootstrapSql).toMatch(/ALTER ROLE db_ddladmin\s+ADD MEMBER \[sms_migrate\]/);
  });

  test('re-running the bootstrap script remediates a database provisioned before this fix', () => {
    // The idempotent remediation path: detect sms_app still holding
    // db_ddladmin from an earlier run and drop it.
    expect(bootstrapSql).toMatch(/IS_ROLEMEMBER\('db_ddladmin',\s*'sms_app'\)/);
    expect(bootstrapSql).toMatch(/ALTER ROLE db_ddladmin DROP MEMBER \[sms_app\]/);
  });

  test('migrate.mjs prefers a migration-only login over the runtime login', () => {
    expect(migrateMjs).toMatch(/MIGRATE_DB_USER/);
    expect(migrateMjs).toMatch(/MIGRATE_DB_PASSWORD/);
    // Must fall back to APP_DB_* (not require MIGRATE_DB_* unconditionally),
    // so a dev/CI box that has not yet provisioned sms_migrate keeps working.
    expect(migrateMjs).toMatch(/MIGRATE_DB_USER\s*\?\?\s*process\.env\.APP_DB_USER/);
    expect(migrateMjs).toMatch(/MIGRATE_DB_PASSWORD\s*\?\?\s*process\.env\.APP_DB_PASSWORD/);
  });
});
