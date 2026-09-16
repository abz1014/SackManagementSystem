-- 038_sms_local_limits.sql — a third source for sms.product_limit_version:
-- 'sms_local', for a limit change SMS records WITHOUT touching PDAS.
--
-- WHY. IFL answered on 15 Sep 2026 that product limits must be changeable
-- from Setup (Hassan sb, question pack) — but nothing in this application
-- may write to PDAS until IFL confirms that in writing (§5; still open,
-- CLAUDE.md). Migration 027 already made sms.product_limit_version the
-- source of truth every reading is judged against (productAt.ts,
-- productLimits.ts limitsAt()), append-only, independent of sms.product
-- (which the PDAS mirror MERGE-overwrites every sync pass and would silently
-- undo a write there). So the write this app can make TODAY, honestly, is a
-- new row in THIS table — never sms.product, never PDAS — recording exactly
-- what an engineer set and when, same as every other version here, just
-- attributed to a different source.
--
-- WHAT THIS ADDS. Nothing structural: product_limit_version and its indexes
-- already exist (migration 027). Only CK_plv_source is widened to permit the
-- third value. 'sms_local' rows are written by
-- api/src/services/productLimits.ts's setLocalLimitVersion(), through
-- appendLimitVersion() — the same INSERT every other source uses — never a
-- second insert path.
--
-- The constraint is dropped and re-created (its definition cannot be altered
-- in place), matching migration 036's style for CK_pc_operation /
-- CK_pc_outcome. Idempotent: safe to re-run.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_plv_source' AND parent_object_id = OBJECT_ID('sms.product_limit_version'))
BEGIN
    ALTER TABLE sms.product_limit_version DROP CONSTRAINT CK_plv_source;
END
GO
ALTER TABLE sms.product_limit_version ADD CONSTRAINT CK_plv_source CHECK (source IN (
    'pdas_observed', 'sms_write', 'sms_local'
));
GO
