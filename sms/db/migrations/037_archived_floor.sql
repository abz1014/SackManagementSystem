-- 037_archived_floor.sql — the low-water mark that keeps `sms verify` from
-- becoming a permanent false alarm the day IFL prunes its own oldest rows.
--
-- THE DEFECT THIS FIXES. `sms verify` compared source ⇄ raw as COUNT, MIN(id),
-- MAX(id) and SUM(id) over the WHOLE source table, no predicate. The sidecar's
-- entire reason to exist is to keep what IFL discards after about a month
-- (SEPT-2026-EPOCH-DECISION.md). So the day IFL prunes even its first row,
-- src.n < raw.n, src.lo > raw.lo and src.sum < raw.sum — all three, forever —
-- and verify exits 1 permanently on exactly the rows the product is FOR. An
-- alarm that is always on is no alarm, and this is the failure most likely to
-- happen live, in front of the client, during cutover.
--
-- WHAT THIS ADDS. Two nullable columns on sms.source_epoch, scoped to one
-- (line, source table, generation) row same as every other epoch fact:
--
--   archived_below_id      The lowest source id SMS has, on some past sync
--                           pass, actually OBSERVED the live source still
--                           holding — i.e. "the source no longer holds ids
--                           below this value; SMS does, and that gap is
--                           archiving working as designed, not data loss."
--                           NULL until the first observation for this (open)
--                           generation.
--   archived_observed_utc  WHEN the floor was last RAISED (not merely
--                           re-observed at the same value) — genuine app UTC
--                           (the Two Clocks rule; CLAUDE.md), never the
--                           plant wall clock.
--
-- WHO WRITES IT. sync-worker/src/epoch.ts, observeArchivedFloor(), called from
-- resolveEpoch() once per table per sync pass, after the pass has already
-- confirmed (via the existing identity/schema checks) that the source is the
-- SAME generation this epoch describes. A RISING min raises the floor with a
-- guarded UPDATE (two overlapping passes cannot lower what either observed).
-- A FALLING min — ids do not come back once pruned, so this can only be a
-- reseed, a restore, or a rebuild below a floor already observed — HALTS the
-- table's pass instead of silently lowering the floor to match; see the
-- comment on observeArchivedFloor for why that halt is not swallowed while a
-- mere failure-to-read this pass is.
--
-- WHO READS IT. cli/src/commands/verify.ts: an open epoch's id-checksum
-- reconciliation is scoped to [archived_below_id, ∞) instead of the whole
-- table when the floor has been observed, and the rows below it are reported
-- as an accounted-for remainder — with the observed date, from this column —
-- rather than as a discrepancy. NULL (no observation yet) falls back to
-- today's whole-table comparison, unchanged.
--
-- Guarded (IF COL_LENGTH ... IS NULL), matching migration 036's style.
-- Nullable and without a default, same reasoning as source_epoch's other
-- nullable columns (migration 025/029): this is metadata only, so the ALTER
-- is instant even against a live table, and NULL here is a true, meaningful
-- state ("not yet observed") rather than something a default should paper
-- over.
--
-- Idempotent: safe to re-run.

IF COL_LENGTH('sms.source_epoch', 'archived_below_id') IS NULL
BEGIN
    ALTER TABLE sms.source_epoch ADD archived_below_id BIGINT NULL;
END
GO

IF COL_LENGTH('sms.source_epoch', 'archived_observed_utc') IS NULL
BEGIN
    ALTER TABLE sms.source_epoch ADD archived_observed_utc DATETIME2(3) NULL;
END
GO
