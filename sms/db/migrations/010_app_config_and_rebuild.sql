-- 010_app_config_and_rebuild.sql
-- app_config: true scalar settings only (ARCHITECTURE §5, §15). Entities live in
--   reference tables (006). rebuild_audit: records the snapshot-gated canonical
--   rebuilds after a transform-version change (ARCHITECTURE §13, §18).

IF OBJECT_ID('sms.app_config', 'U') IS NULL
BEGIN
    CREATE TABLE sms.app_config (
        config_key    VARCHAR(64)  NOT NULL CONSTRAINT PK_app_config PRIMARY KEY,
        config_value  NVARCHAR(255) NOT NULL,
        updated_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_cfg_updated DEFAULT SYSUTCDATETIME(),
        updated_by    INT NULL
    );
END
GO

IF OBJECT_ID('sms.rebuild_audit', 'U') IS NULL
BEGIN
    CREATE TABLE sms.rebuild_audit (
        rebuild_id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_rebuild_audit PRIMARY KEY,
        snapshot_id           NVARCHAR(128) NOT NULL,   -- proof the pre-rebuild snapshot was taken (HARD GATE)
        from_transform_version INT NOT NULL,
        to_transform_version  INT NOT NULL,
        target_table          VARCHAR(40) NOT NULL,
        rows_rebuilt          INT NOT NULL CONSTRAINT DF_rebuild_rows DEFAULT 0,
        started_at_utc        DATETIME2(3) NOT NULL CONSTRAINT DF_rebuild_start DEFAULT SYSUTCDATETIME(),
        finished_at_utc       DATETIME2(3) NULL,
        outcome               VARCHAR(12) NOT NULL CONSTRAINT DF_rebuild_outcome DEFAULT 'running',
        initiated_by          INT NULL
    );
END
GO
