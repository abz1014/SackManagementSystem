/**
 * C-139 (D-94): the Sacks history register must reset to page 1 when the
 * period changes while parked on a later page (it had no reset at all).
 * A first mount keeps the page it arrived with (deep link).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from './testkit/fetchRouter';
import { renderWithLive } from './testkit/render';
import { LIVE_FIXTURE, META_FIXTURE, REGISTER_PAGE_FIXTURE } from './testkit/fixtures';
import { LiveProvider } from './lib/live';
import type { Period } from './lib/period';
import { History } from './screens/Sacks';

afterEach(() => {
  vi.unstubAllGlobals();
});

const WIDE = {
  key: 'range', from: '2026-08-05', to: '2026-09-07', tsFrom: '2026-08-05T00:00:00Z', tsTo: '2026-09-07T23:59:59Z',
  live: false, days: 34,
} as unknown as Period;
const NARROW = { ...WIDE, key: 'pick', from: '2026-08-19', to: '2026-08-19', days: 1 } as unknown as Period;

describe('Sacks history — page reset on period change (C-139)', () => {
  it('keeps a deep-linked page on mount, resets to 1 when the period changes', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/events': { data: REGISTER_PAGE_FIXTURE.data, metadata: META_FIXTURE },
    });
    const onPage = vi.fn();
    const mk = (p: Period) => <LiveProvider asOf={null}><History period={p} page={9} onPageChange={onPage} onOpenReading={() => {}} /></LiveProvider>;
    const { rerender } = renderWithLive(mk(WIDE).props.children);
    await new Promise((r) => setTimeout(r, 20));
    expect(onPage).not.toHaveBeenCalled();
    rerender(mk(NARROW));
    await waitFor(() => expect(onPage).toHaveBeenCalledWith(1));
  });
});
