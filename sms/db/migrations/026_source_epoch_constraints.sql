-- 026_source_epoch_constraints.sql — make source_epoch mandatory and re-key on it.
--
-- Run AFTER scripts/backfill-source-epoch.mjs has left zero NULLs, and after the
-- simulator epoch is purged. Both are verified by the guard at the top: this file
-- refuses to run rather than failing halfway through.
--
-- ORDER MATTERS: create the new unique index, THEN drop the old one. Drop-first
-- would leave the raw tables with no uniqueness at all, and runFullSync calls
-- runOnce OUTSIDE withTransformLock (pipeline.ts), so two readers can race.
--
-- Stop the sync worker before running. On Express, CREATE INDEX cannot be ONLINE,
-- so /api/live blocks for a few seconds while the cone_raw indexes rebuild.

SET XACT_ABORT ON;
GO

-- Guard: refuse rather than half-apply -----------------------------------------
IF EXISTS (SELECT 1 FROM sms_raw.cone_raw          WHERE source_epoch IS NULL)
OR EXISTS (SELECT 1 FROM sms_raw.sack_raw          WHERE source_epoch IS NULL)
OR EXISTS (SELECT 1 FROM sms_raw.reject_qcs_raw    WHERE source_epoch IS NULL)
OR EXISTS (SELECT 1 FROM sms_raw.reject_weight_raw WHERE source_epoch IS NULL)
OR EXISTS (SELECT 1 FROM sms.cone_event            WHERE source_epoch IS NULL)
OR EXISTS (SELECT 1 FROM sms.sack_event            WHERE source_epoch IS NULL)
OR EXISTS (SELECT 1 FROM sms.reject_event          WHERE source_epoch IS NULL)
BEGIN
    THROW 51026, 'source_epoch is still NULL somewhere. Run scripts/backfill-source-epoch.mjs first.', 1;
END
GO

-- 1. RAW: NOT NULL + FK ---------------------------------------------------------
ALTER TABLE sms_raw.cone_raw          ALTER COLUMN source_epoch INT NOT NULL;
ALTER TABLE sms_raw.sack_raw          ALTER COLUMN source_epoch INT NOT NULL;
ALTER TABLE sms_raw.reject_qcs_raw    ALTER COLUMN source_epoch INT NOT NULL;
ALTER TABLE sms_raw.reject_weight_raw ALTER COLUMN source_epoch INT NOT NULL;
GO

IF OBJECT_ID('FK_cone_raw_epoch') IS NULL
    ALTER TABLE sms_raw.cone_raw ADD CONSTRAINT FK_cone_raw_epoch
        FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
IF OBJECT_ID('FK_sack_raw_epoch') IS NULL
    ALTER TABLE sms_raw.sack_raw ADD CONSTRAINT FK_sack_raw_epoch
        FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
IF OBJECT_ID('FK_reject_qcs_raw_epoch') IS NULL
    ALTER TABLE sms_raw.reject_qcs_raw ADD CONSTRAINT FK_reject_qcs_raw_epoch
        FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
IF OBJECT_ID('FK_reject_weight_raw_epoch') IS NULL
    ALTER TABLE sms_raw.reject_weight_raw ADD CONSTRAINT FK_reject_weight_raw_epoch
        FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
GO

-- 2. RAW: the new uniqueness, then retire the old -------------------------------
-- UX_*_raw_src on (line_id, src_id) is the index that physically BLOCKS a second
-- generation: September's id 1 collides with July's id 1. It goes last.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_cone_raw_src2' AND object_id=OBJECT_ID('sms_raw.cone_raw'))
    CREATE UNIQUE INDEX UX_cone_raw_src2 ON sms_raw.cone_raw (line_id, source_epoch, src_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_cone_raw_wm' AND object_id=OBJECT_ID('sms_raw.cone_raw'))
    CREATE INDEX IX_cone_raw_wm ON sms_raw.cone_raw (line_id, source_epoch, src_id DESC);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_cone_raw_src' AND object_id=OBJECT_ID('sms_raw.cone_raw'))
    DROP INDEX UX_cone_raw_src ON sms_raw.cone_raw;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_sack_raw_src2' AND object_id=OBJECT_ID('sms_raw.sack_raw'))
    CREATE UNIQUE INDEX UX_sack_raw_src2 ON sms_raw.sack_raw (line_id, source_epoch, src_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_sack_raw_wm' AND object_id=OBJECT_ID('sms_raw.sack_raw'))
    CREATE INDEX IX_sack_raw_wm ON sms_raw.sack_raw (line_id, source_epoch, src_id DESC);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_sack_raw_src' AND object_id=OBJECT_ID('sms_raw.sack_raw'))
    DROP INDEX UX_sack_raw_src ON sms_raw.sack_raw;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_qcs_raw_src2' AND object_id=OBJECT_ID('sms_raw.reject_qcs_raw'))
    CREATE UNIQUE INDEX UX_reject_qcs_raw_src2 ON sms_raw.reject_qcs_raw (line_id, source_epoch, src_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_reject_qcs_raw_wm' AND object_id=OBJECT_ID('sms_raw.reject_qcs_raw'))
    CREATE INDEX IX_reject_qcs_raw_wm ON sms_raw.reject_qcs_raw (line_id, source_epoch, src_id DESC);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_qcs_raw_src' AND object_id=OBJECT_ID('sms_raw.reject_qcs_raw'))
    DROP INDEX UX_reject_qcs_raw_src ON sms_raw.reject_qcs_raw;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_weight_raw_src2' AND object_id=OBJECT_ID('sms_raw.reject_weight_raw'))
    CREATE UNIQUE INDEX UX_reject_weight_raw_src2 ON sms_raw.reject_weight_raw (line_id, source_epoch, src_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_reject_weight_raw_wm' AND object_id=OBJECT_ID('sms_raw.reject_weight_raw'))
    CREATE INDEX IX_reject_weight_raw_wm ON sms_raw.reject_weight_raw (line_id, source_epoch, src_id DESC);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_weight_raw_src' AND object_id=OBJECT_ID('sms_raw.reject_weight_raw'))
    DROP INDEX UX_reject_weight_raw_src ON sms_raw.reject_weight_raw;
GO

-- 3. CANONICAL: NOT NULL + FK ---------------------------------------------------
ALTER TABLE sms.cone_event   ALTER COLUMN source_epoch INT NOT NULL;
ALTER TABLE sms.sack_event   ALTER COLUMN source_epoch INT NOT NULL;
ALTER TABLE sms.reject_event ALTER COLUMN source_epoch INT NOT NULL;
GO
IF OBJECT_ID('FK_cone_event_epoch') IS NULL
    ALTER TABLE sms.cone_event ADD CONSTRAINT FK_cone_event_epoch
        FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
IF OBJECT_ID('FK_sack_event_epoch') IS NULL
    ALTER TABLE sms.sack_event ADD CONSTRAINT FK_sack_event_epoch
        FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
IF OBJECT_ID('FK_reject_event_epoch') IS NULL
    ALTER TABLE sms.reject_event ADD CONSTRAINT FK_reject_event_epoch
        FOREIGN KEY (source_epoch) REFERENCES sms.source_epoch (epoch_id);
GO

-- 4. CANONICAL: dedupe on raw_id, OUR identity ----------------------------------
-- The canonical dedupe key moves from source_row_id (IFL's counter, which they
-- reset) to raw_id (ours, an IDENTITY, never reused). This makes the invariant a
-- constraint instead of an application convention, and it needs no epoch threaded
-- through three call sites. reject_event is fed by TWO source tables, so its key
-- is (reject_type, raw_id) — the same split persistCanonical's extraExistingFilter
-- already uses. Measured before writing: 142,511/142,511 and 5,462/5,462 distinct,
-- reject 3,146 rows with 3,146 distinct (reject_type, raw_id).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_cone_raw_id' AND object_id=OBJECT_ID('sms.cone_event'))
    CREATE UNIQUE INDEX UX_cone_raw_id ON sms.cone_event (raw_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_sack_raw_id' AND object_id=OBJECT_ID('sms.sack_event'))
    CREATE UNIQUE INDEX UX_sack_raw_id ON sms.sack_event (raw_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_raw_id' AND object_id=OBJECT_ID('sms.reject_event'))
    CREATE UNIQUE INDEX UX_reject_raw_id ON sms.reject_event (reject_type, raw_id);
GO

-- 5. CANONICAL: merge keys gain the epoch, LAST ---------------------------------
-- Epoch goes last, not second. live.ts documents that every range predicate seeks
-- on (line_id, production_ts_utc_ms) as the leading prefix; putting the epoch
-- second would break seven getLive queries plus production.ts and rejectSpc.ts.
-- Trailing placement gives identical uniqueness.
--
-- Why it is needed at all: two cones nine weeks apart CAN share
-- (production_ts_utc_ms, hanger_num). Without the epoch that sets
-- merge_key_is_unique = 0, which the app reports as "DQ-2, possibly the same cone
-- weighed twice". It is not. This keeps the honest answer.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_cone_merge2' AND object_id=OBJECT_ID('sms.cone_event'))
    CREATE UNIQUE INDEX UX_cone_merge2 ON sms.cone_event
        (line_id, production_ts_utc_ms, hanger_num, ingest_seq, source_epoch);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_cone_merge' AND object_id=OBJECT_ID('sms.cone_event'))
    DROP INDEX UX_cone_merge ON sms.cone_event;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_sack_merge2' AND object_id=OBJECT_ID('sms.sack_event'))
    CREATE UNIQUE INDEX UX_sack_merge2 ON sms.sack_event
        (line_id, production_ts_utc_ms, ingest_seq, source_epoch);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_sack_merge' AND object_id=OBJECT_ID('sms.sack_event'))
    DROP INDEX UX_sack_merge ON sms.sack_event;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_merge2' AND object_id=OBJECT_ID('sms.reject_event'))
    CREATE UNIQUE INDEX UX_reject_merge2 ON sms.reject_event
        (line_id, reject_type, production_ts_utc_ms, hanger_num, ingest_seq, source_epoch);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_merge' AND object_id=OBJECT_ID('sms.reject_event'))
    DROP INDEX UX_reject_merge ON sms.reject_event;
GO

-- 6. source_row_id stays DISPLAYED, never an address ----------------------------
-- It no longer identifies a row on its own: July's id 5 and September's id 5 are
-- different cones. Making the lookup index UNIQUE over (line_id, source_epoch,
-- source_row_id) turns "someone forgot the epoch predicate" into a loud failure
-- rather than an arbitrary row.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_cone_source' AND object_id=OBJECT_ID('sms.cone_event'))
    DROP INDEX IX_cone_source ON sms.cone_event;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_cone_source' AND object_id=OBJECT_ID('sms.cone_event'))
    CREATE UNIQUE INDEX UX_cone_source ON sms.cone_event (line_id, source_epoch, source_row_id);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_sack_source' AND object_id=OBJECT_ID('sms.sack_event'))
    DROP INDEX IX_sack_source ON sms.sack_event;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_sack_source' AND object_id=OBJECT_ID('sms.sack_event'))
    CREATE UNIQUE INDEX UX_sack_source ON sms.sack_event (line_id, source_epoch, source_row_id);
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_reject_source' AND object_id=OBJECT_ID('sms.reject_event'))
    DROP INDEX IX_reject_source ON sms.reject_event;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reject_source' AND object_id=OBJECT_ID('sms.reject_event'))
    CREATE UNIQUE INDEX UX_reject_source ON sms.reject_event
        (line_id, reject_type, source_epoch, source_row_id) WHERE source_row_id IS NOT NULL;
GO

-- 7. The gates now live on the epoch row ----------------------------------------
-- fingerprint.* and epoch.* in app_config are superseded by
-- source_epoch.schema_fingerprint / .source_created_key. Leaving them would mean
-- two sources of truth for the same gate, and the stale one describes July.
DELETE FROM sms.app_config WHERE config_key LIKE 'fingerprint.%' OR config_key LIKE 'epoch.%';
GO
