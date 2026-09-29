/**
 * Re-audit fix (29 Sep 2026): the batch/simulator disclosure — IFL's Report
 * screen names `generationLine` / `spansGenerations` / `otherGenerationExcluded`
 * / `simulatorSource` on the header — used to be printed ONLY inside
 * `PrintHead`'s `.print-head`, which is `display: none` on screen (app.css).
 * A daily report spanning two IFL batches, excluding tens of thousands of
 * readings, said nothing about it anywhere a reader looking at the screen
 * (rather than a printed page) would ever see. `GenerationDisclosure`
 * (screens/report/PrintHead.tsx) now renders the same sentence on screen,
 * near the headline, exactly once, gated by the same
 * `spansGenerations || simulatorSource` rule PrintHead's own print copy uses.
 *
 * Harness mirrors Report.export.test.tsx: every section is stubbed to a
 * trivial marker since this test is about the disclosure line, not any
 * section's content.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import type { AuthUser, ReportFilters, ReportHeader } from '../api';
import { ReportScreen } from './Report';

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
  key: 'range',
  from: '2026-07-05',
  to: '2026-08-10',
  tsFrom: '2026-07-05T00:00:00Z',
  tsTo: '2026-08-10T23:59:59Z',
  live: true,
  days: 37,
};

function baseHeader(): ReportHeader {
  return {
    reportType: 'daily',
    title: 'Daily',
    lineName: 'TP1 Line 3',
    plantName: null,
    unitName: null,
    period: { period: 'custom', from: '2026-07-05', to: '2026-08-10', days: 37 },
    filters: {},
    generatedAtPlantUtc: '2026-08-10T12:00:00Z',
    generatedBy: 'test-user',
    smsVersion: '0.0.0-test',
    definitions: 'KPI-DEFINITIONS.md',
    approval: 'awaiting',
    spansGenerations: false,
    sourceGeneration: 'SEP07',
    otherGenerationExcluded: null,
  };
}

function dailyBody() {
  return { shift: null, coverage: { daysWithData: 37, daysInPeriod: 37, complete: true, firstDayWithData: '2026-07-05', lastDayWithData: '2026-08-10' } };
}

function user(role: string): AuthUser {
  return { username: 'test-user', displayName: 'Test User', role };
}

function baseProps(overrides: Partial<Parameters<typeof ReportScreen>[0]> = {}) {
  return {
    period: PERIOD,
    user: user('manager'),
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

function routes(header: ReportHeader) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/stations': { stations: [] },
    '/api/products': { products: [] },
    '/api/reports/daily': { data: { header, report: dailyBody() }, metadata: {} },
  };
}

describe('Report screen — on-screen batch/simulator disclosure (re-audit fix, 29 Sep 2026)', () => {
  it('a period spanning two IFL batches shows the disclosure sentence on screen', async () => {
    const header = {
      ...baseHeader(),
      spansGenerations: true,
      sourceGeneration: 'SEP07',
      otherGenerationExcluded: { count: 43057, percent: 62.3 },
      generationLine: 'This report spans two IFL data batches. 43,057 readings (62.3%) from the other batch are excluded.',
    };
    installFakeFetch(routes(header));
    const { findByRole, container } = renderWithLive(<ReportScreen {...baseProps()} />);

    await findByRole('heading', { level: 1 });
    // The on-screen disclosure is the `.mut.sm.no-print` paragraph
    // `GenerationDisclosure` renders — deliberately NOT `.ph-foot` (that is
    // `PrintHead`'s own copy, invisible on screen via `.print-head`'s
    // `display: none`) and NOT the print-only `PrintNotes` `<li>` (visible
    // only under `.print-only`), so this asserts the ON-SCREEN copy exists,
    // not merely that the sentence appears somewhere in the DOM.
    const onScreen = container.querySelector('.mut.sm.no-print');
    expect(onScreen?.textContent).toBe(header.generationLine);
  });

  it('a simulator-only period shows the disclosure sentence even though spansGenerations is false', async () => {
    const header = {
      ...baseHeader(),
      spansGenerations: false,
      simulatorSource: true,
      sourceGeneration: 'SIM',
      otherGenerationExcluded: null,
      generationLine: 'This report is built from the plant simulator, not real production data.',
    };
    installFakeFetch(routes(header));
    const { findByRole, container } = renderWithLive(<ReportScreen {...baseProps()} />);

    await findByRole('heading', { level: 1 });
    const onScreen = container.querySelector('.mut.sm.no-print');
    expect(onScreen?.textContent).toBe(header.generationLine);
  });

  it('a single real batch shows no disclosure sentence at all', async () => {
    const header = baseHeader(); // spansGenerations: false, no simulatorSource
    installFakeFetch(routes(header));
    const { findByRole, container } = renderWithLive(<ReportScreen {...baseProps()} />);

    await findByRole('heading', { level: 1 });
    expect(container.querySelector('.mut.sm.no-print')).toBeNull();
  });
});
