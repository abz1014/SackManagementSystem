import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import { SackWeightRangeSection } from './SackWeightRange';
import type { SackBandCounts, SackSpreadRow, SackWeightBand, SackWeightRangeReportData } from '../../api';

const T = W.iflReports.sackWeightRange;
const P = { period: 'custom', from: '2026-09-01', to: '2026-09-02' };

const c = (passed: number, rejected: number, noFlag = 0): SackBandCounts => ({ passed, rejected, noFlag, total: passed + rejected + noFlag });
const none = c(0, 0);

function band(over: Partial<SackWeightBand> & Pick<SackWeightBand, 'kind' | 'label'>): SackWeightBand {
  return {
    fromKg: null, toKg: null,
    byShift: { morning: none, evening: none, night: none },
    total: none, sharePct: 0,
    ...over,
  };
}

const spread = (date: string | null, shift: SackSpreadRow['shift'], n: number, over: Partial<SackSpreadRow> = {}): SackSpreadRow => ({
  date, shift, n, minKg: 47.04, maxKg: 47.46, rangeKg: 0.42, avgKg: 47.28, sdKg: 0.073, ...over,
});

const d: SackWeightRangeReportData = {
  period: P, filters: {}, lineId: 1,
  weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 },
  bandKg: 0.1,
  passedRange: { minKg: 47, maxKg: 47.6 },
  bands: [
    band({ kind: 'below', label: 'Below 46.8 kg', toKg: 46.8, byShift: { morning: c(0, 2), evening: none, night: none }, total: c(0, 2), sharePct: 10 }),
    band({ kind: 'band', label: '47.2 - 47.3 kg', fromKg: 47.2, toKg: 47.3, byShift: { morning: c(5, 1), evening: c(3, 0), night: c(0, 0, 2) }, total: c(8, 1, 2), sharePct: 55 }),
    band({ kind: 'above', label: '47.8 kg and above', fromKg: 47.8, byShift: { morning: none, evening: c(0, 3), night: none }, total: c(0, 3), sharePct: 15 }),
    band({ kind: 'implausible', label: 'Implausible weight', byShift: { morning: none, evening: none, night: c(0, 4) }, total: c(0, 4), sharePct: 20 }),
  ],
  spreadByDayShift: [
    spread('2026-09-01', 'morning', 20),
    spread('2026-09-01', 'evening', 18, { sdKg: null, minKg: null, maxKg: null, rangeKg: null, avgKg: null }),
    spread('2026-09-02', 'night', 30),
  ],
  spreadByShift: [spread(null, 'morning', 20), spread(null, 'evening', 18), spread(null, 'night', 30)],
  spreadTotal: spread(null, null, 68, { sdKg: 0.081 }),
  implausibleSacks: 4,
  note: 'THE REPORT NOTE.',
  pendingIfl: ['ASSUME THE BAND WIDTH'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

const rowsOf = (table: Element) => [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

describe('SackWeightRangeSection', () => {
  it('prints portrait', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    expect(container.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    expect(container.querySelector('[data-report-orientation="landscape"]')).toBeNull();
  });

  it('states the weight range the scale passed as a recorded fact, and the band width; no target or tolerance is claimed', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    const text = container.textContent ?? '';
    expect(text).toContain(T.passedRangeLine('47.00', '47.60'));
    expect(text).toContain(T.bandWidthNote('0.1'));
    // no target column, no "good" band: IFL holds no sack target or tolerance
    expect(container.querySelectorAll('table')[0]!.textContent).not.toMatch(/target|tolerance|good|within/i);
  });

  it('when the scale passed nothing it says the bands are built around the plausible weights', () => {
    const { container } = render(<SackWeightRangeSection d={{ ...d, passedRange: null }} />);
    expect(container.textContent).toContain(T.noPassed);
    expect(container.textContent).not.toContain('The scale passed sacks from');
  });

  it('table A: a two-row header (the three shifts, each passed / rejected), then the totals and the share; rows in the order given', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    const table = container.querySelectorAll('table')[0]!;
    const headRows = [...table.querySelectorAll('thead tr')].map((tr) => [...tr.querySelectorAll('th')].map((th) => th.textContent));
    expect(headRows[0]).toEqual([T.band, W.shiftName.morning, W.shiftName.evening, W.shiftName.night, T.passed, T.rejected, T.total, T.share]);
    expect(headRows[1]).toEqual([T.passed, T.rejected, T.passed, T.rejected, T.passed, T.rejected]);
    const rows = rowsOf(table);
    expect(rows.map((r) => r[0])).toEqual(['Below 46.8 kg', '47.2 - 47.3 kg', '47.8 kg and above', T.implausibleRow, T.total]);
    // 47.2 - 47.3: morning 5/1, evening 3/0, night 0/0, then 8 passed, 1 rejected, total 11 (two sacks had no verdict), share 55.0
    expect(rows[1]).toEqual(['47.2 - 47.3 kg', '5', '1', '3', '0', '0', '0', '8', '1', '11', '55.0']);
  });

  it('every row is as wide as the header: 11 cells (label, six shift cells, passed, rejected, total, share)', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    for (const r of rowsOf(container.querySelectorAll('table')[0]!)) expect(r).toHaveLength(11);
  });

  it('the implausible row reads in the screen\'s own words, not the server\'s label', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    expect(container.textContent).toContain(T.implausibleRow);
    expect(container.textContent).not.toMatch(/Implausible weight(?! \()/);
  });

  it('closes table A with the totals of every row: per shift, the scale\'s verdicts, all sacks and 100.0 %', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    const total = container.querySelectorAll('table')[0]!.querySelector('tr.total')!;
    // morning 5/3, evening 3/3, night 0/4 ; passed 8, rejected 10, total 20
    expect([...total.querySelectorAll('td')].map((td) => td.textContent)).toEqual([T.total, '5', '3', '3', '3', '0', '4', '8', '10', '20', '100.0']);
  });

  it('says how many sacks have no scale verdict and are never counted as passes; says nothing when none', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    expect(container.textContent).toContain(W.iflReports.rejectedSacks.noFlagNote('2'));
    const clean = { ...d, bands: d.bands.map((b) => ({ ...b, total: { ...b.total, noFlag: 0 }, byShift: { morning: { ...b.byShift.morning, noFlag: 0 }, evening: { ...b.byShift.evening, noFlag: 0 }, night: { ...b.byShift.night, noFlag: 0 } } })) };
    expect(render(<SackWeightRangeSection d={clean} />).container.textContent).not.toContain('no scale verdict');
  });

  it('table B: per date and shift with the date once over its shifts (DD-MM-YYYY), then the period; figures at their stated precision; dashes where a shift had no plausible sack', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    const table = container.querySelectorAll('table')[1]!;
    const text = table.textContent ?? '';
    expect(text).toContain('01-09-2026');
    expect(text).toContain('02-09-2026');
    expect(text).not.toContain('2026-09-01');
    const spans = [...table.querySelectorAll('td[rowspan]')].map((x) => [x.textContent, x.getAttribute('rowspan')]);
    expect(spans).toEqual([['01-09-2026', '2'], ['02-09-2026', '1']]);
    const evening = [...table.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(W.shiftName.evening))!;
    expect([...evening.querySelectorAll('td')].map((td) => td.textContent)).toEqual([W.shiftName.evening, '18', '—', '—', '—', '—', '—']);
    const morning = [...table.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(W.shiftName.morning))!;
    expect([...morning.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['01-09-2026', W.shiftName.morning, '20', '47.04', '47.46', '0.42', '47.28', '0.073']);
    const total = table.querySelector('tr.total')!;
    expect([...total.querySelectorAll('td')].map((td) => td.textContent)).toEqual([T.total, '68', '47.04', '47.46', '0.42', '47.28', '0.081']);
  });

  it('the by-shift spread lists the shifts and closes with the period', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    expect(container.textContent).toContain(T.spreadByShiftTitle);
    const table = container.querySelectorAll('table')[2]!;
    expect(rowsOf(table).map((r) => r[0])).toEqual([W.shiftName.morning, W.shiftName.evening, W.shiftName.night, T.total]);
  });

  it('states how many sacks the spread left out when there are some, and the plain note when there are none', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    expect(container.textContent).toContain(W.iflReports.sackWeightSummary.excludedNote('4'));
    const none4 = render(<SackWeightRangeSection d={{ ...d, implausibleSacks: 0 }} />);
    expect(none4.container.textContent).toContain(T.spreadNote);
    expect(none4.container.textContent).not.toContain('left out of them');
  });

  it('carries the report note and the assumptions block', () => {
    const { container } = render(<SackWeightRangeSection d={d} />);
    expect(container.textContent).toContain('THE REPORT NOTE.');
    expect(container.textContent).toContain(W.iflReports.pendingHeading);
    expect(container.textContent).toContain('ASSUME THE BAND WIDTH');
  });

  it('a 0.2 kg report says so', () => {
    const { container } = render(<SackWeightRangeSection d={{ ...d, bandKg: 0.2 }} />);
    expect(container.textContent).toContain(T.bandWidthNote('0.2'));
  });

  it('an empty period shows the empty state with its note and assumptions, never a table of zeros', () => {
    const empty: SackWeightRangeReportData = {
      ...d, passedRange: null, bands: [], spreadByDayShift: [], spreadByShift: [], implausibleSacks: 0,
      spreadTotal: { date: null, shift: null, n: 0, minKg: null, maxKg: null, rangeKg: null, avgKg: null, sdKg: null },
    };
    const { container } = render(<SackWeightRangeSection d={empty} />);
    expect(container.textContent).toContain(T.empty);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('THE REPORT NOTE.');
    expect(container.textContent).toContain('ASSUME THE BAND WIDTH');
  });

  it('a payload that omits fields does not crash: lists default to empty', () => {
    const holed = { period: P, filters: {}, lineId: 1, note: 'N', pendingIfl: [], generationNote: d.generationNote } as unknown as SackWeightRangeReportData;
    const { container } = render(<SackWeightRangeSection d={holed} />);
    expect(container.textContent).toContain(T.empty);
  });

  it('a band without its per-shift counts does not crash', () => {
    const holed = { ...d, bands: [{ kind: 'band', label: '47.2 - 47.3 kg', fromKg: 47.2, toKg: 47.3, total: c(1, 0), sharePct: 100 }] } as unknown as SackWeightRangeReportData;
    const { container } = render(<SackWeightRangeSection d={holed} />);
    expect(container.textContent).toContain('47.2 - 47.3 kg');
  });
});
