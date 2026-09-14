-- 020_product_color.sql
-- Fixes finding M10 (Sep 2026 audit): seedProducts.ts selected PDAS's
-- Materials.MaterialDesc1 but never MaterialDesc2, which carries real color
-- data on this line (verified directly against PDAS_TP1U2: MaterialId 11 has
-- MaterialDesc2='PARROT', MaterialId 18 has 'Khaki-2') — silently dropped
-- before it ever reached the app.
--
-- sms.product.lot_code (present since migration 006) stays intentionally
-- unpopulated: PDAS's Pallets.Lot is per PALLET, not per Material, and there
-- is no verified 1:1 (or even well-defined many-to-one) relationship between
-- a product and a lot to seed it from without guessing at a mapping nobody
-- has confirmed. Flagged here rather than left as undocumented dead plumbing
-- (CLAUDE.md's "flag ambiguity, don't guess") — resolving it needs an answer
-- from IFL on how a lot relates to a material, not a schema change.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.product') AND name = 'color'
)
BEGIN
    ALTER TABLE sms.product ADD color NVARCHAR(255) NULL;
END
GO
