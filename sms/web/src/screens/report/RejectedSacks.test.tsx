/**
 * Rejected Sack Report, daily (IFL report 2): the section over a hand-built
 * payload in the server's frozen shape. Proven here: table A reads as a Morning /
 * Evening / Night column group per date with a day total and a period total that
 * sum the rows; the scale's verdict is the only verdict (a sack with no flag is
 * named apart, a sack is never called under- or over-weight); the weight range of
 * the sacks the scale passed is a stated fact; the list marks an implausible
 * weight and prints the plant's insert time of day; a cut list and a zeroed
 * clock are said; an empty or partial payload degrades to words, not a crash.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import { RejectedSacksSection } from './RejectedSacks';
import type { RejectedSackRow, RejectedSacksReportData } from '../../api';

const T = W.iflReports.rejectedSacks;
const P = { period: 'custom', from: '2026-09-01', to: '2026-09-02' };

const d: RejectedSacksReportData = {
  period: P, filters: {}, lineId: 1,
  weightBasis: 'as_recorded', plausibility: { loKg: 40, hiKg: 60 },
  byShift: [
    { date: '2026-09-01', shift: 'morning', sacks: 4, rejected: 2, rejectedPct: 50 },
    { date: '2026-09-01', shift: 'evening', sacks: 2, rejected: 0, rejectedPct: 0 },
    { date: '2026-09-01', shift: 'night', sacks: 1, rejected: 0, rejectedPct: 0 },
    { date: '2026-09-02', shift: 'morning', sacks: 2, rejected: 1, rejectedPct: 50 },
    { date: '2026-09-02', shift: 'night', sacks: 2, rejected: 1, rejectedPct: 50 },
  ],
  byDay: [
    { date: '2026-09-01', sacks: 7, rejected: 2, rejectedPct: 28.57 },
    { date: '2026-09-02', sacks: 4, rejected: 2, rejectedPct: 50 },
  ],
  total: { sacks: 11, rejected: 4, rejectedPct: 36.36, noFlag: 0 },
  rejectedSplit: { implausible: 2, plausible: 2 },
  passedRange: {
    byProduct: [
      { productId: 1021, productLabel: 'Product 1021', yarnCount: '30', sacks: 2, minKg: 47, maxKg: 47.6 },
      { productId: 21, productLabel: 'Product 21', yarnCount: '36', sacks: 3, minKg: 46.9, maxKg: 47.4 },
      { productId: null, productLabel: 'No product on the reading', yarnCount: null, sacks: 1, minKg: 47.1, maxKg: 47.1 },
    ],
    all: { sacks: 6, minKg: 46.9, maxKg: 47.6 },
  },
  list: [
    { date: '2026-09-01', shift: 'morning', producedAtUtc: '2026-09-01T07:10:05.000Z', sackNum: 3, productId: 21, productLabel: 'Product 21', yarnCount: '36', weightKg: 47.9, implausible: false },
    { date: '2026-09-01', shift: 'morning', producedAtUtc: '2026-09-01T07:42:00.000Z', sackNum: 4, productId: null, productLabel: null, yarnCount: null, weightKg: 0, implausible: true },
  ],
  listTotal: 4, listCap: 5000, excludedClockFault: 0,
  note: 'THE REPORT NOTE.',
  pendingIfl: ['ASSUME THE TOLERANCE'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

const rows = (c: HTMLElement, table: number) => [...c.querySelectorAll('table')[table]!.querySelectorAll('tbody tr')];
const cells = (tr: Element) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '');
const heads = (c: HTMLElement, table: number) => [...c.querySelectorAll('table')[table]!.querySelectorAll('thead tr')].map((tr) => [...tr.querySelectorAll('th')].map((th) => th.textContent ?? ''));

describe('RejectedSacksSection — table A', () => {
  it('prints portrait, with a Morning / Evening / Night column group and a day-total group over a Sacks / Rejected (%) header', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    expect(container.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    const [top, sub] = heads(container, 0);
    expect(top).toEqual([T.date, W.shiftName.morning, W.shiftName.evening, W.shiftName.night, W.iflReports.dayTotal]);
    expect(sub).toEqual(Array(4).fill([T.sacks, `${T.rejected} (%)`]).flat());
    const groups = [...container.querySelectorAll('table')[0]!.querySelectorAll('thead tr:first-child th')].map((th) => th.getAttribute('colspan'));
    expect(groups).toEqual([null, '2', '2', '2', '2']);
  });

  it('one row per date, dates as DD-MM-YYYY, the rejected count with its share to two decimals in brackets, a dash where a shift has no sacks', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    const body = rows(container, 0).map(cells);
    expect(body[0]).toEqual(['01-09-2026', '4', '2 (50.00%)', '2', '0 (0.00%)', '1', '0 (0.00%)', '7', '2 (28.57%)']);
    // 2 Sep has no evening shift in the data: two dashes in that group
    expect(body[1]).toEqual(['02-09-2026', '2', '1 (50.00%)', '—', '—', '2', '1 (50.00%)', '4', '2 (50.00%)']);
  });

  it('the period total closes the table: each shift summed over the days, then the period total', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    const total = container.querySelector('table tr.total')!;
    // morning 4+2 / 2+1, evening 2 / 0, night 1+2 / 0+1, period 11 / 4 at 36.36 %
    expect(cells(total)).toEqual([T.periodTotal, '6', '3 (50.00%)', '2', '0 (0.00%)', '3', '1 (33.33%)', '11', '4 (36.36%)']);
  });

  it('a share the server could not compute prints the count alone, never "(—%)"', () => {
    const odd: RejectedSacksReportData = { ...d, total: { ...d.total, rejectedPct: null } };
    const { container } = render(<RejectedSacksSection d={odd} />);
    const total = container.querySelector('table tr.total')!;
    expect(cells(total).slice(-2)).toEqual(['11', '4']);
  });

  it('a one-shift period gets one shift column group, not three with two empty', () => {
    const one: RejectedSacksReportData = {
      ...d,
      byShift: d.byShift.filter((r) => r.shift === 'morning'),
      byDay: [{ date: '2026-09-01', sacks: 4, rejected: 2, rejectedPct: 50 }, { date: '2026-09-02', sacks: 2, rejected: 1, rejectedPct: 50 }],
      total: { sacks: 6, rejected: 3, rejectedPct: 50, noFlag: 0 },
    };
    const { container } = render(<RejectedSacksSection d={one} />);
    expect(heads(container, 0)[0]).toEqual([T.date, W.shiftName.morning, W.iflReports.dayTotal]);
    expect(cells(rows(container, 0)[0]!)).toHaveLength(5); // date + morning (2) + day (2)
  });

  it('says how many sacks carry no scale verdict, and that they are never counted as passes; says nothing when none', () => {
    const { container } = render(<RejectedSacksSection d={{ ...d, total: { ...d.total, noFlag: 2 } }} />);
    expect(container.textContent).toContain(T.noFlagNote('2'));
    expect(container.textContent).toContain('never counted as passes');
    const none = render(<RejectedSacksSection d={d} />);
    expect(none.container.textContent).not.toContain('no scale verdict');
  });
});

describe('RejectedSacksSection — tables B and C', () => {
  it('B splits the rejected sacks into implausible (0 kg or a fault) and plausible, under the rejected total', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    expect(container.textContent).toContain(T.splitTitle);
    const b = rows(container, 1).map(cells);
    expect(b).toEqual([[T.splitRejected, '4'], [T.splitImplausible, '2'], [T.splitPlausible, '2']]);
  });

  it('C is the range of the sacks the scale passed per product, a total row, the no-product bucket named, and says it is not a tolerance', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    expect(container.textContent).toContain(T.passedTitle);
    expect(container.textContent).toContain(T.passedNote);
    expect(container.textContent).toContain('not a tolerance');
    // the count column counts PASSED sacks with a plausible weight, and is headed so (not the bare "Sacks" of table A)
    expect(heads(container, 2)).toEqual([[T.product, T.yarnCount, T.passedSacks, T.minKg, T.maxKg]]);
    const c = rows(container, 2).map(cells);
    expect(c).toEqual([
      ['Product 1021', '30', '2', '47.00', '47.60'],
      ['Product 21', '36', '3', '46.90', '47.40'],
      [T.noProduct, '—', '1', '47.10', '47.10'],
      [W.iflReports.total, '6', '46.90', '47.60'],
    ]);
  });

  it('when the scale rejected nothing: no split, no list, a plain sentence, and the passed range still shows', () => {
    const none: RejectedSacksReportData = {
      ...d,
      byShift: d.byShift.map((r) => ({ ...r, rejected: 0, rejectedPct: 0 })),
      byDay: d.byDay.map((r) => ({ ...r, rejected: 0, rejectedPct: 0 })),
      total: { sacks: 11, rejected: 0, rejectedPct: 0, noFlag: 0 },
      rejectedSplit: { implausible: 0, plausible: 0 }, list: [], listTotal: 0,
    };
    const { container } = render(<RejectedSacksSection d={none} />);
    const text = container.textContent ?? '';
    expect(text).toContain(T.noneRejected);
    expect(text).not.toContain(T.splitTitle);
    expect(text).not.toContain(T.listTitle);
    expect(text).toContain(T.passedTitle);
  });

  it('when the scale passed nothing there is no range block (never a range of nothing)', () => {
    const { container } = render(<RejectedSacksSection d={{ ...d, passedRange: { byProduct: [], all: { sacks: 0, minKg: null, maxKg: null } } }} />);
    expect(container.textContent).not.toContain(T.passedTitle);
  });
});

describe('RejectedSacksSection — table D, the list', () => {
  it('prints each rejected sack with date, shift, the plant\'s insert time of day, sack number, product, yarn count and weight', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    expect(container.textContent).toContain(T.listTitle);
    const heading = heads(container, 3)[0]!;
    expect(heading).toEqual([T.date, T.shift, T.time, T.sackNo, T.product, T.yarnCount, T.weightKg]);
    expect(T.time).toContain('insert');
    const list = rows(container, 3).map(cells);
    expect(list[0]).toEqual(['01-09-2026', W.shiftName.morning, '7:10:05 AM', '3', 'Product 21', '36', '47.90']);
  });

  it('marks a 0 kg reading implausible and a plausible one not; a sack with no product says so', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    const [plain, fault] = rows(container, 3);
    expect(plain!.textContent).not.toContain(T.implausibleMark);
    expect(fault!.textContent).toContain(T.implausibleMark);
    expect(cells(fault!).slice(3)).toEqual(['4', T.noProduct, '—', `0.00${T.implausibleMark}`]);
  });

  it('a sack with no weight at all prints a dash and the implausible mark, not 0', () => {
    const row: RejectedSackRow = { ...d.list[0]!, weightKg: null, implausible: true, sackNum: null };
    const { container } = render(<RejectedSacksSection d={{ ...d, list: [row] }} />);
    expect(cells(rows(container, 3)[0]!).slice(3)).toEqual(['—', 'Product 21', '36', `—${T.implausibleMark}`]);
  });

  it('closes with the rejected total from the report, and says when the list was cut', () => {
    const { container } = render(<RejectedSacksSection d={{ ...d, listTotal: 6000 }} />);
    const total = [...container.querySelectorAll('table')[3]!.querySelectorAll('tr.total')][0]!;
    expect(cells(total)).toEqual([T.splitRejected, '6,000']);
    expect(container.textContent).toContain(W.iflReports.listCapped('2', '6,000'));
    const whole = render(<RejectedSacksSection d={{ ...d, list: [d.list[0]!], listTotal: 1 }} />);
    expect(whole.container.textContent).not.toContain('Showing the first');
  });

  it('states the zeroed-clock records left out of the list, singular and plural', () => {
    const one = render(<RejectedSacksSection d={{ ...d, excludedClockFault: 1 }} />);
    expect(one.container.textContent).toContain(W.iflReports.excludedClockFault('1', false));
    one.unmount();
    const many = render(<RejectedSacksSection d={{ ...d, excludedClockFault: 3 }} />);
    expect(many.container.textContent).toContain(W.iflReports.excludedClockFault('3', true));
  });
});

describe('RejectedSacksSection — words, never verdicts', () => {
  it('carries the report note and the assumptions block, and never says under- or over-weight', () => {
    const { container } = render(<RejectedSacksSection d={d} />);
    const text = container.textContent ?? '';
    expect(text).toContain('THE REPORT NOTE.');
    expect(text).toContain(W.iflReports.pendingHeading);
    expect(text).toContain('ASSUME THE TOLERANCE');
    expect(text).not.toMatch(/underweight|overweight|under-weight|over-weight/i);
  });

  it('an empty period shows the empty state with its note and assumptions, never a table of zeros', () => {
    const empty: RejectedSacksReportData = {
      ...d, byShift: [], byDay: [], list: [], listTotal: 0, total: { sacks: 0, rejected: 0, rejectedPct: null, noFlag: 0 },
      rejectedSplit: { implausible: 0, plausible: 0 }, passedRange: { byProduct: [], all: { sacks: 0, minKg: null, maxKg: null } },
    };
    const { container } = render(<RejectedSacksSection d={empty} />);
    expect(container.textContent).toContain(T.empty);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('THE REPORT NOTE.');
    expect(container.textContent).toContain('ASSUME THE TOLERANCE');
  });

  it('a payload that omits fields does not crash: it degrades to the empty state', () => {
    const holed = { period: P, filters: {}, lineId: 1, note: 'N', pendingIfl: [], generationNote: d.generationNote } as unknown as RejectedSacksReportData;
    const { container } = render(<RejectedSacksSection d={holed} />);
    expect(container.textContent).toContain(T.empty);
  });

  it('a payload with the tables but without the optional blocks still renders table A', () => {
    const partial = { ...d, passedRange: undefined, rejectedSplit: undefined, list: undefined, listTotal: undefined } as unknown as RejectedSacksReportData;
    const { container } = render(<RejectedSacksSection d={partial} />);
    expect(container.textContent).toContain(T.byDayTitle);
    expect(container.textContent).toContain('01-09-2026');
  });
});
