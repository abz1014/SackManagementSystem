-- 022_schema_migration_history.sql
-- Fixes finding M2 (Sep 2026 audit): documents, for the sqlcmd path, the
-- history table scripts/migrate.mjs also creates for itself at startup (it
-- must exist before that script can record anything, including this file).
-- Applying this file by hand via sqlcmd is a no-op if migrate.mjs already
-- created it, and vice versa.

IF SCHEMA_ID('sms') IS NULL
    EXEC('CREATE SCHEMA sms');
GO

IF OBJECT_ID('sms.schema_migration', 'U') IS NULL
BEGIN
    CREATE TABLE sms.schema_migration (
        filename       VARCHAR(255) NOT NULL CONSTRAINT PK_schema_migration PRIMARY KEY,
        applied_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_schema_migration_applied DEFAULT SYSUTCDATETIME()
    );
END
GO
