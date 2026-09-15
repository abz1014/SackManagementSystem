-- 034_calibration_adjustment_reference.sql — roadmap Phase 9 item 5
-- (calibration analytics, 15 Sep 2026): the adjustment ledger captures what
-- an engineer actually does at a scale, not only that something was done.
--
-- REDESIGN.md §5.3 asked for "station, signed grams, time, why"; migration
-- 019 added the grams. The gap analysis (§11, "Adjustment history") found
-- the ledger still captured no before/after reference readings, no reference
-- weight, and no record of the product in force — so a before/after
-- performance comparison (Phase 10's prerequisite) had nothing to compare.
--
--   before_g     what the scale read for the reference weight BEFORE the
--                adjustment (grams, as the scale showed it)
--   after_g      the same reading AFTER the adjustment
--   reference_g  the reference weight itself (the check mass), grams
--   product_id   the product (PDAS MaterialId, sms.product.product_id) in
--                force on that station at the time, as recorded by the
--                person logging it — auto-filled by the form from the
--                machine's newest cones, never inferred afterwards
--
-- All nullable: a whole-line note or an adjustment made without a check mass
-- must still be loggable, exactly as amount_g was made nullable in 019.
--
-- No foreign key from product_id to sms.product, on purpose. sms.product is
-- a MIRROR of PDAS (refreshed by the worker; `product_mirror_failed` is a
-- standing finding when it lags), and a ledger row must not be refused
-- because the mirror is momentarily behind the plant. The API validates the
-- id against the mirror at write time instead (app.ts, the same gate
-- station_id has), which refuses a typo without making the ledger depend on
-- the mirror's state forever after. Append-only, as before: a correction is
-- a new row, never an UPDATE.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.calibration_adjustment') AND name = 'before_g'
)
BEGIN
    ALTER TABLE sms.calibration_adjustment ADD before_g DECIMAL(10,2) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.calibration_adjustment') AND name = 'after_g'
)
BEGIN
    ALTER TABLE sms.calibration_adjustment ADD after_g DECIMAL(10,2) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.calibration_adjustment') AND name = 'reference_g'
)
BEGIN
    ALTER TABLE sms.calibration_adjustment ADD reference_g DECIMAL(10,2) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.calibration_adjustment') AND name = 'product_id'
)
BEGIN
    ALTER TABLE sms.calibration_adjustment ADD product_id INT NULL;
END
GO
