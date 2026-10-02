import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import { SackWeightSummarySection } from './SackWeightSummary';
import type { SackSummaryFigures, SackWeightSummaryReportData } from '../../api';

const P = { period: 'custom', from: '2026-09-01', to: '2026-09-02' };

const fig = (sacks: number, kg: number, over: Partial<SackSummaryFigures> = {}): SackSummaryFigures => ({
  sacks, kg, avgKg: 47.28, minKg: 47.04, maxKg: 47.46, sdKg: 0.073, rejectedByScale: 4, implausible: 0, ...over,
});

const d: SackWeightSummaryReportData = {
  period: P, filters: {}, lineId: 1,
  weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 },
  rows: [
    { date: '2026-09-01', shift: 'morning', ...fig(20, 945.6) },
    { date: '2026-09-01', shift: 'evening', ...fig(18, 851.1, { sdKg: null, minKg: null, maxKg: null, avgKg: null }) },
    { date: '2026-09-02', shift: 'night', ...fig(30, 1418.4, { implausible: 2 }) },
  ],
  dayTotals: [
    { date: '2026-09-01', ...fig(38, 1796.7) },
    { date: '2026-09-02', ...fig(30, 1418.4, { implausible: 2 }) },
  ],
  shiftTotals: [
    { shift: 'morning', ...fig(20, 945.6) },
    { shift: 'evening', ...fig(18, 851.1) },
    { shift: 'night', ...fig(30, 1418.4) },
  ],
  byYarnCount: [
    { yarnCount: '36', label: '36', materialIds: [21], ...fig(50, 2364) },
    { yarnCount: null, label: 'Count not on record', materialIds: [98, 99], ...fig(17, 800) },
    { yarnCount: null, label: 'No product on the reading', materialIds: [], ...fig(1, 0, { avgKg: null, minKg: null, maxKg: null, sdKg: null }) },
  ],
  total: fig(68, 3215.1, { implausible: 2, rejectedByScale: 12 }),
  note: 'THE REPORT NOTE.',
  pendingIfl: ['ASSUME THE WINDOW'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

describe('SackWeightSummarySection', () => {
  it('prints portrait, dates as DD-MM-YYYY, the figures at their stated precision and a dash where there is none', () => {
    const { container } = render(<SackWeightSummarySection d={d} />);
    expect(container.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('01-09-2026');
    expect(text).toContain('02-09-2026');
    expect(text).not.toContain('2026-09-01');
    expect(text).toContain('945.6'); // kg to one decimal
    expect(text).toContain('1,418.4');
    expect(text).toContain('47.28'); // average to two
    expect(text).toContain('0.073'); // SD to three
    const evening = [...container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(W.shiftName.evening) && tr.textContent?.includes('851.1'))!;
    // avg, min, max, SD of a shift with no plausible sack: four dashes
    expect(evening.textContent!.match(/—/g)).toHaveLength(4);
  });

  it('puts a day total under each date, and the period total closes each of the three tables', () => {
    const { container } = render(<SackWeightSummarySection d={d} />);
    const totalRows = [...container.querySelectorAll('tr.total')];
    // 2 day totals + grand total (table 1), + total (by shift) + total (by count)
    expect(totalRows).toHaveLength(5);
    expect(totalRows.filter((tr) => tr.textContent?.startsWith(W.iflReports.sackWeightSummary.dayTotal))).toHaveLength(2);
    expect(totalRows.filter((tr) => tr.textContent?.startsWith(W.iflReports.sackWeightSummary.total))).toHaveLength(3);
    const grand = totalRows.find((tr) => tr.textContent?.startsWith(W.iflReports.sackWeightSummary.total))!;
    expect(grand.textContent).toContain('3,215.1');
  });

  it('the date cell spans the shifts and the day total of its date, once', () => {
    const { container } = render(<SackWeightSummarySection d={d} />);
    const dateCells = [...container.querySelectorAll('td[rowspan]')];
    expect(dateCells.map((c) => [c.textContent, c.getAttribute('rowspan')])).toEqual([['01-09-2026', '3'], ['02-09-2026', '2']]);
  });

  it('lists the shifts and the yarn counts, naming the sacks with no product and no count as the report does', () => {
    const { container } = render(<SackWeightSummarySection d={d} />);
    const text = container.textContent ?? '';
    expect(text).toContain(W.iflReports.sackWeightSummary.byShiftTitle);
    expect(text).toContain(W.iflReports.sackWeightSummary.byCountTitle);
    expect(text).toContain('Count not on record');
    expect(text).toContain('98, 99');
    expect(text).toContain(W.iflReports.sackWeightSummary.noProduct);
    for (const s of ['morning', 'evening', 'night'] as const) expect(text).toContain(W.shiftName[s]);
  });

  it('states how many implausible sacks the statistics left out, and says nothing when there are none', () => {
    const { container } = render(<SackWeightSummarySection d={d} />);
    expect(container.textContent).toContain(W.iflReports.sackWeightSummary.excludedNote('2'));
    const none = render(<SackWeightSummarySection d={{ ...d, total: { ...d.total, implausible: 0 } }} />);
    expect(none.container.textContent).not.toContain('left out of them');
  });

  it('carries the report note and the assumptions block', () => {
    const { container } = render(<SackWeightSummarySection d={d} />);
    expect(container.textContent).toContain('THE REPORT NOTE.');
    expect(container.textContent).toContain(W.iflReports.pendingHeading);
    expect(container.textContent).toContain('ASSUME THE WINDOW');
  });

  it('an empty period shows the empty state with its note and assumptions, never a table of zeros', () => {
    const empty: SackWeightSummaryReportData = {
      ...d, rows: [], dayTotals: [], shiftTotals: [], byYarnCount: [],
      total: { sacks: 0, kg: 0, avgKg: null, minKg: null, maxKg: null, sdKg: null, rejectedByScale: 0, implausible: 0 },
    };
    const { container } = render(<SackWeightSummarySection d={empty} />);
    expect(container.textContent).toContain(W.iflReports.sackWeightSummary.empty);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('THE REPORT NOTE.');
    expect(container.textContent).toContain('ASSUME THE WINDOW');
  });

  it('a payload that omits fields does not crash: lists default to empty', () => {
    const holed = { period: P, filters: {}, lineId: 1, note: 'N', pendingIfl: [], generationNote: d.generationNote } as unknown as SackWeightSummaryReportData;
    const { container } = render(<SackWeightSummarySection d={holed} />);
    expect(container.textContent).toContain(W.iflReports.sackWeightSummary.empty);
  });

  it('a yarn-count row without material ids does not crash', () => {
    const holed = { ...d, byYarnCount: [{ yarnCount: '36', label: '36', ...fig(1, 47) }] } as unknown as SackWeightSummaryReportData;
    const { container } = render(<SackWeightSummarySection d={holed} />);
    expect(container.textContent).toContain('36');
  });
});
