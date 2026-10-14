import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../../../web/src/testkit/render';
import { installFakeFetch, type FakeFetch } from '../../../web/src/testkit/fetchRouter';
import { period as P } from '../bridge/lib';
import { useMachinesRunning, useProduction, useRange, useStationStatus } from './hooks';

const period: P.Period = { key: 'yesterday', from: '2026-09-05', to: '2026-09-05', tsTo: '2026-09-06T06:00:00Z', live: false, days: 1 };
const env = (data: unknown) => ({ data, metadata: {} });
let ff: FakeFetch | null = null;
afterEach(() => { ff?.restore(); ff = null; });

function Probe({ hook }: { hook: () => { status: string; part: string; error: string | null } }) {
  const d = hook();
  return <div data-testid="s">{d.status}|{d.part}|{d.error ?? ''}</div>;
}
const fail = () => new Response('{"error":"down"}', { status: 500 });

describe('data hooks', () => {
  it('useProduction passes compare and returns previous', async () => {
    ff = installFakeFetch({ '/api/production': env({ rows: [], previous: { from: 'a', to: 'b', result: { rows: [] } } }) });
    render(<Probe hook={() => useProduction(period, 'week')} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^ok\|production/));
    expect(ff.requests[0]).toContain('compare=week');
    expect(ff.requests[0]).toContain('from=2026-09-05');
  });
  it('useProduction omits compare when off, and names its part on failure', async () => {
    ff = installFakeFetch({ '/api/production': fail() });
    render(<Probe hook={() => useProduction(period)} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^error\|production\|/));
    expect(ff.requests[0]).not.toContain('compare');
  });
  it('useStationStatus succeeds without tsTo', async () => {
    ff = installFakeFetch({ '/api/station-status': env({ thresholds: { act: 2, watch: 1.3 }, stations: [] }) });
    render(<Probe hook={() => useStationStatus(period)} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^ok\|station status/));
    expect(ff.requests[0]).toBe('/api/station-status?from=2026-09-05&to=2026-09-05');
  });
  it('useStationStatus names its part when the answer has no thresholds', async () => {
    ff = installFakeFetch({ '/api/station-status': env({ stations: [] }) });
    render(<Probe hook={() => useStationStatus(period)} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^error\|station status\|.*incomplete/));
  });
  it('useStationStatus names its part on failure', async () => {
    ff = installFakeFetch({ '/api/station-status': fail() });
    render(<Probe hook={() => useStationStatus(period)} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^error\|station status/));
  });
  it('useMachinesRunning ok and failure', async () => {
    ff = installFakeFetch({ '/api/machines/running': env({ machines: [] }) });
    const r = render(<Probe hook={useMachinesRunning} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^ok\|machines running/));
    r.unmount();
    ff.restore();
    ff = installFakeFetch({ '/api/machines/running': fail() });
    render(<Probe hook={useMachinesRunning} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^error\|machines running/));
  });
  it('useRange ok and failure', async () => {
    ff = installFakeFetch({ '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07' } });
    const r = render(<Probe hook={useRange} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^ok\|data range/));
    r.unmount();
    ff.restore();
    ff = installFakeFetch({ '/api/range': fail() });
    render(<Probe hook={useRange} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^error\|data range/));
  });
  it('a live period keeps its figures when the plant clock moves on (no "Not available" flash)', async () => {
    ff = installFakeFetch({ '/api/production': env({ rows: [{ cones: 91 }] }) });
    const live1: P.Period = { ...period, key: 'shift', live: true, tsTo: '2026-09-06T06:00:00Z' };
    const live2: P.Period = { ...live1, tsTo: '2026-09-06T06:00:10Z' };
    const Show = ({ p }: { p: P.Period }) => { const d = useProduction(p); return <div data-testid="s">{d.status}</div>; };
    const { rerender } = render(<Show p={live1} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('ok'));
    rerender(<Show p={live2} />);
    expect(screen.getByTestId('s').textContent).toBe('ok');
  });
});
