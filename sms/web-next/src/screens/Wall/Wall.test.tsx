/**
 * TV wall (task E4). Ports the assertions of web/src/Wall.presence.test.tsx and
 * the Wall half of web/src/generationQuiet.test.tsx to the dark Style C screen.
 * TRACE rows verified here:
 *   A3-060 (state sentence is the biggest thing; quiet stations are a visible gap; Esc/exit; no logout),
 *   A7-15  (out of contact after 3 missed polls stops "Line 3 is running"; counts stay),
 *   A1-004 (the wall carries no logout).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { LiveProvider } from '../../../../web/src/lib/live';
import { installDomStubs } from '../../../../web/src/testkit/domStubs';
import { installFakeFetch, type Routes } from '../../../../web/src/testkit/fetchRouter';
import { GENERATION_FIXTURE, LIVE_FIXTURE } from '../../../../web/src/testkit/fixtures';
import type { Envelope, LiveData, LiveLine, StationStatusData, StationStatusRow } from '../../bridge/api';
import { W } from '../../bridge/words';
import { parseRoute } from '../../route';
import { WallScreen } from './Wall';

installDomStubs();

const BASE = LIVE_FIXTURE.data.lines[0]!;
const META = LIVE_FIXTURE.metadata;
const RANGE = { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 };
const USER = { username: 'u', displayName: 'U', role: 'viewer' } as never;

const ANCHOR = BASE.dataAsOfUtc!;
const OLD = new Date(new Date(ANCHOR).getTime() - 25 * 60_000).toISOString();

function liveWith(over: Partial<LiveLine>): Envelope<LiveData> {
  return { ...LIVE_FIXTURE, data: { lines: [{ ...BASE, ...over }] } };
}
const row = (station: number, over: Partial<StationStatusRow> = {}): StationStatusRow => ({
  station, name: null, cones: 300, failedPct: 2.5, state: 'ok', reasons: [], vsTargetG: null, product: 'Blue', ...over,
});
const status = (stations: StationStatusRow[], lineFailedPct: number | null = 4.6): Envelope<StationStatusData> => ({
  data: { from: '2026-09-07', to: '2026-09-07', lineFailedPct, thresholds: { watch: 1.5, act: 2, minCones: 50, assumed: true }, stations },
  metadata: META,
});
const production = (rows: unknown[]) => ({ data: { groupBy: 'none', rows, unattributed: null, states: null, implausible: null }, metadata: META });
const TOTAL = { group: 'total', cones: 3089, rejectedCones: 10, sacks: 133, sackWeightKg: 6296.7, conesInRangePct: 97 };
const SHIFTS = [
  { group: 'morning', cones: 1067, rejectedCones: 1, sacks: 40, sackWeightKg: 1, conesInRangePct: 97 },
  { group: 'evening', cones: 1001, rejectedCones: 1, sacks: 40, sackWeightKg: 1, conesInRangePct: 97 },
];

function routes(over: Routes = {}): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': RANGE,
    '/api/station-status': status([row(8, { state: 'act', failedPct: 53.9, cones: 412 }), row(9, { state: 'watch', failedPct: 23.1 }), row(10)]),
    '/api/production': ({ search }: { search: URLSearchParams }) => production(search.get('groupBy') === 'shift' ? SHIFTS : [TOTAL]),
    ...over,
  };
}

function mount() {
  window.history.replaceState(null, '', '/next/?wall=1');
  const route = parseRoute(new URLSearchParams('wall=1'));
  return render(
    <LiveProvider asOf={null}>
      <WallScreen route={route} rank={1} user={USER} go={() => {}} />
    </LiveProvider>,
  );
}

/** matchMedia that answers min-width queries for a viewport of this width (jsdom has none that matches). */
function viewport(width: number): void {
  window.matchMedia = ((q: string) => {
    const m = /min-width:\s*(\d+)px/.exec(q);
    return { matches: m ? width >= Number(m[1]) : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  viewport(1920);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Wall in dark Style C', () => {
  it('carries the dark class, names the line running, shows the plant clock as "Updated"', async () => {
    installFakeFetch(routes());
    const { container } = mount();
    await screen.findByText(/Line 3 is running/);
    const root = container.querySelector('.wall.dark');
    expect(root).not.toBeNull();
    expect(container.querySelector('.wl-clock')?.textContent).toMatch(/Updated\s*17:00/);
    expect(screen.queryByRole('button', { name: /sign out|log out/i })).toBeNull();
  });

  it('A3-060: station states arrive decided; Act and Watch lead and are counted in the sentence', async () => {
    installFakeFetch(routes());
    const { container } = mount();
    await screen.findByText('1 station needs action');
    expect(screen.getByText('1 to watch')).toBeTruthy();
    const tiles = Array.from(container.querySelectorAll('.wl-tile'));
    expect(tiles.map((t) => t.getAttribute('data-state'))).toEqual(['act', 'watch', 'ok']);
    expect(tiles[0]!.textContent).toContain('53.9 %');
  });

  it('shows the four figures and the per-shift bars', async () => {
    installFakeFetch(routes());
    const { container } = mount();
    await screen.findByText('3,089');
    expect(screen.getByText('133')).toBeTruthy();
    expect(container.querySelector('.k-pack')?.textContent).toContain('6,296.70');
    expect(container.querySelector('.k-insp')?.textContent).toContain('4.6');
    await waitFor(() => expect(container.querySelectorAll('.wl-shift')).toHaveLength(2));
    expect(within(container.querySelector('.wl-shifts') as HTMLElement).getByText('1,067')).toBeTruthy();
  });

  it('a stale feed says "Not updating since" and makes no running claim', async () => {
    installFakeFetch(routes({
      '/api/live': liveWith({ health: { ...BASE.health, kind: 'stale', ageSeconds: 4000 } as LiveLine['health'] }),
    }));
    const { container } = mount();
    await screen.findByText(/Not updating since/);
    expect(container.textContent).not.toMatch(/is running/);
    expect(container.querySelector('.wl')?.getAttribute('data-known')).toBe('no');
  });

  it('a data set that has ended is not asserted from; the footer says why', async () => {
    installFakeFetch(routes({
      '/api/live': liveWith({
        generation: { ...GENERATION_FIXTURE, spansGenerations: true, otherGenerationExcluded: 1, newerElsewhereUtc: '2026-09-22T12:29:22.000Z', newerElsewhereSourceDb: 'SIM', newerElsewhereLabel: 'x', newerElsewhereSimulator: true },
      }),
    }));
    const { container } = mount();
    await screen.findByText(/Not updating since/);
    expect(container.textContent).toMatch(/Newer|newer readings/);
    expect(container.textContent).not.toMatch(/is running/);
  });

  it('an unknown stopped duration is not printed as "0 s"', async () => {
    installFakeFetch(routes({
      '/api/live': liveWith({ state: { status: 'stopped', sinceLastReadingSeconds: null, behindSeconds: null, runStartUtc: null, stopThresholdSeconds: 120 } }),
    }));
    const { container } = mount();
    await screen.findByText(new RegExp(W.state.stoppedUnknownDuration.slice(0, 12)));
    expect(container.querySelector('.wl-hero')?.textContent).not.toMatch(/\b0\s*s\b/);
  });

  it('a failed station fetch is named and draws no tiles and no zero', async () => {
    installFakeFetch(routes({ '/api/station-status': new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }) }));
    const { container } = mount();
    await screen.findAllByText(/Could not read station status\./);
    expect(container.querySelectorAll('.wl-tile')).toHaveLength(0);
    expect(container.querySelector('.k-insp')?.textContent).toContain('Not available');
  });

  it('a failed production fetch shows "Not available" for the figures, never 0', async () => {
    installFakeFetch(routes({ '/api/production': new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }) }));
    const { container } = mount();
    await screen.findAllByText(/Could not read production figures\./);
    expect(container.querySelector('.k-cone .wl-kpi-value')?.textContent).toBe('Not available');
    expect(container.querySelector('.k-sack .wl-kpi-value')?.textContent).toBe('Not available');
  });

  it('a quiet station is a gap with the time it fell silent; a station with no live row is told apart', async () => {
    installFakeFetch(routes({
      '/api/live': liveWith({ stations: [{ station: 4, cones: 5, lastTs: OLD }, { station: 10, cones: 300, lastTs: OLD }] }),
      '/api/station-status': status([
        row(4, { state: 'nodata', failedPct: null, cones: 0 }),
        row(5, { state: 'nodata', failedPct: null, cones: 0 }),
        row(10),
      ]),
    }));
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('.wl-tile')).toHaveLength(3));
    const t = (n: number) => container.querySelector(`.wl-tile[data-station="${n}"]`) as HTMLElement;
    expect(t(4).textContent).toMatch(/No readings since/);
    expect(t(5).textContent).toMatch(/No cones/);
    expect(t(5).textContent).not.toMatch(/No readings since/);
    expect(t(4).textContent).toContain('–');
    expect(t(10).textContent).toMatch(/No cones since/);
  });

  it('refreshes by itself: /api/live is requested again after a poll interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = installFakeFetch(routes());
    mount();
    await screen.findByText(/Line 3 is running/);
    const before = f.requests.filter((r) => r.startsWith('/api/live')).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(f.requests.filter((r) => r.startsWith('/api/live')).length).toBeGreaterThan(before);
  });

  it('A7-15: after three missed polls the running claim stops but the counts stay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let ok = true;
    installFakeFetch(routes({
      '/api/live': () => (ok ? LIVE_FIXTURE : new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })),
    }));
    const { container } = mount();
    await screen.findByText(/Line 3 is running/);
    ok = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    await waitFor(() => expect(container.textContent).not.toMatch(/is running/));
    expect(container.textContent).toMatch(/Not updating since/);
    expect(container.querySelector('.k-cone .wl-kpi-value')?.textContent).toBe('3,089');
  });

  it('below 1024 px there is no wall: one sentence and a link back to Today (owner decision 13 Oct 2026)', async () => {
    viewport(375);
    installFakeFetch(routes());
    const { container } = mount();
    expect(await screen.findByText('The TV wall is designed for a large screen')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Today' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('?s=today');
    expect(container.querySelector('.wl-tile')).toBeNull();
    expect(container.querySelector('.wl-kpis')).toBeNull();
  });

  it('at exactly 1024 px the wall draws', async () => {
    viewport(1024);
    installFakeFetch(routes());
    mount();
    await screen.findByText(/Line 3 is running/);
  });

  it('offers a small exit link that leaves the wall', async () => {
    installFakeFetch(routes());
    mount();
    const link = (await screen.findByRole('link', { name: 'Exit wall' })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).not.toMatch(/wall=1/);
  });
});
