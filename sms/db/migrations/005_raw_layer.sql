-- 005_raw_layer.sql — RAW replay layer (ARCHITECTURE §3).
-- Verbatim copies of the 4 IFL EVENT wide tables. All original columns kept
-- (lean = only these tables, NOT column-pruned). PDAS is NOT mirrored here —
-- it flows into reference tables (006). Append-only; never interpreted.

IF SCHEMA_ID('sms_raw') IS NULL
    EXEC('CREATE SCHEMA sms_raw');
GO

-- sack1_TP1U2 verbatim -------------------------------------------------------
IF OBJECT_ID('sms_raw.sack_raw', 'U') IS NULL
BEGIN
    CREATE TABLE sms_raw.sack_raw (
        raw_id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sack_raw PRIMARY KEY,
        line_id         INT      NOT NULL,
        ingest_run_id   UNIQUEIDENTIFIER NOT NULL,
        read_at_utc     DATETIME2(3) NOT NULL CONSTRAINT DF_sack_raw_read DEFAULT SYSUTCDATETIME(),
        -- verbatim source columns (sack1_TP1U2)
        src_id          INT      NOT NULL,   -- IFL id
        src_Date        DATETIME NULL,
        src_Shift       VARCHAR(8)  NULL,
        src_Area        VARCHAR(10) NULL,
        src_SackNum     INT      NULL,
        src_Weight      DECIMAL(6,3) NULL,
        src_inRange     BIT      NULL
    );
    CREATE UNIQUE INDEX UX_sack_raw_src ON sms_raw.sack_raw (line_id, src_id);
END
GO

-- pack1_TP1U2 verbatim (cones) -----------------------------------------------
IF OBJECT_ID('sms_raw.cone_raw', 'U') IS NULL
BEGIN
    CREATE TABLE sms_raw.cone_raw (
        raw_id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_cone_raw PRIMARY KEY,
        line_id         INT      NOT NULL,
        ingest_run_id   UNIQUEIDENTIFIER NOT NULL,
        read_at_utc     DATETIME2(3) NOT NULL CONSTRAINT DF_cone_raw_read DEFAULT SYSUTCDATETIME(),
        -- verbatim source columns (pack1_TP1U2)
        src_id             INT   NOT NULL,
        src_Date           DATETIME NULL,
        src_Shift          VARCHAR(8)  NULL,
        src_Area           VARCHAR(10) NULL,
        src_ProductionDate DATETIME NULL,
        src_HangerNum      INT   NULL,
        src_Source         INT   NULL,
        src_Lifter         INT   NULL,
        src_Weight         DECIMAL(6,2) NULL,
        src_inRange        BIT   NULL
    );
    CREATE UNIQUE INDEX UX_cone_raw_src ON sms_raw.cone_raw (line_id, src_id);
END
GO

-- rejectQCS1_TP1U2 verbatim --------------------------------------------------
IF OBJECT_ID('sms_raw.reject_qcs_raw', 'U') IS NULL
BEGIN
    CREATE TABLE sms_raw.reject_qcs_raw (
        raw_id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_reject_qcs_raw PRIMARY KEY,
        line_id         INT      NOT NULL,
        ingest_run_id   UNIQUEIDENTIFIER NOT NULL,
        read_at_utc     DATETIME2(3) NOT NULL CONSTRAINT DF_rqcs_raw_read DEFAULT SYSUTCDATETIME(),
        src_id                    INT NOT NULL,
        src_Date                  DATETIME NULL,
        src_Shift                 VARCHAR(8)  NULL,
        src_Area                  VARCHAR(10) NULL,
        src_ProductionDate        DATETIME NULL,
        src_HangerNum             INT NULL,
        src_Source                INT NULL,
        src_Lifter                INT NULL,
        src_TubeInspectResult     INT NULL,
        src_MaterialInspectResult INT NULL
    );
    CREATE UNIQUE INDEX UX_reject_qcs_raw_src ON sms_raw.reject_qcs_raw (line_id, src_id);
END
GO

-- rejectWeight1_TP1U2 verbatim -----------------------------------------------
IF OBJECT_ID('sms_raw.reject_weight_raw', 'U') IS NULL
BEGIN
    CREATE TABLE sms_raw.reject_weight_raw (
        raw_id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_reject_weight_raw PRIMARY KEY,
        line_id         INT      NOT NULL,
        ingest_run_id   UNIQUEIDENTIFIER NOT NULL,
        read_at_utc     DATETIME2(3) NOT NULL CONSTRAINT DF_rw_raw_read DEFAULT SYSUTCDATETIME(),
        src_id             INT NOT NULL,
        src_Date           DATETIME NULL,
        src_Shift          VARCHAR(8)  NULL,
        src_Area           VARCHAR(10) NULL,
        src_ProductionDate DATETIME NULL,
        src_HangerNum      INT NULL,
        src_Source         INT NULL,
        src_Lifter         INT NULL,
        src_Weight         DECIMAL(6,2) NULL
    );
    CREATE UNIQUE INDEX UX_reject_weight_raw_src ON sms_raw.reject_weight_raw (line_id, src_id);
END
GO
