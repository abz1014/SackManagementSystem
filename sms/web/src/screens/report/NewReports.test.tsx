import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { ShiftProductionSection } from './ShiftProduction';
import { RejectedConesSection } from './RejectedCones';
import { REPORT_TYPES } from '../../api';
import type { ShiftProductionReportData, RejectedConesReportData } from '../../api';

const P = { period: 'custom', from: '2026-09-01', to: '2026-09-02' };
const sp: ShiftProductionReportData = {
  period: P, filters: {}, lineId: 1,
  summary: [
    { shift: 'morning', pass: 12000, weightRejects: 30, total: 12030, efficiencyPct: 99.75 },
    { shift: 'evening', pass: 100, weightRejects: 0, total: 100, efficiencyPct: 100 },
  ],
  grandTotal: { pass: 12100, weightRejects: 30, total: 12130, efficiencyPct: 99.75 },
  rows: [
    { date: '2026-09-01', shift: 'morning', winder: 1, pass: 10, weightRejects: 1, total: 11, efficiencyPct: 90.91 },
    { date: '2026-09-01', shift: 'morning', winder: 2, pass: 5, weightRejects: 0, total: 5, efficiencyPct: null },
  ],
  shiftTotals: [{ date: '2026-09-01', shift: 'morning', pass: 15, weightRejects: 1, total: 16, efficiencyPct: 93.75 }],
  withoutWinder: { pass: 4, weightRejects: 0 },
  note: 'Quality rejects are excluded.',
};
const rc: RejectedConesReportData = {
  period: P, filters: {}, lineId: 1,
  list: [{ date: '2026-09-01', shift: 'night', winder: 3, weightG: 1234.5, producedAtUtc: '2026-09-01T02:00:00Z' }],
  total: 1,
  weightRange: {
    line: { minG: 1000, maxG: 2000, avgG: 1500.256, n: 5000 },
    byWinder: [{ winder: 3, minG: 1000, maxG: 2000, avgG: 1500, n: 300 }],
    plausibility: { loG: 500, hiG: 3000 },
    excludedImplausible: 7,
  },
  note: 'Weight rejects only.',
};

describe('ShiftProductionSection', () => {
  it('renders totals, efficiency format, DD-MM-YYYY and portrait root', () => {
    const { container } = render(<ShiftProductionSection d={sp} />);
    expect(container.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('12,000');
    expect(text).toContain('99.75');
    expect(text).toContain('100.00');
    expect(text).toContain('90.91');
    expect(text).toContain('—');
    expect(text).toContain('01-09-2026');
    expect(text).not.toContain('2026-09-01');
    expect(text).toContain('Quality rejects are excluded.');
    expect(text).toContain('4 pass');
    expect(container.querySelectorAll('tr.total').length).toBe(2);
    const low = [...container.querySelectorAll('td.n')].find((td) => td.textContent === '90.91') as HTMLElement;
    expect(low.style.fontWeight).toBe('700');
    const full = [...container.querySelectorAll('td.n')].find((td) => td.textContent === '100.00') as HTMLElement;
    expect(full.style.fontWeight).toBe('');
  });
  it('empty state', () => {
    const empty = { ...sp, rows: [], summary: [], shiftTotals: [], grandTotal: { pass: 0, weightRejects: 0, total: 0, efficiencyPct: null } };
    const { container } = render(<ShiftProductionSection d={empty} />);
    expect(container.textContent).toContain('Nothing recorded');
  });
});

describe('RejectedConesSection', () => {
  it('renders list, total, range and excluded note', () => {
    const { container } = render(<RejectedConesSection d={rc} />);
    expect(container.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('01-09-2026');
    expect(text).toContain('1,234.50');
    expect(text).toContain('Total rejected cones');
    expect(text).toContain('1,500.26');
    expect(text).toContain('7 readings outside 500–3,000 g');
  });
  it('omits the excluded note at zero', () => {
    const d = { ...rc, weightRange: { ...rc.weightRange, excludedImplausible: 0 } };
    const { container } = render(<RejectedConesSection d={d} />);
    expect(container.textContent).not.toContain('excluded');
  });
});

describe('report type chips', () => {
  it('includes both new types', () => {
    expect(REPORT_TYPES).toContain('shift-production');
    expect(REPORT_TYPES).toContain('rejected-cones');
  });
});
