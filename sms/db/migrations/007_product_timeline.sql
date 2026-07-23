-- 007_product_timeline.sql — time-versioned product attribution (ARCHITECTURE §6).
-- APPEND-ONLY. Never UPDATE or DELETE. Events join to the interval covering their
-- production time. effective_from (actual change) is distinct from changed_at (recorded).

IF OBJECT_ID('sms.product_timeline', 'U') IS NULL
BEGIN
    CREATE TABLE sms.product_timeline (
        timeline_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_timeline PRIMARY KEY,
        line_id         INT NOT NULL,
        product_id      INT NOT NULL,           -- sms.product
        effective_from  DATETIME2(3) NOT NULL,  -- when production ACTUALLY changed (may be backdated)
        changed_at      DATETIME2(3) NOT NULL CONSTRAINT DF_ptl_chg DEFAULT SYSUTCDATETIME(), -- when RECORDED
        changed_by      INT NULL,               -- sms.app_user
        reason          NVARCHAR(255) NULL,
        superseded      BIT NOT NULL CONSTRAINT DF_ptl_superseded DEFAULT 0  -- soft-correct without delete
    );
    -- fast "which product was effective at time T" lookups
    CREATE INDEX IX_ptl_effective ON sms.product_timeline (line_id, effective_from DESC);
END
GO
