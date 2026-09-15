/**
 * The plant's wall clock, as this process's own OS timezone sees it.
 *
 * Moved here for finding L2 (Sep 2026 audit): the identical formula used to
 * exist as THREE independent copies — api/services/plantClock.ts,
 * api/services/live.ts, and sync-worker/transform/dq.ts — arithmetically
 * equivalent today but with nothing keeping them that way across an edit to
 * only one. api and sync-worker are separate packages, so a shared home is
 * the only way to have exactly one definition rather than one per package.
 * api/services/plantClock.ts re-exports this rather than redefining it; its
 * own toPlantMs/toPlantIso/fromPlantMs conversions (for comparing app-written
 * UTC instants against production timestamps) stay there — they are used
 * only by the API.
 *
 * checkPlantOffset (below plantNowMs) is the same story one level up: the
 * cross-check that catches a deployment host whose OS timezone does not
 * actually match the plant's, needed by the API and, since roadmap H7 (15
 * Sep 2026), by the sync worker too.
 */

/**
 * The plant's offset from UTC, in minutes, as this process sees it.
 *
 * The assumption is that this process runs on the plant PC, so the machine's
 * own timezone IS the plant's. Taken fresh on every call rather than cached
 * at import, so a daylight-saving change (or a service left running across
 * one) cannot pin the app to a stale offset.
 */
export function plantOffsetMinutes(at: Date = new Date()): number {
  // getTimezoneOffset() is POSITIVE west of Greenwich: UTC+5 reports -300.
  //
  // `0 - x`, not `-x`: on a UTC host the offset is 0 and unary minus turns it
  // into -0. Every arithmetic use is indifferent, but Object.is(-0, 0) is
  // false, so `expect(...).toBe(...)` on a value derived from this failed on
  // any zero-offset machine — found 14 Sep 2026 when an adversarial check ran
  // the suite under TZ=UTC, which is what GitHub's ubuntu-latest runner is.
  // The development machine (UTC+5) never saw it.
  return 0 - at.getTimezoneOffset();
}

/** The plant's wall clock now, encoded the way production_ts_utc_ms is. */
export function plantNowMs(): number {
  return Date.now() + plantOffsetMinutes() * 60_000;
}

/* -------------------------------------------------- host/plant offset cross-check */

/**
 * The result of comparing PLANT_UTC_OFFSET_MINUTES against the offset this
 * process's OS actually reports. A plain data object rather than a
 * log-and-return function: the API and the sync worker each decide for
 * themselves how loudly to surface a mismatch (roadmap H7, 15 Sep 2026 —
 * see api/src/index.ts and sync-worker/src/index.ts), and a test can assert
 * on the numbers without capturing a logger.
 */
export interface PlantOffsetCheck {
  /** False when nothing was configured to compare against (PLANT_UTC_OFFSET_MINUTES unset) — the check did not run. */
  checked: boolean;
  /** True only when `checked` and the two offsets disagree. */
  mismatched: boolean;
  /** This process's own OS-reported offset, always present. */
  hostOffsetMinutes: number;
  /** The configured plant offset, present only when `checked`. */
  plantOffsetMinutes: number | undefined;
  /** `hostOffsetMinutes - plantOffsetMinutes`, present only when `mismatched`. */
  offsetMismatchMinutes: number | undefined;
  /** Human-readable: the mismatch sentence when mismatched, the skip reason when unset, a short confirmation when checked and matching. */
  message: string;
}

/**
 * Cross-checks PLANT_UTC_OFFSET_MINUTES (if set) against this host's own OS
 * timezone (finding M6, Sep 2026 audit). plantOffsetMinutes()'s whole
 * two-clocks design — and by extension every production/app-time comparison
 * in this app: product changeovers, calibration adjustments, live status —
 * assumes the deployment host's timezone equals the plant's; nothing
 * previously verified that, and a mismatch fails silently by exactly the
 * offset (five hours on this plant). This is that verification, shared so
 * BOTH processes that stamp or compare plant time run it: the API always
 * has (api/src/index.ts), and the sync worker — which is what actually
 * stamps production_ts_utc_ms on every ingested row, and so needed this at
 * least as much — now does too (sync-worker/src/index.ts).
 *
 * `hostOffsetMinutes` is a parameter, not read internally via
 * `plantOffsetMinutes()`, so this function is a pure comparison: a test
 * supplies both numbers explicitly and gets a deterministic answer,
 * regardless of the machine the suite happens to run on. Each call site
 * passes `plantOffsetMinutes()` for real use.
 *
 * Never throws and never logs — see the two call sites for what "wrong"
 * costs in each process. Neither treats a mismatch as fatal: a hard refusal
 * that fires on a misconfigured-but-otherwise-working plant PC — the owner
 * supplies this machine, per IFL's 15 Sep answer, and a freshly imaged
 * Windows Server defaults to UTC — would be worse than the silent bug it
 * replaces.
 */
export function checkPlantOffset(expectedMinutes: number | undefined, hostOffsetMinutes: number = plantOffsetMinutes()): PlantOffsetCheck {
  if (expectedMinutes == null) {
    return {
      checked: false,
      mismatched: false,
      hostOffsetMinutes,
      plantOffsetMinutes: undefined,
      offsetMismatchMinutes: undefined,
      message: 'PLANT_UTC_OFFSET_MINUTES is not set; skipping the host-timezone cross-check.',
    };
  }
  if (hostOffsetMinutes === expectedMinutes) {
    return {
      checked: true,
      mismatched: false,
      hostOffsetMinutes,
      plantOffsetMinutes: expectedMinutes,
      offsetMismatchMinutes: undefined,
      message: `plantClock: this host's OS timezone offset (${hostOffsetMinutes} minutes) matches PLANT_UTC_OFFSET_MINUTES.`,
    };
  }
  const offsetMismatchMinutes = hostOffsetMinutes - expectedMinutes;
  return {
    checked: true,
    mismatched: true,
    hostOffsetMinutes,
    plantOffsetMinutes: expectedMinutes,
    offsetMismatchMinutes,
    message:
      `plantClock: this host's OS timezone reports a UTC offset of ${hostOffsetMinutes} minutes, ` +
      `but PLANT_UTC_OFFSET_MINUTES says the plant is at ${expectedMinutes}. Every production/app-time ` +
      `comparison in this app (product changeovers, calibration adjustments, live status) will be off by ` +
      `${offsetMismatchMinutes} minutes until this host's timezone matches the plant's.`,
  };
}
