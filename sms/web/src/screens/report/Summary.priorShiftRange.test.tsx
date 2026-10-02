/**
 * C-167 (D-102, 2 Oct 2026): a shift-bounded summary compares against a SHIFT
 * range, but the caption printed the prior period as two calendar dates. When
 * the server sends `prior.fromShift`/`prior.toShift` the caption now names the
 * shifts, in the period control's own words (`describePeriod`).
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { SummarySection } from './Summary';
import type { ManagementSummaryData } from '../../api';

const COVERAGE = { daysInPeriod: 2, daysWithData: 2, firstDay: '2026-09-01', lastDay: '2026-09-02' };

function fixture(prior: Record<string, string>): ManagementSummaryData {
  return {
    period: { period: 'custom', from: '2026-09-01', to: '2026-09-02', days: 2 },
    prior,
    coverage: { current: COVERAGE, prior: COVERAGE },
    kpis: [],
    productMix: { current: [], prior: [] },
    verdict: { cones: 1, sacks: 1, sackWeightKg: 1 },
    approval: 'awaiting',
    note: 'note',
  } as unknown as ManagementSummaryData;
}

const caption = (d: ManagementSummaryData): string => render(<SummarySection d={d} products={[]} />).container.textContent ?? '';

describe('the management summary caption names the prior period’s shifts', () => {
  it('a shift-bounded prior reads "31 Aug evening shift to 1 Sep morning shift"', () => {
    const text = caption(fixture({ from: '2026-08-31', to: '2026-09-01', fromShift: '2026-08-31.evening', toShift: '2026-09-01.morning' }));
    expect(text).toContain('compared with 31 Aug evening shift to 1 Sep morning shift');
  });

  it('a single-shift prior names that shift once', () => {
    const text = caption(fixture({ from: '2026-08-31', to: '2026-08-31', fromShift: '2026-08-31.night', toShift: '2026-08-31.night' }));
    expect(text).toContain('compared with 31 Aug, night shift');
    expect(text).not.toContain('night shift to');
  });

  it('a plain-day prior still names the calendar days', () => {
    const text = caption(fixture({ from: '2026-08-30', to: '2026-08-31' }));
    expect(text).toContain('compared with Sunday, 30 August 2026 to Monday, 31 August 2026');
  });
});
