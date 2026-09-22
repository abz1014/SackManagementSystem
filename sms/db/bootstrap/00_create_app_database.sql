-- 00_create_app_database.sql — create the SMS app (sidecar) database and its
-- two logins: the runtime login the API/worker/CLI connect with, and a
-- separate, narrower-scoped login used only to run migrations.
--
-- This is the step DEPLOY.md's first-time setup calls "Create the app DB +
-- its logins". It existed only as that sentence until 14 Sep 2026; migration
-- 001 creates the sms SCHEMA, not the DATABASE, so a from-zero install had
-- nothing to run first.
--
-- Run ONCE, as a sysadmin, against the plant SQL Server instance:
--
--   sqlcmd -S <server\instance or host,port> -E -i db\bootstrap\00_create_app_database.sql -v AppPassword="<strong unique password>" -v MigratePassword="<a different strong unique password>"
--
-- It never touches IFL's databases. Idempotent: safe to re-run — re-running
-- it against a database whose `sms_app` login still holds `db_ddladmin` from
-- before this fix is the intended remediation path (see the DROP MEMBER step
-- below). If either -v value is omitted, sqlcmd stops with "'...' scripting
-- variable not defined" — there is deliberately no default for a password.
--
-- ---------------------------------------------------------------------------
-- WHY TWO LOGINS (fixes defect R-13, HIGH, 22 Sep 2026):
--
-- Until this fix, `sms_app` — the ONE login the API, the sync worker, the
-- CLI, AND `npm run db:migrate` all connected as — held `db_ddladmin` on
-- top of `db_datareader`/`db_datawriter`. Migration 030 put an append-only
-- trigger on `sms.audit_log` (the record of who set the running product,
-- who logged a calibration adjustment, who exported the register, who
-- attempted a PDAS write); `db_ddladmin` can ALTER or DROP that trigger.
-- That means the very account whose writes the audit log exists to record
-- could also disarm the mechanism protecting those records — a serving
-- process compromised or misused at runtime had a path to tamper with its
-- own audit trail and put the guard back, leaving no trace. Migration 030's
-- own header names this gap and names the fix; this file applies it.
--
-- The fix is not "remove db_ddladmin from everywhere" — `db:migrate` (run
-- by an operator, by hand, only at install/upgrade time) genuinely needs
-- schema rights. It is to split the one login that always needs schema
-- rights but never runs unattended (sms_migrate) from the one login that
-- runs unattended all the time but has no legitimate reason to touch schema
-- (sms_app):
--
--   sms_app     — db_datareader, db_datawriter on [sms] only.
--                 Used by: the API, the sync worker, the CLI (including
--                 `retention`), for every unattended, long-running process.
--                 Cannot ALTER or DROP anything, including the audit_log
--                 trigger, the schema_migration history table, or any other
--                 object — that is the whole point.
--   sms_migrate — db_datareader, db_datawriter, db_ddladmin on [sms] only.
--                 Used ONLY for `npm run db:migrate`, run by hand by an
--                 operator at install/upgrade time (DEPLOY.md step 6; set
--                 MIGRATE_DB_USER/MIGRATE_DB_PASSWORD for that one command,
--                 then leave them unset the rest of the time). It never
--                 serves a request and is never the login any long-running
--                 service holds open.
--
-- Neither login is db_owner — no backup rights (that is sms_backup,
-- DEPLOY.md), no security changes (CREATE/ALTER LOGIN, role membership),
-- no ability to drop the database. sms_migrate's db_ddladmin does NOT
-- include ALTER ROLE / security admin rights, so sms_migrate itself cannot
-- grant db_ddladmin to sms_app, or to anything else — that decision stays
-- with whoever runs this bootstrap script as sysadmin.
--
-- Recovery model: SIMPLE. The sidecar is backed up in full nightly
-- (scripts/backup-appdb.ps1) and point-in-time restore is not a requirement;
-- FULL would make the transaction log grow without bound unless log backups
-- were also scheduled (the development database's log reached 584 MB against
-- 200 MB of data before this was set). Change to FULL only together with a
-- log-backup schedule.

IF DB_ID(N'sms') IS NULL
BEGIN
    PRINT 'Creating database [sms]';
    CREATE DATABASE [sms];
END
ELSE
    PRINT 'Database [sms] already exists';
GO

ALTER DATABASE [sms] SET RECOVERY SIMPLE;
GO

-- --- sms_app: the runtime login -------------------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'sms_app')
BEGIN
    PRINT 'Creating login [sms_app]';
    CREATE LOGIN [sms_app] WITH PASSWORD = N'$(AppPassword)', CHECK_EXPIRATION = OFF, CHECK_POLICY = ON;
END
ELSE
    PRINT 'Login [sms_app] already exists (password unchanged)';
GO

-- --- sms_migrate: the migration-only login --------------------------------

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'sms_migrate')
BEGIN
    PRINT 'Creating login [sms_migrate]';
    CREATE LOGIN [sms_migrate] WITH PASSWORD = N'$(MigratePassword)', CHECK_EXPIRATION = OFF, CHECK_POLICY = ON;
END
ELSE
    PRINT 'Login [sms_migrate] already exists (password unchanged)';
GO

USE [sms];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sms_app')
BEGIN
    PRINT 'Creating user [sms_app] in [sms]';
    CREATE USER [sms_app] FOR LOGIN [sms_app];
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sms_migrate')
BEGIN
    PRINT 'Creating user [sms_migrate] in [sms]';
    CREATE USER [sms_migrate] FOR LOGIN [sms_migrate];
END
GO

ALTER ROLE db_datareader ADD MEMBER [sms_app];
ALTER ROLE db_datawriter ADD MEMBER [sms_app];
GO

ALTER ROLE db_datareader ADD MEMBER [sms_migrate];
ALTER ROLE db_datawriter ADD MEMBER [sms_migrate];
ALTER ROLE db_ddladmin   ADD MEMBER [sms_migrate];
GO

-- Remediation for a database bootstrapped before this fix: sms_app may
-- still be a member of db_ddladmin from an earlier run of this same,
-- idempotent script. Drop it. This is the actual fix for R-13 on an
-- existing install — everything above this point is a no-op on one.
IF IS_ROLEMEMBER('db_ddladmin', 'sms_app') = 1
BEGIN
    PRINT 'Removing [sms_app] from db_ddladmin (defect R-13: the runtime login must not hold schema rights)';
    ALTER ROLE db_ddladmin DROP MEMBER [sms_app];
END
GO

PRINT 'Done. Next: copy .env.example to .env, set APP_DB_* (user sms_app). To run migrations, set MIGRATE_DB_USER=sms_migrate / MIGRATE_DB_PASSWORD for that one invocation, then: npm run db:migrate';
GO
