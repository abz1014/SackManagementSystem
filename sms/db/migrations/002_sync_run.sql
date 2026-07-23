-- 002_sync_run.sql — audit log for every sync pass (ARCHITECTURE §3).
-- One row per (adapter, table) run: watermark, counts, timing, outcome.

IF OBJECT_ID('sms.sync_run', 'U') IS NULL
BEGIN
    CREATE TABLE sms.sync_run (
        sync_run_id     BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_sync_run PRIMARY KEY,
        run_id          UNIQUEIDENTIFIER NOT NULL,      -- groups tables in one pass
        adapter         VARCHAR(20)  NOT NULL,          -- 'ifl_sql' | 'plc_direct'
        target_table    VARCHAR(40)  NOT NULL,          -- 'cone_event' | 'sack_event' | ...
        line_id         INT          NOT NULL,
        watermark_from  BIGINT       NULL,              -- source id we started after
        watermark_to    BIGINT       NULL,              -- source id we reached
        rows_read       INT          NOT NULL CONSTRAINT DF_sync_run_read    DEFAULT 0,
        rows_written    INT          NOT NULL CONSTRAINT DF_sync_run_written DEFAULT 0,
        started_at_utc  DATETIME2(3) NOT NULL CONSTRAINT DF_sync_run_start   DEFAULT SYSUTCDATETIME(),
        finished_at_utc DATETIME2(3) NULL,
        outcome         VARCHAR(12)  NOT NULL CONSTRAINT DF_sync_run_outcome DEFAULT 'running',
                                                        -- 'running' | 'success' | 'failed'
        error_text      NVARCHAR(MAX) NULL
    );

    CREATE INDEX IX_sync_run_recent
        ON sms.sync_run (target_table, started_at_utc DESC);
END
GO
