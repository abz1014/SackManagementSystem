-- 036_pallet_mirror.sql — the pallet half of the PDAS procedure, mirrored, and
-- room in the change record for the five vendor procedures SMS now calls.
-- Roadmap Phase 6 completed (Wave F, 15 Sep 2026), from IFL's own SOP "QCS ID
-- Creation by P-DAS" as relayed by Hassan sb on 15 Sep 2026.
--
-- WHY A PALLET MIRROR. The engineer's procedure does not end at CreateMaterial:
-- every material is followed by CreatePallet (material, pack schema 1, lot,
-- active, PalletDesc1 = sack colour), and the QCS panel lists ACTIVE PALLETS
-- for the operator to select on the machine (nhs_events: funcGetArray PALLET,
-- funcGetPalletId). A material with no active pallet is not selectable, so a
-- changeover that stops at the material is half done. SMS has mirrored
-- dbo.Materials since migration 006 and dbo.Pallets never; the September copy
-- holds 25 pallets (15 real, ids > 10 — the same vendor-seed rule as
-- Materials), 6 of them active. Measured 16 Sep 2026.
--
-- WHAT WILL MIRROR THIS, AND FROM WHERE — neither writer is this file. As of
-- this migration, sync-worker/src/seed/seedProducts.ts reads dbo.Blends,
-- dbo.Counts, dbo.TubeTypes and dbo.Materials only; it does NOT yet read
-- dbo.Pallets or dbo.PackSchemas (grep -rn "Pallets\|PackSchemas"
-- sms/sync-worker/src returns nothing today). That read, on every pass like
-- the other reference tables, is being added in this same phase by a
-- parallel task (T10a), which owns that change. The second writer is the
-- post-write echo-back: api/src/services/pdasWrite.ts's mirrorPallet (the
-- MERGE at :972-980), called immediately after a create_pallet /
-- set_pallet_active write so a screen never shows a pallet the engineer just
-- created as missing until the next sync pass — but that call site is only
-- reached from a committed PDAS write, so it cannot run while
-- PDAS_WRITE_ENABLED is false. UNTIL T10A'S SEED MIRROR LANDS, sms.pallet and
-- sms.pack_schema are created here EMPTY: this migration only adds the
-- tables and the product_change columns, it does not populate them.
-- pdas_created_at is Pallets.Timestamp — the PDAS server's getdate(), i.e.
-- the plant's wall clock, NOT an app-UTC instant (the Two Clocks rule); it is
-- kept for ordering and display only.
--
-- sms.product_change GROWS, it is not replaced. Migration 027 made it the
-- only audit trail of SMS writes to PDAS (PDAS keeps none). Two columns:
--   pallet_id — the pallet a create_pallet / set_pallet_active row is about
--               (product_id stays NULL for those; a pallet is not a product);
--   proc_name — the vendor procedure that was executed (or would have been),
--               so a reader of the record does not have to infer it from the
--               operation name.
-- Two CHECK constraints are widened: `operation` for the five new operations
-- and `outcome` for 'mismatch' — the echo-back read after a committed write
-- did not return what was requested. The existing update_limits path records
-- that case as 'ok' with a message and a CRITICAL finding; the new operations
-- record it as its own outcome so it can be counted without parsing the
-- message. The constraints are dropped and re-created (their definitions
-- cannot be altered in place), which is idempotent: running this twice ends
-- in the same state.
--
-- NOTHING HERE TOUCHES PDAS. Every object is in the sidecar's [sms] schema.
-- Idempotent: safe to re-run.

-- pack_schema mirror --------------------------------------------------------
IF OBJECT_ID('sms.pack_schema', 'U') IS NULL
BEGIN
    CREATE TABLE sms.pack_schema (
        pack_schema_id  INT            NOT NULL CONSTRAINT PK_pack_schema PRIMARY KEY,  -- PDAS PackSchemaId
        description     NVARCHAR(255)  NULL,       -- PackSchemaDesc, e.g. 'Pallet 4x5', 'Sack 3x4'
        cones_per_layer INT            NULL,
        pack_type_id    INT            NULL        -- PDAS PackTypeId (1 pallet, 2 sack on this line)
    );
END
GO

-- pallet mirror -------------------------------------------------------------
IF OBJECT_ID('sms.pallet', 'U') IS NULL
BEGIN
    CREATE TABLE sms.pallet (
        pallet_id       INT            NOT NULL CONSTRAINT PK_pallet PRIMARY KEY,  -- PDAS PalletId
        -- No FK to sms.product: the mirror is re-seeded and may transiently
        -- lack the row (the same reason product_timeline and
        -- product_limit_version have none). Indexed instead.
        product_id      INT            NOT NULL,   -- PDAS MaterialId
        pack_schema_id  INT            NULL,
        lot             NVARCHAR(255)  NULL,
        steam_prog      INT            NULL,
        label_type      INT            NULL,
        routing         INT            NULL,
        active_flag     BIT            NULL,       -- PDAS PalletActive (what the QCS panel lists)
        desc1           NVARCHAR(255)  NULL,       -- PalletDesc1 = the sack colour, per IFL's SOP
        desc2           NVARCHAR(255)  NULL,
        desc3           NVARCHAR(255)  NULL,
        desc4           NVARCHAR(255)  NULL,
        desc5           NVARCHAR(255)  NULL,
        -- Plant wall clock (PDAS getdate()), for ordering only. Not app UTC.
        pdas_created_at DATETIME2(3)   NULL
    );
    CREATE INDEX IX_pallet_product ON sms.pallet (product_id, active_flag);
END
GO

-- product_change: the pallet, the procedure, and the new outcomes ----------
IF COL_LENGTH('sms.product_change', 'pallet_id') IS NULL
BEGIN
    ALTER TABLE sms.product_change ADD pallet_id INT NULL;
END
GO
IF COL_LENGTH('sms.product_change', 'proc_name') IS NULL
BEGIN
    ALTER TABLE sms.product_change ADD proc_name VARCHAR(40) NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_pc_operation' AND parent_object_id = OBJECT_ID('sms.product_change'))
BEGIN
    ALTER TABLE sms.product_change DROP CONSTRAINT CK_pc_operation;
END
GO
ALTER TABLE sms.product_change ADD CONSTRAINT CK_pc_operation CHECK (operation IN (
    'create', 'set_active', 'update_limits',
    'add_blend', 'add_count', 'add_tube_type', 'create_pallet', 'set_pallet_active'
));
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_pc_outcome' AND parent_object_id = OBJECT_ID('sms.product_change'))
BEGIN
    ALTER TABLE sms.product_change DROP CONSTRAINT CK_pc_outcome;
END
GO
ALTER TABLE sms.product_change ADD CONSTRAINT CK_pc_outcome CHECK (outcome IN (
    'ok', 'conflict', 'implausible', 'not_found', 'disabled', 'pdas_error', 'error', 'mismatch'
));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pc_pallet_at' AND object_id = OBJECT_ID('sms.product_change'))
BEGIN
    CREATE INDEX IX_pc_pallet_at ON sms.product_change (pallet_id, changed_at DESC) WHERE pallet_id IS NOT NULL;
END
GO
