-- 033_sack_stock_ledger.sql — Roadmap Phase 7 (sack management and stock
-- ledger), 15 Sep 2026. One table: sms.sack_stock_movement, the append-only
-- ledger of sacks entering and leaving LINE stock.
--
-- WHY machine_id IS NULL ON EVERY ROW, AND ENFORCED. IFL's requirement is
-- "sack stock tracking per machine". The data cannot support it, at any
-- layer, in either generation of the source:
--   * sack1_TP1U2 carries id, Date, Shift, Area, SackNum, Weight, inRange and
--     (since 5 Aug 2026) MaterialId — no machine or station column. The raw
--     copy (sms_raw.sack_raw) and the canonical row (sms.sack_event) therefore
--     carry none either; there is nothing to copy.
--   * IFL's own tag table (dbo.t_items) shows the sack PLC publishes FOUR sack
--     tags and no machine tag; the acquisition trigger fires only when all
--     four are present. A machine at the sack scale would be a new PLC tag on
--     IFL's side, not an integration on ours.
--   * Roadmap rule 6 forbids inferring a machine from timestamps (which cones
--     were weighed around the sack): cones between consecutive sacks range
--     0-250 in the real data, and up to six materials run on different
--     machines at once. That inference would be a fabricated attribution.
--   * The question that would settle it (Q28-32: is the machine known at the
--     sack PLC, or is an operator-entered association acceptable) was drafted
--     on 2 Sep 2026 and has NOT been sent.
-- So the column exists (the requirement names it, and the FK is ready) and a
-- CHECK constraint keeps it NULL. No code path sets it. When IFL provides a
-- defensible association, a later migration drops CK_sack_stock_no_machine
-- and the write path that sets it is written against that answer — never
-- before it.
--
-- WHAT "RECEIPT" MEANS HERE — the developer's reading, awaiting IFL. A sack
-- weighed at the packing scale is one receipt INTO line stock; the ledger
-- derives those receipts from sms.sack_event on read (sackStock.ts) and does
-- not store them, so nothing here duplicates a reading. Everything a person
-- records by hand — an opening count, an issue out of stock, consumption, a
-- correction, or a receipt the scale never saw — is a row in this table.
-- IFL may mean by "receipt" empty sacks arriving into a store (which is in no
-- data SMS has), and by "issue" a dispatch that is recorded nowhere today;
-- the words are the developer's and the screen says so.
--
-- UNITS. quantity_sacks is the count and is required; quantity_kg is the
-- weight when known. Whether IFL wants sacks, kg or both, and whether the
-- kg is gross (with the sack) or net, is not confirmed (Q24, Q29). The kg
-- column is nullable for that reason and the ledger reports how many rows
-- lack it rather than inventing a weight.
--
-- TWO CLOCKS (CLAUDE.md rule 2). occurred_at_plant is on the PRODUCTION-time
-- convention — the plant's wall clock labelled UTC, the same convention as
-- sack_event.production_ts_utc — so a movement can be placed among readings
-- without conversion. recorded_at_utc is genuine UTC, like every app-written
-- instant. production_day is the day the movement is counted against, derived
-- at write time from occurred_at_plant under the line's shift rule (06:00-
-- 06:00 by default), the same rule that stamps shift_date on every sack — so
-- the ledger's day axis is the sack register's. A later change to the shift
-- rule rebuilds sack_event but not this table; the API states the rule it
-- applied and the day it chose on every row it returns.
--
-- sack_event_id: reserved for a receipt tied to one weighed sack, unique
-- where set so a sack can never be received twice. No code path writes it
-- today either: derived receipts are computed on read. No foreign key on
-- purpose — `sms rebuild` deletes and re-inserts sack_event, and its identity
-- values change; an FK here would block the rebuild, and a stored id would
-- dangle after it. If receipts are ever materialised, the rebuild must
-- re-key them (a documented cost, not a hidden one).
--
-- Append-only by convention, like calibration_adjustment (015): a mistake is
-- corrected by an 'adjustment' row that says why, never by an UPDATE. Every
-- manual row is written through auditedWrite (one transaction with its
-- sms.audit_log row, action 'stock.movement').
--
-- Idempotent: safe to re-run.

IF OBJECT_ID('sms.sack_stock_movement', 'U') IS NULL
BEGIN
    CREATE TABLE sms.sack_stock_movement (
        movement_id       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sack_stock_movement PRIMARY KEY,
        line_id           INT NOT NULL CONSTRAINT FK_sack_stock_line REFERENCES sms.line(line_id),
        -- Always NULL: see the header. The FK is ready for the day IFL provides
        -- a defensible association; the CHECK below is what keeps it honest
        -- until then.
        machine_id        INT NULL CONSTRAINT FK_sack_stock_machine REFERENCES sms.machine(machine_id),
        -- sms.product mirror row (PDAS MaterialId). No FK, as on sack_event: a
        -- material the mirror has not seen yet must not refuse a movement.
        material_id       INT NULL,
        movement_type     VARCHAR(12) NOT NULL,
        quantity_sacks    INT NOT NULL,
        quantity_kg       DECIMAL(12,3) NULL,
        sack_event_id     BIGINT NULL,
        occurred_at_plant DATETIME2(3) NOT NULL,
        production_day    DATE NOT NULL,
        recorded_at_utc   DATETIME2(3) NOT NULL CONSTRAINT DF_sack_stock_recorded DEFAULT SYSUTCDATETIME(),
        recorded_by       INT NULL CONSTRAINT FK_sack_stock_user REFERENCES sms.app_user(user_id),
        source            VARCHAR(10) NOT NULL,
        reason            NVARCHAR(255) NULL,
        CONSTRAINT CK_sack_stock_type CHECK (movement_type IN ('opening', 'receipt', 'issue', 'consumption', 'adjustment')),
        CONSTRAINT CK_sack_stock_source CHECK (source IN ('derived', 'manual')),
        -- No machine on any row until IFL answers; a later migration drops this.
        CONSTRAINT CK_sack_stock_no_machine CHECK (machine_id IS NULL),
        -- A movement moves something. Only a correction may be negative: an
        -- issue of -3 sacks is a receipt written the wrong way round, and the
        -- ledger would read it as one while its type said otherwise.
        CONSTRAINT CK_sack_stock_qty CHECK (quantity_sacks <> 0 AND (movement_type = 'adjustment' OR quantity_sacks > 0))
    );

    -- One receipt per weighed sack, when receipts are ever materialised.
    CREATE UNIQUE INDEX UX_sack_stock_sack_event
        ON sms.sack_stock_movement (sack_event_id) WHERE sack_event_id IS NOT NULL;

    -- The ledger reads a line's movements in time order, and by day.
    CREATE INDEX IX_sack_stock_line_time
        ON sms.sack_stock_movement (line_id, occurred_at_plant);
    CREATE INDEX IX_sack_stock_line_day
        ON sms.sack_stock_movement (line_id, production_day) INCLUDE (material_id, movement_type, quantity_sacks, quantity_kg);
END
GO
