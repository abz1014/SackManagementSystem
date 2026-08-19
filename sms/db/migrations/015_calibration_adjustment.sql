-- 015_calibration_adjustment.sql — Phase 5 calibration advisory (roadmap
-- table): the ledger half of "flag a drifting scale, then let someone record
-- that it was fixed." The drift detection itself (Nelson rules on the X-bar
-- chart, per-station daily-drift view) needs no new storage — it is computed
-- fresh from cone_event/sack_event on every request, same as every other SPC
-- figure in this app. This table is the one piece that genuinely needs a
-- place to live: nothing else records that a station's scale was adjusted.
--
-- Append-only, same convention as every other config table (weight_rule,
-- shift_rule, plausibility_rule, product_timeline): a correction is a new
-- row, never an UPDATE.
IF OBJECT_ID('sms.calibration_adjustment', 'U') IS NULL
BEGIN
    CREATE TABLE sms.calibration_adjustment (
        adjustment_id    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_calibration_adjustment PRIMARY KEY,
        line_id          INT NOT NULL,
        station_id       INT NULL,   -- NULL = a whole-line adjustment (not one station's scale)
        adjusted_at_utc  DATETIME2(3) NOT NULL,   -- when the physical adjustment happened
        recorded_at_utc  DATETIME2(3) NOT NULL CONSTRAINT DF_calib_adj_recorded DEFAULT SYSUTCDATETIME(),
        recorded_by      INT NULL CONSTRAINT FK_calib_adj_user REFERENCES sms.app_user(user_id),
        reason           NVARCHAR(255) NULL,
        note             NVARCHAR(500) NULL
    );
    CREATE INDEX IX_calib_adj_line_station ON sms.calibration_adjustment (line_id, station_id, adjusted_at_utc DESC);
END
GO
