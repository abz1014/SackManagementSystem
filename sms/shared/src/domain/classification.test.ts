/**
 * The one cone classification, pinned two ways (roadmap Phase 4, 14 Sep 2026):
 *
 *  1. The acceptance fixture — sms/test/fixtures/cone-classification.json,
 *     24 cases with an expected state and a one-line reason each. It is the
 *     document IFL will be asked to approve, so the test runs the file itself
 *     rather than a copy of its values: an approved fixture and a passing
 *     test are then the same fact.
 *  2. Unit cases for the ordering the fixture cannot express one at a time:
 *     that each check is reached only when every earlier one has passed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONE_STATES,
  classifyCone,
  classifyConeDetail,
  isConeState,
  isPlausibleWeight,
  limitBounds,
  type ConeLimits,
  type ConeState,
} from './classification.js';

interface FixtureCase {
  id: number;
  weightG: number | null;
  inRange: boolean | null;
  limits?: ConeLimits | null;
  expected: ConeState;
  why: string;
  expectedScalePassed?: boolean | null;
  expectedOutsideByG?: number;
  expectedUnknownReason?: string;
}
interface Fixture {
  _header: { status: string };
  plausibility: { loG: number; hiG: number };
  defaultLimits: ConeLimits;
  cases: FixtureCase[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../../test/fixtures/cone-classification.json', import.meta.url), 'utf8'),
);

describe('cone-classification.json (the acceptance fixture)', () => {
  it('is marked developer-proposed and awaiting IFL approval', () => {
    expect(fixture._header.status).toMatch(/developer-proposed/);
    expect(fixture._header.status).toMatch(/awaiting IFL approval/);
  });

  it('holds 24 cases and covers every state', () => {
    expect(fixture.cases).toHaveLength(24);
    const seen = new Set(fixture.cases.map((c) => c.expected));
    for (const s of CONE_STATES) expect(seen.has(s), `no case expects '${s}'`).toBe(true);
    // Every expected state is a real state — a typo in the fixture must fail here, not pass vacuously.
    for (const c of fixture.cases) expect(isConeState(c.expected), `case ${c.id}`).toBe(true);
  });

  it.each(fixture.cases)('case $id: $why', (c) => {
    const limits = c.limits === undefined ? fixture.defaultLimits : c.limits;
    const detail = classifyConeDetail({
      weightG: c.weightG,
      inRange: c.inRange,
      limits,
      plausible: isPlausibleWeight(c.weightG, fixture.plausibility),
    });
    expect(detail.state).toBe(c.expected);
    if (c.expectedScalePassed !== undefined) expect(detail.scalePassed).toBe(c.expectedScalePassed);
    if (c.expectedOutsideByG !== undefined) expect(detail.outsideByG).toBe(c.expectedOutsideByG);
    if (c.expectedUnknownReason !== undefined) expect(detail.unknownReason).toBe(c.expectedUnknownReason);
    // classifyCone is the same rule with the facts beside it dropped.
    expect(classifyCone({ weightG: c.weightG, inRange: c.inRange, limits, plausible: isPlausibleWeight(c.weightG, fixture.plausibility) })).toBe(c.expected);
  });
});

describe('classifyCone — the order of the checks', () => {
  const limits: ConeLimits = { setpointG: 1960, minusG: 30, plusG: 30 };

  it('implausible wins over everything, including a scale rejection', () => {
    expect(classifyCone({ weightG: 100, inRange: false, limits, plausible: false })).toBe('unknown');
    expect(classifyConeDetail({ weightG: 100, inRange: false, limits, plausible: false }).unknownReason).toBe('implausible');
  });

  it('the scale bit wins over the product tolerance', () => {
    // Inside the tolerance, rejected by the scale: rejected.
    expect(classifyCone({ weightG: 1960, inRange: false, limits, plausible: true })).toBe('rejected');
    // Outside the tolerance, rejected by the scale: still rejected, never low.
    expect(classifyCone({ weightG: 1800, inRange: false, limits, plausible: true })).toBe('rejected');
  });

  it('a scale pass outside the tolerance is low/high AND keeps scalePassed=true (the disagreement case)', () => {
    const d = classifyConeDetail({ weightG: 1900, inRange: true, limits, plausible: true });
    expect(d.state).toBe('low');
    expect(d.scalePassed).toBe(true);
    expect(d.outsideByG).toBe(-30);
  });

  it('without limits a plausible, scale-passed cone is unknown, not within', () => {
    const d = classifyConeDetail({ weightG: 1960, inRange: true, limits: null, plausible: true });
    expect(d.state).toBe('unknown');
    expect(d.unknownReason).toBe('no_limits');
    expect(d.outsideByG).toBeNull();
  });

  it('a rejected cone still reports how far outside the limits it was, when there were limits', () => {
    expect(classifyConeDetail({ weightG: 1900, inRange: false, limits, plausible: true }).outsideByG).toBe(-30);
    expect(classifyConeDetail({ weightG: 1900, inRange: false, limits: null, plausible: true }).outsideByG).toBeNull();
  });

  it('offset signs are ignored — PDAS stores the minus offset as a magnitude', () => {
    expect(limitBounds({ setpointG: 1960, minusG: -30, plusG: 30 })).toEqual({ loG: 1930, hiG: 1990 });
    expect(limitBounds({ setpointG: 1960, minusG: 30, plusG: 30 })).toEqual({ loG: 1930, hiG: 1990 });
  });

  it('isPlausibleWeight is inclusive at both ends and false for nothing', () => {
    const w = { loG: 1500, hiG: 2100 };
    expect(isPlausibleWeight(1500, w)).toBe(true);
    expect(isPlausibleWeight(2100, w)).toBe(true);
    expect(isPlausibleWeight(1499.99, w)).toBe(false);
    expect(isPlausibleWeight(2100.01, w)).toBe(false);
    expect(isPlausibleWeight(null, w)).toBe(false);
    expect(isPlausibleWeight(Number.NaN, w)).toBe(false);
  });
});
