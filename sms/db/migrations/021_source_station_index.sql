-- 021_source_station_index.sql
-- Fixes finding M1 (Sep 2026 audit): station-drift, live, and SPC queries
-- group cone_event/reject_event by source_station (e.g. weightStations.ts's
-- rejectRatesByStation, live.ts's per-station activity), and neither table's
-- existing indexes (003_cone_event.sql's IX_cone_prod_ts/IX_cone_shift_date/
-- IX_cone_source/UX_cone_merge, 008_reject_event.sql's equivalents) cover
-- source_station. Invisible at the real copy's ~200k rows; a real scan cost
-- once a year or two of history accumulates.

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('sms.cone_event') AND name = 'IX_cone_line_station_shift'
)
BEGIN
    CREATE INDEX IX_cone_line_station_shift
        ON sms.cone_event (line_id, source_station, shift_date)
        INCLUDE (weight_g, in_range, production_ts_utc_ms);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('sms.reject_event') AND name = 'IX_reject_line_station_shift'
)
BEGIN
    CREATE INDEX IX_reject_line_station_shift
        ON sms.reject_event (line_id, source_station, shift_date)
        INCLUDE (reject_type, weight_g, production_ts_utc_ms);
END
GO
