/**
 * IFL reports, task J (1 Oct 2026): the layout harness's report fixtures
 * (`layout-tests/support/mocks.ts`) are plain objects a real browser lays out
 * with every `/api/*` call mocked. They are only worth anything if they are the
 * wire shape the app really reads, so this guard renders each of IFL's eight
 * through its REAL section component and the printed executive summary — a
 * fixture that drifts from the contract (a renamed field, a missing list)
 * fails here, in the fast suite, instead of silently rendering an empty state
 * under Playwright and "passing" a layout check with nothing on the page.
 *
 * It also pins the print-orientation hook the Playwright spec measures: all of
 * IFL's reports but SPS packing mark their root `data-report-orientation=
 * "portrait"` (app.css's `report-portrait` page); SPS packing, a wide matrix,
 * does not and so prints on the landscape page the Report screen defaults to.
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { IFL_REPORT_KINDS, reportEnvelope, type ReportKind } from '../../../../layout-tests/support/mocks';
import type { ReportResponse, ReportType } from '../../api';
import { summarise } from './PrintDoc';
import { ShiftProductionSection } from './ShiftProduction';
import { RejectedConesSection } from './RejectedCones';
import { RejectedSacksSection } from './RejectedSacks';
import { SpsPackingSection } from './SpsPacking';
import { SackWeightRangeSection } from './SackWeightRange';
import { SackWeightSummarySection } from './SackWeightSummary';
import { RejectedHangersSection } from './RejectedHangers';
import { RejectedUnknownLifterSection } from './RejectedUnknownLifter';

type Envelope = { data: ReportResponse<ReportType>; metadata: unknown };
const responseOf = (kind: ReportKind): ReportResponse<ReportType> => (reportEnvelope(kind) as Envelope).data;

/** One line per type, the same switch Report.tsx's `Sections` makes. */
function sectionFor(kind: ReportKind, r: ReportResponse<ReportType>): ReactElement {
  switch (kind) {
    case 'shift-production': return <ShiftProductionSection d={(r as ReportResponse<'shift-production'>).report} />;
    case 'rejected-cones': return <RejectedConesSection d={(r as ReportResponse<'rejected-cones'>).report} />;
    case 'rejected-sacks': return <RejectedSacksSection d={(r as ReportResponse<'rejected-sacks'>).report} />;
    case 'sps-packing': return <SpsPackingSection d={(r as ReportResponse<'sps-packing'>).report} />;
    case 'sack-weight-range': return <SackWeightRangeSection d={(r as ReportResponse<'sack-weight-range'>).report} />;
    case 'sack-weight-summary': return <SackWeightSummarySection d={(r as ReportResponse<'sack-weight-summary'>).report} />;
    case 'rejected-hangers': return <RejectedHangersSection d={(r as ReportResponse<'rejected-hangers'>).report} />;
    case 'rejected-unknown-lifter': return <RejectedUnknownLifterSection d={(r as ReportResponse<'rejected-unknown-lifter'>).report} />;
    default: throw new Error(`not one of IFL's eight: ${kind}`);
  }
}

describe('the layout harness fixtures for IFL\'s eight reports are the shape the app reads', () => {
  it('names exactly IFL\'s eight, in their numbering, and each fixture carries its own title and type', () => {
    expect([...IFL_REPORT_KINDS]).toEqual([
      'shift-production', 'rejected-sacks', 'sps-packing', 'sack-weight-range',
      'sack-weight-summary', 'rejected-cones', 'rejected-hangers', 'rejected-unknown-lifter',
    ]);
    for (const kind of IFL_REPORT_KINDS) expect(responseOf(kind).header.reportType).toBe(kind);
  });

  it.each([...IFL_REPORT_KINDS])('%s: the real section renders its tables from the fixture, with no hole in the text', (kind) => {
    const { container } = render(sectionFor(kind, responseOf(kind)));
    expect(container.querySelectorAll('table.ifl-table').length, `${kind}: no table rendered`).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toMatch(/NaN|undefined|\[object/);
    // an empty state would pass a layout check with nothing on the page: the fixture must hold real rows
    expect(container.querySelectorAll('table.ifl-table tbody tr').length, `${kind}: fixture rendered no rows`).toBeGreaterThan(2);
    // every table sits in a `.tw` wrapper, the container that scrolls on a narrow screen instead of the page
    for (const t of container.querySelectorAll('table.ifl-table')) expect(t.closest('.tw'), `${kind}: a table outside .tw`).not.toBeNull();
  });

  it.each([...IFL_REPORT_KINDS])('%s: the printed executive summary reads the fixture', (kind) => {
    const s = summarise(kind, responseOf(kind));
    expect(s.tiles.length).toBeGreaterThan(0);
    expect(s.sentences.length).toBeGreaterThan(0);
    for (const t of s.tiles) expect(`${t.value}${t.note ?? ''}`).not.toMatch(/NaN|undefined/);
    expect(s.sentences.join(' ')).not.toMatch(/NaN|undefined/);
  });

  it.each([...IFL_REPORT_KINDS])('%s: prints portrait, except SPS packing, which is a wide matrix on the landscape page', (kind) => {
    const { container } = render(sectionFor(kind, responseOf(kind)));
    const portrait = container.querySelector('[data-report-orientation="portrait"]');
    expect(portrait !== null, kind).toBe(kind !== 'sps-packing');
  });

  it('each report states what it assumes until IFL confirms, so the layout sees the real block', () => {
    for (const kind of IFL_REPORT_KINDS) {
      const d = responseOf(kind).report as { pendingIfl: string[] };
      expect(d.pendingIfl.length, kind).toBeGreaterThan(0);
    }
  });
});
