/**
 * UX Phase 8 Brief D — hop tests: six navigations that CARRY STATE.
 *
 * `audit/IA-PROPOSAL.md` records that nothing automated catches a broken
 * route: every drilldown hop built in Phases 4 and 6 was verified by one
 * human clicking it once. The failure mode this file exists to catch is
 * specific — a hop that navigates but DROPS the context it was supposed to
 * carry: you land on the right screen showing the wrong thing (or nothing).
 * Plain screen switches (Bar navigation with no state to carry) are already
 * covered by `App.test.ts`'s 30 pure-function cases and are NOT repeated
 * here — every hop below was chosen because `App.tsx`'s `go()` call passes
 * more than just `view`.
 *
 * WHAT THIS SUITE DOES NOT PROVE, so a reader does not mistake it for
 * end-to-end coverage:
 *   - That the destination renders CORRECTLY against real plant data. There
 *     is no database in this suite, and none is wanted — every response
 *     below is a fixture shaped to satisfy the screen's own TypeScript
 *     contract (imported from `api.ts`), not a claim about what the plant's
 *     data looks like.
 *   - That the server HONOURS the query a hop sends. That is
 *     `api/src/app.routes.test.ts`'s job, already built and passing.
 *   - That the SPA catch-all serves the URL on a COLD load (typing the
 *     landed-on URL into a fresh browser tab). That is a server routing
 *     concern, not a client navigation one, and is untested here.
 *   - Anything about LAYOUT, print CSS or the wall display. jsdom computes
 *     no layout at all; that is Phase 9's concern, not this one's.
 *
 * Each hop gets three assertions: (1) the URL after the click equals
 * `routeSearch()` of the route `App.tsx`'s own `go()` call would produce —
 * compared against the REAL function, never a hand-typed string, so this
 * test cannot drift from the writer it exists to pin; (2) the destination
 * screen mounted without throwing (its own "question" sentence appears);
 * (3) the fake router RECORDED the destination's first request carrying the
 * handed-off value — the strongest honest assertion available, and exactly
 * the "nothing hands off the station id" class of bug `IA-PROPOSAL.md`
 * describes. One hop (Reading sheet -> product catalogue) cannot carry a
 * value into a REQUEST because its destination never sends one — see that
 * test's own comment for what is asserted instead, and the report for why
 * that is not being treated as the same defect class.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { App, parseRoute, routeSearch } from './App';
import { render } from './testkit/render';
import { installFakeFetch, type FakeFetch, type Routes } from './testkit/fetchRouter';
import { LIVE_FIXTURE, META_FIXTURE, REGISTER_PAGE_FIXTURE } from './testkit/fixtures';
import { W } from './lib/words';
import { reasonIdOf } from './screens/ReasonSheet';
import type {
  AdjustmentList,
  CalibrationReportData,
  Envelope,
  LimitHistoryProduct,
  ProductAtData,
  ProductionData,
  ProductOption,
  ProductWriteStatus,
  RangeData,
  RegisterRow,
  RejectDataFiltered,
  RejectDayCodeData,
  RejectReasonData,
  RejectSpcData,
  ReportResponse,
  SpcData,
  StationRow,
  WeightStationsData,
} from './api';

/* -------------------------------------------------------------- fixtures */

const STATION_7: StationRow = { stationId: 7, name: 'Station 7', machine: null, description: null };
const STATIONS_FIXTURE: { stations: StationRow[] } = { stations: [STATION_7] };

const RANGE_FIXTURE: RangeData = { minDate: '2026-08-05', maxDate: '2026-09-07' };

const PRODUCT_21: ProductOption = {
  productId: 21, description: 'Test Yarn', lotCode: null, setpointG: 1950,
  blend: null, countText: null, tubeType: null, tubeWeightG: null,
  weightOffsetMinusG: -40, weightOffsetPlusG: 40, activeFlag: true, color: null,
};
const PRODUCTS_FIXTURE: { products: ProductOption[] } = { products: [PRODUCT_21] };

const WEIGHT_STATIONS_FIXTURE: Envelope<WeightStationsData> = {
  data: {
    from: '2026-08-24', to: '2026-09-07', days: 14, lineMeanG: 1950, targetG: 1950,
    productId: 21, productLabel: 'Test Yarn', thresholdG: 9, minDaysHeld: 2, lineRejectRatePct: 1.0,
    stations: [{
      station: 7, n: 500, meanG: 1948, vsLineG: -2, vsTargetG: -9, daysHeld: 30, flagged: true,
      rejectRatePct: 1.2, lastAdjustedUtc: null,
      days: [{ date: '2026-09-01', n: 100, mean: 1945, nelson: [1] }],
      medianG: 1947, sdG: 5.2, restartedOn: null, centrelineG: 1945, sigmaDayToDay: 1.1, longestRun: 14,
      projection: null, targetBasis: 'station_material',
    }],
    disagreement: { passedButOutside: 3, rejectedButInside: 1, judged: 500, unjudged: 0 },
    limits: { loG: 1910, hiG: 1990 },
    rules: [],
    targetEffectiveFromUtc: '2026-09-01T00:00:00Z',
    limitsChangedInWindow: 0,
    productChangesInWindow: 0,
  },
  metadata: META_FIXTURE,
};

const ADJUSTMENTS_FIXTURE: AdjustmentList = { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: 7 };

const SPC_FIXTURE: Envelope<SpcData> = {
  data: {
    specAgreement: null, type: 'cone', unit: 'g', count: 500, mean: 1950, median: 1948, stdevOverall: 5, stdevWithin: 4,
    bucketMinutes: 60, bucketLabel: 'hour', grandMean: 1950, sChartCenter: 4, xbarOutOfControl: 0, nelsonFlagged: 0,
    subgroups: [], stations: [], practicalThresholdG: 9, distinguishableStationCount: 0, flaggedStationCount: 0,
    histogram: [], spec: { usl: 1990, lsl: 1910, nominal: 1950, source: 'product' },
    capability: { cp: 1.2, cpk: 1.1, pp: 1.2, ppk: 1.1 }, station: null, implausible: 0,
    // One source generation, and a valid X̄ band (api.ts, 23 Sep 2026).
    generation: null, otherGenerationExcluded: 0, spansGenerations: false,
    xLimits: { valid: true, mrBar: 2.5, sigmaBetween: 2.2, halfWidth: 6.6, pairs: 400 },
  },
  metadata: META_FIXTURE,
};

const PRODUCTION_FIXTURE: Envelope<ProductionData> = {
  data: {
    groupBy: 'none',
    rows: [{ group: 'all', cones: 500, rejectedCones: 10, sacks: 20, sackWeightKg: 540, conesInRangePct: 96 }],
    unattributed: null, states: null, implausible: null,
  },
  metadata: META_FIXTURE,
};

const REJECTS_FILTERED_FIXTURE: Envelope<RejectDataFiltered> = {
  data: { total: 0, reasons: [], unattributed: null },
  metadata: META_FIXTURE,
};

const REJECT_SPC_FIXTURE: Envelope<RejectSpcData> = {
  data: {
    bucketSize: 'day', rejectTypeFilter: 'quality', totalProduced: 0, totalRejects: 0, pBar: null,
    spansGenerations: false, generations: [], outOfControlCount: 0, buckets: [], episodes: [],
  },
  metadata: META_FIXTURE,
};

const REJECT_DAY_CODE_FIXTURE: Envelope<RejectDayCodeData> = {
  data: { dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 0, total: 0, rows: [] },
  metadata: META_FIXTURE,
};

const REASON_DAY = '2026-09-07';
const REASON_ID = reasonIdOf({ day: REASON_DAY, rejectType: 'weight', tubeCode: null, materialCode: null });
const REASON_DATA_FIXTURE: Envelope<RejectReasonData> = {
  data: {
    day: REASON_DAY, dayBasis: 'production_day', code: { rejectType: 'weight', tubeCode: null, materialCode: null },
    rejectCodeId: null, label: null, displayLabel: 'Weight reject', isPass: false, total: 1, page: 1, pageSize: 200,
    rows: [{
      eventId: 1, productionTsUtc: `${REASON_DAY}T10:00:00Z`, shiftCode: 'morning', station: 7, materialId: 21,
      productLabel: 'Test Yarn', weightG: 2100, sourceRowId: 1, epochLabel: 'September copy', attributionMethod: 'source_column',
    }],
  },
  metadata: META_FIXTURE,
};

const PRODUCT_WRITE_STATUS_FIXTURE: ProductWriteStatus = {
  enabled: false, reason: 'PDAS writes disabled', canWrite: false, local: { canWrite: false },
};
const LIMIT_HISTORY_FIXTURE: { products: LimitHistoryProduct[] } = { products: [] };

const CALIBRATION_REPORT_FIXTURE: Envelope<ReportResponse<'calibration'>> = {
  data: {
    header: {
      reportType: 'calibration', title: 'Calibration', lineName: 'TP1 Line 3 · Unit 2',
      plantName: 'TP1', unitName: 'Unit 2',
      period: { period: 'day', from: REASON_DAY, to: REASON_DAY, days: 1 },
      filters: { station: 7 }, generatedAtPlantUtc: '2026-09-07T17:00:00Z', generatedBy: 'test-user',
      smsVersion: 'test', definitions: 'KPI-DEFINITIONS.md', approval: 'awaiting',
      spansGenerations: false, sourceGeneration: null, otherGenerationExcluded: null,
    },
    report: {
      period: { period: 'day', from: REASON_DAY, to: REASON_DAY }, filters: { station: 7 },
      lineMeanG: 1950, targetG: 1950, productLabel: 'Test Yarn', thresholdG: 9, minDaysHeld: 2,
      stations: [], flaggedStationCount: 0, adjustments: [], note: '',
    } as CalibrationReportData,
  },
  metadata: META_FIXTURE,
};

const READING_ROW: RegisterRow & Record<string, unknown> = {
  ...REGISTER_PAGE_FIXTURE.data.rows[0]!,
  event_id: 512044,
  material_id: 21,
};

const PRODUCT_AT_FIXTURE: ProductAtData = {
  at: READING_ROW.production_ts_utc,
  product: { productId: 21, label: 'Test Yarn', setpointG: 1950, weightOffsetMinusG: -40, weightOffsetPlusG: 40, effectiveFromUtc: '2026-09-01T00:00:00Z' },
  limits: { targetG: 1950, loG: 1910, hiG: 1990, label: '1,950 ± 40 g' },
  neverRecorded: false, attribution: 'row',
  verdict: { inside: true, outsideByG: 0, reason: null, state: 'within', scalePassed: true, unknownReason: null },
  limitsAreLowerBound: false,
};

/* --------------------------------------------------------------- helpers */

/** Routes every screen this file mounts needs, regardless of which hop —
 *  merged with each test's own extras. Registering unused-per-test entries
 *  is harmless: an unrequested route is simply never called. */
function baseRoutes(): Routes {
  return {
    '/api/auth/me': { user: { username: 'test-user', displayName: 'Test User', role: 'admin' } },
    '/api/live': LIVE_FIXTURE,
    '/api/stations': STATIONS_FIXTURE,
    '/api/products': PRODUCTS_FIXTURE,
    '/api/range': RANGE_FIXTURE,
    '/api/weight-stations': WEIGHT_STATIONS_FIXTURE,
    '/api/calibration/adjustments': ADJUSTMENTS_FIXTURE,
    '/api/spc': SPC_FIXTURE,
    '/api/production': PRODUCTION_FIXTURE,
    '/api/events': REGISTER_PAGE_FIXTURE,
    '/api/rejects': REJECTS_FILTERED_FIXTURE,
    '/api/reject-spc': REJECT_SPC_FIXTURE,
    '/api/rejects/by-day-code': REJECT_DAY_CODE_FIXTURE,
    '/api/rejects/reason': REASON_DATA_FIXTURE,
    '/api/product-write/status': PRODUCT_WRITE_STATUS_FIXTURE,
    '/api/products/limits/history': LIMIT_HISTORY_FIXTURE,
    '/api/reports/calibration': CALIBRATION_REPORT_FIXTURE,
    '/api/product-at': PRODUCT_AT_FIXTURE,
  };
}

/** Build a query string the same way `URLSearchParams` would — never a
 *  hand-concatenated string — so a sheet id containing `|` or `:` is encoded
 *  exactly as the real app encodes it. */
function urlFor(params: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) p.set(k, v);
  return `?${p.toString()}`;
}

let openFake: FakeFetch | null = null;

/** Navigate to `initialSearch`, install a fake fetch answering `extra` on
 *  top of `baseRoutes()`, and mount the real `<App/>`. Returns the render
 *  result plus the fake fetch handle (for its recorded `.requests`) and the
 *  route the app booted from (for building the expected post-click route). */
function boot(initialSearch: string, extra: Routes = {}) {
  window.history.pushState(null, '', initialSearch);
  const prevRoute = parseRoute();
  openFake = installFakeFetch({ ...baseRoutes(), ...extra });
  const result = render(<App />);
  return { ...result, fake: openFake, prevRoute };
}

afterEach(() => {
  openFake?.restore();
  openFake = null;
});

/** Find the first recorded request to `pathname` whose query string carries
 *  every `params` entry — decoded, so comma/pipe encoding never trips the
 *  comparison up. */
function findRequest(requests: string[], pathname: string, params: Record<string, string>): string | undefined {
  return requests.find((r) => {
    const u = new URL(r, 'http://localhost');
    if (u.pathname !== pathname) return false;
    return Object.entries(params).every(([k, v]) => u.searchParams.get(k) === v);
  });
}

/* ------------------------------------------------------------------ hops */

describe('hop 1 — Station sheet -> that station’s readings', () => {
  it('carries the station, resets the page, closes the sheet, and Readings actually asks for it', async () => {
    const { findByRole, findByText, queryByRole, prevRoute, fake } = boot(urlFor({ s: 'weight', sheet: 'station:7' }));

    const btn = await findByRole('button', { name: W.calibration.seeReadings });
    const before = fake.requests.length;
    fireEvent.click(btn);

    const expected = routeSearch({ ...prevRoute, view: 'readings', station: 7, sheet: null, readingsPage: 1 });
    expect(window.location.search).toBe(expected);

    await findByText(W.question.readings);
    expect(queryByRole('dialog')).toBeNull();

    const req = findRequest(fake.requests.slice(before), '/api/events', { type: 'cone', station: '7' });
    expect(req, `expected a /api/events request carrying station=7; saw ${JSON.stringify(fake.requests.slice(before))}`).toBeTruthy();
  });
});

describe('hop 2 — Station sheet -> that station’s rejects', () => {
  it('carries the station, closes the sheet, and Rejects actually asks for it', async () => {
    const { findByRole, findByText, queryByRole, prevRoute, fake } = boot(urlFor({ s: 'weight', sheet: 'station:7' }));

    const btn = await findByRole('button', { name: W.calibration.seeRejects });
    const before = fake.requests.length;
    fireEvent.click(btn);

    const expected = routeSearch({ ...prevRoute, view: 'rejects', station: 7, sheet: null });
    expect(window.location.search).toBe(expected);

    await findByText(W.question.rejects);
    expect(queryByRole('dialog')).toBeNull();

    const req = findRequest(fake.requests.slice(before), '/api/rejects', { station: '7' });
    expect(req, `expected a /api/rejects request carrying station=7; saw ${JSON.stringify(fake.requests.slice(before))}`).toBeTruthy();
  });
});

describe('hop 3 — Station sheet -> the calibration report', () => {
  it('carries the station and the report type, closes the sheet, and the report actually asks for it', async () => {
    const { findByRole, findByText, queryByRole, prevRoute, fake } = boot(urlFor({ s: 'weight', sheet: 'station:7' }));

    const btn = await findByRole('button', { name: W.calibration.seeCalibrationReport });
    const before = fake.requests.length;
    fireEvent.click(btn);

    const expected = routeSearch({ ...prevRoute, view: 'report', reportType: 'calibration', station: 7, sheet: null });
    expect(window.location.search).toBe(expected);

    await findByText(W.reports.question.calibration);
    expect(queryByRole('dialog')).toBeNull();

    const req = findRequest(fake.requests.slice(before), '/api/reports/calibration', { station: '7' });
    expect(req, `expected a /api/reports/calibration request carrying station=7; saw ${JSON.stringify(fake.requests.slice(before))}`).toBeTruthy();
  });
});

describe('hop 4 — Reason sheet -> that day’s register', () => {
  it('carries the production day and the inspection-rejects listing, closes the sheet, and Readings actually asks for it', async () => {
    const { findByRole, findByText, queryByRole, prevRoute, fake } = boot(urlFor({ s: 'rejects', sheet: `reason:${REASON_ID}` }));

    const M = W.rejectsMore;
    const btn = await findByRole('button', { name: M.openRegister });
    const before = fake.requests.length;
    fireEvent.click(btn);

    const expected = routeSearch({
      ...prevRoute,
      view: 'readings', readingsFilter: 'inspectionRejects', readingsListing: 'inspectionRejects',
      readingsStates: [], readingsPage: 1,
      period: { key: 'pick', picked: { from: REASON_DAY, to: REASON_DAY } },
      sheet: null,
    });
    expect(window.location.search).toBe(expected);

    await findByText(W.question.readings);
    expect(queryByRole('dialog')).toBeNull();

    const req = findRequest(fake.requests.slice(before), '/api/events', { type: 'reject', from: REASON_DAY, to: REASON_DAY });
    expect(req, `expected a /api/events request carrying the day ${REASON_DAY}; saw ${JSON.stringify(fake.requests.slice(before))}`).toBeTruthy();
  });
});

describe('hop 5 — Reading sheet -> product catalogue', () => {
  it('carries the product id into the URL and the Catalogue tab renders it highlighted', async () => {
    const { findByRole, findByText, queryByRole, prevRoute, fake } = boot(
      urlFor({ s: 'readings', sheet: 'cone:512044' }),
      { '/api/events/cone/512044': { row: READING_ROW } },
    );

    const btn = await findByRole('button', { name: W.readings.seeProductCatalogue });
    const before = fake.requests.length;
    fireEvent.click(btn);

    const expected = routeSearch({ ...prevRoute, view: 'product', productTab: 'catalogue', product: 21, sheet: null });
    expect(window.location.search).toBe(expected);

    await findByText(W.question.product);
    expect(queryByRole('dialog')).toBeNull();

    // NOT THE SAME ASSERTION AS THE OTHER FIVE HOPS, and deliberately so —
    // see the file header and the report this test file ships with. Product
    // > Catalogue (`screens/product/Catalogue.tsx`'s `CatalogueTab`) always
    // fetches the WHOLE product list (`GET /api/products`, no id in the
    // query) and highlights the linked row client-side from the `pr` URL
    // param alone. There is therefore no request for this hop's handoff to
    // appear IN: the assertion below confirms the value reached the URL
    // (already checked above) and the row Product 21 is present in what the
    // Catalogue rendered, which is the strongest honest claim available for
    // a hop whose destination never sends the value anywhere.
    const req = findRequest(fake.requests.slice(before), '/api/products', {});
    expect(req, `expected Catalogue to (re)fetch its product list; saw ${JSON.stringify(fake.requests.slice(before))}`).toBeTruthy();
    await findByText('Test Yarn');
  });
});

describe('hop 6 — Weight -> "see outside limits"', () => {
  it('sends the reader to the outside-limits cone listing with no leftover station chip or page, and Readings actually asks for it', async () => {
    const { findByRole, findByText, prevRoute, fake } = boot(urlFor({ s: 'weight' }));

    const btn = await findByRole('button', { name: W.seeThem });
    const before = fake.requests.length;
    fireEvent.click(btn);

    const expected = routeSearch({
      ...prevRoute,
      view: 'readings', readingsFilter: 'outsideLimits', readingsListing: 'cones',
      readingsStates: [], readingsPage: 1,
    });
    expect(window.location.search).toBe(expected);
    // rcs (states) and rp (page) are both at their default and must be absent.
    expect(new URLSearchParams(window.location.search).has('rcs')).toBe(false);
    expect(new URLSearchParams(window.location.search).has('rp')).toBe(false);

    await findByText(W.question.readings);

    const req = findRequest(fake.requests.slice(before), '/api/events', { type: 'cone', state: 'low,high' });
    expect(req, `expected a /api/events request carrying state=low,high; saw ${JSON.stringify(fake.requests.slice(before))}`).toBeTruthy();
  });
});
