import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import '../../../web/src/testkit/render';
import { useData } from './useData';

afterEach(() => vi.unstubAllGlobals());

function Probe({ fn, k, liveOpt = true }: { fn: () => Promise<number[]>; k: string; liveOpt?: boolean }) {
  const d = useData<number[]>('cones', fn, k, { live: liveOpt, isEmpty: (x) => x.length === 0, intervalMs: 20 });
  return <div data-testid="s">{d.status}|{d.part}|{JSON.stringify(d.data)}|{d.staleError ?? ''}</div>;
}

describe('useData', () => {
  it('failed fetch is error with the part name, never empty or zero', async () => {
    render(<Probe fn={() => Promise.reject(new Error('boom'))} k="a" />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^error\|cones\|null/));
  });

  it('empty only on successful empty data', async () => {
    render(<Probe fn={async () => []} k="a" />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^empty/));
  });

  it('stale data plus a later error stays ok with staleError', async () => {
    let n = 0;
    const fn = async () => {
      if (n++ === 0) return [1];
      throw new Error('later');
    };
    render(<Probe fn={fn} k="a" />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^ok\|cones\|\[1\]\|later/), { timeout: 2000 });
  });

  it('key change clears data; a failure under the new key is error', async () => {
    const fn = vi.fn(async () => [1]);
    let setK: (k: string) => void = () => {};
    function W() {
      const [k, s] = useState('a');
      setK = s;
      const f = k === 'a' ? fn : () => Promise.reject(new Error('x'));
      return <Probe fn={f} k={k} liveOpt={false} />;
    }
    render(<W />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^ok/));
    act(() => setK('b'));
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^error\|cones\|null/));
  });

  it('live:false does not refetch', async () => {
    const fn = vi.fn(async () => [1]);
    render(<Probe fn={fn} k="a" liveOpt={false} />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toMatch(/^ok/));
    await new Promise((r) => setTimeout(r, 120));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('live:true keeps refetching', async () => {
    const fn = vi.fn(async () => [1]);
    render(<Probe fn={fn} k="a" />);
    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });
  });
});
