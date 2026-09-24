/**
 * A sheet is an OVERLAY — opening one must not rebuild the screen under it.
 *
 * 23 Sep 2026. `App.tsx` keyed the screen-area `<ErrorBoundary>` on
 * `route.view` AND `route.sheet`, so every drilldown click changed the key
 * and React remounted the whole screen behind the overlay. Every
 * `usePolling` hook on it lost its data and refetched from null, and for one
 * to two seconds the screen asserted numbers it did not have. Reproduced in
 * a browser on Readings › This month at 1366×768, click-to-settled:
 *
 *     149,492 weighed, 402 rejected by the scale (0.3%).   ← settled
 *     0 weighed, 0 rejected by the scale (0%).             ← +14 ms
 *     0 weighed, 402 rejected by the scale (0%).           ← +194 ms
 *     149,492 weighed, 402 rejected by the scale (0.3%).   ← +235 ms
 *
 * The third line cannot exist: no cones weighed and 402 of them rejected, at
 * a stated rate of 0%. It is two figures that must agree, drawn from two
 * independent polls that were in different states — the reject count
 * (pageSize 1) landing before the register's own count.
 *
 * Two defects, so two guards here:
 *
 *  1. THE REMOUNT. `does not remount the screen` below holds a direct
 *     reference to a DOM node inside the screen across a sheet open and
 *     asserts it is the SAME node afterwards. A remount replaces it, so this
 *     test fails the moment `route.sheet` goes back into that key — which is
 *     the point, since nothing else in the suite would notice.
 *  2. THE IMPOSSIBLE PAIR, which is a separate bug and would survive any
 *     mount fix: the headline took both counts as plain numbers defaulted
 *     with `?? 0`. `never prints a count it does not have` drives a real
 *     mount with the register's own count deliberately held in flight while
 *     the reject count answers, which is exactly the race above.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { render } from './testkit/render';
import { installFakeFetch, type FakeFetch, type RouteRequest } from './testkit/fetchRouter';
import { LIVE_FIXTURE, META_FIXTURE } from './testkit/fixtures';
import { App } from './App';
import { W } from './lib/words';
import type { Envelope, RegisterPage, RegisterRow, ReportHeader, ProductAtData, StationRow } from './api';

/* --------------------------------------------------------------- fixtures */

const ROW: RegisterRow = {
  event_id: 512044, source_row_id: 132551, source_epoch: 2, source_epoch_label: 'September copy — cones',
  production_ts_utc: '2026-09-07T16:40:58Z', shift_code: 'evening', shift_date: '2026-09-07',
  shift_code_legacy: 'evening', hanger_num: 14, source_station: 5, lifter_station: 5,
  weight_g: 1948.2, in_range: true, material_id: 231, lot_code: null, merge_key_is_unique: true,
};

/** The register's own count, and the separate scale-reject count. Deliberately
 *  a pair no sane API could ever swap: 1,000 weighed, 402 rejected. */
const WEIGHED_TOTAL = 1000;
const REJECTED_TOTAL = 402;

function page(total: number): Envelope<RegisterPage> {
  return { data: { rows: [ROW], total, page: 1, pageSize: 100 }, metadata: META_FIXTURE };
}

const STATIONS: { stations: StationRow[] } = {
  stations: [{ stationId: 5, name: 'Station 5', machine: 'M5', description: null, isActive: true }],
};

const HEADER: ReportHeader = {
  reportType: 'register', title: 'Readings', lineName: 'TP1 · Line 3 · Unit 2',
  plantName: 'TP1', unitName: 'Unit 2',
  period: { period: 'shift', from: '2026-09-07', to: '2026-09-07', days: 1 },
  filters: {}, generatedAtPlantUtc: '2026-09-07T16:41:00Z', generatedBy: 'test-user',
  smsVersion: '1.0.0', definitions: 'KPI-DEFINITIONS.md', approval: 'awaiting',
  spansGenerations: false, sourceGeneration: null, otherGenerationExcluded: null,
};

const PRODUCT_AT: ProductAtData = {
  at: '2026-09-07T16:40:58Z',
  product: { productId: 231, label: '30s combed', effectiveFromUtc: '2026-09-01T00:00:00Z' } as ProductAtData['product'],
  limits: { targetG: 1960, loG: 1930, hiG: 1990, label: '1,960 ± 30 g' },
  neverRecorded: false, attribution: 'row', verdict: null, limitsAreLowerBound: false,
};

/**
 * Readings asks `/api/events` twice on every key, for two different
 * populations — the register page itself, and the count of cones the SCALE
 * rejected (`inRange=false`, `pageSize=1`, Readings.tsx's `rejected` poll).
 * Both land on the same pathname, so the router has to tell them apart the
 * same way the server does: by the query.
 */
function isRejectCount(req: RouteRequest): boolean {
  return req.search.get('inRange') === 'false' && req.search.get('pageSize') === '1';
}

let fake: FakeFetch | null = null;

function mount(routes: Record<string, unknown>) {
  window.history.replaceState(null, '', '/?s=readings');
  fake = installFakeFetch({
    '/api/auth/me': { user: { username: 'test-user', displayName: 'Test User', role: 'manager' } },
    '/api/live': LIVE_FIXTURE,
    '/api/stations': STATIONS,
    '/api/reports/header': HEADER,
    '/api/product-at': PRODUCT_AT,
    '/api/events/cone/512044': { row: ROW },
    ...routes,
  });
  return render(<App />);
}

afterEach(() => {
  fake?.restore();
  fake = null;
  window.history.replaceState(null, '', '/');
});

/** Every `/api/events` list request so far, excluding the reject count. */
function listRequestCount(f: FakeFetch): number {
  return f.requests.filter((r) => r.startsWith('/api/events?') && !r.includes('inRange=false')).length;
}

describe('a drilldown sheet is an overlay, not a new screen', () => {
  it('does not remount the screen underneath when a sheet opens', async () => {
    const { container } = mount({
      '/api/events': (req: RouteRequest) => page(isRejectCount(req) ? REJECTED_TOTAL : WEIGHED_TOTAL),
    });

    // Wait for the register to settle on its real, complete headline.
    const expected = W.readings.countLine('1,000', '402', '40.2%');
    await waitFor(() => {
      expect(container.querySelector('main h1')?.textContent).toContain(expected);
    });

    // Direct references to live DOM nodes inside the screen. React replaces
    // these on a remount and reuses them on a re-render, which is exactly the
    // distinction this test exists to make — a text assertion alone would
    // pass again a second or two later, once the refetch landed.
    const tableBefore = container.querySelector('main table');
    const headlineBefore = container.querySelector('main h1');
    expect(tableBefore).toBeTruthy();
    const listsBefore = listRequestCount(fake!);

    // Open the reading's own sheet, the way the register's rows do.
    const cell = Array.from(container.querySelectorAll('main table td')).find(
      (td) => td.textContent?.trim() === '512044',
    );
    expect(cell).toBeTruthy();
    fireEvent.click(cell!.closest('tr')!);

    // The sheet is open...
    await waitFor(() => {
      expect(container.querySelector('.sheet')).toBeTruthy();
    });

    // ...and the screen beneath it was never torn down.
    expect(container.querySelector('main table')).toBe(tableBefore);
    expect(container.querySelector('main h1')).toBe(headlineBefore);
    // Which is also the cost half of it: a remounted screen refires every
    // poll on it from nothing. Opening an overlay asks the register for
    // nothing at all.
    expect(listRequestCount(fake!)).toBe(listsBefore);
    // And the headline never flickered off its settled answer.
    expect(container.querySelector('main h1')?.textContent).toContain(expected);
  });

  it('never prints a count it does not have, even mid-fetch', async () => {
    // The register's own count is held in flight; the reject count answers at
    // once. This is the ordering that put `0 weighed, 402 rejected by the
    // scale (0%)` on screen.
    let releaseRegister: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      releaseRegister = resolve;
    });

    const { container } = mount({
      '/api/events': async (req: RouteRequest) => {
        if (isRejectCount(req)) return page(REJECTED_TOTAL);
        await held;
        return page(WEIGHED_TOTAL);
      },
    });

    // The reject count has landed and the register's has not.
    await waitFor(() => {
      expect(fake!.requests.some((r) => r.includes('inRange=false'))).toBe(true);
    });
    await waitFor(() => {
      expect(container.querySelector('main h1')?.textContent).toContain(W.readings.countLinePending);
    });

    const midFetch = container.querySelector('main h1')?.textContent ?? '';
    // The two assertions the old headline failed: it must not state a count
    // of zero it was never told, and it must not pair one with a count it
    // WAS told.
    expect(midFetch).not.toContain('0 weighed');
    expect(midFetch).not.toContain('402');

    releaseRegister!();
    await waitFor(() => {
      expect(container.querySelector('main h1')?.textContent)
        .toContain(W.readings.countLine('1,000', '402', '40.2%'));
    });
  });
});
