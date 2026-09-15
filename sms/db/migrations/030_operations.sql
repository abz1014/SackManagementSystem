-- 030_operations.sql — Roadmap Phase 11 (security, reliability and operations),
-- 14 Sep 2026. Two objects.
--
-- 1. sms.audit_log becomes append-only AT THE DATABASE. Migration 014 called
--    the table "append-only by construction: nothing in this codebase ever
--    UPDATEs or DELETEs a row here" — a statement about the code, enforced by
--    nothing. An INSTEAD OF trigger that THROWs on UPDATE and DELETE makes the
--    database refuse, whatever the code (or an operator in SSMS with the app
--    login) tries.
--
--    WHAT THIS IS NOT. The application's own login, sms_app, holds db_ddladmin
--    (db/bootstrap/00_create_app_database.sql grants it so `npm run db:migrate`
--    can run as sms_app). db_ddladmin can DROP this trigger, so a tampering
--    party holding that login can remove the guard, delete the rows, and
--    recreate the guard. This trigger stops accidents and ordinary misuse; it
--    is not tamper-evidence. Real tamper-evidence needs the migration login
--    split DEPLOY.md's credentials table describes: run migrations as a
--    separate login holding db_ddladmin, and take db_ddladmin away from
--    sms_app, so the process that serves requests cannot alter the schema
--    that audits it. That split is documented, not applied here — it changes
--    the bootstrap script and the deployment procedure, which is an
--    operator's decision at install time, not a migration's.
--
--    The message names the command that would legitimately need to delete
--    (none: retention never touches this table, and says so).
--
-- 2. sms.session gains an index on expires_at_utc. `sms retention` and the
--    login route's opportunistic prune both run
--    `DELETE FROM sms.session WHERE expires_at_utc <= SYSUTCDATETIME()`,
--    and the only index (IX_session_user, migration 011) leads with user_id,
--    so that DELETE scanned the table. Small today; the point is that it
--    stays small because the prune is cheap enough to run every time.
--
-- Idempotent: safe to re-run.

IF OBJECT_ID('sms.TR_audit_log_append_only', 'TR') IS NULL
BEGIN
    EXEC('
    CREATE TRIGGER sms.TR_audit_log_append_only
        ON sms.audit_log
        INSTEAD OF UPDATE, DELETE
    AS
    BEGIN
        SET NOCOUNT ON;
        -- THROW takes a literal or a variable, never an expression.
        DECLARE @m NVARCHAR(400) = N''sms.audit_log is append-only: rows are never updated or deleted (migration 030). Retention does not touch this table by design. If you are reading this in SSMS, stop.'';
        THROW 50030, @m, 1;
    END');
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('sms.session') AND name = 'IX_session_expires'
)
BEGIN
    CREATE INDEX IX_session_expires ON sms.session (expires_at_utc);
END
GO
