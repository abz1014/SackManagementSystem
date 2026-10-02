import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import { SpsPackingSection } from './SpsPacking';
import type { SpsPackingReportData } from '../../api';

const T = W.iflReports.spsPacking;
const P = { period: 'custom', from: '2026-09-01', to: '2026-09-02' };

const d: SpsPackingReportData = {
  period: P, filters: {}, lineId: 1,
  weightBasis: 'as_recorded',
  sps: { number: 1, label: 'SPS 1 — this line’s one sack scale (PLC_sack1)', confirmed: false },
  columns: [
    { key: '30', yarnCount: '30', label: '30', materialIds: [7, 9] },
    { key: '36', yarnCount: '36', label: '36', materialIds: [21] },
    { key: 'unknown', yarnCount: null, label: 'Count not on record', materialIds: [99] },
    { key: 'none', yarnCount: null, label: 'No product on the reading', materialIds: [] },
  ],
  rows: [
    { date: '2026-09-01', shift: 'morning', cells: { '36': { sacks: 20, kg: 945.6 }, none: { sacks: 1, kg: 0 } }, total: { sacks: 21, kg: 945.6 } },
    { date: '2026-09-01', shift: 'evening', cells: { '30': { sacks: 4, kg: 188.9 }, '36': { sacks: 1234, kg: 58321.4 } }, total: { sacks: 1238, kg: 58510.3 } },
    { date: '2026-09-02', shift: 'night', cells: { unknown: { sacks: 2, kg: 94.4 } }, total: { sacks: 2, kg: 94.4 } },
  ],
  totals: [
    { key: '30', yarnCount: '30', label: '30', materialIds: [7, 9], sacks: 4, kg: 188.9, avgKg: 47.23, sharePct: 0.3 },
    { key: '36', yarnCount: '36', label: '36', materialIds: [21], sacks: 1254, kg: 59267.0, avgKg: 47.26, sharePct: 99.4 },
    { key: 'unknown', yarnCount: null, label: 'Count not on record', materialIds: [99], sacks: 2, kg: 94.4, avgKg: 47.2, sharePct: 0.2 },
    { key: 'none', yarnCount: null, label: 'No product on the reading', materialIds: [], sacks: 1, kg: 0, avgKg: null, sharePct: 0.1 },
  ],
  grandTotal: { sacks: 1261, kg: 59550.3, avgKg: 47.26 },
  implausibleSacks: 1,
  note: 'THE REPORT NOTE.',
  pendingIfl: ['ASSUME THE SPS'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

describe('SpsPackingSection', () => {
  it('prints LANDSCAPE (never portrait): the matrix has a column per yarn count', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    expect(container.querySelector('[data-report-orientation="landscape"]')).not.toBeNull();
    expect(container.querySelector('[data-report-orientation="portrait"]')).toBeNull();
  });

  it('states the one SPS block as the report labels it', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    expect(container.textContent).toContain('SPS 1 — this line’s one sack scale (PLC_sack1)');
  });

  it('a column per yarn count, in the report\'s order, the no-product bucket in the screen\'s words, last before the total', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    const heads = [...container.querySelectorAll('table')[0]!.querySelectorAll('thead th')].map((th) => th.childNodes[0]!.textContent);
    expect(heads).toEqual([T.date, T.shift, '30', '36', 'Count not on record', T.noProduct, T.total]);
  });

  it('each cell is the sacks, then the kilograms on a second line; thousands separated; a dash where the count had no sacks', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    const evening = [...container.querySelectorAll('table')[0]!.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(W.shiftName.evening))!;
    const cells = [...evening.querySelectorAll('td')];
    // date (spanning the day's two shifts) is on the morning row, so the evening row starts at the shift cell
    expect(cells[0]!.textContent).toBe(W.shiftName.evening);
    expect(cells[1]!.innerHTML).toContain('4<br>');
    expect(cells[1]!.textContent).toBe('4188.9');
    expect(cells[2]!.textContent).toBe('1,23458,321.4'); // sacks 1,234 then kg 58,321.4 (one decimal)
    expect(cells[3]!.textContent).toBe('—'); // no "count not on record" sacks that evening
    expect(cells[4]!.textContent).toBe('—');
    expect(cells[5]!.textContent).toBe('1,23858,510.3');
  });

  it('the date reads DD-MM-YYYY and spans the shifts of its day, once', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    const text = container.textContent ?? '';
    expect(text).toContain('01-09-2026');
    expect(text).toContain('02-09-2026');
    expect(text).not.toContain('2026-09-01');
    const spans = [...container.querySelectorAll('table')[0]!.querySelectorAll('td[rowspan]')].map((c) => [c.textContent, c.getAttribute('rowspan')]);
    expect(spans).toEqual([['01-09-2026', '2'], ['02-09-2026', '1']]);
  });

  it('the matrix closes with a total row: the period per count, and the whole', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    const total = container.querySelectorAll('table')[0]!.querySelector('tr.total')!;
    const cells = [...total.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells[0]).toBe(T.total);
    expect(cells[1]).toBe('4188.9'); // count 30
    expect(cells[2]).toBe('1,25459,267.0'); // count 36: sacks then kg to one decimal
    expect(cells[cells.length - 1]).toBe('1,26159,550.3'); // grand
  });

  it('the per-count table carries material ids, sacks, kilograms, average sack and share; the average is a dash where no sack had a plausible weight', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    const table = container.querySelectorAll('table')[1]!;
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows[0]).toEqual(['30', '7, 9', '4', '188.9', '47.23', '0.3']);
    expect(rows[1]).toEqual(['36', '21', '1,254', '59,267.0', '47.26', '99.4']);
    expect(rows[2]).toEqual(['Count not on record', '99', '2', '94.4', '47.20', '0.2']);
    expect(rows[3]).toEqual([T.noProduct, '—', '1', '0.0', '—', '0.1']);
    const total = table.querySelector('tr.total')!;
    expect([...total.querySelectorAll('td')].map((td) => td.textContent)).toEqual([T.total, '1,261', '59,550.3', '47.26', '100.0']);
  });

  it('says where a count comes from (today\'s product master) and how many implausible sacks the averages left out', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    expect(container.textContent).toContain(T.mappingNote);
    expect(container.textContent).toContain(T.implausibleNote('1'));
    const none = render(<SpsPackingSection d={{ ...d, implausibleSacks: 0 }} />);
    expect(none.container.textContent).not.toContain('left out of the averages');
  });

  it('carries the report note and the assumptions block', () => {
    const { container } = render(<SpsPackingSection d={d} />);
    expect(container.textContent).toContain('THE REPORT NOTE.');
    expect(container.textContent).toContain(W.iflReports.pendingHeading);
    expect(container.textContent).toContain('ASSUME THE SPS');
  });

  it('an empty period shows the empty state with its note and assumptions, never a matrix of dashes', () => {
    const empty: SpsPackingReportData = { ...d, columns: [], rows: [], totals: [], grandTotal: { sacks: 0, kg: 0, avgKg: null }, implausibleSacks: 0 };
    const { container } = render(<SpsPackingSection d={empty} />);
    expect(container.textContent).toContain(T.empty);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[data-report-orientation="landscape"]')).not.toBeNull();
    expect(container.textContent).toContain('THE REPORT NOTE.');
    expect(container.textContent).toContain('ASSUME THE SPS');
  });

  it('a payload that omits fields does not crash: lists default to empty', () => {
    const holed = { period: P, filters: {}, lineId: 1, note: 'N', pendingIfl: [], generationNote: d.generationNote } as unknown as SpsPackingReportData;
    const { container } = render(<SpsPackingSection d={holed} />);
    expect(container.textContent).toContain(T.empty);
  });

  it('a row without a cells map, and a count without material ids, do not crash', () => {
    const holed = {
      ...d,
      rows: [{ date: '2026-09-01', shift: 'morning', total: { sacks: 3, kg: 141.6 } }],
      totals: [{ key: '36', yarnCount: '36', label: '36', sacks: 3, kg: 141.6, avgKg: 47.2, sharePct: 100 }],
    } as unknown as SpsPackingReportData;
    const { container } = render(<SpsPackingSection d={holed} />);
    expect(container.textContent).toContain('141.6');
  });
});
