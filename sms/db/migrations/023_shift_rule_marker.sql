-- 023_shift_rule_marker.sql
-- Fixes the H5 follow-up (Sep 2026 audit): changing the night-attribution
-- rule applies to newly-transformed rows immediately, so until a rebuild runs
-- the canonical tables hold TWO attribution regimes at once — and nothing
-- recorded which rule produced which row, so nothing could detect it. Every
-- shift_date-keyed figure (Report, Line totals, reject SPC day buckets)
-- silently blended both.
--
-- Nullable on purpose: rows written before this column existed genuinely do
-- not know which rule produced them, and NULL says that rather than guessing.
-- A rebuild restamps them.

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms.cone_event') AND name = 'night_belongs_to')
BEGIN
    ALTER TABLE sms.cone_event ADD night_belongs_to VARCHAR(15) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms.sack_event') AND name = 'night_belongs_to')
BEGIN
    ALTER TABLE sms.sack_event ADD night_belongs_to VARCHAR(15) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('sms.reject_event') AND name = 'night_belongs_to')
BEGIN
    ALTER TABLE sms.reject_event ADD night_belongs_to VARCHAR(15) NULL;
END
GO
