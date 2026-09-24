/**
 * DEFECT RT24-04 (transform side). `resolveShiftRule` (runTransform.ts) and
 * `loadPlausibilityRule` (dq.ts) each read only the NEWEST `sms.shift_rule` /
 * `sms.plausibility_rule` row and apply it to every row in the pass,
 * regardless of that row's own production time. A rebuild after an admin
 * edits a rule in Setup therefore bakes TODAY's rule into stored
 * shift_code/shift_date/outlier_weight for readings taken before the edit.
 *
 * This module loads every version once per pass and resolves the rule in
 * force AT A GIVEN READING'S OWN TIME, so a rebuild spanning a rule change
 * gets the right rule on each side of the change.
 *
 * TWO CLOCKS (CLAUDE.md / api/src/services/plantClock.ts — not importable
 * here: api and sync-worker are separate workspaces and this package may not
 * depend on api). `effective_from` is a genuine UTC instant (SQL Server's
 * SYSUTCDATETIME() or an app-side `new Date()`); `production_ts_utc_ms` is
 * the PLANT WALL CLOCK stored with a UTC label (5h apart on this plant). The
 * two are only comparable once `effective_from` is re-expressed on the
 * production-time convention — the one-line `toPlantMs` below is duplicated
 * from plantClock.ts's own (not the whole TWO CLOCKS derivation, just the
 * arithmetic), because `plantOffsetMinutes` already lives in `@sms/shared`,
 * which both api and sync-worker depend on.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { plantOffsetMinutes, shiftBoundariesFrom, DEFAULT_SHIFT_BOUNDARIES, type NightBelongsTo, type ShiftMode } from '@sms/shared';
import type { ShiftRule } from './transform.js';
import { DEFAULT_PLAUSIBILITY, type PlausibilityBounds } from './dq.js';

/** A genuine UTC instant, re-expressed on the production-time convention. See header. */
function toPlantMs(utcMs: number): number {
  return utcMs + plantOffsetMinutes(new Date(utcMs)) * 60_000;
}

export interface ShiftRuleVersion {
  /** effective_from, converted onto the production-time convention — comparable to production_ts_utc_ms. */
  effectiveAtPlantMs: number;
  rule: ShiftRule;
}

export interface PlausibilityVersion {
  effectiveAtPlantMs: number;
  bounds: PlausibilityBounds;
}

/**
 * Every `sms.shift_rule` version for the line, oldest first, each converted
 * onto the production-time convention. Falls back to a single seed version
 * (identical to `resolveShiftRule`'s own fallback) only when the line has no
 * row at all — a fresh install before seedReference has run.
 */
export async function loadShiftRuleHistory(
  pool: ConnectionPool,
  lineId: number,
  fallback: { nightBelongsTo: NightBelongsTo; mode: ShiftMode },
): Promise<ShiftRuleVersion[]> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ ms: string; es: string; ns: string; nb: NightBelongsTo; mode: ShiftMode; ef: Date }>(
      `SELECT CONVERT(varchar(5), morning_start, 108) ms,
              CONVERT(varchar(5), evening_start, 108) es,
              CONVERT(varchar(5), night_start, 108) ns,
              night_belongs_to nb, mode, effective_from ef
         FROM sms.shift_rule WHERE line_id=@line ORDER BY effective_from ASC`,
    );
  if (r.recordset.length === 0) {
    return [
      {
        effectiveAtPlantMs: -Infinity,
        rule: { boundaries: DEFAULT_SHIFT_BOUNDARIES, nightBelongsTo: fallback.nightBelongsTo, mode: fallback.mode },
      },
    ];
  }
  return r.recordset.map((row) => {
    const boundaries = shiftBoundariesFrom(row.ms, row.es, row.ns);
    if (!boundaries) {
      throw new Error(
        `A shift rule on file for line ${lineId} (effective ${row.ef.toISOString()}) is not usable: morning ` +
          `${row.ms}, evening ${row.es}, night ${row.ns} must be three HH:MM times in increasing order. Fix it in ` +
          `Setup › Rules (sms.shift_rule) — nothing is transformed under a rule that has no night.`,
      );
    }
    return {
      effectiveAtPlantMs: toPlantMs(row.ef.getTime()),
      rule: { boundaries, nightBelongsTo: row.nb ?? fallback.nightBelongsTo, mode: row.mode ?? fallback.mode },
    };
  });
}

/**
 * The shift rule in force for a reading taken at `productionTsUtcMs` (plant
 * wall clock, UTC-labelled) — the newest version whose `effectiveAtPlantMs`
 * is at or before that reading's own time. `history` must be sorted
 * ascending (as loadShiftRuleHistory returns it) and non-empty.
 */
export function resolveShiftRuleAt(history: readonly ShiftRuleVersion[], productionTsUtcMs: number): ShiftRule {
  let chosen = history[0]!;
  for (const v of history) {
    if (v.effectiveAtPlantMs <= productionTsUtcMs) chosen = v;
    else break;
  }
  return chosen.rule;
}

/** Same idea as loadShiftRuleHistory, for sms.plausibility_rule. */
export async function loadPlausibilityRuleHistory(
  pool: ConnectionPool,
  lineId: number,
): Promise<PlausibilityVersion[]> {
  const r = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ cl: number; ch: number; sl: number; sh: number; ef: Date }>(
      `SELECT cone_lo_g cl, cone_hi_g ch, sack_lo_kg sl, sack_hi_kg sh, effective_from ef
         FROM sms.plausibility_rule WHERE line_id=@line ORDER BY effective_from ASC`,
    );
  if (r.recordset.length === 0) {
    return [{ effectiveAtPlantMs: -Infinity, bounds: DEFAULT_PLAUSIBILITY }];
  }
  return r.recordset.map((row) => ({
    effectiveAtPlantMs: toPlantMs(row.ef.getTime()),
    bounds: { coneLoG: Number(row.cl), coneHiG: Number(row.ch), sackLoKg: Number(row.sl), sackHiKg: Number(row.sh) },
  }));
}

/** Same idea as resolveShiftRuleAt, for the plausibility window. */
export function resolvePlausibilityAt(history: readonly PlausibilityVersion[], productionTsUtcMs: number): PlausibilityBounds {
  let chosen = history[0]!;
  for (const v of history) {
    if (v.effectiveAtPlantMs <= productionTsUtcMs) chosen = v;
    else break;
  }
  return chosen.bounds;
}
