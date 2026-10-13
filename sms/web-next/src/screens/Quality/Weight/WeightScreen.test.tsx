import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../../web/src/testkit/render';
import { installFakeFetch, type FakeFetch, type RouteRequest } from '../../../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../../../web/src/testkit/fixtures';
import { navigate, useLocationSearch } from '../../../appRoute';
import { parseRoute } from '../../../route';
import { QualityWeightScreen } from './WeightScreen';

const USER = { username: 'asma', displayName: 'Asma', role: 'engineer' };

function Harness() {
  const search = useLocationSearch();
  const route = parseRoute(new URLSearchParams(search));
  return <QualityWeightScreen route={route} rank={2} user={USER} go={navigate} />;
}

const env = (data: unknown) => ({ data, metadata: {} });
const fail = () => new Response('{"error":"down"}', { status: 500 });

const subgroups = Array.from({ length: 6 }, (_, i) => ({
  ts: `2026-08-0${i + 5}T06:00:00Z`,
  n: 3000,
  mean: 1950 + i,
  s: 8,
  xUcl: 1990,
  xLcl: 1910,
  sUcl: null,
  sLcl: null,
  xViolates: false,
  sViolates: false,
  nelson: [],
  firstShiftDate: `2026-08-0${i + 5}`,
  firstShiftCode: 'morning',
  lastShiftDate: `2026-08-0${i + 5}`,
  lastShiftCode: 'night',
}));

function spc(over: Record<string, unknown> = {}) {
  return {
    specAgreement: null,
    type: 'cone',
    unit: 'g',
    count: 18000,
    mean: 1951.8,
    median: 1952,
    stdevOverall: 8.7,
    stdevWithin: 7.9,
    bucketMinutes: 1440,
    bucketLabel: 'daily',
    grandMean: 1951.8,
    sChartCenter: null,
    xbarOutOfControl: 0,
    nelsonFlagged: 0,
    subgroups,
    stations: [
      { station: 1, n: 5000, mean: 1953.6, stdev: 8, delta: 1.9, distinguishable: true, flagged: false },
      { station: 2, n: 5000, mean: 1951, stdev: 8, delta: -0.8, distinguishable: true, flagged: false },
      { station: 3, n: 5000, mean: 1948.7, stdev: 8, delta: -3.1, distinguishable: true, flagged: false },
    ],
    practicalThresholdG: 8,
    distinguishableStationCount: 3,
    flaggedStationCount: 0,
    histogram: [
      { start: 1940, end: 1942, count: 4000 },
      { start: 1942, end: 1944, count: 9000 },
      { start: 1944, end: 1946, count: 5000 },
    ],
    spec: { usl: 2000, lsl: 1920, nominal: 1960, source: 'product', productLabel: '201-IH0-SD', limitsChangedInPeriod: 0 },
    capability: { cp: null, cpk: null, pp: null, ppk: null },
    xLimits: { valid: true },
    station: null,
    implausible: 3,
    spansGenerations: false,
    otherGenerationExcluded: 0,
    ...over,
  };
}

const sackSpc = spc({
  type: 'sack',
  unit: 'kg',
  count: 5400,
  mean: 47.28,
  median: 47.3,
  stdevOverall: 0.19,
  stdevWithin: 0.18,
  stations: [],
  spec: { usl: null, lsl: null, nominal: null, source: 'none' },
  subgroups: subgroups.map((s) => ({ ...s, mean: 47.2 + s.n / 1e6 })),
  histogram: [{ start: 46.8, end: 47, count: 100 }, { start: 47, end: 47.2, count: 900 }],
});

function stationsData(over: Record<string, unknown> = {}) {
  return {
    from: '2026-08-05', to: '2026-09-07', days: 14, lineMeanG: 1951.8, targetG: 1960, productId: 12, productLabel: '201-IH0-SD',
    thresholdG: 8, minDaysHeld: 6, lineRejectRatePct: 1,
    stations: [
      { station: 1, n: 5000, meanG: 1953.6, vsLineG: 1.8, vsTargetG: -6.4, daysHeld: 0, flagged: false, rejectRatePct: 1, lastAdjustedUtc: null, days: [], projection: null, longestRun: 12, targetBasis: 'station_material' },
    ],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 100, unjudged: 0 },
    limits: { loG: 1920, hiG: 2000 },
    rules: [],
    targetEffectiveFromUtc: '2026-09-01T09:00:00Z',
    limitsChangedInWindow: 0,
    productChangesInWindow: 0,
    ...over,
  };
}

const states = { within: 17900, low: 10, high: 20, rejected: 40, unknown: 30 };
const prodData = (s: Record<string, number> | null = states) => ({
  groupBy: 'none',
  rows: [{ group: 'all', cones: 18000, rejectedCones: 40, sacks: 380, sackWeightKg: 18000, conesInRangePct: 99.8 }],
  unattributed: null,
  states: s,
  implausible: 3,
});

let ff: FakeFetch | null = null;
function routes(over: Record<string, unknown> = {}) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07' },
    '/api/stations': { stations: [{ stationId: 1, name: null, machine: null, description: null }, { stationId: 2, name: null, machine: null, description: null }, { stationId: 3, name: null, machine: null, description: null }, { stationId: 6, name: null, machine: null, description: null }] },
    '/api/weight-stations': env(stationsData()),
    '/api/spc': (r: RouteRequest) => env(r.search.get('type') === 'sack' ? sackSpc : spc(r.search.get('station') ? { station: 2 } : {})),
    '/api/production': env(prodData()),
    '/api/products': { products: [] },
    '/api/sacks/summary': env({
      from: '', to: '', shift: null, product: null,
      totals: { sacks: 5435, kg: 257000, avgKg: 47.28, inRangePct: 99.1, inRange: 5385, noFlag: 0, implausible: 0, cones: 1, conesPerSack: 24 },
      byShift: [], byProduct: [
        { sacks: 600, kg: 1, avgKg: 47, inRangePct: 98, inRange: 1, noFlag: 0, implausible: 0, materialId: 12, productName: '201-IH0-SD' },
        { sacks: 300, kg: 1, avgKg: 47, inRangePct: 97, inRange: 1, noFlag: 0, implausible: 0, materialId: 13, productName: '205-IL0-SD' },
      ],
      unattributed: { rows: 4535, of: 5435 }, weightBasis: 'gross', tareKg: 0, plausibility: { loKg: 40, hiKg: 60 },
    }),
    '/api/reports/sack': env({ report: { totals: { avgSackKg: 47.28 }, byDay: [
      { group: '2026-08-05', sacks: 300, avgSackKg: 47.25, cones: 1, rejectedCones: 0, rejectRatePct: null, conesInRangePct: null, sackWeightKg: 1, conesPerSack: null },
      { group: '2026-08-06', sacks: 310, avgSackKg: 47.31, cones: 1, rejectedCones: 0, rejectRatePct: null, conesInRangePct: null, sackWeightKg: 1, conesPerSack: null },
    ] } }),
    ...over,
  };
}

const MULTI = '/?s=quality&t=weight&p=pick&from=2026-08-05&to=2026-09-07';
const ONE_DAY = '/?s=quality&t=weight&p=pick&from=2026-09-01&to=2026-09-01';

async function mount(url: string, over: Record<string, unknown> = {}) {
  window.history.replaceState(null, '', url);
  ff = installFakeFetch(routes(over));
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/Loading/));
  await waitFor(() => expect(screen.getByText('About these figures')).toBeTruthy());
}

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  ff?.restore();
  ff = null;
  window.history.replaceState(null, '', '/');
});

describe('Quality > Weight: headline (RESERVED weight-basis wording)', () => {
  it('states the mean and the target as two facts, not a verdict', async () => {
    await mount(MULTI);
    const h = screen.getByRole('heading', { level: 1 }).textContent ?? '';
    expect(h).toMatch(/Average recorded weight is 1,952/);
    expect(h).toMatch(/the product target is 1,960/);
    expect(h).toMatch(/weight basis not yet confirmed/);
    expect(h).not.toMatch(/below target|above target|under target/i);
  });
  it('says so when no product target is recorded', async () => {
    await mount(MULTI, { '/api/weight-stations': env(stationsData({ targetG: null, productId: null, productLabel: null, targetEffectiveFromUtc: null })) });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/No product target is recorded/);
  });
});

describe('Quality > Weight: KPI row', () => {
  it('shows the mean, the target with its product and in-force time, the offset and the two check shares', async () => {
    await mount(MULTI);
    await waitFor(() => expect(screen.getByText('Within product tolerance')).toBeTruthy());
    expect(screen.getAllByText('Mean cone weight').length).toBeGreaterThan(0);
    expect(screen.getByText('1,951.8')).toBeTruthy();
    expect(screen.getByText('1,960')).toBeTruthy();
    expect(screen.getByText(/201-IH0-SD · in force since/)).toBeTruthy();
    expect(screen.getByText('Mean minus target')).toBeTruthy();
    expect(screen.getByText('−8.2')).toBeTruthy();
    expect(screen.getByText('Failed weight check (scale)')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('99.8')).toBeTruthy());
    expect(screen.getByText('0.2')).toBeTruthy();
  });
  it('hides the tolerance share when no product was in force', async () => {
    await mount(MULTI, { '/api/production': env(prodData({ within: 0, low: 0, high: 0, rejected: 40, unknown: 17960 })) });
    await waitFor(() => expect(screen.getByText('Not checked (no product set)')).toBeTruthy());
    const card = screen.getByText('Within product tolerance').closest('section') as HTMLElement;
    expect(within(card).queryByText('%')).toBeNull();
    expect(card.textContent).not.toMatch(/\d%/);
  });
  it('withholds the tolerance share with the server reason when its limits post-date the period', async () => {
    const reason = 'The only limits on record begin after this period ended.';
    await mount(MULTI, { '/api/spc': () => env(spc({ spec: { usl: null, lsl: null, nominal: null, source: 'product', limitsOmittedReason: reason } })) });
    await waitFor(() => expect(screen.getAllByText(reason).length).toBeGreaterThan(0));
    const card = screen.getByText('Within product tolerance').closest('section') as HTMLElement;
    expect(card.textContent).not.toMatch(/99\./);
  });
  it('names a failed production fetch on its own cards and keeps the rest', async () => {
    await mount(MULTI, { '/api/production': fail() });
    await waitFor(() => expect(screen.getAllByText("Couldn't load the scale check share.").length).toBe(1));
    expect(screen.getByText("Couldn't load the product tolerance share.")).toBeTruthy();
    expect(screen.getByText('1,951.8')).toBeTruthy();
  });
});

describe('Quality > Weight: wm and wt in the URL', () => {
  it('defaults to Over time for a long period and Distribution for one day', async () => {
    await mount(MULTI);
    expect(screen.getByRole('radio', { name: 'Over time' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Average cone weight over time')).toBeTruthy();
  });
  it('defaults to Distribution for one day, and an explicit wm wins', async () => {
    await mount(ONE_DAY);
    expect(screen.getByRole('radio', { name: 'Distribution' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('How cone weights are spread')).toBeTruthy();
  });
  it('an explicit wm=time wins on a single day', async () => {
    await mount(`${ONE_DAY}&wm=time`);
    expect(screen.getByRole('radio', { name: 'Over time' }).getAttribute('aria-checked')).toBe('true');
  });
  it('round-trips wm through the URL, keeping the period', async () => {
    await mount(MULTI);
    fireEvent.click(screen.getByRole('radio', { name: 'Distribution' }));
    expect(window.location.search).toContain('wm=dist');
    expect(window.location.search).toContain('p=pick');
    await waitFor(() => expect(screen.getByText('How cone weights are spread')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'Over time' }));
    expect(window.location.search).toContain('wm=time');
    await waitFor(() => expect(screen.getByText('Average cone weight over time')).toBeTruthy());
  });
  it('round-trips wt: Sacks asks for sack data and shows the sack charts; Cones removes the key', async () => {
    await mount(MULTI);
    fireEvent.click(screen.getByRole('radio', { name: 'Sacks' }));
    expect(window.location.search).toContain('wt=sack');
    await waitFor(() => expect(screen.getByText('Average sack weight over time')).toBeTruthy());
    expect(ff?.requests.some((r) => r.includes('/api/spc') && r.includes('type=sack'))).toBe(true);
    expect(screen.getByText(/No product tolerance applies/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Average sack weight per day')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Sacks the scale passed, by product')).toBeTruthy());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Average sack weight is 47\.28/);
    fireEvent.click(screen.getByRole('radio', { name: 'Cones' }));
    expect(window.location.search).not.toContain('wt=');
    await waitFor(() => expect(screen.getByText('Average cone weight over time')).toBeTruthy());
  });
  it('reads wt=sack and wm=dist from a shared link', async () => {
    await mount(`${MULTI}&wt=sack&wm=dist`);
    await waitFor(() => expect(screen.getByText('How sack weights are spread')).toBeTruthy());
    expect(screen.getByRole('radio', { name: 'Sacks' }).getAttribute('aria-checked')).toBe('true');
  });
  it('reads st: one station asks the API for that station and is offered in the selector', async () => {
    await mount(`${MULTI}&st=2`);
    await waitFor(() => expect(ff?.requests.some((r) => r.includes('station=2'))).toBe(true));
    expect((screen.getByLabelText('Station') as HTMLSelectElement).value).toBe('2');
  });
});

describe('Quality > Weight: station offsets', () => {
  it('lists a station with no cones as "No data", never as zero', async () => {
    await mount(MULTI);
    await waitFor(() => expect(screen.getByText('Station offset from the line')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('No data')).toBeTruthy());
    expect(screen.getAllByText('Station 6').length).toBeGreaterThan(0);
  });
});

describe('Quality > Weight: hops and advisory', () => {
  it('"See them" carries the period to the register with the outside-limits filter and drops the chart keys', async () => {
    await mount(`${MULTI}&wm=dist`, { '/api/weight-stations': env(stationsData({ disagreement: { passedButOutside: 12, rejectedButInside: 1, judged: 100, unjudged: 0 } })) });
    await waitFor(() => expect(screen.getByText(/12 cones in this period were passed by the scale/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'See them' }));
    const sp = new URLSearchParams(window.location.search);
    expect(sp.get('s')).toBe('quality');
    expect(sp.get('t')).toBe('register');
    expect(sp.get('rf')).toBe('outsideLimits');
    expect(sp.get('rl')).toBe('cones');
    expect(sp.get('p')).toBe('pick');
    expect(sp.has('wm')).toBe(false);
  });
  it('has no outside-limits hop when the scale and the product agree', async () => {
    await mount(MULTI);
    await waitFor(() => expect(screen.getByText('Within product tolerance')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'See them' })).toBeNull();
  });
  it('lists the stations whose pattern drifts, with the projection wording, and hops to the station table', async () => {
    const row = {
      station: 3, n: 5000, meanG: 1948.7, vsLineG: -3.1, vsTargetG: -11.3, daysHeld: 7, flagged: true, rejectRatePct: 1,
      lastAdjustedUtc: null, days: [], longestRun: 12, targetBasis: 'station_material',
      projection: { slopeGPerDay: -0.8, overDays: 12, towards: 'lower', limitG: 1920, distanceG: 28, daysToLimit: null, daysLow: null, daysHigh: null, confidence: 0.9, nPoints: 12, status: 'not_established', reason: 'the slope could be zero', assumption: 'linear_over_run' },
    };
    await mount(MULTI, { '/api/weight-stations': env(stationsData({ stations: [row] })) });
    await waitFor(() => expect(screen.getByText('Stations to look at')).toBeTruthy());
    expect(screen.getByText(/1 stations?.? patterns? show drift|One station's pattern shows drift/)).toBeTruthy();
    expect(screen.getByText(/lighter than the line for 7 days/)).toBeTruthy();
    expect(screen.getByText(/not established/i)).toBeTruthy();
    expect(screen.getByText(/not an instruction to adjust a scale/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the station table' }));
    const sp = new URLSearchParams(window.location.search);
    expect(sp.get('t')).toBe('stations');
    expect(sp.get('p')).toBe('pick');
  });
  it('says no pattern drifts when none does', async () => {
    await mount(MULTI);
    await waitFor(() => expect(screen.getByText(/No station's pattern shows drift/)).toBeTruthy());
  });
});

describe('Quality > Weight: states', () => {
  it('a failed spc fetch is named, never drawn as an empty period', async () => {
    await mount(MULTI, { '/api/spc': fail() });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Could not load this/);
    expect(screen.queryByText('Nothing recorded in this period.')).toBeNull();
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Couldn't load/).length).toBeGreaterThan(0);
  });
  it('a failed station fetch keeps the chart and names the missing half', async () => {
    await mount(MULTI, { '/api/weight-stations': fail() });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Station and target data could not be loaded/);
    await waitFor(() => expect(screen.getByText('Average cone weight over time')).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Couldn't load the station pattern check.")).toBeTruthy());
  });
  it('an empty period says nothing was weighed', async () => {
    await mount(MULTI, { '/api/spc': () => env(spc({ count: 0, mean: null, subgroups: [], histogram: [], stations: [] })) });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/No cones were weighed in this period/);
    expect(screen.getByText(/Nothing in this period/)).toBeTruthy();
  });
  it('lets a chart switch to its table view', async () => {
    await mount(MULTI);
    await waitFor(() => expect(screen.getByText('Average cone weight over time')).toBeTruthy());
    const btn = screen.getAllByRole('button', { name: 'Show as table' })[0]!;
    act(() => btn.click());
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
  });
  it('puts the weight-basis wording and the figures in a disclosure', async () => {
    await mount(MULTI);
    await waitFor(() => expect(screen.getByText('About these figures')).toBeTruthy());
    fireEvent.click(screen.getByText('About these figures'));
    expect(screen.getByText(/Weight basis: as set in Setup/)).toBeTruthy();
    expect(screen.getByText(/passed by the scale but outside the product/)).toBeTruthy();
  });
});

describe('Quality > Weight: disclosures and the 90% range', () => {
  it('says when a period spans two data batches (A3-038)', async () => {
    await mount(MULTI, { '/api/spc': () => env(spc({ spansGenerations: true, otherGenerationExcluded: 2000 })) });
    await waitFor(() => expect(screen.getAllByText(/different data batch/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/IFL rebuilt its tables|tables were rebuilt/).length).toBeGreaterThan(0);
  });
  it('states the 90% range on the days to the limit, never a bare day count (A3-035, RT-020)', async () => {
    const row = {
      station: 3, n: 5000, meanG: 1948.7, vsLineG: -3.1, vsTargetG: -11.3, daysHeld: 7, flagged: true, rejectRatePct: 1,
      lastAdjustedUtc: null, days: [], longestRun: 12, targetBasis: 'station_material',
      projection: { slopeGPerDay: -0.8, overDays: 12, towards: 'lower', limitG: 1920, distanceG: 28, daysToLimit: 35, daysLow: 22, daysHigh: 60, confidence: 0.9, nPoints: 12, status: 'established', assumption: 'linear_over_run' },
    };
    await mount(MULTI, { '/api/weight-stations': env(stationsData({ stations: [row] })) });
    await waitFor(() => expect(screen.getByText(/22.{1,6}60/)).toBeTruthy());
  });
  it('names a product list that did not load, and still lists the sack products by their own name (A3-045)', async () => {
    await mount(`${MULTI}&wt=sack`, { '/api/products': fail() });
    await waitFor(() => expect(screen.getByText(/product list did not load/)).toBeTruthy());
    expect(screen.getByText('201-IH0-SD')).toBeTruthy();
  });
  it('gives the sack table the scale’s own in-range share and no tolerance (ONE STATUS VOCABULARY)', async () => {
    await mount(`${MULTI}&wt=sack`);
    await waitFor(() => expect(screen.getByText('Passed by the scale', { selector: 'th' })).toBeTruthy());
    expect(screen.getByText('98.0%')).toBeTruthy();
    expect(screen.getByText(/no sack is called over- or underweight/)).toBeTruthy();
  });
});
