/**
 * Port of web/src/rank.matrix.test.tsx for the redesign: the real <App/> mounted at all four ranks
 * against a fake API, with no database and no account. CLAUDE.md "one audience": every screen is
 * open to every signed-in account, only Setup is gated (rank 4), all other gating is on WRITE
 * controls. Each gated item has a present and an absent assertion, so a shell that renders nothing
 * cannot pass.
 *
 * Write controls arrive with the screens (E2..E7); each of those tasks adds its rows to WRITE_CONTROLS
 * below. For the frame, the only gated thing is the Setup tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '../../web/src/testkit/render';
import { installDomStubs } from '../../web/src/testkit/domStubs';
import { installFakeFetch } from '../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../web/src/testkit/fixtures';
import { App } from './App';
import { ROLE_RANK } from './bridge/api';
import { SCREEN_KEYS } from './screens/registry';
import { ADMIN_RANK } from './ranks';
import { URLS, routes as stationRoutes } from './screens/Quality/Stations/testkit/pd1';

installDomStubs();

const ROLES = [
  { role: 'viewer', rank: 1 },
  { role: 'engineer', rank: 2 },
  { role: 'manager', rank: 3 },
  { role: 'admin', rank: 4 },
] as const;

/** One reason, one day, as /api/rejects/reason answers it: enough for the reason sheet to open. */
const REASON_ONE = {
  day: '2026-09-06', dayBasis: 'production_day', code: { rejectType: 'quality', tubeCode: 2, materialCode: 1 },
  rejectCodeId: 11, label: null, displayLabel: 'Tube 2 · Mat 1', isPass: null, total: 1, page: 1, pageSize: 200,
  rows: [{ eventId: 9001, productionTsUtc: '2026-09-06T08:14:09Z', shiftCode: 'morning', station: 3, materialId: null, productLabel: null, weightG: null, sourceRowId: 77, epochLabel: null, epochOrdinal: 3, epochSimulator: false, attributionMethod: null }],
};
const BY_DAY = { dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 1, total: 10, rows: [] };

/**
 * Write controls the screens add. `open` is the address that shows the control and `routes` the data it needs
 * (the shell's own routes are always added); `ready` waits until the surface is drawn, so "absent" cannot pass
 * on a blank screen.
 */
const WRITE_CONTROLS: Array<{
  screen: string;
  control: string;
  minRank: number;
  open: string;
  routes: Record<string, unknown>;
  ready: RegExp;
}> = [
  {
    screen: 'Quality > Stations > station sheet',
    control: 'Log an adjustment',
    minRank: 2,
    open: `${URLS.pd1}&sheet=station:8`,
    routes: stationRoutes('pd1') as Record<string, unknown>,
    ready: /^Pattern check$/,
  },
  {
    screen: 'Quality > Rejects > reason sheet',
    control: 'Name it',
    minRank: 2,
    open: '/next/?s=quality&t=rejects&p=pick&from=2026-09-06&to=2026-09-06&sheet=reason:2026-09-06|quality|2|1',
    routes: {
      '/api/rejects/reason': { data: REASON_ONE, metadata: LIVE_FIXTURE.metadata },
      '/api/rejects/by-day-code': { data: BY_DAY, metadata: LIVE_FIXTURE.metadata },
      '/api/stations': { stations: [] },
      '/api/products': { products: [] },
    },
    ready: /Failures for one reason|Code 2\/1/,
  },
];

function mount(role: string, url = '/next/', extra: Record<string, unknown> = {}) {
  window.history.replaceState(null, '', url);
  installFakeFetch({
    ...(extra as Record<string, never>),
    '/api/auth/me': { user: { username: 'u', displayName: 'U', role } },
    '/api/live': LIVE_FIXTURE,
    '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 },
    '/api/data-batch': { data: { batches: [] }, metadata: LIVE_FIXTURE.metadata },
  });
  return render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('role names map to ranks 1..4', () => {
  for (const { role, rank } of ROLES) it(role, () => expect(ROLE_RANK[role]).toBe(rank));
  it('Setup is the admin rank', () => expect(ADMIN_RANK).toBe(4));
});

describe.each(ROLES)('$role (rank $rank)', ({ role, rank }) => {
  it('sees every screen in the sidebar; Setup only at rank 4', async () => {
    mount(role);
    const nav = within(await screen.findByRole('navigation', { name: 'Main navigation' }));
    for (const n of ['Today', 'Quality', 'Products & PDAS', 'Reports', 'Diagnostics', 'Account']) {
      expect(nav.getByRole('link', { name: n }), `${role} ${n}`).toBeTruthy();
    }
    if (rank >= 4) expect(nav.getByRole('link', { name: 'Setup' })).toBeTruthy();
    else expect(nav.queryByRole('link', { name: 'Setup' })).toBeNull();
  });

  it('phone More sheet lists Setup only at rank 4, and always Diagnostics, Account and Sign out', async () => {
    mount(role);
    await screen.findByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const more = within(screen.getByRole('dialog', { name: 'More' }));
    expect(more.getByRole('link', { name: 'Diagnostics' })).toBeTruthy();
    expect(more.getByRole('link', { name: 'Account' })).toBeTruthy();
    expect(more.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    if (rank >= 4) expect(more.getByRole('link', { name: 'Setup' })).toBeTruthy();
    else expect(more.queryByRole('link', { name: 'Setup' })).toBeNull();
  });

  it('every other tab opens at this rank (nothing but Setup is refused)', async () => {
    for (const key of SCREEN_KEYS) {
      if (key === 'system/setup' || key === 'today/wall') continue;
      const [s, t] = key.split('/');
      const { unmount } = mount(role, `/next/?s=${s}${t ? `&t=${t}` : ''}`);
      await screen.findByRole('navigation', { name: 'Main navigation' });
      const sp = new URLSearchParams(window.location.search);
      expect([sp.get('s'), sp.get('t') ?? '']).toEqual([s, t ?? '']);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('a typed Setup address is refused below rank 4 and kept at rank 4', async () => {
    mount(role, '/next/?s=system&t=setup');
    await screen.findByRole('navigation', { name: 'Main navigation' });
    const sp = new URLSearchParams(window.location.search);
    if (rank >= 4) expect([sp.get('s'), sp.get('t')]).toEqual(['system', 'setup']);
    else await vi.waitFor(() => expect(new URLSearchParams(window.location.search).get('s')).toBe('today'));
  });

  for (const w of WRITE_CONTROLS) {
    it(`${w.screen}: "${w.control}" ${rank >= w.minRank ? 'present' : 'absent'}`, async () => {
      mount(role, w.open, w.routes);
      await screen.findByRole('navigation', { name: 'Main navigation' });
      await screen.findByRole('dialog', {}, { timeout: 4000 });
      await within(await screen.findByRole('dialog')).findAllByText(w.ready, {}, { timeout: 4000 });
      const btn = () => within(screen.getByRole('dialog')).queryByRole('button', { name: w.control });
      if (rank >= w.minRank) await vi.waitFor(() => expect(btn()).toBeTruthy(), { timeout: 4000 });
      else {
        // Let the sheet's data land, then assert the control is still not there.
        await new Promise((r) => setTimeout(r, 300));
        expect(btn()).toBeNull();
      }
    });
  }
});
