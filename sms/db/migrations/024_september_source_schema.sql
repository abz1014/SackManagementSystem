-- 024_september_source_schema.sql
-- Brings sms_raw into line with IFL's September 2026 source schema.
--
-- IFL dropped and recreated the four wide tables on 2026-08-05 (~18:55-19:03)
-- and changed two things that reach us:
--
--   1. `Source` -> `MachineNo` on pack1/rejectQCS1/rejectWeight1. It is the same
--      quantity (the machine that weighed the cone, observed 1..14), so this is
--      a RENAME, not a drop-and-add: every one of the ~208,000 historical values
--      already in sms_raw stays exactly where it is, and no backfill is needed.
--      sack1 never carried it and still does not.
--
--   2. `MaterialId` ADDED to all four tables, populated on 100% of rows, joining
--      to PDAS.dbo.Materials. Nullable here because every row ingested BEFORE
--      this migration genuinely has no material — the source column did not
--      exist when they were read. NULL says "unknown", which is the truth; a
--      default would invent an attribution that was never recorded.
--
-- Idempotent: safe to re-run.

-- 1. Source -> MachineNo -------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('sms_raw.cone_raw') AND name = 'src_Source')
   AND NOT EXISTS (SELECT 1 FROM sys.columns
                   WHERE object_id = OBJECT_ID('sms_raw.cone_raw') AND name = 'src_MachineNo')
BEGIN
    EXEC sp_rename 'sms_raw.cone_raw.src_Source', 'src_MachineNo', 'COLUMN';
END
GO

IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('sms_raw.reject_qcs_raw') AND name = 'src_Source')
   AND NOT EXISTS (SELECT 1 FROM sys.columns
                   WHERE object_id = OBJECT_ID('sms_raw.reject_qcs_raw') AND name = 'src_MachineNo')
BEGIN
    EXEC sp_rename 'sms_raw.reject_qcs_raw.src_Source', 'src_MachineNo', 'COLUMN';
END
GO

IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('sms_raw.reject_weight_raw') AND name = 'src_Source')
   AND NOT EXISTS (SELECT 1 FROM sys.columns
                   WHERE object_id = OBJECT_ID('sms_raw.reject_weight_raw') AND name = 'src_MachineNo')
BEGIN
    EXEC sp_rename 'sms_raw.reject_weight_raw.src_Source', 'src_MachineNo', 'COLUMN';
END
GO

-- 2. MaterialId on all four raw tables ----------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms_raw.cone_raw') AND name = 'src_MaterialId')
BEGIN
    ALTER TABLE sms_raw.cone_raw ADD src_MaterialId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms_raw.sack_raw') AND name = 'src_MaterialId')
BEGIN
    ALTER TABLE sms_raw.sack_raw ADD src_MaterialId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms_raw.reject_qcs_raw') AND name = 'src_MaterialId')
BEGIN
    ALTER TABLE sms_raw.reject_qcs_raw ADD src_MaterialId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms_raw.reject_weight_raw') AND name = 'src_MaterialId')
BEGIN
    ALTER TABLE sms_raw.reject_weight_raw ADD src_MaterialId INT NULL;
END
GO

-- 3. Canonical: reject_event never had a product key at all -------------------
-- cone_event and sack_event have carried a (always-NULL) material_id since
-- migration 003; reject_event never did, because under NullAttribution there was
-- nothing to put in it. IFL now stamps MaterialId on rejectQCS1 and
-- rejectWeight1 as well, and a reject RATE is only meaningful per product, so
-- the reject side needs the same key or every product-wise rate would divide
-- attributed cones by unattributed rejects.
IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms.reject_event') AND name = 'material_id')
BEGIN
    ALTER TABLE sms.reject_event ADD material_id INT NULL;
END
GO

-- 4. Canonical: index material_id so per-product queries do not scan -----------
-- cone_event.material_id has existed since 003 but was written NULL on every
-- row (transform.ts stamped NullAttribution), so it was never worth indexing.
-- It now carries a real product key on every new row.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE object_id = OBJECT_ID('sms.cone_event') AND name = 'IX_cone_event_material')
BEGIN
    CREATE INDEX IX_cone_event_material ON sms.cone_event (line_id, material_id)
        INCLUDE (production_ts_utc_ms, weight_g, in_range, source_station);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE object_id = OBJECT_ID('sms.sack_event') AND name = 'IX_sack_event_material')
BEGIN
    CREATE INDEX IX_sack_event_material ON sms.sack_event (line_id, material_id)
        INCLUDE (production_ts_utc_ms, weight_kg, in_range);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE object_id = OBJECT_ID('sms.reject_event') AND name = 'IX_reject_event_material')
BEGIN
    CREATE INDEX IX_reject_event_material ON sms.reject_event (line_id, material_id)
        INCLUDE (production_ts_utc_ms, reject_type, source_station);
END
GO
