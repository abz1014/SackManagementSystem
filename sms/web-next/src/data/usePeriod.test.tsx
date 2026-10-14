import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import '../../../web/src/testkit/render';
import { installFakeFetch } from '../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../web/src/testkit/fixtures';
import { usePeriod, parseCompare, type PeriodState } from './usePeriod';
import { live } from '../bridge/lib';

let api: PeriodState;
function Probe() {
  api = usePeriod();
  return <div data-testid="p">{api.status}|{api.params.key}|{api.compare ?? 'off'}|{api.period?.key ?? '-'}</div>;
}
const routes = { '/api/live': LIVE_FIXTURE, '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07' } };

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => window.history.replaceState(null, '', '/'));

describe('usePeriod', () => {
  it('round-trips p/from/to/cmp through the URL', async () => {
    installFakeFetch(routes);
    render(<live.LiveProvider asOf={null}><Probe /></live.LiveProvider>);
    await waitFor(() => expect(screen.getByTestId('p').textContent).toMatch(/^ok\|shift\|off\|shift/));
    act(() => api.setParams({ key: 'pick', picked: { from: '2026-09-01', to: '2026-09-03' } }));
    act(() => api.setCompare('week'));
    expect(window.location.search).toContain('p=pick');
    expect(window.location.search).toContain('from=2026-09-01');
    expect(window.location.search).toContain('cmp=week');
    expect(screen.getByTestId('p').textContent).toBe('ok|pick|week|pick');
    act(() => api.setCompare(null));
    expect(window.location.search).not.toContain('cmp');
  });
  it('ignores a malformed cmp', async () => {
    window.history.replaceState(null, '', '/?cmp=bogus&p=today');
    installFakeFetch(routes);
    render(<live.LiveProvider asOf={null}><Probe /></live.LiveProvider>);
    await waitFor(() => expect(screen.getByTestId('p').textContent).toMatch(/^ok\|today\|off/));
    expect(parseCompare(new URLSearchParams('cmp=PREV'))).toBeNull();
    expect(parseCompare(new URLSearchParams('cmp=prev'))).toBe('prev');
  });
  it('reports the failed part when the plant clock cannot be read', async () => {
    installFakeFetch({ ...routes, '/api/live': new Response('{}', { status: 500 }) });
    render(<live.LiveProvider asOf={null}><Probe /></live.LiveProvider>);
    await waitFor(() => expect(screen.getByTestId('p').textContent).toMatch(/^error/));
    expect(api.failed).toEqual(['plant clock']);
    expect(api.period).toBeNull();
  });
  it('names a failed data-range fetch but still resolves the period', async () => {
    installFakeFetch({ ...routes, '/api/range': new Response('{}', { status: 500 }) });
    render(<live.LiveProvider asOf={null}><Probe /></live.LiveProvider>);
    await waitFor(() => expect(api.failed).toEqual(['data range']));
    expect(api.status).toBe('ok');
    expect(api.period).not.toBeNull();
  });
});
