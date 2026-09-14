-- 027_product_limit_history.sql — time-versioned product limits and a record of
-- every write SMS makes to PDAS.
--
-- WHY. sms.product is a MIRROR: seedProducts MERGE-overwrites it from PDAS on
-- every sync pass. productAt.ts resolved which product was running at a
-- reading's time and then read that product's CURRENT setpoint and offsets
-- from the mirror. So any change to a setpoint — by us, or by an IFL engineer
-- in SSMS — silently re-judged every past reading attributed to that material.
-- That is precisely the defect REDESIGN rule 1 ("the old app applied today's
-- tolerance to readings weeks old") was written to kill, one level down.
--
-- PDAS itself keeps no history at all: dbo.Materials.Timestamp has DEFAULT
-- getdate() and nothing touches it on UPDATE, and neither trigger records the
-- old values. If a setpoint was ever edited, the only record that will exist
-- is the one written here.
--
-- Two tables:
--   product_limit_version — append-only. One row per (product, limits) as they
--     were observed or written. limitsAt(product_id, ts) = the newest row with
--     effective_from <= ts. Every reading is judged by the limits in force at
--     its OWN time, never today's.
--   product_change — append-only. One row per write SMS attempted against PDAS,
--     with the before image the operator was shown, the after image requested,
--     what PDAS actually held afterwards (echo-back), and the outcome. Since
--     PDAS keeps nothing, this is the audit trail.
--
-- Idempotent: safe to re-run.

IF OBJECT_ID('sms.product_limit_version', 'U') IS NULL
BEGIN
    CREATE TABLE sms.product_limit_version (
        version_id        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_limit_version PRIMARY KEY,
        -- No FK to sms.product, for the same reason product_timeline has none:
        -- the mirror is re-seeded and may transiently lack a row this history
        -- still needs to describe. Indexed instead.
        product_id        INT            NOT NULL,   -- PDAS MaterialId
        setpoint_g        DECIMAL(10,2)  NULL,
        offset_minus_g    DECIMAL(10,2)  NULL,
        offset_plus_g     DECIMAL(10,2)  NULL,
        -- App-UTC instant (Two Clocks rule: a genuine UTC instant, NOT the
        -- plant wall clock). For 'sms_write' it is the moment PDAS accepted the
        -- change. For 'pdas_observed' it is when the mirror first saw the
        -- values — which is a LOWER BOUND on when they took effect, not the
        -- true start; the flag below says so rather than pretending.
        effective_from    DATETIME2(3)   NOT NULL,
        effective_is_lower_bound BIT     NOT NULL CONSTRAINT DF_plv_lb DEFAULT 0,
        source            VARCHAR(20)    NOT NULL,   -- 'pdas_observed' | 'sms_write'
        changed_by        INT            NULL,       -- sms.app_user, for sms_write
        reason            NVARCHAR(255)  NULL,
        recorded_at       DATETIME2(3)   NOT NULL CONSTRAINT DF_plv_rec DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_plv_source CHECK (source IN ('pdas_observed', 'sms_write'))
    );
    -- "limits in force at time T for product P" is one seek on this.
    CREATE INDEX IX_plv_product_effective ON sms.product_limit_version (product_id, effective_from DESC);
END
GO

-- Bootstrap: one observed version per product the mirror already holds, marked
-- as a lower bound — we know the limits are AT LEAST this old; we do not know
-- when they started, and this migration must not invent that.
IF NOT EXISTS (SELECT 1 FROM sms.product_limit_version)
BEGIN
    INSERT INTO sms.product_limit_version
        (product_id, setpoint_g, offset_minus_g, offset_plus_g, effective_from,
         effective_is_lower_bound, source, reason)
    SELECT product_id, setpoint_weight_g, weight_offset_minus_g, weight_offset_plus_g,
           SYSUTCDATETIME(), 1, 'pdas_observed',
           N'Bootstrapped from the sms.product mirror at migration 027; true start unknown.'
      FROM sms.product;
END
GO

IF OBJECT_ID('sms.product_change', 'U') IS NULL
BEGIN
    CREATE TABLE sms.product_change (
        change_id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_change PRIMARY KEY,
        product_id          INT            NULL,       -- NULL until a create succeeds
        operation           VARCHAR(20)    NOT NULL,   -- 'create' | 'set_active' | 'update_limits'
        before_json         NVARCHAR(MAX)  NULL,       -- exactly what the operator was shown
        after_json          NVARCHAR(MAX)  NULL,       -- exactly what was requested
        observed_after_json NVARCHAR(MAX)  NULL,       -- what PDAS held on re-read (echo-back)
        outcome             VARCHAR(20)    NOT NULL,   -- 'ok'|'conflict'|'implausible'|'not_found'|'disabled'|'pdas_error'|'error'
        pdas_error_code     INT            NULL,       -- the proc's @error, when it returned one
        message             NVARCHAR(500)  NULL,
        effective_from      DATETIME2(3)   NULL,       -- app-UTC instant PDAS accepted it
        changed_at          DATETIME2(3)   NOT NULL CONSTRAINT DF_pc_at DEFAULT SYSUTCDATETIME(),
        changed_by          INT            NULL,       -- sms.app_user
        reason              NVARCHAR(255)  NULL,
        CONSTRAINT CK_pc_operation CHECK (operation IN ('create', 'set_active', 'update_limits')),
        CONSTRAINT CK_pc_outcome CHECK (outcome IN ('ok','conflict','implausible','not_found','disabled','pdas_error','error'))
    );
    CREATE INDEX IX_pc_product_at ON sms.product_change (product_id, changed_at DESC);
    CREATE INDEX IX_pc_at ON sms.product_change (changed_at DESC);
END
GO
