/**
 * UX chart-primitives pass (22 Sep 2026): `report/Calibration.tsx` renders
 * 10 columns × 14 stations with no graphical mark (design review finding) —
 * and this report's own title is "which stations drifted", so a drift
 * report with no visual encoding did not contain its own subject. This
 * asserts the `DeviationBars` added above the table draws one bar per
 * station from `vsTargetG` (the "vs target" column, unchanged — this
 * report's subject is drift against TARGET, not against the line), with the
 * threshold `RefLine`s symmetric about zero from `thresholdG` (the same
 * input the "flagged" column already uses) — and that the table itself is
 * untouched.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { CalibrationSection } from './Calibration';
import type { CalibrationReportData, CalibrationStationRow } from '../../api';

function stationRow(n: number, vsTargetG: number, flagged: boolean): CalibrationStationRow {
  return {
    station: n,
    n: 100,
    meanG: 1950 + vsTargetG,
    vsLineG: vsTargetG - 1,
    vsTargetG,
    daysHeld: 3,
    flagged,
    daysFlagged: flagged ? 2 : 0,
    daysWithData: 7,
    lastAdjustedUtc: null,
    adjustmentsInPeriod: 0,
  };
}

function fixture(n = 14): CalibrationReportData {
  const stations = Array.from({ length: n }, (_, i) => stationRow(i + 1, i % 2 === 0 ? i + 1 : -(i + 1), i === 3));
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    filters: {},
    lineMeanG: 1950,
    targetG: 1960,
    productLabel: 'Blend A',
    thresholdG: 9,
    minDaysHeld: 2,
    stations,
    flaggedStationCount: 1,
    adjustments: [],
    note: 'note',
  };
}

function renderSection(d: CalibrationReportData) {
  installFakeFetch({ '/api/calibration/adjustments': { adjustments: [] } });
  return render(<CalibrationSection d={d} names={[]} />);
}

describe('CalibrationSection', () => {
  it('renders one svg with 14 rects, one per station, each carrying a fill attribute', () => {
    const { container } = renderSection(fixture());
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
    const { container } = renderSection(fixture());
    const lines = Array.from(container.querySelectorAll('svg line'));
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
    const { container } = renderSection(d);
    const rects = Array.from(container.querySelectorAll('svg rect'));
    d.stations.forEach((s, i) => {
      if (s.flagged) expect(rects[i]!.getAttribute('fill')).toBe('var(--acc-fill)');
      else expect(rects[i]!.getAttribute('fill')).not.toContain('--acc');
    });
  });

  it('the station table is unchanged: 14 body rows, same 10 columns as before the chart', () => {
    const d = fixture();
    const { container } = renderSection(d);
    const tables = container.querySelectorAll('table');
    const stationTable = tables[0]!;
    const bodyRows = stationTable.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(14);
    const heads = stationTable.querySelectorAll('thead th');
    expect(heads.length).toBe(10);
  });
});
