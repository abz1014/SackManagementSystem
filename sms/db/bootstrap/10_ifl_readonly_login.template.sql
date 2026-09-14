-- 10_ifl_readonly_login.template.sql — TEMPLATE for IFL's DBA. SMS never runs this.
--
-- This is the login DEPLOY.md's first-time setup step 2 asks IFL for: a dedicated
-- READ-ONLY login with db_datareader on BOTH of IFL's databases. It is written out
-- so the request to IFL is precise, and so the pre-cutover test at the bottom can
-- be run before the day.
--
-- Why both databases, stated plainly: the sync worker's product mirror reads the
-- base tables Blends, Counts, TubeTypes and Materials in PDAS_TP1U2 directly, and
-- it runs BEFORE the cone/sack/reject reader in every pass. A login with EXECUTE
-- on PDAS's procedures but no table read (IFL's own 'ibrahim' login, as seen in
-- the Sep 2026 sample) stops ALL ingestion, not just the product mirror.
--
-- Nothing here grants any write, any EXECUTE, or any right on any other database.

-- === Run on IFL's SQL Server as a sysadmin. Replace the password. ===

CREATE LOGIN [sms_readonly] WITH PASSWORD = N'<strong unique password>', CHECK_EXPIRATION = OFF, CHECK_POLICY = ON;
GO

USE [DATA_TP1U2];
GO
CREATE USER [sms_readonly] FOR LOGIN [sms_readonly];
ALTER ROLE db_datareader ADD MEMBER [sms_readonly];
GO

USE [PDAS_TP1U2];
GO
CREATE USER [sms_readonly] FOR LOGIN [sms_readonly];
ALTER ROLE db_datareader ADD MEMBER [sms_readonly];
GO

-- === Pre-cutover test (run AS sms_readonly, before the day). All four must return a row. ===
-- SELECT TOP 1 id FROM DATA_TP1U2.dbo.pack1_TP1U2;
-- SELECT TOP 1 id FROM DATA_TP1U2.dbo.sack1_TP1U2;
-- SELECT TOP 1 MaterialId FROM PDAS_TP1U2.dbo.Materials;
-- SELECT create_date FROM DATA_TP1U2.sys.tables WHERE name = 'pack1_TP1U2';   -- the generation gate reads this
