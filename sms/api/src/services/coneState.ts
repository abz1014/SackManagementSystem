/**
 * The cone classification, in SQL — roadmap Phase 4 item 1 (14 Sep 2026).
 *
 * shared/src/domain/classification.ts is the rule. Set-based queries (the
 * register's state column and filter, the per-state counts on
 * /api/production, the reconciliation) cannot call a TypeScript function per
 * row, so this module builds a CASE expression with the SAME checks in the
 * SAME order, and the test beside it runs the acceptance fixture through the
 * generated SQL to prove the two never drift apart. There is deliberately no
 * third place that knows the rule.
 *
 * LIMITS VARY BY PRODUCT AND BY TIME, so "the limits in force at the
 * reading's own time" becomes a list of WINDOWS, each one product's limits
 * version over the interval it applied:
 *  - for readings that carry their own MaterialId (every row since IFL's
 *    2026-08-05 rebuild): one window per (product, limits version), from the
 *    versioned history — never the mirror's current values;
 *  - for readings with no MaterialId (July): the hand-entered line-wide
 *    timeline, each entry from its start to the next entry's start, with the
 *    limits as they stood when it began.
 * A reading matching no window is 'unknown' — nothing to judge it against —
 * and is never assumed to pass.
 *
 * THE ONE POPULATION RULE lives here too: `plausibleWhere` is the only text
 * a weight statistic may use to exclude scale faults. Three services used to
 * hold three different populations (spc both bounds, weights the lower bound
 * only, production none), so "the app's average cone weight" was not one
 * number. Now it is, and a screen that deliberately shows the faults says so
 * with `includeImplausible: true` rather than by omitting the predicate.
 */
import type { ConnectionPool, Request as SqlRequest } from 'mssql';
import mssql from 'mssql';
import { CONE_STATES, type ConeState } from '@sms/shared';
import { getPlausibilityRule } from './admin.js';
import { loadProductTimeline, limitWindowsFor, type LimitWindow } from './productAt.js';
import { loadProductCatalogue } from './productLimits.js';

export { limitWindowsFor, type LimitWindow };

export interface PlausibilityWindow {
  loG: number;
  hiG: number;
}

export interface StateContext {
  plausibility: PlausibilityWindow;
  windows: LimitWindow[];
}

/** Everything the CASE needs, loaded once per request. */
export async function loadStateContext(pool: ConnectionPool, lineId: number): Promise<StateContext> {
  const [plaus, timeline, catalogue] = await Promise.all([
    getPlausibilityRule(pool, lineId),
    loadProductTimeline(pool, lineId),
    loadProductCatalogue(pool),
  ]);
  return {
    plausibility: { loG: plaus.coneLoG, hiG: plaus.coneHiG },
    windows: limitWindowsFor(timeline, catalogue),
  };
}

/**
 * Binds the plausibility bounds and returns the population predicate.
 * `includeImplausible` returns a tautology so a caller's WHERE stays valid
 * while saying, in its own code, that it means to show the faults.
 */
export function plausibleWhere(
  req: SqlRequest,
  col: string,
  window: PlausibilityWindow,
  opts: { includeImplausible?: boolean; prefix?: string } = {},
): string {
  const p = opts.prefix ?? 'plaus';
  req.input(`${p}Lo`, mssql.Float, window.loG);
  req.input(`${p}Hi`, mssql.Float, window.hiG);
  if (opts.includeImplausible) return `${col} IS NOT NULL`;
  return `${col} BETWEEN @${p}Lo AND @${p}Hi`;
}

/**
 * The CASE expression, with its parameters bound on `req`. Column names are
 * qualified with `alias` ('e.' in the register, '' elsewhere). `prefix` keeps
 * two CASEs in one statement from colliding on parameter names.
 *
 * Mirrors classifyConeDetail check for check:
 *   1. weight null or outside the plausibility window -> 'unknown'
 *   2. in_range = 0                                    -> 'rejected'
 *   3. a window matches the reading's product and time -> low / high / within
 *   4. nothing matched                                 -> 'unknown'
 * A reading with no in_range bit falls through to 3, as the function does.
 */
export function bindStateCase(req: SqlRequest, ctx: StateContext, alias = '', prefix = 'cs'): string {
  const c = (name: string) => `${alias}${name}`;
  const w = c('weight_g');
  req.input(`${prefix}PlausLo`, mssql.Float, ctx.plausibility.loG);
  req.input(`${prefix}PlausHi`, mssql.Float, ctx.plausibility.hiG);
  const whens: string[] = [
    `WHEN ${w} IS NULL OR ${w} < @${prefix}PlausLo OR ${w} > @${prefix}PlausHi THEN 'unknown'`,
    `WHEN ${c('in_range')} = 0 THEN 'rejected'`,
  ];
  ctx.windows.forEach((win, i) => {
    const parts: string[] = [];
    if (win.materialId == null) {
      parts.push(`${c('material_id')} IS NULL`);
    } else {
      parts.push(`${c('material_id')} = @${prefix}Mat${i}`);
      req.input(`${prefix}Mat${i}`, mssql.Int, win.materialId);
    }
    if (win.fromMs != null) {
      parts.push(`${c('production_ts_utc_ms')} >= @${prefix}From${i}`);
      req.input(`${prefix}From${i}`, mssql.BigInt, win.fromMs);
    }
    if (win.toMs != null) {
      parts.push(`${c('production_ts_utc_ms')} < @${prefix}To${i}`);
      req.input(`${prefix}To${i}`, mssql.BigInt, win.toMs);
    }
    req.input(`${prefix}Lo${i}`, mssql.Float, win.loG);
    req.input(`${prefix}Hi${i}`, mssql.Float, win.hiG);
    whens.push(
      `WHEN ${parts.join(' AND ')} THEN CASE WHEN ${w} < @${prefix}Lo${i} THEN 'low' WHEN ${w} > @${prefix}Hi${i} THEN 'high' ELSE 'within' END`,
    );
  });
  return `CASE ${whens.join(' ')} ELSE 'unknown' END`;
}

/** `{ within: 0, low: 0, … }` — the shape every per-state count answers in. */
export type StateCounts = Record<ConeState, number>;

export function emptyStateCounts(): StateCounts {
  return { within: 0, low: 0, high: 0, rejected: 0, unknown: 0 };
}

/** Fold `GROUP BY <state>` rows into the fixed five-key shape, so a state with no rows is 0, not absent. */
export function foldStateCounts(rows: { state: string; n: number | string }[]): StateCounts {
  const out = emptyStateCounts();
  for (const r of rows) {
    if ((CONE_STATES as readonly string[]).includes(r.state)) out[r.state as ConeState] = Number(r.n);
  }
  return out;
}

/** Parse a `?state=` comma list; null when absent, [] when nothing valid was named. */
export function parseStates(raw: string | undefined | null): ConeState[] | null {
  if (raw == null || raw.trim() === '') return null;
  const seen = new Set<ConeState>();
  for (const s of raw.split(',').map((x) => x.trim())) {
    if ((CONE_STATES as readonly string[]).includes(s)) seen.add(s as ConeState);
  }
  return [...seen];
}
