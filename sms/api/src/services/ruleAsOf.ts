/**
 * RT24-04: time-versioned rule tables read "as of when", not "as of right
 * now" — fixes the defect named in the same terms `sms.product_limit_version`
 * already solved (SEPT-2026-EPOCH-DECISION §5.4, `productLimits.ts`).
 *
 * `sms.plausibility_rule`, `sms.weight_rule` and `sms.shift_rule` are all
 * append-only, one row per change, `effective_from` a genuine UTC instant.
 * Every read of them before this file used
 * `SELECT TOP 1 ... ORDER BY effective_from DESC` with no upper bound on
 * `effective_from` at all — so editing a rule TODAY silently re-judged every
 * historical report that read it, and a future-dated row (entered ahead of
 * a planned change) would read as "current" immediately, before its own
 * effective date arrived. `sms.product_limit_version` never had this defect
 * — `productLimits.ts`'s `limitsAt()` always compared against a specific
 * instant. This file generalises that same pattern for the other three rule
 * tables, rather than inventing a second one.
 *
 * TWO CLOCKS (plantClock.ts). `effective_from` is app-written, genuine UTC.
 * Production timestamps (`production_ts_utc_ms`, `shift_date`) are the
 * plant's wall clock labelled UTC — five hours apart on this plant. Every
 * `effective_from` is converted through `toPlantMs` once at load (the same
 * idiom `productLimits.ts` uses for `product_limit_version`), so every
 * comparison in this file happens entirely on the production-time
 * convention. Callers pass plant-convention instants in, e.g. the value
 * already used to bound `production_ts_utc_ms` at reading time, or a period
 * end from `plantDayEndMs`.
 *
 * TWO SEMANTICS, deliberately kept separate:
 *  - "in force right now" (admin.ts, live.ts, envelope.ts) — a plain
 *    `effective_from <= SYSUTCDATETIME()` guard added to each site's own
 *    SQL, so a future-dated row cannot read as current. No history needed.
 *  - "in force as of a reading, or as of a period end" (getPlausibilityRule
 *    callers via app.ts, and every weight_rule read in production.ts,
 *    sacks.ts, sackStock.ts, weights.ts, spc.ts) — `ruleAsOf` below, given
 *    the full version history loaded once.
 *
 * `ruleAsOf`/`ruleChangesWithin` are deliberately generic: they know nothing
 * about plausibility or weight rules specifically, so the same two functions
 * serve both loaders below and any future versioned-rule table.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { DEFAULT_SHIFT_BOUNDARIES, parseShiftTime, type NightBelongsTo, type ShiftBoundaries } from '@sms/shared';
import { toPlantMs } from './plantClock.js';

export interface RuleVersion<T> {
  /** Plant-clock ms — directly comparable to production_ts_utc_ms / shift_date arithmetic. */
  effectiveFromMs: number;
  value: T;
}

/**
 * The newest version whose `effectiveFromMs` is at or before `atPlantMs`.
 * `history` must be sorted newest-first (every loader below returns it that
 * way, matching `ORDER BY effective_from DESC`).
 *
 * HONESTY ABOUT THE PAST: when `atPlantMs` predates every known version (a
 * reading older than the oldest rule this app has ever recorded), this
 * returns the OLDEST version rather than throwing or returning null — the
 * same "lower-bound" idiom `product_limit_version` uses for its bootstrap
 * rows: it is the best evidence available, not a claim the rule started
 * exactly there.
 */
export function ruleAsOf<T>(history: readonly RuleVersion<T>[], atPlantMs: number): T {
  for (const v of history) {
    if (v.effectiveFromMs <= atPlantMs) return v.value;
  }
  const oldest = history[history.length - 1];
  if (!oldest) throw new Error('ruleAsOf: empty history');
  return oldest.value;
}

/**
 * True when the rule changed at least once strictly inside
 * `(fromPlantMs, toPlantMs]` — i.e. a version dated after the period's start
 * and at or before its end. A report spanning such a period is not wrong,
 * but it owes the reader a disclosure that more than one rule applied.
 */
export function ruleChangesWithin<T>(history: readonly RuleVersion<T>[], fromPlantMs: number, toPlantMs: number): boolean {
  return history.some((v) => v.effectiveFromMs > fromPlantMs && v.effectiveFromMs <= toPlantMs);
}

/** `shift_date` (YYYY-MM-DD) at plant-clock 00:00, as plant-convention ms. */
export function plantDayStartMs(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getTime();
}

/** `shift_date` (YYYY-MM-DD) at plant-clock 24:00 (the start of the next day), as plant-convention ms. */
export function plantDayEndMs(day: string): number {
  return plantDayStartMs(day) + 86_400_000;
}

// ---------------------------------------------------------- plausibility_rule

export interface PlausibilityRule {
  coneLoG: number;
  coneHiG: number;
  sackLoKg: number;
  sackHiKg: number;
}

/** Same fallback admin.ts's "now" reader already used when the table is empty. */
export const PLAUSIBILITY_FALLBACK: PlausibilityRule = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

export async function loadPlausibilityRuleHistory(pool: ConnectionPool, lineId: number): Promise<RuleVersion<PlausibilityRule>[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    cl: number; ch: number; sl: number; sh: number; effective_from: Date;
  }>(
    `SELECT cone_lo_g cl, cone_hi_g ch, sack_lo_kg sl, sack_hi_kg sh, effective_from
       FROM sms.plausibility_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  return r.recordset.map((row) => ({
    effectiveFromMs: toPlantMs(row.effective_from),
    value: { coneLoG: Number(row.cl), coneHiG: Number(row.ch), sackLoKg: Number(row.sl), sackHiKg: Number(row.sh) },
  }));
}

export interface RuleAsOfResult<T> {
  rule: T;
  /** True when the caller supplied a period start and the rule changed inside it. */
  ruleChangedInPeriod: boolean;
  /** How many versions exist at all — 0 means the fallback/default answered, not a real row. */
  versionCount: number;
}

/**
 * The plausibility rule in force at `atPlantMs` (typically a period end from
 * `plantDayEndMs`, or a single reading's own instant). Pass `fromPlantMs` to
 * also learn whether the rule changed inside `(fromPlantMs, atPlantMs]`.
 */
export async function getPlausibilityRuleAsOf(
  pool: ConnectionPool,
  lineId: number,
  atPlantMs: number,
  fromPlantMs?: number,
): Promise<RuleAsOfResult<PlausibilityRule>> {
  const history = await loadPlausibilityRuleHistory(pool, lineId);
  if (history.length === 0) return { rule: PLAUSIBILITY_FALLBACK, ruleChangedInPeriod: false, versionCount: 0 };
  return {
    rule: ruleAsOf(history, atPlantMs),
    ruleChangedInPeriod: fromPlantMs != null ? ruleChangesWithin(history, fromPlantMs, atPlantMs) : false,
    versionCount: history.length,
  };
}

// ---------------------------------------------------------------- weight_rule

export interface WeightRule {
  basis: string;
  /**
   * `null`, not coerced to 0, when the column itself is SQL NULL on an
   * otherwise-present row — a caller's own presence check (production.ts's
   * `readNum`, e.g.) must be able to tell "no tare configured" from "tare is
   * genuinely zero". `Number(null)` is 0 and would silently hide that.
   */
  coneTubeWeightG: number | null;
  sackTareKg: number | null;
}

export async function loadWeightRuleHistory(pool: ConnectionPool, lineId: number): Promise<RuleVersion<WeightRule>[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    basis: string; tube: number | null; tare: number | null; effective_from: Date;
  }>(
    `SELECT basis, cone_tube_weight_g AS tube, sack_tare_kg AS tare, effective_from
       FROM sms.weight_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  return r.recordset.map((row) => ({
    effectiveFromMs: toPlantMs(row.effective_from),
    value: {
      basis: row.basis,
      coneTubeWeightG: row.tube == null ? null : Number(row.tube),
      sackTareKg: row.tare == null ? null : Number(row.tare),
    },
  }));
}

/**
 * The weight rule in force at `atPlantMs`. Unlike plausibility, weight_rule
 * has no in-code fallback constant — an empty table is a real, documented
 * state (Q4/Q5 unresolved; see production.ts), so `rule` is null and the
 * caller applies whatever default it already used for that case.
 */
export async function getWeightRuleAsOf(
  pool: ConnectionPool,
  lineId: number,
  atPlantMs: number,
  fromPlantMs?: number,
): Promise<RuleAsOfResult<WeightRule | null>> {
  const history = await loadWeightRuleHistory(pool, lineId);
  if (history.length === 0) return { rule: null, ruleChangedInPeriod: false, versionCount: 0 };
  return {
    rule: ruleAsOf(history, atPlantMs),
    ruleChangedInPeriod: fromPlantMs != null ? ruleChangesWithin(history, fromPlantMs, atPlantMs) : false,
    versionCount: history.length,
  };
}

// ---------------------------------------------------------------- shift_rule

/**
 * Task W1-B (29 Sep 2026): the third versioned rule table, alongside
 * plausibility and weight above. `sms.shift_rule` already had ONE reader for
 * "in force right now" — `live.ts`'s `loadShiftRule`, bounded by
 * `effective_from <= SYSUTCDATETIME()` so a future-dated row cannot be read
 * as current (RT24-04) — but no history loader for "in force as of a given
 * shift", which `shiftRangeEdgesUtcAsOf` (shiftRange.ts) needs to judge a
 * shift-bounded RANGE's two edges under whichever rule was in force at each
 * end, not today's mirror.
 *
 * Parsed the same way `live.ts:410`'s `loadShiftRule` parses a single row —
 * `CONVERT(..., 108)` to 'HH:MM', `parseShiftTime`, and the same
 * ms<es<ns validity guard, falling back to `DEFAULT_SHIFT_BOUNDARIES` for
 * any row that fails it — so a caller comparing "now" (`loadShiftRule`)
 * against "as of" (this loader) never sees a row parsed two different ways.
 */
export interface ShiftRuleValue {
  boundaries: ShiftBoundaries;
  nightBelongsTo: NightBelongsTo;
}

/** Same lower-bound fallback `sync-worker/src/transform/ruleHistory.ts`'s `loadShiftRuleHistory` uses when a line has no row at all. */
const SHIFT_RULE_FALLBACK: RuleVersion<ShiftRuleValue> = {
  effectiveFromMs: -Infinity,
  value: { boundaries: DEFAULT_SHIFT_BOUNDARIES, nightBelongsTo: 'start_day' },
};

export async function loadShiftRuleHistory(pool: ConnectionPool, lineId: number): Promise<RuleVersion<ShiftRuleValue>[]> {
  const r = await pool.request().input('line', mssql.Int, lineId).query<{
    ms: string | null; es: string | null; ns: string | null; night_belongs_to: string | null; effective_from: Date;
  }>(
    `SELECT CONVERT(varchar(5), morning_start, 108) AS ms, CONVERT(varchar(5), evening_start, 108) AS es,
            CONVERT(varchar(5), night_start, 108) AS ns, night_belongs_to, effective_from
       FROM sms.shift_rule WHERE line_id=@line ORDER BY effective_from DESC`,
  );
  if (r.recordset.length === 0) return [SHIFT_RULE_FALLBACK];
  return r.recordset.map((row) => {
    const ms = row.ms == null ? null : parseShiftTime(row.ms);
    const es = row.es == null ? null : parseShiftTime(row.es);
    const ns = row.ns == null ? null : parseShiftTime(row.ns);
    const boundaries: ShiftBoundaries =
      ms != null && es != null && ns != null && ms < es && es < ns
        ? { morningStart: ms, eveningStart: es, nightStart: ns }
        : DEFAULT_SHIFT_BOUNDARIES;
    return {
      effectiveFromMs: toPlantMs(row.effective_from),
      value: { boundaries, nightBelongsTo: row.night_belongs_to === 'calendar_day' ? 'calendar_day' : 'start_day' },
    };
  });
}
