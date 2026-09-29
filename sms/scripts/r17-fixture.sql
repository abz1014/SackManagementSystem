-- scripts/r17-fixture.sql — R-17 fixture: a SCRATCH source database shaped
-- like IFL's JULY tables (Task W2-D, 29 Sep 2026).
--
-- WHY THIS EXISTS. `sms epoch:backfill` (W1-A, backfill.ts/backfill.ts) loads a
-- historic archive into an already-CLOSED epoch. Proving that end to end needs
-- something that LOOKS like the archive IFL has not yet sent (10 Jul - 5 Aug
-- 2026, the gap between the July sample and the September rebuild) — same four
-- wide tables, same JULY column shape (a `Source` column, no `MaterialId` — see
-- sync-worker/src/reader/iflTables.ts's JULY_TABLE_SHAPES), but built entirely
-- from data already on this machine. This script builds that stand-in.
--
-- WHAT IT BUILDS, in the CURRENT database (see SAFETY below):
--   dbo.pack1_TP1U2, dbo.sack1_TP1U2, dbo.rejectQCS1_TP1U2, dbo.rejectWeight1_TP1U2
-- shaped exactly as SCHEMA.md section 2.1 describes the July tables (dropped
-- and rebuilt if they already exist in this scratch DB — it IS the scratch DB,
-- see SAFETY):
--   pack1_TP1U2          id, Date, Shift, Area, ProductionDate, HangerNum,
--                        Source, Lifter, Weight decimal(6,2), inRange
--   sack1_TP1U2          id, Date, Shift, Area, SackNum, Weight decimal(6,3),
--                        inRange   (no ProductionDate, no Source — SCHEMA.md
--                        never carried either on this table, July or September)
--   rejectQCS1_TP1U2     id, Date, Shift, Area, ProductionDate, HangerNum,
--                        Source, Lifter, TubeInspectResult, MaterialInspectResult
--   rejectWeight1_TP1U2  id, Date, Shift, Area, ProductionDate, HangerNum,
--                        Source, Lifter, Weight decimal(6,2)
--
-- TWO KINDS OF ROW, per table:
--
--   1. HISTORICAL (ids 1..max of the generation) — reconstructed VERBATIM from
--      a restored SCRATCH copy of the `sms` app database's own raw layer: the
--      four rows of `sms.source_epoch` the July generation already occupies
--      (epoch_id 1=pack1_TP1U2, 2=sack1_TP1U2, 3=rejectQCS1_TP1U2,
--      4=rejectWeight1_TP1U2 — the fixed insertion order
--      scripts/seed-dev-epochs.sql uses on every fresh database; verified
--      below before trusting it, not assumed blind), and the matching
--      `sms_raw.<kind>_raw` rows for each. `src_MachineNo` is read back out
--      under its ORIGINAL July name, `Source` (the September rename,
--      migration 024, is undone here on the way out — sms_raw itself is
--      never touched). `src_MaterialId` has no July column to land in and is
--      dropped, honestly: these rows predate product attribution, same as
--      they do everywhere else in this app.
--
--      This is what makes it a JULY fixture and not an invented one: the
--      historical rows are real cones/sacks/rejects this project already
--      holds, merely re-shaped back into the table they originally came from.
--
--   2. SYNTHETIC TAIL (ids continuing past each table's historical max) —
--      about 2,000 rows across the four tables (roughly in the same
--      cone-heavy proportion the real data shows: ~1,400 cones, ~400 sacks,
--      ~150 quality rejects, ~50 weight rejects), dated 2026-07-10 through
--      2026-08-04 — the exact 25-day span between the July sample's last row
--      and the September rebuild, i.e. what a real 10 Jul - 5 Aug send from
--      IFL would need to fill. `Source`/machine cycles 1..14 (SCHEMA.md's
--      observed range); weights are drawn around the same means SCHEMA.md
--      measured (cones ~1950 g, sacks ~47.22 kg, weight rejects ~2010 g);
--      `inRange` is mostly 1, flipped to 0 at roughly the real out-of-range
--      rate. THESE ROWS NEVER HAPPENED — they exist only to give
--      `epoch:backfill` an id range past the historical max to load, and to
--      give this fixture's own row counts a plausible shape. Never present
--      them as real production data.
--
-- USAGE. The target scratch database must already exist and be EMPTY of these
-- four tables (created by the caller — this script only fills it in, per its
-- own safety rule below, it never CREATEs or DROPs a database):
--
--   sqlcmd -E -S <server> -d R17_SRC \
--     -v SMS_SCRATCH="SMS_SCRATCH_R17" -v TAMPER="0" \
--     -i scripts/r17-fixture.sql
--
-- TAMPER=1 builds the "one overlap row altered" variant, meant for a SEPARATE
-- database named so it reads as what it is (R17_SRC_TAMPERED is the suggested
-- name; the guard only requires the R17_ prefix, it does not enforce this
-- exact name):
--
--   sqlcmd -E -S <server> -d R17_SRC_TAMPERED \
--     -v SMS_SCRATCH="SMS_SCRATCH_R17" -v TAMPER="1" \
--     -i scripts/r17-fixture.sql
--
-- What TAMPER does: after the historical rows load, it changes the WEIGHT of
-- the single highest-id HISTORICAL (i.e. overlap-range, not synthetic-tail)
-- row of pack1_TP1U2 by +500 g. The row's `id` is left untouched on purpose —
-- an id/count/SUM(id) checksum (what `sms verify --source-db` runs today,
-- 29 Sep 2026) will NOT catch this; it exists to exercise a WEIGHT-level
-- reconciliation (`sms verify --weights`, once one exists for a backfilled
-- epoch) against a source that silently disagrees on one value while every id
-- still lines up. Use R17_SRC for a source that should reconcile clean, and
-- R17_SRC_TAMPERED for one that should not — never the same database for both
-- in the same test run.
--
-- SAFETY (do not weaken these — this script runs DDL/DML and the only thing
-- standing between it and a real database is the two checks below):
--   1. Refuses unless DB_NAME() (the database sqlcmd -d connected to) starts
--      with 'R17_'. This script creates and drops tables named exactly like
--      IFL's own wide tables — it must never be pointed at DATA_TP1U2,
--      DATA_TP1U2_SEP07, PDAS_TP1U2, PDAS_TP1U2_SEP07, or the live/dev `sms`
--      app database.
--   2. Refuses unless $(SMS_SCRATCH) starts with 'SMS_SCRATCH_'. This is the
--      ONLY other database this script reads from (via a three-part name),
--      and it must be a restored SCRATCH copy of `sms`, never the real `sms`
--      database and never either IFL database.
-- Both checks run before any DDL, and use `SET NOEXEC ON` (not RAISERROR
-- severity 20 / connection kill) so a refusal is a clean, reportable exit
-- rather than a dropped connection — sqlcmd still parses every later batch,
-- it just does not execute any of them.
--
-- NEVER RUN THIS AGAINST A REAL DATABASE. This copy of the script has not
-- been executed as part of Task W2-D — only parsed (SET PARSEONLY ON) to
-- confirm it is syntactically valid T-SQL. It is meant to run later, by hand,
-- against a scratch database created for exactly this purpose.

-- ---------------------------------------------------------------------------
-- SAFETY GUARD 1 — the CURRENT database (DB_NAME()) must be a scratch R17_ db.
-- ---------------------------------------------------------------------------
DECLARE @r17_currentDb sysname = DB_NAME();
IF @r17_currentDb NOT LIKE 'R17[_]%'
BEGIN
    RAISERROR('r17-fixture.sql refuses to run: the current database is "%s", which does not start with R17_. This script builds tables named exactly like IFL''s own (pack1_TP1U2, sack1_TP1U2, rejectQCS1_TP1U2, rejectWeight1_TP1U2) and must only ever run against a scratch database made for this fixture. Connect with sqlcmd -d R17_SRC (or a name of your own starting R17_) to a database you created for this purpose, and try again.', 16, 1, @r17_currentDb) WITH NOWAIT;
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- SAFETY GUARD 2 — the SOURCE database ($(SMS_SCRATCH)) must be a scratch
-- restore of `sms`, named SMS_SCRATCH_*, never the real app DB or either IFL
-- database. sqlcmd substitutes $(SMS_SCRATCH) as literal text, including
-- inside this string, before the batch is sent to the server.
-- ---------------------------------------------------------------------------
IF N'$(SMS_SCRATCH)' NOT LIKE N'SMS_SCRATCH[_]%'
BEGIN
    RAISERROR('r17-fixture.sql refuses to run: -v SMS_SCRATCH="%s" does not start with SMS_SCRATCH_. This script reads sms_raw rows from that database by name and must only ever be pointed at a scratch restore of the sms app database, never the live/dev sms database and never DATA_TP1U2, DATA_TP1U2_SEP07 or any PDAS database. Pass -v SMS_SCRATCH="SMS_SCRATCH_<something>" naming a restore you made for this purpose.', 16, 1, N'$(SMS_SCRATCH)') WITH NOWAIT;
    SET NOEXEC ON;
END
GO

-- Defence in depth: even a name that happens to start with the right prefix
-- must not be one of the real databases by exact match (a typo'd -v could
-- still collide in theory; belt and braces, same spirit as verify.ts's
-- assertSafeDefs point-of-use check).
IF N'$(SMS_SCRATCH)' IN (N'sms', N'DATA_TP1U2', N'DATA_TP1U2_SEP07', N'PDAS_TP1U2', N'PDAS_TP1U2_SEP07')
BEGIN
    RAISERROR('r17-fixture.sql refuses to run: -v SMS_SCRATCH="%s" is the exact name of a real database this project must never write near. Refusing.', 16, 1, N'$(SMS_SCRATCH)') WITH NOWAIT;
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- SAFETY GUARD 3 — the July epoch_id -> table mapping this script assumes
-- (1=pack1_TP1U2, 2=sack1_TP1U2, 3=rejectQCS1_TP1U2, 4=rejectWeight1_TP1U2,
-- from scripts/seed-dev-epochs.sql's fixed INSERT order on a fresh database)
-- must actually hold in $(SMS_SCRATCH) before anything is read from it.
-- Refusing to guess beats silently rebuilding the wrong generation.
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM [$(SMS_SCRATCH)].sms.source_epoch WHERE epoch_id = 1 AND source_table = 'pack1_TP1U2')
   OR NOT EXISTS (SELECT 1 FROM [$(SMS_SCRATCH)].sms.source_epoch WHERE epoch_id = 2 AND source_table = 'sack1_TP1U2')
   OR NOT EXISTS (SELECT 1 FROM [$(SMS_SCRATCH)].sms.source_epoch WHERE epoch_id = 3 AND source_table = 'rejectQCS1_TP1U2')
   OR NOT EXISTS (SELECT 1 FROM [$(SMS_SCRATCH)].sms.source_epoch WHERE epoch_id = 4 AND source_table = 'rejectWeight1_TP1U2')
BEGIN
    RAISERROR('r17-fixture.sql refuses to run: [$(SMS_SCRATCH)].sms.source_epoch does not have the expected July epoch_id -> table mapping (1=pack1_TP1U2, 2=sack1_TP1U2, 3=rejectQCS1_TP1U2, 4=rejectWeight1_TP1U2). This scratch copy''s epochs were not seeded the way scripts/seed-dev-epochs.sql seeds a fresh database — check its sms.source_epoch table by hand before adapting this script''s epoch_id literals.', 16, 1) WITH NOWAIT;
    SET NOEXEC ON;
END
GO

-- ===========================================================================
-- pack1_TP1U2 (cones) — July shape, epoch 1
-- ===========================================================================
IF OBJECT_ID('dbo.pack1_TP1U2', 'U') IS NOT NULL DROP TABLE dbo.pack1_TP1U2;
GO
CREATE TABLE dbo.pack1_TP1U2 (
    id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_r17_pack1 PRIMARY KEY,
    [Date]         DATETIME     NULL,
    Shift          VARCHAR(8)   NULL,
    Area           VARCHAR(10)  NULL,
    ProductionDate DATETIME     NULL,
    HangerNum      INT          NULL,
    Source         INT          NULL,
    Lifter         INT          NULL,
    Weight         DECIMAL(6,2) NULL,
    inRange        BIT          NULL
);
GO

-- historical: verbatim from the restored raw layer, epoch 1
SET IDENTITY_INSERT dbo.pack1_TP1U2 ON;
INSERT INTO dbo.pack1_TP1U2 (id, [Date], Shift, Area, ProductionDate, HangerNum, Source, Lifter, Weight, inRange)
SELECT src_id, src_Date, src_Shift, src_Area, src_ProductionDate, src_HangerNum, src_MachineNo, src_Lifter, src_Weight, src_inRange
  FROM [$(SMS_SCRATCH)].sms_raw.cone_raw
 WHERE line_id = 1 AND source_epoch = 1
 ORDER BY src_id;
SET IDENTITY_INSERT dbo.pack1_TP1U2 OFF;
GO

-- synthetic tail: ~1,400 rows, 2026-07-10 .. 2026-08-04, never really happened
INSERT INTO dbo.pack1_TP1U2 ([Date], Shift, Area, ProductionDate, HangerNum, Source, Lifter, Weight, inRange)
SELECT
    DATEADD(SECOND, 4 * n.rn, pd),                                            -- Date: insert lag ~4h after ProductionDate, same as the real ~3.8h average
    CASE WHEN DATEPART(HOUR, pd) BETWEEN 6 AND 13 THEN 'Morning'
         WHEN DATEPART(HOUR, pd) BETWEEN 14 AND 21 THEN 'Evening'
         ELSE 'Night' END,
    'Package-1',
    pd,
    (n.rn % 299) + 1,
    ((n.rn - 1) % 14) + 1,
    ((n.rn - 1) % 14) + 1,                                                    -- Lifter almost always = Source (DQ-7)
    CAST(1950 + ((n.rn * 37) % 61) - 30 AS DECIMAL(6,2)),                     -- ~1920..1980g around the real 1951.5g mean
    CASE WHEN n.rn % 340 = 0 THEN 0 ELSE 1 END                                -- ~0.3% out of range, matching the real 0.29%
  FROM (
        SELECT TOP (1400) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn
          FROM sys.all_objects a CROSS JOIN sys.all_objects b
       ) n
 CROSS APPLY (SELECT DATEADD(SECOND, (n.rn - 1) * (25 * 86400 / 1400), CONVERT(DATETIME, '2026-07-10 12:00:00')) AS pd) t(pd);
GO

-- ===========================================================================
-- sack1_TP1U2 — July shape, epoch 2. No ProductionDate, no Source — never had
-- either, July or September (SCHEMA.md 2.1).
-- ===========================================================================
IF OBJECT_ID('dbo.sack1_TP1U2', 'U') IS NOT NULL DROP TABLE dbo.sack1_TP1U2;
GO
CREATE TABLE dbo.sack1_TP1U2 (
    id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_r17_sack1 PRIMARY KEY,
    [Date]   DATETIME     NULL,
    Shift    VARCHAR(8)   NULL,
    Area     VARCHAR(10)  NULL,
    SackNum  INT          NULL,
    Weight   DECIMAL(6,3) NULL,
    inRange  BIT          NULL
);
GO

SET IDENTITY_INSERT dbo.sack1_TP1U2 ON;
INSERT INTO dbo.sack1_TP1U2 (id, [Date], Shift, Area, SackNum, Weight, inRange)
SELECT src_id, src_Date, src_Shift, src_Area, src_SackNum, src_Weight, src_inRange
  FROM [$(SMS_SCRATCH)].sms_raw.sack_raw
 WHERE line_id = 1 AND source_epoch = 2
 ORDER BY src_id;
SET IDENTITY_INSERT dbo.sack1_TP1U2 OFF;
GO

-- synthetic tail: ~400 rows. sack1 has no ProductionDate/Source of its own —
-- `Date` is set directly into the 2026-07-10..2026-08-04 window rather than
-- offset from a production time that does not exist on this table.
INSERT INTO dbo.sack1_TP1U2 ([Date], Shift, Area, SackNum, Weight, inRange)
SELECT
    dt,
    CASE WHEN DATEPART(HOUR, dt) BETWEEN 6 AND 13 THEN 'Morning'
         WHEN DATEPART(HOUR, dt) BETWEEN 14 AND 21 THEN 'Evening'
         ELSE 'Night' END,
    'Sack-1',
    n.rn,
    CAST(47.22 + (((n.rn * 13) % 200) / 100.0) - 1.0 AS DECIMAL(6,3)),        -- ~46.2..48.2 kg around the real 47.22 kg mean
    CASE WHEN n.rn % 24 = 0 THEN 0 ELSE 1 END                                 -- ~4.2% out of range, matching the real 4.23%
  FROM (
        SELECT TOP (400) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn
          FROM sys.all_objects a CROSS JOIN sys.all_objects b
       ) n
 CROSS APPLY (SELECT DATEADD(SECOND, (n.rn - 1) * (25 * 86400 / 400), CONVERT(DATETIME, '2026-07-10 12:00:00')) AS dt) t(dt);
GO

-- ===========================================================================
-- rejectQCS1_TP1U2 — July shape, epoch 3
-- ===========================================================================
IF OBJECT_ID('dbo.rejectQCS1_TP1U2', 'U') IS NOT NULL DROP TABLE dbo.rejectQCS1_TP1U2;
GO
CREATE TABLE dbo.rejectQCS1_TP1U2 (
    id                    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_r17_rqcs1 PRIMARY KEY,
    [Date]                DATETIME    NULL,
    Shift                 VARCHAR(8)  NULL,
    Area                  VARCHAR(10) NULL,
    ProductionDate        DATETIME    NULL,
    HangerNum             INT         NULL,
    Source                INT         NULL,
    Lifter                INT         NULL,
    TubeInspectResult     INT         NULL,
    MaterialInspectResult INT         NULL
);
GO

SET IDENTITY_INSERT dbo.rejectQCS1_TP1U2 ON;
INSERT INTO dbo.rejectQCS1_TP1U2 (id, [Date], Shift, Area, ProductionDate, HangerNum, Source, Lifter, TubeInspectResult, MaterialInspectResult)
SELECT src_id, src_Date, src_Shift, src_Area, src_ProductionDate, src_HangerNum, src_MachineNo, src_Lifter, src_TubeInspectResult, src_MaterialInspectResult
  FROM [$(SMS_SCRATCH)].sms_raw.reject_qcs_raw
 WHERE line_id = 1 AND source_epoch = 3
 ORDER BY src_id;
SET IDENTITY_INSERT dbo.rejectQCS1_TP1U2 OFF;
GO

-- synthetic tail: ~150 rows. (Tube, Material) code pairs cycle through the
-- five real pairs SCHEMA.md observed, in roughly their real frequency order.
INSERT INTO dbo.rejectQCS1_TP1U2 ([Date], Shift, Area, ProductionDate, HangerNum, Source, Lifter, TubeInspectResult, MaterialInspectResult)
SELECT
    DATEADD(SECOND, 4 * n.rn, pd),
    CASE WHEN DATEPART(HOUR, pd) BETWEEN 6 AND 13 THEN 'Morning'
         WHEN DATEPART(HOUR, pd) BETWEEN 14 AND 21 THEN 'Evening'
         ELSE 'Night' END,
    'Package-1',
    pd,
    (n.rn % 299) + 1,
    ((n.rn - 1) % 14) + 1,
    ((n.rn - 1) % 14) + 1,
    CASE (n.rn % 5) WHEN 0 THEN 10 WHEN 1 THEN 2 WHEN 2 THEN 1 WHEN 3 THEN 1 ELSE 9 END,
    CASE (n.rn % 5) WHEN 2 THEN 2 ELSE 1 END
  FROM (
        SELECT TOP (150) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn
          FROM sys.all_objects a CROSS JOIN sys.all_objects b
       ) n
 CROSS APPLY (SELECT DATEADD(SECOND, (n.rn - 1) * (25 * 86400 / 150), CONVERT(DATETIME, '2026-07-10 12:00:00')) AS pd) t(pd);
GO

-- ===========================================================================
-- rejectWeight1_TP1U2 — July shape, epoch 4
-- ===========================================================================
IF OBJECT_ID('dbo.rejectWeight1_TP1U2', 'U') IS NOT NULL DROP TABLE dbo.rejectWeight1_TP1U2;
GO
CREATE TABLE dbo.rejectWeight1_TP1U2 (
    id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_r17_rw1 PRIMARY KEY,
    [Date]         DATETIME     NULL,
    Shift          VARCHAR(8)   NULL,
    Area           VARCHAR(10)  NULL,
    ProductionDate DATETIME     NULL,
    HangerNum      INT          NULL,
    Source         INT          NULL,
    Lifter         INT          NULL,
    Weight         DECIMAL(6,2) NULL
);
GO

SET IDENTITY_INSERT dbo.rejectWeight1_TP1U2 ON;
INSERT INTO dbo.rejectWeight1_TP1U2 (id, [Date], Shift, Area, ProductionDate, HangerNum, Source, Lifter, Weight)
SELECT src_id, src_Date, src_Shift, src_Area, src_ProductionDate, src_HangerNum, src_MachineNo, src_Lifter, src_Weight
  FROM [$(SMS_SCRATCH)].sms_raw.reject_weight_raw
 WHERE line_id = 1 AND source_epoch = 4
 ORDER BY src_id;
SET IDENTITY_INSERT dbo.rejectWeight1_TP1U2 OFF;
GO

-- synthetic tail: ~50 rows, weights spread around the real 2010g reject mean.
INSERT INTO dbo.rejectWeight1_TP1U2 ([Date], Shift, Area, ProductionDate, HangerNum, Source, Lifter, Weight)
SELECT
    DATEADD(SECOND, 4 * n.rn, pd),
    CASE WHEN DATEPART(HOUR, pd) BETWEEN 6 AND 13 THEN 'Morning'
         WHEN DATEPART(HOUR, pd) BETWEEN 14 AND 21 THEN 'Evening'
         ELSE 'Night' END,
    'Package-1',
    pd,
    (n.rn % 299) + 1,
    ((n.rn - 1) % 14) + 1,
    ((n.rn - 1) % 14) + 1,
    CAST(2010 + ((n.rn * 41) % 341) - 170 AS DECIMAL(6,2))                    -- ~1840..2180g around the real 2010g reject mean
  FROM (
        SELECT TOP (50) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn
          FROM sys.all_objects a CROSS JOIN sys.all_objects b
       ) n
 CROSS APPLY (SELECT DATEADD(SECOND, (n.rn - 1) * (25 * 86400 / 50), CONVERT(DATETIME, '2026-07-10 12:00:00')) AS pd) t(pd);
GO

-- ===========================================================================
-- TAMPER=1 — alter one OVERLAP-range row so a source-vs-backfill comparison
-- that only checks id/count/SUM(id) will NOT catch it, but a weight-level one
-- would. See the header comment for the full rationale.
-- ===========================================================================
IF N'$(TAMPER)' = N'1'
BEGIN
    DECLARE @tamperId INT = (
        SELECT MAX(id) FROM dbo.pack1_TP1U2
         WHERE id <= (SELECT MAX(src_id) FROM [$(SMS_SCRATCH)].sms_raw.cone_raw WHERE line_id = 1 AND source_epoch = 1)
    );
    IF @tamperId IS NOT NULL
    BEGIN
        UPDATE dbo.pack1_TP1U2
           SET Weight = Weight + 500.00
         WHERE id = @tamperId;
        PRINT 'TAMPER=1: pack1_TP1U2.id = ' + CAST(@tamperId AS VARCHAR(20)) + ' Weight altered by +500g (id/count/SUM(id) unchanged).';
    END
    ELSE
    BEGIN
        PRINT 'TAMPER=1: no historical row found in pack1_TP1U2 to alter (epoch 1 had zero rows in $(SMS_SCRATCH)) — nothing tampered.';
    END
END
GO

-- ===========================================================================
-- Summary — printed, not asserted. A human (or a later automated check)
-- reads this before trusting the fixture.
-- ===========================================================================
SELECT 'pack1_TP1U2'         AS [table], COUNT(*) AS rows, MIN(id) AS min_id, MAX(id) AS max_id, SUM(CAST(id AS BIGINT)) AS id_sum FROM dbo.pack1_TP1U2
UNION ALL
SELECT 'sack1_TP1U2',                   COUNT(*), MIN(id), MAX(id), SUM(CAST(id AS BIGINT)) FROM dbo.sack1_TP1U2
UNION ALL
SELECT 'rejectQCS1_TP1U2',              COUNT(*), MIN(id), MAX(id), SUM(CAST(id AS BIGINT)) FROM dbo.rejectQCS1_TP1U2
UNION ALL
SELECT 'rejectWeight1_TP1U2',           COUNT(*), MIN(id), MAX(id), SUM(CAST(id AS BIGINT)) FROM dbo.rejectWeight1_TP1U2;
GO
