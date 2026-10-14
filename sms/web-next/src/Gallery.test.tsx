import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '../../web/src/testkit/render';
import { installFakeFetch } from '../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../web/src/testkit/fixtures';
import { Gallery } from './Gallery';
import { live } from './bridge/lib';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Gallery', () => {
  it('renders every block without throwing', async () => {
    installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-05' } });
    const { container } = render(<live.LiveProvider asOf={null}><Gallery /></live.LiveProvider>);
    for (const h of ['Shell', 'State vocabulary', 'KPI cards', 'Station heat grid', 'Charts', 'Data table', 'Empty, error and loading states', 'Write controls']) {
      expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    }
    // one of each state pill, and the real 1 Sep tiles
    expect(container.querySelectorAll('.pill-ok').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pill-act').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pill-watch').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pill-nodata').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Station 8/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Change period/ }).length).toBe(1));
  });
});
