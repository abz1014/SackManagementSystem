/**
 * IFL reports, task H-exports (1 Oct 2026): the printed closing notes.
 *
 * Two defects in the block every printed report ends with:
 *   - it printed the approval status TWICE, once as "Figures follow
 *     KPI-DEFINITIONS.md, awaiting IFL's approval." and once as "Figure
 *     definitions are awaiting IFL's approval." - the same fact, and the first
 *     cites a file of the repository that nobody holding a printed page can open;
 *   - the report's own notes and every "Assumed until IFL confirms" line have
 *     to reach the paper from the one list the server composes
 *     (`header.reportNotes`), the same list the CSV and the workbook carry.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import { REPORT_TYPES, type ReportHeader, type ReportResponse, type ReportType } from '../../api';
import { PrintNotes, printedInBody } from './PrintDoc';

const header = (type: ReportType, over: Partial<ReportHeader> = {}): ReportHeader =>
  ({
    reportType: type, title: 't', lineName: 'L', plantName: 'TP1', unitName: 'Unit 2',
    period: { period: 'pick', from: '2026-09-10', to: '2026-09-10', days: 1 }, filters: {},
    generatedAtPlantUtc: '2026-09-21T09:15:00Z', generatedBy: 'x', smsVersion: '1', definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting', spansGenerations: false, sourceGeneration: null, otherGenerationExcluded: null,
    ...over,
  }) as unknown as ReportHeader;

const footnotes = (type: ReportType, h: ReportHeader, report: unknown = {}): string[] => {
  const data = { header: h, report } as unknown as ReportResponse<ReportType>;
  return [...render(<PrintNotes type={type} data={data} header={h} />).container.querySelectorAll('ol.pd-footnotes li')].map((l) => l.textContent ?? '');
};

describe('PrintNotes: the approval status is stated once, in the reader\'s words', () => {
  it.each(REPORT_TYPES)('%s: exactly one line says the figures await IFL\'s approval, and it is the definitions note', (type) => {
    const l = footnotes(type, header(type));
    expect(l.filter((t) => /awaiting IFL.s approval/.test(t))).toEqual([W.reports.definitionsNote]);
  });

  it.each(REPORT_TYPES)('%s: no footnote names an internal file', (type) => {
    const l = footnotes(type, header(type), { pendingIfl: ['An assumption.'] });
    for (const t of l) expect(t).not.toMatch(/KPI-DEFINITIONS|\.md\b/);
  });
});

describe('PrintNotes: the server\'s notes reach the paper, once, in order', () => {
  const notes = ['The report\'s own method note.', 'A caveat computed from this period.', `${W.iflReports.pendingHeading}: Assumption one.`, `${W.iflReports.pendingHeading}: Assumption two.`];

  it('prints header.reportNotes in the order the server composed them, before the standing notes', () => {
    const l = footnotes('rejected-cones', header('rejected-cones', { reportNotes: notes }), { pendingIfl: ['Assumption one.', 'Assumption two.'] });
    const at = notes.map((n) => l.indexOf(n));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(at[3]).toBeLessThan(l.indexOf(W.printDoc.clockNote));
  });

  it('an assumption the notes already carry is not added again from pendingIfl', () => {
    const l = footnotes('rejected-cones', header('rejected-cones', { reportNotes: notes }), { pendingIfl: ['Assumption one.', 'Assumption two.'] });
    expect(l.filter((t) => t.includes('Assumption one.'))).toHaveLength(1);
    expect(l.filter((t) => t.includes('Assumption two.'))).toHaveLength(1);
  });

  it('a server that predates reportNotes still puts each pendingIfl line on the paper, under its heading', () => {
    const l = footnotes('sps-packing', header('sps-packing'), { pendingIfl: ['Assumption one.', 'Assumption two.'] });
    expect(l).toContain(`${W.iflReports.pendingHeading}: Assumption one.`);
    expect(l).toContain(`${W.iflReports.pendingHeading}: Assumption two.`);
  });

  it('a report that assumes nothing prints no assumption line, and an earlier report type is unchanged (no notes of its own)', () => {
    const none = footnotes('rejected-hangers', header('rejected-hangers', { reportNotes: [] }), { pendingIfl: [] });
    expect(none.some((t) => t.includes(W.iflReports.pendingHeading))).toBe(false);
    const daily = footnotes('daily', header('daily'));
    expect(daily).toContain(W.printDoc.clockNote);
    expect(daily).toContain(W.reports.definitionsNote);
  });
});

describe('PrintNotes: a sentence the page already prints is not printed again in the closing notes', () => {
  // The CSV and the workbook have no body, so the server puts the report's own note (and, for the CTS loop report, its three computed
  // sentences) into header.reportNotes. On paper the section prints the note beside its tables and the executive summary states the
  // scale-bit sentence, so the closing block carries only what is NOT already on the page.
  const method = 'Each cone is counted once.';
  const S = W.iflReports.shiftProduction;

  it('the report\'s method note, printed in the section body, is left out of the closing notes (but any other note stays)', () => {
    const h = header('rejected-hangers', { reportNotes: [method, 'A caveat computed from this period.', `${W.iflReports.pendingHeading}: An assumption.`] });
    const l = footnotes('rejected-hangers', h, { note: method, pendingIfl: ['An assumption.'] });
    expect(l).not.toContain(method);
    expect(l).toContain('A caveat computed from this period.');
    expect(l).toContain(`${W.iflReports.pendingHeading}: An assumption.`);
  });

  it('the CTS loop report: loop and kg-basis lines (printed beside the table) and the scale-bit line (executive summary) are not repeated', () => {
    const report = {
      note: method,
      pendingIfl: ['What IFL means by CTS loop.'],
      summary: [],
      grandTotal: { weighed: 7923, pass: 7922, weightRejects: 1, total: 7923, efficiencyPct: 99.99, weighedKg: 15000 },
      loop: { hangersSeen: 299 },
      scaleRejectedCones: 49,
      kgBasis: { basis: 'net', label: 'net of tare', implausible: 2 },
    };
    const notes = [method, S.loopLine('299', false), S.scaleRejected('49', '1'), S.kgBasis('net of tare', '2'), `${W.iflReports.pendingHeading}: What IFL means by CTS loop.`];
    const l = footnotes('shift-production', header('shift-production', { reportNotes: notes }), report);
    expect(l).not.toContain(method);
    expect(l).not.toContain(S.loopLine('299', false));
    expect(l).not.toContain(S.scaleRejected('49', '1'));
    expect(l).not.toContain(S.kgBasis('net of tare', '2'));
    expect(l).toContain(`${W.iflReports.pendingHeading}: What IFL means by CTS loop.`);
  });

  it('a note that is NOT what the body prints is kept: a different loop count on the page leaves the notes\' sentence on paper', () => {
    const l = footnotes('shift-production', header('shift-production', { reportNotes: [S.loopLine('300', false)] }), { loop: { hangersSeen: 299 } });
    expect(l).toContain(S.loopLine('300', false));
  });

  it('an earlier report type prints nothing it did not print before (no reportNotes, nothing dropped)', () => {
    const l = footnotes('daily', header('daily'), { note: 'daily method' });
    expect(l).toContain(W.printDoc.clockNote);
  });
});

describe('printedInBody', () => {
  it('names the method note of IFL\'s eight reports and nothing for the earlier ten', () => {
    const data = (note: string) => ({ header: header('daily'), report: { note } }) as unknown as ReportResponse<ReportType>;
    expect(printedInBody('rejected-cones', data('x'))).toContain('x');
    expect(printedInBody('rejected-cones', data('x'))).toContain(W.iflReports.rejectedConesList.lowerBoundNote);
    expect(printedInBody('daily', data('x'))).toEqual([]);
    expect(printedInBody('sack', data('x'))).toEqual([]);
  });
  it('never throws on a payload with the fields stripped', () => {
    for (const t of REPORT_TYPES) expect(() => printedInBody(t, { header: header(t), report: null } as unknown as ReportResponse<ReportType>)).not.toThrow();
  });
});
