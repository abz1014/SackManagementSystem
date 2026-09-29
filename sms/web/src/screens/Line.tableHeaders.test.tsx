/**
 * Accessibility fix (29 Sep 2026): Line's two tables — MachinesBlock (what
 * each machine is running) and the last-sack/last-cone quick-link table —
 * had no <thead>/<th> at all, so screen-reader users got no column context.
 * Fixed with an sr-only header row (this design shows no visible header on
 * any table, matching the report tables' own "headerless when the design
 * says so" convention) and a proper <th scope="row"> for each row's station/
 * record label. This locks down that every column now has an accessible
 * name, and that the row actions (opening a station / a reading) still work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { LineScreen } from './Line';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD = {
  key: 'shift' as const,
  from: '2026-09-07',
  to: '2026-09-07',
  tsTo: '2026-09-07T23:59:59.000Z',
  live: true,
  days: 1,
};

const BASE_ROUTES = {
  '/api/live': LIVE_FIXTURE,
  '/api/stations': { stations: [] },
  '/api/product-at': { product: null, limits: null, neverRecorded: true },
  '/api/products': { products: [] },
  '/api/attention': {
    data: {
      window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
      period: { from: '2026-09-07', to: '2026-09-07', shift: null },
      findings: [], totalFindings: 0, thresholds: { driftG: 15, minDaysHeld: 3 },
    },
    metadata: LIVE_FIXTURE.metadata,
  },
  '/api/production': {
    data: { groupBy: 'none', rows: [], unattributed: null, states: null, implausible: null, dataIssues: [] },
    metadata: LIVE_FIXTURE.metadata,
  },
  '/api/machines/running': {
    data: {
      asOfUtc: '2026-09-07T16:40:00Z',
      windowMs: 7_200_000,
      windowStartUtc: '2026-09-07T14:40:00Z',
      machines: [{
        station: 1, stationName: null, machineName: null, materialId: null, productName: null,
        cones: 12, conesOnMaterial: 12, newestUtc: '2026-09-07T16:39:00Z', sinceUtc: '2026-09-07T14:41:00Z',
        sinceIsWindowStart: false, quiet: false,
      }],
      materialsRunning: 1,
      generation: LIVE_FIXTURE.data.lines[0]!.generation,
    },
    metadata: LIVE_FIXTURE.metadata,
  },
};

describe('Line — MachinesBlock table has an accessible header', () => {
  it('exposes Station and Activity as column headers, and the row still opens the station', async () => {
    const onOpenStation = vi.fn();
    installFakeFetch(BASE_ROUTES);
    const { findByRole, getAllByRole } = renderWithLive(
      <LineScreen
        period={PERIOD}
        onNavigate={() => {}}
        onOpenStation={onOpenStation}
        onOpenReading={() => {}}
        onOpenProduct={() => {}}
        canWrite={false}
      />,
    );

    const stationHeader = await findByRole('columnheader', { name: W.cone.colStation });
    expect(await findByRole('columnheader', { name: W.cone.colActivity })).toBeTruthy();

    // Scope to MachinesBlock's own table (the page has a second table, the
    // last-sack/last-cone one, with its own row headers).
    const table = stationHeader.closest('table')!;
    const rowHeader = within(table).getByRole('rowheader');
    expect(rowHeader.closest('tr')).toBeTruthy();
    fireEvent.click(rowHeader.closest('tr')!);
    expect(onOpenStation).toHaveBeenCalledWith(1);

    const headers = getAllByRole('columnheader');
    expect(headers.some((h) => table.contains(h))).toBe(true);
  });
});

describe('Line — last sack / last cone table has an accessible header', () => {
  it('exposes Record and Details as column headers, and a row still opens the reading', async () => {
    const onOpenReading = vi.fn();
    installFakeFetch(BASE_ROUTES);
    const { findByRole, getAllByText } = renderWithLive(
      <LineScreen
        period={PERIOD}
        onNavigate={() => {}}
        onOpenStation={() => {}}
        onOpenReading={onOpenReading}
        onOpenProduct={() => {}}
        canWrite={false}
      />,
    );

    expect(await findByRole('columnheader', { name: W.cone.colRecord })).toBeTruthy();
    expect(await findByRole('columnheader', { name: W.cone.colDetails })).toBeTruthy();

    const lastSackCell = getAllByText(W.lastSack)[0]!;
    expect(lastSackCell.tagName).toBe('TH');
    fireEvent.click(lastSackCell.closest('tr')!);
    expect(onOpenReading).toHaveBeenCalledWith('sack', LIVE_FIXTURE.data.lines[0]!.lastSack!.eventId);
  });
});
