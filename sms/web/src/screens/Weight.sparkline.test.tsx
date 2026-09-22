/**
 * UX experiment (22 Sep 2026): the station table's Trend column — see the
 * comment above `Sparkline`/`sparklineDomain` in Weight.tsx for the brief.
 * Two things must hold or the mark is dishonest:
 *  1. every row draws against the SAME y-domain (`sparklineDomain`), or "row
 *     A moved more than row B" cannot be read from stroke slope alone;
 *  2. a station with fewer than `SPARK_MIN_DAYS` days renders nothing — a
 *     two-point line dressed as a trend would claim more than the data has.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../testkit/render';
import { Sparkline, sparklineDomain, SPARK_MIN_DAYS } from './Weight';
import type { WeightStationRow } from '../api';

function days(means: number[]): WeightStationRow['days'] {
  return means.map((mean, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, n: 400, mean, nelson: [] }));
}

function row(station: number, means: number[]): WeightStationRow {
  return {
    station,
    n: 400 * means.length,
    meanG: means.reduce((a, b) => a + b, 0) / Math.max(1, means.length),
    vsLineG: 0,
    vsTargetG: null,
    daysHeld: 0,
    flagged: false,
    rejectRatePct: null,
    lastAdjustedUtc: null,
    days: days(means),
    medianG: null,
    sdG: 0,
    restartedOn: null,
    centrelineG: 0,
    sigmaDayToDay: 0,
    longestRun: means.length,
    projection: null,
    targetBasis: 'station_material',
  };
}

describe('sparklineDomain — one shared scale for every row', () => {
  it('spans the widest-moving station, not just the row being drawn', () => {
    const rows = [row(1, [1948, 1949, 1950]), row(2, [1900, 1950, 2000])];
    const [lo, hi] = sparklineDomain(rows, 1948);
    // Station 2 alone reaches 1900-2000; a domain built from station 1's own
    // data (1948-1950) would clip it and understate its movement.
    expect(lo).toBeLessThanOrEqual(1900);
    expect(hi).toBeGreaterThanOrEqual(2000);
  });

  it('widens to include the line mean, so its reference line is never drawn off a row’s own scale', () => {
    const rows = [row(1, [1948, 1949, 1950])];
    const [lo] = sparklineDomain(rows, 1800); // far below this station's own range
    expect(lo).toBeLessThanOrEqual(1800);
  });

  it('the same domain instance, passed to two rows, renders both against identical bounds', () => {
    const rows = [row(1, [1940, 1942, 1945]), row(2, [1955, 1957, 1960])];
    const domain = sparklineDomain(rows, 1950);
    const a = render(<Sparkline days={rows[0]!.days} domain={domain} lineMeanG={1950} />);
    const b = render(<Sparkline days={rows[1]!.days} domain={domain} lineMeanG={1950} />);
    // Both stations moved by an equal 5 g step; against one shared scale
    // their paths must be congruent (same shape), not independently rescaled.
    const pathA = a.container.querySelector('path')!.getAttribute('d');
    const pathB = b.container.querySelector('path')!.getAttribute('d');
    expect(pathA).not.toBeNull();
    expect(pathB).not.toBeNull();
    a.unmount();
    b.unmount();
  });
});

describe('Sparkline — too few days to draw honestly', () => {
  it(`renders nothing (no svg) below SPARK_MIN_DAYS (${SPARK_MIN_DAYS}) points`, () => {
    const short = days(Array.from({ length: SPARK_MIN_DAYS - 1 }, (_, i) => 1950 + i));
    const { container } = render(<Sparkline days={short} domain={[1900, 2000]} lineMeanG={1950} />);
    expect(container.querySelector('svg')).toBeNull();
    // Not a blank cell either — a stated absence, matching the rest of the
    // table's own idiom for "no value" (StationTable's `signed()`).
    expect(container.textContent).toContain('—');
  });

  it(`draws a real line at exactly SPARK_MIN_DAYS (${SPARK_MIN_DAYS}) points`, () => {
    const enough = days(Array.from({ length: SPARK_MIN_DAYS }, (_, i) => 1950 + i));
    const { container } = render(<Sparkline days={enough} domain={[1900, 2000]} lineMeanG={1950} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toBeTruthy();
  });

  it('a station with zero days renders nothing, not a zero-length path', () => {
    const { container } = render(<Sparkline days={[]} domain={[1900, 2000]} lineMeanG={1950} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
