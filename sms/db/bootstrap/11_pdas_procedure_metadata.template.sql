-- 11_pdas_procedure_metadata.template.sql — TEMPLATE, not run automatically by
-- SMS or by any script in this repo. Proposed, not applied.
--
-- WHY THIS EXISTS (16 Sep 2026 PDAS introspection task). sms/scripts/pdas-introspect.mjs
-- reads the seven vendor write procedures' real parameter lists from sys.parameters /
-- OBJECT_DEFINITION, using IFL_DB_USER (sms_readonly) — the same login
-- 10_ifl_readonly_login.template.sql provisions. That login holds ONLY
-- db_datareader (that template's own words: "Nothing here grants any write, any
-- EXECUTE, or any right on any other database"), and SQL Server's metadata
-- visibility rules mean a login with no EXECUTE / VIEW DEFINITION / ALTER /
-- CONTROL on a procedure cannot see sys.parameters rows or OBJECT_DEFINITION
-- for it at all — not "empty", genuinely invisible, for that procedure and for
-- one that doesn't exist alike. Run against the local PDAS_TP1U2_SEP07 copy,
-- pdas-introspect.mjs confirmed this: db_datareader only, zero parameter rows
-- for all twelve procedures, while the three views (also covered by
-- db_datareader) read back fine.
--
-- WHAT THIS GRANTS. VIEW DEFINITION only — the right to read a procedure's
-- metadata and body, never the right to run it. This is NOT an EXECUTE grant
-- and does not let sms_readonly, or anyone using this login, call any of these
-- procedures. It changes nothing about what the login can DO to PDAS, only
-- what it can READ ABOUT PDAS's own procedures — consistent with "zero writes,
-- zero risk" (CLAUDE.md, Phase 1 hard constraint 3).
--
-- WHERE TO RUN THIS. Either:
--   (a) locally, against a disposable "_SEPnn" / "_SIM" copy, by whoever owns
--       that SQL Server instance (sysadmin on your own dev box) — so that
--       pdas-introspect.mjs can be re-run and produce a full dump; or
--   (b) on IFL's own server, by their DBA, if scripted introspection against
--       the live PDAS is ever wanted — this is a separate, smaller request
--       than "please provision sms_pdas_writer" (Phase 1 hard constraint 3):
--       it asks for READ of procedure definitions, not EXECUTE of them.
-- Nobody should run this against a plant server without asking IFL first, the
-- same as every other change to their database — CLAUDE.md rule 2.

-- === Run as a sysadmin (or db_owner) on the target database. ===

USE [PDAS_TP1U2];  -- or PDAS_TP1U2_SEP07 / PDAS_TP1U2_SIM for a local copy — edit to match
GO

GRANT VIEW DEFINITION ON OBJECT::dbo.CreateMaterial          TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.SetMaterialStatusActive TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.AddBlend                TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.AddCount                TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.AddTubeType              TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.CreatePallet             TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.SetPalletStatusActive    TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.GetAllMaterials          TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.GetAllBlends             TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.GetAllCounts              TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.GetAllTubeTypes           TO [sms_readonly];
GRANT VIEW DEFINITION ON OBJECT::dbo.GetAllPallets             TO [sms_readonly];
GO

-- === Verify (run AS sms_readonly). Each of the twelve should now return rows. ===
-- SELECT p.name, TYPE_NAME(p.user_type_id) AS data_type, p.is_output, p.has_default_value
--   FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
--  WHERE o.name = 'CreateMaterial' ORDER BY p.parameter_id;
-- SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.CreateMaterial'));
