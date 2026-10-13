/* Fix-wave T1: the TV wall menu item (1024 px and up only), Sheet focus return (D24), tile text (D14). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { AppShell } from './AppShell';
import { Sheet } from './Sheet';
import { StationTile, type StationItem } from './StationTile';
import type { Route } from '../route';

const route: Route = { s: 'today', t: null, sheet: null, wall: false, keys: { p: 'week' } };
const user = { username: 'asma', displayName: 'Asma', role: 'viewer' };

function width(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = min ? px >= Number(min[1]) : max ? px <= Number(max[1]) : false;
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false };
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('user menu: Open TV wall', () => {
  const open = (onNavigate = vi.fn()) => {
    render(<AppShell route={route} rank={1} user={user} onNavigate={onNavigate}><p>x</p></AppShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    return onNavigate;
  };
  it('is offered at 1024 px and opens the wall, keeping the period', () => {
    width(1366);
    const nav = open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open TV wall' }));
    expect(nav).toHaveBeenCalledWith({ s: 'today', t: null, sheet: null, wall: true, keys: { p: 'week' } });
  });
  it('is not offered below 1024 px', () => {
    width(768);
    open();
    expect(screen.queryByRole('menuitem', { name: 'Open TV wall' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('Sheet returns focus (D24)', () => {
  function Host({ opener }: { opener: 'row' | 'none' }) {
    const [o, setO] = useState(false);
    return (
      <div>
        <main id="sh-main" tabIndex={-1}>
          <table><tbody><tr data-testid="row" onClick={() => setO(true)}><td>row</td></tr></tbody></table>
          {opener === 'none' && <button onClick={() => setO(true)}>go</button>}
        </main>
        <Sheet open={o} onClose={() => setO(false)} title="t"><button>in</button></Sheet>
      </div>
    );
  }
  it('goes back to a clickable row that cannot take focus by itself', () => {
    render(<Host opener="row" />);
    const row = screen.getByTestId('row');
    fireEvent.pointerDown(row);
    fireEvent.click(row);
    fireEvent.keyDown(screen.getByText('in'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(row);
  });
  it('goes to the main region, not <body>, when there was no opener', () => {
    render(<Host opener="none" />);
    // opened from outside any pointer or key interaction, as a typed address does
    fireEvent.click(screen.getByText('go'));
    fireEvent.keyDown(screen.getByText('in'), { key: 'Escape' });
    expect(document.activeElement).not.toBe(document.body);
  });
});

const st = (over: Partial<StationItem>): StationItem => ({ station: 3, name: null, cones: 0, failedPct: null, state: 'nodata', reasons: [], vsTargetG: null, product: null, ...over });
describe('StationTile (D14)', () => {
  it('a tile with no data says "No data" once; the full name is the title', () => {
    render(<StationTile item={st({ station: 5, name: 'East Conveyor' })} />);
    const tile = screen.getByRole('button');
    expect(within(tile).getAllByText('No data')).toHaveLength(1);
    expect(within(tile).getByText('Station 5 · East Conveyor').getAttribute('title')).toBe('Station 5 · East Conveyor');
  });
});
