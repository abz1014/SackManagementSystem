/**
 * Task C-R7 (1 Oct 2026): the Rejected Cone Hangers screen. What is asserted is
 * what a reader could be misled by: the flag is worded as "stands out in this
 * period", never as a verdict; no flag appears when the server says none can
 * be raised; the "No hanger recorded" bucket is labelled, not a number; the
 * time of a reject is the plant's clock; and a list cut by the screen or by
 * the export's cap says so.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import type { RejectedHangerReject, RejectedHangerRow, RejectedHangersReportData } from '../../api';
import { HANGER_LIST_SCREEN_ROWS, RejectedHangersSection } from './RejectedHangers';

const T = W.iflReports.rejectedHangers;

const row = (hanger: number | null, cones: number, quality: number, weight: number, flag: RejectedHangerRow['flag'] = null, unmatched = 0): RejectedHangerRow => {
  const inspected = cones + unmatched;
  const total = quality + weight;
  return { hanger, cones, inspected, qualityRejects: quality, weightRejects: weight, total, ratePct: inspected ? Math.round((10000 * total) / inspected) / 100 : null, flag };
};
const reject = (over: Partial<RejectedHangerReject> = {}): RejectedHangerReject => ({
  date: '2026-09-01', shift: 'morning', producedAtUtc: '2026-09-01T07:00:09.000Z', hanger: 91, winder: 4, rejectType: 'quality', reason: 'Tube 3 · Mat 0', weightG: null, ...over,
});

const BASE: RejectedHangersReportData = {
  period: { period: 'custom', from: '2026-08-05', to: '2026-09-07' },
  filters: {},
  lineId: 1,
  hangers: [row(91, 471, 58, 0, 'stands_out', 1), row(7, 60, 4, 0, 'too_few'), row(12, 300, 4, 1), row(null, 3, 2, 0, null, 2)],
  total: row(null, 834, 68, 1, null, 3),
  flagging: { canFlag: true, reason: null, lineRatePct: 4.59, hangersJudged: 290, hangersSeen: 298, minInspected: 100, alpha: 0.05 },
  list: [
    reject(),
    reject({ producedAtUtc: '2026-09-01T15:30:00.000Z', shift: 'evening', hanger: null, winder: null, rejectType: 'weight', reason: null, weightG: 2032.5 }),
  ],
  listTotal: 2,
  listCap: 5000,
  excludedClockFault: 0,
  note: 'THE HANGER NOTE',
  pendingIfl: ['ASSUMPTION ONE'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

const text = (d: RejectedHangersReportData) => render(<RejectedHangersSection d={d} />).container;

describe('RejectedHangersSection: table A', () => {
  it('prints portrait, with every column, the total row and the note', () => {
    const c = text(BASE);
    expect(c.querySelector('[data-report-orientation="portrait"]')).not.toBeNull();
    const heads = [...c.querySelectorAll('table')[0]!.querySelectorAll('th')].map((h) => h.textContent);
    expect(heads).toEqual([T.hanger, T.cones, T.inspected, T.qualityRejects, T.weightRejects, T.total, T.ratePct, T.flag]);
    const rows = [...c.querySelectorAll('table')[0]!.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows[0]).toEqual(['91', '471', '472', '58', '0', '58', '12.29', T.standsOut]);
    expect(rows[rows.length - 1]).toEqual([W.iflReports.total, '834', '837', '68', '1', '69', '8.24', '']);
    expect(c.textContent).toContain('THE HANGER NOTE');
    expect(c.textContent).toContain(T.inspectedNote);
  });

  it('words the flag as "stands out in this period" and says it is no verdict; "too few cones to judge" for a short hanger; nothing for the rest', () => {
    const c = text(BASE);
    const rows = [...c.querySelectorAll('table')[0]!.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows.map((r) => [r[0], r[7]])).toEqual([['91', T.standsOut], ['7', T.tooFew], ['12', ''], [T.noHanger, ''], [W.iflReports.total, '']]);
    expect(T.standsOut.toLowerCase()).toContain('stands out in this period');
    expect(c.textContent).toContain('not a verdict on the hanger');
  });

  it('a flagged hanger is marked in bold as well as in words, so black-and-white print still shows it', () => {
    const c = text(BASE);
    const strong = [...c.querySelectorAll('table')[0]!.querySelectorAll('tbody strong')].map((s) => s.textContent);
    expect(strong).toEqual([T.standsOut]);
  });

  it('states the line rate and the number of hangers the flag was corrected for', () => {
    const c = text(BASE);
    expect(c.textContent).toContain('4.59%');
    expect(c.textContent).toContain('290 hangers');
  });

  it('the "No hanger recorded" bucket is named, not shown as a number, and sits last before the total', () => {
    const c = text(BASE);
    const firstCells = [...c.querySelectorAll('table')[0]!.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')!.textContent);
    expect(firstCells[firstCells.length - 2]).toBe(T.noHanger);
  });

  it('when no flag can be raised it says so with the server\'s reason and marks no row, not even "too few"', () => {
    const d: RejectedHangersReportData = {
      ...BASE,
      hangers: [row(91, 17, 1, 0), row(12, 23, 1, 0)],
      flagging: { canFlag: false, reason: 'too few cones per hanger in this period — choose a longer period', lineRatePct: 0.04, hangersJudged: 0, hangersSeen: 283, minInspected: 100, alpha: 0.05 },
    };
    const c = text(d);
    expect(c.textContent).toContain(`${T.cannotFlag}: too few cones per hanger in this period — choose a longer period`);
    expect(c.textContent).not.toContain(T.standsOut);
    expect(c.textContent).not.toContain(T.tooFew);
    expect(c.textContent).not.toContain('not a verdict on the hanger');
  });

  it('never calls a hanger bad, faulty or defective', () => {
    expect(text(BASE).textContent).not.toMatch(/\b(bad|faulty|defective|broken|worn)\b/i);
  });

  it('cones were weighed but none was rejected: says so instead of an empty table', () => {
    const d = { ...BASE, hangers: [], list: [], listTotal: 0, total: row(null, 5000, 0, 0) };
    const c = text(d);
    expect(c.textContent).toContain(T.noRejects);
    expect(c.querySelector('table')).toBeNull();
    expect(c.textContent).not.toContain(T.empty);
  });
});

describe('RejectedHangersSection: the empty state and the assumptions', () => {
  it('nothing weighed and nothing rejected is the empty state, with the note and the assumptions', () => {
    const d = { ...BASE, hangers: [], list: [], listTotal: 0, total: row(null, 0, 0, 0) };
    const c = text(d);
    expect(c.textContent).toContain(T.empty);
    expect(c.textContent).toContain('THE HANGER NOTE');
    expect(c.textContent).toContain(W.iflReports.pendingHeading);
    expect(c.textContent).toContain('ASSUMPTION ONE');
    expect(c.querySelector('table')).toBeNull();
  });

  it('lists what the report assumes until IFL confirms', () => {
    expect(text(BASE).textContent).toContain('ASSUMPTION ONE');
  });
});

describe('RejectedHangersSection: table B', () => {
  it('one row per reject: date, the plant-clock time of day, shift, hanger, winder, type, reason, weight', () => {
    const c = text(BASE);
    const rows = [...c.querySelectorAll('table')[1]!.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([
      ['01-09-2026', '7:00:09 AM', W.shiftName.morning, '91', '4', T.typeQuality, 'Tube 3 · Mat 0', '—'],
      ['01-09-2026', '3:30:00 PM', W.shiftName.evening, '—', '—', T.typeWeight, '—', '2,032.50'],
    ]);
  });

  it('shows the first 500 rows and says how many the period holds and that the export carries them all', () => {
    const many = Array.from({ length: 600 }, (_, i) => reject({ producedAtUtc: new Date(Date.UTC(2026, 8, 1, 6, 0, i)).toISOString() }));
    const c = text({ ...BASE, list: many, listTotal: 600 });
    expect(c.querySelectorAll('table')[1]!.querySelectorAll('tbody tr')).toHaveLength(HANGER_LIST_SCREEN_ROWS);
    expect(HANGER_LIST_SCREEN_ROWS).toBe(500);
    expect(c.textContent).toContain(T.showing('500', '600'));
  });

  it('a list the report itself cut at its cap says how many the screen shows and how many the export carries, with the 500-row screen cut', () => {
    const many = Array.from({ length: 600 }, (_, i) => reject({ producedAtUtc: new Date(Date.UTC(2026, 8, 1, 6, 0, i)).toISOString() }));
    const c = text({ ...BASE, list: many, listTotal: 6089, listCap: 600 });
    expect(c.querySelectorAll('table')[1]!.querySelectorAll('tbody tr')).toHaveLength(HANGER_LIST_SCREEN_ROWS);
    expect(c.textContent).toContain(T.showingCapped('500', '600', '6,089'));
    expect(c.textContent).toContain('Showing 500 of 6,089 rejects; the export carries the first 600.');
    expect(c.textContent).not.toContain(T.showing('500', '6,089'));
    expect(c.textContent).not.toContain(W.iflReports.listCapped('600', '6,089'));
  });

  it('a list that fits the screen and the export shows no cut sentence at all', () => {
    const c = text(BASE);
    expect(c.textContent).not.toContain('Showing ');
    expect(c.textContent).not.toContain('the export carries');
  });

  it('says how many zeroed-clock records were left out, once, in the plural or singular', () => {
    expect(text({ ...BASE, excludedClockFault: 2 }).textContent).toContain(W.iflReports.excludedClockFault('2', true));
    expect(text({ ...BASE, excludedClockFault: 1 }).textContent).toContain(W.iflReports.excludedClockFault('1', false));
    expect(text(BASE).textContent).not.toContain('zeroed clock');
  });
});
