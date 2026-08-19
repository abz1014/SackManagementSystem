-- 014_audit_log.sql — a single cross-cutting log of every admin/config write,
-- independent of the versioned rule tables (weight_rule, shift_rule,
-- plausibility_rule, product_timeline) that already carry their own
-- changed_by/changed_at/reason. Those answer "what is the history of this one
-- setting"; this answers "what has this person done, across the whole app" —
-- a question no single existing table can answer, and one a plant admin needs
-- to be able to ask.
--
-- Before this: createUser, updateUser (role/active changes) and setStation
-- wrote silently with no actor recorded at all. setRejectLabel was worse — a
-- destructive UPDATE with no history of any kind, the one place in this
-- codebase that broke its own "versioned, never destructive" convention. The
-- old value now lives in this table's detail column instead of nowhere.
--
-- Append-only by construction: nothing in this codebase ever UPDATEs or
-- DELETEs a row here.
IF OBJECT_ID('sms.audit_log', 'U') IS NULL
BEGIN
    CREATE TABLE sms.audit_log (
        audit_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_log PRIMARY KEY,
        at_utc       DATETIME2(3) NOT NULL CONSTRAINT DF_audit_log_at DEFAULT SYSUTCDATETIME(),
        actor_id     INT NULL CONSTRAINT FK_audit_log_actor REFERENCES sms.app_user(user_id),
        action       VARCHAR(40) NOT NULL,   -- e.g. 'user.create', 'station.rename', 'reject_code.label'
        target_type  VARCHAR(40) NOT NULL,   -- e.g. 'user', 'station', 'reject_code'
        target_id    NVARCHAR(64) NULL,      -- the affected row's own key, as text (ids vary in type)
        detail       NVARCHAR(1000) NULL     -- plain-language "old -> new"; not a diff format, meant to be read
    );
    CREATE INDEX IX_audit_log_at ON sms.audit_log (at_utc DESC);
END
GO
