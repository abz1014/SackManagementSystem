-- Demo databases for the SMS illustrated guide (worker T1, docs/guide plan §4 "T1").
--
-- Creates THREE new, empty databases, all fake, all local:
--   SMS_DEMO       — the app's own database (sms.* tables come later, from
--                     `sms\scripts\migrate.mjs`, run by the owner — see
--                     docs/guide/demo/OWNER-STEP.md). This script only creates
--                     the empty database.
--   DATA_DEMO_SIM  — a copy of DATA_TP1U2's four wide weighing tables, column
--                     for column, so the sync worker's schema-fingerprint gate
--                     passes against it unchanged. Column list taken from
--                     sms/scripts/simulate-plant-schema.sql (the same file the
--                     real dev simulator uses for DATA_TP1U2_SIM). The name
--                     ends in _SIM, so scripts/simulate-plant.mjs's own guard
--                     (it refuses any target not ending in _SIM) accepts it.
--                     This is deliberately a NEW database, not the existing
--                     DATA_TP1U2_SIM — that one may already hold rows copied
--                     from the real plant data (simulate-plant-copy-history.sql)
--                     and the dev app may be tracking it; reusing or resetting
--                     it would contaminate real reference data or break dev.
--   PDAS_DEMO      — a copy of PDAS_TP1U2's six tables the sync worker's
--                     product mirror reads (sync-worker/src/seed/seedProducts.ts).
--                     Column list and types taken from
--                     schema_dump/PDAS_TP1U2_columns.txt (the real database
--                     was never queried for this — working rule 2: read-only
--                     on IFL's DBs, and PDAS_DEMO must not even try to connect
--                     to them). No IDENTITY property is set on any primary key:
--                     the demo data (docs/guide/demo/20-demo-pdas-data.sql) and
--                     the shaping script (25-shape-demo-problem.sql) always
--                     assign explicit ids, the same pattern
--                     simulate-plant-schema.sql already uses for DATA_*_SIM's
--                     `id` columns.
--
-- Run as a Windows administrator (Windows auth), from the repo root:
--   sqlcmd -S .\SQLEXPRESS -E -b -i docs\guide\demo\10-create-demo-dbs.sql
--
-- Creates no logins and no users. That is docs/guide/demo/30-owner-logins.sql,
-- run separately by the OWNER (workers must never create logins/accounts —
-- see docs/guide/demo/OWNER-STEP.md).
--
-- Idempotent: every CREATE is guarded, so re-running this script after a
-- partial run does not fail and does not drop anything.

-- ============================================================ SMS_DEMO ====
IF DB_ID('SMS_DEMO') IS NULL
BEGIN
  CREATE DATABASE [SMS_DEMO];
END
GO
ALTER DATABASE [SMS_DEMO] SET RECOVERY SIMPLE;
GO

-- ======================================================= DATA_DEMO_SIM ====
IF DB_ID('DATA_DEMO_SIM') IS NULL
BEGIN
  CREATE DATABASE [DATA_DEMO_SIM];
END
GO
USE [DATA_DEMO_SIM];
GO

IF OBJECT_ID('dbo.pack1_TP1U2') IS NULL
CREATE TABLE dbo.pack1_TP1U2 (
  id int NOT NULL PRIMARY KEY,
  [Date] datetime NULL,
  [Shift] varchar(8) NULL,
  [Area] varchar(10) NULL,
  [ProductionDate] datetime NULL,
  [HangerNum] int NULL,
  [MachineNo] int NULL,
  [Lifter] int NULL,
  [Weight] decimal(6,2) NULL,
  [inRange] bit NULL,
  [MaterialId] int NULL
);
GO
IF OBJECT_ID('dbo.sack1_TP1U2') IS NULL
CREATE TABLE dbo.sack1_TP1U2 (
  id int NOT NULL PRIMARY KEY,
  [Date] datetime NULL,
  [Shift] varchar(8) NULL,
  [Area] varchar(10) NULL,
  [SackNum] int NULL,
  [Weight] decimal(6,3) NULL,
  [inRange] bit NULL,
  [MaterialId] int NULL
);
GO
IF OBJECT_ID('dbo.rejectQCS1_TP1U2') IS NULL
CREATE TABLE dbo.rejectQCS1_TP1U2 (
  id int NOT NULL PRIMARY KEY,
  [Date] datetime NULL,
  [Shift] varchar(8) NULL,
  [Area] varchar(10) NULL,
  [ProductionDate] datetime NULL,
  [HangerNum] int NULL,
  [MachineNo] int NULL,
  [Lifter] int NULL,
  [TubeInspectResult] int NULL,
  [MaterialInspectResult] int NULL,
  [MaterialId] int NULL
);
GO
IF OBJECT_ID('dbo.rejectWeight1_TP1U2') IS NULL
CREATE TABLE dbo.rejectWeight1_TP1U2 (
  id int NOT NULL PRIMARY KEY,
  [Date] datetime NULL,
  [Shift] varchar(8) NULL,
  [Area] varchar(10) NULL,
  [ProductionDate] datetime NULL,
  [HangerNum] int NULL,
  [MachineNo] int NULL,
  [Lifter] int NULL,
  [Weight] decimal(6,2) NULL,
  [MaterialId] int NULL
);
GO
-- Deliberately no CREATE LOGIN / CREATE USER here (contrast with
-- simulate-plant-schema.sql lines 69-81, which this script's table section
-- is otherwise a straight copy of). The owner creates sms_demo_sim /
-- sms_demo_reader separately — see 30-owner-logins.sql.

-- =========================================================== PDAS_DEMO ====
IF DB_ID('PDAS_DEMO') IS NULL
BEGIN
  CREATE DATABASE [PDAS_DEMO];
END
GO
USE [PDAS_DEMO];
GO

IF OBJECT_ID('dbo.Blends') IS NULL
CREATE TABLE dbo.Blends (
  BlendId int NOT NULL PRIMARY KEY,
  Blend nvarchar(510) NOT NULL,
  Timestamp datetime NOT NULL
);
GO
IF OBJECT_ID('dbo.Counts') IS NULL
CREATE TABLE dbo.Counts (
  CountId int NOT NULL PRIMARY KEY,
  Count nvarchar(510) NOT NULL,
  Timestamp datetime NOT NULL
);
GO
IF OBJECT_ID('dbo.TubeTypes') IS NULL
CREATE TABLE dbo.TubeTypes (
  TubeTypeId int NOT NULL PRIMARY KEY,
  TubeType nvarchar(510) NOT NULL,
  TubeForm int NULL,
  TubeWeight float NOT NULL,
  Timestamp datetime NOT NULL
);
GO
IF OBJECT_ID('dbo.Materials') IS NULL
CREATE TABLE dbo.Materials (
  MaterialId int NOT NULL PRIMARY KEY,
  BlendId int NOT NULL,
  CountId int NOT NULL,
  TubeTypeId int NULL,
  MaterialSetpointWeight float NOT NULL,
  MaterialWeightOffsetMinus float NOT NULL,
  MaterialWeightOffsetPlus float NOT NULL,
  MaterialActive bit NOT NULL,
  MaterialDesc1 nvarchar(510) NULL,
  MaterialDesc2 nvarchar(510) NULL,
  MaterialDesc3 nvarchar(510) NULL,
  MaterialDesc4 nvarchar(510) NULL,
  MaterialDesc5 nvarchar(510) NULL,
  Timestamp datetime NOT NULL
);
GO
IF OBJECT_ID('dbo.PackSchemas') IS NULL
CREATE TABLE dbo.PackSchemas (
  PackSchemaId int NOT NULL PRIMARY KEY,
  PackSchemaDesc nvarchar(510) NOT NULL,
  ConesPerLayer int NOT NULL,
  SeparatorId int NULL,
  PackTypeId int NOT NULL,
  Timestamp datetime NOT NULL
);
GO
IF OBJECT_ID('dbo.Pallets') IS NULL
CREATE TABLE dbo.Pallets (
  PalletId int NOT NULL PRIMARY KEY,
  MaterialId int NOT NULL,
  PackSchemaId int NOT NULL,
  Lot nvarchar(510) NOT NULL,
  SteamProg int NULL,
  LabelType int NULL,
  Routing int NULL,
  PalletActive bit NOT NULL,
  PalletDesc1 nvarchar(510) NULL,
  PalletDesc2 nvarchar(510) NULL,
  PalletDesc3 nvarchar(510) NULL,
  PalletDesc4 nvarchar(510) NULL,
  PalletDesc5 nvarchar(510) NULL,
  Timestamp datetime NOT NULL
);
GO
-- No CREATE LOGIN / CREATE USER here either — sms_demo_reader (db_datareader
-- on this database and on DATA_DEMO_SIM) is created by the owner.

PRINT 'SMS_DEMO, DATA_DEMO_SIM and PDAS_DEMO created (or already present).';
