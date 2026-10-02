/**
 * C-139 (D-94): narrowing the period by shift range alone (same from/to/shift)
 * must reset the register page. The reset effect used to depend only on
 * from/to/shift, so a stale page 24 survived a narrower range with 21 pages.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE, REGISTER_PAGE_FIXTURE } from '../testkit/fixtures';
import type { Period } from '../lib/period';
import { ReadingsScreen } from './Readings';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = {
  key: 'range', from: '2026-09-01', to: '2026-09-01',
  tsFrom: '2026-09-01T00:00:00Z', tsTo: '2026-09-01T23:59:59Z', live: false, days: 1,
  fromShift: { date: '2026-09-01', shift: 'morning' }, toShift: { date: '2026-09-01', shift: 'night' },
} as unknown as Period;
const NARROW = { ...BASE, fromShift: { date: '2026-09-01', shift: 'evening' } } as unknown as Period;

function props(period: Period, onPageChange: (p: number) => void) {
  return {
    period, listing: 'cones' as const, onListingChange: () => {}, station: null, onStationChange: () => {},
    states: [], onStatesChange: () => {}, page: 24, onPageChange, initialFilter: undefined,
    onFilterChange: () => {}, onOpenReading: () => {}, canExport: false,
  };
}

describe('Readings — page reset on a shift-range change (C-139)', () => {
  it('narrowing only fromShift resets the page to 1', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/stations': { stations: [] },
      '/api/events': { data: REGISTER_PAGE_FIXTURE.data, metadata: META_FIXTURE },
    });
    const onPage = vi.fn();
    const { rerender } = renderWithLive(<ReadingsScreen {...props(BASE, onPage)} />);
    onPage.mockClear();
    const { LiveProvider } = await import('../lib/live');
    rerender(<LiveProvider asOf={null}><ReadingsScreen {...props(NARROW, onPage)} /></LiveProvider>);
    await waitFor(() => expect(onPage).toHaveBeenCalledWith(1));
  });
});
