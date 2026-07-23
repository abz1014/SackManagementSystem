-- 003_cone_event.sql — one row per cone weighing (SPEC §4, ARCHITECTURE §4).
-- Phase-2-ready from day one: cone_id + cone_id_source present and NULLABLE.
-- Raw weight stored untouched; interpretation happens at read time (Q4/Q5).
-- Both corrected and legacy shift stored (Q7/Q8).

IF OBJECT_ID('sms.cone_event', 'U') IS NULL
BEGIN
    CREATE TABLE sms.cone_event (
        cone_event_id       BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_cone_event PRIMARY KEY,

        -- identity / multi-line
        line_id             INT          NOT NULL,

        -- time (event time from ProductionDate, NOT insert time)
        production_ts_utc   DATETIME2(3) NOT NULL,
        production_ts_utc_ms BIGINT      NOT NULL,   -- raw epoch-ms = cross-source merge key
        ingest_ts_utc       DATETIME2(3) NULL,       -- IFL's Date (insert time), for reconciliation

        -- shift (Q7/Q8 — store both, interpret via config)
        shift_code          VARCHAR(10)  NOT NULL,   -- corrected, from production_ts_utc
        shift_date          DATE         NOT NULL,
        shift_code_legacy   VARCHAR(10)  NULL,       -- IFL's original (buggy) value

        -- station
        hanger_num          INT          NULL,
        source_station      INT          NULL,
        lifter_station      INT          NULL,

        -- weight (RAW grams; never mutated — Q4/Q5)
        weight_g            DECIMAL(10,2) NULL,
        in_range            BIT          NULL,

        -- PHASE 2 READY — populated by Component B later; NULL in Phase 1
        cone_id             NVARCHAR(64) NULL,
        cone_id_source      VARCHAR(20)  NULL,       -- 'plc_direct' | 'sql_sync' | NULL

        -- product attribution (resolved; NullAttribution => NULL/none in Phase 1)
        material_id         INT          NULL,
        lot_code            NVARCHAR(64) NULL,
        attribution_method  VARCHAR(30)  NULL,       -- 'none' | 'active_material' | 'manual_entry' | 'cone_id'
        attribution_confidence VARCHAR(10) NULL,     -- 'high' | 'low' | 'ambiguous'

        -- provenance
        source_system       VARCHAR(20)  NOT NULL,   -- 'ifl_sql' | 'plc_direct'
        source_row_id       BIGINT       NULL,       -- IFL's id
        raw_id              BIGINT       NULL,        -- FK-in-spirit to sms_raw.cone_raw (replay lineage)
        ingest_run_id       UNIQUEIDENTIFIER NOT NULL,
        ingest_seq          INT          NOT NULL CONSTRAINT DF_cone_ingest_seq DEFAULT 0,
        merge_key_is_unique BIT          NOT NULL CONSTRAINT DF_cone_merge_uniq DEFAULT 1,
        transform_version   INT          NOT NULL CONSTRAINT DF_cone_tform_ver DEFAULT 1  -- which transform produced this row
    );

    -- idempotent upsert target: one physical cone per merge key + ordinal (DQ-2 caveat)
    CREATE UNIQUE INDEX UX_cone_merge
        ON sms.cone_event (line_id, production_ts_utc_ms, hanger_num, ingest_seq);

    -- watermark lookups (incremental sync)
    CREATE INDEX IX_cone_source
        ON sms.cone_event (line_id, source_row_id);

    -- reporting: shift + time range
    CREATE INDEX IX_cone_shift_date
        ON sms.cone_event (shift_date, shift_code) INCLUDE (weight_g, in_range);
    CREATE INDEX IX_cone_prod_ts
        ON sms.cone_event (production_ts_utc);
END
GO
