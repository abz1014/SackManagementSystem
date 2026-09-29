-- 042_dq_acknowledgement.sql — Task W2-B (29 Sep 2026): let an engineer
-- acknowledge a known DATA-FACT finding so Health is not permanently amber
-- over a condition someone has already looked at and decided is not
-- actionable (e.g. a single clock-fault day, a station the roster has not
-- caught up with yet).
--
-- One row per ACKNOWLEDGED FINDING, not per check. `sms.dq_finding` has no
-- resolved/cleared flag (migration 009's own comment: "every row is a
-- standing fact until whatever wrote it stops finding the condition") and
-- this migration does not change that — dq_finding is still the raw,
-- unedited record of what the worker found. Acknowledgement is a SEPARATE
-- fact layered on top: this specific finding_id, on this date, by this
-- person, for this reason. If the same check fires again on a NEW
-- finding_id (a fresh finding_id DESC row raised by the next pass — see
-- health.ts's dqBlockingFindings and operations.ts's DQ roll-up, both of
-- which read the current standing rows, not a history), it is NOT
-- acknowledged until someone acknowledges that one too. This is
-- deliberate, not an oversight: an acknowledgement is a judgement about
-- the row someone actually read, not a standing exemption for the check
-- name.
--
-- ALLOW-LIST ENFORCEMENT IS APPLICATION-SIDE, not a CHECK constraint here.
-- shared/src/dqAck.ts names the six DATA-FACT checks that may be
-- acknowledged (nonpositive_weight, stale_timestamp, future_timestamp,
-- isolated_production_day, station_not_in_roster, source_columns_changed)
-- and api/src/services/dqAck.ts enforces it before this table is touched —
-- a DB-level CHECK on check_name would need dq_finding joined in, and the
-- allow-list is a product decision that may change without a migration.
--
-- Idempotent: safe to re-run, follows migration 041's guard style.

IF OBJECT_ID('sms.dq_acknowledgement', 'U') IS NULL
BEGIN
    CREATE TABLE sms.dq_acknowledgement (
        finding_id      BIGINT        NOT NULL CONSTRAINT PK_dq_acknowledgement PRIMARY KEY,
        acknowledged_by INT           NOT NULL,
        acknowledged_utc DATETIME2(3) NOT NULL CONSTRAINT DF_dq_ack_utc DEFAULT SYSUTCDATETIME(),
        reason          NVARCHAR(500) NOT NULL,
        CONSTRAINT FK_dq_ack_finding FOREIGN KEY (finding_id) REFERENCES sms.dq_finding (finding_id),
        CONSTRAINT FK_dq_ack_user FOREIGN KEY (acknowledged_by) REFERENCES sms.app_user (user_id)
    );
END
GO
