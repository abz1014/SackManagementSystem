/**
 * The plant's wall clock as a printable string — IFL reports task W0
 * (1 Oct 2026), D4 of the export fixes.
 *
 * TWO CLOCKS (plantClock.ts): a production timestamp is the PLANT's wall clock
 * stored with a UTC label, so its UTC getters ARE the factory-floor time.
 * Exporting it as an ISO string ("2026-07-03T21:32:41.000Z") told an Excel
 * user the cone was weighed at 21:32 UTC — five hours before the plant clock
 * said so, and with a "Z" that invites exactly that conversion. This renders
 * the same instant as `YYYY-MM-DD HH:mm:ss`, no zone marker, from the UTC
 * getters and nothing else: no `Date.now()`, no local zone, no offset
 * arithmetic. Export columns that carry such a value are named
 * `*_plant_time` so the unit is in the header.
 *
 * Only ever feed this a production-time instant (`production_ts_utc`,
 * `production_ts_utc_ms`) or `generatedAtPlantUtc`. A genuine-UTC app instant
 * (a product-timeline `effective_from`, an audit time) must go through
 * `toPlantMs` in plantClock.ts first, or the string it prints is five hours
 * wrong.
 */

const p2 = (n: number): string => String(n).padStart(2, '0');

/**
 * `YYYY-MM-DD HH:mm:ss` from a production-time instant given as epoch ms, a
 * Date, or an ISO string. An unparseable input returns '' (an empty cell is
 * an honest "no value"; a thrown error would sink a whole report for one bad
 * row).
 */
export function plantWallClock(v: number | Date | string | null | undefined): string {
  if (v == null) return '';
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  if (!Number.isFinite(t)) return '';
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
  );
}

/**
 * The inverse for the export writers: `YYYY-MM-DD HH:mm:ss` (or the same with
 * a `T` separator and an optional fraction/`Z`) back to the epoch ms on the
 * production-time convention, using `Date.UTC` so the host's own zone can
 * never move it. null for anything that is not that shape. A workbook that
 * stores this string in a date column must convert through here, never via
 * `new Date(string)`, which would read the wall clock as the HOST's local
 * time.
 */
export function parsePlantWallClock(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?$/.exec(s.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return Number.isFinite(ms) ? ms : null;
}
