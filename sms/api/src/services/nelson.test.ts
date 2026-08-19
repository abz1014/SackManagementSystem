import { describe, it, expect } from 'vitest';
import { nelsonViolations, type NelsonPoint } from './nelson.js';

const pt = (value: number, se = 1): NelsonPoint => ({ value, se });
/** All points at the centerline (0), i.e. no violation background noise. */
const flat = (count: number): NelsonPoint[] => Array.from({ length: count }, () => pt(0));

describe('nelsonViolations — rule 1 (beyond 3σ)', () => {
  it('flags a point past 3 sigma', () => {
    const points = [...flat(3), pt(3.5)];
    const v = nelsonViolations(points, 0);
    expect(v[3]).toContain(1);
  });
  it('does not flag a point at exactly 3 sigma or under', () => {
    const points = [...flat(3), pt(3), pt(2.9)];
    const v = nelsonViolations(points, 0);
    expect(v[3]).not.toContain(1);
    expect(v[4]).not.toContain(1);
  });
});

describe('nelsonViolations — rule 2 (9 in a row, one side)', () => {
  it('flags the 9th point when all 9 are on the same side', () => {
    const points = Array.from({ length: 9 }, () => pt(0.2)); // all above centerline 0
    const v = nelsonViolations(points, 0);
    expect(v[8]).toContain(2);
    expect(v[7]).not.toContain(2); // only 8 so far
  });
  it('does not flag when one point sits exactly on the centerline', () => {
    const points = [...Array.from({ length: 4 }, () => pt(0.2)), pt(0), ...Array.from({ length: 4 }, () => pt(0.2))];
    const v = nelsonViolations(points, 0);
    expect(v[8]).not.toContain(2);
  });
  it('does not flag when the streak switches sides', () => {
    const points = [...Array.from({ length: 5 }, () => pt(0.2)), ...Array.from({ length: 4 }, () => pt(-0.2))];
    const v = nelsonViolations(points, 0);
    expect(v[8]).not.toContain(2);
  });
});

describe('nelsonViolations — rule 3 (6 in a row trending)', () => {
  it('flags 6 strictly increasing values', () => {
    const points = [0, 1, 2, 3, 4, 5].map((v) => pt(v));
    const v = nelsonViolations(points, 0);
    expect(v[5]).toContain(3);
  });
  it('flags 6 strictly decreasing values', () => {
    const points = [5, 4, 3, 2, 1, 0].map((v) => pt(v));
    const v = nelsonViolations(points, 0);
    expect(v[5]).toContain(3);
  });
  it('does not flag when a repeated value breaks the run', () => {
    const points = [0, 1, 2, 2, 3, 4].map((v) => pt(v));
    const v = nelsonViolations(points, 0);
    expect(v[5]).not.toContain(3);
  });
  it('does not flag a run that goes up then down', () => {
    const points = [0, 1, 2, 3, 2, 1].map((v) => pt(v));
    const v = nelsonViolations(points, 0);
    expect(v[5]).not.toContain(3);
  });
});

describe('nelsonViolations — rule 4 (14 in a row alternating)', () => {
  it('flags a perfect zigzag of 14', () => {
    const points = Array.from({ length: 14 }, (_, i) => pt(i % 2 === 0 ? 1 : -1));
    const v = nelsonViolations(points, 0);
    expect(v[13]).toContain(4);
  });
  it('does not flag when two consecutive moves go the same direction', () => {
    const values = [1, -1, 1, -1, 1, 1, -1, 1, -1, 1, -1, 1, -1, 1]; // one repeat at index 4->5
    const points = values.map((v) => pt(v));
    const v = nelsonViolations(points, 0);
    expect(v[13]).not.toContain(4);
  });
  it('does not flag when a repeated value breaks the alternation', () => {
    const values = [1, -1, 1, -1, 1, -1, -1, 1, -1, 1, -1, 1, -1, 1];
    const points = values.map((v) => pt(v));
    const v = nelsonViolations(points, 0);
    expect(v[13]).not.toContain(4);
  });
});

describe('nelsonViolations — rule 5 (2 of 3 beyond 2σ, same side)', () => {
  it('flags when 2 of the last 3 are beyond 2σ on the same side', () => {
    const points = [pt(0.1), pt(2.5), pt(0.1), pt(2.1)];
    const v = nelsonViolations(points, 0);
    expect(v[3]).toContain(5);
  });
  it('does not flag when the 2 qualifying points are on opposite sides', () => {
    const points = [pt(0.1), pt(2.5), pt(0.1), pt(-2.1)];
    const v = nelsonViolations(points, 0);
    expect(v[3]).not.toContain(5);
  });
  it('does not flag when only 1 of 3 is beyond 2σ', () => {
    const points = [pt(0.1), pt(0.2), pt(0.1), pt(2.1)];
    const v = nelsonViolations(points, 0);
    expect(v[3]).not.toContain(5);
  });
});

describe('nelsonViolations — rule 6 (4 of 5 beyond 1σ, same side)', () => {
  it('flags when 4 of the last 5 are beyond 1σ on the same side', () => {
    const points = [pt(1.2), pt(0.1), pt(1.3), pt(1.1), pt(1.4)];
    const v = nelsonViolations(points, 0);
    expect(v[4]).toContain(6);
  });
  it('does not flag when only 3 of 5 qualify', () => {
    const points = [pt(1.2), pt(0.1), pt(0.1), pt(1.1), pt(1.4)];
    const v = nelsonViolations(points, 0);
    expect(v[4]).not.toContain(6);
  });
});

describe('nelsonViolations — rule 7 (15 in a row within 1σ)', () => {
  it('flags 15 points that all hug the centerline', () => {
    const points = Array.from({ length: 15 }, (_, i) => pt(i % 2 === 0 ? 0.3 : -0.3));
    const v = nelsonViolations(points, 0);
    expect(v[14]).toContain(7);
  });
  it('does not flag when one point in the run is beyond 1σ', () => {
    const points = Array.from({ length: 14 }, () => pt(0.3));
    points.push(pt(1.5));
    const v = nelsonViolations(points, 0);
    expect(v[14]).not.toContain(7);
  });
});

describe('nelsonViolations — rule 8 (8 in a row beyond 1σ, both sides)', () => {
  it('flags 8 points all beyond 1σ with both sides represented', () => {
    const points = [pt(1.5), pt(-1.5), pt(1.5), pt(-1.5), pt(1.5), pt(-1.5), pt(1.5), pt(-1.5)];
    const v = nelsonViolations(points, 0);
    expect(v[7]).toContain(8);
  });
  it('does not flag when all 8 are on the same side (that is rule 2/6 territory, not 8)', () => {
    const points = Array.from({ length: 8 }, () => pt(1.5));
    const v = nelsonViolations(points, 0);
    expect(v[7]).not.toContain(8);
  });
  it('does not flag when one point falls inside zone C', () => {
    const points = [pt(1.5), pt(-1.5), pt(1.5), pt(-1.5), pt(0.2), pt(-1.5), pt(1.5), pt(-1.5)];
    const v = nelsonViolations(points, 0);
    expect(v[7]).not.toContain(8);
  });
});

describe('nelsonViolations — degenerate inputs', () => {
  it('handles an empty series', () => {
    expect(nelsonViolations([], 0)).toEqual([]);
  });
  it('handles se = 0 without throwing or flagging distance-based rules', () => {
    const points = [pt(5, 0), pt(-5, 0), pt(5, 0)];
    const v = nelsonViolations(points, 0);
    expect(v[0]).not.toContain(1);
  });
  it('a series with real variation and no pattern has no violations', () => {
    // A small alternating bounce that never sustains a side, a trend, or a
    // zone streak — the actual "nothing to see here" case, unlike an
    // identical-value run (which is rule 7's own textbook example, tested above).
    const values = [0.4, -0.4, 0.3, -0.3, 0.5, -0.2, 0.2, -0.5, 0.3, -0.4, 0.4, -0.3];
    const points = values.map((v) => pt(v));
    const v = nelsonViolations(points, 0);
    expect(v.every((x) => x.length === 0)).toBe(true);
  });
});
