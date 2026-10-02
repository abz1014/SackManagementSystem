/**
 * C-143 (D-99): the banner re-polled /api/data-batch every 10 s on a closed
 * period (yesterday, a picked past day). A closed period is fetched once; a
 * live one still repeats. The plant day in LIVE_FIXTURE is 2026-09-07.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { SimulatorBanner } from './SimulatorBanner';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const BATCH = { data: { batches: [] }, metadata: LIVE_FIXTURE.metadata };

async function countBatchFetches(from: string, to: string): Promise<number> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const fake = installFakeFetch({ '/api/live': LIVE_FIXTURE, '/api/data-batch': BATCH });
  renderWithLive(<SimulatorBanner view="line" productTab="running" from={from} to={to} />);
  // Step in 1 s slices, letting the fake fetch's real macrotasks settle
  // between slices, so /api/live lands before the 40 s window is spent.
  for (let i = 0; i < 40; i++) {
    await act(async () => {
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(1_000);
    });
  }
  return fake.requests.filter((r) => r.startsWith('/api/data-batch')).length;
}

describe('SimulatorBanner polling (C-143)', () => {
  it('a closed period (yesterday) fetches /api/data-batch exactly once over 40 s', async () => {
    expect(await countBatchFetches('2026-09-06', '2026-09-06')).toBe(1);
  });
  it('a live period (ends today) keeps polling', async () => {
    expect(await countBatchFetches('2026-09-01', '2026-09-07')).toBeGreaterThan(1);
  });
});
