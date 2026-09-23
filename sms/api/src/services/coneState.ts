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

/**
 * Whether the product-tolerance states in a payload rest on a limits start
 * date this system knows, and the one sentence that says so when they do not.
 *
 * WHY THIS IS AN AGGREGATE AND NOT A PER-ROW FLAG. Before migration 040 the
 * answer was "no" for 275,063 of 275,063 cones — 100 % of real plant data.
 * An asterisk on every row of a register carries no information; it is
 * decoration that a reader learns to stop seeing in about four seconds. The
 * fact is a property of the WHOLE figure, so it is stated once, over the
 * figure, in words that name what is and is not known.
 *
 * WHY IT IS A SERVER SENTENCE. The same reason resolvePeriodTarget's is
 * (719fbee): the service is the only thing that knows WHICH versions were
 * consulted and why they were doubted, and a screen that composed its own
 * wording would be free to drift from what was actually computed.
 *
 * IT IS BUILT TO GO AWAY. `ok` is true — and `note` null — as soon as no
 * window in force is resting on an assumed start, which is exactly what a
 * 'pdas_created' version (migration 040) or an engineer's confirmed
 * 'sms_local' version produces. Nothing has to be edited for the disclosure
 * to disappear; it stops being true and so it stops being printed.
 *
 * THIS SAYS NOTHING ABOUT THE SCALE'S OWN VERDICT. ONE STATUS VOCABULARY
 * (CLAUDE.md rule 1): "Passed" / "Rejected by the scale" is the scale's
 * in-range bit, a separate and differently-named fact that no limits version
 * has ever touched. bindStateCase resolves `in_range = 0` to 'rejected'
 * BEFORE it consults a single window, so a reading the scale rejected is
 * reported as such whether or not any limits are known. This disclosure is
 * about the product tolerance and must never be worded as though it put the
 * scale's answer in doubt.
 */
export interface LimitProvenance {
  /** True when every window in force owns its start date. */
  ok: boolean;
  /** Windows whose start is assumed, and the total, so a caller can be specific. */
  assumedWindows: number;
  totalWindows: number;
  /** The sentence to print, once, beside the affected figures. Null when `ok`. */
  note: string | null;
}

/**
 * The disclosure for a loaded context. Pure — takes the windows, returns the
 * finding — so the wording is testable without a database.
 */
export function limitProvenance(ctx: StateContext): LimitProvenance {
  const total = ctx.windows.length;
  const assumed = ctx.windows.filter((w) => w.assumedStart).length;
  if (assumed === 0) {
    return { ok: true, assumedWindows: 0, totalWindows: total, note: null };
  }
  const all = assumed === total;
  // "Every set … was" against "2 of 36 sets … were". Worth the two lines:
  // this sentence is printed on a report an engineer may hand to a manager,
  // and a plural error on it invites the reader to discount the rest of it.
  const subject = all
    ? 'Every set of limits in force here was'
    : `${assumed} of the ${total} sets of limits in force here ${assumed === 1 ? 'was' : 'were'}`;
  return {
    ok: false,
    assumedWindows: assumed,
    totalWindows: total,
    note:
      `Product-tolerance figures below are judged against limits whose start date this system does not know. ` +
      `${subject} first recorded after the readings they are being applied to, ` +
      `so "within" and "outside the product's limits" state what today's limits would have said, not what was in force at the time. ` +
      `The scale's own verdict — passed, or rejected by the scale — is a separate reading taken at the machine and is not affected.`,
  };
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
