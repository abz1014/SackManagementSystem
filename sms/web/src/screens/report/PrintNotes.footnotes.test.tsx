/** IFL house style: every disclosure lives in the one numbered footnote block at the document's end. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { PrintNotes } from './PrintDoc';
import { W } from '../../lib/words';
import type { ReportHeader } from '../../api';

const base = {
  reportType: 'daily', title: 't', lineName: 'L', plantName: null, unitName: null,
  period: { period: 'pick', from: '2026-09-10', to: '2026-09-10', days: 1 }, filters: {},
  generatedAtPlantUtc: '2026-09-21T09:15:00Z', generatedBy: 'x', smsVersion: '1', definitions: 'KPI-DEFINITIONS.md',
  approval: 'awaiting', spansGenerations: false, sourceGeneration: null, otherGenerationExcluded: null,
} as unknown as ReportHeader;
const data = { report: {} } as never;
const items = (h: ReportHeader) => [...render(<PrintNotes type="daily" data={data} header={h} />).container.querySelectorAll('ol.pd-footnotes li')].map((l) => l.textContent);

describe('PrintNotes footnote block', () => {
  it('always carries the awaiting-approval definitions note', () => {
    expect(items(base)).toContain(W.reports.definitionsNote);
  });
  it('carries the shift note and the batch/simulator disclosure when they apply', () => {
    const l = items({ ...base, shiftNote: 'SHIFT!', simulatorSource: true, generationLine: 'SIM BATCH' });
    expect(l).toContain('SHIFT!');
    expect(l).toContain('SIM BATCH');
  });
  it('omits them when they do not apply', () => {
    const l = items(base);
    expect(l.some((t) => t?.includes('SIM BATCH'))).toBe(false);
  });
});

describe('portrait page selector', () => {
  const css = readFileSync(`${process.cwd()}/web/src/app.css`, 'utf8');
  it('app.css defines the report-portrait page and its data-attribute hook', () => {
    expect(css).toMatch(/main:has\(\[data-report-orientation="portrait"\][^)]*\)\s*\{\s*page:\s*report-portrait;/);
    expect(css).toMatch(/@page\s+report-portrait\s*\{[^}]*size:\s*A4\s+portrait/);
    expect(css.indexOf('page: report-portrait')).toBeGreaterThan(css.indexOf('page: report-landscape'));
  });
});
