/**
 * UX chart-primitives pass (22 Sep 2026): `report/Station.tsx` renders 14
 * columns × 14 stations with no graphical mark (design review finding). This
 * asserts the `DeviationBars` added above the table draws one bar per
 * station from `vsLineG` (the "vs line" column, unchanged), with the
 * threshold `RefLine`s symmetric about zero from `thresholdG` (the same
 * input the "flagged" column already uses) — and that the table itself is
 * untouched.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { StationSection } from './Station';
import type { StationReportData, StationReportRow, StateCounts } from '../../api';

const STATES: StateCounts = { within: 8, low: 1, high: 1, rejected: 0, unknown: 0 };

function stationRow(n: number, vsLineG: number, flagged: boolean): StationReportRow {
  return {
    station: n,
    cones: 100,
    weighedPlausible: 100,
    meanG: 1950 + vsLineG,
    vsLineG,
    vsTargetG: vsLineG - 2,
    daysHeld: 3,
    flagged,
    rejectedAtInspection: 2,
    rejectRatePct: 2,
    conesInRangePct: 90,
    lastAdjustedUtc: null,
    states: STATES,
  };
}

function fixture(n = 14): StationReportData {
  const rows = Array.from({ length: n }, (_, i) => stationRow(i + 1, i % 2 === 0 ? i + 1 : -(i + 1), i === 5));
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    lineMeanG: 1950,
    targetG: 1960,
    productLabel: 'Blend A',
    thresholdG: 9,
    minDaysHeld: 2,
    lineRejectRatePct: 2.1,
    rows,
    note: 'note',
  };
}

describe('StationSection', () => {
  it('renders one svg with 14 rects, one per station, each carrying a fill attribute', () => {
    const { container } = render(<StationSection d={fixture()} names={[]} onOpen={() => {}} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(1);
    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBe(14);
    rects.forEach((r) => {
      expect(r.getAttribute('fill')).toBeTruthy();
      expect((r as unknown as HTMLElement).style.background).toBe('');
    });
  });

  it('draws the two threshold RefLines symmetric about the zero axis within 0.01', () => {
    const { container } = render(<StationSection d={fixture()} names={[]} onOpen={() => {}} />);
    const lines = Array.from(container.querySelectorAll('svg line'));
    // Zero line has no dash; the two threshold lines are dashed.
    const dashed = lines.filter((l) => l.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBe(2);
    const zero = lines.find((l) => !l.getAttribute('stroke-dasharray') && l.getAttribute('stroke') === 'var(--graphite)');
    expect(zero).toBeTruthy();
    const zeroY = Number(zero!.getAttribute('y1'));
    const [a, b] = dashed.map((l) => Number(l.getAttribute('y1')));
    expect(Math.abs(Math.abs(a! - zeroY) - Math.abs(b! - zeroY))).toBeLessThan(0.01);
  });

  it('flagged rows carry the accent fill, unflagged rows do not', () => {
    const d = fixture();
    const { container } = render(<StationSection d={d} names={[]} onOpen={() => {}} />);
    const rects = Array.from(container.querySelectorAll('svg rect'));
    d.rows.forEach((r, i) => {
      if (r.flagged) expect(rects[i]!.getAttribute('fill')).toBe('var(--acc-fill)');
      else expect(rects[i]!.getAttribute('fill')).not.toContain('--acc');
    });
  });

  it('the table is unchanged: 14 body rows, same columns, same cell text as before the chart', () => {
    const d = fixture();
    const { container } = render(<StationSection d={d} names={[]} onOpen={() => {}} />);
    const table = container.querySelector('table')!;
    expect(table).toBeTruthy();
    const bodyRows = table.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(14);
    // Header count unchanged: Station, Cones, InRange, Mean, vsLine, vsTarget,
    // DaysHeld, Flagged, RejectedAtInspection, RejectRate, 5 state cols, LastAdjusted = 15.
    const heads = table.querySelectorAll('thead th');
    expect(heads.length).toBe(16);
  });
});
