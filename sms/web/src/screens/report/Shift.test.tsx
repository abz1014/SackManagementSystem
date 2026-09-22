/**
 * UX chart-primitives pass (22 Sep 2026): the Shift report printed 4 figures
 * per shift plus a `LineTable` of `byDay`, with no graphical mark anywhere.
 * `shift.ts` already ships `shifts[].byDay: ReportLine[]` — exactly the shape
 * `shared.tsx`'s pre-existing `DayBars` accepts — so this adds one `DayBars`
 * above each shift's table, caption `W.report.conesPerDayFor(shift)`. Nothing
 * is removed: `LineTable` stays the keyboard/screen-reader route and the
 * per-day detail table.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { ShiftSection } from './Shift';
import type { ShiftReportData, ShiftSection as ShiftSectionData, ReportLine, StateCounts } from '../../api';

const STATES: StateCounts = { within: 90, low: 3, high: 3, rejected: 2, unknown: 2 };

function day(n: number, cones: number): ReportLine {
  return {
    group: `2026-09-0${n}`,
    cones,
    rejectedCones: 5,
    rejectRatePct: 2,
    conesInRangePct: 92,
    sacks: 10,
    sackWeightKg: 400,
    avgSackKg: 40,
    conesPerSack: cones > 0 ? Math.round(cones / 10) : null,
  };
}

function totals(cones: number): ReportLine {
  return {
    group: 'total',
    cones,
    rejectedCones: 20,
    rejectRatePct: 2,
    conesInRangePct: 92,
    sacks: 70,
    sackWeightKg: 2800,
    avgSackKg: 40,
    conesPerSack: Math.round(cones / 70),
  };
}

function shiftSection(shift: ShiftSectionData['shift'], days: number[]): ShiftSectionData {
  const byDay = days.map((c, i) => day(i + 1, c));
  return {
    shift,
    coverage: { daysInPeriod: 7, daysWithData: 7, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-07', complete: true },
    totals: totals(days.reduce((s, v) => s + v, 0)),
    byDay,
    readings: { states: STATES, implausible: 1 },
  };
}

function fixture(): ShiftReportData {
  const days = [500, 480, 510, 490, 505, 470, 520];
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    shift: null,
    shifts: [
      shiftSection('morning', days),
      shiftSection('evening', days.map((d) => d - 20)),
      shiftSection('night', days.map((d) => d - 40)),
    ],
    shiftCheck: { compared: 1000, mismatched: 10, mismatchPct: 1, topHour: 6 },
    timeLostNote: 'note',
  };
}

describe('ShiftSection', () => {
  it('renders exactly 3 charts, one per shift, each an accessible svg.chart with a non-empty aria-label', () => {
    const d = fixture();
    const { container } = render(<ShiftSection d={d} />);
    const svgs = container.querySelectorAll('svg.chart');
    expect(svgs.length).toBe(3);
    svgs.forEach((svg) => {
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('each shift’s chart draws one rect per non-total byDay row', () => {
    const d = fixture();
    const { container } = render(<ShiftSection d={d} />);
    const svgs = Array.from(container.querySelectorAll('svg.chart'));
    d.shifts.forEach((s, i) => {
      const rects = svgs[i]!.querySelectorAll('rect');
      const nonTotal = s.byDay.filter((r) => r.group !== 'total').length;
      expect(rects.length).toBe(nonTotal);
    });
  });

  it('every bar carries an SVG fill attribute and none uses a CSS background style', () => {
    const { container } = render(<ShiftSection d={fixture()} />);
    const rects = container.querySelectorAll('svg.chart rect');
    expect(rects.length).toBeGreaterThan(0);
    rects.forEach((r) => {
      expect(r.getAttribute('fill')).toBeTruthy();
      expect((r as unknown as HTMLElement).style.background).toBe('');
    });
  });

  it('the per-day table is still present alongside the chart, one table per shift', () => {
    const { container } = render(<ShiftSection d={fixture()} />);
    const tables = container.querySelectorAll('table');
    expect(tables.length).toBe(3);
  });

  it('an empty period renders Nothing to show, no chart', () => {
    const d = fixture();
    d.shifts = d.shifts.map((s) => ({ ...s, totals: { ...s.totals, cones: 0 } }));
    const { container } = render(<ShiftSection d={d} />);
    expect(container.querySelectorAll('svg.chart').length).toBe(0);
  });
});
