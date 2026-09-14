-- 017_rebuild_audit_failure.sql
-- Fixes finding C1 (Sep 2026 audit): rebuild.ts had no `catch`, so any error
-- after the canonical DELETE left the row's outcome stuck at the default
-- 'running' forever, indistinguishable from a rebuild still in progress.
-- Adds a place to record what went wrong so a failed run is visible as failed.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.rebuild_audit') AND name = 'error_message'
)
BEGIN
    ALTER TABLE sms.rebuild_audit ADD error_message NVARCHAR(2000) NULL;
END
GO
