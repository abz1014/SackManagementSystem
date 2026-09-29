/**
 * Re-audit fix (29 Sep 2026), FIX 1: a mouse click on a chart mark never
 * called `onActivate` — `ChartFrame.tsx`'s `onWrapperPointerUp` only ever
 * handled `touch`, and `onActivate` was otherwise reachable only via the
 * Enter key. On Line's own station-deviation chart (`StationCompare` in
 * Line.tsx, built on `DeviationBars`/`ChartFrame`), the tooltip's hint says
 * "Open station N", but clicking the bar did nothing.
 *
 * This drives the REAL chart — `LineScreen` mounted with real production
 * data, `DeviationBars` computing real bar geometry against
 * `useChartSize`'s deterministic jsdom fallback width (1036px, no
 * ResizeObserver firing under the default `installDomStubs()`) — not a
 * mocked `hit`/`onActivate` pair. The click coordinates are read directly
 * off the rendered `<rect>`'s own `x`/`y`/`width`/`height` attributes, so
 * this cannot silently pass against geometry that moved out from under it.
 *
 * `ChartFrame.tsx`'s own `ChartFrame.test.tsx` (owned by this same fix)
 * covers the click-activation contract directly against a mocked `hit`; this
 * file is the integration proof that a real caller (Line) wires up to it
 * correctly end to end, down to `onOpenStation` — the same callback
 * `App.tsx` wires straight to `go({ sheet: { kind: 'station', id } })`,
 * i.e. the URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import type { Envelope, ProductionData, ProductionRow } from '../api';
import { LineScreen } from './Line';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsTo: '2026-09-07T23:59:59.000Z',
  live: true,
  days: 1,
};

const STATIONS_OK = { stations: [] };

const BASE_ROUTES = {
  '/api/live': LIVE_FIXTURE,
  '/api/stations': STATIONS_OK,
  '/api/product-at': { product: null, limits: null, neverRecorded: true },
  '/api/products': { products: [] },
  '/api/attention': {
    data: {
      window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
      period: { from: '2026-09-07', to: '2026-09-07', shift: null },
      findings: [], totalFindings: 0, thresholds: { driftG: 15, minDaysHeld: 3 },
    },
    metadata: META_FIXTURE,
  },
  '/api/machines/running': {
    data: {
      asOfUtc: '2026-09-07T16:40:00Z',
      windowMs: 7_200_000,
      windowStartUtc: '2026-09-07T14:40:00Z',
      machines: [],
      materialsRunning: 0,
      generation: LIVE_FIXTURE.data.lines[0]!.generation,
    },
    metadata: META_FIXTURE,
  },
};

// Three stations, IDs 1/2/3 ascending — StationCompare sorts on `stationIds`,
// so index 1 of the rendered bars is station 2.
const STATION_ROWS: ProductionRow[] = [
  { group: '1', cones: 800, rejectedCones: 10, unmatchedRejects: 8, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null },
  { group: '2', cones: 750, rejectedCones: 5, unmatchedRejects: 5, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null },
  { group: '3', cones: 700, rejectedCones: 3, unmatchedRejects: 2, sacks: 0, sackWeightKg: 0, conesInRangePct: null, sacksPassedScalePct: null },
];

const TOTALS_ROW: ProductionRow = {
  group: 'total', cones: 2250, rejectedCones: 18, unmatchedRejects: 15, sacks: 90, sackWeightKg: 2500, conesInRangePct: 97, sacksPassedScalePct: 95,
};

function groupedRoute(rows: ProductionRow[], groupBy: ProductionData['groupBy']): Envelope<ProductionData> {
  return { data: { groupBy, rows, unattributed: null, states: null, implausible: null, dataIssues: [] }, metadata: META_FIXTURE };
}

function productionRouter() {
  return (req: RouteRequest) => {
    const groupBy = req.search.get('groupBy');
    if (groupBy === 'station') return groupedRoute(STATION_ROWS, 'station');
    if (groupBy === 'day' || groupBy === 'shift') return groupedRoute([], groupBy);
    return groupedRoute([TOTALS_ROW], 'none');
  };
}

function props(onOpenStation: (n: number) => void) {
  return {
    period: PERIOD,
    onNavigate: noop,
    onOpenStation,
    onOpenReading: noop,
    onOpenProduct: noop,
    canWrite: false,
  };
}

/** Same technique as ui/ChartFrame.test.tsx's own `firePointer`: jsdom does
 *  not construct a real PointerEvent from fireEvent's init dict, so a
 *  MouseEvent is dispatched under the pointer* event names with pointerId/
 *  pointerType defined directly on it. */
function firePointer(el: Element, type: 'pointerdown' | 'pointerup', clientX: number, clientY: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1, configurable: true });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  el.dispatchEvent(ev);
}

describe('Line — clicking a bar on the station-deviation chart opens that station (re-audit FIX 1, 29 Sep 2026)', () => {
  it('a mouse click on station 2\'s bar calls onOpenStation(2) — real chart geometry, no synthetic hit/onActivate mocks', async () => {
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter() });
    const onOpenStation = vi.fn();

    const { container } = renderWithLive(<LineScreen {...props(onOpenStation)} />);

    // Wait for the real chart to render all three bars.
    let rects: NodeListOf<SVGRectElement> | null = null;
    await vi.waitFor(() => {
      const svg = container.querySelector(`svg[aria-label="${W.stationsCompareAria}"]`);
      const found = svg?.querySelectorAll('rect') ?? null;
      expect(found?.length).toBe(3);
      rects = found;
    });

    const bar = rects![1]!; // index 1 -> station 2 (ascending station ids)
    const chartBody = bar.closest('.chart-frame-body') as HTMLElement;
    expect(chartBody).toBeTruthy();

    const x = Number(bar.getAttribute('x'));
    const w = Number(bar.getAttribute('width'));
    const y = Number(bar.getAttribute('y'));
    const h = Number(bar.getAttribute('height'));
    const cx = x + w / 2;
    const cy = y + h / 2;

    // A plain click: pointerdown and pointerup at the SAME point (no drag).
    firePointer(chartBody, 'pointerdown', cx, cy);
    firePointer(chartBody, 'pointerup', cx, cy);

    expect(onOpenStation).toHaveBeenCalledTimes(1);
    expect(onOpenStation).toHaveBeenCalledWith(2);
  });

  it('a drag across the chart (past the click-vs-drag threshold) does NOT call onOpenStation', async () => {
    installFakeFetch({ ...BASE_ROUTES, '/api/production': productionRouter() });
    const onOpenStation = vi.fn();

    const { container } = renderWithLive(<LineScreen {...props(onOpenStation)} />);

    let rects: NodeListOf<SVGRectElement> | null = null;
    await vi.waitFor(() => {
      const svg = container.querySelector(`svg[aria-label="${W.stationsCompareAria}"]`);
      const found = svg?.querySelectorAll('rect') ?? null;
      expect(found?.length).toBe(3);
      rects = found;
    });

    const bar = rects![1]!;
    const chartBody = bar.closest('.chart-frame-body') as HTMLElement;
    const x = Number(bar.getAttribute('x'));
    const w = Number(bar.getAttribute('width'));
    const y = Number(bar.getAttribute('y'));
    const h = Number(bar.getAttribute('height'));
    const cx = x + w / 2;
    const cy = y + h / 2;

    // StationCompare offers no zoom (stations have no calendar position to
    // zoom to — see DeviationBars' own `zoom` prop doc), so this is just a
    // plain pointer movement past the click-vs-drag threshold — exactly the
    // case FIX 1's own brief calls out: "must not fire after a drag".
    firePointer(chartBody, 'pointerdown', cx, cy);
    firePointer(chartBody, 'pointerup', cx + 200, cy);

    expect(onOpenStation).not.toHaveBeenCalled();
  });
});
