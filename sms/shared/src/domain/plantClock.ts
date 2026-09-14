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
  return -at.getTimezoneOffset();
}

/** The plant's wall clock now, encoded the way production_ts_utc_ms is. */
export function plantNowMs(): number {
  return Date.now() + plantOffsetMinutes() * 60_000;
}
