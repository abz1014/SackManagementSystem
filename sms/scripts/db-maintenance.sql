-- db-maintenance.sql — weekly maintenance of the APP database (roadmap Phase 11
-- item 6, 14 Sep 2026). Plain T-SQL, no parameters: run it as a login holding
-- db_owner on [sms] (NOT sms_app — the runtime login has no reason to hold
-- that, and CHECKDB / ALTER INDEX need more than db_ddladmin). Never against
-- IFL's databases: this file names [sms] and nothing else.
--
--   sqlcmd -S .\SQLEXPRESS -E -d sms -i scripts\db-maintenance.sql -b
--
-- scripts\install-scheduled-tasks.ps1 registers it weekly. Three steps, each
-- a defect the gap analysis named ("no CHECKDB, statistics, ... or size
-- monitoring"):
--
--   1. DBCC CHECKDB WITH NO_INFOMSGS — corruption is found on the night it
--      happens, not the day a screen fails. Takes seconds at this size; the
--      -b flag above makes sqlcmd exit non-zero on an error, so a scheduled
--      task shows red.
--   2. Index maintenance by measured fragmentation: REORGANIZE above 10 %,
--      REBUILD above 30 % (Microsoft's own thresholds), skipping anything
--      under 1,000 pages where fragmentation does not matter. ONLINE rebuild
--      is an Enterprise feature; on Express the rebuild takes a brief lock,
--      which is why this runs weekly at 03:00, between the nightly backup and
--      the morning shift.
--   3. UPDATE STATISTICS — the sync worker appends ~8,000 rows a day and the
--      auto-update threshold on a 275k-row table is far above that, so the
--      planner's picture of cone_event can lag a week behind the data.
--
-- The size check is not here: the worker does it hourly (housekeeping.ts,
-- `database_size` finding) and the Health screen shows it.

SET NOCOUNT ON;
USE [sms];

-- 1. Integrity ----------------------------------------------------------------
PRINT CONCAT(CONVERT(varchar(19), SYSUTCDATETIME(), 120), ' CHECKDB starting');
DBCC CHECKDB ([sms]) WITH NO_INFOMSGS, ALL_ERRORMSGS;
PRINT CONCAT(CONVERT(varchar(19), SYSUTCDATETIME(), 120), ' CHECKDB done');

-- 2. Indexes by fragmentation ---------------------------------------------------
DECLARE @schema sysname, @table sysname, @index sysname, @frag float, @pages bigint, @sql nvarchar(max);

DECLARE idx CURSOR LOCAL FAST_FORWARD FOR
    SELECT s.name, t.name, i.name, ps.avg_fragmentation_in_percent, ps.page_count
      FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ps
      JOIN sys.indexes i ON i.object_id = ps.object_id AND i.index_id = ps.index_id
      JOIN sys.tables  t ON t.object_id = i.object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
     WHERE i.name IS NOT NULL            -- heaps have no index to maintain
       AND ps.index_level = 0
       AND ps.page_count >= 1000
       AND ps.avg_fragmentation_in_percent > 10
       AND s.name IN ('sms', 'sms_raw');

OPEN idx;
FETCH NEXT FROM idx INTO @schema, @table, @index, @frag, @pages;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF @frag > 30
        SET @sql = N'ALTER INDEX ' + QUOTENAME(@index) + N' ON ' + QUOTENAME(@schema) + N'.' + QUOTENAME(@table) + N' REBUILD;';
    ELSE
        SET @sql = N'ALTER INDEX ' + QUOTENAME(@index) + N' ON ' + QUOTENAME(@schema) + N'.' + QUOTENAME(@table) + N' REORGANIZE;';
    PRINT CONCAT(CONVERT(varchar(19), SYSUTCDATETIME(), 120), ' ', @sql, '  -- ', CAST(ROUND(@frag, 1) AS varchar(10)), ' %, ', @pages, ' pages');
    EXEC sp_executesql @sql;
    FETCH NEXT FROM idx INTO @schema, @table, @index, @frag, @pages;
END
CLOSE idx;
DEALLOCATE idx;

-- 3. Statistics -----------------------------------------------------------------
PRINT CONCAT(CONVERT(varchar(19), SYSUTCDATETIME(), 120), ' UPDATE STATISTICS starting');
EXEC sp_updatestats;
PRINT CONCAT(CONVERT(varchar(19), SYSUTCDATETIME(), 120), ' maintenance done');
