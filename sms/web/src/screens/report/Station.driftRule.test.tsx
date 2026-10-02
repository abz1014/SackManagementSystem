/**
 * C-128 (D-77): on a station report whose period is shorter than the drift
 * rule's minimum run, "Flagged: no" is a guaranteed result, not a finding.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { StationSection } from './Station';
import type { StationReportData } from '../../api';

function fixture(from: string, to: string): StationReportData {
  return {
    period: { period: 'custom', from, to },
    lineMeanG: 1950, targetG: 1960, productLabel: 'Blend A', thresholdG: 9, minDaysHeld: 3, lineRejectRatePct: 2.1,
    rows: [{
      station: 1, cones: 100, weighedPlausible: 100, meanG: 1951, vsLineG: 1, vsTargetG: -9, daysHeld: 2, flagged: false,
      rejectedAtInspection: 2, rejectRatePct: 2, conesInRangePct: 90, lastAdjustedUtc: null,
      states: { within: 8, low: 1, high: 1, rejected: 0, unknown: 0 },
    }],
    note: 'note',
  } as unknown as StationReportData;
}

describe('StationSection — drift rule state', () => {
  it('a 2-day period shows the rule cannot fire, not "no"', () => {
    const { container } = render(<StationSection d={fixture('2026-08-19', '2026-08-20')} names={[]} onOpen={() => {}} />);
    const cell = container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[7]!;
    expect(cell.textContent).not.toMatch(/^no$/i);
    expect(cell.textContent).toMatch(/cannot fire/i);
  });
  it('a 7-day period keeps the ordinary flagged column', () => {
    const { container } = render(<StationSection d={fixture('2026-09-01', '2026-09-07')} names={[]} onOpen={() => {}} />);
    const cell = container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[7]!;
    expect(cell.textContent).not.toMatch(/cannot fire/i);
  });
});
