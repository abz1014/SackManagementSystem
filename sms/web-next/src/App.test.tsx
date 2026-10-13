/**
 * The app frame (task E1). TRACE rows verified here:
 *   A1-001 (401 returns to sign-in), A1-002 (getMe bootstrap), A1-003 (login, no account creation),
 *   A1-004 (logout from the user menu), A3-001 (one route owner), A3-002 (Login), A3-003 (skip link and main),
 *   A3-004 (nav, period chip, health), A3-010 (health dot, never OK when unknown), A3-011 + G-17 (replay banner),
 *   A3-012 (simulator banner reused), A3-013 + G-30 (page error keeps the shell), A3-073 (Setup gated at rank 4),
 *   A6-01, A6-05, A6-06, A6-20, A6-22 (legacy redirects, sheet=, wall=1), CLAUDE.md "one audience".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../web/src/testkit/render';
import { installDomStubs } from '../../web/src/testkit/domStubs';
import { installFakeFetch, type Routes } from '../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../web/src/testkit/fixtures';
import { App, bannerView, pageTitle } from './App';
import { resolveLocation, galleryEnabled } from './appRoute';
import { SCREENS, SCREEN_KEYS, SHEETS, resolveScreen } from './screens/registry';
import { legacyHref } from './screens/legacyHref';
import { parseRoute } from './route';

installDomStubs();

const RANGE = { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 };
const ME = (role: string) => ({ user: { username: 'test-user', displayName: 'Test User', role } });
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(role: string | null, extra: Routes = {}, url = '/next/') {
  window.history.replaceState(null, '', url);
  return installFakeFetch({
    '/api/auth/me': role ? ME(role) : { user: null },
    '/api/live': LIVE_FIXTURE,
    '/api/range': RANGE,
    '/api/data-batch': { data: { batches: [] }, metadata: LIVE_FIXTURE.metadata },
    '/api/auth/logout': { ok: true },
    ...extra,
  });
}

const sidebar = () => screen.getByRole('navigation', { name: 'Main navigation' });
const findSidebar = () => screen.findByRole('navigation', { name: 'Main navigation' });

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('sign-in (A1-002, A1-003, A3-002)', () => {
  it('shows Login when there is no session, with no shell', async () => {
    setup(null);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    await waitFor(() => expect(document.title).toBe('Sign in - SMS'));
  });

  it('says only that the pair did not match, and never offers to create an account', async () => {
    setup(null, { '/api/auth/login': jsonRes(401, { error: 'invalid' }) });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'someone' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That username and password did not match.');
    expect(screen.queryByText(/create|register|sign up/i)).toBeNull();
  });

  it('states the minutes of a lockout', async () => {
    setup(null, {
      '/api/auth/login': new Response(JSON.stringify({ error: 'locked' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '300' },
      }),
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Try again in 5 minutes.');
  });

  it('opens the shell after a good sign-in', async () => {
    setup(null, { '/api/auth/login': { user: ME('engineer').user } });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await findSidebar()).toBeTruthy();
  });

  it('returns to sign-in when any call answers 401 (A1-001)', async () => {
    setup('viewer', { '/api/live': jsonRes(401, { error: 'unauthorized' }) });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('signs out from the user menu (A1-004)', async () => {
    const fake = setup('viewer');
    render(<App />);
    await findSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(fake.requests).toContain('/api/auth/logout');
  });
});

describe('navigation by rank (A3-004, A3-073, one audience)', () => {
  it('rank 1 sees every screen and not Setup', async () => {
    setup('viewer');
    render(<App />);
    await findSidebar();
    const nav = within(sidebar());
    for (const n of ['Today', 'Quality', 'Products & PDAS', 'Reports', 'Diagnostics', 'Account']) {
      expect(nav.getByRole('link', { name: n }), n).toBeTruthy();
    }
    expect(nav.queryByRole('link', { name: 'Setup' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy();
  });

  it('ranks 2 and 3 do not see Setup either', async () => {
    for (const role of ['engineer', 'manager']) {
      setup(role);
      const { unmount } = render(<App />);
      await findSidebar();
      expect(within(sidebar()).queryByRole('link', { name: 'Setup' }), role).toBeNull();
      unmount();
    }
  });

  it('rank 4 sees Setup', async () => {
    setup('admin');
    render(<App />);
    await findSidebar();
    expect(within(sidebar()).getByRole('link', { name: 'Setup' })).toBeTruthy();
  });

  it('a typed Setup address below rank 4 falls back to Today', async () => {
    setup('viewer', {}, '/next/?s=system&t=setup');
    render(<App />);
    await findSidebar();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('s')).toBe('today'));
    expect(new URLSearchParams(window.location.search).get('t')).toBeNull();
    expect(document.title).toBe('Today - SMS');
  });

  it('a typed Setup address at rank 4 stays', async () => {
    setup('admin', {}, '/next/?s=system&t=setup');
    render(<App />);
    await findSidebar();
    expect(new URLSearchParams(window.location.search).get('t')).toBe('setup');
    expect(document.title).toBe('Setup - SMS');
  });

  it('clicking a nav entry navigates in place and keeps the period', async () => {
    setup('viewer', {}, '/next/?s=today&p=week');
    render(<App />);
    await findSidebar();
    fireEvent.click(within(sidebar()).getByRole('link', { name: 'Quality' }));
    const sp = new URLSearchParams(window.location.search);
    expect([sp.get('s'), sp.get('t'), sp.get('p')]).toEqual(['quality', 'weight', 'week']);
    expect(document.title).toBe('Weight - SMS');
  });
});

describe('legacy links (A6-01, A6-05, A6-06, A6-20, A6-22)', () => {
  it('?s=line becomes s=today on load', async () => {
    setup('viewer', {}, '/next/?s=line');
    render(<App />);
    await findSidebar();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('s')).toBe('today'));
  });

  it('?s=product&pt=changeover becomes Products > Changeover, keeping other keys', async () => {
    setup('viewer', {}, '/next/?s=product&pt=changeover&at=2026-09-01T10:00:00Z');
    render(<App />);
    await findSidebar();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('s')).toBe('products'));
    const sp = new URLSearchParams(window.location.search);
    expect([sp.get('t'), sp.get('pt'), sp.get('at')]).toEqual(['changeover', null, '2026-09-01T10:00:00Z']);
  });

  it('?s=readings becomes Quality > Register', async () => {
    setup('viewer', {}, '/next/?s=readings');
    render(<App />);
    await findSidebar();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('t')).toBe('register'));
  });

  it('an unknown screen lands on Today', () => {
    expect(resolveLocation('?s=nonsense', 1, false).route.s).toBe('today');
  });

  it('?s=wall opens wall mode with no chrome', async () => {
    setup('viewer', {}, '/next/?s=wall');
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sh-wall')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(new URLSearchParams(window.location.search).get('wall')).toBe('1');
    expect(document.title).toBe('Wall display - SMS');
  });

  it('Esc leaves the wall display', async () => {
    setup('viewer', {}, '/next/?s=today&wall=1');
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.sh-wall')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Escape' });
    await findSidebar();
    expect(new URLSearchParams(window.location.search).get('wall')).toBeNull();
  });

  it('a product sheet link goes to Products > Board with the sheet closed', () => {
    const r = resolveLocation('?sheet=product:12', 1, false);
    expect([r.route.s, r.route.t, r.route.sheet]).toEqual(['products', 'board', null]);
  });
});

describe('sheets (A6-06)', () => {
  it('sheet=station:5 opens a sheet and closing removes the key', async () => {
    setup('viewer', {}, '/next/?s=today&sheet=station:5');
    render(<App />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Open it in the current app' }).getAttribute('href')).toContain('sheet=station%3A5');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(new URLSearchParams(window.location.search).get('sheet')).toBeNull();
  });
});

describe('gallery is dev only', () => {
  it('is on in dev and off otherwise', () => {
    expect(galleryEnabled(true)).toBe(true);
    expect(galleryEnabled(false)).toBe(false);
    expect(resolveLocation('?s=gallery', 4, true).gallery).toBe(true);
  });
  it('in a production build ?s=gallery is just an unknown screen', () => {
    const r = resolveLocation('?s=gallery', 4, false);
    expect(r.gallery).toBe(false);
    expect(r.route.s).toBe('today');
  });
  it('App.tsx imports the gallery only behind import.meta.env.DEV', () => {
    const src = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');
    const lines = src.split('\n').filter((l) => /import\(['"]\.\/Gallery['"]\)/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/import\.meta\.env\.DEV \? lazy/);
    expect(src).not.toMatch(/^import .*from '\.\/Gallery'/m);
  });
  it('renders the gallery in dev', async () => {
    setup('viewer', {}, '/next/?s=gallery');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Component gallery' })).toBeTruthy();
  });
});

describe('a failing page keeps the shell (A3-013, G-30)', () => {
  it('shows the page failure, the nav still works and Try again is offered', async () => {
    const orig = SCREENS['today/'];
    SCREENS['today/'] = () => {
      throw new Error('boom');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setup('viewer');
      render(<App />);
      await findSidebar();
      expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load this page.");
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
      // leaving the broken screen clears the failure
      fireEvent.click(within(sidebar()).getByRole('link', { name: 'Reports' }));
      await waitFor(() => expect(screen.queryByText("Couldn't load this page.")).toBeNull());
    } finally {
      SCREENS['today/'] = orig!;
      err.mockRestore();
    }
  });
});

describe('banners (A3-011, G-17, A3-012)', () => {
  const replayLive = {
    ...LIVE_FIXTURE,
    data: { lines: [{ ...LIVE_FIXTURE.data.lines[0]!, replay: true }] },
  };

  it('shows the replay banner, with a way out, when the server is replaying', async () => {
    setup('viewer', { '/api/live': replayLive }, '/next/?s=today&at=2026-09-01T10:00:00Z&p=week');
    render(<App />);
    const banner = await screen.findByText(/REPLAY/);
    expect(banner.textContent).toContain('This is not live.');
    const leave = screen.getByRole('link', { name: 'Leave replay' });
    expect(leave.getAttribute('href')).not.toContain('at=');
    expect(leave.getAttribute('href')).toContain('p=week');
    fireEvent.click(leave);
    await waitFor(() => expect(screen.queryByText(/REPLAY/)).toBeNull());
    expect(new URLSearchParams(window.location.search).get('at')).toBeNull();
  });

  it('shows no replay banner on a live line', async () => {
    setup('viewer');
    render(<App />);
    await findSidebar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Data current/ })).toBeTruthy());
    expect(screen.queryByText(/REPLAY/)).toBeNull();
  });

  it('prints the simulated-data sentence when the live line is the simulator, and nothing at IFL', async () => {
    const simLive = {
      ...LIVE_FIXTURE,
      data: {
        lines: [
          {
            ...LIVE_FIXTURE.data.lines[0]!,
            generation: {
              ...LIVE_FIXTURE.data.lines[0]!.generation,
              generation: { ...LIVE_FIXTURE.data.lines[0]!.generation.generation, simulator: true },
            },
          },
        ],
      },
    };
    setup('viewer', { '/api/live': simLive });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.simulator-banner')).toBeTruthy());
    cleanup();
    setup('viewer');
    const second = render(<App />);
    await findSidebar();
    await waitFor(() => expect(screen.getByRole('button', { name: /Data current/ })).toBeTruthy());
    expect(second.container.querySelector('.simulator-banner')).toBeNull();
  });
});

describe('health dot (A3-010)', () => {
  it('is "Status unknown", never OK, when the live fetch failed', async () => {
    setup('viewer', { '/api/live': jsonRes(500, { error: 'down' }) });
    render(<App />);
    await findSidebar();
    expect(await screen.findByRole('button', { name: /Status unknown/ })).toBeTruthy();
    expect(screen.queryByText('Data current')).toBeNull();
  });
});

describe('registry', () => {
  it('has an entry for every screen and tab the route model can produce, and for wall', () => {
    expect(SCREEN_KEYS).toContain('today/wall');
    for (const k of SCREEN_KEYS) expect(SCREENS[k], k).toBeDefined();
    expect(SCREEN_KEYS.length).toBe(1 + 4 + 5 + 1 + 3 + 1);
    expect(Object.keys(SHEETS)).toEqual([]);
  });

  it('every placeholder links to the same view in the current app, keeping the period', async () => {
    for (const k of SCREEN_KEYS) {
      const [s, t] = k.split('/');
      const route = parseRoute(new URLSearchParams(`s=${s}${t && t !== 'wall' ? `&t=${t}` : ''}${t === 'wall' ? '&wall=1' : ''}&p=week`));
      expect(resolveScreen(route), k).toBe(SCREENS[k]);
      const href = legacyHref(route);
      expect(href.startsWith('/?s='), k).toBe(true);
      expect(href, k).toContain('p=week');
    }
  });

  it('maps new tabs back onto the old vocabulary', () => {
    const h = (q: string) => legacyHref(parseRoute(new URLSearchParams(q)));
    expect(h('s=quality&t=register')).toContain('s=readings');
    expect(h('s=products&t=board')).toContain('pt=running');
    expect(h('s=system&t=diagnostics')).toContain('s=health');
    expect(h('s=today&wall=1')).toBe('/?s=wall');
  });

  it('shows the placeholder sentence and its link on an unbuilt screen', async () => {
    setup('viewer', {}, '/next/?s=reports');
    render(<App />);
    expect(await screen.findByText(/This screen is being rebuilt\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open it in the current app' }).getAttribute('href')).toBe('/?s=report');
  });
});

describe('helpers', () => {
  it('pageTitle uses the tab label where there is one', () => {
    expect(pageTitle(parseRoute(new URLSearchParams('s=quality&t=rejects')))).toBe('Rejects');
    expect(pageTitle(parseRoute(new URLSearchParams('s=reports')))).toBe('Reports');
  });
  it('bannerView maps onto the old screen names', () => {
    const b = (q: string) => bannerView(parseRoute(new URLSearchParams(q)));
    expect(b('s=today').view).toBe('line');
    expect(b('s=quality&t=stations').view).toBe('weight');
    expect(b('s=products&t=board')).toEqual({ view: 'product', productTab: 'running' });
    expect(b('s=products&t=catalogue').productTab).not.toBe('running');
    expect(b('s=system&t=setup').view).toBe('setup');
  });
});
