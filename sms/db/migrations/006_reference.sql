-- 006_reference.sql — reference-data as REAL entities (ARCHITECTURE §5).
-- Rule tables are append-only + versioned (effective_from, changed_by, reason);
-- never UPDATE. Read-time logic picks the row in effect for a given timestamp.

-- unit -----------------------------------------------------------------------
IF OBJECT_ID('sms.unit', 'U') IS NULL
BEGIN
    CREATE TABLE sms.unit (
        unit_code   VARCHAR(8)  NOT NULL CONSTRAINT PK_unit PRIMARY KEY,  -- 'kg' | 'g'
        display     NVARCHAR(20) NOT NULL,
        base_factor DECIMAL(18,6) NOT NULL   -- to grams: g=1, kg=1000
    );
END
GO

-- station (Source/Lifter 1..14) — labels pending Q11 -------------------------
IF OBJECT_ID('sms.station', 'U') IS NULL
BEGIN
    CREATE TABLE sms.station (
        station_id   INT NOT NULL,
        line_id      INT NOT NULL,
        name         NVARCHAR(64) NULL,     -- e.g. 'East Conveyor' (pending Q11)
        machine      NVARCHAR(64) NULL,
        description  NVARCHAR(255) NULL,
        CONSTRAINT PK_station PRIMARY KEY (line_id, station_id)
    );
END
GO

-- reject_code lookup — labels pending Q10; raw codes always retained ---------
IF OBJECT_ID('sms.reject_code', 'U') IS NULL
BEGIN
    CREATE TABLE sms.reject_code (
        reject_code_id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_reject_code PRIMARY KEY,
        reject_type    VARCHAR(10) NOT NULL,     -- 'quality' | 'weight'
        tube_code      INT NULL,                 -- raw TubeInspectResult
        material_code  INT NULL,                 -- raw MaterialInspectResult
        label          NVARCHAR(128) NULL,       -- NULL until IFL answers Q10
        is_pass        BIT NULL,
        severity       VARCHAR(10) NULL          -- optional: INFO|WARNING|ERROR|CRITICAL
    );
    CREATE UNIQUE INDEX UX_reject_code ON sms.reject_code (reject_type, tube_code, material_code);
END
GO

-- shift_rule (versioned) — boundaries confirmed Q8; mode/night pending Q7 -----
IF OBJECT_ID('sms.shift_rule', 'U') IS NULL
BEGIN
    CREATE TABLE sms.shift_rule (
        shift_rule_id   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_shift_rule PRIMARY KEY,
        line_id         INT NOT NULL,
        morning_start   TIME(0) NOT NULL,         -- 06:00
        evening_start   TIME(0) NOT NULL,         -- 14:00
        night_start     TIME(0) NOT NULL,         -- 22:00
        mode            VARCHAR(10) NOT NULL,     -- 'corrected' | 'legacy'
        night_belongs_to VARCHAR(15) NOT NULL,    -- 'start_day' | 'calendar_day'
        effective_from  DATETIME2(3) NOT NULL,
        changed_at      DATETIME2(3) NOT NULL CONSTRAINT DF_shift_rule_chg DEFAULT SYSUTCDATETIME(),
        changed_by      INT NULL,
        reason          NVARCHAR(255) NULL
    );
END
GO

-- weight_rule (versioned) — pending Q4/Q5 -----------------------------------
IF OBJECT_ID('sms.weight_rule', 'U') IS NULL
BEGIN
    CREATE TABLE sms.weight_rule (
        weight_rule_id  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_weight_rule PRIMARY KEY,
        line_id         INT NOT NULL,
        basis           VARCHAR(12) NOT NULL,     -- 'as_recorded' | 'gross' | 'net'
        cone_tube_weight_g DECIMAL(10,2) NOT NULL,
        sack_tare_kg    DECIMAL(10,3) NOT NULL,
        effective_from  DATETIME2(3) NOT NULL,
        changed_at      DATETIME2(3) NOT NULL CONSTRAINT DF_weight_rule_chg DEFAULT SYSUTCDATETIME(),
        changed_by      INT NULL,
        reason          NVARCHAR(255) NULL
    );
END
GO

-- product master (mirrored from PDAS; seed rows 1..10 filtered at sync) -------
IF OBJECT_ID('sms.blend', 'U') IS NULL
BEGIN
    CREATE TABLE sms.blend (
        blend_id   INT NOT NULL CONSTRAINT PK_blend PRIMARY KEY,
        blend      NVARCHAR(255) NOT NULL
    );
END
GO
IF OBJECT_ID('sms.yarn_count', 'U') IS NULL
BEGIN
    CREATE TABLE sms.yarn_count (
        count_id   INT NOT NULL CONSTRAINT PK_yarn_count PRIMARY KEY,
        count_val  INT NULL,                 -- Counts.Count cast to int (SCHEMA rule)
        count_text NVARCHAR(255) NOT NULL
    );
END
GO
IF OBJECT_ID('sms.tube_type', 'U') IS NULL
BEGIN
    CREATE TABLE sms.tube_type (
        tube_type_id INT NOT NULL CONSTRAINT PK_tube_type PRIMARY KEY,
        tube_type    NVARCHAR(255) NOT NULL,
        tube_weight_g DECIMAL(10,2) NULL
    );
END
GO
IF OBJECT_ID('sms.product', 'U') IS NULL
BEGIN
    CREATE TABLE sms.product (
        product_id     INT NOT NULL CONSTRAINT PK_product PRIMARY KEY,  -- PDAS MaterialId
        blend_id       INT NULL,
        count_id       INT NULL,
        tube_type_id   INT NULL,
        setpoint_weight_g DECIMAL(10,2) NULL,
        active_flag    BIT NULL,             -- PDAS MaterialActive (informational only)
        description    NVARCHAR(255) NULL,
        lot_code       NVARCHAR(64) NULL
    );
END
GO
