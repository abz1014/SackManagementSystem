-- 00_create_app_database.sql — create the SMS app (sidecar) database and its login.
--
-- This is the step DEPLOY.md's first-time setup calls "Create the app DB + its
-- login". It existed only as that sentence until 14 Sep 2026; migration 001
-- creates the sms SCHEMA, not the DATABASE, so a from-zero install had nothing
-- to run first.
--
-- Run ONCE, as a sysadmin, against the plant SQL Server instance:
--
--   sqlcmd -S <server\instance or host,port> -E -i db\bootstrap\00_create_app_database.sql -v AppPassword="<strong unique password>"
--
-- It never touches IFL's databases. Idempotent: safe to re-run. If -v AppPassword
-- is omitted, sqlcmd stops with "'AppPassword' scripting variable not defined" —
-- there is deliberately no default.
--
-- What sms_app gets and why (least privilege for what the code actually does):
--   db_datareader / db_datawriter  — the API and sync worker read and write sms.* and sms_raw.*
--   db_ddladmin                    — scripts/migrate.mjs runs as sms_app and creates schemas,
--                                    tables, indexes and constraints (migrations 001-027+)
--   NOT db_owner                   — no backup rights (that is sms_backup, DEPLOY.md), no
--                                    security changes, no ability to drop the database
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

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'sms_app')
BEGIN
    PRINT 'Creating login [sms_app]';
    CREATE LOGIN [sms_app] WITH PASSWORD = N'$(AppPassword)', CHECK_EXPIRATION = OFF, CHECK_POLICY = ON;
END
ELSE
    PRINT 'Login [sms_app] already exists (password unchanged)';
GO

USE [sms];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sms_app')
BEGIN
    PRINT 'Creating user [sms_app] in [sms]';
    CREATE USER [sms_app] FOR LOGIN [sms_app];
END
GO

ALTER ROLE db_datareader ADD MEMBER [sms_app];
ALTER ROLE db_datawriter ADD MEMBER [sms_app];
ALTER ROLE db_ddladmin   ADD MEMBER [sms_app];
GO

PRINT 'Done. Next: copy .env.example to .env, set APP_DB_* (user sms_app), then: npm run db:migrate';
GO
