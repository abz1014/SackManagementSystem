/**
 * UX Phase 8 Brief C: the failed-fetch-reads-as-zero defect class, locked
 * down for Readings' headline (`countLine`, Readings.tsx:307-349 — private,
 * reached only through the mounted component) and its station-filter chip.
 *
 * Two independent polls feed the headline — the register itself
 * (`pageSize=100`, the default `PAGE_SIZE`) and a separate scale-reject
 * count (`pageSize=1`) — both against `/api/events`, distinguished here by
 * that query parameter exactly the way the brief calls out. Every failure
 * case is paired with its two-sided partner (a genuine zero must still read
 * as a zero) and names the false sentence it forbids.
 *
 * The headline element exists from the very first render (loading state,
 * default zeroes) — unlike Weight's own gated skeleton — so every assertion
 * below waits for the SETTLED text via `waitFor` rather than reading
 * `h1.textContent` the instant `findByRole` resolves, which would just as
 * happily catch the transient loading text.
 *
 * UX Phase 8 Brief C (21 Sep 2026).
 */
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch, type RouteRequest } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE, REGISTER_PAGE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { fmtInt } from '../lib/fmt';
import type { Period } from '../lib/period';
import { ReadingsScreen } from './Readings';

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z',
  tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening',
  live: true,
  days: 1,
};

// REGISTER_PAGE_FIXTURE.data.rows[0] — the row fixtures.ts's own inner
// REGISTER_ROW_FIXTURE const is NOT exported (only the page envelope is);
// reusing it through the exported page keeps this file honest against the
// same wire-contract typing fixtures.ts's header promises.
const SAMPLE_ROW = REGISTER_PAGE_FIXTURE.data.rows[0]!;

function noop(): void {}

function baseProps() {
  return {
    period: PERIOD,
    listing: 'cones' as const,
    onListingChange: noop,
    station: null,
    onStationChange: noop,
    states: [],
    onStatesChange: noop,
    page: 1,
    onPageChange: noop,
    initialFilter: undefined,
    onFilterChange: noop,
    onOpenReading: noop,
    canExport: false,
  };
}

/** A working /api/stations route — not this file's subject except in the last case. */
const STATIONS_OK = { stations: [] };

describe('Readings — the headline (countLine)', () => {
  it('rows REJECT: headline is countLineFailed, and no "0 " count appears in it', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/stations': STATIONS_OK,
      '/api/events': (req: RouteRequest) => {
        // The reject-count poll (pageSize=1) is a SEPARATE call from the
        // main register poll (pageSize=100, the default PAGE_SIZE) —
        // Readings.tsx:166. Only the main one fails here.
        if (req.search.get('pageSize') === '1') {
          return { data: { rows: [], total: 0, page: 1, pageSize: 1 }, metadata: META_FIXTURE };
        }
        throw new Error('plant connection down');
      },
    });

    const { findByRole } = renderWithLive(<ReadingsScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() => expect(h1.textContent).toBe(W.readings.countLineFailed));
    expect(h1.textContent).not.toContain('0 ');
  });

  it('rows RESOLVE but the reject-count call REJECTS: headline names total AND that the reject count is unknown; "0 rejected by the scale" is absent', async () => {
    const total = 25;
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/stations': STATIONS_OK,
      '/api/events': (req: RouteRequest) => {
        if (req.search.get('pageSize') === '1') {
          throw new Error('plant connection down');
        }
        return {
          data: { rows: [SAMPLE_ROW], total, page: 1, pageSize: 100 },
          metadata: META_FIXTURE,
        };
      },
    });

    const { findByRole } = renderWithLive(<ReadingsScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() =>
      expect(h1.textContent).toContain(W.readings.countLineRejectUnknown(fmtInt(total))),
    );
    // The owner-endorsed partial-failure rule: name which part failed, never
    // let the missing count silently read as zero.
    expect(h1.textContent).not.toContain('0 rejected by the scale');
  });

  it('both RESOLVE, total 0: the genuine zero headline, AND the body shows Empty', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/stations': STATIONS_OK,
      '/api/events': () => ({
        data: { rows: [], total: 0, page: 1, pageSize: 100 },
        metadata: META_FIXTURE,
      }),
    });

    const { findByRole, findByText } = renderWithLive(<ReadingsScreen {...baseProps()} />);
    const h1 = await findByRole('heading', { level: 1 });

    await waitFor(() =>
      expect(h1.textContent).toContain(W.readings.countLine(fmtInt(0), fmtInt(0), '0%')),
    );
    // Two-sided: this must NOT read as either failure sentence above.
    expect(h1.textContent).not.toBe(W.readings.countLineFailed);
    expect(h1.textContent).not.toContain(W.readings.countLineRejectUnknown(fmtInt(0)));
    await findByText(W.readings.nothing);
  });
});

describe('Readings — the station-filter chip', () => {
  it('/api/stations REJECTS: the toolbar still shows a chip slot naming the failure, not a silently-removed filter', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/stations': () => {
        throw new Error('plant connection down');
      },
      '/api/events': () => ({
        data: { rows: [SAMPLE_ROW], total: 1, page: 1, pageSize: 100 },
        metadata: META_FIXTURE,
      }),
    });

    const { findByText } = renderWithLive(<ReadingsScreen {...baseProps()} />);

    await findByText(W.readings.stationFilterUnavailable);
  });
});
