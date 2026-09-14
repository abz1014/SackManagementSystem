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

-- Seed the two generations this database already holds. Order is fixed so the
-- epoch_ids are deterministic: 1-4 = IFL's July copy, 5-8 = the plant simulator.
--
-- source_created_key values are the REAL create_dates, read from DATA_TP1U2 and
-- (for the simulator) from the epoch.* keys this app recorded live before the
-- simulator tables were rebuilt. They carry milliseconds because the adapter's
-- toISOString() does; a truncated value would never match and would silently
-- register a duplicate generation.
--
-- Fingerprints are read from app_config rather than hardcoded — it is the only
-- surviving record of what those generations' columns were, and copying it by
-- hand is how a transcription error becomes a permanent false baseline.
-- BOTH bootstrap generations are seeded CLOSED. Neither is the source this
-- worker will read next: the July sample's generation was destroyed by IFL on
-- 2026-08-05, and the simulator's rows are being purged. The live generation
-- (September) is registered later, deliberately, by `sms epoch:accept`.
--
-- UX_source_epoch_open enforces this — it permits at most one OPEN epoch per
-- (line, table), so seeding two open rows for pack1_TP1U2 is rejected outright.
-- That rejection is the constraint doing exactly what it exists for.
--
-- closed_utc is the real end of each generation, not the time this migration
-- ran: the July rows close at IFL's own recreate timestamps (read from
-- DATA_TP1U2_SEP07's sys.tables.create_date), the simulator rows at the purge.
IF NOT EXISTS (SELECT 1 FROM sms.source_epoch)
BEGIN
    INSERT INTO sms.source_epoch
      (line_id, source_table, source_server, source_db, source_created_key,
       schema_fingerprint, provenance, generation_ordinal, label, registered_by,
       closed_utc, note)
    SELECT v.line_id, v.source_table, v.source_server, v.source_db, v.source_created_key,
           ISNULL((SELECT TOP 1 c.config_value FROM sms.app_config c
                    WHERE c.config_key = 'fingerprint.' + v.source_table),
                  '00000000000000000000000000000000'),
           v.provenance, v.generation_ordinal, v.label, 'bootstrap',
           v.closed_utc, v.note
    FROM (VALUES
      (1,'pack1_TP1U2',        'localhost','DATA_TP1U2',    '2026-06-19T11:53:05.787Z','ifl_copy',  1,N'July copy — cones',
         CONVERT(datetime2(3),'2026-08-05T19:03:16'),
         N'IFL sample 22 Jun - 10 Jul 2026. IFL dropped and recreated this table on 2026-08-05 19:03:16, ending the generation; our sample is the only copy we hold. 10 Jul - 5 Aug was never sent and is still to be requested.'),
      (1,'sack1_TP1U2',        'localhost','DATA_TP1U2',    '2026-06-18T18:47:43.500Z','ifl_copy',  1,N'July copy — sacks',
         CONVERT(datetime2(3),'2026-08-05T18:54:50'), NULL),
      (1,'rejectQCS1_TP1U2',   'localhost','DATA_TP1U2',    '2026-06-19T11:58:38.250Z','ifl_copy',  1,N'July copy — quality rejects',
         CONVERT(datetime2(3),'2026-08-05T18:58:13'), NULL),
      (1,'rejectWeight1_TP1U2','localhost','DATA_TP1U2',    '2026-06-22T11:20:25.023Z','ifl_copy',  1,N'July copy — weight rejects',
         CONVERT(datetime2(3),'2026-08-05T18:59:18'), NULL),
      (1,'pack1_TP1U2',        'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','simulator', 2,N'Simulator — cones',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'),
         N'scripts/simulate-plant.mjs. SYNTHETIC — never happened on a plant. Rows purged 2026-09-11; this row is kept as a tombstone so the id range is never silently reused. Its window (26 Aug - 3 Sep) overlapped the real September copy by nine days.'),
      (1,'sack1_TP1U2',        'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','simulator', 2,N'Simulator — sacks',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'), N'SYNTHETIC. Rows purged 2026-09-11.'),
      (1,'rejectQCS1_TP1U2',   'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','simulator', 2,N'Simulator — quality rejects',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'), N'SYNTHETIC. Rows purged 2026-09-11.'),
      (1,'rejectWeight1_TP1U2','localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.903Z','simulator', 2,N'Simulator — weight rejects',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'), N'SYNTHETIC. Rows purged 2026-09-11.')
    ) AS v(line_id, source_table, source_server, source_db, source_created_key,
           provenance, generation_ordinal, label, closed_utc, note);
END
GO

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
