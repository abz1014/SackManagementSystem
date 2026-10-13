/**
 * Today screen (task E2). Fixtures are the real 1 Sep 2026 figures in design/redesign-2026-10/mockup-data.json
 * (read-only copy sms_audit, fetched 13 Oct 2026). Station states are not in that file (the endpoint was added
 * after it was cut), so the station-status payload is built from its per-station counts and the states the
 * D2b read-only check measured on the same database (VERIFY-D2-D4.md: station 8 Act, 9 Watch, 3 to 7, 11, 12 no cones).
 *
 * TRACE rows verified here: A3-023 (headline, KPIs), A3-024 (period generation note), A3-025 (cones per shift),
 * A3-026 (attention, 14-day caption), A3-027 (heat grid, hop to station sheet), A3-029 (product change note, only a
 * real lastChange), A3-030 and G-10 (latest readings), A3-031 + A3-044 + A3-045 (sack section, su toggle),
 * A1-042, A1-057, A1-061, A1-080 (the endpoints), A6-H14 (every old Line and Sacks hop), B5-03 (detectors ignore the period).
 */
import { C } from '../../copy';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../web/src/testkit/render';
import { installDomStubs } from '../../../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type RouteRequest, type Routes } from '../../../../web/src/testkit/fetchRouter';
import { META_FIXTURE } from '../../../../web/src/testkit/fixtures';
import { live } from '../../bridge/lib';
import type { AuthUser } from '../../bridge/api';
import { parseRoute, type Route } from '../../route';
import { TodayScreen } from './Today';
import { runStartText, kpis, countDelta, rateDelta, productChanges, changeTime } from './model';

const T = C.today;

installDomStubs();

/* ---------------------------------------------------------------- fixtures */

const data = JSON.parse(readFileSync(resolve(__dirname, '../../../../../design/redesign-2026-10/mockup-data.json'), 'utf8'));
const pd = data.pd1.raw;
const refs = data.refs;
const env = (d: unknown) => ({ data: d, metadata: META_FIXTURE });

/** The 1 Sep replayed line, moved to a morning of 7 Sep so 1 Sep is a closed period. */
function liveLine(over: Record<string, unknown> = {}) {
  const base = pd.live.lines[0];
  return {
    ...base,
    plantNowUtc: '2026-09-07T12:00:30.000Z',
    replay: false,
    shift: { code: 'morning', shiftDate: '2026-09-07', startUtc: '2026-09-07T06:00:00.000Z', endUtc: '2026-09-07T14:00:00.000Z', elapsedSeconds: 21630, remainingSeconds: 10770 },
    dataAsOfUtc: '2026-09-07T12:00:28.860Z',
    ingestLagSeconds: 617,
    state: { status: 'running', sinceLastReadingSeconds: 90, behindSeconds: 0, runStartUtc: '2026-09-07T06:02:00.000Z', stopThresholdSeconds: 120 },
    generation: { ...base.generation, newerElsewhereUtc: null, newerElsewhereSourceDb: null, newerElsewhereLabel: null, newerElsewhereSimulator: false },
    ...over,
  };
}

const PREV = {
  groupBy: 'none',
  rows: [{ group: 'total', cones: 3191, rejectedCones: 431, unmatchedRejects: 5, sacks: 131, sackWeightKg: 6190.7, conesInRangePct: 100 }],
  unattributed: null,
  states: { within: 3187, low: 0, high: 0, rejected: 4, unknown: 0 },
  implausible: 0,
};

const ST = (station: number, cones: number, failedPct: number | null, state: string, product: string | null) => ({
  station, name: `Winder ${station}`, cones, failedPct, state, reasons: [], vsTargetG: null, product,
});
const STATION_STATUS = {
  from: '2026-09-01', to: '2026-09-01', lineFailedPct: 14.57,
  thresholds: { watch: 1.5, act: 2, minCones: 50, assumed: true },
  stations: [
    ST(1, 801, 0.87, 'ok', '205-IL0-SD'), ST(2, 789, 1.01, 'ok', '205-IL0-SD'),
    ST(3, 0, null, 'nodata', null), ST(4, 0, null, 'nodata', null), ST(5, 0, null, 'nodata', null),
    ST(6, 0, null, 'nodata', null), ST(7, 0, null, 'nodata', null),
    ST(8, 412, 53.86, 'act', '205-IL0-SD'), ST(9, 357, 23.12, 'watch', '205-IL0-SD'), ST(10, 397, 20.6, 'ok', '205-IL0-SD'),
    ST(11, 0, null, 'nodata', null), ST(12, 0, null, 'nodata', null), ST(13, 82, 3.66, 'ok', null), ST(14, 251, 17.93, 'ok', '205-IL0-SD'),
  ],
};

const RANGE = { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 };
const productsPayload = Array.isArray(refs.products) ? { products: refs.products } : refs.products;

function routes(over: Routes = {}, opts: { compareOk?: boolean } = {}): Routes {
  return {
    '/api/live': env({ lines: [liveLine()] }),
    '/api/range': RANGE,
    '/api/production': (req: RouteRequest) => {
      const g = req.search.get('groupBy');
      const base = g === 'shift' ? pd.prodShift : g === 'day' ? pd.prodDay : g === 'station' ? pd.prodStation : pd.prodNone;
      const out = { ...base };
      if (req.search.get('compare') && g === 'none' && opts.compareOk !== false) {
        out.previous = { from: '2026-08-31', to: '2026-08-31', fromShift: null, toShift: null, result: PREV };
      }
      return env(out);
    },
    '/api/station-status': env(STATION_STATUS),
    '/api/sacks/summary': env(pd.sacksSummary),
    '/api/rejects': env(pd.rejects),
    '/api/attention': env(pd.attention),
    '/api/machines/running': env(pd.machinesRunning),
    '/api/products': productsPayload,
    ...over,
  };
}

const USER: AuthUser = { username: 'tester', displayName: 'Test User', role: 'engineer' } as AuthUser;
let ff: FakeFetch | null = null;
type GoFn = (next: Route, opts?: { replace?: boolean }) => void;
let go = vi.fn<GoFn>();

function mount(url = '/?s=today&p=pick&from=2026-09-01&to=2026-09-01', over: Routes = {}, opts: { compareOk?: boolean } = {}) {
  window.history.replaceState(null, '', url);
  ff = installFakeFetch(routes(over, opts));
  go = vi.fn<GoFn>();
  const route: Route = parseRoute(new URLSearchParams(window.location.search));
  return render(
    <live.LiveProvider asOf={null}>
      <TodayScreen route={route} rank={2} user={USER} go={go} />
    </live.LiveProvider>,
  );
}

const card = (label: string): HTMLElement =>
  screen.getByText(label, { selector: '.kpi-label' }).closest('section') as HTMLElement;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  ff?.restore();
  ff = null;
  window.history.replaceState(null, '', '/');
});

/* ------------------------------------------------------------------ tests */

describe('KPI row (A3-023)', () => {
  it('shows the 1 Sep 2026 figures with their denominators', async () => {
    mount();
    await waitFor(() => expect(card('Cones').textContent).toContain('3,089'));
    expect(card('Sacks').textContent).toContain('133');
    expect(card('Packed').textContent).toContain('6,296.7');
    expect(card('Packed').textContent).toContain('kg');
    const fi = card('Failed inspection').textContent ?? '';
    expect(fi).toContain('14.6');
    expect(fi).toContain('451 cones');
    const fw = card('Failed weight check (scale)').textContent ?? '';
    expect(fw).toContain('0.0');
    expect(fw).toContain('0 of 3,089 cones');
  });

  it('shows no comparison unless one is asked for', async () => {
    mount();
    await waitFor(() => expect(card('Cones').textContent).toContain('3,089'));
    expect(card('Cones').textContent).not.toContain('vs');
  });

  it('states changes against the previous period, direction in ink, a closed period without "so far"', async () => {
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01&cmp=prev');
    await waitFor(() => expect(card('Cones').textContent).toContain('vs 3,191'));
    expect(card('Cones').textContent).toContain('3.2 %');
    expect(card('Cones').textContent).not.toContain('so far');
    expect(card('Cones').querySelector('[data-direction="down"]')).not.toBeNull();
    expect(card('Sacks').textContent).toContain('1.5 %');
    expect(card('Sacks').textContent).toContain('vs 131');
    expect(card('Packed').textContent).toContain('vs 6,190.7 kg');
    expect(card('Failed inspection').textContent).toContain('1.1 points');
    expect(card('Failed inspection').textContent).toContain('vs 13.5 %');
    expect(card('Failed inspection').querySelector('[data-direction="up"]')).not.toBeNull();
    expect(ff!.requests.some((r) => r.startsWith('/api/production') && r.includes('compare=prev'))).toBe(true);
  });

  it('labels a live period "so far" on the counts', async () => {
    mount('/?s=today&p=shift&cmp=prev');
    await waitFor(() => expect(card('Cones').textContent).toContain('so far'));
    expect(card('Failed inspection').textContent).not.toContain('so far');
  });

  it('says so when the comparison did not arrive instead of inventing changes', async () => {
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01&cmp=prev', {}, { compareOk: false });
    expect(await screen.findByText(T.band.comparisonMissing)).toBeTruthy();
    expect(card('Cones').textContent).not.toContain('vs ');
  });

  it('a failed totals fetch names the part and never prints 0', async () => {
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/production': new Response('{"error":"down"}', { status: 500 }) });
    await waitFor(() => expect(card('Cones').textContent).toContain("Couldn't load the totals."));
    expect(card('Cones').textContent).not.toMatch(/\b0\b/);
  });

  it('an unreadable field is a dash, not a zero (WS-B1)', () => {
    const row = { ...pd.prodNone.rows[0] };
    delete (row as Record<string, unknown>).unmatchedRejects;
    const k = kpis({ ...pd.prodNone, rows: [row] });
    expect(k.inspection.unreadable).toBe(true);
    expect(k.inspection.pct).toBeNull();
    expect(k.cones.text).toBe('3,089');
  });

  it('pure delta arithmetic', () => {
    const cur = kpis(pd.prodNone);
    const prev = kpis(PREV as never);
    expect(countDelta(cur.cones, prev.cones, false, (p) => `vs ${p}`)).toEqual({ text: '3.2 %', direction: 'down', vs: 'vs 3,191' });
    expect(rateDelta(cur.inspection, prev.inspection)?.text).toBe('1.1 points');
  });
});

describe('status band (A3-023, health rule)', () => {
  it('a closed period states what the line did and counts the server-decided stations', async () => {
    mount();
    expect(await screen.findByText(/Line ran all three shifts\./)).toBeTruthy();
    expect(screen.getByText(/1 station needs action, 1 to watch\./)).toBeTruthy();
    expect(screen.getByText(/1 Sep 2026, plant time/)).toBeTruthy();
  });

  it('a live period with healthy data says the line is running', async () => {
    mount('/?s=today&p=shift');
    expect(await screen.findByText(/Line 3 is running\./)).toBeTruthy();
  });

  it('never claims the line is running when the data is stale', async () => {
    const stale = liveLine({ health: { ...pd.live.lines[0].health, kind: 'stale', ageSeconds: 4000 } });
    mount('/?s=today&p=shift', { '/api/live': env({ lines: [stale] }) });
    expect(await screen.findByText(/Line status unknown: no data since/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/is running/);
    expect(document.body.textContent).not.toMatch(/ran all three/);
  });

  it('late data is "cannot tell", not running', async () => {
    const late = liveLine({ health: { ...pd.live.lines[0].health, kind: 'late' } });
    mount('/?s=today&p=shift', { '/api/live': env({ lines: [late] }) });
    expect(await screen.findByText(/Cannot tell whether the line is running\./)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Line 3 is running');
  });

  it('says which data is counted when a newer reading sits in another data set (A3-024, both ways)', async () => {
    const other = liveLine({ generation: { ...liveLine().generation, newerElsewhereUtc: '2026-09-07T12:00:00.000Z', newerElsewhereSimulator: false } });
    mount('/?s=today&p=shift', { '/api/live': env({ lines: [other] }) });
    expect(await screen.findByTestId('today-generation')).toBeTruthy();
    expect(screen.getByTestId('today-generation').textContent).toContain('Newer readings from a different data set are not counted.');
  });

  it('prints no generation line when nothing newer sits elsewhere (A3-024)', async () => {
    mount('/?s=today&p=shift');
    expect(await screen.findByText(/Line 3 is running\./)).toBeTruthy();
    expect(screen.queryByTestId('today-generation')).toBeNull();
  });

  it('names the period generation note from the server (A3-024)', async () => {
    mount();
    fireEvent.click(await screen.findByText('About these figures'));
    expect(await screen.findByText(/different data batch/)).toBeTruthy();
  });
});

describe('station heat grid (A3-027, A6-H14)', () => {
  it('worst first, station 8 is Act, and the tile says so in words', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-station="8"]')).not.toBeNull());
    const tiles = [...container.querySelectorAll<HTMLElement>('.tile')];
    expect(tiles[0]!.dataset.station).toBe('8');
    expect(tiles[0]!.dataset.state).toBe('act');
    expect(tiles[0]!.textContent).toContain('Act');
    expect(tiles[0]!.textContent).toContain('53.9%');
    expect(tiles[1]!.dataset.station).toBe('9');
    expect(tiles[1]!.dataset.state).toBe('watch');
    expect(tiles[2]!.dataset.state).toBe('nodata');
    expect(tiles.at(-1)!.dataset.state).toBe('ok');
    expect(screen.getByText(/Stations 3, 4, 5, 6, 7, 11, 12 recorded no cones in 1 Sep 2026\./)).toBeTruthy();
  });

  it('a tile opens the station sheet', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-station="8"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-station="8"]')!);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go.mock.calls[0]![0].sheet).toEqual({ kind: 'station', id: '8' });
  });

  it('a failed station-status fetch is named and never drawn as a grid of zeros', async () => {
    const { container } = mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/station-status': new Response('{"error":"down"}', { status: 500 }) });
    expect(await screen.findByText("Couldn't load the station states.")).toBeTruthy();
    expect(container.querySelector('.tile')).toBeNull();
    // the totals above are still true and still shown
    await waitFor(() => expect(card('Cones').textContent).toContain('3,089'));
    expect(document.body.textContent).not.toMatch(/needs? action/);
  });

  it('explains how states are decided, with the server thresholds and the reserved assumed wording', async () => {
    mount();
    fireEvent.click(await screen.findByText(T.states.title));
    expect(await screen.findByText(/more than 2 times the line's rate \(over 29\.1 %/)).toBeTruthy();
    expect(screen.getByText(/more than 1\.5 times \(over 21\.9 %\)/)).toBeTruthy();
    expect(screen.getByText(/fewer than 50 cones/)).toBeTruthy();
    expect(screen.getByText('Assumed until IFL confirms.')).toBeTruthy();
  });
});

describe('product change note (A3-029)', () => {
  it('shows nothing when no station has a real lastChange', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('[data-station="8"]')).not.toBeNull());
    await waitFor(() => expect(ff!.requests.some((r) => r.startsWith('/api/machines/running'))).toBe(true));
    expect(document.body.textContent).not.toContain('changed product');
  });

  it('shows a real change at the first cone of the new product and links to the Products board', async () => {
    const machines = JSON.parse(JSON.stringify(pd.machinesRunning));
    const m14 = machines.machines.find((m: { station: number }) => m.station === 14);
    m14.runStartUtc = '2026-09-01T20:56:41.517Z';
    m14.runStartIsLookbackLimit = false;
    m14.lastChange = { fromMaterialId: 1021, fromProductName: '205-IL0-SD', atUtc: '2026-09-01T20:56:41.517Z' };
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/machines/running': env(machines) });
    expect(await screen.findByText(/Station 14 · Winder 14 changed product to/)).toBeTruthy();
    expect(screen.getByText(/Its first cone of the new product was at 20:56\./)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'See products by station' });
    expect(link.getAttribute('href')).toContain('s=products');
    expect(link.getAttribute('href')).toContain('t=board');
  });

  it('says "since at least" when a run starts at the look-back limit, and never a start time', async () => {
    const machines = JSON.parse(JSON.stringify(pd.machinesRunning));
    machines.machines[0].runStartUtc = '2026-08-19T02:33:56.000Z';
    machines.machines[0].runStartIsLookbackLimit = true;
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/machines/running': env(machines) });
    fireEvent.click(await screen.findByText('About these figures'));
    expect(await screen.findByText(/since at least its first cone in that window, never as a start time/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('changed product');
  });

  it('wording helpers', () => {
    expect(runStartText({ runStartUtc: '2026-08-19T02:33:56.000Z', runStartIsLookbackLimit: true })).toBe('since at least 19 Aug 2026 02:33');
    expect(runStartText({ runStartUtc: '2026-09-01T20:56:41.000Z', runStartIsLookbackLimit: false })).toBe('since 1 Sep 2026 20:56');
    expect(runStartText({ runStartUtc: null, runStartIsLookbackLimit: true })).toBeNull();
    const ms = [{ station: 14, stationName: null, materialId: 1022, productName: 'x', lastChange: { fromMaterialId: null, fromProductName: null, atUtc: '2026-09-01T20:56:41.000Z' } }];
    expect(productChanges(ms as never, undefined, '2026-09-02T06:00:00Z')).toHaveLength(1);
    expect(productChanges(ms as never, '2026-09-01T22:00:00Z', '2026-09-02T06:00:00Z')).toHaveLength(0);
    expect(productChanges([{ ...ms[0], lastChange: null }] as never, undefined, '2026-09-02T06:00:00Z')).toHaveLength(0);
    expect(changeTime('2026-08-28T14:56:00Z', '2026-09-01')).toBe('14:56 on 28 Aug');
    expect(changeTime('2026-09-02T01:10:00Z', '2026-09-01')).toBe('01:10');
  });
});

describe('detail cards (A3-025, A3-026, G-10)', () => {
  it('cones per shift in reading order, with the sacks packed per shift in the caption', async () => {
    mount();
    expect((await screen.findAllByText(/Plant time, 1 Sep 2026\. Total 3,089 cones\. Sacks packed: morning 52, evening 50, night 31\./)).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Cones per shift' })).toBeTruthy();
  });

  it('uses a per-day chart for a multi-day period', async () => {
    mount('/?s=today&p=pick&from=2026-08-05&to=2026-08-07');
    expect(await screen.findByRole('heading', { name: 'Cones per day' })).toBeTruthy();
    await waitFor(() => expect(ff!.requests.some((r) => r.includes('groupBy=day'))).toBe(true));
  });

  it('names unnamed reject codes by their code pair and counts every failed inspection', async () => {
    mount();
    expect((await screen.findAllByText(/451 cones in total/)).length).toBeGreaterThan(0);
    await screen.findAllByRole('button', { name: /show as table/i });
    fireEvent.click(screen.getAllByRole('button', { name: /show as table/i })[1]!);
    expect(await screen.findByText('Code 2/1')).toBeTruthy();
  });

  it('attention is the fixed 14-day window, labelled as such, and calm when nothing fired (B5-03)', async () => {
    mount();
    expect(await screen.findByText('Nothing needs attention.')).toBeTruthy();
    expect(screen.getByText(/Last 14 production days \(25 Aug 2026 to 7 Sep 2026\)\. The period above does not change this list\./)).toBeTruthy();
    const q = ff!.requests.find((r) => r.startsWith('/api/attention'))!;
    expect(q).toContain('from=2026-09-01');
  });

  it('a failed attention check says so instead of "Nothing needs attention"', async () => {
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/attention': new Response('{"error":"down"}', { status: 500 }) });
    expect(await screen.findByText("Couldn't load the attention check.")).toBeTruthy();
    expect(screen.queryByText('Nothing needs attention.')).toBeNull();
  });

  it('a drift finding with a projection carries the station sheet sentence, with its assumption', async () => {
    const projection = { slopeGPerDay: 1.2, overDays: 5, towards: 'upper', limitG: 2000, targetG: 1950, distanceG: 30, daysToLimit: 25, status: 'projected' };
    const att = { ...pd.attention, findings: [{ kind: 'station_drift', requirement: 5, screen: 'weight', station: 5, deltaG: 9, days: 4, projection }], totalFindings: 1 };
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/attention': env(att) });
    const region = await screen.findByRole('region', { name: 'Needs attention' });
    expect(within(region).getByRole('button').textContent).toMatch(/\+1\.2 g/);
  });

  it('a drift finding opens the station sheet; the others hop to their new homes', async () => {
    const att = {
      ...pd.attention,
      findings: [
        { kind: 'station_drift', requirement: 5, screen: 'weight', station: 5, deltaG: 9, days: 4 },
        { kind: 'reject_rise', requirement: 4, screen: 'rejects', rejectKind: 'quality', sinceUtc: '2026-09-01T10:00:00Z', ratePct: 8.2, usualPct: 4.4 },
        { kind: 'outside_product_limits', requirement: 2, screen: 'readings' },
      ],
      totalFindings: 4,
    };
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/attention': env(att) });
    const region = await screen.findByRole('region', { name: 'Needs attention' });
    const rows = within(region).getAllByRole('button');
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain('Failed inspection has been rising since 10:00');
    fireEvent.click(rows[0]!);
    expect(go.mock.calls.at(-1)![0].sheet).toEqual({ kind: 'station', id: '5' });
    fireEvent.click(rows[1]!);
    expect(go.mock.calls.at(-1)![0]).toMatchObject({ s: 'quality', t: 'rejects' });
    fireEvent.click(rows[2]!);
    expect(go.mock.calls.at(-1)![0]).toMatchObject({ s: 'quality', t: 'register', keys: { rf: 'outsideLimits' } });
    expect(screen.getByText(/1 more finding on Quality\./)).toBeTruthy();
  });

  it('latest readings use the two verdict words and open the cone and sack sheets', async () => {
    mount();
    const cone = await screen.findByText(/Passed weight check · Station 1 · /);
    expect(cone.textContent?.replace(/ /g, ' ')).toContain('1,967 g');
    fireEvent.click(cone);
    expect(go.mock.calls.at(-1)![0].sheet).toEqual({ kind: 'cone', id: '952787' });
    fireEvent.click(screen.getByText(/47\.34 kg · Passed weight check/));
    expect(go.mock.calls.at(-1)![0].sheet).toEqual({ kind: 'sack', id: '37456' });
    expect(screen.getAllByText(/Station 8 · /).length).toBeGreaterThan(0);
  });
});

describe('sack section (A3-031, A3-044, A3-045)', () => {
  it('counts, kilograms, average, scale verdict, by shift and by product (names told apart)', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Sacks by product' })).toBeTruthy();
    const sec = screen.getByRole('region', { name: 'Sacks' });
    expect(sec.textContent).toContain('133');
    expect(sec.textContent).toContain('6,296.7 kg');
    expect(sec.textContent).toContain('47.3 kg');
    expect(sec.textContent).toContain('82.7 %');
    expect(sec.textContent).toContain('23.2');
    // four materials share one description: the by-product rows must not read as four identical names
    const names = within(sec).getAllByRole('row').map((r) => r.textContent ?? '').filter((t) => t.includes('205-IL0-SD'));
    expect(new Set(names.map((n) => n.slice(0, 30))).size).toBeGreaterThan(1);
  });

  it('the unit toggle writes su and keeps the rest of the route', async () => {
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01&cmp=prev');
    const kg = await screen.findByRole('radio', { name: 'kg' });
    fireEvent.click(kg);
    expect(go.mock.calls.at(-1)![0].keys).toMatchObject({ su: 'kg', cmp: 'prev', p: 'pick' });
  });

  it('reads su=kg from the URL', async () => {
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01&su=kg');
    const kg = await screen.findByRole('radio', { name: 'kg' });
    expect(kg.getAttribute('aria-checked')).toBe('true');
  });

  it('a failed sack summary is named, and the cone figures stay', async () => {
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01', { '/api/sacks/summary': new Response('{"error":"down"}', { status: 500 }) });
    expect(await screen.findByText("Couldn't load the sack summary.")).toBeTruthy();
    await waitFor(() => expect(card('Cones').textContent).toContain('3,089'));
    fireEvent.click(screen.getByText('About these figures'));
    expect(await screen.findByText(/Not loaded at the moment: the sack summary\./)).toBeTruthy();
  });
});

describe('every old Line and Sacks hop still exists (A6-H14)', () => {
  it('links to the register, sack list, failed inspections, outside limits, sack stock, sack weights and the Products board', async () => {
    const machines = JSON.parse(JSON.stringify(pd.machinesRunning));
    const m = machines.machines.find((x: { station: number }) => x.station === 14);
    m.lastChange = { fromMaterialId: 1021, fromProductName: 'x', atUtc: '2026-09-01T20:56:41.517Z' };
    mount('/?s=today&p=pick&from=2026-09-01&to=2026-09-01&cmp=prev', { '/api/machines/running': env(machines) });
    await screen.findByRole('heading', { name: 'Sacks by product' });
    const hrefs = [...document.querySelectorAll('a.ui-link')].map((a) => a.getAttribute('href') ?? '');
    const has = (...parts: string[]) => hrefs.some((h) => parts.every((p) => h.includes(p)));
    expect(has('s=quality', 't=register')).toBe(true); // cones -> readings
    expect(has('s=quality', 't=register', 'rl=sacks')).toBe(true); // sacks -> sack list
    expect(has('s=quality', 't=rejects')).toBe(true); // failed -> rejects
    expect(has('s=quality', 't=register', 'rf=outsideLimits')).toBe(true); // outside limits -> readings filter
    expect(has('s=quality', 't=register', 'rl=stock')).toBe(true); // sack stock
    expect(has('s=quality', 't=weight', 'wt=sack')).toBe(true); // sack weights
    expect(has('s=products', 't=board')).toBe(true); // product -> Products
    // the period travels with every hop
    for (const h of hrefs.filter((x) => x.includes('s=quality'))) expect(h).toContain('cmp=prev');
  });
});

describe('empty period (X-3)', () => {
  const emptyProd = {
    groupBy: 'none', rows: [], unattributed: null, states: { within: 0, low: 0, high: 0, rejected: 0, unknown: 0 }, implausible: 0,
  };
  it('names the newest data and offers it, and prints no zeros', async () => {
    mount('/?s=today&p=pick&from=2026-10-13&to=2026-10-13', { '/api/production': env(emptyProd) });
    expect(await screen.findByText(/Nothing in this period\. Newest data: 7 Sep 2026\./)).toBeTruthy();
    expect(screen.getByText('Nothing has been recorded in this period.')).toBeTruthy();
    expect(card('Cones').textContent).not.toMatch(/\b0\b/);
    fireEvent.click(screen.getByRole('button', { name: 'Show 7 Sep 2026' }));
    await waitFor(() => expect(window.location.search).toContain('from=2026-09-07'));
    expect(screen.queryByRole('region', { name: 'Sacks' })).toBeNull();
  });

  it('a live empty period warns that the line may be stopped, with the age on the plant clock', async () => {
    mount('/?s=today&p=shift', { '/api/production': env(emptyProd) });
    expect(await screen.findByText(/The line may be stopped or data is delayed\. The newest reading is/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the Diagnostics tab' })).toBeTruthy();
  });
});

describe('phone and plant PC share one structure (DESIGN-SYSTEM 8)', () => {
  it('page template order: band, KPI row, stations, then detail', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.tile')).not.toBeNull());
    const order = [...container.querySelector('.today')!.children].map((e) => e.className.split(' ')[0]);
    expect(order.indexOf('band')).toBe(0);
    expect(order.indexOf('today-kpis')).toBe(1);
    expect(order.indexOf('today-kpis')).toBeLessThan(order.findIndex((c) => c === 'card'));
    expect(container.querySelectorAll('.today-kpis .kpi')).toHaveLength(5);
  });
});
