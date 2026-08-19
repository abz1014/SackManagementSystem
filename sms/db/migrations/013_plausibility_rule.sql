-- 013_plausibility_rule.sql — the cone/sack plausibility window as an
-- app-owned rule, not a code constant.
--
-- Before this, the bounds that separate a real reading from a scale fault
-- (cone 1500-2100g, sack 40-60kg) were hardcoded in two places — spc.ts's
-- PLAUSIBLE object (both bounds, used to exclude non-readings from SPC) and
-- weights.ts's CONE_OUT/SACK_OUT (lower bound only, used to list outliers
-- separately from the giveaway stats). Both read from this one table now.
-- Versioned and append-only, same pattern as weight_rule/shift_rule: a change
-- writes a new effective row rather than overwriting the last one.
IF OBJECT_ID('sms.plausibility_rule', 'U') IS NULL
BEGIN
    CREATE TABLE sms.plausibility_rule (
        plausibility_rule_id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_plausibility_rule PRIMARY KEY,
        line_id         INT NOT NULL,
        cone_lo_g       DECIMAL(10,2) NOT NULL,
        cone_hi_g       DECIMAL(10,2) NOT NULL,
        sack_lo_kg      DECIMAL(10,3) NOT NULL,
        sack_hi_kg      DECIMAL(10,3) NOT NULL,
        effective_from  DATETIME2(3) NOT NULL,
        changed_at      DATETIME2(3) NOT NULL CONSTRAINT DF_plausibility_rule_chg DEFAULT SYSUTCDATETIME(),
        changed_by      INT NULL,
        reason          NVARCHAR(255) NULL
    );
END
GO
