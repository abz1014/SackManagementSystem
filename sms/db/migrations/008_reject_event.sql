-- 008_reject_event.sql — unified canonical reject model (ARCHITECTURE §5, SPEC §4).
-- Merges rejectQCS1 (quality) + rejectWeight1 (weight) into one shape.
-- Raw QC codes kept verbatim; meaning resolved via sms.reject_code when Q10 answered.

IF OBJECT_ID('sms.reject_event', 'U') IS NULL
BEGIN
    CREATE TABLE sms.reject_event (
        reject_event_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_reject_event PRIMARY KEY,
        line_id             INT          NOT NULL,
        reject_type         VARCHAR(10)  NOT NULL,   -- 'quality' | 'weight'

        production_ts_utc   DATETIME2(3) NOT NULL,
        production_ts_utc_ms BIGINT      NOT NULL,
        ingest_ts_utc       DATETIME2(3) NULL,

        shift_code          VARCHAR(10)  NOT NULL,
        shift_date          DATE         NOT NULL,
        shift_code_legacy   VARCHAR(10)  NULL,

        hanger_num          INT          NULL,
        source_station      INT          NULL,
        lifter_station      INT          NULL,

        -- raw QC codes (quality rejects); NULL for weight rejects. Meaning pending Q10.
        tube_inspect_code       INT      NULL,
        material_inspect_code   INT      NULL,
        -- weight (weight rejects); NULL for quality rejects. Raw grams.
        weight_g            DECIMAL(10,2) NULL,

        source_system       VARCHAR(20)  NOT NULL,
        source_row_id       BIGINT       NULL,
        raw_id              BIGINT       NULL,
        ingest_run_id       UNIQUEIDENTIFIER NOT NULL,
        ingest_seq          INT          NOT NULL CONSTRAINT DF_reject_ingest_seq DEFAULT 0,
        transform_version   INT          NOT NULL CONSTRAINT DF_reject_tform_ver DEFAULT 1
    );

    CREATE UNIQUE INDEX UX_reject_merge
        ON sms.reject_event (line_id, reject_type, production_ts_utc_ms, hanger_num, ingest_seq);
    CREATE INDEX IX_reject_source
        ON sms.reject_event (line_id, reject_type, source_row_id);
    CREATE INDEX IX_reject_shift_date
        ON sms.reject_event (shift_date, reject_type)
        INCLUDE (tube_inspect_code, material_inspect_code);
END
GO
