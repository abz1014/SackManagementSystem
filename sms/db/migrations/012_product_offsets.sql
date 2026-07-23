-- 012_product_offsets.sql — capture PDAS's real weight-tolerance offsets.
-- MaterialWeightOffsetMinus/Plus exist in IFL's own master data but were never
-- synced. Without them, Cp/Cpk would need a fabricated spec limit — this adds
-- the real IFL-confirmed tolerance so capability indices are never invented.
-- Append-only migration (real data now exists): ALTER, not edit of 006.

IF COL_LENGTH('sms.product', 'weight_offset_minus_g') IS NULL
BEGIN
    ALTER TABLE sms.product ADD weight_offset_minus_g DECIMAL(10,2) NULL;
END
GO
IF COL_LENGTH('sms.product', 'weight_offset_plus_g') IS NULL
BEGIN
    ALTER TABLE sms.product ADD weight_offset_plus_g DECIMAL(10,2) NULL;
END
GO
