import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppShell } from './AppShell';
import { HealthDot, describeHealth } from './HealthDot';
import { ICON_NAMES, Icon } from './Icon';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import type { Route } from '../route';

const route = (s: Route['s'], t: string | null = null): Route => ({ s, t, sheet: null, wall: false, keys: {} });
const user = { username: 'asma', displayName: 'Asma', role: 'admin' };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function side(rank: number, r = route('today'), collapsed = false) {
  return render(
    <Sidebar route={r} rank={rank} collapsed={collapsed} onCollapsedChange={() => {}} onNavigate={() => {}} />,
  );
}

describe('Sidebar', () => {
  it('has no Setup below rank 4 and has it at rank 4', () => {
    side(3);
    expect(screen.queryByRole('link', { name: 'Setup' })).toBeNull();
    cleanup();
    side(4);
    expect(screen.getByRole('link', { name: 'Setup' })).toBeTruthy();
  });
  it('groups the IA as Monitor, Operate, Analyse, System', () => {
    side(1);
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Monitor', 'Operate', 'Analyse', 'System']);
  });
  it('marks only the active item with aria-current', () => {
    side(4, route('system', 'setup'));
    const cur = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(cur.map((a) => a.textContent)).toEqual(['Setup']);
    cleanup();
    side(1, route('products', 'board'));
    expect(screen.getByRole('link', { name: 'Products & PDAS' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('AppShell', () => {
  const mount = (r = route('today')) =>
    render(
      <AppShell route={r} rank={4} user={user} onNavigate={() => {}}>
        <p>page body</p>
      </AppShell>,
    );
  it('remembers the collapsed state per viewer', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(window.localStorage.getItem('sms.sidebar.collapsed.asma')).toBe('1');
    cleanup();
    mount();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    expect(document.querySelector('.sh-app')?.hasAttribute('data-collapsed')).toBe(true);
  });
  it('still works when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    spy.mockRestore();
    set.mockRestore();
  });
  it('keeps the shell when the page throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom(): never {
      throw new Error('x');
    }
    render(
      <AppShell route={route('today')} rank={1} user={user} onNavigate={() => {}}>
        <Boom />
      </AppShell>,
    );
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load this page.");
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    err.mockRestore();
  });
  it('drops all chrome in wall mode', () => {
    render(
      <AppShell route={{ ...route('today'), wall: true }} rank={1} user={user} onNavigate={() => {}}>
        <p>wall</p>
      </AppShell>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByText('wall')).toBeTruthy();
  });
});

describe('TabBar', () => {
  const bar = (rank: number, r = route('today')) =>
    render(<TabBar route={r} rank={rank} onNavigate={() => {}} onSignOut={() => {}} />);
  it('has five items and More lists Register, Diagnostics, Account, Sign out below rank 4', () => {
    bar(3);
    const nav = screen.getByRole('navigation', { name: 'Screens' });
    expect(within(nav).getAllByRole('link').length + within(nav).getAllByRole('button').length).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dlg = screen.getByRole('dialog', { name: 'More' });
    expect(within(dlg).getAllByRole('link').map((a) => a.textContent)).toEqual(['Register', 'Diagnostics', 'Account']);
    expect(within(dlg).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(within(dlg).queryByText('Setup')).toBeNull();
  });
  it('adds Setup to More at rank 4', () => {
    bar(4);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Setup' })).toBeTruthy();
  });
  it('marks the active tab', () => {
    bar(1, route('reports'));
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('HealthDot', () => {
  const NOW = '2026-09-07T12:00:00.000Z';
  const cases = [
    ['ok', { kind: 'ok', readingUtc: NOW, lagSeconds: 600 }, 'ok'],
    ['late', { kind: 'late', readingUtc: NOW, lagSeconds: 7200 }, 'watch'],
    ['lag_unknown', { kind: 'lag_unknown', readingUtc: NOW }, 'watch'],
    ['stale', { kind: 'stale', readingUtc: NOW, syncAgeSeconds: 900 }, 'act'],
    ['none', { kind: 'none' }, 'nodata'],
  ] as const;
  it.each(cases)('maps %s to the %s state', (_n, h, state) => {
    render(<HealthDot health={h as never} onOpen={() => {}} />);
    expect(document.querySelector('.state')?.getAttribute('data-state')).toBe(state);
  });
  it('never says OK for stale, late, unknown or missing health', () => {
    for (const h of [cases[1][1], cases[2][1], cases[3][1], cases[4][1], null]) {
      expect(describeHealth(h as never).state).not.toBe('ok');
    }
  });
  it('shows a failed fetch as unknown and opens a popover with a Diagnostics link', () => {
    const open = vi.fn();
    render(<HealthDot health={null} onOpen={open} />);
    expect(screen.getByText('Status unknown')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Status unknown/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Diagnostics' }));
    expect(open).toHaveBeenCalledOnce();
  });
});

describe('Icon', () => {
  it('has 22 icons, each aria-hidden or labelled', () => {
    expect(ICON_NAMES.length).toBe(22);
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      unmount();
      const l = render(<Icon name={name} label="x" />);
      const svg = l.container.querySelector('svg')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe('x');
      expect(svg.getAttribute('aria-hidden')).toBeNull();
      l.unmount();
    }
  });
});
