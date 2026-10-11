/**
 * S3 F-1 (Stage 3, 11 Oct 2026): Product > Running says what a winder that is not running last stamped.
 *
 * User impact: a quiet, stale or silent winder was listed with only "No cones for ..." and no product, so a
 * reader could not tell which product a stopped winder had last produced. Values are synthetic copies of the
 * real winder 14 (stale, product 1022, last cone 3 Sep). Runs in jsdom with a faked fetch, no session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { META_FIXTURE, GENERATION_FIXTURE } from '../../testkit/fixtures';
import type { Period } from '../../lib/period';
import type { Envelope, MachineRunning, MachinesRunningData, ProductOption, ProductAtData } from '../../api';
import { RunningTab } from './Running';

afterEach(() => vi.unstubAllGlobals());

const PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07', tsFrom: '2026-09-07T06:00:00Z', tsTo: '2026-09-07T14:00:00Z',
  shift: 'morning', live: true, days: 1,
};
const PRODUCT_AT: ProductAtData = {
  at: '2026-09-07T12:00:00Z', product: null, limits: null, neverRecorded: true, attribution: null, verdict: null, limitsAreLowerBound: false,
};
const prod = (productId: number, color: string, activeFlag = true): ProductOption => ({
  productId, description: '205-IL0-SD', lotCode: null, setpointG: null, blend: 'Blend A', countText: '20s', tubeType: 'PP',
  tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag, color,
});
const PRODUCTS = [prod(21, 'Khaki-2'), prod(1022, 'Olive')];

const quiet = (station: number, extra: Partial<MachineRunning>): MachineRunning => ({
  station, stationName: `S${station}`, machineName: null, materialId: null, productName: null, cones: 0, conesOnMaterial: 0,
  newestUtc: null, sinceUtc: null, sinceIsWindowStart: false, quiet: true, lastSeenUtc: null, state: 'quiet', ...extra,
});
const MACHINES: Envelope<MachinesRunningData> = {
  data: {
    asOfUtc: '2026-09-07T12:00:28.860Z', windowMs: 7_200_000, windowStartUtc: '2026-09-07T10:00:28.860Z', materialsRunning: 1,
    generation: GENERATION_FIXTURE,
    machines: [
      { station: 4, stationName: 'S4', machineName: null, materialId: 21, productName: '205-IL0-SD', cones: 40, conesOnMaterial: 40,
        newestUtc: '2026-09-07T12:00:28.860Z', sinceUtc: '2026-09-07T10:30:00Z', sinceIsWindowStart: false, quiet: false,
        lastSeenUtc: '2026-09-07T12:00:28.860Z', state: 'running' },
      quiet(7, { lastSeenUtc: '2026-09-07T03:47:21.277Z', state: 'quiet', lastMaterialId: 21, lastProductName: '205-IL0-SD', lastProductActive: true, lastStampedUtc: '2026-09-07T03:47:21.277Z' }),
      quiet(14, { lastSeenUtc: '2026-09-03T13:55:55.723Z', state: 'stale', lastMaterialId: 1022, lastProductName: '205-IL0-SD', lastProductActive: true, lastStampedUtc: '2026-09-03T13:55:55.723Z' }),
      quiet(15, { lastSeenUtc: '2026-09-01T01:00:00Z', state: 'stale', lastMaterialId: null, lastProductName: null, lastProductActive: null, lastStampedUtc: null }),
    ],
  },
  metadata: META_FIXTURE,
};

describe('Product > Running - last product of a winder that is not running', () => {
  it('prints the last stamped product and its cone time for each quiet or stale winder, and the thresholds once', async () => {
    installFakeFetch({
      '/api/product-at': PRODUCT_AT,
      '/api/products': { products: PRODUCTS },
      '/api/machines/running': MACHINES,
      '/api/stations': { stations: [] },
      '/api/current-product': { current: null },
    });
    const { findByText, container } = render(
      <RunningTab period={PERIOD} canWrite={false} onOpenStation={() => {}} onSeeStationReadings={() => {}} />,
    );
    await findByText('Station 14');
    const text = container.textContent ?? '';
    expect(text.match(/Last product it stamped/g)?.length).toBe(2);
    expect(text).toContain('last cone 1:55 PM, Thu 3 Sept');
    expect(text).toContain('last cone 3:47 AM, Mon 7 Sept');
    expect(text).toContain('No product recorded on its cones');
    expect(text.match(/Running means a cone within 2 hours of the newest reading/g)?.length).toBe(1);
    // The two products share one PDAS description, so the sentence must carry the disambiguated label, not the bare one.
    expect(text).not.toContain('Last product it stamped: 205-IL0-SD,');
  });
});
