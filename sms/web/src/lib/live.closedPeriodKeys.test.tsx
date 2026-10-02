/**
 * C-137 (D-104, 2 Oct 2026): poll keys carried `period.tsTo`, which resolvePeriod
 * recomputes from the plant clock on every /api/live poll (10 s). The key
 * therefore changed every 10 s: a closed period (yesterday) refetched and
 * blanked its figures, and a live period refetched on top of its own cadence.
 * Keys now carry the replay instant (`asOf`) and the period, never a clock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { resolvePeriod, type PeriodKey } from './period';
import { useLive } from './live';
import { LineScreen } from '../screens/Line';
import { RejectsScreen } from '../screens/Rejects';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function noop(): void {}

/** Plant clock that moves 10 s per /api/live answer, as the real one does. */
function movingLive() {
  let n = 0;
  return () => {
    const base = Date.parse('2026-09-07T17:00:00.000Z') + n * 10_000;
    n += 1;
    const line = { ...LIVE_FIXTURE.data.lines[0]!, plantNowUtc: new Date(base).toISOString() };
    return { data: { lines: [line] }, metadata: LIVE_FIXTURE.metadata };
  };
}

/** Resolves the period from the live clock on every render, exactly as App.tsx does. */
function Host({ k, children }: { k: PeriodKey; children: (p: ReturnType<typeof resolvePeriod>) => JSX.Element }) {
  const { line } = useLive();
  if (!line) return <></>;
  return children(
    resolvePeriod(k, {
      shiftDate: line.shift.shiftDate, shiftCode: line.shift.code, shiftStartUtc: line.shift.startUtc,
      plantNowUtc: line.plantNowUtc, dataAsOfUtc: line.dataAsOfUtc,
    }),
  );
}

const lineProps = (period: ReturnType<typeof resolvePeriod>) => ({
  period, onNavigate: noop, onOpenStation: noop, onOpenReading: noop, onOpenProduct: noop, canWrite: false,
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const count = (reqs: string[], path: string) => reqs.filter((r) => r.startsWith(path)).length;

describe('poll keys do not carry the moving plant clock', () => {
  it('Line, yesterday: each endpoint is fetched once in 60 s', async () => {
    vi.useFakeTimers();
    const fake = installFakeFetch({ '/api/live': movingLive() });
    renderWithLive(<Host k="yesterday">{(p) => <LineScreen {...lineProps(p)} />}</Host>);
    await advance(1_000);
    const first = {
      prod: count(fake.requests, '/api/production'),
      at: count(fake.requests, '/api/product-at'),
      mach: count(fake.requests, '/api/machines/running'),
    };
    expect(first.prod).toBeGreaterThan(0);
    await advance(60_000);
    expect(count(fake.requests, '/api/live')).toBeGreaterThan(4); // the clock really moved
    expect(count(fake.requests, '/api/production')).toBe(first.prod);
    expect(count(fake.requests, '/api/product-at')).toBe(first.at);
    expect(count(fake.requests, '/api/machines/running')).toBe(first.mach);
  });

  it('Line, today (live): product-at follows its 30 s cadence, not the 10 s clock', async () => {
    vi.useFakeTimers();
    const fake = installFakeFetch({ '/api/live': movingLive() });
    renderWithLive(<Host k="today">{(p) => <LineScreen {...lineProps(p)} />}</Host>);
    await advance(1_000);
    const first = count(fake.requests, '/api/product-at');
    await advance(60_000);
    const extra = count(fake.requests, '/api/product-at') - first;
    // 30 s cadence: 2 repeats in 60 s. (Error backoff only lengthens it.)
    expect(extra).toBeLessThanOrEqual(2);
  });

  it('Rejects, yesterday: /api/reject-spc is not refetched in 60 s', async () => {
    vi.useFakeTimers();
    const fake = installFakeFetch({ '/api/live': movingLive() });
    renderWithLive(<Host k="yesterday">{(p) => <RejectsScreen
      period={p} station={null} onStationChange={noop} product={null} onProductChange={noop} code={null}
      onCodeChange={noop} onSeeCones={noop} onSeeStations={noop} onOpenReason={noop} canName={false}
    />}</Host>);
    await advance(2_000);
    const first = count(fake.requests, '/api/reject-spc');
    expect(first).toBeGreaterThan(0);
    await advance(60_000);
    expect(count(fake.requests, '/api/reject-spc')).toBe(first);
  });
});
