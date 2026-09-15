/**
 * The two clocks, on the client (roadmap Phase 9 item 4, 15 Sep 2026).
 *
 * The API holds instants on two conventions five hours apart on this plant
 * (api/src/services/plantClock.ts): PRODUCTION time — the plant's wall clock
 * labelled UTC, which is what every `shift_date` and production timestamp
 * is — and APP-WRITTEN time, genuine UTC, which is what an adjustment's
 * `adjustedAtUtc`, a product change or a sync pass carries.
 *
 * The station sheet used to compare `${day}T23:59:59Z` (a production day)
 * with `adjustedAtUtc` (genuine UTC) as strings, with no conversion: an
 * adjustment logged at 02:00 plant time landed on the previous production
 * day, and the "adjusted" tick and the grey-out moved a day early. This file
 * is the conversion, named, and it takes the OFFSET THE API REPORTS
 * (`plantOffsetMinutes` on /api/live and on the adjustments response) —
 * never the browser's own zone. A viewer on a phone set to another timezone,
 * or a laptop that never left UTC, must see the same production day as the
 * plant PC.
 */

const MINUTE_MS = 60_000;

/** A genuine-UTC instant re-expressed on the production-time convention, as ms. */
export function toPlantMs(utc: string | number | Date, offsetMinutes: number): number {
  const ms = utc instanceof Date ? utc.getTime() : typeof utc === 'number' ? utc : new Date(utc).getTime();
  return ms + offsetMinutes * MINUTE_MS;
}

/** The same, as an ISO string (render it with the UTC formatters, like every production time). */
export function toPlantIso(utc: string | number | Date, offsetMinutes: number): string {
  return new Date(toPlantMs(utc, offsetMinutes)).toISOString();
}

/** The production day (YYYY-MM-DD) an app-written instant falls on. */
export function plantDayOf(utc: string | number | Date, offsetMinutes: number): string {
  return toPlantIso(utc, offsetMinutes).slice(0, 10);
}

/**
 * The inverse: a plant wall-clock time typed by a person ("2026-09-03T16:56",
 * a datetime-local value) as a genuine-UTC ISO instant for the API.
 */
export function fromPlantLocal(local: string, offsetMinutes: number): string {
  const plantMs = new Date(`${local.length === 16 ? `${local}:00` : local}Z`).getTime();
  return new Date(plantMs - offsetMinutes * MINUTE_MS).toISOString();
}

/** A production-convention instant as a datetime-local value ("2026-09-03T16:56"), for a form's default. */
export function plantLocalValue(plantIso: string): string {
  return plantIso.slice(0, 16);
}

/**
 * True when the END of production day `day` is at or after the app-written
 * instant `utc` — the rule the API uses to decide which day a new scale
 * starts on (calibration.ts splitEpochs), so the sheet's tick lands on the
 * same day the server's restart did.
 */
export function dayEndsAtOrAfter(day: string, utc: string, offsetMinutes: number): boolean {
  return new Date(`${day}T23:59:59.999Z`).getTime() >= toPlantMs(utc, offsetMinutes);
}
