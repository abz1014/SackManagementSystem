/**
 * Quality > Register, the record sheets and the sack stock ledger (task E8). TRACE rows verified here:
 *   A3-051 (the five listings, old `rejected` = weight-check fails), A3-052 (filters round-trip through the URL; rp is
 *   how many pages are shown), A3-053 (a count that has not arrived is never zero; a failed fetch names its part),
 *   A3-054 + A4-17 + A1-045 + A2-020 + G-26 (Export CSV rank 3, absent below; Print present),
 *   A3-055 (Print waits for rows), A6-07..A6-10 (rf, rl, rcs, rp keys), A6-H04 / A6-H06 / A6-H10 (hops from Rejects,
 *   Weight, Stations and Today land here with their state), A6-L02 + A6-L06 + A6-L07 (legacy keys), A3-047 + A3-050
 *   (stock ledger, reserved words, line stock not per machine), A3-048 + A4-14 + A1-083 + A2-081 + G-3 (the movement
 *   form: engineer rank, absent at rank 1, no optimistic UI), A3-056 + A6-S2..S4 (cone, sack, inspection-fail sheets
 *   open from the URL; sack shows the approximate caveat), A3-058 + A6-S6 + G-5 (stock day sheet), B5-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../../web/src/testkit/render';
import { installDomStubs } from '../../../../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type Routes } from '../../../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../../../web/src/testkit/fixtures';
import { live } from '../../../bridge/lib';
import { RESERVED, C, withFragments, FRAGMENTS } from '../../../copy';
import { legacyRedirect, parseRoute, writeRoute } from '../../../route';
import { ConeSheet } from '../../../sheets/ConeSheet/ConeSheet';
import { RejectSheet } from '../../../sheets/RejectSheet/RejectSheet';
import { SackSheet } from '../../../sheets/SackSheet/SackSheet';
import { StockSheet } from '../../../sheets/StockSheet/StockSheet';
import { outsideLimitsHop } from '../Weight/model';
import { conesHop, dayRegisterHop } from '../Rejects/model';
import { hopRoute } from '../../../sheets/StationSheet/hops';
import { QualityRegisterScreen } from './QualityRegister';
import { buildQuery, countLine, countStateOf, parseFilter, parseListing, parsePages, parseStates, withListing } from './model';
const R = withFragments(C.register, FRAGMENTS.registerParts);

installDomStubs();

const META = LIVE_FIXTURE.metadata;
const env = (data: unknown) => ({ data, metadata: META });
const ME = { username: 'test-user', displayName: 'Test User', role: 'engineer' } as const;

const coneRow = (id: number, over: Record<string, unknown> = {}) => ({
  event_id: id, source_row_id: 700 + id, source_epoch: 3, source_epoch_label: null,
  production_ts_utc: '2026-09-06T08:14:09Z', shift_code: 'morning', shift_date: '2026-09-06', shift_code_legacy: 'morning',
  hanger_num: 4, source_station: 3, lifter_station: 3, weight_g: 1961, in_range: true, material_id: 12, lot_code: null,
  merge_key_is_unique: true, state: 'within', product_name: '205-IL0-SD', ...over,
});
const CONES = [
  coneRow(9001),
  coneRow(9002, { weight_g: 1890, state: 'low', production_ts_utc: '2026-09-06T09:00:00Z', source_station: 5 }),
  coneRow(9003, { weight_g: 2040, in_range: false, state: 'rejected', production_ts_utc: '2026-09-06T10:00:00Z', product_name: null, material_id: null }),
];
const SACKS = [
  { ...coneRow(77), event_id: 77, sack_num: 4410, weight_kg: 48.52, weight_g: null, source_station: null, in_range: true, production_ts_is_insert_time: true, state: undefined, product_name: undefined },
  { ...coneRow(78), event_id: 78, sack_num: 4411, weight_kg: 31.2, weight_g: null, source_station: null, in_range: false, production_ts_is_insert_time: true, state: undefined, product_name: undefined },
];
const REJECTS = [
  { ...coneRow(5001), reject_type: 'quality', tube_inspect_code: 2, material_inspect_code: 1, reject_label: null, weight_g: null, in_range: null, state: undefined },
];

const page = (rows: unknown[], total = rows.length, extra: Record<string, unknown> = {}) => env({ rows, total, page: 1, pageSize: 100, ...extra });
const STATIONS = { stations: [3, 5].map((n) => ({ stationId: n, name: null, machine: null, description: null })) };
const PRODUCTS = { products: [{ productId: 12, description: '205-IL0-SD', lotCode: null, setpointG: 1960, blend: null, countText: null, tubeType: null, tubeWeightG: null, weightOffsetMinusG: null, weightOffsetPlusG: null, activeFlag: true, color: null }] };

const flow = (sacks: number, kg: number) => ({ sacks, kg });
const STOCK = {
  from: '2026-09-05', to: '2026-09-07', product: null, basis: 'line', machineLevel: { enabled: false, reason: 'Sacks carry no machine or station, so stock cannot be split by machine.' },
  dayBasis: 'production_day', sackTimeIsInsertTime: true, receiptMeaning: '', weightBasis: '', tareKg: 0,
  opening: flow(100, 4800), closing: flow(130, 6250),
  totals: { openingEntries: flow(0, 0), receipts: flow(60, 2900), weighed: flow(60, 2900), issues: flow(30, 1450), consumption: flow(0, 0), adjustments: flow(0, 0) },
  days: ['2026-09-05', '2026-09-06', '2026-09-07'].map((day, i) => ({
    day, opening: flow(100 + i * 10, 0), openingEntries: flow(0, 0), receipts: flow(20, 970), weighed: flow(20, 970), issues: flow(10, 480),
    consumption: flow(0, 0), adjustments: flow(0, 0), closing: flow(110 + i * 10, 0), movements: i === 1 ? 1 : 0,
  })),
  byMaterial: [], kgMissing: 0,
};
const MOVEMENTS = {
  from: '2026-09-06', to: '2026-09-06', machineLevel: STOCK.machineLevel,
  weighed: [{ day: '2026-09-06', sacks: 20, kg: 970.4 }],
  movements: [{
    movementId: 5, materialId: 12, productName: '205-IL0-SD', machineId: null, movementType: 'issue', quantitySacks: -10, quantityKg: -480,
    occurredAtPlant: '2026-09-06T14:30:00Z', productionDay: '2026-09-06', recordedAtUtc: '2026-09-06T09:31:00Z',
    recordedBy: { userId: 1, name: 'Amna Khan' }, source: 'manual', reason: 'Dispatched to the spinning store',
  }],
};
const DETAIL = (row: Record<string, unknown>) => ({ row });
const PRODUCT_AT = {
  at: '2026-09-06T08:14:09Z', product: { productId: 12, label: '205-IL0-SD', setpointG: 1960, weightOffsetMinusG: 40, weightOffsetPlusG: 40, effectiveFromUtc: '2026-08-05T00:00:00Z' },
  productActive: true, limits: { targetG: 1960, loG: 1920, hiG: 2000, label: '1,960 ± 40 g' }, neverRecorded: false, attribution: 'row',
  verdict: { inside: false, outsideByG: -30, reason: null, state: 'low', scalePassed: true, unknownReason: null }, limitsAreLowerBound: false,
  plausibility: { loG: 1500, hiG: 2500 },
};

let posts: Array<{ url: string; body: unknown }> = [];
function routes(extra: Routes = {}): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 },
    '/api/events': ({ search }: { search: URLSearchParams }) => {
      const type = search.get('type');
      if (type === 'sack') return page(SACKS);
      if (type === 'reject') return page(REJECTS);
      if (search.get('inRange') === 'false') return page(CONES.filter((c) => c.in_range === false));
      const state = search.get('state');
      if (state) return page(CONES.filter((c) => state.split(',').includes(c.state as string)));
      return page(CONES);
    },
    '/api/stations': STATIONS,
    '/api/products': PRODUCTS,
    '/api/reports/header': env({ header: null }),
    '/api/sacks/stock': env(STOCK),
    '/api/sacks/movements': (req: { init?: RequestInit; url: string }) => {
      if (req.init?.method === 'POST') {
        posts.push({ url: req.url, body: JSON.parse(String(req.init.body)) });
        return { movementId: 6, productionDay: '2026-09-06', recordedAtUtc: '2026-09-06T10:00:00Z' };
      }
      return env(MOVEMENTS);
    },
    ...extra,
  } as Routes;
}

let ff: FakeFetch | null = null;
const go = vi.fn();
const PERIOD = 'p=pick&from=2026-09-05&to=2026-09-07';

function open(query: string, rank: number, extra: Routes = {}) {
  window.history.replaceState(null, '', `/next/?${query}`);
  ff = installFakeFetch(routes(extra));
  const route = parseRoute(new URLSearchParams(query));
  const view = render(
    <live.LiveProvider asOf={null}>
      <QualityRegisterScreen route={route} rank={rank} user={ME as never} go={go} />
    </live.LiveProvider>,
  );
  return { ...view, route };
}
function openSheet(Sheet: typeof ConeSheet, query: string, extra: Routes = {}) {
  window.history.replaceState(null, '', `/next/?${query}`);
  ff = installFakeFetch(routes(extra));
  const route = parseRoute(new URLSearchParams(query));
  return render(
    <live.LiveProvider asOf={null}>
      <Sheet route={route} rank={2} user={ME as never} go={go} onClose={vi.fn()} />
    </live.LiveProvider>,
  );
}
beforeEach(() => { go.mockReset(); posts = []; localStorage.clear(); });
afterEach(() => { cleanup(); ff?.restore(); ff = null; window.history.replaceState(null, '', '/'); });

const BASE = `s=quality&t=register&${PERIOD}`;
const reqs = () => ff!.requests.filter((r) => r.startsWith('/api/events?'));
const rowsOf = (c: HTMLElement) => Array.from(c.querySelectorAll('tbody tr.ui-dt__row'));

describe('the listings (A3-051)', () => {
  it('lists cones with the two named verdicts, 24-hour times, the production day and the product', async () => {
    const { container } = open(BASE, 1);
    await waitFor(() => expect(rowsOf(container)).toHaveLength(3));
    expect(screen.getByRole('tab', { name: 'Cones', selected: true })).toBeTruthy();
    const first = rowsOf(container)[0]!;
    expect(within(first as HTMLElement).getByText('08:14:09')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('Within product limits')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('205-IL0-SD')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('Station 3')).toBeTruthy();
    expect(screen.getByText('Under the lower limit')).toBeTruthy();
    expect(screen.getAllByText('Failed weight check (scale)').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\brejected\b/i);
    expect(reqs()[0]).toContain('type=cone');
  });

  it('weight-check fails (rl=rejected) ask for the scale bit and open as cones', async () => {
    const { container, route } = open(`${BASE}&rl=rejected`, 1);
    await waitFor(() => expect(rowsOf(container)).toHaveLength(1));
    expect(screen.getByRole('tab', { name: 'Weight-check fails', selected: true })).toBeTruthy();
    expect(reqs().some((r) => r.includes('type=cone') && r.includes('inRange=false'))).toBe(true);
    fireEvent.click(rowsOf(container)[0]!);
    expect(go.mock.calls[0]![0]).toMatchObject({ ...route, sheet: { kind: 'cone', id: '9003' } });
  });

  it('sacks list kg, the sack number and the scale check, and open as sacks', async () => {
    const { container, route } = open(`${BASE}&rl=sacks&st=3&pr=12`, 1);
    await waitFor(() => expect(rowsOf(container)).toHaveLength(2));
    expect(screen.getByText('48.52 kg')).toBeTruthy();
    expect(screen.getByText('Passed weight check')).toBeTruthy();
    // sacks carry no station or product filter on the wire
    const q = reqs().find((r) => r.includes('type=sack'))!;
    expect(q).not.toContain('station=');
    expect(q).not.toContain('product=');
    expect(screen.getByText(R.productNotForSacks)).toBeTruthy();
    fireEvent.click(rowsOf(container)[0]!);
    expect(go.mock.calls[0]![0]).toMatchObject({ ...route, sheet: { kind: 'sack', id: '77' } });
  });

  it('inspection fails list the reason in the reasons screen words and open as reject sheets', async () => {
    const { container, route } = open(`${BASE}&rl=inspectionRejects`, 1);
    await waitFor(() => expect(rowsOf(container)).toHaveLength(1));
    expect(screen.getByText('Code 2/1 (not named yet)')).toBeTruthy();
    expect(reqs().some((r) => r.includes('type=reject'))).toBe(true);
    fireEvent.click(rowsOf(container)[0]!);
    expect(go.mock.calls[0]![0]).toMatchObject({ ...route, sheet: { kind: 'reject', id: '5001' } });
  });

  it('the headline needs BOTH counts: weighed and failed the weight check', async () => {
    open(BASE, 1);
    expect(await screen.findByText(/3 cones weighed, 1 failed the weight check \(scale\)\./)).toBeTruthy();
  });
});

describe('a count that has not arrived is never zero; a failed fetch names its part (A3-053, B5-09)', () => {
  it('countLine states', () => {
    const base = { what: 'Sun 6 Sep', listing: 'cones' as const, outsideOnly: false, states: [] };
    const ok = countStateOf(null, 3);
    expect(countLine({ ...base, total: { kind: 'pending' }, weightFails: ok })).toBe('Sun 6 Sep: counting the readings in this period.');
    expect(countLine({ ...base, total: { kind: 'failed' }, weightFails: ok })).toBe(R.countFailed);
    expect(countLine({ ...base, total: ok, weightFails: { kind: 'pending' } })).not.toMatch(/ 0 /);
    expect(countLine({ ...base, total: ok, weightFails: countStateOf('x', undefined) })).toMatch(/could not be loaded/);
    expect(countLine({ ...base, total: ok, weightFails: countStateOf(null, 1) })).toMatch(/3 cones weighed, 1 failed/);
  });

  it('a failed register read is named, with Try again, and no zero is drawn', async () => {
    open(BASE, 1, { '/api/events': new Response('{"error":"down"}', { status: 500 }) });
    expect(await screen.findByText("Couldn't load the register rows.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByText(R.countFailed)).toBeTruthy();
    expect(screen.queryByText(/ 0 cones/)).toBeNull();
  });

  it('a hole in the pooled total is not an empty period', async () => {
    open(BASE, 1, { '/api/events': () => page([], 0, { dataIssues: [{ field: 'total', generation: null, reason: 'x' }] }) });
    expect((await screen.findAllByText(R.countUnknown)).length).toBeGreaterThan(0);
    expect(screen.queryByText(R.nothing)).toBeNull();
  });

  it('a period after the newest reading says when the newest reading is', async () => {
    const line = LIVE_FIXTURE.data.lines[0]!;
    const older = { ...LIVE_FIXTURE, data: { lines: [{ ...line, dataAsOfUtc: '2026-09-05T10:00:00Z' }] } };
    open('s=quality&t=register&p=pick&from=2026-09-07&to=2026-09-07', 1, { '/api/live': older, '/api/events': () => page([], 0) });
    expect(await screen.findByText(/Nothing in this period\. Newest data: 5 Sep 2026\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 5 Sep 2026' }));
    expect(go.mock.calls[0]![0].keys).toMatchObject({ p: 'pick', from: '2026-09-05', to: '2026-09-05' });
  });
});

describe('filters round-trip through the URL (A3-052, A6-08..A6-10)', () => {
  it('url keys reach the wire: st, pr, rcs', async () => {
    const { container } = open(`${BASE}&st=5&pr=12&rcs=low,high`, 1);
    await waitFor(() => expect(rowsOf(container).length).toBeGreaterThan(0));
    const q = reqs().find((r) => r.includes('type=cone') && !r.includes('inRange'))!;
    expect(q).toContain('station=5');
    expect(q).toContain('product=12');
    expect(q).toContain('state=low%2Chigh');
    expect(screen.getByRole('button', { name: 'Low' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Any' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('changing a filter writes the key and returns to the first page; the listing switch drops page, states and hop', async () => {
    const { container, route } = open(`${BASE}&rp=3&rcs=low&rf=outsideLimits&rl=cones`, 1);
    await waitFor(() => expect(rowsOf(container).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('Station'), { target: { value: '5' } });
    const next = go.mock.calls[0]![0];
    expect(next.keys.st).toBe('5');
    expect(next.keys.rp).toBeUndefined();
    go.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: 'Sacks' }));
    const sw = go.mock.calls[0]![0];
    expect(sw.keys.rl).toBe('sacks');
    expect(sw.keys.rp).toBeUndefined();
    expect(sw.keys.rcs).toBeUndefined();
    expect(sw.keys.rf).toBeUndefined();
    expect(sw.keys.p).toBe('pick');
    expect(sw.sheet).toBeNull();
    void route;
  });

  it('a check-result chip toggles rcs (replace, not push)', async () => {
    const { container } = open(BASE, 1);
    await waitFor(() => expect(rowsOf(container).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    expect(go.mock.calls[0]![0].keys.rcs).toBe('high');
    expect(go.mock.calls[0]![1]).toEqual({ replace: true });
  });

  it('Load more asks for one more page and keeps the first; rp round-trips', async () => {
    const many = Array.from({ length: 100 }, (_, i) => coneRow(1000 + i));
    const { container } = open(`${BASE}&rp=2`, 1, { '/api/events': ({ search }: { search: URLSearchParams }) => {
      const pg = Number(search.get('page') ?? '1');
      return env({ rows: pg === 1 ? many : [coneRow(2000)], total: 150, page: pg, pageSize: 100 });
    } });
    await waitFor(() => expect(rowsOf(container)).toHaveLength(101));
    expect(reqs().some((r) => r.includes('page=1'))).toBe(true);
    expect(reqs().some((r) => r.includes('page=2'))).toBe(true);
    expect(screen.getAllByText('Showing 1–101 of 150').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(go.mock.calls[0]![0].keys.rp).toBe('3');
  });

  it('search narrows the loaded rows only', async () => {
    const { container } = open(BASE, 1);
    await waitFor(() => expect(rowsOf(container)).toHaveLength(3));
    fireEvent.change(screen.getByLabelText(R.search), { target: { value: '9002' } });
    await waitFor(() => expect(rowsOf(container)).toHaveLength(1));
    fireEvent.change(screen.getByLabelText(R.search), { target: { value: 'zzz' } });
    expect(await screen.findByText(R.nothingMatch)).toBeTruthy();
  });
});

describe('hops from the other screens land with their state (A6-H04, A6-H06, A6-H10, A6-H01, A6-L02..L07)', () => {
  const landing = (r: { s: string; t: string | null; keys: Record<string, string>; sheet: unknown; wall: boolean }) => writeRoute(r as never).toString();

  it('Weight > outside limits: rf=outsideLimits, rl=cones, the chip, low+high on the wire', async () => {
    const weightRoute = parseRoute(new URLSearchParams('s=quality&t=weight&p=pick&from=2026-09-05&to=2026-09-07&wm=dist&rp=4&rcs=within'));
    const hop = outsideLimitsHop(weightRoute);
    const q = landing(hop);
    expect(q).toContain('rf=outsideLimits');
    expect(q).toContain('rl=cones');
    expect(q).not.toContain('rp=');
    const { container } = open(q, 1);
    await waitFor(() => expect(rowsOf(container).length).toBeGreaterThan(0));
    expect(reqs().some((r) => r.includes('state=low%2Chigh'))).toBe(true);
    expect(screen.getByText('Outside product limits')).toBeTruthy();
    expect(screen.getByText(/cones? passed by the scale but outside the product limits\./)).toBeTruthy();
    // the cone check-result chips are hidden while the hop filter is on
    expect(screen.queryByRole('group', { name: R.filterState })).toBeNull();
  });

  it('removing the hop chip drops rf and keeps the listing', async () => {
    const { container } = open(`${BASE}&rf=outsideLimits&rl=cones`, 1);
    await waitFor(() => expect(rowsOf(container).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Outside product limits' }));
    const next = go.mock.calls[0]![0];
    expect(next.keys.rf).toBeUndefined();
    expect(next.keys.p).toBe('pick');
  });

  it('Rejects > see the cones: rf=inspectionRejects alone seeds the inspection listing', async () => {
    const rejectsRoute = parseRoute(new URLSearchParams(`s=quality&t=rejects&${PERIOD}&st=3&pr=12&jc=2-1`));
    const q = landing(conesHop(rejectsRoute));
    expect(parseListing(parseRoute(new URLSearchParams(q)).keys)).toBe('inspectionRejects');
    open(q, 1);
    await waitFor(() => expect(reqs().some((r) => r.includes('type=reject') && r.includes('station=3') && r.includes('product=12'))).toBe(true));
    expect(screen.getByRole('tab', { name: 'Inspection or weight-check fails', selected: true })).toBeTruthy();
  });

  it('Reason sheet > this day: one picked day, inspection fails', async () => {
    const q = landing(dayRegisterHop('2026-09-06'));
    open(q, 1);
    await waitFor(() => expect(reqs().some((r) => r.includes('type=reject') && r.includes('from=2026-09-06') && r.includes('to=2026-09-06'))).toBe(true));
  });

  it('Station sheet > readings: st carries, the old listing and page do not', async () => {
    const r = hopRoute(parseRoute(new URLSearchParams(`${BASE}&rl=sacks&rp=3&rcs=low`)), 'register', 8);
    const q = landing(r);
    expect(q).toContain('st=8');
    expect(q).not.toMatch(/rl=|rp=|rcs=/);
    open(q, 1);
    await waitFor(() => expect(reqs().some((x) => x.includes('station=8'))).toBe(true));
  });

  it('legacy readings and sack-history links redirect onto the register keys', () => {
    const a = legacyRedirect(new URLSearchParams('s=readings&rl=sacks&rcs=low&rp=2&st=3'))!;
    expect(a.get('s')).toBe('quality');
    expect(a.get('t')).toBe('register');
    expect(a.get('rl')).toBe('sacks');
    const b = legacyRedirect(new URLSearchParams('s=sacks&sp=4'))!;
    expect(b.get('rl')).toBe('sacks');
    expect(b.get('rp')).toBe('4');
    const c = legacyRedirect(new URLSearchParams('s=sacks&sheet=stock:2026-09-06'))!;
    expect(c.get('rl')).toBe('stock');
  });

  it('Today > sack stock: rl=stock lands on the ledger', async () => {
    open(`${BASE}&rl=stock`, 1);
    expect(await screen.findByRole('tab', { name: 'Sack stock', selected: true })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: new RegExp(RESERVED.sackLedger) })).toBeTruthy();
  });

  it('url parsing', () => {
    expect(parseStates({ rcs: 'low,nonsense,high' })).toEqual(['low', 'high']);
    expect(parsePages({ rp: '999' })).toBe(50);
    expect(parsePages({ rp: 'x' })).toBe(1);
    expect(parseFilter({ rf: 'x' })).toBeNull();
    expect(withListing(parseRoute(new URLSearchParams('s=quality&t=register&rl=sacks')), 'cones').keys.rl).toBeUndefined();
    const period = { key: 'range', from: '2026-09-05', to: '2026-09-07', tsTo: '2026-09-07T17:00:00Z', live: false, days: 3 } as never;
    expect(buildQuery('rejected', period, { station: null, product: null, states: [], outsideOnly: false }).inRange).toBe(false);
    expect(buildQuery('cones', period, { station: 3, product: 12, states: ['low'], outsideOnly: false })).toMatchObject({ type: 'cone', station: 3, product: 12, state: ['low'] });
  });
});

describe('Export and Print (A3-054, A3-055, A4-17, G-26)', () => {
  it('Export CSV is absent at rank 2 and a link to the export route at rank 3; Print is for everyone', async () => {
    const r2 = open(BASE, 2);
    await waitFor(() => expect(rowsOf(r2.container).length).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: 'Export CSV' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
    cleanup(); ff?.restore();
    const r3 = open(`${BASE}&st=3`, 3);
    await waitFor(() => expect(rowsOf(r3.container).length).toBeGreaterThan(0));
    const link = screen.getByRole('link', { name: 'Export CSV' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toMatch(/^\/api\/events\/export\?/);
    expect(link.getAttribute('href')).toContain('type=cone');
    expect(link.getAttribute('href')).toContain('station=3');
  });

  it('Print waits for the rows and calls window.print once they are there', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { container } = open(BASE, 1);
    await waitFor(() => expect(rowsOf(container).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});

describe('sack stock ledger and the movement form (A3-047, A3-048, A3-050, A4-14, G-3)', () => {
  it('prints the reserved words, line stock, and the per-machine figure as not available with the server reason', async () => {
    open(`${BASE}&rl=stock`, 1);
    await screen.findByText(RESERVED.sackLedgerNote, { exact: false });
    const t = document.body.textContent ?? '';
    for (const w of [RESERVED.sackColOpening, RESERVED.sackColReceipts, RESERVED.sackColIssues, RESERVED.sackColConsumption, RESERVED.sackColAdjustments, RESERVED.sackColClosing]) expect(t).toContain(w);
    expect(t).toContain(RESERVED.sackPerMachine);
    expect(t).toContain(RESERVED.sackPerMachineNone);
    expect(t).toContain('Sacks carry no machine or station');
    expect(t).toContain(RESERVED.sackLedgerCaveat);
    expect(t).toMatch(/100 sacks in stock before this period\./);
  });

  it('a day row opens the stock sheet by pushing sheet=stock:<day>; the unit switch is replace', async () => {
    const { container, route } = open(`${BASE}&rl=stock`, 1);
    await waitFor(() => expect(rowsOf(container)).toHaveLength(3));
    fireEvent.click(rowsOf(container)[1]!);
    expect(go.mock.calls[0]![0]).toMatchObject({ ...route, sheet: { kind: 'stock', id: '2026-09-06' } });
    go.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'kg' }));
    expect(go.mock.calls[0]![0].keys.su).toBe('kg');
    expect(go.mock.calls[0]![1]).toEqual({ replace: true });
  });

  it('a failed ledger read names the ledger', async () => {
    open(`${BASE}&rl=stock`, 1, { '/api/sacks/stock': new Response('{}', { status: 500 }) });
    expect(await screen.findByText("Couldn't load the stock ledger.")).toBeTruthy();
  });

  it('Record a movement is absent at rank 1 and present at rank 2', async () => {
    const r1 = open(`${BASE}&rl=stock`, 1);
    await waitFor(() => expect(rowsOf(r1.container)).toHaveLength(3));
    expect(screen.queryByRole('button', { name: R.record })).toBeNull();
    cleanup(); ff?.restore();
    const r2 = open(`${BASE}&rl=stock`, 2);
    await waitFor(() => expect(rowsOf(r2.container)).toHaveLength(3));
    expect(screen.getByRole('button', { name: R.record })).toBeTruthy();
  });

  it('records a movement only when the server says yes: nothing changes first, a refusal keeps the form open', async () => {
    const { container } = open(`${BASE}&rl=stock`, 2, {
      '/api/sacks/movements': (req: { init?: RequestInit; url: string }) => {
        if (req.init?.method === 'POST') {
          posts.push({ url: req.url, body: JSON.parse(String(req.init.body)) });
          return posts.length === 1 ? new Response(JSON.stringify({ error: 'quantity must not be negative' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) : { movementId: 6 };
        }
        return env(MOVEMENTS);
      },
    });
    await waitFor(() => expect(rowsOf(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: R.record }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: R.fSave }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(R.fSacks), { target: { value: '5' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ movementType: 'issue', quantitySacks: 5 });
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(R.recorded)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: R.fSave }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(await screen.findByText(R.recorded)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a correction needs a reason of the server minimum before it can be saved', async () => {
    const { container } = open(`${BASE}&rl=stock`, 2);
    await waitFor(() => expect(rowsOf(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: R.record }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(R.fType), { target: { value: 'adjustment' } });
    fireEvent.change(within(dialog).getByLabelText(R.fSacks), { target: { value: '-2' } });
    const save = within(dialog).getByRole('button', { name: R.fSave }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(R.fWhy), { target: { value: 'Recount of the packing store' } });
    expect(save.disabled).toBe(false);
  });
});

describe('record sheets open from the URL (A3-056, A3-058, A6-S2..S4, A6-S6, G-5)', () => {
  const cone = { ...coneRow(9002), weight_g: 1890, state: 'low', provenance: { sourceSystem: 'ifl_sql', sourceTable: 'pack1_TP1U2', epochLabel: null, sourceRowId: 702, rawId: 55, sourceInsertUtc: '2026-09-06T08:30:00Z', ingestedAtUtc: '2026-09-06T03:35:00Z', ingestRunId: 'run-1', transformVersion: 7, attributionMethod: 'source_column', attributionConfidence: 'high', nightBelongsTo: null, epochId: 3, epochOrdinal: 3, epochSimulator: false } };

  it('cone: both facts are named apart, the limits come from the reading\'s own time, hops are real links', async () => {
    openSheet(ConeSheet, `${BASE}&sheet=cone:9002`, { '/api/events/cone/9002': DETAIL(cone), '/api/product-at': env(PRODUCT_AT).data });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('1,890 g')).toBeTruthy();
    expect(within(dialog).getByText('Under the lower limit')).toBeTruthy();
    expect(await within(dialog).findByText(/30 g under the lower limit, 1,960 ± 40 g\. The scale passed it\. Which judgement governs is not yet confirmed by IFL\./)).toBeTruthy();
    expect(within(dialog).getByText('Product then')).toBeTruthy();
    const report = within(dialog).getByRole('link', { name: R.seeProductReport }) as HTMLAnchorElement;
    expect(report.getAttribute('href')).toContain('s=reports');
    expect(report.getAttribute('href')).toContain('rt=product');
    expect(report.getAttribute('href')).toContain('pr=12');
    const cat = within(dialog).getByRole('link', { name: R.seeProductCatalogue }) as HTMLAnchorElement;
    expect(cat.getAttribute('href')).toContain('s=products');
    expect(cat.getAttribute('href')).toContain('t=catalogue');
    expect(within(dialog).getByRole('link', { name: R.seeStation }).getAttribute('href')).toContain('st=3');
    expect(ff!.requests.some((r) => r.startsWith('/api/product-at?') && r.includes('productId=12') && r.includes('weightG=1890'))).toBe(true);
  });

  it('cone with no product in force says so and compares nothing', async () => {
    openSheet(ConeSheet, `${BASE}&sheet=cone:9002`, {
      '/api/events/cone/9002': DETAIL({ ...cone, state: undefined, material_id: null }),
      '/api/product-at': { ...PRODUCT_AT, product: null, limits: null, verdict: { inside: null, outsideByG: null, reason: 'no_product_recorded', state: 'unknown', unknownReason: 'no_limits' } },
    });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(R.noLimitsKnown)).toBeTruthy();
    expect(within(dialog).queryByText(/under the lower limit/)).toBeNull();
  });

  it('cone: a failed product-at read is named and the rest of the sheet stays', async () => {
    openSheet(ConeSheet, `${BASE}&sheet=cone:9002`, { '/api/events/cone/9002': DETAIL(cone), '/api/product-at': new Response('{}', { status: 500 }) });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText("Couldn't load the product in force then.")).toBeTruthy();
    expect(within(dialog).getByText('1,890 g')).toBeTruthy();
  });

  it('sack: the cones since the previous sack are an approximate count, never a packing list', async () => {
    const sack = { ...SACKS[0], provenance: { ...cone.provenance, epochId: 3 } };
    openSheet(SackSheet, `${BASE}&sheet=sack:77`, {
      '/api/events/sack/77': DETAIL(sack),
      '/api/product-at': env({ ...PRODUCT_AT, verdict: null }).data,
      '/api/events': ({ search }: { search: URLSearchParams }) =>
        search.get('type') === 'sack'
          ? page([{ ...SACKS[0] }, { ...SACKS[1], production_ts_utc: '2026-09-06T07:00:00Z' }])
          : env({ rows: [], total: 112, page: 1, pageSize: 1 }),
    });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/112 cones were weighed between the previous sack and this one\. The plant records no link between a cone and its sack, so this is an approximate count and never a packing list\./)).toBeTruthy();
    expect(within(dialog).getByText('48.52 kg')).toBeTruthy();
    expect(within(dialog).getByText(R.insertTimeCaveat)).toBeTruthy();
    const q = ff!.requests.filter((r) => r.startsWith('/api/events?'));
    expect(q.every((r) => r.includes('batch=epoch%3A3'))).toBe(true);
  });

  it('sack with no earlier sack says so rather than inventing a window', async () => {
    openSheet(SackSheet, `${BASE}&sheet=sack:77`, {
      '/api/events/sack/77': DETAIL(SACKS[0]!),
      '/api/product-at': env({ ...PRODUCT_AT, verdict: null }).data,
      '/api/events': () => page([{ ...SACKS[0] }]),
    });
    expect(await screen.findByText(R.noPreviousSack)).toBeTruthy();
  });

  it('inspection fail: the reason in the reasons screen words, never a bare "rejected"', async () => {
    openSheet(RejectSheet, `${BASE}&sheet=reject:5001`, { '/api/events/reject/5001': DETAIL(REJECTS[0]!), '/api/product-at': env({ ...PRODUCT_AT, verdict: null }).data });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Failed inspection: Code 2/1 (not named yet)')).toBeTruthy();
    expect(within(dialog).getByText('Recorded')).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\brejected\b/i);
  });

  it('a malformed id is a named error, not a crash and not an endless skeleton', async () => {
    openSheet(ConeSheet, `${BASE}&sheet=cone:abc`);
    expect(await screen.findByText(R.malformedId)).toBeTruthy();
  });

  it('a failed detail read is named with Try again', async () => {
    openSheet(ConeSheet, `${BASE}&sheet=cone:9002`, { '/api/events/cone/9002': new Response('{}', { status: 500 }) });
    expect(await screen.findByText("Couldn't load this reading.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('stock day: weighed receipts, then each recorded movement with who, plant time and why', async () => {
    openSheet(StockSheet, `${BASE}&sheet=stock:2026-09-06`);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('20 sacks weighed this day (970 kg) count as receipts.')).toBeTruthy();
    expect(within(dialog).getByText(RESERVED.sackTypeName.issue)).toBeTruthy();
    expect(within(dialog).getByText('14:30')).toBeTruthy();
    expect(within(dialog).getByText(/Amna Khan/)).toBeTruthy();
    expect(within(dialog).getByText('Dispatched to the spinning store')).toBeTruthy();
    expect(within(dialog).getByText(/Sacks carry no machine or station/)).toBeTruthy();
  });

  it('stock day: a malformed day and a failed read are named', async () => {
    openSheet(StockSheet, `${BASE}&sheet=stock:not-a-day`);
    expect(await screen.findByText(R.malformedDay)).toBeTruthy();
    cleanup(); ff?.restore();
    openSheet(StockSheet, `${BASE}&sheet=stock:2026-09-06`, { '/api/sacks/movements': new Response('{}', { status: 500 }) });
    expect(await screen.findByText("Couldn't load the movements for this day.")).toBeTruthy();
  });
});

describe('print (coordinator item b)', () => {
  it('hides the sort arrows and the row chevron column on paper', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${__dirname}/register.css`, 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/\.ui-dt__arrows/);
    expect(print).toMatch(/\.ui-dt__chev-col/);
  });
});
