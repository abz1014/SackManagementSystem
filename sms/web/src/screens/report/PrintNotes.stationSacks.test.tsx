/**
 * C-005 follow-up (RV3-S3-W1): a station-filtered Product report prints the sack sentence in its body (Product.tsx), so the closing
 * notes on paper must not state it a second time. CSV and workbook still carry it through header.reportNotes.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import type { ReportHeader, ReportResponse, ReportType } from '../../api';
import { PrintNotes, printedInBody } from './PrintDoc';

const SACK = 'Sacks are not shown: the sack scale records no winder, so sack figures cannot be narrowed to station 4.';
const header = {
  reportType: 'product', title: 't', lineName: 'L', plantName: 'TP1', unitName: 'Unit 2',
  period: { period: 'pick', from: '2026-08-11', to: '2026-08-11', days: 1 }, filters: { station: 4 },
  generatedAtPlantUtc: '2026-09-21T09:15:00Z', generatedBy: 'x', smsVersion: '1', definitions: 'KPI-DEFINITIONS.md',
  approval: 'awaiting', spansGenerations: false, sourceGeneration: null, otherGenerationExcluded: null,
  reportNotes: ['Method note.', SACK],
} as unknown as ReportHeader;
const data = (report: unknown) => ({ header, report }) as unknown as ReportResponse<ReportType>;

describe('station-filtered Product report: the sack sentence is printed once', () => {
  it('printedInBody lists the sack sentence when sacks are omitted', () => {
    expect(printedInBody('product', data({ rows: [], sacksOmitted: true, sackNote: SACK }))).toContain(SACK);
  });
  it('the closing notes leave it out because the body already carries it', () => {
    const d = data({ rows: [], sacksOmitted: true, sackNote: SACK });
    const li = [...render(<PrintNotes type="product" data={d} header={header} />).container.querySelectorAll('ol.pd-footnotes li')].map((l) => l.textContent);
    expect(li).not.toContain(SACK);
    expect(li).toContain('Method note.');
  });
  it('without a station filter nothing changes', () => {
    expect(printedInBody('product', data({ rows: [] }))).toEqual([]);
  });
});
