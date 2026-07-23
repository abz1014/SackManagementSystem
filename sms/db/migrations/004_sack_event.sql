-- 004_sack_event.sql — one row per sack weighing (SPEC §4).
-- Same design as cone_event: raw weight (kg) stored untouched, both shifts stored.
-- Note: sack has no independent PLC event time (SCHEMA DQ-5) — production_ts_utc
-- falls back to the insert time; flagged so reports can caveat it.

IF OBJECT_ID('sms.sack_event', 'U') IS NULL
BEGIN
    CREATE TABLE sms.sack_event (
        sack_event_id       BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_sack_event PRIMARY KEY,

        line_id             INT          NOT NULL,

        production_ts_utc   DATETIME2(3) NOT NULL,
        production_ts_utc_ms BIGINT      NOT NULL,
        ingest_ts_utc       DATETIME2(3) NULL,
        production_ts_is_insert_time BIT NOT NULL CONSTRAINT DF_sack_ts_isinsert DEFAULT 0, -- DQ-5 caveat

        shift_code          VARCHAR(10)  NOT NULL,
        shift_date          DATE         NOT NULL,
        shift_code_legacy   VARCHAR(10)  NULL,

        sack_num            INT          NULL,        -- NOT a key (resets — DQ-3)

        weight_kg           DECIMAL(10,3) NULL,       -- RAW kg; interpreted at read time
        in_range            BIT          NULL,

        -- attribution (forward-only manual entry; NULL for history)
        material_id         INT          NULL,
        lot_code            NVARCHAR(64) NULL,
        attribution_method  VARCHAR(30)  NULL,
        attribution_confidence VARCHAR(10) NULL,

        source_system       VARCHAR(20)  NOT NULL,
        source_row_id       BIGINT       NULL,
        raw_id              BIGINT       NULL,        -- replay lineage to sms_raw.sack_raw
        ingest_run_id       UNIQUEIDENTIFIER NOT NULL,
        ingest_seq          INT          NOT NULL CONSTRAINT DF_sack_ingest_seq DEFAULT 0,
        merge_key_is_unique BIT          NOT NULL CONSTRAINT DF_sack_merge_uniq DEFAULT 1,
        transform_version   INT          NOT NULL CONSTRAINT DF_sack_tform_ver DEFAULT 1
    );

    CREATE UNIQUE INDEX UX_sack_merge
        ON sms.sack_event (line_id, production_ts_utc_ms, ingest_seq);

    CREATE INDEX IX_sack_source
        ON sms.sack_event (line_id, source_row_id);

    CREATE INDEX IX_sack_shift_date
        ON sms.sack_event (shift_date, shift_code) INCLUDE (weight_kg, in_range);
    CREATE INDEX IX_sack_prod_ts
        ON sms.sack_event (production_ts_utc);
END
GO
