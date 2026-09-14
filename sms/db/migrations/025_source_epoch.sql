-- 025_source_epoch.sql — one row per (line, source table, physical generation).
--
-- WHY. IFL's `id` is not a stable key across time. They dropped and recreated the
-- four wide tables on 2026-08-05 (18:54:50-19:03:16) and every identity restarted
-- at 1. Measured: DATA_TP1U2_SEP07.pack1_TP1U2 holds ids 1..132,552, while
-- sms_raw.cone_raw already holds ids 1..204,076 under completely different
-- physical cones. Without a per-generation scope, every one of the 132,552
-- September cones is discarded as "already seen" — silently, reporting success.
--
-- METADATA ONLY, ON PURPOSE. The row backfill is scripts/backfill-source-epoch.mjs
-- and the constraints/indexes are migration 026. Splitting them is not style:
-- migrate.mjs wraps a whole file in ONE transaction, and this is SQL Server
-- Express, where ALTER TABLE ADD <col> NOT NULL DEFAULT is a size-of-data rewrite
-- and CREATE INDEX cannot run ONLINE. Every statement below is metadata-only and
-- commits in milliseconds against a 204,076-row table.
--
-- Idempotent: safe to re-run.

IF OBJECT_ID('sms.source_epoch', 'U') IS NULL
BEGIN
    CREATE TABLE sms.source_epoch (
        epoch_id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_source_epoch PRIMARY KEY,
        line_id            INT            NOT NULL,
        source_table       VARCHAR(64)    NOT NULL,   -- 'pack1_TP1U2', ...
        -- Server and database are identity, not decoration: the failure this
        -- guards against is "pointed at the wrong database", which a create_date
        -- alone cannot distinguish from a legitimate vendor rebuild.
        source_server      NVARCHAR(128)  NOT NULL,
        source_db          NVARCHAR(128)  NOT NULL,
        -- sys.tables.create_date as the adapter's own ISO string, byte-for-byte.
        -- Compared as text so no timezone or precision conversion can drift.
        source_created_key VARCHAR(40)    NOT NULL,
        schema_fingerprint CHAR(32)       NOT NULL,   -- supersedes app_config fingerprint.*
        provenance         VARCHAR(20)    NOT NULL,   -- 'ifl_live' | 'ifl_copy' | 'simulator'
        generation_ordinal INT            NOT NULL,   -- human label only ("2nd pack1")
        label              NVARCHAR(64)   NOT NULL,
        note               NVARCHAR(1000) NULL,
        first_seen_utc     DATETIME2(3)   NOT NULL CONSTRAINT DF_se_first DEFAULT SYSUTCDATETIME(),
        last_seen_utc      DATETIME2(3)   NULL,
        closed_utc         DATETIME2(3)   NULL,       -- set when superseded or purged
        registered_by      NVARCHAR(64)   NOT NULL    -- 'bootstrap'|'cli:epoch-accept'|'cutover'
    );

    -- Registration must be idempotent. runOnce is NOT held under a lock, so two
    -- overlapping passes must not be able to split one generation into two rows.
    CREATE UNIQUE INDEX UX_source_epoch_identity ON sms.source_epoch
        (line_id, source_table, source_server, source_db, source_created_key);

    -- At most ONE open epoch per (line, table). A filtered unique index makes
    -- "which generation am I reading now" unambiguous by construction rather
    -- than by convention.
    CREATE UNIQUE INDEX UX_source_epoch_open ON sms.source_epoch (line_id, source_table)
        WHERE closed_utc IS NULL;
END
GO

-- The development machine's bootstrap generations (IFL's July copy, epochs 1-4,
-- and the plant simulator, epochs 5-8) are NOT seeded here. They describe one
-- laptop — server 'localhost', sample-copy create_dates — and the seed's
-- IF NOT EXISTS guard would fire on every fresh database, stamping a plant
-- installation with a developer's tombstones. That block now lives in
-- scripts/seed-dev-epochs.sql (dev only). A production sidecar starts with an
-- empty sms.source_epoch and registers its live generation deliberately with
-- `sms epoch:accept` (DEPLOY.md, Dev -> Live cutover).

-- Nullable and WITHOUT a default, deliberately.
--
-- Nullable so this is pure metadata on Express — instant on 204,076 rows rather
-- than a full table rewrite inside migrate.mjs's single transaction.
--
-- No DEFAULT, ever: a column whose entire job is to prevent cross-generation
-- confusion must not quietly fill itself in when an insert path forgets it.
-- persistRaw builds its bulk column list from def.columns, which is precisely
-- the omission a default would hide. Migration 026 makes these NOT NULL once
-- the backfill has run.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms_raw.cone_raw') AND name = 'source_epoch')
    ALTER TABLE sms_raw.cone_raw ADD source_epoch INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms_raw.sack_raw') AND name = 'source_epoch')
    ALTER TABLE sms_raw.sack_raw ADD source_epoch INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms_raw.reject_qcs_raw') AND name = 'source_epoch')
    ALTER TABLE sms_raw.reject_qcs_raw ADD source_epoch INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms_raw.reject_weight_raw') AND name = 'source_epoch')
    ALTER TABLE sms_raw.reject_weight_raw ADD source_epoch INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.cone_event') AND name = 'source_epoch')
    ALTER TABLE sms.cone_event ADD source_epoch INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.sack_event') AND name = 'source_epoch')
    ALTER TABLE sms.sack_event ADD source_epoch INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.reject_event') AND name = 'source_epoch')
    ALTER TABLE sms.reject_event ADD source_epoch INT NULL;
GO
-- NULL here means "a pass from before epochs existed", which is true and worth
-- being able to say.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.sync_run') AND name = 'source_epoch')
    ALTER TABLE sms.sync_run ADD source_epoch INT NULL;
GO
