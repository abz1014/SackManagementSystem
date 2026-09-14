-- 019_calibration_adjustment_amount.sql
-- Fixes finding M9 (Sep 2026 audit): REDESIGN.md §5.3 specifies the
-- calibration log must capture "station, signed grams, time, why" — the
-- table had no column for the one number a calibration adjustment is
-- actually about. Signed: positive means the scale was moved to read
-- heavier, negative lighter. Nullable: a whole-line note or an adjustment
-- whose amount wasn't measured must still be loggable.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.calibration_adjustment') AND name = 'amount_g'
)
BEGIN
    ALTER TABLE sms.calibration_adjustment ADD amount_g DECIMAL(10,2) NULL;
END
GO
