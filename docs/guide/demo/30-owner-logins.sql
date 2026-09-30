-- Demo SQL logins — TO BE RUN BY THE OWNER ONLY.
--
-- Workers must never create logins, users or app accounts (project rule,
-- restated in the T1 task brief). This script exists so the owner can run
-- it themselves as a single step, after reading it.
--
-- Creates three logins, each scoped to exactly one demo database, and
-- nothing else:
--   sms_demo_app     -> db_datareader + db_datawriter + db_ddladmin on
--                        SMS_DEMO ONLY. db_ddladmin is wider than the real
--                        production split (sms_app there holds no
--                        db_ddladmin — see db/bootstrap/00_create_app_database.sql's
--                        header on defect R-13 — and schema changes run as a
--                        separate sms_migrate login). It is granted here
--                        only because this is a throwaway demo database with
--                        no unattended service running continuously against
--                        it, so the same login can also run migrations
--                        (`demo.ps1 migrate`) without a second login to
--                        provision. THE GUIDE ITSELF MUST DESCRIBE THE
--                        PRODUCTION SPLIT, NOT THIS SHORTCUT.
--   sms_demo_reader  -> db_datareader on DATA_DEMO_SIM and PDAS_DEMO ONLY.
--                        Mirrors the real sms_readonly login's shape (read
--                        access to the two source databases, nothing else).
--   sms_demo_sim     -> db_owner on DATA_DEMO_SIM ONLY. Mirrors the real
--                        sms_sim login (scripts/simulate-plant-schema.sql),
--                        which needs to INSERT synthetic rows.
--
-- None of these three logins is granted access to any OTHER database on
-- this instance — not SMS_DEMO for sms_demo_reader/sms_demo_sim, not
-- DATA_DEMO_SIM or PDAS_DEMO for sms_demo_app, and certainly not
-- DATA_TP1U2, DATA_TP1U2_SEP07, PDAS_TP1U2*, DATA_TP1U2_SIM, or the dev app
-- database `sms`.
--
-- Run as a Windows administrator, from the repo root, supplying three
-- passwords on the command line via sqlcmd -v (never stored in this file):
--
--   sqlcmd -S .\SQLEXPRESS -E -b -i docs\guide\demo\30-owner-logins.sql ^
--     -v DemoAppPassword="<choose one>" ^
--     -v DemoReaderPassword="<choose one>" ^
--     -v DemoSimPassword="<choose one>"
--
-- Afterwards, put the same three passwords into
-- docs\guide\demo\demo-secrets.env (gitignored) as directed in
-- docs\guide\demo\OWNER-STEP.md. Do not paste them into chat.
--
-- Idempotent: creating a login/user that already exists is skipped, not
-- re-created; re-running this script after a partial run is safe. It does
-- NOT reset a password on an existing login — drop and re-run if you need
-- to rotate one.

-- NOTE: no :setvar defaults here on purpose; a :setvar would override -v.
-- If a -v value is missing sqlcmd stops with "scripting variable not defined".

IF '$(DemoAppPassword)' = '' OR '$(DemoReaderPassword)' = '' OR '$(DemoSimPassword)' = ''
BEGIN
  RAISERROR('All three -v passwords (DemoAppPassword, DemoReaderPassword, DemoSimPassword) are required.', 16, 1);
  RETURN;
END
GO

-- ------------------------------------------------------------- sms_demo_app
USE [master];
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'sms_demo_app')
  EXEC('CREATE LOGIN [sms_demo_app] WITH PASSWORD = ''$(DemoAppPassword)'', CHECK_POLICY = ON');
GO
USE [SMS_DEMO];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_demo_app')
  CREATE USER [sms_demo_app] FOR LOGIN [sms_demo_app];
GO
ALTER ROLE db_datareader ADD MEMBER [sms_demo_app];
ALTER ROLE db_datawriter ADD MEMBER [sms_demo_app];
ALTER ROLE db_ddladmin ADD MEMBER [sms_demo_app];
GO

-- ---------------------------------------------------------- sms_demo_reader
USE [master];
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'sms_demo_reader')
  EXEC('CREATE LOGIN [sms_demo_reader] WITH PASSWORD = ''$(DemoReaderPassword)'', CHECK_POLICY = ON');
GO
USE [DATA_DEMO_SIM];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_demo_reader')
  CREATE USER [sms_demo_reader] FOR LOGIN [sms_demo_reader];
GO
ALTER ROLE db_datareader ADD MEMBER [sms_demo_reader];
GO
USE [PDAS_DEMO];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_demo_reader')
  CREATE USER [sms_demo_reader] FOR LOGIN [sms_demo_reader];
GO
ALTER ROLE db_datareader ADD MEMBER [sms_demo_reader];
GO

-- ------------------------------------------------------------- sms_demo_sim
USE [master];
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'sms_demo_sim')
  EXEC('CREATE LOGIN [sms_demo_sim] WITH PASSWORD = ''$(DemoSimPassword)'', CHECK_POLICY = ON');
GO
USE [DATA_DEMO_SIM];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_demo_sim')
  CREATE USER [sms_demo_sim] FOR LOGIN [sms_demo_sim];
GO
ALTER ROLE db_owner ADD MEMBER [sms_demo_sim];
GO

USE [master];
GO
PRINT 'sms_demo_app, sms_demo_reader and sms_demo_sim created (or already present), each scoped to exactly one demo database.';
