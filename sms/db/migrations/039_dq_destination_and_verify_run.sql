-- 039_dq_destination_and_verify_run.sql — UX Phase 7 Brief 2 (21 Sep 2026):
-- two things the app-owned sidecar needed and did not have.
--
-- PART 1 — an index the DQ-destination resolver needs. `GET
-- /api/dq-destination` (api/src/services/operations.ts) answers "where did
-- this finding's offending row land" by looking up a canonical row by
-- (line_id, raw_id) — cone_event.raw_id/sack_event.raw_id/reject_event.raw_id
-- already exist (003_cone_event.sql:48, 004_sack_event.sql:36,
-- 008_reject_event.sql:32) but no index covers that pair; every lookup would
-- be a clustered-index scan. This is our OWN sidecar, not IFL's DATA_TP1U2 —
-- Q21's no-index rule (CLAUDE.md) is about the client's database and does
-- not apply here.
--
-- PART 2 — sms.verify_run. `sms verify` (cli/src/commands/verify.ts)
-- reconciles source ⇄ raw ⇄ canonical every time it is run and, until this
-- migration, PERSISTED NOTHING — grep for INSERT/UPDATE in that file
-- returned nothing. The application could therefore never say whether it
-- had ever been reconciled against IFL's source, only what the last
-- terminal output happened to show a human who was watching at the time.
-- One row per run, written at the end of verify() (never mid-run, and never
-- on the exit code — a failure to record must not change what `sms verify`
-- reports to its caller):
--
--   started_at_utc / finished_at_utc   genuine app-written UTC (the Two
--                                      Clocks rule, CLAUDE.md) — NOT the
--                                      plant wall clock; a verify run is an
--                                      app-side event, not a production one.
--   source_server / source_db          ctx.cfg.iflData.server/.database —
--                                      the same two facts verify() already
--                                      PRINTS at verify.ts:457, now recorded
--                                      so a run against the local `_SEP07`
--                                      copy can never be mistaken for a run
--                                      against the plant.
--   app_server / app_db                ctx.cfg.app.server/.database, ditto
--                                      (verify.ts:458).
--   line_id                            which line this run reconciled.
--   stops                              the STOP count verify() already
--                                      tallies; 0 stops = verdict 'clean'.
--   weights_checked                    whether --weights ran too.
--   window_from / window_to            the --from/--to production-day window,
--                                      when one was given; NULL = whole table.
--   verdict                            'clean' | 'stops' — derived from stops,
--                                      never a separate judgement call.
--   summary                            a short human sentence, NVARCHAR so it
--                                      can hold the "N generations, M STOPs"
--                                      shape without a schema change later.
--   sms_version                        package.json's version at run time,
--                                      so an old build's clean run is not
--                                      read as reconciling today's code.
--
-- Nullable line_id would be wrong (every run reconciles one line); every
-- other nullable column above is nullable because the corresponding CLI
-- flag is optional, not because the fact is ever unknown once the row is
-- written.
--
-- Idempotent: safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cone_event_line_raw' AND object_id = OBJECT_ID('sms.cone_event'))
BEGIN
    CREATE INDEX IX_cone_event_line_raw ON sms.cone_event (line_id, raw_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sack_event_line_raw' AND object_id = OBJECT_ID('sms.sack_event'))
BEGIN
    CREATE INDEX IX_sack_event_line_raw ON sms.sack_event (line_id, raw_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reject_event_line_raw' AND object_id = OBJECT_ID('sms.reject_event'))
BEGIN
    CREATE INDEX IX_reject_event_line_raw ON sms.reject_event (line_id, raw_id);
END
GO

IF OBJECT_ID('sms.verify_run', 'U') IS NULL
BEGIN
    CREATE TABLE sms.verify_run (
        verify_run_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_verify_run PRIMARY KEY,
        started_at_utc    DATETIME2(3)  NOT NULL,
        finished_at_utc   DATETIME2(3)  NULL,
        source_server     NVARCHAR(128) NOT NULL,
        source_db         NVARCHAR(128) NOT NULL,
        app_server        NVARCHAR(128) NOT NULL,
        app_db            NVARCHAR(128) NOT NULL,
        line_id           INT           NOT NULL,
        stops             INT           NOT NULL,
        weights_checked   BIT           NOT NULL CONSTRAINT DF_verify_run_weights DEFAULT 0,
        window_from       DATETIME2(3)  NULL,
        window_to         DATETIME2(3)  NULL,
        verdict           VARCHAR(10)   NOT NULL CONSTRAINT CK_verify_run_verdict CHECK (verdict IN ('clean', 'stops')),
        summary           NVARCHAR(1000) NULL,
        sms_version       VARCHAR(32)   NULL
    );

    CREATE INDEX IX_verify_run_line_started ON sms.verify_run (line_id, started_at_utc DESC);
END
GO
