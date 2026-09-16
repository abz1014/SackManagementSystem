/**
 * productDisagreement must count the SAME population the register's state
 * column (and classifyCone, the rule it is proven against in
 * coneState.test.ts) counts as 'low' + 'high' — roadmap defect fix, 16 Sep
 * 2026.
 *
 * Before this fix, productDisagreement's base WHERE only excluded a NULL
 * weight; the register's state column (bindStateCase) excludes an
 * IMPLAUSIBLE weight first, before it even looks at in_range or a product
 * window. A scale fault — the recorded 824 g "cone", or one of the ~214-cone
 * 2200-2354 g fault population documented in spc.ts — could therefore be
 * counted by productDisagreement as "passed by the scale but outside the
 * product's limits" while the register showed the very same reading as
 * 'unknown'. Clicking through from the Weight screen's banner to the
 * register then landed on a different number of rows than the banner
 * claimed.
 *
 * This file proves the fix two ways:
 *  - the generated SQL binds the plausibility rule fetched from the DB
 *    (not a constant), same as weights.ts/spc.ts/production.ts;
 *  - run against a fixture where the old and new population differ, the
 *    number productDisagreement returns for "passed but outside" now equals
 *    the number of rows classifyCone (the canonical, register-proven rule)
 *    would classify 'low' or 'high' for the very same rows.
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { classifyCone, isPlausibleWeight, type ConeLimits, type ConeState } from '@sms/shared';
import { ProductTimeline, productDisagreement } from './productAt.js';
import { ProductCatalogue, type LimitVersion } from './productLimits.js';

interface Captured { sql: string; params: Map<string, unknown> }

/** The rule on file for this test — deliberately not the 1500/2100 fallback, so a call that ignored it would show. */
const RULE = { cl: 1600, ch: 2150, sl: 40, sh: 60 };
const PLAUS = { loG: RULE.cl, hiG: RULE.ch };

/** Product 14: 1960 setpoint, ±30 g -> limits 1930-1990. */
const LIMITS: ConeLimits = { setpointG: 1960, minusG: 30, plusG: 30 };

/** A production instant every ROWS row shares by default; only the tsTo tests below vary it. */
const BASE_TS = Date.UTC(2026, 8, 3, 12, 0, 0);

interface Row { weight_g: number | null; in_range: boolean | null; material_id: number | null; production_ts_utc_ms: number }
const row = (weightG: number | null, inRange: boolean | null, materialId: number | null = 14, ts: number = BASE_TS): Row => ({
  weight_g: weightG, in_range: inRange, material_id: materialId, production_ts_utc_ms: ts,
});

/**
 * The seven cones this test drives through both the real service and the
 * canonical rule. 824 g and 2,300 g are the two scale-fault shapes spc.ts
 * documents; both were wrongly counted as "passed but outside" before this
 * fix because productDisagreement never checked plausibility.
 */
const ROWS: Row[] = [
  row(824, true), // implausible (low fault) — OLD bug counted this; must now be excluded
  row(1900, true), // plausible, below the lower limit — a genuine 'low'
  row(1960, true), // plausible, inside the limits — 'within', never counted
  row(1900, false), // rejected by the scale, and outside the limits anyway
  row(1960, false), // rejected by the scale, but inside the limits — rejectedButInside
  row(2300, true), // implausible (high fault) — OLD bug counted this too
  row(1900, true, 99), // a product the catalogue/window doesn't know — unjudged, not counted either way
];

/** classifyCone needs the resolved limits for a row's own material; only material 14 has a window here. */
const limitsForRow = (materialId: number | null): ConeLimits | null => (materialId === 14 ? LIMITS : null);

/** What the register's state column (bindStateCase, proven == classifyCone in coneState.test.ts) would show for each row. */
function registerState(r: Row): ConeState {
  return classifyCone({
    weightG: r.weight_g,
    inRange: r.in_range,
    limits: limitsForRow(r.material_id),
    plausible: isPlausibleWeight(r.weight_g, PLAUS),
  });
}

function fakePool(rows: Row[]): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => {
          params.set(name, v);
          return req;
        },
        query: async (sql: string) => {
          calls.push({ sql, params });
          if (sql.includes('FROM sms.plausibility_rule')) return { recordset: [RULE] };
          if (sql.includes('AS passedOut')) {
            // Evaluate the ACTUAL generated fragments against the fixture rows,
            // using the params productDisagreement itself bound — not an
            // assumption about what it should have bound.
            const judgeable = extract(sql, 'judged');
            const outside = extract(sql, 'passedOut');
            const inside = extract(sql, 'rejectedIn');
            const plausible = (r: Row) => r.weight_g != null && r.weight_g >= (params.get('plausLo') as number) && r.weight_g <= (params.get('plausHi') as number);
            // The tsTo fragment is optional (defect fix, 16 Sep 2026): present
            // only when the caller gave a range.tsTo, applied against the SAME
            // bound param productDisagreement itself set.
            const hasTsTo = /AND production_ts_utc_ms <= @tsTo/.test(sql);
            const withinTsTo = (r: Row) => !hasTsTo || r.production_ts_utc_ms <= (params.get('tsTo') as number);
            const base = (r: Row) => plausible(r) && withinTsTo(r);
            const total = rows.filter(base).length;
            const judged = rows.filter((r) => base(r) && r.in_range != null && evalExpr(judgeable, r, params)).length;
            const passedOut = rows.filter((r) => base(r) && r.in_range === true && evalExpr(outside, r, params)).length;
            const rejectedIn = rows.filter((r) => base(r) && r.in_range === false && evalExpr(inside, r, params)).length;
            return { recordset: [{ total, judged, passedOut, rejectedIn }] };
          }
          return { recordset: [] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

/**
 * Pulls the `CASE WHEN in_range <op> AND <fragment> THEN 1 ELSE 0 END) AS
 * <alias>` condition out, minus the in_range test (checked separately, in JS,
 * above). Anchored on the SPECIFIC `in_range <op> AND ` text each alias's
 * CASE starts with — a bare `AND ` is not unique (the judged/passedOut/
 * rejectedIn fragments sit one after another in the same SELECT), and a
 * non-greedy match against the wrong, earlier `AND ` used to swallow the
 * next fragment whole instead of stopping at its own `THEN`.
 */
function extract(sql: string, alias: 'judged' | 'passedOut' | 'rejectedIn'): string {
  const prefix = { judged: 'in_range IS NOT NULL AND ', passedOut: 'in_range = 1 AND ', rejectedIn: 'in_range = 0 AND ' }[alias];
  const re = new RegExp(`${prefix}([\\s\\S]+?) THEN 1 ELSE 0 END\\) AS ${alias}`);
  const m = re.exec(sql);
  if (!m) throw new Error(`could not find the ${alias} fragment in:\n${sql}`);
  return m[1]!;
}

/** A tiny boolean-expression evaluator for the AND/OR/parens/comparison grammar productDisagreement generates. */
function evalExpr(raw: string, r: Row, params: Map<string, unknown>): boolean {
  const s = stripParens(raw.trim());
  const or = splitTop(s, ' OR ');
  if (or) return or.some((p) => evalExpr(p, r, params));
  const and = splitTop(s, ' AND ');
  if (and) return and.every((p) => evalExpr(p, r, params));
  return evalAtom(stripParens(s), r, params);
}

function splitTop(s: string, sep: string): string[] | null {
  let depth = 0;
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i));
      start = i + sep.length;
    }
  }
  parts.push(s.slice(start));
  return parts.length > 1 ? parts : null;
}

function stripParens(s: string): string {
  const t = s.trim();
  if (!(t.startsWith('(') && t.endsWith(')'))) return t;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')') {
      depth--;
      if (depth === 0 && i !== t.length - 1) return t; // outer parens don't wrap the whole string
    }
  }
  return stripParens(t.slice(1, -1));
}

function evalAtom(atom: string, r: Row, params: Map<string, unknown>): boolean {
  const a = atom.trim();
  const row = r as unknown as Record<string, unknown>;
  let m = /^(\w+) = (@\w+|\d+)$/.exec(a);
  if (m) {
    const v = row[m[1]!];
    if (v == null) return false;
    const rhs = m[2]!.startsWith('@') ? params.get(m[2]!.slice(1)) : Number(m[2]);
    return Number(v) === Number(rhs);
  }
  m = /^(\w+) (<|>|<=|>=) (@\w+|\d+)$/.exec(a);
  if (m) {
    const v = row[m[1]!];
    if (v == null) return false;
    const rhs = m[3]!.startsWith('@') ? params.get(m[3]!.slice(1)) : Number(m[3]);
    const av = Number(v);
    const bv = Number(rhs);
    switch (m[2]) {
      case '<': return av < bv;
      case '>': return av > bv;
      case '<=': return av <= bv;
      case '>=': return av >= bv;
    }
  }
  throw new Error(`unrecognized atom: ${atom}`);
}

/** Builds a catalogue/timeline that resolves to exactly one window: product 14, unbounded time, 1930-1990. */
function setup() {
  const timeline = new ProductTimeline([]);
  const version: LimitVersion = {
    productId: 14, setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30,
    effectiveFromMs: 0, effectiveFromUtc: '1970-01-01T00:00:00.000Z',
    effectiveIsLowerBound: false, source: 'pdas_observed',
  };
  const catalogue = new ProductCatalogue([{ productId: 14, label: 'P14', activeFlag: true }], [version]);
  return { timeline, catalogue };
}

describe('productDisagreement — the one population rule', () => {
  it('binds the plausibility rule fetched from the DB, not a constant', async () => {
    const { pool, calls } = fakePool(ROWS);
    const { timeline, catalogue } = setup();
    await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-07' }, catalogue);
    const main = calls.find((c) => c.sql.includes('AS passedOut'))!;
    expect(main.params.get('plausLo')).toBe(RULE.cl);
    expect(main.params.get('plausHi')).toBe(RULE.ch);
    expect(main.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
  });

  it('passedButOutside equals the register\'s low+high count on a fixture where the two used to diverge', async () => {
    const { pool } = fakePool(ROWS);
    const { timeline, catalogue } = setup();
    const result = await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-07' }, catalogue);

    const registerLowHigh = ROWS.filter((r) => ['low', 'high'].includes(registerState(r))).length;

    // Manually: only the 1,900 g / in_range=true cone is a genuine 'low'.
    // 824 g and 2,300 g are scale faults (implausible) — 'unknown', not 'low'/'high'.
    expect(registerLowHigh).toBe(1);
    expect(result.passedButOutside).toBe(registerLowHigh);

    // Before this fix the query had no plausibility filter, so `in_range=1
    // AND isOutside` also caught the 824 g and 2,300 g faults: passedButOutside
    // would have come back 3, not 1 — the exact divergence this test pins.
    expect(result.passedButOutside).toBe(1);
  });

  it('rejectedButInside still counts a scale-rejected cone that sits inside the limits', async () => {
    const { pool } = fakePool(ROWS);
    const { timeline, catalogue } = setup();
    const result = await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-07' }, catalogue);
    expect(result.rejectedButInside).toBe(1); // the 1,960 g / in_range=false cone
  });

  it('judged/unjudged exclude the implausible rows entirely, and the mismatched-product row is unjudged', async () => {
    const { pool } = fakePool(ROWS);
    const { timeline, catalogue } = setup();
    const result = await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-07' }, catalogue);
    // Plausible rows: 1900/true, 1960/true, 1900/false, 1960/false, 1900(mat 99)/true = 5.
    // Judged (plausible, has a bit, matches the product-14 window): the first four = 4.
    expect(result.judged).toBe(4);
    expect(result.unjudged).toBe(1); // the material-99 row: plausible, has a bit, but no window matches it
  });
});

describe('productDisagreement — tsTo (defect fix, 16 Sep 2026: /api/attention had no replay guard)', () => {
  it('is byte-identical when tsTo is absent: no fragment, no bound param', async () => {
    const { pool, calls } = fakePool(ROWS);
    const { timeline, catalogue } = setup();
    await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-07' }, catalogue);
    const main = calls.find((c) => c.sql.includes('AS passedOut'))!;
    expect(main.sql).not.toContain('production_ts_utc_ms <=');
    expect(main.params.has('tsTo')).toBe(false);
  });

  it('binds tsTo as the same convention as production.ts/rejects.ts (raw ms, no plant-clock conversion)', async () => {
    const { pool, calls } = fakePool(ROWS);
    const { timeline, catalogue } = setup();
    const tsTo = '2026-09-03T12:00:00.000Z';
    await productDisagreement(pool, 1, timeline, { from: '2026-09-01', to: '2026-09-07', tsTo }, catalogue);
    const main = calls.find((c) => c.sql.includes('AS passedOut'))!;
    expect(main.sql).toContain('AND production_ts_utc_ms <= @tsTo');
    expect(main.params.get('tsTo')).toBe(new Date(tsTo).getTime());
  });

  it('excludes a reading written after tsTo, counts the same reading written at or before it', async () => {
    const tsTo = Date.UTC(2026, 8, 3, 12, 0, 0);
    const before = row(1900, true, 14, tsTo); // at the boundary — inclusive
    const after = row(1900, true, 14, tsTo + 1); // one ms later — excluded
    const { timeline, catalogue } = setup();

    const withBoth = await productDisagreement(
      fakePool([before, after]).pool, 1, timeline,
      { from: '2026-09-01', to: '2026-09-07', tsTo: new Date(tsTo).toISOString() }, catalogue,
    );
    expect(withBoth.passedButOutside).toBe(1); // only `before` counted

    const withoutCap = await productDisagreement(
      fakePool([before, after]).pool, 1, timeline,
      { from: '2026-09-01', to: '2026-09-07' }, catalogue,
    );
    expect(withoutCap.passedButOutside).toBe(2); // no cap: both count
  });
});
