/**
 * The scaffold shared by IFL's six new reports (1 Oct 2026): each section
 * stub renders its empty state, its note and the "Assumed until IFL
 * confirms" block; the block renders nothing when there is nothing to
 * assume; and the printed closing notes carry the header's `reportNotes`
 * and, for a server that predates them, the report's own `pendingIfl`.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import type { ReportHeader, ReportResponse, ReportType } from '../../api';
import { PendingIfl } from './PendingIfl';
import { PrintNotes } from './PrintDoc';
import { RejectedSacksSection } from './RejectedSacks';
import { SpsPackingSection } from './SpsPacking';
import { SackWeightRangeSection } from './SackWeightRange';
import { SackWeightSummarySection } from './SackWeightSummary';
import { RejectedHangersSection } from './RejectedHangers';
import { RejectedUnknownLifterSection } from './RejectedUnknownLifter';

const BASE = {
  period: { period: 'custom', from: '2026-09-01', to: '2026-09-01' }, filters: {}, lineId: 1,
  note: 'THE REPORT NOTE', pendingIfl: ['ASSUMPTION ONE', 'ASSUMPTION TWO'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

const STUBS = [
  { name: 'rejected-sacks', Section: RejectedSacksSection, empty: W.iflReports.rejectedSacks.empty, orientation: 'portrait' },
  { name: 'sps-packing', Section: SpsPackingSection, empty: W.iflReports.spsPacking.empty, orientation: 'landscape' },
  { name: 'sack-weight-range', Section: SackWeightRangeSection, empty: W.iflReports.sackWeightRange.empty, orientation: 'portrait' },
  { name: 'sack-weight-summary', Section: SackWeightSummarySection, empty: W.iflReports.sackWeightSummary.empty, orientation: 'portrait' },
  { name: 'rejected-hangers', Section: RejectedHangersSection, empty: W.iflReports.rejectedHangers.empty, orientation: 'portrait' },
  { name: 'rejected-unknown-lifter', Section: RejectedUnknownLifterSection, empty: W.iflReports.rejectedUnknownLifter.empty, orientation: 'portrait' },
] as const;

describe.each(STUBS)('$name section scaffold', ({ Section, empty, orientation }) => {
  // The six components take different `d` shapes; the scaffold reads only
  // the base fields, so one base object stands in for each.
  const S = Section as unknown as (p: { d: typeof BASE }) => JSX.Element;
  it('renders its empty state, its note and the assumptions heading with every line', () => {
    const { container } = render(<S d={BASE} />);
    const text = container.textContent ?? '';
    expect(text).toContain(empty);
    expect(text).toContain('THE REPORT NOTE');
    expect(text).toContain(W.iflReports.pendingHeading);
    expect(text).toContain('ASSUMPTION ONE');
    expect(text).toContain('ASSUMPTION TWO');
  });
  it(`prints ${orientation}: the root says so, and only portrait reports carry the portrait hook`, () => {
    const { container } = render(<S d={BASE} />);
    expect(container.querySelector(`[data-report-orientation="${orientation}"]`)).not.toBeNull();
    expect(container.querySelector('[data-report-orientation="portrait"]') !== null).toBe(orientation === 'portrait');
  });
  it('a report that assumes nothing shows no assumptions heading; a missing field does not crash', () => {
    const none = render(<S d={{ ...BASE, pendingIfl: [] }} />);
    expect(none.container.textContent).not.toContain(W.iflReports.pendingHeading);
    none.unmount();
    const missing = render(<S d={{ ...BASE, pendingIfl: undefined as unknown as string[], note: undefined as unknown as string }} />);
    expect(missing.container.textContent).toContain(empty);
  });
});

describe('PendingIfl', () => {
  it('lists each assumption once, under the shared heading, and is screen-only', () => {
    const { container, getAllByRole } = render(<PendingIfl lines={['A', 'B', 'A', '  ']} />);
    expect(getAllByRole('listitem').map((li) => li.textContent)).toEqual(['A', 'B']);
    expect(container.textContent).toContain('Assumed until IFL confirms');
    expect(container.querySelector('.no-print')).not.toBeNull();
  });
  it('renders nothing for an empty, null or undefined list', () => {
    for (const lines of [[], null, undefined]) {
      const { container, unmount } = render(<PendingIfl lines={lines} />);
      expect(container.textContent).toBe('');
      unmount();
    }
  });
});

describe('PrintNotes — the report’s own notes and assumptions reach the paper once', () => {
  const header = {
    reportType: 'sps-packing', title: 't', lineName: 'L', plantName: null, unitName: null,
    period: { period: 'pick', from: '2026-09-10', to: '2026-09-10', days: 1 }, filters: {},
    generatedAtPlantUtc: '2026-09-21T09:15:00Z', generatedBy: 'x', smsVersion: '1', definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting', spansGenerations: false, sourceGeneration: null, otherGenerationExcluded: null,
  } as unknown as ReportHeader;
  const data = (pendingIfl: string[]) => ({ header, report: { pendingIfl } }) as unknown as ReportResponse<ReportType>;
  const items = (h: ReportHeader, d: ReportResponse<ReportType>) =>
    [...render(<PrintNotes type="sps-packing" data={d} header={h} />).container.querySelectorAll('ol.pd-footnotes li')].map((l) => l.textContent);

  it('prints header.reportNotes as footnotes', () => {
    const l = items({ ...header, reportNotes: ['NOTE A', 'NOTE B'] }, data([]));
    expect(l).toContain('NOTE A');
    expect(l).toContain('NOTE B');
  });
  it('a server without reportNotes still puts every pendingIfl line on the paper, under its heading', () => {
    const l = items(header, data(['ASSUME X']));
    expect(l).toContain(`${W.iflReports.pendingHeading}: ASSUME X`);
  });
  it('does not state an assumption twice when reportNotes already carries it', () => {
    const l = items({ ...header, reportNotes: [`${W.iflReports.pendingHeading}: ASSUME X`] }, data(['ASSUME X']));
    expect(l.filter((t) => t?.includes('ASSUME X'))).toHaveLength(1);
  });
  it('a header and report with neither field print only the standing notes', () => {
    const l = items(header, { header, report: {} } as unknown as ReportResponse<ReportType>);
    expect(l).toContain(W.reports.definitionsNote);
    expect(l.some((t) => t?.includes('Assumed until IFL confirms'))).toBe(false);
  });
});
