/**
 * Accessibility fix (29 Sep 2026): Product › Running's two machine tables
 * (products running now, and machines not currently running) had no
 * <thead>/<th> at all, so screen-reader users got no column context. Fixed
 * with an sr-only header row (this design shows no visible header on any
 * table) and a proper <th scope="row"> for each row's station cell. This
 * locks down that every column now has an accessible name, and that the
 * row click (open that station) still works.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { META_FIXTURE, GENERATION_FIXTURE } from '../../testkit/fixtures';
import type { Period } from '../../lib/period';
import type { Envelope, MachinesRunningData, ProductOption, ProductAtData } from '../../api';
import { W } from '../../lib/words';
import { RunningTab } from './Running';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-21',
  to: '2026-09-21',
  tsFrom: '2026-09-21T06:00:00Z',
  tsTo: '2026-09-21T14:00:00Z',
  shift: 'morning',
  live: true,
  days: 1,
};

function noop(): void {}

const PRODUCT_AT: ProductAtData = {
  at: '2026-09-21T14:00:00Z',
  product: null,
  limits: null,
  neverRecorded: true,
  attribution: null,
  verdict: null,
  limitsAreLowerBound: false,
};

const PRODUCTS: ProductOption[] = [
  { productId: 20, description: '205-IL0-SD', lotCode: null, setpointG: null, blend: 'Blend A', countText: '20s', tubeType: 'PP', tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag: true, color: 'PARROT' },
];

const MACHINES: Envelope<MachinesRunningData> = {
  data: {
    asOfUtc: '2026-09-21T14:00:00Z',
    windowMs: 7_200_000,
    windowStartUtc: '2026-09-21T12:00:00Z',
    materialsRunning: 1,
    generation: GENERATION_FIXTURE,
    machines: [
      { station: 1, stationName: 'S1', machineName: 'M1', materialId: 20, productName: '205-IL0-SD', cones: 40, conesOnMaterial: 40, newestUtc: '2026-09-21T13:59:00Z', sinceUtc: '2026-09-21T12:05:00Z', sinceIsWindowStart: false, quiet: false, lastSeenUtc: '2026-09-21T13:59:00Z', state: 'running' },
      { station: 4, stationName: 'S4', machineName: 'M4', materialId: null, productName: null, cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: false, quiet: true, lastSeenUtc: '2026-09-18T14:00:00Z', state: 'stale' },
    ],
  },
  metadata: META_FIXTURE,
};

function routes() {
  return {
    '/api/product-at': PRODUCT_AT,
    '/api/products': { products: PRODUCTS },
    '/api/machines/running': MACHINES,
    '/api/stations': { stations: [] },
    '/api/current-product': { current: null },
  };
}

describe('Product › Running — "products in force now" table has an accessible header', () => {
  it('exposes Station, Activity and Readings as column headers, and the row opens the station', async () => {
    installFakeFetch(routes());
    const onOpenStation = vi.fn();
    const { findByRole, getAllByRole } = render(
      <RunningTab period={PERIOD} canWrite={false} onOpenStation={onOpenStation} onSeeStationReadings={noop} />,
    );

    // Anchor on "Activity", which is unique to this table — "Station" is
    // also a column header on the "not currently running" table below.
    const activityHeader = await findByRole('columnheader', { name: W.cone.colActivity });
    const table = activityHeader.closest('table')!;
    expect(within(table).getByRole('columnheader', { name: W.cone.colStation })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.nav.readings })).toBeTruthy();

    const rowHeader = within(table).getByRole('rowheader');
    expect(rowHeader.tagName).toBe('TH');
    fireEvent.click(rowHeader.closest('tr')!);
    expect(onOpenStation).toHaveBeenCalledWith(1);

    // Sanity: this table's headers are exactly its own three, not stray
    // headers pulled in from the "not currently running" table below.
    expect(within(table).getAllByRole('columnheader').length).toBe(3);
    expect(getAllByRole('columnheader').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Product › Running — "not currently running" table has an accessible header', () => {
  it('exposes Station and State as column headers, and the row opens the station', async () => {
    installFakeFetch(routes());
    const onOpenStation = vi.fn();
    const { findByText, getAllByRole } = render(
      <RunningTab period={PERIOD} canWrite={false} onOpenStation={onOpenStation} onSeeStationReadings={noop} />,
    );

    await waitFor(async () => {
      expect(await findByText(W.machineState.notRunning)).toBeTruthy();
    });

    // Two tables share the "Station" header text; the second table (this
    // one) is the one with a "State" header, not "Activity"/"Readings".
    const stateHeaders = getAllByRole('columnheader', { name: W.cone.colState });
    expect(stateHeaders.length).toBe(1);
    const table = stateHeaders[0]!.closest('table')!;
    expect(within(table).getByRole('columnheader', { name: W.cone.colStation })).toBeTruthy();
    expect(within(table).getAllByRole('columnheader').length).toBe(2);

    const rowHeader = within(table).getByRole('rowheader');
    expect(rowHeader.tagName).toBe('TH');
    fireEvent.click(rowHeader.closest('tr')!);
    expect(onOpenStation).toHaveBeenCalledWith(4);
  });
});
