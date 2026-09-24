/**
 * RT24-03 (24 Sep 2026): exported reports (CSV/XLSX/PDF) used to drop the
 * generation-disclosure caveat the JSON payload already carried per report
 * type (daily.ts's own `generationNote`, `spansGenerations`,
 * `otherGenerationExcluded` — see that file's `DailyReportData`). This pins
 * the fix at the one place it now lives: `ReportHeader` (common.ts), read by
 * `attributionRows`/`csvDocument` (csv.ts), `headerSheet` (xlsx.ts) and
 * `reportFilename` (csv.ts) alike.
 *
 * PDF is not end-to-end tested anywhere in this suite (pdf.test.ts's own
 * header note explains why: real Chromium is not exercised in `npx vitest
 * run`). The PDF is a screenshot of the same React report page
 * (`web/src/screens/report/PrintHead.tsx`), which reads the identical
 * `ReportHeader` fields this file pins and renders the identical wording
 * `generationDisclosureLines` produces — that shared, tested function is the
 * proxy used here for "the PDF contains the disclosure text", the same way
 * `pdf.test.ts` already limits itself to pure helpers rather than a real
 * render.
 */
import { describe, it, expect } from 'vitest';
import { REPORT_TYPES, generationDisclosureLines, type ReportHeader, type ReportType } from './common.js';
import { attributionRows, csvDocument, reportFilename } from './csv.js';
import { headerSheet } from './xlsx.js';

function makeHeader(type: ReportType, spans: boolean): ReportHeader {
  return {
    reportType: type,
    title: `Test ${type} report`,
    lineName: 'TP1 Line 3',
    plantName: 'IFL',
    unitName: 'Unit 2',
    period: { period: 'custom', from: '2026-08-01', to: '2026-08-10', days: 10 },
    filters: {},
    generatedAtPlantUtc: '2026-08-11T06:00:00.000Z',
    generatedBy: 'tester',
    smsVersion: '0.0.0-test',
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
    spansGenerations: spans,
    sourceGeneration: spans ? 'DATA_TP1U2_SEP07#2' : null,
    otherGenerationExcluded: spans ? { count: 4321, percent: 12.3 } : null,
  };
}

const NON_SPANNING_TRAILING_ROW_COUNT = 9; // report, line, period, filters, generated_at, generated_by, sms_version, definitions, ifl_approval

describe.each(REPORT_TYPES)('generation disclosure — %s', (type) => {
  describe('non-spanning (current behaviour must be unchanged)', () => {
    const header = makeHeader(type, false);

    it('attributionRows carries exactly the original 9 rows, no disclosure rows', () => {
      const rows = attributionRows(header);
      expect(rows).toHaveLength(NON_SPANNING_TRAILING_ROW_COUNT);
      expect(rows.some(([k]) => k.includes('Source generation'))).toBe(false);
      expect(rows.some(([k]) => k.includes('Excluded from other generation'))).toBe(false);
    });

    it('csvDocument trailing block is unaffected', () => {
      const doc = csvDocument(['a'], [[1]], header);
      expect(doc).not.toContain('Source generation');
      expect(doc).not.toContain('Excluded from other generation');
    });

    it('reportFilename carries no -partial-generation marker', () => {
      expect(reportFilename(header, 'csv')).not.toContain('-partial-generation');
      expect(reportFilename(header, 'xlsx')).not.toContain('-partial-generation');
      expect(reportFilename(header, 'pdf')).not.toContain('-partial-generation');
    });

    it('headerSheet (XLSX) carries no disclosure row', () => {
      const sheet = headerSheet(header);
      const values = sheet.rows.map((r) => String(r.item ?? '') + String(r.value ?? ''));
      expect(values.some((v) => v.includes('Source generation'))).toBe(false);
      expect(values.some((v) => v.includes('Excluded from other generation'))).toBe(false);
    });

    it('generationDisclosureLines (the PDF/print wording source) is null', () => {
      expect(generationDisclosureLines(header)).toBeNull();
    });
  });

  describe('spanning (the disclosure must appear everywhere)', () => {
    const header = makeHeader(type, true);

    it('attributionRows\' trailing block contains "Source generation" and "Excluded from other generation" lines', () => {
      const rows = attributionRows(header);
      expect(rows.some(([k]) => k.startsWith('Source generation: DATA_TP1U2_SEP07#2'))).toBe(true);
      expect(rows.some(([k]) => k.startsWith('Excluded from other generation: 4321 readings (12.3%)'))).toBe(true);
    });

    it('csvDocument\'s CSV text carries both lines after the blank-line trailing block, never as a leading comment header', () => {
      const doc = csvDocument(['a'], [[1]], header);
      expect(doc).toContain('Source generation');
      expect(doc).toContain('Excluded from other generation');
      expect(doc.startsWith('#')).toBe(false);
      const sep = doc.indexOf('\n\n');
      expect(sep).toBeGreaterThan(-1);
      const table = doc.slice(0, sep);
      const trailing = doc.slice(sep + 2);
      expect(table).not.toContain('Source generation');
      expect(trailing).toContain('Source generation');
    });

    it('reportFilename carries the -partial-generation marker for every export extension', () => {
      expect(reportFilename(header, 'csv')).toContain('-partial-generation');
      expect(reportFilename(header, 'xlsx')).toContain('-partial-generation');
      expect(reportFilename(header, 'pdf')).toContain('-partial-generation');
      expect(reportFilename(header, 'csv')).toMatch(/-partial-generation\.csv$/);
    });

    it('headerSheet (XLSX) carries a row with the same disclosure text', () => {
      const sheet = headerSheet(header);
      const values = sheet.rows.map((r) => String(r.item ?? ''));
      expect(values.some((v) => v.startsWith('Source generation: DATA_TP1U2_SEP07#2'))).toBe(true);
      expect(values.some((v) => v.startsWith('Excluded from other generation: 4321 readings (12.3%)'))).toBe(true);
    });

    it('generationDisclosureLines (the PDF/print wording source, read verbatim by PrintHead.tsx) states both facts', () => {
      const lines = generationDisclosureLines(header);
      expect(lines).not.toBeNull();
      expect(lines![0]).toBe('Source generation: DATA_TP1U2_SEP07#2');
      expect(lines![1]).toBe('Excluded from other generation: 4321 readings (12.3%)');
    });
  });
});

describe('generationDisclosureLines — edge cases', () => {
  it('omits the percent parenthetical when percent is unknown, rather than fabricating one', () => {
    const header = makeHeader('daily', true);
    header.otherGenerationExcluded = { count: 7, percent: null };
    const lines = generationDisclosureLines(header)!;
    expect(lines[1]).toBe('Excluded from other generation: 7 readings');
  });

  it('states "unknown" for the generation label when none is known, rather than omitting the line', () => {
    const header = makeHeader('daily', true);
    header.sourceGeneration = null;
    const lines = generationDisclosureLines(header)!;
    expect(lines[0]).toBe('Source generation: unknown');
  });
});
