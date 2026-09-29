/**
 * Chart overhaul, Task T8a (29 Sep 2026; click-to-zoom rewrite, Task W2, same
 * date) — the zoom/back mechanics App.tsx and ui/Bar.tsx now own:
 *
 *  - a chart click-to-zoom's shift-snapped whole-page period reaching the
 *    URL through `zoomTo` (App.tsx's `ZoomContext`, wired into StationSheet's
 *    own `onSelectPeriod` prop — the one built-in call site this task had to
 *    connect; StationSheet.tsx's own header explicitly left this to "Task
 *    T8", see screens/StationSheet.tsx);
 *  - the bar's period button showing the period in plain, COLLAPSED words
 *    (`describePeriod`, collapsed by the owner 29 Sep 2026 — see
 *    `lib/period.ts`) once one is set, active/pressed like any other period
 *    choice;
 *  - the "Back to previous range" control in the bar, present only while
 *    `history.state.zoomFrom` is set, and `history.back()` (both via that
 *    control and via real Back/Forward navigation) restoring the period that
 *    was zoomed away from;
 *  - `go()`'s REPLACE path preserving `history.state` (so panning inside a
 *    zoomed-in range — any `{ replace: true }` call — does not silently drop
 *    the zoom the reader would still want to undo), proven here through the
 *    one existing `{ replace: true }` call site, Readings' own pager.
 *
 * Drives the real `<App/>` against a fake fetch, the same idiom `hops.
 * test.tsx` and `rank.matrix.test.tsx` use. The click sequence against
 * StationSheet's daily-means chart is the same one `StationSheet.test.tsx`
 * already exercises in isolation — this file proves the OTHER end of that
 * wiring, the part living in App.tsx/Bar.tsx. There is no drag any more
 * (Task W1/W2, 29 Sep 2026: drag-to-select is removed everywhere), so this
 * proves a single click zooms to that one day, not a multi-day span.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen as rtlScreen, waitFor } from '@testing-library/react';
import { renderApp } from './testkit/render';
import type { Routes } from './testkit/fetchRouter';
import { LIVE_FIXTURE, META_FIXTURE, OPERATIONS_FIXTURE } from './testkit/fixtures';
import { W } from './lib/words';
import type {
  AdjustmentList, Envelope, HealthReport, ReconciliationData, RegisterPage, StationRow,
  SystemHistoryData, WeightStationsData,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

/* --------------------------------------------------------------- fixtures */

const STATIONS_FIXTURE: { stations: StationRow[] } = {
  stations: [{ stationId: 7, name: 'Station 7', machine: null, description: null } as StationRow],
};

const DAYS: WeightStationsData['stations'][number]['days'] = [
  { date: '2026-08-25', n: 40, mean: 1930, nelson: [] },
  { date: '2026-08-26', n: 42, mean: 1935, nelson: [] },
  { date: '2026-08-27', n: 38, mean: 1948, nelson: [] },
  { date: '2026-08-28', n: 44, mean: 1952, nelson: [] },
];

const WEIGHT_STATIONS_FIXTURE: Envelope<WeightStationsData> = {
  data: {
    from: '2026-08-25', to: '2026-09-07', days: 14, lineMeanG: 1935, targetG: 1950,
    productId: 12, productLabel: 'Test product', thresholdG: 15, minDaysHeld: 3, lineRejectRatePct: 1.0,
    stations: [{
      station: 7, n: 164, meanG: 1941, vsLineG: 6, vsTargetG: -9, daysHeld: 4, flagged: false,
      rejectRatePct: 1.2, lastAdjustedUtc: null, days: DAYS, medianG: 1940, sdG: 8.1, restartedOn: null,
      centrelineG: 1935, sigmaDayToDay: 4.2, longestRun: 4, projection: null, targetBasis: 'station_material',
    }],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 100, unjudged: 0 },
    limits: null, rules: [], targetEffectiveFromUtc: '2026-08-01T00:00:00Z',
    limitsChangedInWindow: 0, productChangesInWindow: 0,
  } as WeightStationsData,
  metadata: META_FIXTURE,
};

const ADJUSTMENTS_FIXTURE: AdjustmentList = { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: 7 };

// total (120) > pageSize (50) so Readings' own Pager (the app's one existing
// `{ replace: true }` call site) actually renders a "Next" control.
const REGISTER_PAGE_FIXTURE_PAGED: Envelope<RegisterPage> = {
  data: {
    rows: [{
      event_id: 1, source_row_id: 1, source_epoch: 2, source_epoch_label: 'September copy',
      production_ts_utc: '2026-09-07T16:40:58Z', shift_code: 'evening', shift_date: '2026-09-07',
      shift_code_legacy: 'evening', hanger_num: 1, source_station: 7, lifter_station: 7,
      weight_g: 1948.2, in_range: true, material_id: null, lot_code: null, merge_key_is_unique: true,
    }],
    total: 120, page: 1, pageSize: 50,
  },
  metadata: META_FIXTURE,
};

const HEALTH_FIXTURE: HealthReport = {
  status: 'ok',
  service: { version: 'test', uptimeSeconds: 3600, startedAtUtc: '2026-09-07T00:00:00Z', pid: 1 },
  database: { ok: true, latencyMs: 4, sizeMb: 120, capMb: 10240, pctOfCap: 1.2 },
  acquisition: { kind: 'ok', ageSeconds: 42, cadenceSeconds: 60, halted: null, generation: LIVE_FIXTURE.data.lines[0]!.generation },
  backup: { dir: 'C:\\backups', newestFile: 'sidecar.bak', newestAtUtc: '2026-09-07T03:00:00Z', ageDays: 0.5, warning: false, verified: true, newestUnverified: false },
  degradedReason: null,
  pdasWrite: { enabled: false, canReadBack: null, missingSelect: [], missingExecute: [], unverifiedSinceStartup: [], lastVerifiedUtc: null },
  disk: { appDataFreeMb: 5000, backupFreeMb: 5000 },
  lastVerifyRunUtc: null,
  workerLastPassUtc: '2026-09-07T03:00:00Z',
};

const RECONCILIATION_FIXTURE: Envelope<ReconciliationData> = {
  data: {
    from: '2026-09-07', to: '2026-09-07', shift: null,
    total: { n: 0, sumG: 0, avgG: null, minG: null, maxG: null },
    plausible: { n: 0, sumG: 0, avgG: null, minG: null, maxG: null },
    implausible: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    noWeight: 0,
    byState: {
      within: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      low: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      high: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      rejected: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      unknown: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    },
    plausibility: { loG: 1500, hiG: 2500 },
    limitWindows: 0, basis: 'as_recorded', note: '',
  },
  metadata: META_FIXTURE,
};

const SYSTEM_HISTORY_FIXTURE: Envelope<SystemHistoryData> = {
  data: { generations: [], rebuilds: [], verifyRuns: [] },
  metadata: META_FIXTURE,
};

/** Routes every screen this file touches needs (Health, the station sheet,
 *  Readings) — an unregistered path throws loudly (fetchRouter's own rule),
 *  so a missing entry here fails the test, not silently. Health, not Line:
 *  kept as the mount point from the original task rather than switched to
 *  Line now that Line.tsx's own `brush`-shaped defect is long gone — no
 *  reason to touch an otherwise-unrelated route list. */
const ROUTES: Routes = {
  '/api/stations': STATIONS_FIXTURE,
  '/api/weight-stations': WEIGHT_STATIONS_FIXTURE,
  '/api/calibration/adjustments': ADJUSTMENTS_FIXTURE,
  '/api/events': REGISTER_PAGE_FIXTURE_PAGED,
  '/api/health': HEALTH_FIXTURE,
  '/api/operations': OPERATIONS_FIXTURE,
  '/api/system-history': SYSTEM_HISTORY_FIXTURE,
  '/api/reconciliation': RECONCILIATION_FIXTURE,
  '/api/data-batch': { data: { batches: [] }, metadata: META_FIXTURE },
};

/* --------------------------------------------------------------- helpers */

function urlFor(params: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) p.set(k, v);
  return `?${p.toString()}`;
}

function boot(initialSearch: string, initialState: unknown = null) {
  window.history.pushState(initialState, '', initialSearch);
  return renderApp({ role: 'admin', routes: ROUTES });
}

async function waitForChartBody(): Promise<HTMLElement> {
  for (let i = 0; i < 40; i++) {
    const body = document.querySelector('.chart-frame-body');
    if (body) return body as HTMLElement;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error('chart-frame-body never rendered');
}

/** The exact click sequence `StationSheet.test.tsx` uses: a pointerdown/
 *  pointerup at the SAME point (no drag), x=0 — `hit()`'s nearest-index
 *  match (no y bound in `DailyMeans`) lands this on the first day, 25 Aug,
 *  which zooms to that one day's own D.morning..D.night span. */
function fireChartClick(body: HTMLElement) {
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 });
  Object.defineProperty(down, 'pointerId', { value: 1 });
  Object.defineProperty(down, 'pointerType', { value: 'mouse' });
  const up = new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 });
  Object.defineProperty(up, 'pointerId', { value: 1 });
  Object.defineProperty(up, 'pointerType', { value: 'mouse' });

  act(() => body.dispatchEvent(down));
  act(() => body.dispatchEvent(up));
}

/* ------------------------------------------------------------------ tests */

describe('Task T8a — a chart zoom, the bar\'s control, and history.back()', () => {
  it('a click on the station sheet\'s first day pushes that day\'s period, the bar shows it collapsed and offers the undo, and history.back() restores the previous period', async () => {
    boot(urlFor({ s: 'health', sheet: 'station:7' }));

    await waitFor(() => expect(rtlScreen.getByRole('navigation')).toBeTruthy());
    // No zoom yet: the bar offers no undo, and the period button reads the
    // plain fallback word, not a describePeriod range.
    expect(rtlScreen.queryByRole('button', { name: W.chart.backToPreviousRange })).toBeNull();
    expect(rtlScreen.getByRole('button', { name: W.period.range, pressed: false })).toBeTruthy();

    const chartBody = await waitForChartBody();
    fireChartClick(chartBody);

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('p')).toBe('range');
    });
    // One day, D.morning..D.night — a click zooms to the day it landed on,
    // not a multi-day span (there is no second endpoint any more).
    expect(window.location.search).toContain('from=2026-08-25.morning');
    expect(window.location.search).toContain('to=2026-08-25.night');

    // history.state now remembers the period being left — the default shift
    // period, since neither ?p= nor sheet/view carried anything else here.
    expect((window.history.state as { zoomFrom?: { key: string } } | null)?.zoomFrom).toEqual({ key: 'shift' });

    // The bar's period button now shows the COLLAPSED wording (owner 29 Sep
    // 2026, `describePeriod`) for a whole single day — "25 Aug", not the
    // longer "25 Aug morning shift – 25 Aug night shift" the un-collapsed
    // form would have printed — pressed, same button, not a second control.
    const rangeBtn = await waitFor(() => rtlScreen.getByRole('button', { name: '25 Aug', pressed: true }));
    expect(rangeBtn).toBeTruthy();

    // ...and the undo is now offered.
    const backBtn = rtlScreen.getByRole('button', { name: W.chart.backToPreviousRange });
    expect(backBtn).toBeTruthy();

    fireEvent.click(backBtn);

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has('p')).toBe(false);
    });
    // Back to the default shift period: the range button reverts to the
    // plain fallback word and the undo disappears — there is nowhere left to
    // go back to.
    expect(rtlScreen.getByRole('button', { name: W.period.range, pressed: false })).toBeTruthy();
    expect(rtlScreen.queryByRole('button', { name: W.chart.backToPreviousRange })).toBeNull();
  });

  it('a plain screen navigation (a push with no zoomFrom) drops the undo — a zoom is not carried into an unrelated navigation', async () => {
    boot(urlFor({ s: 'health', sheet: 'station:7' }));
    await waitFor(() => expect(rtlScreen.getByRole('navigation')).toBeTruthy());

    fireChartClick(await waitForChartBody());
    await waitFor(() => expect(rtlScreen.getByRole('button', { name: W.chart.backToPreviousRange })).toBeTruthy());

    fireEvent.click(rtlScreen.getByRole('button', { name: W.nav.readings }));

    await waitFor(() => expect(rtlScreen.getAllByText(W.nav.readings).length).toBeGreaterThan(0));
    expect(rtlScreen.queryByRole('button', { name: W.chart.backToPreviousRange })).toBeNull();
  });
});

describe('Task T8a — go()\'s REPLACE path preserves history.state (a pan must not drop a zoom)', () => {
  it('Readings’ own pager — the app’s one existing `{ replace: true }` call site — leaves `history.state.zoomFrom` untouched', async () => {
    // Simulate a page that is already mid-zoom: a range period, with
    // history.state.zoomFrom set exactly as zoomTo() would have left it.
    boot(
      urlFor({ s: 'readings', p: 'range', from: '2026-08-25.morning', to: '2026-08-28.night' }),
      { zoomFrom: { key: 'shift' } },
    );

    await waitFor(() => expect(rtlScreen.getAllByText(W.nav.readings).length).toBeGreaterThan(0));
    expect(rtlScreen.getByRole('button', { name: W.chart.backToPreviousRange })).toBeTruthy();

    const nextBtn = await waitFor(() => rtlScreen.getByRole('button', { name: new RegExp(W.readings.next) }));
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('rp')).toBe('2');
    });
    // The range period itself is untouched by paging...
    expect(new URLSearchParams(window.location.search).get('p')).toBe('range');
    // ...and, the point of this test, `zoomFrom` survived the replace — a
    // pan (any `{ replace: true }` call) must not silently drop the undo.
    expect((window.history.state as { zoomFrom?: { key: string } } | null)?.zoomFrom).toEqual({ key: 'shift' });
    expect(rtlScreen.getByRole('button', { name: W.chart.backToPreviousRange })).toBeTruthy();
  });
});
