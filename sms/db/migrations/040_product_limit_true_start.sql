-- 040_product_limit_true_start.sql — the limits' TRUE effective date, read
-- from IFL's own record instead of assumed.
--
-- THE DEFECT THIS CLOSES. Migration 027 bootstrapped one limits version per
-- product stamped SYSUTCDATETIME() — the instant the migration ran — flagged
-- `effective_is_lower_bound = 1`, reason "true start unknown". On the local
-- _SEP07 dev copy that instant is 2026-09-11T10:03:15.957Z, which is AFTER
-- the last reading in every real source generation. Measured 23 Sep 2026:
-- 275,063 of 275,063 cones predate every limits version, i.e. 100 %. So
-- ProductCatalogue.versionAt's documented fallback — "a reading older than
-- the oldest known version is judged by that oldest version" — was not a
-- rare edge case on real plant data. It was the ONLY path, and every product-
-- tolerance state SMS has ever shown for real plant data came from a row
-- whose effective date this application invented.
--
-- WHAT WAS FOUND INSTEAD, by reading PDAS (read-only) on 23 Sep 2026.
-- `dbo.Materials` carries a `Timestamp` column with DEFAULT (getdate()).
-- Migration 027's own comment dismissed it — "nothing touches it on UPDATE" —
-- and that is true but beside the point, because of what else was verified:
--
--   1. `CreateMaterial`'s INSERT does not list Timestamp, so the DEFAULT
--      fires: Timestamp is the PDAS server's clock at the instant the row was
--      inserted. `MaterialId` is an IDENTITY — the row did not exist before.
--   2. PDAS holds 13 stored procedures and NOT ONE updates Materials'
--      setpoint or offsets; the vendor supplies no UPDATE proc at all (this
--      is why CLAUDE.md's write path has to do it as a guarded single-row
--      UPDATE). Both triggers on Materials are AFTER INSERT and neither
--      writes Timestamp.
--   3. `dbo.nhs_events`, the vendor's own event log, holds 3,631 rows from
--      2026-02-24 to 2026-09-07 — months before the earliest reading. Over
--      that whole span it records exactly two kinds of Materials event,
--      `CreateMaterial` and `SetMaterialStatusActive`. There is NO limits-
--      change event of any kind, because there is no mechanism that would
--      raise one.
--   4. `SetMaterialStatusActive` demonstrably does not disturb Timestamp:
--      MaterialIds 17 and 18 are Active=1 in IFL's July snapshot and Active=0
--      in the September one, yet carry an identical Timestamp in both.
--   5. Two independent PDAS snapshots 63 days apart (PDAS_TP1U2, July;
--      PDAS_TP1U2_SEP07, September) agree byte-for-byte on the setpoint and
--      both offsets of all 18 MaterialIds they share.
--
-- Therefore `Materials.Timestamp` is the instant that product's limits came
-- into existence, and a reading carrying that MaterialId cannot predate it.
-- That is a TRUE effective_from — measured from IFL's own record — not a
-- lower bound. Verified end to end on source generation 9 (the September
-- copy, real IFL data): all seven products that appear on a cone were created
-- in PDAS BEFORE their own first reading, by between 35 minutes and 6 days.
--
-- WHAT THIS MIGRATION DOES, in three parts:
--   a. `sms.product.pdas_created_at` mirrors Materials.Timestamp, exactly as
--      `sms.pallet.pdas_created_at` (migration 036) already mirrors
--      Pallets.Timestamp. PLANT WALL CLOCK, not app UTC — the two-clocks rule.
--   b. CK_plv_source is widened for a fourth source, 'pdas_created': a
--      version whose effective_from is PDAS's own record of when the row was
--      written. It is distinct from 'pdas_observed' (the sync noticing the
--      mirror changed, which really is only a lower bound) because its date
--      is evidence, not an observation instant.
--   c. The migration-027 bootstrap rows are DELETED, and only those — matched
--      on source, flag AND the exact reason string 027 wrote. They are not
--      observations of anything: 027 fabricated their effective_from from the
--      clock at migration time and said so in their own reason text. Removing
--      a row this project knows it invented, to let seedProducts replace it
--      with a measured one, is a correction, not a rewrite of history; the
--      append-only rule protects records of what happened, and these are not
--      that. Rows of every other source — in particular an engineer's
--      'sms_local' override (migration 038) — are untouched.
--
-- WHAT THIS DOES NOT CLAIM. A direct `UPDATE dbo.Materials SET
-- MaterialSetpointWeight = ...` typed into SSMS would change a product's
-- limits without moving Timestamp and without an nhs_events row, and nothing
-- in PDAS would record it. Point 5 above is the evidence against that having
-- happened, and it covers only the span the two snapshots bracket. Where the
-- limits in force are genuinely not known, the answer stays "not known":
-- this migration removes a fabricated date, it does not invent a better one.
--
-- Idempotent: safe to re-run.

IF COL_LENGTH('sms.product', 'pdas_created_at') IS NULL
BEGIN
    -- Plant wall clock (PDAS's own getdate()), NOT a genuine UTC instant.
    -- Same convention and same column name as sms.pallet.pdas_created_at.
    ALTER TABLE sms.product ADD pdas_created_at DATETIME2(3) NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_plv_source' AND parent_object_id = OBJECT_ID('sms.product_limit_version'))
BEGIN
    ALTER TABLE sms.product_limit_version DROP CONSTRAINT CK_plv_source;
END
GO
ALTER TABLE sms.product_limit_version ADD CONSTRAINT CK_plv_source CHECK (source IN (
    'pdas_observed', 'pdas_created', 'sms_write', 'sms_local'
));
GO

-- Retire migration 027's fabricated bootstrap rows. Matched on all three of
-- source, flag and 027's own reason text, so a genuine 'pdas_observed' row
-- written later by the sync worker — which carries a different reason — can
-- never be caught by this.
DELETE FROM sms.product_limit_version
 WHERE source = 'pdas_observed'
   AND effective_is_lower_bound = 1
   AND reason = N'Bootstrapped from the sms.product mirror at migration 027; true start unknown.';
GO
