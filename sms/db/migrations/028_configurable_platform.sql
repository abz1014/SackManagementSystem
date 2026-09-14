-- 028_configurable_platform.sql — Roadmap Phase 1: the configuration entities.
--
-- WHY. Until this migration the installation's identity lived in three places
-- that were not configuration at all: an env string (`LINE_NAME='TP1 · Line 3 ·
-- Unit 2'`, which two screens PARSED on '·' to recover a unit label), a const
-- array in the sync worker (`IFL_TABLES`, whose table names carry the line in
-- their suffix — `pack1_TP1U2`), and `SELECT TOP (14)` in the station seed.
-- Machines had no row anywhere: `sms.station.machine` was a free-text column.
-- Adding a second machine, or a second line's tables, was a source-code change.
--
-- This migration gives each of the roadmap's ten entities a row:
--
--   plant ─┬─ plant_unit ─┬─ line ─┬─ machine   (the physical winders and the packer)
--          │              │        ├─ station   (existing; gains machine_id)
--          │              │        ├─ source_table (which source tables feed this line)
--          │              │        ├─ shift_rule / weight_rule / plausibility_rule (existing)
--          │              │        └─ reject_code (existing; gains line_id)
--          └─ data_source (existing source systems by role: acquisition, product master, sack packing)
--
-- Product and product_limit are NOT new tables: sms.product is PDAS's mirror
-- (IFL's product master lives in PDAS by their own arrangement) and
-- sms.product_limit_version (027) is the time-versioned limit history. Both are
-- already configuration in the roadmap's sense; the PDAS write path stays off.
--
-- SEEDED DEFAULTS — every value below is a fact from IFL's own material, and
-- each is EDITABLE in Setup afterwards. None is a guess past an IFL dependency:
--   * TP1 / Unit 2 / Line 3: the line name IFL gave us and the LINE_NAME default.
--   * 14 winders, make Rieter: the roadmap's "14 Rieter cone-winding machines";
--     MachineNo 1..14 on every cone row (renamed from Source on 2026-08-05).
--   * one packer, make Neuenhauser: the roadmap's "Neuenhauser sack-packing
--     system". No sack row carries a machine number, so it links to no station.
--   * station N ↔ machine N: the data has ONE column (MachineNo) that the
--     project has called "station" since Phase 1 and IFL's drawing calls a
--     machine. Linked by number, marked link_source='default_by_number', and
--     flagged as clarification Q3 — if IFL says machines and stations differ,
--     the link is edited, not the code.
--   * the four *_TP1U2 source tables: what the worker read until now.
--
-- CONNECTION DETAILS STAY IN .env. A data_source row names WHICH env block a
-- source uses (connection_key) and what it is for; server, database and login
-- never move into a table — secrets do not belong in the database, and the
-- epoch register (025) already records the server/database each generation was
-- actually read from.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------- plant / unit / line
IF OBJECT_ID('sms.plant', 'U') IS NULL
BEGIN
    CREATE TABLE sms.plant (
        plant_id    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_plant PRIMARY KEY,
        code        VARCHAR(16)  NOT NULL CONSTRAINT UQ_plant_code UNIQUE,
        name        NVARCHAR(128) NOT NULL,
        created_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_plant_created DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID('sms.plant_unit', 'U') IS NULL
BEGIN
    -- "plant_unit", not "unit": sms.unit (006) is the unit-of-measure table (kg, g).
    CREATE TABLE sms.plant_unit (
        unit_id     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_plant_unit PRIMARY KEY,
        plant_id    INT NOT NULL CONSTRAINT FK_plant_unit_plant REFERENCES sms.plant(plant_id),
        code        VARCHAR(16)  NOT NULL,
        name        NVARCHAR(128) NOT NULL,
        created_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_plant_unit_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_plant_unit_code UNIQUE (plant_id, code)
    );
END
GO

IF OBJECT_ID('sms.line', 'U') IS NULL
BEGIN
    -- line_id is NOT an identity: every event table already carries line_id
    -- (1 on every row today) and LINE_ID in .env names which line this worker
    -- and API serve. The row is created with the id the data already uses.
    CREATE TABLE sms.line (
        line_id     INT NOT NULL CONSTRAINT PK_line PRIMARY KEY,
        unit_id     INT NOT NULL CONSTRAINT FK_line_unit REFERENCES sms.plant_unit(unit_id),
        code        VARCHAR(16)  NOT NULL,
        name        NVARCHAR(128) NOT NULL,
        -- What every screen prints for this line. Was LINE_NAME in .env; the env
        -- value is now only the seed for this column on a fresh database.
        display_name NVARCHAR(128) NOT NULL,
        is_active   BIT NOT NULL CONSTRAINT DF_line_active DEFAULT 1,
        created_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_line_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_line_code UNIQUE (unit_id, code)
    );
END
GO

-- ---------------------------------------------------------------- machine
IF OBJECT_ID('sms.machine', 'U') IS NULL
BEGIN
    CREATE TABLE sms.machine (
        machine_id  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_machine PRIMARY KEY,
        line_id     INT NOT NULL CONSTRAINT FK_machine_line REFERENCES sms.line(line_id),
        -- The number the acquisition layer writes in MachineNo. NULL for a
        -- machine the source never identifies (the sack packer).
        machine_no  INT NULL,
        kind        VARCHAR(16) NOT NULL,          -- 'winder' | 'packer'
        make        NVARCHAR(64) NULL,             -- 'Rieter', 'Neuenhauser'
        model       NVARCHAR(64) NULL,
        name        NVARCHAR(64) NOT NULL,
        is_active   BIT NOT NULL CONSTRAINT DF_machine_active DEFAULT 1,
        notes       NVARCHAR(255) NULL,
        created_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_machine_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_machine_kind CHECK (kind IN ('winder', 'packer', 'other'))
    );
    -- One row per source machine number per line; the packer's NULL is exempt.
    CREATE UNIQUE INDEX UX_machine_no ON sms.machine (line_id, machine_no) WHERE machine_no IS NOT NULL;
END
GO

-- ---------------------------------------------------------------- station gains its machine
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.station') AND name = 'machine_id')
BEGIN
    ALTER TABLE sms.station ADD
        machine_id  INT NULL CONSTRAINT FK_station_machine REFERENCES sms.machine(machine_id),
        -- how the link was made: 'default_by_number' (this migration), 'admin'
        -- (set in Setup), NULL (unlinked)
        link_source VARCHAR(20) NULL,
        is_active   BIT NOT NULL CONSTRAINT DF_station_active DEFAULT 1;
END
GO

-- ---------------------------------------------------------------- data sources and their tables
IF OBJECT_ID('sms.data_source', 'U') IS NULL
BEGIN
    CREATE TABLE sms.data_source (
        data_source_id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_data_source PRIMARY KEY,
        -- the adapter that reads it; the value every raw/canonical row's
        -- source_system carries. Was the literal 'ifl_sql' at six code sites.
        system_code    VARCHAR(20) NOT NULL,
        role           VARCHAR(20) NOT NULL,      -- 'acquisition' | 'product_master' | 'sack_packing'
        label          NVARCHAR(128) NOT NULL,
        -- which .env block holds the connection: 'IFL_DB' (IFL_DB_SERVER/PORT/
        -- NAME_DATA/USER/PASSWORD) or 'PDAS' (IFL_DB_NAME_PDAS on the same login)
        connection_key VARCHAR(20) NOT NULL,
        is_enabled     BIT NOT NULL CONSTRAINT DF_data_source_enabled DEFAULT 1,
        notes          NVARCHAR(255) NULL,
        created_at_utc DATETIME2(3) NOT NULL CONSTRAINT DF_data_source_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_data_source UNIQUE (system_code, role),
        CONSTRAINT CK_data_source_role CHECK (role IN ('acquisition', 'product_master', 'sack_packing'))
    );
END
GO

IF OBJECT_ID('sms.source_table', 'U') IS NULL
BEGIN
    -- Which physical source table feeds each raw table for a line. The COLUMN
    -- SHAPE of a kind (what pack1 looks like) stays in code — it is the
    -- vendor's schema, fingerprinted per generation — but the NAME is
    -- configuration: IFL's names carry the line ("pack1_TP1U2"), so a second
    -- line is four rows here, not a code change.
    CREATE TABLE sms.source_table (
        source_table_id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_source_table PRIMARY KEY,
        line_id         INT NOT NULL CONSTRAINT FK_source_table_line REFERENCES sms.line(line_id),
        data_source_id  INT NOT NULL CONSTRAINT FK_source_table_source REFERENCES sms.data_source(data_source_id),
        kind            VARCHAR(20) NOT NULL,     -- 'cone' | 'sack' | 'reject_qcs' | 'reject_weight'
        source_table    NVARCHAR(128) NOT NULL,   -- dbo.<name> in the source database
        raw_table       VARCHAR(64) NOT NULL,     -- sms_raw.<name>
        is_enabled      BIT NOT NULL CONSTRAINT DF_source_table_enabled DEFAULT 1,
        created_at_utc  DATETIME2(3) NOT NULL CONSTRAINT DF_source_table_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_source_table_kind UNIQUE (line_id, kind),
        CONSTRAINT CK_source_table_kind CHECK (kind IN ('cone', 'sack', 'reject_qcs', 'reject_weight'))
    );
END
GO

-- ---------------------------------------------------------------- reject codes are per line
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sms.reject_code') AND name = 'line_id')
BEGIN
    ALTER TABLE sms.reject_code ADD line_id INT NOT NULL CONSTRAINT DF_reject_code_line DEFAULT 1;
END
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_reject_code' AND object_id = OBJECT_ID('sms.reject_code'))
   AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                   WHERE ic.object_id = OBJECT_ID('sms.reject_code') AND ic.index_id = (SELECT index_id FROM sys.indexes WHERE name='UX_reject_code' AND object_id = OBJECT_ID('sms.reject_code')) AND c.name = 'line_id')
BEGIN
    DROP INDEX UX_reject_code ON sms.reject_code;
    CREATE UNIQUE INDEX UX_reject_code ON sms.reject_code (line_id, reject_type, tube_code, material_code);
END
GO

-- ---------------------------------------------------------------- seed the installation that exists
-- Everything below is a fact of the current installation; see the header.
IF NOT EXISTS (SELECT 1 FROM sms.plant WHERE code = 'TP1')
    INSERT INTO sms.plant (code, name) VALUES ('TP1', N'TP1');
GO
IF NOT EXISTS (SELECT 1 FROM sms.plant_unit u JOIN sms.plant p ON p.plant_id = u.plant_id WHERE p.code = 'TP1' AND u.code = 'U2')
    INSERT INTO sms.plant_unit (plant_id, code, name)
    SELECT plant_id, 'U2', N'Unit 2' FROM sms.plant WHERE code = 'TP1';
GO
-- line 1 = the line every existing row is stamped with. Its display name is
-- the LINE_NAME default the screens have printed since Phase 1.
IF NOT EXISTS (SELECT 1 FROM sms.line WHERE line_id = 1)
    INSERT INTO sms.line (line_id, unit_id, code, name, display_name)
    SELECT 1, u.unit_id, 'L3', N'Line 3', N'TP1 · Line 3 · Unit 2'
    FROM sms.plant_unit u JOIN sms.plant p ON p.plant_id = u.plant_id WHERE p.code = 'TP1' AND u.code = 'U2';
GO
-- 14 winders (MachineNo 1..14) and the sack packer.
IF NOT EXISTS (SELECT 1 FROM sms.machine WHERE line_id = 1 AND kind = 'winder')
BEGIN
    WITH n AS (SELECT TOP (14) ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS no FROM sys.all_objects)
    INSERT INTO sms.machine (line_id, machine_no, kind, make, name)
    SELECT 1, no, 'winder', N'Rieter', N'Winder ' + CAST(no AS NVARCHAR(4)) FROM n;
END
GO
IF NOT EXISTS (SELECT 1 FROM sms.machine WHERE line_id = 1 AND kind = 'packer')
    INSERT INTO sms.machine (line_id, machine_no, kind, make, name, notes)
    VALUES (1, NULL, 'packer', N'Neuenhauser', N'Sack packer',
            N'No sack row carries a machine number, so this machine links to no station.');
GO
-- Stations 1..14 for line 1. Until now seedReference.ts created them on the
-- worker's first pass with `SELECT TOP (14)`; a fresh database now gets them
-- here, one per winder, and the seed only reconciles (a winder added in Setup
-- with a machine number gets its station row without a code change).
IF NOT EXISTS (SELECT 1 FROM sms.station WHERE line_id = 1)
    INSERT INTO sms.station (station_id, line_id)
    SELECT m.machine_no, 1 FROM sms.machine m WHERE m.line_id = 1 AND m.kind = 'winder' AND m.machine_no IS NOT NULL;
GO
-- Link each station to the winder with the same number, by default, and say
-- so on the row.
UPDATE s
   SET s.machine_id = m.machine_id, s.link_source = 'default_by_number'
  FROM sms.station s
  JOIN sms.machine m ON m.line_id = s.line_id AND m.machine_no = s.station_id AND m.kind = 'winder'
 WHERE s.machine_id IS NULL;
GO
-- The source systems, by role.
IF NOT EXISTS (SELECT 1 FROM sms.data_source WHERE system_code = 'ifl_sql' AND role = 'acquisition')
    INSERT INTO sms.data_source (system_code, role, label, connection_key)
    VALUES ('ifl_sql', 'acquisition', N'IFL weighing acquisition (DATA_TP1U2)', 'IFL_DB');
IF NOT EXISTS (SELECT 1 FROM sms.data_source WHERE system_code = 'ifl_sql' AND role = 'product_master')
    INSERT INTO sms.data_source (system_code, role, label, connection_key)
    VALUES ('ifl_sql', 'product_master', N'IFL product master (PDAS_TP1U2)', 'PDAS');
-- The roadmap names a "Sack Packing database" as a third source. The sack
-- rows SMS reads today come from the acquisition database (sack1_TP1U2);
-- whether a separate Neuenhauser database exists and holds more is a
-- clarification for IFL. Recorded disabled so the question is visible in Setup.
IF NOT EXISTS (SELECT 1 FROM sms.data_source WHERE system_code = 'ifl_sql' AND role = 'sack_packing')
    INSERT INTO sms.data_source (system_code, role, label, connection_key, is_enabled, notes)
    VALUES ('ifl_sql', 'sack_packing', N'Sack packing database (not yet identified)', 'IFL_DB', 0,
            N'Sack rows are read from sack1_TP1U2 in the acquisition database. A separate packing database has not been identified by IFL.');
GO
-- The four tables the worker has read since the September 2026 schema.
IF NOT EXISTS (SELECT 1 FROM sms.source_table WHERE line_id = 1)
BEGIN
    DECLARE @acq INT = (SELECT data_source_id FROM sms.data_source WHERE system_code = 'ifl_sql' AND role = 'acquisition');
    INSERT INTO sms.source_table (line_id, data_source_id, kind, source_table, raw_table) VALUES
        (1, @acq, 'cone',          N'pack1_TP1U2',         'sms_raw.cone_raw'),
        (1, @acq, 'sack',          N'sack1_TP1U2',         'sms_raw.sack_raw'),
        (1, @acq, 'reject_qcs',    N'rejectQCS1_TP1U2',    'sms_raw.reject_qcs_raw'),
        (1, @acq, 'reject_weight', N'rejectWeight1_TP1U2', 'sms_raw.reject_weight_raw');
END
GO
