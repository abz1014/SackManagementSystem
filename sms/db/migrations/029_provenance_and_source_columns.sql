-- 029_provenance_and_source_columns.sql — Roadmap Phase 3 (canonical model) and
-- Phase 2 (integration layer): the provenance every reportable record must
-- carry, and the full column list of each source generation.
--
-- PHASE 3 — "each production record should preserve ... ingestion timestamp".
-- It did not. `ingest_ts_utc` on the canonical tables holds IFL'S insert time
-- (their `Date` column — a naming trap), and `ingest_run_id` was a UUID minted
-- per transform pass and inserted into no other table: the join the design
-- promised (canonical → sync_run) returned zero rows. Only raw_id → the raw
-- row's read_at_utc actually said when SMS ingested a reading, and no API or
-- screen exposed raw_id. Fix: copy the raw row's own read_at_utc onto the
-- canonical row as `ingested_at_utc`, and from this version on the transform
-- writes the RAW row's ingest_run_id (= sms.sync_run.run_id) into the
-- canonical `ingest_run_id` instead of a fresh one, so the join is real.
-- Existing rows are backfilled from raw in batches (275k cone rows on the
-- development sidecar; SIMPLE recovery, so the log does not grow).
--
-- Reject events also gain `attribution_method` / `attribution_confidence`, the
-- two columns cones and sacks already carry: a reject's product was resolved
-- the same way (the row's own MaterialId since 5 Aug 2026) and nothing said so.
--
-- PHASE 2 — the fingerprint hashes only the columns the reader DEPENDS ON, by
-- design (SEPT-2026-DB-FINDINGS-RAW.md:279): a column IFL adds that we do not
-- read is invisible, which is how MaterialId itself would have arrived
-- unnoticed had the table not been recreated. `column_list` records the FULL
-- column list the generation had when it was accepted; the worker compares
-- the live list to it on every pass and raises a non-fatal WARNING
-- (`source_columns_changed`) when they differ. Nullable: generations accepted
-- before this migration have no recorded list until the worker fills it in
-- on its next pass.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------- reject attribution
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.reject_event') AND name = 'attribution_method')
    ALTER TABLE sms.reject_event ADD
        attribution_method     VARCHAR(30) NULL,   -- 'none' | 'source_column' | 'manual_entry'
        attribution_confidence VARCHAR(10) NULL;   -- 'high' | 'low' | 'ambiguous'
GO

-- ---------------------------------------------------------------- ingestion timestamp
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.cone_event') AND name = 'ingested_at_utc')
    ALTER TABLE sms.cone_event ADD ingested_at_utc DATETIME2(3) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.sack_event') AND name = 'ingested_at_utc')
    ALTER TABLE sms.sack_event ADD ingested_at_utc DATETIME2(3) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.reject_event') AND name = 'ingested_at_utc')
    ALTER TABLE sms.reject_event ADD ingested_at_utc DATETIME2(3) NULL;
GO

-- Backfill from the raw rows in batches. Rows whose raw row is gone (none on
-- the development sidecar; raw is append-only) stay NULL, honestly.
DECLARE @n INT = 1;
WHILE @n > 0
BEGIN
    UPDATE TOP (50000) c
       SET c.ingested_at_utc = r.read_at_utc, c.ingest_run_id = r.ingest_run_id
      FROM sms.cone_event c JOIN sms_raw.cone_raw r ON r.raw_id = c.raw_id
     WHERE c.ingested_at_utc IS NULL;
    SET @n = @@ROWCOUNT;
END
GO
DECLARE @n INT = 1;
WHILE @n > 0
BEGIN
    UPDATE TOP (50000) c
       SET c.ingested_at_utc = r.read_at_utc, c.ingest_run_id = r.ingest_run_id
      FROM sms.sack_event c JOIN sms_raw.sack_raw r ON r.raw_id = c.raw_id
     WHERE c.ingested_at_utc IS NULL;
    SET @n = @@ROWCOUNT;
END
GO
-- reject_event rows come from two raw tables; raw_id alone is ambiguous, so
-- the reject kind picks the table.
DECLARE @n INT = 1;
WHILE @n > 0
BEGIN
    UPDATE TOP (50000) c
       SET c.ingested_at_utc = r.read_at_utc, c.ingest_run_id = r.ingest_run_id
      FROM sms.reject_event c JOIN sms_raw.reject_qcs_raw r ON r.raw_id = c.raw_id
     WHERE c.ingested_at_utc IS NULL AND c.reject_type = 'quality';
    SET @n = @@ROWCOUNT;
END
GO
DECLARE @n INT = 1;
WHILE @n > 0
BEGIN
    UPDATE TOP (50000) c
       SET c.ingested_at_utc = r.read_at_utc, c.ingest_run_id = r.ingest_run_id
      FROM sms.reject_event c JOIN sms_raw.reject_weight_raw r ON r.raw_id = c.raw_id
     WHERE c.ingested_at_utc IS NULL AND c.reject_type = 'weight';
    SET @n = @@ROWCOUNT;
END
GO

-- ---------------------------------------------------------------- full column list per generation
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.source_epoch') AND name = 'column_list')
    ALTER TABLE sms.source_epoch ADD column_list NVARCHAR(MAX) NULL;   -- JSON array of "name type", in ordinal order
GO
