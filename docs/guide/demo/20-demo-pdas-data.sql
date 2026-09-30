-- Fake PDAS reference data for the demo (worker T1, docs/guide plan §4 "T1").
--
-- Populates PDAS_DEMO's six tables with entirely invented rows: no real
-- product names, blend/count/tube names, or pallet lots from IFL appear here
-- (working rule "demo fake names only"). The values are chosen to exercise
-- what the guide needs to screenshot:
--   - six Materials, ids 20, 21, 1021, 1022, 1023, 1024 — the SAME ids
--     scripts/simulate-plant.mjs's MACHINE_MATERIAL table already assigns to
--     machines 1-14 (see that file: 21->machines 1-5, 20->6-9, 1021->10-11,
--     1022->12, 1023->13, 1024->14). Using the same ids means the demo
--     simulator's rows line up with real Materials rows once synced — no
--     "unattributed" product gap the way the real July data has.
--   - MaterialId 1024 is created ACTIVE then immediately retired
--     (MaterialActive=0), the "not enabled / retired" display state: machine
--     14 still runs it, so the running-product screen shows the
--     "(retired in PDAS)" marker (words.ts, per docs/guide plan §1.3/§3 S13).
--   - One pallet per material (PalletId > 10, matching the real filter in
--     sync-worker/src/seed/seedProducts.ts).
--
-- Run as a Windows administrator (Windows auth), from the repo root, AFTER
-- 10-create-demo-dbs.sql:
--   sqlcmd -S .\SQLEXPRESS -E -b -i docs\guide\demo\20-demo-pdas-data.sql
--
-- Idempotent: every INSERT is guarded by "IF NOT EXISTS", so re-running this
-- script does not duplicate rows or fail.

USE [PDAS_DEMO];
GO
IF DB_NAME() <> 'PDAS_DEMO'
BEGIN
  RAISERROR('refusing to run: not connected to PDAS_DEMO', 16, 1);
  RETURN;
END
GO

DECLARE @now datetime = DATEADD(day, -30, GETUTCDATE());

-- ------------------------------------------------------------------ Blends
IF NOT EXISTS (SELECT 1 FROM dbo.Blends WHERE BlendId = 1)
  INSERT INTO dbo.Blends (BlendId, Blend, Timestamp) VALUES (1, N'DEMO BLEND A', @now);
IF NOT EXISTS (SELECT 1 FROM dbo.Blends WHERE BlendId = 2)
  INSERT INTO dbo.Blends (BlendId, Blend, Timestamp) VALUES (2, N'DEMO BLEND B', @now);
IF NOT EXISTS (SELECT 1 FROM dbo.Blends WHERE BlendId = 3)
  INSERT INTO dbo.Blends (BlendId, Blend, Timestamp) VALUES (3, N'DEMO BLEND C', @now);
GO

-- ------------------------------------------------------------------ Counts
IF NOT EXISTS (SELECT 1 FROM dbo.Counts WHERE CountId = 1)
  INSERT INTO dbo.Counts (CountId, Count, Timestamp) VALUES (1, N'1.2D', DATEADD(day, -30, GETUTCDATE()));
IF NOT EXISTS (SELECT 1 FROM dbo.Counts WHERE CountId = 2)
  INSERT INTO dbo.Counts (CountId, Count, Timestamp) VALUES (2, N'1.5D', DATEADD(day, -30, GETUTCDATE()));
GO

-- --------------------------------------------------------------- TubeTypes
IF NOT EXISTS (SELECT 1 FROM dbo.TubeTypes WHERE TubeTypeId = 1)
  INSERT INTO dbo.TubeTypes (TubeTypeId, TubeType, TubeForm, TubeWeight, Timestamp)
  VALUES (1, N'Demo tube 70g', 1, 70.0, DATEADD(day, -30, GETUTCDATE()));
IF NOT EXISTS (SELECT 1 FROM dbo.TubeTypes WHERE TubeTypeId = 2)
  INSERT INTO dbo.TubeTypes (TubeTypeId, TubeType, TubeForm, TubeWeight, Timestamp)
  VALUES (2, N'Demo tube 75g', 1, 75.0, DATEADD(day, -30, GETUTCDATE()));
GO

-- ---------------------------------------------------------------- Materials
-- MaterialId, BlendId, CountId, TubeTypeId, Setpoint, OffsetMinus, OffsetPlus,
-- Active, Desc1 (name), Desc2 (colour-ish label). Every id > 10, per the real
-- filter (MaterialId > 10 excludes vendor seed rows).
DECLARE @ts datetime = DATEADD(day, -30, GETUTCDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.Materials WHERE MaterialId = 20)
  INSERT INTO dbo.Materials (MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight,
    MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, MaterialActive, MaterialDesc1, MaterialDesc2, Timestamp)
  VALUES (20, 1, 1, 1, 1950, 25, 25, 1, N'DEMO-20', N'Demo natural', @ts);

IF NOT EXISTS (SELECT 1 FROM dbo.Materials WHERE MaterialId = 21)
  INSERT INTO dbo.Materials (MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight,
    MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, MaterialActive, MaterialDesc1, MaterialDesc2, Timestamp)
  VALUES (21, 1, 2, 1, 1950, 25, 25, 1, N'DEMO-21', N'Demo white', @ts);

IF NOT EXISTS (SELECT 1 FROM dbo.Materials WHERE MaterialId = 1021)
  INSERT INTO dbo.Materials (MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight,
    MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, MaterialActive, MaterialDesc1, MaterialDesc2, Timestamp)
  VALUES (1021, 2, 1, 2, 1950, 25, 25, 1, N'DEMO-1021', N'Demo blue', @ts);

IF NOT EXISTS (SELECT 1 FROM dbo.Materials WHERE MaterialId = 1022)
  INSERT INTO dbo.Materials (MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight,
    MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, MaterialActive, MaterialDesc1, MaterialDesc2, Timestamp)
  VALUES (1022, 2, 2, 2, 1950, 25, 25, 1, N'DEMO-1022', N'Demo green', @ts);

IF NOT EXISTS (SELECT 1 FROM dbo.Materials WHERE MaterialId = 1023)
  INSERT INTO dbo.Materials (MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight,
    MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, MaterialActive, MaterialDesc1, MaterialDesc2, Timestamp)
  VALUES (1023, 3, 1, 1, 1950, 25, 25, 1, N'DEMO-1023', N'Demo grey', @ts);

-- 1024: created active, then retired — the "(retired in PDAS)" demo state.
-- Machine 14 (scripts/simulate-plant.mjs MACHINE_MATERIAL) keeps running it.
IF NOT EXISTS (SELECT 1 FROM dbo.Materials WHERE MaterialId = 1024)
  INSERT INTO dbo.Materials (MaterialId, BlendId, CountId, TubeTypeId, MaterialSetpointWeight,
    MaterialWeightOffsetMinus, MaterialWeightOffsetPlus, MaterialActive, MaterialDesc1, MaterialDesc2, Timestamp)
  VALUES (1024, 3, 2, 2, 1950, 25, 25, 0, N'DEMO-1024', N'Demo retired', @ts);
GO

-- -------------------------------------------------------------- PackSchemas
IF NOT EXISTS (SELECT 1 FROM dbo.PackSchemas WHERE PackSchemaId = 1)
  INSERT INTO dbo.PackSchemas (PackSchemaId, PackSchemaDesc, ConesPerLayer, PackTypeId, Timestamp)
  VALUES (1, N'Pallet 4x5', 20, 1, DATEADD(day, -30, GETUTCDATE()));
IF NOT EXISTS (SELECT 1 FROM dbo.PackSchemas WHERE PackSchemaId = 2)
  INSERT INTO dbo.PackSchemas (PackSchemaId, PackSchemaDesc, ConesPerLayer, PackTypeId, Timestamp)
  VALUES (2, N'Sack 3x4', 12, 1, DATEADD(day, -30, GETUTCDATE()));
GO

-- ------------------------------------------------------------------ Pallets
-- One pallet per material, PalletId > 10 (the real filter).
DECLARE @pts datetime = DATEADD(day, -30, GETUTCDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.Pallets WHERE PalletId = 21)
  INSERT INTO dbo.Pallets (PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive, PalletDesc1, Timestamp)
  VALUES (21, 20, 1, N'DEMO-LOT-20', 1, 1, 1, 1, N'Demo pallet 20', @pts);
IF NOT EXISTS (SELECT 1 FROM dbo.Pallets WHERE PalletId = 22)
  INSERT INTO dbo.Pallets (PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive, PalletDesc1, Timestamp)
  VALUES (22, 21, 1, N'DEMO-LOT-21', 1, 1, 1, 1, N'Demo pallet 21', @pts);
IF NOT EXISTS (SELECT 1 FROM dbo.Pallets WHERE PalletId = 23)
  INSERT INTO dbo.Pallets (PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive, PalletDesc1, Timestamp)
  VALUES (23, 1021, 2, N'DEMO-LOT-1021', 1, 1, 1, 1, N'Demo pallet 1021', @pts);
IF NOT EXISTS (SELECT 1 FROM dbo.Pallets WHERE PalletId = 24)
  INSERT INTO dbo.Pallets (PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive, PalletDesc1, Timestamp)
  VALUES (24, 1022, 2, N'DEMO-LOT-1022', 1, 1, 1, 1, N'Demo pallet 1022', @pts);
IF NOT EXISTS (SELECT 1 FROM dbo.Pallets WHERE PalletId = 25)
  INSERT INTO dbo.Pallets (PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive, PalletDesc1, Timestamp)
  VALUES (25, 1023, 1, N'DEMO-LOT-1023', 1, 1, 1, 1, N'Demo pallet 1023', @pts);
IF NOT EXISTS (SELECT 1 FROM dbo.Pallets WHERE PalletId = 26)
  INSERT INTO dbo.Pallets (PalletId, MaterialId, PackSchemaId, Lot, SteamProg, LabelType, Routing, PalletActive, PalletDesc1, Timestamp)
  VALUES (26, 1024, 1, N'DEMO-LOT-1024', 1, 1, 1, 0, N'Demo pallet 1024 (retired material)', @pts);
GO

PRINT 'PDAS_DEMO fake reference data inserted (or already present).';
SELECT COUNT(*) AS blends FROM dbo.Blends;
SELECT COUNT(*) AS counts FROM dbo.Counts;
SELECT COUNT(*) AS tubeTypes FROM dbo.TubeTypes;
SELECT COUNT(*) AS materials FROM dbo.Materials;
SELECT MaterialId, MaterialActive FROM dbo.Materials WHERE MaterialId = 1024;
SELECT COUNT(*) AS packSchemas FROM dbo.PackSchemas;
SELECT COUNT(*) AS pallets FROM dbo.Pallets;
GO
