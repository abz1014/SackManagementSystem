/**
 * RT-018 (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md), fixed 25 Sep 2026: a
 * product PDAS has retired (`MaterialActive = 0`) used to render on Product
 * › Running as a plain, unflagged "running" heading — real data confirms
 * this can happen (MaterialId 17 is retired in PDAS on the dev copy, yet
 * still carries a production row). This asserts the retired marker
 * (`W.retiredProduct.marker`) renders beside the heading when `/api/products`
 * reports `activeFlag: false` for the material `/api/machines/running` names,
 * and does NOT render for an active one — the same fixture shape
 * `Running.test.tsx` already uses, with one material's `activeFlag` flipped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { META_FIXTURE, GENERATION_FIXTURE } from '../../testkit/fixtures';
import type { Period } from '../../lib/period';
import type { Envelope, MachinesRunningData, ProductOption, ProductAtData } from '../../api';
import { RunningTab } from './Running';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift', from: '2026-09-21', to: '2026-09-21',
  tsFrom: '2026-09-21T06:00:00Z', tsTo: '2026-09-21T14:00:00Z',
  shift: 'morning', live: true, days: 1,
};

function noop(): void {}

const PRODUCT_AT: ProductAtData = {
  at: '2026-09-21T14:00:00Z', product: null, limits: null, neverRecorded: true,
  attribution: null, verdict: null, limitsAreLowerBound: false,
};

// Material 17 mirrors the real dev-copy fact this fix is based on: retired
// in PDAS (`MaterialActive = 0`, mirrored to `sms.product.active_flag`),
// still carrying a production row. Material 18 is its active neighbour, to
// prove the marker is per-product, not a blanket "something is retired" flag.
const PRODUCTS: ProductOption[] = [
  { productId: 17, description: 'STR-RED', lotCode: null, setpointG: 1950, blend: 'Blend A', countText: '20s', tubeType: 'PP', tubeWeightG: null, weightOffsetMinusG: 30, weightOffsetPlusG: 30, activeFlag: false, color: null },
  { productId: 18, description: 'STR-BLUE', lotCode: null, setpointG: 1960, blend: 'Blend A', countText: '20s', tubeType: 'PP', tubeWeightG: null, weightOffsetMinusG: 30, weightOffsetPlusG: 30, activeFlag: true, color: null },
];

const MACHINES: Envelope<MachinesRunningData> = {
  data: {
    asOfUtc: '2026-09-21T14:00:00Z', windowMs: 7_200_000, windowStartUtc: '2026-09-21T12:00:00Z',
    materialsRunning: 2, generation: GENERATION_FIXTURE,
    machines: [
      { station: 1, stationName: 'S1', machineName: 'M1', materialId: 17, productName: 'STR-RED', productActive: false, cones: 40, conesOnMaterial: 40, newestUtc: '2026-09-21T13:59:00Z', sinceUtc: '2026-09-21T12:05:00Z', sinceIsWindowStart: false, quiet: false, lastSeenUtc: '2026-09-21T13:59:00Z', state: 'running' },
      { station: 2, stationName: 'S2', machineName: 'M2', materialId: 18, productName: 'STR-BLUE', productActive: true, cones: 30, conesOnMaterial: 30, newestUtc: '2026-09-21T13:58:00Z', sinceUtc: '2026-09-21T12:05:00Z', sinceIsWindowStart: false, quiet: false, lastSeenUtc: '2026-09-21T13:58:00Z', state: 'running' },
    ],
  },
  metadata: META_FIXTURE,
};

describe('Product › Running — RT-018 retired-product marker', () => {
  it('marks a retired material as the running target and does not mark an active one', async () => {
    installFakeFetch({
      '/api/product-at': PRODUCT_AT,
      '/api/products': { products: PRODUCTS },
      '/api/machines/running': MACHINES,
      '/api/stations': { stations: [] },
      '/api/current-product': { current: null },
    });

    const { container } = render(
      <RunningTab period={PERIOD} canWrite={false} onOpenStation={noop} onSeeStationReadings={noop} />,
    );

    await waitFor(() => {
      expect(container.textContent ?? '').toContain('STR-RED');
    });

    const headings = [...container.querySelectorAll('p')];
    const retiredHeading = headings.find((p) => (p.textContent ?? '').includes('STR-RED'))!;
    const activeHeading = headings.find((p) => (p.textContent ?? '').includes('STR-BLUE'))!;
    expect(retiredHeading.textContent).toContain('retired in PDAS');
    expect(activeHeading.textContent).not.toContain('retired in PDAS');
    // The one-sentence prompt (words.ts `retiredProduct.stillRunning`) appears once, for the retired product only.
    expect(container.textContent).toContain('still being produced');
  });
});
