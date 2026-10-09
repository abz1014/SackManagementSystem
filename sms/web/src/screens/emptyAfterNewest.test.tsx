/**
 * S3 X-3 (Stage 3, 9 Oct 2026). User impact: on a screen whose period lies after the newest reading on record the
 * empty sentence ("No cones were weighed in this period.", "Nothing was weighed ...") read as "the line made nothing".
 * It now says that no readings exist in this period and names the newest reading. A period that is not after the
 * newest reading keeps the old sentence, byte for byte. Weight, Readings, Sacks and Rejects are checked here; Line
 * and Report are checked in layout-tests/s3-x3-empty-after-newest.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { resolvePeriod, type PeriodAnchor } from '../lib/period';
import type { Envelope, LiveData, ProductionData, SackSummaryData, SpcData, WeightStationsData } from '../api';
import { WeightScreen } from './Weight';
import { ReadingsScreen } from './Readings';
import { SacksScreen } from './Sacks';
import { RejectsScreen } from './Rejects';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

/** The plant clock is on 8 Oct; the newest reading is 7 Sep 16:41 (LIVE_FIXTURE.dataAsOfUtc). */
const LIVE_OCT: Envelope<LiveData> = {
  ...LIVE_FIXTURE,
  data: { lines: [{ ...LIVE_FIXTURE.data.lines[0]!, plantNowUtc: '2026-10-08T10:00:00Z' }] },
};
const ANCHOR: PeriodAnchor = {
  shiftDate: '2026-10-08', shiftCode: 'morning', shiftStartUtc: '2026-10-08T06:00:00.000Z',
  plantNowUtc: '2026-10-08T10:00:00.000Z', dataAsOfUtc: '2026-09-07T16:41:00Z', firstDay: '2026-08-05',
};
const AFTER = resolvePeriod('pick', ANCHOR, { from: '2026-10-08', to: '2026-10-08' });
const INSIDE = resolvePeriod('pick', ANCHOR, { from: '2026-09-07', to: '2026-09-07' });
const QUALIFIED = 'No readings in this period — the newest reading is 4:41 PM, 7 Sep.';

/* ------------------------------------------------------------------ Weight */

const SPC_EMPTY = {
  data: {
    specAgreement: null, type: 'cone', unit: 'g', station: null, implausible: 0, count: 0, mean: 0, median: null,
    stdevOverall: 0, stdevWithin: 0, bucketMinutes: 30, bucketLabel: '30-minute', grandMean: 0, sChartCenter: 0,
    xbarOutOfControl: 0, nelsonFlagged: 0, subgroups: [], stations: [], practicalThresholdG: 5,
    distinguishableStationCount: 0, flaggedStationCount: 0, histogram: [],
    spec: { usl: null, lsl: null, nominal: null, source: 'none' },
    capability: { cp: null, cpk: null, pp: null, ppk: null },
    generation: null, otherGenerationExcluded: 0, spansGenerations: false,
    xLimits: { valid: true, mrBar: 2.5, sigmaBetween: 2.2, halfWidth: 6.6, pairs: 400 },
  } as unknown as SpcData,
  metadata: META_FIXTURE,
};
const WEIGHT_STATIONS_EMPTY: Envelope<WeightStationsData> = {
  data: {
    from: '2026-08-24', to: '2026-09-07', days: 14, lineMeanG: null, targetG: null, productId: null, productLabel: null,
    thresholdG: 5, minDaysHeld: 3, lineRejectRatePct: null, stations: [],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 0, unjudged: 0 },
    limits: null, rules: [], targetEffectiveFromUtc: null, limitsChangedInWindow: 0, productChangesInWindow: 0,
  } as unknown as WeightStationsData,
  metadata: META_FIXTURE,
};
const PRODUCTION_EMPTY: Envelope<ProductionData> = {
  data: { groupBy: 'none', rows: [{ group: 'line', cones: 0, rejectedCones: 0, sacks: 0, sackWeightKg: 0, conesInRangePct: null }], states: null, implausible: 0, unattributed: null },
  metadata: META_FIXTURE,
};

function weightProps(period: typeof AFTER) {
  return {
    period, mode: 'time' as const, onModeChange: noop, chartType: 'cone' as const, onChartTypeChange: noop,
    chartStation: null, onChartStationChange: noop, onOpenStation: noop, onSeeOutside: noop,
  };
}

describe('Weight - an empty period after the newest reading', () => {
  const routes = () => ({
    '/api/live': LIVE_OCT, '/api/weight-stations': WEIGHT_STATIONS_EMPTY, '/api/stations': { stations: [] },
    '/api/production': PRODUCTION_EMPTY, '/api/spc': SPC_EMPTY,
  });

  it('names the newest reading when the period starts after it', async () => {
    installFakeFetch(routes());
    const { findByRole } = renderWithLive(<WeightScreen {...weightProps(AFTER)} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toBe(QUALIFIED));
  });

  it('keeps the old sentence for a period that is not after it', async () => {
    installFakeFetch(routes());
    const { findByRole } = renderWithLive(<WeightScreen {...weightProps(INSIDE)} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toBe('No cones were weighed in this period.'));
  });
});

/* ---------------------------------------------------------------- Readings */

function readingsProps(period: typeof AFTER) {
  return {
    period, listing: 'cones' as const, onListingChange: noop, station: null, onStationChange: noop, states: [],
    onStatesChange: noop, page: 1, onPageChange: noop, initialFilter: undefined, onFilterChange: noop,
    onOpenReading: noop, canExport: false,
  };
}

describe('Readings - an empty period after the newest reading', () => {
  const routes = () => ({
    '/api/live': LIVE_OCT, '/api/stations': { stations: [] },
    '/api/events': (_req: RouteRequest) => ({ data: { rows: [], total: 0, page: 1, pageSize: 100 }, metadata: META_FIXTURE }),
  });

  it('names the newest reading when the period starts after it', async () => {
    installFakeFetch(routes());
    const { findByText, queryByText } = renderWithLive(<ReadingsScreen {...readingsProps(AFTER)} />);
    await findByText(QUALIFIED);
    expect(queryByText(W.readings.nothing)).toBeNull();
  });

  it('keeps the old sentence for a period that is not after it', async () => {
    installFakeFetch(routes());
    const { findByText, queryByText } = renderWithLive(<ReadingsScreen {...readingsProps(INSIDE)} />);
    await findByText(W.readings.nothing);
    expect(queryByText(QUALIFIED)).toBeNull();
  });
});

/* ------------------------------------------------------------------- Sacks */

function sacksSummaryEmpty(): SackSummaryData {
  const zero = { sacks: 0, kg: 0, avgKg: null, inRangePct: null, inRange: 0, noFlag: 0, implausible: 0 };
  return {
    from: '2026-09-01', to: '2026-09-02', shift: null, product: null, totals: { ...zero, cones: 0, conesPerSack: null },
    byShift: [], byProduct: [], unattributed: { rows: 0, of: 0 }, weightBasis: 'gross', tareKg: 0,
    plausibility: { loKg: 40, hiKg: 60 }, sackTimeIsInsertTime: true, conesPerSackApproximate: true,
    machineLevel: { enabled: false, reason: 'not available' },
  };
}

function sacksProps(period: typeof AFTER) {
  return {
    period, unit: 'sacks' as const, onUnitChange: noop, page: 1, onPageChange: noop,
    canRecord: false, onOpenReading: noop, onOpenDay: noop,
  };
}

describe('Sacks - an empty period after the newest reading', () => {
  const routes = () => ({
    '/api/live': LIVE_OCT, '/api/sacks/summary': { data: sacksSummaryEmpty(), metadata: META_FIXTURE },
    '/api/reports/sack': () => new Promise(() => {}), '/api/products': { products: [] },
    // The ledger and the register are not this test's subject: they stay loading.
    '/api/sacks/stock': () => new Promise(() => {}), '/api/events': () => new Promise(() => {}),
  });

  it('the headline names the newest reading when the period starts after it', async () => {
    installFakeFetch(routes());
    const { findByRole } = renderWithLive(<SacksScreen {...sacksProps(AFTER)} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toBe(QUALIFIED));
  });

  it('keeps the old headline for a period that is not after it', async () => {
    installFakeFetch(routes());
    const { findByRole } = renderWithLive(<SacksScreen {...sacksProps(INSIDE)} />);
    const h1 = await findByRole('heading', { level: 1 });
    await waitFor(() => expect(h1.textContent).toBe(W.sacks.headlineNone('Monday, 7 September 2026')));
  });
});

/* ----------------------------------------------------------------- Rejects */

function spcRejects(rejectType: 'quality' | 'weight') {
  return {
    bucketSize: 'day', rejectTypeFilter: rejectType, totalProduced: 0, totalRejects: 0, pBar: null, spansGenerations: false,
    generations: [], outOfControlCount: 0, buckets: [], episodes: [],
  };
}

function rejectsProps(period: typeof AFTER) {
  return {
    period, station: null, onStationChange: noop, product: null, onProductChange: noop, code: null, onCodeChange: noop,
    onSeeCones: noop, onSeeStations: noop, onOpenReason: noop, canName: false,
  };
}

describe('Rejects - an empty period after the newest reading', () => {
  const routes = () => ({
    '/api/live': LIVE_OCT, '/api/range': { minDate: '2026-08-24', maxDate: '2026-09-07' }, '/api/stations': { stations: [] },
    '/api/products': { products: [] },
    '/api/reject-spc': (req: RouteRequest) => ({ data: spcRejects(req.search.get('rejectType') === 'weight' ? 'weight' : 'quality'), metadata: META_FIXTURE }),
    '/api/rejects': { data: { total: 0, reasons: [], unattributed: null }, metadata: META_FIXTURE },
    '/api/rejects/by-day-code': { data: { dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 1, total: 0, rows: [] }, metadata: META_FIXTURE },
  });

  it('names the newest reading where the reasons list is empty, and no longer says only "No cones were rejected"', async () => {
    installFakeFetch(routes());
    const { findAllByText, queryByText } = renderWithLive(<RejectsScreen {...rejectsProps(AFTER)} />);
    expect((await findAllByText(QUALIFIED)).length).toBeGreaterThan(0);
    expect(queryByText(W.rejects.none)).toBeNull();
  });

  it('keeps the old sentence for a period that is not after it', async () => {
    installFakeFetch(routes());
    const { findAllByText, queryByText } = renderWithLive(<RejectsScreen {...rejectsProps(INSIDE)} />);
    expect((await findAllByText(W.rejects.none)).length).toBeGreaterThan(0);
    expect(queryByText(QUALIFIED)).toBeNull();
  });
});
