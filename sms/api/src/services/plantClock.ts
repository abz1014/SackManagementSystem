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
 *
 * plantOffsetMinutes/plantNowMs themselves now live in @sms/shared (finding
 * L2, Sep 2026 audit): the identical formula used to exist as three
 * independent copies — here, in live.ts, and in sync-worker's dq.ts — because
 * api and sync-worker are separate packages and this file isn't visible to
 * the latter. Re-exported below so every existing import of them from this
 * module keeps working unchanged.
 */
export { plantOffsetMinutes, plantNowMs } from '@sms/shared';
import { plantOffsetMinutes } from '@sms/shared';

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

/* ---------------------------------------------- consecutive production days */

const DAY_MS = 86_400_000;

/**
 * Whole calendar days from `earlier` to `later`, both production dates
 * (`shift_date`, as YYYY-MM-DD). 0 for the same day, 1 for the day after,
 * negative when the two are the wrong way round. A production date is a
 * calendar date on the plant's clock and carries no time of day, so the
 * arithmetic is anchored at noon UTC, where no offset can push either date
 * across a midnight.
 */
export function productionDaysApart(earlier: string, later: string): number {
  const a = new Date(`${earlier}T12:00:00Z`).getTime();
  const b = new Date(`${later}T12:00:00Z`).getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * THE ONE DEFINITION OF "CONSECUTIVE" FOR EVERYTHING THAT COUNTS DAYS IN A ROW.
 *
 * True when `next` is the production day after `prev` — or the same day, which
 * is to say there is no calendar gap between them. Every run this application
 * reports — the station table's days held, the attention list's "for D days",
 * the Nelson runs over daily means, the reject episodes at day grain — must
 * test this between adjacent entries rather than trust array order.
 *
 * The reason is a permanent hole in the record. IFL's July copy ends on
 * 2026-07-10 and the next real rows begin on 2026-08-05: IFL rebuilt their
 * tables in between and the missing month has not been sent. In an array of
 * days-with-data those two dates sit side by side, and a station that read
 * heavy on both was reported as "heavy for 2 days" across 26 days of nothing.
 * A run that crosses this boundary is not a run; it is two.
 */
export function consecutiveProductionDays(prev: string, next: string): boolean {
  const apart = productionDaysApart(prev, next);
  return apart >= 0 && apart <= 1;
}
