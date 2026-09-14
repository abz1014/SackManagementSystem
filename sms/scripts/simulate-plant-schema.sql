-- Simulation database schema. Mirrors DATA_TP1U2 column-for-column so the
-- sync worker's schema-fingerprint gate passes against it unchanged.
--
-- Run as a Windows administrator, supplying the writer password rather than
-- storing one here (working rule 1: no credentials in the repository):
--   sqlcmd -S .SQLEXPRESS -E -i scripts/simulate-plant-schema.sql -v SIM_PASSWORD="<choose one>"
--
-- Put the same value in sms/.env as SIM_DB_PASSWORD.

IF DB_ID('DATA_TP1U2_SIM') IS NULL CREATE DATABASE [DATA_TP1U2_SIM];
GO
USE [DATA_TP1U2_SIM];
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
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_readonly')
  CREATE USER [sms_readonly] FOR LOGIN [sms_readonly];
GO
ALTER ROLE db_datareader ADD MEMBER [sms_readonly];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'sms_sim')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'sms_sim')
    EXEC('CREATE LOGIN [sms_sim] WITH PASSWORD = ''$(SIM_PASSWORD)'', CHECK_POLICY = OFF');
  CREATE USER [sms_sim] FOR LOGIN [sms_sim];
  ALTER ROLE db_owner ADD MEMBER [sms_sim];
END
GO
SELECT name, type_desc FROM sys.tables ORDER BY name;
