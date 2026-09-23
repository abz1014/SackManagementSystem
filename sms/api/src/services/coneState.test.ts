/**
 * The SQL form of the cone classification must agree with the TypeScript
 * rule on every fixture case (roadmap Phase 4 item 1, 14 Sep 2026).
 *
 * bindStateCase builds a CASE expression from a small, fixed grammar (no
 * parentheses, AND/OR at one level, a nested CASE only in a THEN). The
 * evaluator below interprets exactly that grammar against an in-memory row
 * and the parameters the builder bound — so the same 24 cases IFL will be
 * asked to approve are run through the generated SQL, not through a
 * hand-written imitation of it. If the builder ever grows a construct the
 * evaluator does not know, the evaluator throws rather than guessing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Request as SqlRequest } from 'mssql';
import { classifyCone, isPlausibleWeight, type ConeLimits, type ConeState } from '@sms/shared';
import { bindStateCase, foldStateCounts, limitWindowsFor, parseStates, plausibleWhere, type StateContext } from './coneState.js';
import { ProductTimeline } from './productAt.js';
import { ProductCatalogue } from './productLimits.js';

interface FixtureCase {
  id: number;
  weightG: number | null;
  inRange: boolean | null;
  limits?: ConeLimits | null;
  expected: ConeState;
  why: string;
}
interface Fixture {
  plausibility: { loG: number; hiG: number };
  defaultLimits: ConeLimits;
  cases: FixtureCase[];
}
const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../../test/fixtures/cone-classification.json', import.meta.url), 'utf8'),
);

/** Records every bound parameter. */
function recorder(): { req: SqlRequest; params: Map<string, unknown> } {
  const params = new Map<string, unknown>();
  const req = {
    input: (name: string, _t: unknown, v: unknown) => {
      params.set(name, v);
      return req;
    },
  } as unknown as SqlRequest;
  return { req, params };
}

type Row = Record<string, unknown>;

/** Interprets the generated CASE against one row. */
function evalCase(sql: string, row: Row, params: Map<string, unknown>): string {
  const s = sql.trim();
  if (!s.startsWith('CASE ') || !s.endsWith(' END')) throw new Error(`not a CASE: ${s}`);
  let body = s.slice(5, -4).trim();
  // Split into WHEN … THEN … pairs at depth 0 (a nested CASE raises the depth).
  const whens: { cond: string; then: string }[] = [];
  let elseVal: string | null = null;
  while (body.length > 0) {
    if (body.startsWith('ELSE ')) {
      elseVal = body.slice(5).trim();
      break;
    }
    if (!body.startsWith('WHEN ')) throw new Error(`expected WHEN at: ${body.slice(0, 40)}`);
    const thenIdx = body.indexOf(' THEN ');
    const cond = body.slice(5, thenIdx);
    let rest = body.slice(thenIdx + 6);
    let then: string;
    if (rest.startsWith('CASE ')) {
      const endIdx = rest.indexOf(' END') + 4;
      then = rest.slice(0, endIdx);
      rest = rest.slice(endIdx).trim();
    } else {
      const m = /^'(\w+)'/.exec(rest);
      if (!m) throw new Error(`expected literal at: ${rest.slice(0, 40)}`);
      then = m[0];
      rest = rest.slice(m[0].length).trim();
    }
    whens.push({ cond, then });
    body = rest;
  }
  for (const w of whens) {
    if (evalCond(w.cond, row, params)) return evalThen(w.then, row, params);
  }
  if (elseVal == null) throw new Error('CASE without ELSE');
  return evalThen(elseVal, row, params);
}

function evalThen(t: string, row: Row, params: Map<string, unknown>): string {
  if (t.startsWith('CASE ')) return evalCase(t, row, params);
  const m = /^'(\w+)'$/.exec(t.trim());
  if (!m) throw new Error(`bad THEN: ${t}`);
  return m[1]!;
}

function evalCond(cond: string, row: Row, params: Map<string, unknown>): boolean {
  if (cond.includes(' OR ')) return cond.split(' OR ').some((c) => evalCond(c, row, params));
  if (cond.includes(' AND ')) return cond.split(' AND ').every((c) => evalCond(c, row, params));
  const c = cond.trim();
  let m = /^(?:e\.)?(\w+) IS NULL$/.exec(c);
  if (m) return row[m[1]!] == null;
  m = /^(?:e\.)?(\w+) (=|<|>|>=|<=) (@\w+|\d+)$/.exec(c);
  if (!m) throw new Error(`unknown atom: ${c}`);
  const v = row[m[1]!];
  if (v == null) return false; // SQL three-valued logic: NULL compares to nothing
  const rhs = m[3]!.startsWith('@') ? params.get(m[3]!.slice(1)) : Number(m[3]);
  if (rhs === undefined) throw new Error(`unbound parameter ${m[3]}`);
  const a = typeof v === 'boolean' ? Number(v) : Number(v);
  const b = Number(rhs);
  switch (m[2]) {
    case '=': return a === b;
    case '<': return a < b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '<=': return a <= b;
  }
  return false;
}

/** A context whose windows carry ONE product (id 14) with the given limits, or none. */
function contextFor(limits: ConeLimits | null): StateContext {
  return {
    plausibility: fixture.plausibility,
    windows: limits
      ? [{ materialId: 14, fromMs: null, toMs: null, loG: limits.setpointG - Math.abs(limits.minusG), hiG: limits.setpointG + Math.abs(limits.plusG), assumedStart: false }]
      : [],
  };
}

describe('bindStateCase — the SQL agrees with classifyCone on every fixture case', () => {
  it.each(fixture.cases)('case $id: $why', (c) => {
    const limits = c.limits === undefined ? fixture.defaultLimits : c.limits;
    const { req, params } = recorder();
    const sql = bindStateCase(req, contextFor(limits), 'e.');
    const row: Row = { weight_g: c.weightG, in_range: c.inRange, material_id: 14, production_ts_utc_ms: 1 };
    const fromSql = evalCase(sql, row, params);
    const fromRule = classifyCone({ weightG: c.weightG, inRange: c.inRange, limits, plausible: isPlausibleWeight(c.weightG, fixture.plausibility) });
    expect(fromSql).toBe(fromRule);
    expect(fromSql).toBe(c.expected);
  });

  it('runs the checks in the rule\'s order: plausibility, then the scale bit, then the windows, else unknown', () => {
    const { req } = recorder();
    const sql = bindStateCase(req, contextFor(fixture.defaultLimits), 'e.');
    const iPlaus = sql.indexOf('@csPlausLo');
    const iRej = sql.indexOf("= 0 THEN 'rejected'");
    const iWin = sql.indexOf('@csMat0');
    const iElse = sql.lastIndexOf("ELSE 'unknown' END");
    expect(iPlaus).toBeGreaterThan(-1);
    expect(iRej).toBeGreaterThan(iPlaus);
    expect(iWin).toBeGreaterThan(iRej);
    expect(iElse).toBeGreaterThan(iWin);
  });

  it('a reading whose product matches no window is unknown, even when the scale passed it', () => {
    const { req, params } = recorder();
    const sql = bindStateCase(req, contextFor(fixture.defaultLimits), 'e.');
    // Product 99 is not in the catalogue — nothing to judge it against.
    expect(evalCase(sql, { weight_g: 1960, in_range: true, material_id: 99, production_ts_utc_ms: 1 }, params)).toBe('unknown');
    // …but the scale's bit still means rejected.
    expect(evalCase(sql, { weight_g: 1960, in_range: false, material_id: 99, production_ts_utc_ms: 1 }, params)).toBe('rejected');
  });

  it('judges a reading by the limits version in force at ITS time, not the newest', () => {
    // Product 14: 1960 ± 30 until t=1000, then 1950 ± 20.
    const catalogue = new ProductCatalogue(
      [{ productId: 14, label: 'P14', activeFlag: true }],
      [
        { productId: 14, setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: 0, effectiveFromUtc: '1970-01-01T00:00:00.000Z', effectiveIsLowerBound: true, source: 'pdas_observed' },
        { productId: 14, setpointG: 1950, offsetMinusG: 20, offsetPlusG: 20, effectiveFromMs: 1000, effectiveFromUtc: '1970-01-01T00:00:01.000Z', effectiveIsLowerBound: false, source: 'sms_write' },
      ],
    );
    const ctx: StateContext = { plausibility: fixture.plausibility, windows: limitWindowsFor(new ProductTimeline([]), catalogue) };
    expect(ctx.windows).toHaveLength(2);
    const { req, params } = recorder();
    const sql = bindStateCase(req, ctx, '');
    // 1985 g: within the old 1930-1990, high under the new 1930-1970.
    expect(evalCase(sql, { weight_g: 1985, in_range: true, material_id: 14, production_ts_utc_ms: 500 }, params)).toBe('within');
    expect(evalCase(sql, { weight_g: 1985, in_range: true, material_id: 14, production_ts_utc_ms: 1500 }, params)).toBe('high');
  });

  it('readings with no material_id are judged by the line-wide timeline, attributed ones never are', () => {
    const catalogue = new ProductCatalogue(
      [{ productId: 14, label: 'P14', activeFlag: true }],
      [{ productId: 14, setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: 0, effectiveFromUtc: '1970-01-01T00:00:00.000Z', effectiveIsLowerBound: true, source: 'pdas_observed' }],
    );
    const timeline = new ProductTimeline([
      { productId: 14, label: 'P14', setpointG: 1960, weightOffsetMinusG: 30, weightOffsetPlusG: 30, effectiveFromMs: 100, effectiveFromUtc: '1970-01-01T00:00:00.100Z' },
    ]);
    const ctx: StateContext = { plausibility: fixture.plausibility, windows: limitWindowsFor(timeline, catalogue) };
    const { req, params } = recorder();
    const sql = bindStateCase(req, ctx, '');
    // Unattributed, after the timeline entry began: judged.
    expect(evalCase(sql, { weight_g: 1900, in_range: true, material_id: null, production_ts_utc_ms: 200 }, params)).toBe('low');
    // Unattributed, BEFORE any product was recorded: unknown.
    expect(evalCase(sql, { weight_g: 1900, in_range: true, material_id: null, production_ts_utc_ms: 50 }, params)).toBe('unknown');
    // Attributed to a product the catalogue does not know: unknown, even though the timeline would say low.
    expect(evalCase(sql, { weight_g: 1900, in_range: true, material_id: 77, production_ts_utc_ms: 200 }, params)).toBe('unknown');
  });
});

describe('plausibleWhere — the one population rule', () => {
  it('binds both bounds and is inclusive', () => {
    const { req, params } = recorder();
    expect(plausibleWhere(req, 'weight_g', { loG: 1500, hiG: 2100 })).toBe('weight_g BETWEEN @plausLo AND @plausHi');
    expect(params.get('plausLo')).toBe(1500);
    expect(params.get('plausHi')).toBe(2100);
  });
  it('includeImplausible keeps the WHERE valid and says what it means', () => {
    const { req } = recorder();
    expect(plausibleWhere(req, 'weight_g', { loG: 1500, hiG: 2100 }, { includeImplausible: true })).toBe('weight_g IS NOT NULL');
  });
});

describe('helpers', () => {
  it('foldStateCounts fills every state, zero where no rows came back', () => {
    expect(foldStateCounts([{ state: 'within', n: '5' }, { state: 'bogus', n: 9 }])).toEqual({ within: 5, low: 0, high: 0, rejected: 0, unknown: 0 });
  });
  it('parseStates accepts a comma list, drops unknown names, null when absent', () => {
    expect(parseStates('low,high,low')).toEqual(['low', 'high']);
    expect(parseStates('nonsense')).toEqual([]);
    expect(parseStates(undefined)).toBeNull();
    expect(parseStates('')).toBeNull();
  });
});
