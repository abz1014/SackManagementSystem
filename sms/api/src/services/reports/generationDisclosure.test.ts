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
      expect(rows.some(([k]) => k.includes('Data batch'))).toBe(false);
      expect(rows.some(([k]) => k.includes('Excluded from another data batch'))).toBe(false);
    });

    it('csvDocument trailing block is unaffected', () => {
      const doc = csvDocument(['a'], [[1]], header);
      expect(doc).not.toContain('Data batch');
      expect(doc).not.toContain('Excluded from another data batch');
    });

    it('reportFilename carries no -partial-generation marker', () => {
      expect(reportFilename(header, 'csv')).not.toContain('-partial-generation');
      expect(reportFilename(header, 'xlsx')).not.toContain('-partial-generation');
      expect(reportFilename(header, 'pdf')).not.toContain('-partial-generation');
    });

    it('headerSheet (XLSX) carries no disclosure row', () => {
      const sheet = headerSheet(header);
      const values = sheet.rows.map((r) => String(r.item ?? '') + String(r.value ?? ''));
      expect(values.some((v) => v.includes('Data batch'))).toBe(false);
      expect(values.some((v) => v.includes('Excluded from another data batch'))).toBe(false);
    });

    it('generationDisclosureLines (the PDF/print wording source) is null', () => {
      expect(generationDisclosureLines(header)).toBeNull();
    });
  });

  describe('spanning (the disclosure must appear everywhere)', () => {
    const header = makeHeader(type, true);

    it('attributionRows\' trailing block contains "Data batch" and "Excluded from another data batch" lines', () => {
      const rows = attributionRows(header);
      expect(rows.some(([k]) => k.startsWith('Data batch: DATA_TP1U2_SEP07#2'))).toBe(true);
      expect(rows.some(([k]) => k.startsWith('Excluded from another data batch: 4321 readings (12.3%)'))).toBe(true);
    });

    it('csvDocument\'s CSV text carries both lines after the blank-line trailing block, never as a leading comment header', () => {
      const doc = csvDocument(['a'], [[1]], header);
      expect(doc).toContain('Data batch');
      expect(doc).toContain('Excluded from another data batch');
      expect(doc.startsWith('#')).toBe(false);
      const sep = doc.indexOf('\n\n');
      expect(sep).toBeGreaterThan(-1);
      const table = doc.slice(0, sep);
      const trailing = doc.slice(sep + 2);
      expect(table).not.toContain('Data batch');
      expect(trailing).toContain('Data batch');
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
      expect(values.some((v) => v.startsWith('Data batch: DATA_TP1U2_SEP07#2'))).toBe(true);
      expect(values.some((v) => v.startsWith('Excluded from another data batch: 4321 readings (12.3%)'))).toBe(true);
    });

    it('generationDisclosureLines (the PDF/print wording source, read verbatim by PrintHead.tsx) states both facts', () => {
      const lines = generationDisclosureLines(header);
      expect(lines).not.toBeNull();
      expect(lines![0]).toBe('Data batch: DATA_TP1U2_SEP07#2');
      expect(lines![1]).toBe('Excluded from another data batch: 4321 readings (12.3%)');
    });
  });
});

describe('simulator-only period (spansGenerations false, simulatorSource true) — re-audit fix', () => {
  // Re-audit finding (Major): a period entirely covered by the plant
  // simulator excludes nothing, so `spansGenerations` stays false and the
  // old attributionRows()/headerSheet() — which only ever called
  // generationDisclosureLines(h) — printed NO disclosure at all, even though
  // buildHeader (header.ts) already computes `generationLine` for exactly
  // this case ("Data batch: … (plant simulator, synthetic data).").
  //
  // Coordinator follow-up (29 Sep 2026): the first pass fell back to
  // `h.sourceGeneration` verbatim, which can be the RAW vendor label (e.g.
  // "pack1_TP1U2 gen 4") — it never states the data is simulated. Every
  // variant below asserts the row contains BOTH "plant simulator" and
  // "synthetic", and never contains the raw label on its own.
  const RAW_LABEL = 'pack1_TP1U2 gen 4';

  /** The realistic case: buildHeader already composed generationLine correctly. */
  function makeSimulatorHeaderWithLine(): ReportHeader {
    const h = makeHeader('daily', false);
    h.simulatorSource = true;
    h.sourceGeneration = `${RAW_LABEL} (plant simulator, synthetic data)`;
    h.generationLine = `Data batch: ${RAW_LABEL} (plant simulator, synthetic data).`;
    return h;
  }

  /** The fallback case: an older/hand-built header carries simulatorSource + a bare raw sourceGeneration but no generationLine at all. */
  function makeSimulatorHeaderRawOnly(): ReportHeader {
    const h = makeHeader('daily', false);
    h.simulatorSource = true;
    h.sourceGeneration = RAW_LABEL;
    h.generationLine = undefined;
    return h;
  }

  function expectPlainWordsDisclosure(rowText: string): void {
    expect(rowText).toMatch(/plant simulator/i);
    expect(rowText).toMatch(/synthetic/i);
  }

  describe.each([
    ['generationLine present', makeSimulatorHeaderWithLine],
    ['generationLine absent, raw sourceGeneration only (batchName fallback)', makeSimulatorHeaderRawOnly],
  ] as const)('%s', (_label, make) => {
    it('attributionRows carries a Data batch disclosure row naming the simulator in plain words', () => {
      const rows = attributionRows(make());
      const disclosureRow = rows.find(([k]) => k.startsWith('Data batch'));
      expect(disclosureRow).toBeDefined();
      expectPlainWordsDisclosure(disclosureRow![0]);
    });

    it('csvDocument trailing block carries the plain-words simulator disclosure', () => {
      const doc = csvDocument(['a'], [[1]], make());
      const sep = doc.indexOf('\n\n');
      expect(sep).toBeGreaterThan(-1);
      const trailing = doc.slice(sep + 2);
      expect(trailing).toContain('Data batch');
      expectPlainWordsDisclosure(trailing);
    });

    it('headerSheet (XLSX) carries the plain-words simulator disclosure row', () => {
      const sheet = headerSheet(make());
      const values = sheet.rows.map((r) => String(r.item ?? ''));
      const disclosureRow = values.find((v) => v.startsWith('Data batch'));
      expect(disclosureRow).toBeDefined();
      expectPlainWordsDisclosure(disclosureRow!);
    });
  });

  it('the fallback row never surfaces the bare raw label on its own', () => {
    const rows = attributionRows(makeSimulatorHeaderRawOnly());
    const disclosureRow = rows.find(([k]) => k.startsWith('Data batch'))![0];
    // The raw label may legitimately appear WITHIN a plain-words sentence
    // (batchName still names the batch), but the row must never be just the
    // raw label with no simulator/synthetic qualifier — the whole point of
    // this fix.
    expect(disclosureRow).not.toBe(`Data batch: ${RAW_LABEL}`);
    expectPlainWordsDisclosure(disclosureRow);
  });

  it('a plain single real batch (spansGenerations false, simulatorSource false/undefined) still produces no trailer', () => {
    const header = makeHeader('daily', false);
    const rows = attributionRows(header);
    expect(rows).toHaveLength(NON_SPANNING_TRAILING_ROW_COUNT);
    expect(rows.some(([k]) => k.includes('Data batch'))).toBe(false);
  });
});

describe('generationDisclosureLines — edge cases', () => {
  it('omits the percent parenthetical when percent is unknown, rather than fabricating one', () => {
    const header = makeHeader('daily', true);
    header.otherGenerationExcluded = { count: 7, percent: null };
    const lines = generationDisclosureLines(header)!;
    expect(lines[1]).toBe('Excluded from another data batch: 7 readings');
  });

  it('states "unknown" for the generation label when none is known, rather than omitting the line', () => {
    const header = makeHeader('daily', true);
    header.sourceGeneration = null;
    const lines = generationDisclosureLines(header)!;
    expect(lines[0]).toBe('Data batch: unknown');
  });
});
