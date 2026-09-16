/**
 * Pareto arithmetic for the Rejects screen's reason list (roadmap UX Phase 5
 * Brief 4, unit U4, 16 Sep 2026).
 *
 * The server (`api/src/services/rejects.ts:216`) already sorts reasons by
 * count DESC and stamps each one with its running `cumulativePct` — the same
 * shape the report screen (`screens/report/Reject.tsx:57`) already prints.
 * This module answers one further, purely arithmetic question the screen
 * asks of that same list: how many of the leading reasons — the "vital few"
 * — already account for most of the rejects.
 *
 * Kept pure and total: no fetch, no formatting, no reject-code knowledge.
 * Reject code MEANINGS are an unanswered IFL question (Q10); this function
 * never looks at a label, only at count/cumulativePct.
 */

/** The shape `vitalFew` needs — a subset of `RejectReason` (see `api.ts`). */
export interface ParetoRow {
  cumulativePct: number;
}

/**
 * The smallest k such that the k-th row's cumulativePct reaches `thresholdPct`
 * (default 80).
 *
 * Assumes `rows` is already sorted by count DESC with `cumulativePct` running,
 * exactly as `/api/rejects` returns it — this function does not sort or
 * recompute the running total itself, so a caller handing it an unsorted or
 * un-accumulated list gets a meaningless answer back (garbage in, garbage
 * out; there is nothing here to validate that cheaply without duplicating the
 * server's own accumulation).
 *
 * Documented edge cases, both total rather than thrown:
 * - Empty list: returns 0. There is no "vital few" among no reasons, and 0 is
 *   the honest count, not a fabricated 1.
 * - No row's cumulativePct ever reaches the threshold (rounding, or a
 *   threshold above 100): returns `rows.length` — every reason is "vital",
 *   which is the correct reading of "all of them together do not even reach
 *   the threshold you asked for."
 */
export function vitalFew(rows: readonly ParetoRow[], thresholdPct = 80): number {
  if (rows.length === 0) return 0;
  const idx = rows.findIndex((r) => r.cumulativePct >= thresholdPct);
  return idx === -1 ? rows.length : idx + 1;
}
