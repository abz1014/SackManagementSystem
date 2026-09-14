-- 018_sync_run_line_index.sql
-- Fixes finding H9 (Sep 2026 audit): every query in operations.ts filters
-- sms.sync_run by line_id, and the only existing index (IX_sync_run_recent,
-- migration 002) leads with target_table, so all three ran as full scans.
-- This is the query the Setup screen's Sync Health panel polls every 60s.

-- INCLUDE carries finished_at_utc because the percentile query this index
-- exists for computes DATEDIFF(started_at_utc, finished_at_utc) — without it
-- that query still leaves the index to look the column up per row, which is
-- the scan H9 was about. error_text is deliberately NOT included: it is
-- NVARCHAR(MAX), and including a LOB would copy every stored error blob into
-- an index that a 60s poll reads. The failure lookup that needs error_text is
-- a TOP 1 by primary key order and does not want this index anyway.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('sms.sync_run') AND name = 'IX_sync_run_line_started'
)
BEGIN
    CREATE INDEX IX_sync_run_line_started
        ON sms.sync_run (line_id, started_at_utc DESC)
        INCLUDE (finished_at_utc, target_table, outcome, run_id);
END
GO
