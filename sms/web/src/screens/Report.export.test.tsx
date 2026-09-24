/**
 * WS-PDF1 (24 Sep 2026): the server has offered a server-rendered PDF export
 * since 22 Sep 2026 (`GET /api/reports/:type/export?format=pdf`,
 * `api/src/routes/reports.ts`, `services/reports/pdf.ts`) — same rank gate
 * (`EXPORT_RANK` = rank 3) as CSV and XLSX, audited as `export.pdf` — but
 * the Report screen never offered it. IFL's 15 Sep 2026 answers ask for
 * Excel AND PDF reports.
 *
 * This locks the PDF download link to the exact same gate CSV/XLSX already
 * have: present only at `rank >= EXPORT_MIN_RANK` AND `canRead`, and
 * disabled (rendered as a `<button disabled>`, matching CSV/XLSX) while the
 * report is still loading — a half-loaded report must not be printable or
 * downloadable, the same rule the existing comment in Report.tsx states for
 * Print. Every case is mirrored against what CSV/XLSX already do, so a
 * divergence between the three shows up here, not just for PDF alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import type { AuthUser, ReportFilters, ReportHeader } from '../api';
import { ReportScreen } from './Report';

// Section components need a full, type-specific report body to render
// without throwing; this file is testing the export controls, not any
// section's content, so every section is stubbed to a trivial marker.
vi.mock('./report/Daily', () => ({ DailySection: () => <div data-testid="section" /> }));
vi.mock('./report/Shift', () => ({ ShiftSection: () => <div data-testid="section" /> }));
vi.mock('./report/Product', () => ({ ProductSection: () => <div data-testid="section" /> }));
vi.mock('./report/Station', () => ({ StationSection: () => <div data-testid="section" /> }));
vi.mock('./report/Reject', () => ({ RejectSection: () => <div data-testid="section" /> }));
vi.mock('./report/ConeWeight', () => ({ ConeWeightSection: () => <div data-testid="section" /> }));
vi.mock('./report/Sack', () => ({ SackSection: () => <div data-testid="section" /> }));
vi.mock('./report/Calibration', () => ({ CalibrationSection: () => <div data-testid="section" /> }));
vi.mock('./report/Summary', () => ({ SummarySection: () => <div data-testid="section" /> }));
vi.mock('./report/MachineProduct', () => ({ MachineProductSection: () => <div data-testid="section" /> }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z',
  tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening',
  live: true,
  days: 1,
};

function header(): ReportHeader {
  return {
    reportType: 'daily',
    title: 'Daily',
    lineName: 'TP1 Line 3',
    plantName: null,
    unitName: null,
    period: { period: 'custom', from: '2026-09-07', to: '2026-09-07', days: 1 },
    filters: {},
    generatedAtPlantUtc: '2026-09-07T12:00:00Z',
    generatedBy: 'test-user',
    smsVersion: '0.0.0-test',
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
    spansGenerations: false,
    sourceGeneration: 'SEP07',
    otherGenerationExcluded: null,
  };
}

/** A minimal `daily` report body — enough for `data.report` to exist; the
 * mocked DailySection never reads it. */
function dailyBody() {
  return { shift: null, coverage: { daysWithData: 1, daysInPeriod: 1, complete: true, firstDayWithData: '2026-09-07', lastDayWithData: '2026-09-07' } };
}

function user(role: string): AuthUser {
  return { username: 'test-user', displayName: 'Test User', role };
}

function baseProps(overrides: Partial<Parameters<typeof ReportScreen>[0]> = {}) {
  return {
    period: PERIOD,
    user: user('manager'), // rank 3 — export-eligible by default; overridden per test
    type: 'daily' as const,
    onTypeChange: () => {},
    filters: {} as ReportFilters,
    onShiftChange: () => {},
    onStationChange: () => {},
    onProductChange: () => {},
    onOpenStation: () => {},
    onOpenCode: () => {},
    ...overrides,
  };
}

function routes(reportOk = true) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/stations': { stations: [] },
    '/api/products': { products: [] },
    '/api/reports/daily': reportOk
      ? { data: { header: header(), report: dailyBody() }, metadata: {} }
      : () => { throw new Error('down'); },
  };
}

describe('Report screen — PDF export link', () => {
  it('rank >= EXPORT_MIN_RANK, report loaded: PDF link sits beside CSV and XLSX, same href base, format=pdf', async () => {
    installFakeFetch(routes());
    const { findByText, getByText } = renderWithLive(<ReportScreen {...baseProps({ user: user('manager') })} />);

    // The report starts loading, so CSV/XLSX/PDF all render as disabled
    // buttons at first (same text) — wait for the report to arrive and the
    // controls to become real links before asserting on them.
    await findByText(W.report.exportCsv);
    await waitFor(() => expect(getByText(W.report.exportCsv).tagName).toBe('A'));

    const csv = getByText(W.report.exportCsv) as HTMLAnchorElement;
    const xlsx = getByText(W.report.exportXlsx) as HTMLAnchorElement;
    const pdf = getByText(W.report.exportPdf) as HTMLAnchorElement;

    expect(csv.tagName).toBe('A');
    expect(xlsx.tagName).toBe('A');
    expect(pdf.tagName).toBe('A');

    expect(xlsx.getAttribute('href')).toContain('format=xlsx');
    expect(pdf.getAttribute('href')).toContain('format=pdf');
    // Same query otherwise — only the format param differs.
    const csvBase = csv.getAttribute('href')!.split('?')[0];
    const pdfBase = pdf.getAttribute('href')!.split('?')[0];
    expect(pdfBase).toBe(csvBase);
  });

  it('report still loading: PDF renders as a disabled button, exactly like CSV and XLSX', async () => {
    installFakeFetch(routes(false));
    const { findByText } = renderWithLive(<ReportScreen {...baseProps({ user: user('manager') })} />);

    const pdf = (await findByText(W.report.exportPdf)) as HTMLButtonElement;
    expect(pdf.tagName).toBe('BUTTON');
    expect(pdf.hasAttribute('disabled')).toBe(true);
    // Its siblings must agree — the whole export row rises and falls together.
    const csv = (await findByText(W.report.exportCsv)) as HTMLButtonElement;
    expect(csv.tagName).toBe('BUTTON');
    expect(csv.hasAttribute('disabled')).toBe(true);
  });

  it('rank below EXPORT_MIN_RANK (engineer, rank 2): no export control at all — not CSV, XLSX or PDF', async () => {
    installFakeFetch(routes());
    const { findByRole, queryByText } = renderWithLive(<ReportScreen {...baseProps({ user: user('engineer') })} />);

    await findByRole('heading', { level: 1 });
    expect(queryByText(W.report.exportCsv)).toBeNull();
    expect(queryByText(W.report.exportXlsx)).toBeNull();
    expect(queryByText(W.report.exportPdf)).toBeNull();
  });
});

