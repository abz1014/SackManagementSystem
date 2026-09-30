-- =============================================================================
-- FAKE-DATA SHAPING SCRIPT — worker T1, owner-approved (docs/guide plan §6 Q1).
--
-- This script is NOT run by worker T1. It is written for worker T5 (Wave 2,
-- "Bring up the demo and certify its state") to run AFTER the simulator
-- backfill (`demo.ps1 sim --days=21`) and BEFORE the first sync
-- (`demo.ps1 cli sync`) — i.e. it reshapes the plant simulator's OWN fake
-- rows in DATA_DEMO_SIM before the sync worker ever reads them, so the
-- reshaped rows arrive as ordinary source data, not as a later correction.
--
-- WHY THIS EXISTS. scripts/simulate-plant.mjs gives station 4 a built-in
-- -2.9 g weight bias (STATION_BIAS = { 4: -2.9, 10: 1.4, 13: -1.1 }), so the
-- guide's plan defaulted to relying on that as the "visible problem station"
-- for the Weight and Calibration report screenshots. The plan's own owner
-- question (§6 Q1) flagged that this might not be clearly visible, and asked
-- for approval to shape a DIFFERENT, more obviously visible problem if
-- needed: a REJECT-RATE spike, not a weight-bias one, on a station other
-- than 4 (so the two problems, if both end up visible, are distinguishable
-- and do not fight over which screen shows what). The owner approved this.
--
-- WHAT IT DOES. Moves approximately 20% of station 7's `pack1_TP1U2` rows
-- (accepted cones) from the last 2 production days into `rejectQCS1_TP1U2`
-- (quality/inspection rejects), using the single MOST COMMON real quality
-- reject code observed in the July/September samples (TubeInspectResult=10,
-- MaterialInspectResult=1 — 59.7% of all quality rejects, per
-- scripts/simulate-plant.mjs's own QCS_CODES table, first entry). Station 7
-- runs MaterialId 20 in the simulator's MACHINE_MATERIAL map (machines 6-9),
-- a different material from station 4's MaterialId 21 (machines 1-5) and a
-- DIFFERENT station from the one carrying the built-in weight bias, so the
-- two signals do not overlap.
--
-- WHY THIS IS SAFE TO CALL "FAKE-DATA SHAPING" AND NOT "INVENTING A
-- FINDING": every row moved was ALREADY a synthetic row the simulator wrote
-- (never real IFL data — this script hard-refuses against anything but
-- DATA_DEMO_SIM, itself entirely simulator output). No new weight, hanger,
-- or timestamp values are invented; only WHICH TABLE the row lives in
-- changes, using a code the real Pareto (QCS_CODES) already says is the most
-- common one. The moved rows keep their original id, Date (insert time),
-- Shift, Area, ProductionDate, HangerNum, MachineNo, Lifter and MaterialId —
-- exactly the columns rejectQCS1_TP1U2 and pack1_TP1U2 share — and gain only
-- TubeInspectResult/MaterialInspectResult, which pack1_TP1U2 has no
-- equivalent of (there is nothing to invent there either: it is a fixed,
-- real code, not a fabricated one).
--
-- GUARDS.
--   - Hard-refuses unless DB_NAME() = 'DATA_DEMO_SIM' (USE + an explicit
--     check — never runs against DATA_TP1U2, DATA_TP1U2_SIM, or anything
--     else by accident).
--   - Runs inside one explicit transaction: either every row moves or none
--     do.
--   - Prints before/after row counts for both tables so whoever runs it can
--     see exactly what changed.
--   - Idempotent-ish, not literally idempotent: running it twice would move
--     another ~20% of what is LEFT in pack1_TP1U2 for the same two days
--     (the WHERE clause only excludes ids already moved via a NOT EXISTS
--     against rejectQCS1_TP1U2, so a second run keeps working, just moves a
--     shallower slice each time). Run it once, then check the results
--     printed at the end before deciding whether to run it again.
--
-- Run as a Windows administrator (Windows auth), from the repo root, AFTER
-- `demo.ps1 sim --days=21` and BEFORE `demo.ps1 cli sync`:
--   sqlcmd -S .\SQLEXPRESS -E -b -i docs\guide\demo\25-shape-demo-problem.sql
--
-- Column shapes taken from sms/scripts/simulate-plant-schema.sql (mirrored
-- again in docs/guide/demo/10-create-demo-dbs.sql) and from
-- sms/scripts/simulate-plant.mjs's own CONE_SHAPE / QCS_SHAPE arrays and its
-- `generate()` function (both tables' rows are built there identically to
-- what this script produces, minus the two inspect-result columns).
-- =============================================================================

USE [DATA_DEMO_SIM];
GO
IF DB_NAME() <> 'DATA_DEMO_SIM'
BEGIN
  RAISERROR('REFUSING: this script only ever runs against DATA_DEMO_SIM. Current database is not DATA_DEMO_SIM — stopping.', 16, 1);
  RETURN;
END
GO

DECLARE @station int = 7;
DECLARE @moveFraction float = 0.20;
DECLARE @tubeCode int = 10;   -- QCS_CODES[0].tube — the most common real quality reject code.
DECLARE @matCode int = 1;     -- QCS_CODES[0].mat.

DECLARE @maxProdDate datetime;
DECLARE @cutoff datetime;
DECLARE @beforePack int, @beforeQcs int, @afterPack int, @afterQcs int, @moved int;

SELECT @maxProdDate = MAX(ProductionDate) FROM dbo.pack1_TP1U2 WHERE MachineNo = @station;
IF @maxProdDate IS NULL
BEGIN
  RAISERROR('REFUSING: no pack1_TP1U2 rows found for station 7 — has the simulator backfill (demo.ps1 sim --days=21) been run yet?', 16, 1);
  RETURN;
END
-- "Last 2 production days": the two calendar days ending on the station's
-- own newest production timestamp.
SET @cutoff = DATEADD(day, -2, CAST(@maxProdDate AS date));

SELECT @beforePack = COUNT(*) FROM dbo.pack1_TP1U2 WHERE MachineNo = @station;
SELECT @beforeQcs = COUNT(*) FROM dbo.rejectQCS1_TP1U2 WHERE MachineNo = @station;

PRINT 'Before shaping:';
PRINT '  pack1_TP1U2 rows for station 7:       ' + CAST(@beforePack AS varchar(20));
PRINT '  rejectQCS1_TP1U2 rows for station 7:  ' + CAST(@beforeQcs AS varchar(20));
PRINT '  cutoff (last 2 production days from): ' + CONVERT(varchar(30), @cutoff, 120);

BEGIN TRANSACTION;

-- Candidate rows: station 7, within the last 2 production days, ~20% sample
-- (deterministic on id parity-of-5 rather than NEWID(), so a dry read of the
-- WHERE clause before running shows exactly which ids would move).
;WITH candidates AS (
  SELECT id, [Date], [Shift], [Area], ProductionDate, HangerNum, MachineNo, Lifter, MaterialId
  FROM dbo.pack1_TP1U2
  WHERE MachineNo = @station
    AND ProductionDate >= @cutoff
    AND id % 5 = 0   -- ~20% of rows (1 in 5), a fixed, reproducible selection
),
numbered AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM candidates
),
based AS (
  SELECT n.*, (SELECT ISNULL(MAX(id), 0) FROM dbo.rejectQCS1_TP1U2) AS qcsBase
  FROM numbered n
)
INSERT INTO dbo.rejectQCS1_TP1U2
  (id, [Date], [Shift], [Area], ProductionDate, HangerNum, MachineNo, Lifter, TubeInspectResult, MaterialInspectResult, MaterialId)
SELECT
  qcsBase + rn, [Date], [Shift], [Area], ProductionDate, HangerNum, MachineNo, Lifter, @tubeCode, @matCode, MaterialId
FROM based;

SET @moved = @@ROWCOUNT;

DELETE FROM dbo.pack1_TP1U2
WHERE MachineNo = @station
  AND ProductionDate >= @cutoff
  AND id % 5 = 0
  AND EXISTS (
    SELECT 1 FROM dbo.rejectQCS1_TP1U2 r
    WHERE r.MachineNo = pack1_TP1U2.MachineNo
      AND r.ProductionDate = pack1_TP1U2.ProductionDate
      AND r.HangerNum = pack1_TP1U2.HangerNum
      AND r.TubeInspectResult = @tubeCode
      AND r.MaterialInspectResult = @matCode
  );

IF @moved = 0
BEGIN
  PRINT 'No candidate rows found (station 7 / last 2 production days / id % 5 = 0) — nothing moved. Rolling back.';
  ROLLBACK TRANSACTION;
  RETURN;
END

COMMIT TRANSACTION;

SELECT @afterPack = COUNT(*) FROM dbo.pack1_TP1U2 WHERE MachineNo = @station;
SELECT @afterQcs = COUNT(*) FROM dbo.rejectQCS1_TP1U2 WHERE MachineNo = @station;

PRINT 'After shaping:';
PRINT '  rows moved from pack1_TP1U2 to rejectQCS1_TP1U2: ' + CAST(@moved AS varchar(20));
PRINT '  pack1_TP1U2 rows for station 7:       ' + CAST(@afterPack AS varchar(20)) + ' (was ' + CAST(@beforePack AS varchar(20)) + ')';
PRINT '  rejectQCS1_TP1U2 rows for station 7:  ' + CAST(@afterQcs AS varchar(20)) + ' (was ' + CAST(@beforeQcs AS varchar(20)) + ')';
GO
