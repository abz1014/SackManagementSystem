/**
 * Which DQ checks a finding may be acknowledged for (Task W2-B, 29 Sep 2026,
 * failure analysis F-24). Shared between api/src/services/dqAck.ts (which
 * refuses a check not on this list, 409) and any client/test that wants to
 * know the same thing without re-typing the list.
 *
 * THE LINE THIS DRAWS. A DATA-FACT check describes something about the
 * READINGS — a bad weight, a clock skew, a day with too little data, a
 * machine number the roster hasn't caught up with, a source schema that
 * drifted. An engineer who has looked at one of these and can say "yes,
 * this is real and there is nothing more to do about it right now" is
 * making a legitimate, recorded call. A SYSTEM-STATE check describes
 * whether the SOFTWARE ITSELF is working — the sync worker is failing
 * repeatedly, a transform pass silently dropped rows, a PDAS write could
 * not be verified. Acknowledging one of those would let someone silence
 * the one screen whose job is to say the system is broken; they are never
 * on this list, and dqAck.ts refuses them by name as well as by omission
 * (see NEVER_ACKNOWLEDGEABLE below) so a future addition to CHECK_NAMES
 * that is accidentally added to this list still gets a second, explicit
 * refusal check on the system-state names that must never be silenced.
 *
 * Verified against sync-worker/src/transform/dq.ts's own CHECK_NAMES (29
 * Sep 2026) — every name below exists there verbatim; nothing needed
 * renaming.
 */
export const ACKNOWLEDGEABLE_DQ_CHECKS = [
  'nonpositive_weight',
  'stale_timestamp',
  'future_timestamp',
  'isolated_production_day',
  'station_not_in_roster',
  'source_columns_changed',
] as const;

export type AcknowledgeableDqCheck = (typeof ACKNOWLEDGEABLE_DQ_CHECKS)[number];

/**
 * System-state checks (dq.ts's own CRITICAL/ERROR "is the software working"
 * findings, plus the PDAS-write and product-mirror checks raised outside
 * dq.ts's CHECK_NAMES table — see health.ts, pdasWrite.ts,
 * housekeeping.ts). Named explicitly, not just "everything not in
 * ACKNOWLEDGEABLE_DQ_CHECKS", so a reviewer reading this file sees the
 * refusal stated rather than inferred. dqAck.ts's own check is still
 * "on the allow-list", not "not on this list" — this constant exists for
 * documentation and for a belt-and-braces test, not as the enforcement
 * path itself.
 */
export const NEVER_ACKNOWLEDGEABLE_DQ_CHECKS = [
  'persistent_sync_failure',
  'transform_failed',
  'transform_zero_write',
  'raw_read_without_write',
  'product_mirror_failed',
  'pdas_write_unverified',
  'pdas_write_readback_failed',
  'pdas_write_echo_mismatch',
] as const;

export function isAcknowledgeableDqCheck(checkName: string): checkName is AcknowledgeableDqCheck {
  return (ACKNOWLEDGEABLE_DQ_CHECKS as readonly string[]).includes(checkName);
}
