/**
 * RESERVED: IFL report dates (owner decision 13 Oct 2026, confirming owner 30 Sep 2026; fix-wave T7a1).
 *
 * IFL report tables and mastheads keep IFL house style, "01-09-2026" and "01-09-2026 21:33" (fmtDayDmy / fmtAppInstantDmy in
 * the IFL renderers; dayStamp / plantStamp in the date context). EVERYTHING ELSE prints lib/fmt: "1 Sep 2026", 24-hour.
 * design/redesign-2026-10/GLOSSARY.md records the reservation; this test pins both halves so neither drifts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import '../../web/src/testkit/render';
import { installFakeFetch, type FakeFetch } from '../../web/src/testkit/fetchRouter';
import { fmtAppInstantDmy, fmtDayDmy } from '../../web/src/screens/report/shared';
import { PrintHead } from '../../web/src/screens/report/PrintHead';
import { NextDateFmt, NEXT_DATE_FMT, NON_IFL_DATE_FMT } from './bridge/dateFmt';
import { RegisterPrintHead } from './bridge/register';
import { fmtDate, fmtDateTime } from './lib/fmt';
import { live } from './bridge/lib';

const HEADER = {
  reportType: 'rejected-cones',
  title: 'List of Rejected Cones Against Weight',
  lineName: 'TP1 · Line 3 · Unit 2',
  plantName: 'TP1',
  unitName: 'Unit 2',
  period: { period: 'custom', from: '2026-09-01', to: '2026-09-01', days: 1 },
  periodLabel: '2026-09-01 to 2026-09-01',
  filters: {},
  generatedAtPlantUtc: '2026-09-01T21:33:00.000Z',
  generatedBy: 'operator-2',
  smsVersion: '0.2.0',
  definitions: 'KPI-DEFINITIONS.md',
  approval: 'awaiting',
  spansGenerations: false,
  sourceGeneration: null,
  otherGenerationExcluded: null,
} as never;

let fake: FakeFetch | null = null;
afterEach(() => {
  cleanup();
  fake?.restore();
  fake = null;
});

describe('RESERVED IFL dates (owner decision 13 Oct 2026)', () => {
  it('the IFL renderers keep DD-MM-YYYY', () => {
    expect(fmtDayDmy('2026-09-01')).toBe('01-09-2026');
    expect(fmtAppInstantDmy('2026-09-01T21:33:00')).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
  });

  it('the date context keeps the IFL stamps for the Reports tab and the app format for everything else', () => {
    expect(NEXT_DATE_FMT.dayStamp('2026-09-01')).toBe('01-09-2026');
    expect(NEXT_DATE_FMT.plantStamp('2026-09-01T21:33:00Z')).toBe('01-09-2026 21:33');
    expect(NON_IFL_DATE_FMT.dayStamp('2026-09-01')).toBe(fmtDate('2026-09-01'));
    expect(NON_IFL_DATE_FMT.dayStamp('2026-09-01')).toBe('1 Sep 2026');
    expect(NON_IFL_DATE_FMT.plantStamp('2026-09-01T21:33:00Z')).toBe(fmtDateTime('2026-09-01T21:33:00Z'));
  });

  it('an IFL report masthead prints 01-09-2026', () => {
    const { container } = render(
      <NextDateFmt>
        <PrintHead header={HEADER} />
      </NextDateFmt>,
    );
    expect(container.textContent).toContain('01-09-2026');
    expect(container.textContent).toContain('01-09-2026 21:33');
  });

  it('the Register print header (not an IFL report) prints the app format and no DD-MM-YYYY', async () => {
    fake = installFakeFetch({
      '/api/reports/header': { header: { ...(HEADER as object), reportType: 'register', title: 'Register' } },
      '/api/live': { data: { lines: [] }, metadata: {} },
    });
    const { container } = render(<live.LiveProvider asOf={null}>
        <RegisterPrintHead from="2026-09-01" to="2026-09-01" at={null} title="Register, cones" />
      </live.LiveProvider>);
    await waitFor(() => expect(container.querySelector('.ph-meta')).not.toBeNull());
    const text = container.textContent ?? '';
    expect(text).toContain('1 Sep 2026');
    expect(text).not.toMatch(/\b\d{2}-\d{2}-\d{4}\b/);
  });

  it('GLOSSARY.md records the reservation', () => {
    const root = typeof __dirname === 'string' ? resolve(__dirname, '../..') : process.cwd();
    const g = readFileSync(resolve(root, '../design/redesign-2026-10/GLOSSARY.md'), 'utf8');
    expect(g).toMatch(/RESERVED[^\n]*IFL report (tables|dates)[^\n]*01-09-2026/i);
  });
});
