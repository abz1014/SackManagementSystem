/**
 * Reports landing and viewer (task E11). TRACE rows verified here:
 *   A1-084 (every report type reads GET /api/reports/:type), A1-085 + A5-19 (exports: rank 3, absent below, disabled
 *   until the report arrives), A3-080 + A5-26 + A5-27 (cards, filters per type, IFL numbering), A5-01 (management
 *   summary needs rank 3; E-1 default), A5-14 + E-7 (machine and product, all-zero rows are empty), A5-21 + A5-23 +
 *   E-6 (stable print hook), A5-29 + X-3 (an empty period names the newest reading), A5-31 (exports stay server-side).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../web/src/testkit/render';
import { installDomStubs } from '../../../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type Routes } from '../../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../../web/src/testkit/fixtures';
import { REPORT_TYPES, type ReportType } from '../../bridge/api';
import { live } from '../../bridge/lib';
import { RESERVED } from '../../copy';
import { parseRoute } from '../../route';
import { CARDS, ALL_TYPES, defaultType, typeFromKeys, variantOf, isEmptyReport } from './model';
import { ReportsScreen } from './ReportsScreen';

vi.mock('../../../../web/src/screens/report/Daily', () => ({ DailySection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/Shift', () => ({ ShiftSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/Product', () => ({ ProductSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/Station', () => ({ StationSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/Reject', () => ({ RejectSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/ConeWeight', () => ({ ConeWeightSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/Sack', () => ({ SackSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/Calibration', () => ({ CalibrationSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/Summary', () => ({ SummarySection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/ShiftProduction', () => ({ ShiftProductionSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/RejectedCones', () => ({ RejectedConesSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/RejectedSacks', () => ({ RejectedSacksSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/SpsPacking', () => ({ SpsPackingSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/SackWeightRange', () => ({ SackWeightRangeSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/SackWeightSummary', () => ({ SackWeightSummarySection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/RejectedHangers', () => ({ RejectedHangersSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/RejectedUnknownLifter', () => ({ RejectedUnknownLifterSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/MachineProduct', () => ({ MachineProductSection: () => <div data-testid="section" /> }));
vi.mock('../../../../web/src/screens/report/PrintDoc', () => ({ ExecSummary: () => null, PrintNotes: () => null }));

const META = LIVE_FIXTURE.metadata;
const ME = { username: 'test-user', displayName: 'Test User', role: 'manager' } as const;

function header(type: ReportType) {
  return {
    reportType: type,
    title: type,
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
const COVERAGE = { daysWithData: 1, daysInPeriod: 1, complete: true, firstDayWithData: '2026-09-07', lastDayWithData: '2026-09-07' };
const BODY: Record<string, unknown> = {
  shift: { shifts: [{ coverage: COVERAGE }] },
  daily: { shift: null, coverage: COVERAGE, totals: { cones: 10, sacks: 1, sackWeightKg: 47 } },
  'management-summary': { coverage: { current: COVERAGE }, verdict: { cones: 10, sacks: 1, sackWeightKg: 47 } },
  'machine-product': {
    period: {}, filters: {}, columns: [], rows: [{ station: 1, stationName: null, machineName: 'M1', cells: [], cones: 0, materials: 0 }],
    changes: [], products: [], labels: {}, conesWithoutStation: 0, note: '',
  },
};
const reportRoute = (type: ReportType) => ({ data: { header: header(type), report: BODY[type] ?? { coverage: COVERAGE } }, metadata: META });

const STATIONS = { stations: [3, 5].map((n) => ({ stationId: n, name: null, machine: null, description: null })) };
const PRODUCTS = { products: [{ productId: 12, description: '205-IL0-SD', lotCode: null, setpointG: 1960, blend: null, countText: null, tubeType: null, tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag: true, color: null }] };

function routes(extra: Routes = {}): Routes {
  const reports = Object.fromEntries(REPORT_TYPES.map((t) => [`/api/reports/${t}`, reportRoute(t)]));
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 },
    '/api/stations': STATIONS,
    '/api/products': PRODUCTS,
    ...reports,
    ...extra,
  } as Routes;
}

let ff: FakeFetch | null = null;
const go = vi.fn();
function open(query: string, rank: number, extra: Routes = {}) {
  window.history.replaceState(null, '', `/next/?${query}`);
  ff = installFakeFetch(routes(extra));
  const route = parseRoute(new URLSearchParams(query));
  const role = rank >= 4 ? 'admin' : rank === 3 ? 'manager' : rank === 2 ? 'engineer' : 'viewer';
  return render(
    <live.LiveProvider asOf={null}>
      <main id="sh-main">
        <ReportsScreen route={route} rank={rank} user={{ ...ME, role } as never} go={go} />
      </main>
    </live.LiveProvider>,
  );
}
beforeEach(() => go.mockReset());
afterEach(() => {
  cleanup();
  ff?.restore();
  ff = null;
  window.history.replaceState(null, '', '/');
});
installDomStubs();

const requested = (type: string) => (ff?.requests ?? []).some((r) => r.startsWith(`/api/reports/${type}?`));
const exportLinks = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/export"]'));

describe('model: cards, titles, defaults (E-1, E-5)', () => {
  it('the five cards hold all 18 report types, each exactly once', () => {
    expect(CARDS).toHaveLength(5);
    expect([...ALL_TYPES].sort()).toEqual([...REPORT_TYPES].sort());
    expect(new Set(ALL_TYPES).size).toBe(18);
  });

  it('IFL titles are IFL words verbatim (RESERVED), and keep IFL numbering order inside a card', () => {
    for (const [type, title] of Object.entries(RESERVED.iflReportTitles)) expect(variantOf(type as ReportType).title).toBe(title);
    for (const c of CARDS) {
      const nums = c.variants.map((x) => x.ifl).filter((n): n is number => n !== null);
      expect(nums, c.title).toEqual([...nums].sort((a, b) => a - b));
    }
    const all = CARDS.flatMap((c) => c.variants).filter((x) => x.ifl !== null);
    expect(all).toHaveLength(8);
    expect(new Set(all.map((x) => x.ifl)).size).toBe(8);
  });

  it('the default is the management summary from rank 3 and the daily report below', () => {
    expect(defaultType(1)).toBe('daily');
    expect(defaultType(2)).toBe('daily');
    expect(defaultType(3)).toBe('management-summary');
    expect(defaultType(4)).toBe('management-summary');
    expect(typeFromKeys({}, 2)).toBe('daily');
    expect(typeFromKeys({ rt: 'rejected-hangers' }, 2)).toBe('rejected-hangers');
    expect(typeFromKeys({ rt: 'nonsense' }, 3)).toBe('management-summary');
  });

  it('machine and product is empty when no station weighed a cone (E-7)', () => {
    const empty = reportRoute('machine-product').data as never;
    expect(isEmptyReport('machine-product', empty)).toBe(true);
    expect(isEmptyReport('daily', reportRoute('daily').data as never)).toBe(false);
  });
});

describe('every rt is reachable and lands on its own variant', () => {
  for (const t of REPORT_TYPES) {
    it(t, async () => {
      open(`s=reports&rt=${t}`, 3);
      const doc = await screen.findByRole('article', { name: variantOf(t).title });
      expect(doc.getAttribute('data-report-type')).toBe(t);
      await waitFor(() => expect(requested(t)).toBe(true));
    });
  }

  it('each of the 18 reports is a button in its card, and choosing it writes rt', async () => {
    open('s=reports', 3);
    await screen.findByRole('article', { name: 'Management summary' });
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.rp-item'));
    // the summary card lists its one report only when it is locked, so 17 items at rank 3
    expect(items.map((b) => b.querySelector('.rp-item__title')?.textContent)).toHaveLength(17);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(RESERVED.iflReportTitles['rejected-cones']) }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go.mock.calls[0]![0].keys.rt).toBe('rejected-cones');
  });

  it('shows IFL numbers so report N is found by its number', async () => {
    open('s=reports', 3);
    await screen.findByRole('article');
    expect(screen.getByText('IFL report 1')).toBeTruthy();
    expect(screen.getByText('IFL report 8')).toBeTruthy();
    const hanger = screen.getByRole('button', { name: new RegExp(RESERVED.iflReportTitles['rejected-hangers']) });
    expect(within(hanger).getByText('IFL report 7')).toBeTruthy();
  });
});

describe('default report per rank (E-1) and the manager-only summary', () => {
  it('rank 3 opens the management summary', async () => {
    open('s=reports', 3);
    await screen.findByRole('article', { name: 'Management summary' });
    await waitFor(() => expect(requested('management-summary')).toBe(true));
  });

  it('rank 2 opens the daily report and never asks for the summary', async () => {
    open('s=reports', 2);
    await screen.findByRole('article', { name: 'Daily production' });
    await waitFor(() => expect(requested('daily')).toBe(true));
    expect(requested('management-summary')).toBe(false);
    expect(screen.getByText('Needs a manager account')).toBeTruthy();
  });

  it('a legacy summary link at rank 2 says it needs a manager account instead of a blank page', async () => {
    open('s=reports&rt=management-summary', 2);
    await screen.findByRole('article', { name: 'Management summary' });
    expect(screen.getByText(/only for managers|for managers and above/i)).toBeTruthy();
    expect(requested('management-summary')).toBe(false);
  });
});

describe('downloads: rank 3, absent below, disabled until the report arrives (A5-19)', () => {
  it('rank 2 has Preview and Print but no download of any format', async () => {
    open('s=reports&rt=daily', 2);
    await screen.findByRole('article', { name: 'Daily production' });
    await waitFor(() => expect(requested('daily')).toBe(true));
    expect(exportLinks()).toHaveLength(0);
    expect(document.querySelector('.rp-exports')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
    expect(screen.getByText(/Downloads are for managers and admins/)).toBeTruthy();
  });

  it('rank 3 gets PDF, Excel and CSV links on the same query as the preview, once the report is loaded', async () => {
    let release: () => void = () => {};
    open('s=reports&rt=daily', 3, { '/api/reports/daily': () => new Promise((r) => { release = () => r(reportRoute('daily')); }) });
    const group = await screen.findByRole('group', { name: 'Download' });
    expect(within(group).getAllByRole('button', { name: /PDF|Excel|CSV/ })).toHaveLength(3);
    expect(within(group).getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(exportLinks()).toHaveLength(0);
    await waitFor(() => expect(requested('daily')).toBe(true));
    release();
    await waitFor(() => expect(exportLinks()).toHaveLength(3));
    const hrefs = exportLinks().map((a) => a.getAttribute('href')!);
    expect(hrefs.every((h) => h.startsWith('/api/reports/daily/export?'))).toBe(true);
    expect(hrefs.some((h) => h.includes('format=pdf'))).toBe(true);
    expect(hrefs.some((h) => h.includes('format=xlsx'))).toBe(true);
    expect(hrefs.some((h) => !h.includes('format='))).toBe(true);
    const base = hrefs.find((h) => !h.includes('format='))!;
    expect(hrefs.find((h) => h.includes('format=pdf'))).toBe(`${base}&format=pdf`);
    const asked = (ff!.requests.find((r) => r.startsWith('/api/reports/daily?')) ?? '').split('?')[1];
    expect(base.split('?')[1]).toBe(asked);
  });

  it('a merged type keeps its own export (rt=shift exports the shift report)', async () => {
    open('s=reports&rt=shift', 3);
    await waitFor(() => expect(exportLinks()).toHaveLength(3));
    expect(exportLinks()[0]!.getAttribute('href')).toContain('/api/reports/shift/export?');
  });
});

describe('print hook (E-6)', () => {
  it('puts report-print on the shell main while mounted and takes it off after', async () => {
    const { unmount } = open('s=reports&rt=daily', 3);
    const main = document.querySelector('main#sh-main')!;
    expect(main.classList.contains('report-print')).toBe(true);
    await screen.findByRole('article');
    unmount();
    expect(main.classList.contains('report-print')).toBe(false);
  });
});

describe('empty and failed periods say so', () => {
  it('machine and product with no cones on any station is an empty report, not "0 machines, 0 products" (E-7)', async () => {
    open('s=reports&rt=machine-product', 3);
    expect(await screen.findByText('No cones were weighed on any station in this period.')).toBeTruthy();
    expect(screen.queryByTestId('section')).toBeNull();
    expect(document.body.textContent).not.toMatch(/0 machines/);
  });

  it('a period after the newest reading names when the newest reading is (X-3)', async () => {
    // The newest reading is six days older than the plant clock, so "Today" starts after it.
    const stale = JSON.parse(JSON.stringify(LIVE_FIXTURE));
    stale.data.lines[0].dataAsOfUtc = '2026-09-01T10:00:00Z';
    open('s=reports&rt=machine-product&p=today', 3, { '/api/live': stale });
    await screen.findByRole('article');
    await waitFor(() => expect(document.querySelector('.rp-paper')!.textContent).toMatch(/the newest reading is/i));
    expect(screen.queryByTestId('section')).toBeNull();
  });

  it('a failed fetch names the report that failed and offers Try again', async () => {
    open('s=reports&rt=daily', 3, { '/api/reports/daily': () => { throw new Error('down'); } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load the Daily production report.");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a failed station list is named in the builder, not silently dropped', async () => {
    open('s=reports&rt=rejected-cones', 3, { '/api/stations': () => { throw new Error('down'); } });
    expect(await screen.findByText(/station list could not be read/)).toBeTruthy();
  });
});

describe('builder filters follow the report type (A5-26)', () => {
  it('offers station and product only where the type takes them, and writes the shared keys', async () => {
    open('s=reports&rt=reject', 3);
    const station = await screen.findByLabelText('Station');
    expect(screen.getByLabelText('Product')).toBeTruthy();
    fireEvent.change(station, { target: { value: '5' } });
    expect(go.mock.calls.at(-1)![0].keys.st).toBe('5');
  });

  it('a type that takes no filter offers none', async () => {
    open('s=reports&rt=cone-weight', 3);
    await screen.findByRole('article', { name: 'Cone weight' });
    expect(screen.queryByLabelText('Station')).toBeNull();
    expect(screen.queryByLabelText('Product')).toBeNull();
    expect(screen.queryByLabelText('Shift')).toBeNull();
  });
});
