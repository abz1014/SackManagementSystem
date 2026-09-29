/**
 * Chart overhaul wave 1, Task TA: shift-bounded period ranges.
 *
 * Owner decision: the page period can now be a SHIFT-BOUNDED range, e.g.
 * "from 2 Sep morning shift to 3 Sep night shift", not just a plain
 * calendar-day `from`/`to`. Every period-scoped route is expected to accept
 * an OPTIONAL `fromShift`/`toShift` pair alongside its existing `from`/`to`
 * date params, built from the pieces this file exports.
 *
 * Shifts: morning = 06:00-14:00, evening = 14:00-22:00, night = 22:00-06:00,
 * each belonging to the shift_date it STARTS on (the production day starts
 * 06:00) — see `shared/src/domain/shift.ts` and
 * `api/src/services/live.ts`'s `shiftWindowAt`/`loadShiftRule` for the same
 * rule applied to a single instant instead of a range. The stored
 * `shift_code` column on `sms.cone_event` / `sms.sack_event` /
 * `sms.reject_event` (see `db/migrations/003_cone_event.sql`,
 * `004_sack_event.sql`, `008_reject_event.sql`) holds exactly the three
 * values in `@sms/shared`'s `SHIFT_CODES` — `'morning' | 'evening' |
 * 'night'` — not `A`/`B`/`C`, so `ShiftName` below is that same type, not a
 * new vocabulary.
 *
 * TWO CLOCKS (api/src/services/plantClock.ts). Every instant this file
 * produces — `shiftRangeEdgesUtc`'s `fromMs`/`toMs`, and the `date`
 * column `shiftRangeClause` compares against — is on the PRODUCTION
 * convention (the plant's wall clock, labelled UTC; `shift_date` and
 * `production_ts_utc_ms` are both written that way). Despite the function
 * name (kept for symmetry with the `*Utc` helpers in `ruleAsOf.ts`), NEVER
 * compare these values against an app-written genuine-UTC column
 * (`effective_from`, `adjusted_at_utc`, session expiry, …) without
 * converting through `toPlantMs`/`toPlantIso` first.
 *
 * Shift boundaries are not a global constant — they are a line's
 * `sms.shift_rule` row, which can change over time (RT24-04,
 * `api/src/services/ruleAsOf.ts`). This module does not read the database or
 * pick a regime itself: callers resolve the `ShiftBoundaries` in force
 * (`loadShiftRule` for "now", or a historical lookup once one exists) and
 * pass it in, so `shiftRangeEdgesUtc` stays regime-aware without owning a DB
 * connection.
 */
import { z } from 'zod';
import mssql from 'mssql';
import {
  SHIFT_CODES,
  type ShiftCode,
  type ShiftBoundaries,
  DEFAULT_SHIFT_BOUNDARIES,
} from '@sms/shared';
import { isoDate } from './dates.js';
import { ruleAsOf, type RuleVersion, type ShiftRuleValue } from './services/ruleAsOf.js';

/** Re-exported under the name this task's frozen shape uses. Same three values as `ShiftCode`. */
export type ShiftName = ShiftCode;

export const ShiftNameSchema = z.enum(SHIFT_CODES);

/**
 * FROZEN for other workers: services that accept a shift-bounded period take
 * an optional `shiftRange?: ShiftRange` of exactly this shape.
 */
export interface ShiftRange {
  /** YYYY-MM-DD, the shift_date the range starts on. */
  from: string;
  fromShift: ShiftName;
  /** YYYY-MM-DD, the shift_date the range ends on. */
  to: string;
  toShift: ShiftName;
}

const DAY_MS = 86_400_000;

/** morning=1, evening=2, night=3 — the same order shift_date/shift_code are compared in. */
export function shiftOrd(name: ShiftName): 1 | 2 | 3 {
  if (name === 'morning') return 1;
  if (name === 'evening') return 2;
  return 3;
}

// --------------------------------------------------------------- validation

interface ShiftRangeInput {
  from?: string;
  to?: string;
  fromShift?: ShiftName;
  toShift?: ShiftName;
}

/**
 * Shared pairing/ordering rule, used by both `shiftRangeQuery`'s
 * `superRefine` (for routes wiring this into their own zod schema) and
 * `parseShiftRange` (for callers that already have a parsed, loosely-typed
 * query object and want a plain result, not a zod issue list).
 *
 *  - Neither `fromShift` nor `toShift` given → no shift range requested;
 *    `undefined`, not an error, so a route's existing plain `from`/`to`
 *    period keeps working unchanged.
 *  - Exactly one of `fromShift`/`toShift` given → error: they come as a
 *    pair.
 *  - Both given but `from` or `to` missing → error: shifts only make sense
 *    alongside the dates they refine.
 *  - Both given, `from`/`to` present, but the start sorts after the end
 *    (compare the date first, then the shift ordinal) → error.
 *  - Otherwise → the resolved `ShiftRange`. A same-shift, same-day range
 *    (`from === to && fromShift === toShift`) is explicitly ALLOWED — it
 *    names exactly one shift.
 */
function resolveShiftRange(input: ShiftRangeInput): ShiftRange | undefined | { error: string } {
  const { from, to, fromShift, toShift } = input;
  const hasFromShift = fromShift !== undefined;
  const hasToShift = toShift !== undefined;

  if (!hasFromShift && !hasToShift) return undefined;
  if (hasFromShift !== hasToShift) {
    return { error: 'fromShift and toShift must both be given, or both omitted' };
  }
  if (from === undefined || to === undefined) {
    return { error: 'fromShift/toShift require from and to to also be given' };
  }

  const fs = fromShift as ShiftName;
  const ts = toShift as ShiftName;
  const startsAfterEnd = from > to || (from === to && shiftOrd(fs) > shiftOrd(ts));
  if (startsAfterEnd) {
    return { error: 'shift range start must not be after its end' };
  }
  return { from, fromShift: fs, to, toShift: ts };
}

/**
 * The zod SHAPE (not a schema) for `fromShift`/`toShift` alone — spread or
 * `.extend()`-ed into a route's existing query schema, which already owns
 * `from`/`to` via `isoDate`. `shiftRangeQuery` below is the same shape
 * bundled with its own `from`/`to` and refinement, for standalone use
 * (tests, or a route with no pre-existing period fields).
 */
export const shiftRangeShape = {
  fromShift: ShiftNameSchema.optional(),
  toShift: ShiftNameSchema.optional(),
};

/**
 * `z.object(...).superRefine` refinement enforcing `resolveShiftRange`'s
 * rule against a parsed `{ from?, to?, fromShift?, toShift? }` object. Add
 * this via `.superRefine(shiftRangeRefine)` after `.extend(shiftRangeShape)`
 * on a schema that already carries `from`/`to` (both as `isoDate.optional()`
 * or `isoDate` — either works, `resolveShiftRange` only checks presence).
 */
export function shiftRangeRefine(data: ShiftRangeInput, ctx: z.RefinementCtx): void {
  const result = resolveShiftRange(data);
  if (result && 'error' in result) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
  }
}

/**
 * A complete, standalone shift-range query fragment: `from`/`to`
 * (`isoDate`, optional) plus `fromShift`/`toShift`, with the pairing rule
 * already wired in. Usable directly, or as the reference shape for a route
 * that wants to `.extend()` its own schema with `shiftRangeShape` and add
 * `shiftRangeRefine` itself instead (e.g. to keep its own, stricter
 * `from`/`to` requiredness).
 */
export const shiftRangeQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...shiftRangeShape,
  })
  .superRefine(shiftRangeRefine);

/**
 * Parse an already-loosely-typed query object (e.g. `req.query` after a
 * route's own schema has validated `from`/`to`/`fromShift`/`toShift` shape
 * but before this module's pairing rule has run) into a `ShiftRange`.
 *
 * Returns `undefined` when no shift range was requested (plain `from`/`to`
 * period, unchanged), the resolved `ShiftRange`, or `{ error }` naming what
 * is wrong so a route can turn it into a 400 the same way it already does
 * for other bad input.
 */
export function parseShiftRange(query: {
  from?: string;
  to?: string;
  fromShift?: string;
  toShift?: string;
}): ShiftRange | undefined | { error: string } {
  const fromShift = query.fromShift === undefined ? undefined : ShiftNameSchema.safeParse(query.fromShift);
  const toShift = query.toShift === undefined ? undefined : ShiftNameSchema.safeParse(query.toShift);
  if (fromShift && !fromShift.success) return { error: 'fromShift must be morning, evening or night' };
  if (toShift && !toShift.success) return { error: 'toShift must be morning, evening or night' };
  if (query.from !== undefined && !isoDate.safeParse(query.from).success) {
    return { error: 'from must be a real YYYY-MM-DD date' };
  }
  if (query.to !== undefined && !isoDate.safeParse(query.to).success) {
    return { error: 'to must be a real YYYY-MM-DD date' };
  }
  return resolveShiftRange({
    from: query.from,
    to: query.to,
    fromShift: fromShift?.data,
    toShift: toShift?.data,
  });
}

// -------------------------------------------------------------------- SQL

/**
 * Minimal shape of an `mssql` `Request` this file needs — just enough to
 * bind parameters, and structurally satisfied by both a real
 * `pool.request()` and a plain stub object in tests.
 */
export interface ShiftRangeSqlRequest {
  input(name: string, type: unknown, value: unknown): unknown;
}

/** Column aliases must be plain identifiers (optionally dotted, e.g. `ce.shift_date`) — never user input. */
const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function assertSafeIdentifier(id: string): void {
  if (!SAFE_IDENTIFIER_RE.test(id)) {
    throw new Error(`shiftRangeClause: unsafe SQL identifier ${JSON.stringify(id)}`);
  }
}

/**
 * The parameterised SQL fragment for `WHERE`-ing a `(shift_date,
 * shift_code)` pair into a `ShiftRange`, and the params it needs bound on
 * `request`.
 *
 * `alias.date`/`alias.code` are whitelisted identifiers (checked against
 * `SAFE_IDENTIFIER_RE`), never interpolated from request input — every
 * VALUE (the range's dates and shift ordinals) is bound as a parameter.
 * `ord` is a `CASE` over the column's own stored text, mapped from
 * `@sms/shared`'s `SHIFT_CODES` values — the same three strings the sync
 * worker/transform stamp on every row — not a guess at a vendor code.
 *
 * Returned clause:
 *   (d > @srFrom OR (d = @srFrom AND ord >= @srFromOrd))
 *   AND (d < @srTo OR (d = @srTo AND ord <= @srToOrd))
 */
export function shiftRangeClause(
  range: ShiftRange,
  alias: { date: string; code: string },
  request: ShiftRangeSqlRequest,
): string {
  assertSafeIdentifier(alias.date);
  assertSafeIdentifier(alias.code);

  request.input('srFrom', mssql.Date, range.from);
  request.input('srFromOrd', mssql.Int, shiftOrd(range.fromShift));
  request.input('srTo', mssql.Date, range.to);
  request.input('srToOrd', mssql.Int, shiftOrd(range.toShift));

  const ord = `(CASE ${alias.code} WHEN 'morning' THEN 1 WHEN 'evening' THEN 2 WHEN 'night' THEN 3 ELSE 0 END)`;
  return (
    `(${alias.date} > @srFrom OR (${alias.date} = @srFrom AND ${ord} >= @srFromOrd))` +
    ` AND (${alias.date} < @srTo OR (${alias.date} = @srTo AND ${ord} <= @srToOrd))`
  );
}

// ------------------------------------------------------------------- edges

export interface ShiftRangeEdges {
  /** Start instant of `range.fromShift` on `range.from`, production convention. */
  fromMs: number;
  /** End instant of `range.toShift` on `range.to`, production convention. */
  toMs: number;
}

/** `YYYY-MM-DD` at plant-clock 00:00, as a production-convention instant. Same idiom as `ruleAsOf.ts`'s `plantDayStartMs`. */
function dayStartMs(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getTime();
}

function shiftStartMinutes(shift: ShiftName, b: ShiftBoundaries): number {
  if (shift === 'morning') return b.morningStart;
  if (shift === 'evening') return b.eveningStart;
  return b.nightStart;
}

/** The minute-of-day a shift ENDS at, and whether that end falls on the next calendar day (only true for night). */
function shiftEndMinutes(shift: ShiftName, b: ShiftBoundaries): { minutes: number; nextDay: boolean } {
  if (shift === 'morning') return { minutes: b.eveningStart, nextDay: false };
  if (shift === 'evening') return { minutes: b.nightStart, nextDay: false };
  return { minutes: b.morningStart, nextDay: true }; // night wraps midnight, ends the following morning
}

/**
 * The start instant of `range.fromShift` and the end instant of
 * `range.toShift`, both in the PRODUCTION convention (see the file header's
 * TWO CLOCKS note) — used only where a route compares instants directly
 * (an events `tsFrom`/`tsTo`, the downtime ribbon clip), not for the
 * `(shift_date, shift_code)` comparison `shiftRangeClause` already covers.
 *
 * `rule` is the `ShiftBoundaries` in force — pass the one the caller already
 * resolved for the period (typically `loadShiftRule`'s current boundaries;
 * defaults to `DEFAULT_SHIFT_BOUNDARIES` otherwise). This function does not
 * pick a regime itself, so a caller comparing a range that spans a
 * shift-rule change should resolve `fromMs` and `toMs` against the
 * boundaries in force at each end, rather than one call with one regime.
 */
export function shiftRangeEdgesUtc(range: ShiftRange, rule: ShiftBoundaries = DEFAULT_SHIFT_BOUNDARIES): ShiftRangeEdges {
  const fromBase = dayStartMs(range.from);
  const fromMs = fromBase + shiftStartMinutes(range.fromShift, rule) * 60_000;

  const toBase = dayStartMs(range.to);
  const toEnd = shiftEndMinutes(range.toShift, rule);
  const toMs = toBase + (toEnd.nextDay ? DAY_MS : 0) + toEnd.minutes * 60_000;

  return { fromMs, toMs };
}

// ------------------------------------------------------------- edges, as of

/**
 * Task W1-B (29 Sep 2026): `shiftRangeEdgesUtc` above takes ONE
 * `ShiftBoundaries` and applies it to both edges — correct only when
 * `sms.shift_rule` never changed across the range. This is the
 * history-aware sibling: given the FULL version history
 * (`ruleAsOf.ts`'s `loadShiftRuleHistory`, sorted newest-first — the same
 * shape `ruleAsOf`/`ruleChangesWithin` already expect), the FROM edge is
 * resolved under the rule in force at the from shift, and the TO edge under
 * the rule in force at the to shift, independently.
 *
 * ANCHOR, not the exact shift instant. Which rule governs a shift's own
 * start is, in principle, circular — the boundaries decide the instant, and
 * the instant decides which boundaries apply. This resolves it the same way
 * `sms.shift_rule` is actually edited (Setup writes a fresh dated row, never
 * a mid-shift patch): each edge's rule is looked up at that edge's own
 * plant-clock DAY START (`dayStartMs`), not at the boundary-dependent shift
 * instant itself. For every real `effective_from` this app can produce —
 * date-granular, never inside a shift — day-start and shift-start anchor to
 * the same version. `history` must already be on the PRODUCTION convention
 * (see file header TWO CLOCKS — `loadShiftRuleHistory` converts
 * `effective_from` through `toPlantMs` at load, exactly like this file's own
 * `ruleAsOf.ts` siblings), so no further conversion happens here.
 *
 * `ruleChanged` is true when the FROM and TO edges resolved to two
 * different rule versions — boundaries OR `nightBelongsTo` — so a caller
 * (register.ts, downtime.ts, sackStock.ts) can disclose that more than one
 * shift-rule regime applies across the range, the same disclosure idiom
 * `ruleChangedInPeriod` already gives plausibility/weight readers.
 */
export function shiftRangeEdgesUtcAsOf(
  range: ShiftRange,
  history: readonly RuleVersion<ShiftRuleValue>[],
): ShiftRangeEdges & { ruleChanged: boolean } {
  const fromAnchorMs = dayStartMs(range.from);
  const toAnchorMs = dayStartMs(range.to);

  const fromRule = ruleAsOf(history, fromAnchorMs);
  const toRule = ruleAsOf(history, toAnchorMs);

  const fromMs = fromAnchorMs + shiftStartMinutes(range.fromShift, fromRule.boundaries) * 60_000;
  const toEnd = shiftEndMinutes(range.toShift, toRule.boundaries);
  const toMs = toAnchorMs + (toEnd.nextDay ? DAY_MS : 0) + toEnd.minutes * 60_000;

  const ruleChanged =
    fromRule.boundaries.morningStart !== toRule.boundaries.morningStart ||
    fromRule.boundaries.eveningStart !== toRule.boundaries.eveningStart ||
    fromRule.boundaries.nightStart !== toRule.boundaries.nightStart ||
    fromRule.nightBelongsTo !== toRule.nightBelongsTo;

  return { fromMs, toMs, ruleChanged };
}
