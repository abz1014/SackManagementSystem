/**
 * Product › Running — regression test for a defect class recorded in
 * `lib/productLabel.ts`'s own header comment: PDAS holds several products
 * that share one plain description ("205-IL0-SD" is six materials on this
 * line, differing by blend/count/tube/colour — first found on Rejects'
 * product filter, 15 Sep 2026). `distinctProductLabels()` exists to fix
 * this; the defect reappeared on 21 Sep 2026 because Line and Product ›
 * Running's own product groupings printed `machinesRunning`'s raw
 * `productName` (a plain COALESCE of description/lot_code) instead of
 * running it through that disambiguator, so the pivot whose entire purpose
 * is grouping BY product rendered several identical headings.
 *
 * This mounts `RunningTab` (no `<App/>`, no `useLive` — this screen never
 * calls it) against three materials that share a description and asserts
 * the "products in force now" headings are genuinely distinct text, never
 * the bare colliding description repeated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { META_FIXTURE, GENERATION_FIXTURE } from '../../testkit/fixtures';
import type { Period } from '../../lib/period';
import type { Envelope, MachinesRunningData, ProductOption, ProductAtData } from '../../api';
import { RunningTab } from './Running';

// `fetchRouter.ts`'s own contract: "a test that installs its own router must
// restore it itself ... or rely on Vitest's own vi.unstubAllGlobals() in a
// project-wide afterEach, which this repo does not configure." This file
// calls installFakeFetch() fresh inside every `it()` without ever restoring
// it (found during the D-7 flake hunt, DEFECTS.md — not itself the D-7
// mechanism, but a real violation of the same contract). Harmless today
// because each `it()` reinstalls a full route set before rendering, but a
// stacked, never-restored fake fetch is exactly the kind of latent
// cross-test contamination that race was hard to diagnose because of.
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

const SHARED_DESC = '205-IL0-SD';

// Three of the six real PDAS materials that share this description
// (CLAUDE.md, 21 Sep 2026 section: ids 20, 21, 1021, 1022, 1023, 1024) —
// enough to prove the collision and the fix without transcribing all six.
const PRODUCTS: ProductOption[] = [
  { productId: 20, description: SHARED_DESC, lotCode: null, setpointG: null, blend: 'Blend A', countText: '20s', tubeType: 'PP', tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag: true, color: 'PARROT' },
  { productId: 21, description: SHARED_DESC, lotCode: null, setpointG: null, blend: 'Blend A', countText: '20s', tubeType: 'PP', tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag: true, color: 'Khaki-2' },
  { productId: 1021, description: SHARED_DESC, lotCode: null, setpointG: null, blend: 'Blend B', countText: '30s', tubeType: 'Paper', tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag: true, color: 'PARROT' },
];

const MACHINES: Envelope<MachinesRunningData> = {
  data: {
    asOfUtc: '2026-09-21T14:00:00Z',
    windowMs: 7_200_000,
    windowStartUtc: '2026-09-21T12:00:00Z',
    materialsRunning: 3,
    generation: GENERATION_FIXTURE,
    machines: [
      { station: 1, stationName: 'S1', machineName: 'M1', materialId: 20, productName: SHARED_DESC, cones: 40, conesOnMaterial: 40, newestUtc: '2026-09-21T13:59:00Z', sinceUtc: '2026-09-21T12:05:00Z', sinceIsWindowStart: false, quiet: false, lastSeenUtc: '2026-09-21T13:59:00Z', state: 'running' },
      { station: 2, stationName: 'S2', machineName: 'M2', materialId: 21, productName: SHARED_DESC, cones: 30, conesOnMaterial: 30, newestUtc: '2026-09-21T13:58:00Z', sinceUtc: '2026-09-21T12:05:00Z', sinceIsWindowStart: false, quiet: false, lastSeenUtc: '2026-09-21T13:58:00Z', state: 'running' },
      { station: 3, stationName: 'S3', machineName: 'M3', materialId: 1021, productName: SHARED_DESC, cones: 20, conesOnMaterial: 20, newestUtc: '2026-09-21T13:57:00Z', sinceUtc: '2026-09-21T12:05:00Z', sinceIsWindowStart: false, quiet: false, lastSeenUtc: '2026-09-21T13:57:00Z', state: 'running' },
    ],
  },
  metadata: META_FIXTURE,
};

describe('Product › Running — "products in force now" headings', () => {
  it('are distinct when several running materials share one PDAS description', async () => {
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
      const headings = [...container.querySelectorAll('p')].filter((p) => (p.textContent ?? '').startsWith(SHARED_DESC));
      expect(headings.length).toBe(3);
    });

    const headingTexts = [...container.querySelectorAll('p')]
      .filter((p) => (p.textContent ?? '').startsWith(SHARED_DESC))
      .map((p) => p.textContent);

    // The defect: all three would read the identical "205-IL0-SD". The fix:
    // each is distinguishable, and none is the bare colliding description.
    expect(new Set(headingTexts).size).toBe(3);
    for (const t of headingTexts) expect(t).not.toBe(SHARED_DESC);
  });
});

// Task #8 (24 Sep 2026): `groupByProduct` only ever lists machines running
// inside the window — a quiet, stale or silent machine used to be invisible
// on this screen entirely. It now gets its own section, graded the same way
// Line's MachinesBlock grades it (`machineStateText`).
describe('Product › Running — machines not currently running', () => {
  it('lists a quiet machine under "Not currently running" with its graded state, beside the running ones', async () => {
    const machinesWithOneQuiet: Envelope<MachinesRunningData> = {
      data: {
        ...MACHINES.data,
        machines: [
          ...MACHINES.data.machines,
          {
            station: 4, stationName: 'S4', machineName: 'M4', materialId: null, productName: null,
            cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: false,
            quiet: true, lastSeenUtc: '2026-09-18T14:00:00Z', state: 'stale',
          },
        ],
      },
      metadata: META_FIXTURE,
    };
    installFakeFetch({
      '/api/product-at': PRODUCT_AT,
      '/api/products': { products: PRODUCTS },
      '/api/machines/running': machinesWithOneQuiet,
      '/api/stations': { stations: [] },
      '/api/current-product': { current: null },
    });

    const { findByText, container } = render(
      <RunningTab period={PERIOD} canWrite={false} onOpenStation={noop} onSeeStationReadings={noop} />,
    );

    await findByText('Station 4');
    expect(container.textContent ?? '').toContain('Not seen since Fri 18 Sept');
  });
});
