/**
 * IFL's eight named reports (their email of 29 Sep 2026) on the Report
 * screen: two labelled chip rows (IFL's eight in THEIR numbering, then the
 * ten analysis reports), the outer `role="group" aria-label="Report"` the
 * landscape @page rule keys off kept exactly, each new type routed to its
 * section, and only the filters a type accepts offered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import type { AuthUser, ReportFilters, ReportHeader, ReportType } from '../api';
import { ReportScreen } from './Report';
import { REPORT_GROUPS } from './report/model';

vi.mock('./report/Daily', () => ({ DailySection: () => <div data-testid="section" /> }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'range', from: '2026-09-01', to: '2026-09-07', tsFrom: '2026-09-01T00:00:00Z', tsTo: '2026-09-07T23:59:59Z', live: true, days: 7,
};

function header(reportType: ReportType): ReportHeader {
  return {
    reportType, title: 'T', lineName: 'TP1 · Line 3 · Unit 2', plantName: 'TP1', unitName: 'Unit 2',
    period: { period: 'custom', from: '2026-09-01', to: '2026-09-07', days: 7 }, filters: {},
    generatedAtPlantUtc: '2026-09-07T12:00:00Z', generatedBy: 'test-user', smsVersion: '0.0.0-test',
    definitions: 'KPI-DEFINITIONS.md', approval: 'awaiting', spansGenerations: false, sourceGeneration: 'SEP07', otherGenerationExcluded: null,
  };
}

const user = (role: string): AuthUser => ({ username: 'test-user', displayName: 'Test User', role });

function props(overrides: Partial<Parameters<typeof ReportScreen>[0]> = {}) {
  return {
    period: PERIOD, user: user('manager'), type: 'daily' as ReportType, onTypeChange: () => {}, filters: {} as ReportFilters,
    onShiftChange: () => {}, onStationChange: () => {}, onProductChange: () => {}, onOpenStation: () => {}, onOpenCode: () => {},
    ...overrides,
  };
}

const NEW_BODY = {
  period: { period: 'custom', from: '2026-09-01', to: '2026-09-07' }, filters: {}, lineId: 1, note: 'A report-level note.',
  pendingIfl: ['The SPS is assumed to be this line’s one sack scale.'],
  generationNote: { generation: null, spansGenerations: false, otherGenerationExcluded: 0 },
};

function routes(type: ReportType, report: unknown = { shift: null, coverage: { daysWithData: 1, daysInPeriod: 1, complete: true, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-01' } }) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/stations': { stations: [{ stationId: 1, name: 'Winder 1' }] },
    '/api/products': { products: [{ productId: 5, description: 'P5' }] },
    [`/api/reports/${type}`]: { data: { header: header(type), report }, metadata: {} },
  };
}

describe('Report chips — two labelled rows', () => {
  it('keeps the outer Report group exactly once, with an IFL row (8, in IFL order) and an Analysis row (10)', async () => {
    installFakeFetch(routes('daily'));
    const { findByRole, getAllByRole, getByRole } = renderWithLive(<ReportScreen {...props()} />);
    await findByRole('heading', { level: 1 });

    // The DOM hook app.css's landscape rule and print.landscape.guard.test.ts depend on.
    expect(getAllByRole('group', { name: W.reports.selectorLabel })).toHaveLength(1);

    const ifl = getByRole('group', { name: W.iflReports.groups.ifl });
    const iflChips = within(ifl).getAllByRole('button').map((b) => b.textContent);
    expect(iflChips).toEqual(REPORT_GROUPS.ifl.map((t) => W.reports.type[t]));
    expect(iflChips).toEqual([
      'Shift-wise CTS Loop Production Report',
      'Rejected Sack Report - Daily',
      'SPS Production Report - Count-wise Packing at Each SPS',
      'SPS Sack Weight Range Report',
      'Sack Packing Weight Summary',
      'List of Rejected Cones Against Weight',
      'Rejected Cone Hangers Report',
      'Rejected Unknown (Lifter) Report',
    ]);

    const analysis = getByRole('group', { name: W.iflReports.groups.analysis });
    expect(within(analysis).getAllByRole('button')).toHaveLength(10);
    expect(within(analysis).getByRole('button', { name: 'Management summary' })).toBeTruthy();
  });

  it('marks the open type pressed and reports a click with the clicked type', async () => {
    installFakeFetch(routes('daily'));
    const picked: ReportType[] = [];
    const { findByRole, getByRole } = renderWithLive(<ReportScreen {...props({ type: 'daily', onTypeChange: (t: ReportType) => picked.push(t) })} />);
    await findByRole('heading', { level: 1 });
    expect(getByRole('button', { name: 'Daily' }).getAttribute('aria-pressed')).toBe('true');
    expect(getByRole('button', { name: 'Rejected Sack Report - Daily' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(getByRole('button', { name: 'Rejected Cone Hangers Report' }));
    expect(picked).toEqual(['rejected-hangers']);
  });
});

describe('Report screen — a new IFL type reaches its section and offers only its filters', () => {
  it.each([
    ['rejected-sacks', ['Shift', 'Product'], ['Station']],
    ['sps-packing', ['Shift'], ['Station', 'Product']],
    ['sack-weight-range', ['Shift', 'Product'], ['Station']],
    ['sack-weight-summary', ['Shift', 'Product'], ['Station']],
    ['rejected-hangers', ['Shift', 'Station', 'Product'], []],
    ['rejected-unknown-lifter', ['Shift', 'Product'], ['Station']],
  ] as [ReportType, string[], string[]][])('%s', async (type, offered, refused) => {
    installFakeFetch(routes(type, NEW_BODY));
    const { findByTestId, queryByLabelText, findByLabelText } = renderWithLive(<ReportScreen {...props({ type })} />);
    // The section renders (the scaffold's empty state) with the report's own
    // pendingIfl under the shared heading.
    const pending = await findByTestId('pending-ifl');
    expect(pending.textContent).toContain(W.iflReports.pendingHeading);
    expect(pending.textContent).toContain('The SPS is assumed to be this line’s one sack scale.');
    for (const f of offered) expect(await findByLabelText(f)).toBeTruthy();
    for (const f of refused) expect(queryByLabelText(f)).toBeNull();
  });

  it('a report with nothing to assume prints no assumptions heading', async () => {
    installFakeFetch(routes('rejected-sacks', { ...NEW_BODY, pendingIfl: [] }));
    const { findByText, queryByTestId } = renderWithLive(<ReportScreen {...props({ type: 'rejected-sacks' })} />);
    await findByText(NEW_BODY.note);
    expect(queryByTestId('pending-ifl')).toBeNull();
  });

  it('every new type is readable at rank 1 and exportable only at rank 3', async () => {
    installFakeFetch(routes('sps-packing', NEW_BODY));
    const viewer = renderWithLive(<ReportScreen {...props({ type: 'sps-packing', user: user('viewer') })} />);
    await viewer.findByTestId('pending-ifl');
    expect(viewer.queryByText(W.report.exportCsv)).toBeNull();
    viewer.unmount();

    installFakeFetch(routes('sps-packing', NEW_BODY));
    const manager = renderWithLive(<ReportScreen {...props({ type: 'sps-packing', user: user('manager') })} />);
    await manager.findByTestId('pending-ifl');
    expect(manager.getByText(W.report.exportCsv).tagName).toBe('A');
    expect(manager.getByText(W.report.exportCsv).getAttribute('href')).toContain('/api/reports/sps-packing/export');
  });
});

describe('Report screen — narrow-width layout guards (IFL reports, layout findings L1, L3, L4)', () => {
  // jsdom computes no layout, so these pin the declarations the real-browser spec (layout-tests/ifl-reports.spec.ts) measures.
  it('every report chip may wrap inside itself and never grows past its row (a 54-character title is wider than a phone)', async () => {
    installFakeFetch(routes('daily'));
    const { findByRole, getByRole } = renderWithLive(<ReportScreen {...props()} />);
    await findByRole('heading', { level: 1 });
    const chips = [...getByRole('group', { name: W.iflReports.groups.ifl }).querySelectorAll('button.chip'), ...getByRole('group', { name: W.iflReports.groups.analysis }).querySelectorAll('button.chip')] as HTMLElement[];
    expect(chips).toHaveLength(18);
    for (const c of chips) {
      expect(c.style.whiteSpace, c.textContent ?? '').toBe('normal');
      expect(c.style.maxWidth, c.textContent ?? '').toBe('100%');
    }
    // the long one is the reason: it is the title IFL's own email gave
    expect(W.reports.type['sps-packing'].length).toBeGreaterThan(50);
  });

  it('a filter chip\'s select may shrink below its longest option instead of widening the page', async () => {
    installFakeFetch(routes('rejected-hangers', NEW_BODY));
    const { findByLabelText } = renderWithLive(<ReportScreen {...props({ type: 'rejected-hangers' })} />);
    for (const name of ['Shift', 'Station', 'Product']) {
      const select = (await findByLabelText(name)) as HTMLSelectElement;
      expect(parseFloat(select.style.minWidth), name).toBe(0);
      expect(select.style.maxWidth, name).toBe('100%');
      expect((select.closest('label') as HTMLElement).style.maxWidth, name).toBe('100%');
    }
  });

  it('the header page ends where its chips end: no 64px bottom padding stacked above the first section', async () => {
    installFakeFetch(routes('daily'));
    const { findByRole, container } = renderWithLive(<ReportScreen {...props()} />);
    await findByRole('heading', { level: 1 });
    const head = container.querySelector('.head-row')!.parentElement as HTMLElement;
    expect(head.className).toBe('page');
    expect(parseFloat(head.style.paddingBottom)).toBe(0);
  });
});
