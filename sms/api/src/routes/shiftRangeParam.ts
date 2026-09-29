/**
 * Chart overhaul wave 2, Task TC (28 Sep 2026): the route-layer decode for
 * the shift-bounded period the web now sends.
 *
 * WIRE FORMAT DECISION. `web/src/lib/period.ts`'s `periodQuery` encodes
 * `fromShift`/`toShift` as `encodeShiftRef` strings — `"YYYY-MM-DD.shift"`,
 * e.g. `"2026-09-02.morning"` — never a bare shift name. That is because a
 * `Period`'s `fromShift`/`toShift` are `ShiftRef`s (a date AND a shift), and
 * `periodQuery` sends them alongside plain `from`/`to` that (for a `'range'`
 * period) are ALREADY the same dates — `resolvePeriod`'s `'range'` case sets
 * `from: from.date, to: to.date` — so the encoded strings carry the date
 * again, redundantly, rather than a route needing to zip a bare shift name
 * back onto `from`/`to` itself. `api/src/shiftRange.ts`'s own `ShiftRange` /
 * `parseShiftRange` are built the other way around: they expect
 * `fromShift`/`toShift` to already be bare `ShiftName`s living next to a
 * separate `from`/`to`. This module is the reconciliation: it decodes each
 * `"D.shift"` string into `{ date, shift }`, checks the decoded date agrees
 * with the route's own plain `from`/`to` when the route has them (every
 * route this wires into does), and only then hands the two bare shift names
 * to `parseShiftRange` for the actual pairing/ordering rule — so this file
 * duplicates none of `shiftRange.ts`'s own validation, it only bridges the
 * wire shape to it.
 *
 * A mismatched date (`fromShift=2026-09-02.morning` beside `from=2026-09-03`)
 * is refused as a 400 rather than silently preferring one side: the two
 * would describe different periods and neither is obviously the caller's
 * intent.
 */
import { parseShiftRange, type ShiftName, type ShiftRange } from '../shiftRange.js';

const ENCODED_SHIFT_RE = /^(\d{4}-\d{2}-\d{2})\.(morning|evening|night)$/;

interface DecodedShiftRef {
  date: string;
  shift: ShiftName;
}

function decodeOne(raw: string, paramName: string): DecodedShiftRef | { error: string } {
  const m = ENCODED_SHIFT_RE.exec(raw);
  if (!m) return { error: `${paramName} must be YYYY-MM-DD.morning, YYYY-MM-DD.evening or YYYY-MM-DD.night` };
  return { date: m[1]!, shift: m[2] as ShiftName };
}

/**
 * Decodes a route's `fromShift`/`toShift` query params — each the
 * `"YYYY-MM-DD.shift"` form `web/src/lib/period.ts`'s `encodeShiftRef`
 * produces — into a `ShiftRange` ready for a service's `shiftRange?:
 * ShiftRange` field, checking them against the route's own plain `from`/`to`
 * along the way.
 *
 * Returns:
 *   - `undefined` — neither `fromShift` nor `toShift` was given. No shift
 *     range was requested; the route's existing plain `from`/`to` behaviour
 *     is unchanged, exactly as `shiftRange.ts`'s own `parseShiftRange` treats
 *     an absent pair.
 *   - `{ error }` — malformed, given as only one of the pair, a date that
 *     disagrees with `from`/`to`, or (via `parseShiftRange`) a start that
 *     sorts after the end. The caller turns this into the same 400 shape it
 *     already uses for other bad query input.
 *   - `ShiftRange` — decoded and validated, ready to pass through.
 *
 * `from`/`to` are optional here and checked ONLY when present, so this also
 * serves a caller with no separate plain date fields of its own (none of
 * the routes wired to this module lack them today, but nothing here
 * requires it).
 */
export function decodeShiftRangeParam(query: {
  from?: string;
  to?: string;
  fromShift?: string;
  toShift?: string;
}): ShiftRange | undefined | { error: string } {
  const hasFromShift = query.fromShift !== undefined;
  const hasToShift = query.toShift !== undefined;
  if (!hasFromShift && !hasToShift) return undefined;
  if (hasFromShift !== hasToShift) {
    return { error: 'fromShift and toShift must both be given, or both omitted' };
  }

  const from = decodeOne(query.fromShift!, 'fromShift');
  if ('error' in from) return from;
  const to = decodeOne(query.toShift!, 'toShift');
  if ('error' in to) return to;

  if (query.from !== undefined && query.from !== from.date) {
    return { error: 'fromShift date does not match from' };
  }
  if (query.to !== undefined && query.to !== to.date) {
    return { error: 'toShift date does not match to' };
  }

  return parseShiftRange({ from: from.date, to: to.date, fromShift: from.shift, toShift: to.shift });
}

/** True for the `{ error }` shape, narrowing away `undefined`/`ShiftRange`. */
export function isShiftRangeError(v: ShiftRange | undefined | { error: string }): v is { error: string } {
  return v != null && typeof v === 'object' && 'error' in v;
}
