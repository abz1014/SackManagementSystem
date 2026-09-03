/**
 * THE TWO CLOCKS. Read this before comparing any two timestamps in this app.
 *
 * This database holds instants written on two different conventions, and they
 * are five hours apart on this plant:
 *
 *  1. PRODUCTION TIME — `production_ts_utc`, `production_ts_utc_ms`, and every
 *     `shift_date` derived from them. These are IFL's own PLANT WALL CLOCK,
 *     stored with a UTC label because the sync worker reads them with
 *     `useUTC: true`. A cone weighed at 09:57 on the factory floor is stored as
 *     09:57Z, not 04:57Z. See ARCHITECTURE §3 and sync-worker/dq.ts.
 *
 *  2. APP-WRITTEN TIME — `product_timeline.effective_from`, `weight_rule
 *     .effective_from`, `calibration_adjustment.adjusted_at_utc`, session
 *     expiry, `sync_run.finished_at_utc`. These are GENUINE UTC, written by
 *     SQL Server's `SYSUTCDATETIME()` or by Node's `new Date()`.
 *
 * Compare one against the other without converting and everything lands five
 * hours out. Concretely: a product recorded at noon on the factory floor has
 * `effective_from = 07:00Z`, so a naive `production_ts_utc >= effective_from`
 * would attribute five hours of the PREVIOUS product's cones to the new one —
 * and then compute their pass-or-fail against the wrong tolerance. That is a
 * silent wrong answer on the one number IFL's requirement 2 is about.
 *
 * So: any app-written instant that has to be compared against production time
 * is converted here first, and the conversion is named rather than inlined.
 */

/**
 * The plant's offset from UTC, in minutes, as this process sees it.
 *
 * The API runs on the plant PC, so the machine's own timezone IS the plant's —
 * the same assumption live.ts makes for `plantNowMs()`. Taken fresh on every
 * call rather than cached at import, so a daylight-saving change (or a service
 * left running across one) cannot pin the app to a stale offset.
 */
export function plantOffsetMinutes(at: Date = new Date()): number {
  // getTimezoneOffset() is POSITIVE west of Greenwich: UTC+5 reports -300.
  return -at.getTimezoneOffset();
}

/** The plant's wall clock now, encoded the way production_ts_utc_ms is. */
export function plantNowMs(): number {
  return Date.now() + plantOffsetMinutes() * 60_000;
}

/**
 * A genuine UTC instant, re-expressed on the production-time convention so it
 * can be compared with `production_ts_utc_ms`.
 *
 * Example on a UTC+5 plant: 2026-09-02T07:03:58Z (a product recorded at noon
 * plant time) becomes 2026-09-02T12:03:58Z — which is what a cone weighed at
 * noon that day is stored as.
 */
export function toPlantMs(utc: Date | string | number): number {
  const ms = utc instanceof Date ? utc.getTime() : typeof utc === 'number' ? utc : new Date(utc).getTime();
  return ms + plantOffsetMinutes(new Date(ms)) * 60_000;
}

/** The same, as an ISO string on the production-time convention. */
export function toPlantIso(utc: Date | string | number): string {
  return new Date(toPlantMs(utc)).toISOString();
}

/**
 * The inverse: a production-time instant expressed as a genuine UTC instant.
 * Needed when an app row must be written to line up with a reading the user
 * pointed at — for example an adjustment logged "at the time of that cone".
 */
export function fromPlantMs(plantMs: number): number {
  return plantMs - plantOffsetMinutes(new Date(plantMs)) * 60_000;
}
