// @vitest-environment jsdom
/**
 * Products & PDAS shared pieces (task E9). TRACE rows verified here:
 *   A3-074        the tab strip (Board / Changeover / Catalogue / Limits & History), period kept
 *   A1-031 / A3-065 the PDAS connection card: writes on or off, the server reason as sent, local limits apart
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installDomStubs } from '../../../../web/src/testkit/domStubs';
import { installFakeFetch } from '../../../../web/src/testkit/fetchRouter';
import type { Route } from '../../route';
import { PdasStatusCard, usePdasWriteStatus } from './PdasStatusCard';
import { ProductsTabs } from './ProductsTabs';

installDomStubs();

const route: Route = { s: 'products', t: 'catalogue', sheet: { kind: 'station', id: '3' }, wall: false, keys: { p: 'week', pr: '20' } };

describe('ProductsTabs', () => {
  afterEach(cleanup);
  it('shows the four tabs and marks the current one', () => {
    render(<ProductsTabs route={route} go={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Board', 'Changeover', 'Catalogue', 'Limits & History']);
    expect(screen.getByRole('tab', { name: 'Catalogue' }).getAttribute('aria-selected')).toBe('true');
  });
  it('keeps the period, drops tab filters and the sheet', () => {
    const go = vi.fn();
    render(<ProductsTabs route={route} go={go} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(go).toHaveBeenCalledWith({ s: 'products', t: 'board', sheet: null, wall: false, keys: { p: 'week' } });
  });
  it('the legacy history tab selects Limits & History', () => {
    render(<ProductsTabs route={{ ...route, t: 'history' }} go={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Limits & History' }).getAttribute('aria-selected')).toBe('true');
  });
});

function Card() {
  const s = usePdasWriteStatus();
  return <PdasStatusCard status={s} />;
}

describe('PdasStatusCard', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('writes off: prints the server reason exactly, and says local limits stay available', async () => {
    installFakeFetch({
      '/api/product-write/status': { enabled: false, reason: 'PDAS_WRITE_ENABLED is not true.', canWrite: false, local: { canWrite: true } },
    });
    const { container } = render(<Card />);
    await screen.findByText('Writes switched off');
    expect(container.querySelector('#pds-reason')!.textContent).toBe('PDAS_WRITE_ENABLED is not true.');
    expect(screen.getByText(/Local weight limits can still be changed in SMS\./)).toBeTruthy();
    expect(screen.getByText(/Plans and reviews still work and nothing is sent to PDAS\./)).toBeTruthy();
  });

  it('writes off and no local rights: does not promise local limits', async () => {
    installFakeFetch({
      '/api/product-write/status': { enabled: false, reason: 'Some other reason.', canWrite: false, local: { canWrite: false } },
    });
    render(<Card />);
    await screen.findByText('Some other reason.');
    expect(screen.queryByText(/Local weight limits can still be changed/)).toBeNull();
  });

  it('writes on and allowed: no reason block', async () => {
    installFakeFetch({ '/api/product-write/status': { enabled: true, reason: null, canWrite: true, local: { canWrite: true } } });
    const { container } = render(<Card />);
    await screen.findByText('Writes on');
    expect(container.querySelector('#pds-reason')).toBeNull();
  });

  it('writes on but this account cannot: says so', async () => {
    installFakeFetch({ '/api/product-write/status': { enabled: true, reason: null, canWrite: false, local: { canWrite: false } } });
    render(<Card />);
    await screen.findByText('Your account can look at PDAS but cannot change it.');
  });

  it('a failed status read is named, not shown as writes off', async () => {
    installFakeFetch({ '/api/product-write/status': () => new Response('{"error":"boom"}', { status: 500 }) });
    render(<Card />);
    await waitFor(() => expect(screen.getByText("Couldn't load the PDAS connection status.")).toBeTruthy());
    expect(screen.queryByText('Writes switched off')).toBeNull();
    expect(screen.getByText('Not read')).toBeTruthy();
  });
});
