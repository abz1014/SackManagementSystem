import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { RejectedConesSection } from './RejectedCones';
import type { RejectedConeRow, RejectedConesReportData } from '../../api';

const P = { period: 'custom', from: '2026-09-01', to: '2026-09-02' };
const rc: RejectedConesReportData = {
  period: P, filters: {}, lineId: 1,
  list: [{
    date: '2026-09-01', shift: 'night', winder: 3, hanger: 178, weightG: 1234.5, producedAtUtc: '2026-09-01T02:00:00Z',
    productId: null, productLabel: null, productSource: null, limits: null, outsideByG: null, noLimitsReason: 'No product recorded at that time',
  }],
  total: 1,
  listTotal: 1,
  listCap: 5000,
  excludedClockFault: 0,
  weightRange: {
    line: { minG: 1000, maxG: 2000, avgG: 1500.256, n: 5000 },
    byWinder: [{ winder: 3, minG: 1000, maxG: 2000, avgG: 1500, n: 300 }],
    plausibility: { loG: 500, hiG: 3000 },
    excludedImplausible: 7,
  },
  note: 'Weight rejects only.',
  pendingIfl: [],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

const row = (over: Partial<RejectedConeRow> = {}): RejectedConeRow => ({
  date: '2026-08-15', shift: 'morning', winder: 6, hanger: 178, weightG: 2035, producedAtUtc: '2026-08-15T10:02:27.353Z',
  productId: 1021, productLabel: '205-IL0-SD · ORANGE · 30', productSource: 'row',
  limits: { label: '1,960 ± 50 g', targetG: 1960, loG: 1910, hiG: 2010, lowerBound: false }, outsideByG: 25, noLimitsReason: null, ...over,
});
const withRows = (list: RejectedConeRow[], more: Partial<RejectedConesReportData> = {}): RejectedConesReportData => ({
  ...rc, list, total: list.length, listTotal: list.length, ...more,
});
const cells = (tr: Element) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '');
const bodyRows = (c: HTMLElement, table = 0) => [...c.querySelectorAll('table')[table]!.querySelectorAll('tbody tr')];

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

  it('prints the time of day on the plant clock (UTC getters), the winder, the hanger and the weight', () => {
    const { container } = render(<RejectedConesSection d={withRows([row({ producedAtUtc: '2026-07-03T21:32:41.867Z', weightG: 2032, winder: 13, hanger: 240 })])} />);
    const [date, shift, time, winder, hanger, weight] = cells(bodyRows(container)[0]!);
    expect([date, shift, time, winder, hanger, weight]).toEqual(['15-08-2026', 'Morning', '9:32:41 PM', '13', '240', '2,032.00']);
  });

  it('states the product and the limits in force, and the signed distance outside them', () => {
    const { container } = render(<RejectedConesSection d={withRows([
      row(), // 25 above the upper limit
      row({ weightG: 1747, outsideByG: -163 }), // 163 below the lower limit
      row({ weightG: 1950, outsideByG: 0 }), // inside the product's limits: the scale rejected it all the same
    ])} />);
    const rows = bodyRows(container).map(cells);
    expect(rows[0]!.slice(6)).toEqual(['205-IL0-SD · ORANGE · 30', '1,960 ± 50 g', '+25.00']);
    expect(rows[1]![8]).toBe('−163.00');
    expect(rows[2]![8]).toBe('Inside the product’s limits');
  });

  it('no product recorded at that time: says so, shows no limits and no distance', () => {
    const { container } = render(<RejectedConesSection d={withRows([row({
      productId: null, productLabel: null, productSource: null, limits: null, outsideByG: null, noLimitsReason: 'No product recorded at that time',
    })])} />);
    expect(cells(bodyRows(container)[0]!).slice(6)).toEqual(['No product recorded at that time', '—', '—']);
  });

  it('a product with no limits on record names the product and says why, with no distance', () => {
    const { container } = render(<RejectedConesSection d={withRows([row({ limits: null, outsideByG: null, noLimitsReason: 'No limits on record for this product' })])} />);
    expect(cells(bodyRows(container)[0]!).slice(6)).toEqual(['205-IL0-SD · ORANGE · 30', 'No limits on record for this product', '—']);
  });

  it('limits taken from the oldest version for an older reject carry "oldest on record" and a footnote; a clean list has neither', () => {
    const lower = row({ limits: { label: '1,960 ± 50 g', targetG: 1960, loG: 1910, hiG: 2010, lowerBound: true } });
    const a = render(<RejectedConesSection d={withRows([lower])} />);
    expect(a.container.textContent).toContain('1,960 ± 50 g (oldest on record)');
    expect(a.container.textContent).toContain('the limits in force at the time may have differed');
    a.unmount();
    const b = render(<RejectedConesSection d={withRows([row()])} />);
    expect(b.container.textContent).not.toContain('oldest on record');
  });

  it('a product taken from the line-wide timeline (no MaterialId on the reading) says where it came from', () => {
    const a = render(<RejectedConesSection d={withRows([row({ productSource: 'timeline' })])} />);
    expect(a.container.textContent).toContain('Line-wide product at that time');
    a.unmount();
    const b = render(<RejectedConesSection d={withRows([row({ productSource: 'row' })])} />);
    expect(b.container.textContent).not.toContain('Line-wide product at that time');
  });

  it('a weight reject with no recorded weight prints a dash and is still a row', () => {
    const { container } = render(<RejectedConesSection d={withRows([row({ weightG: null, limits: null, outsideByG: null })])} />);
    expect(bodyRows(container)).toHaveLength(2); // the row and the total
    expect(cells(bodyRows(container)[0]!)[5]).toBe('—');
  });

  it('the total row is the real count, and a cut list states how many are shown of how many', () => {
    const d = withRows([row(), row()], { total: 7000, listTotal: 7000, listCap: 5000 });
    const { container } = render(<RejectedConesSection d={d} />);
    expect(cells(bodyRows(container).at(-1)!)[1]).toBe('7,000');
    expect(container.textContent).toContain('Showing the first 2 of 7,000.');
    const whole = render(<RejectedConesSection d={withRows([row()])} />);
    expect(whole.container.textContent).not.toContain('Showing the first');
  });

  it('states the zeroed-clock records left out of the list, singular and plural', () => {
    const one = render(<RejectedConesSection d={withRows([row()], { excludedClockFault: 1 })} />);
    expect(one.container.textContent).toContain('1 record with a zeroed clock (before 1970) cannot be placed in any period and is left out of this list.');
    one.unmount();
    const two = render(<RejectedConesSection d={withRows([row()], { excludedClockFault: 2 })} />);
    expect(two.container.textContent).toContain('2 records with a zeroed clock');
    two.unmount();
    const none = render(<RejectedConesSection d={withRows([row()])} />);
    expect(none.container.textContent).not.toContain('zeroed clock');
  });

  it('a station filter drops the "Line" row: the range is that winder\'s, not the line\'s', () => {
    const filtered = withRows([row({ winder: 7 })], {
      filters: { station: 7 },
      weightRange: { ...rc.weightRange, line: { minG: 1930, maxG: 1990, avgG: 1950, n: 12 }, byWinder: [{ winder: 7, minG: 1930, maxG: 1990, avgG: 1950, n: 12 }] },
    });
    const a = render(<RejectedConesSection d={filtered} />);
    const range = bodyRows(a.container, 1).map(cells);
    expect(range).toEqual([['7', '1,930.00', '1,990.00', '1,950.00', '12']]);
    expect(a.container.textContent).not.toMatch(/\bLine\b/);
    a.unmount();
    const whole = render(<RejectedConesSection d={rc} />);
    expect(bodyRows(whole.container, 1).map((r) => cells(r)[0])).toEqual(['3', 'Line']);
  });

  it('a filtered winder that weighed nothing still gets its own empty row, never a "Line" row', () => {
    const d = withRows([row({ winder: 9 })], {
      filters: { station: 9 },
      weightRange: { ...rc.weightRange, line: { minG: null, maxG: null, avgG: null, n: 0 }, byWinder: [] },
    });
    const { container } = render(<RejectedConesSection d={d} />);
    expect(bodyRows(container, 1).map(cells)).toEqual([['9', '—', '—', '—', '0']]);
  });

  it('prints what the report assumes until IFL confirms, and the report\'s own note', () => {
    const { container, getAllByRole } = render(<RejectedConesSection d={{ ...rc, pendingIfl: ['Only weight rejects are listed.'] }} />);
    expect(container.textContent).toContain('Assumed until IFL confirms');
    expect(getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Only weight rejects are listed.']);
    expect(container.textContent).toContain('Weight rejects only.');
  });

  it('no rejects but cones weighed: says no cone was rejected and still shows the range', () => {
    const { container } = render(<RejectedConesSection d={withRows([])} />);
    expect(container.textContent).toContain('No cone was rejected on weight in this period.');
    expect(container.textContent).toContain('1,500.26');
  });

  it('nothing at all in the period: the plain empty state, with the note', () => {
    const empty = withRows([], { weightRange: { ...rc.weightRange, line: { minG: null, maxG: null, avgG: null, n: 0 }, byWinder: [] } });
    const { container } = render(<RejectedConesSection d={empty} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('Weight rejects only.');
  });
});
