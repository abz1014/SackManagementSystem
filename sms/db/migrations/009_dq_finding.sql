-- 009_dq_finding.sql — data-quality findings with severity (ARCHITECTURE §8).
-- Written by the pipeline; surfaced on the Operations screen as a roll-up.

IF OBJECT_ID('sms.dq_finding', 'U') IS NULL
BEGIN
    CREATE TABLE sms.dq_finding (
        finding_id      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_dq_finding PRIMARY KEY,
        run_id          UNIQUEIDENTIFIER NOT NULL,
        check_name      VARCHAR(64)  NOT NULL,   -- 'future_timestamp' | 'impossible_weight' | 'attribution_gap' | ...
        severity        VARCHAR(10)  NOT NULL,   -- INFO | WARNING | ERROR | CRITICAL
        subject_table   VARCHAR(40)  NULL,       -- e.g. 'cone_event'
        subject_ref     BIGINT       NULL,       -- offending row id, if applicable
        detail          NVARCHAR(500) NULL,
        detected_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_dq_detected DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_dq_recent   ON sms.dq_finding (detected_at_utc DESC);
    CREATE INDEX IX_dq_severity ON sms.dq_finding (severity, detected_at_utc DESC);

    ALTER TABLE sms.dq_finding
        ADD CONSTRAINT CK_dq_severity
        CHECK (severity IN ('INFO','WARNING','ERROR','CRITICAL'));
END
GO
