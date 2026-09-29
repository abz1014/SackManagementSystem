/**
 * SimulatorBanner (Task D, 28 Sep 2026) — the global "simulated data"
 * notice, and its short form in the Wall footer.
 *
 * The two questions it answers (LIVE / PERIOD) are independent, so every
 * test below is explicit about which fixture drives which half — the same
 * two-sided discipline `generationQuiet.test.tsx` established: a test that
 * only proves the sentence CAN appear would pass equally against a banner
 * that prints unconditionally, which is worse than no test at all, since an
 * IFL-shaped payload (no simulator generation anywhere) must render NOTHING.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { GENERATION_FIXTURE, LIVE_FIXTURE, SIMULATOR_GENERATION_FIXTURE } from '../testkit/fixtures';
import { SimulatorBanner } from './SimulatorBanner';
import { WallScreen } from '../screens/Wall';
import type { DataBatchData, Envelope, LiveData, LiveGenerationNote } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
  // A test that switches to fake timers (the backoff/logging test below)
  // must not leak them into the next test's real-timer `waitFor`s, which
  // would otherwise hang until `waitFor`'s own timeout.
  vi.useRealTimers();
});

const liveWith = (g: LiveGenerationNote): Envelope<LiveData> => ({
  ...LIVE_FIXTURE,
  data: { lines: [{ ...LIVE_FIXTURE.data.lines[0]!, generation: g }] },
});

const batchOf = (simulator: boolean): Envelope<DataBatchData> => ({
  data: {
    batches: [
      simulator
        ? { key: 'DATA_TP1U2_SIM#4', ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', label: null, simulator: true }
        : { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', label: null, simulator: false },
    ],
  },
  metadata: LIVE_FIXTURE.metadata,
});
const EMPTY_BATCH: Envelope<DataBatchData> = { data: { batches: [] }, metadata: LIVE_FIXTURE.metadata };

const FROM = '2026-08-21';
const TO = '2026-09-07';

const BOTH = 'These figures come from the plant simulator, not the plant.';
const LIVE_ONLY_PERIOD_REAL = "The live line status comes from the plant simulator. This period's figures are IFL's own recorded data.";
const LIVE_ONLY = 'The live line status comes from the plant simulator, not the plant.';
const PERIOD_ONLY = "This period's figures come from the plant simulator, not the plant.";

describe('SimulatorBanner — the four LIVE × PERIOD combinations, on a view with both (line)', () => {
  it('real live, real period (the IFL shape): renders NOTHING', async () => {
    const fake = installFakeFetch({ '/api/live': liveWith(GENERATION_FIXTURE), '/api/data-batch': batchOf(false) });
    const { container } = renderWithLive(<SimulatorBanner view="line" productTab="running" from={FROM} to={TO} />);
    await waitFor(() => expect(fake.requests.some((r) => r.startsWith('/api/data-batch'))).toBe(true));
    await waitFor(() => expect(fake.requests.some((r) => r.startsWith('/api/live'))).toBe(true));
    expect(container.querySelector('.simulator-banner')).toBeNull();
  });

  it('simulated live, real period: sentence (b), never claiming the live half is real', async () => {
    installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE), '/api/data-batch': batchOf(false) });
    const { findByText, queryByText } = renderWithLive(
      <SimulatorBanner view="line" productTab="running" from={FROM} to={TO} />,
    );
    await findByText(LIVE_ONLY_PERIOD_REAL);
    expect(queryByText(BOTH)).toBeNull();
  });

  it('real live, simulated period: sentence (d)', async () => {
    installFakeFetch({ '/api/live': liveWith(GENERATION_FIXTURE), '/api/data-batch': batchOf(true) });
    const { findByText, queryByText } = renderWithLive(
      <SimulatorBanner view="line" productTab="running" from={FROM} to={TO} />,
    );
    await findByText(PERIOD_ONLY);
    expect(queryByText(BOTH)).toBeNull();
  });

  it('simulated live, simulated period: sentence (a)', async () => {
    installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE), '/api/data-batch': batchOf(true) });
    const { findByText, queryByText } = renderWithLive(
      <SimulatorBanner view="line" productTab="running" from={FROM} to={TO} />,
    );
    await findByText(BOTH);
    expect(queryByText(LIVE_ONLY_PERIOD_REAL)).toBeNull();
    expect(queryByText(PERIOD_ONLY)).toBeNull();
  });
});

describe('SimulatorBanner — which views show which half', () => {
  it('Health: live-only sentence (c), even though Health shows no period figures', async () => {
    installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE) });
    const { findByText } = renderWithLive(<SimulatorBanner view="health" productTab="running" from={FROM} to={TO} />);
    await findByText(LIVE_ONLY);
  });

  it('Product › Running: live-only sentence (c)', async () => {
    installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE) });
    const { findByText } = renderWithLive(<SimulatorBanner view="product" productTab="running" from={FROM} to={TO} />);
    await findByText(LIVE_ONLY);
  });

  it('Product › Changeover: renders NOTHING even though live is simulated — only Running gets the live half', async () => {
    const fake = installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE) });
    const { container } = renderWithLive(<SimulatorBanner view="product" productTab="changeover" from={FROM} to={TO} />);
    await waitFor(() => expect(fake.requests.some((r) => r.startsWith('/api/live'))).toBe(true));
    expect(container.querySelector('.simulator-banner')).toBeNull();
    // Changeover must not even be asked about a period batch.
    expect(fake.requests.some((r) => r.startsWith('/api/data-batch'))).toBe(false);
  });

  it('Product › Catalogue / History: renders NOTHING', async () => {
    installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE) });
    const { container } = renderWithLive(<SimulatorBanner view="product" productTab="catalogue" from={FROM} to={TO} />);
    await waitFor(() => expect(container).toBeTruthy());
    expect(container.querySelector('.simulator-banner')).toBeNull();
  });

  it('Setup: renders NOTHING and never asks for a period batch, even with a simulated live generation', async () => {
    const fake = installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE) });
    const { container } = renderWithLive(<SimulatorBanner view="setup" productTab="running" from={FROM} to={TO} />);
    await waitFor(() => expect(fake.requests.some((r) => r.startsWith('/api/live'))).toBe(true));
    expect(container.querySelector('.simulator-banner')).toBeNull();
    expect(fake.requests.some((r) => r.startsWith('/api/data-batch'))).toBe(false);
  });

  it('Readings (period only, no live figures): simulated period alone gives sentence (d), not (a) or (b)', async () => {
    // Live is ALSO simulated here on purpose — Readings must not read the
    // live half at all, so the sentence must stay (d), not (a).
    installFakeFetch({ '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE), '/api/data-batch': batchOf(true) });
    const { findByText, queryByText } = renderWithLive(
      <SimulatorBanner view="readings" productTab="running" from={FROM} to={TO} />,
    );
    await findByText(PERIOD_ONLY);
    expect(queryByText(BOTH)).toBeNull();
  });
});

describe('SimulatorBanner — a failed /api/data-batch fetch must not claim "real"', () => {
  it('simulated live + failed period fetch: sentence (c), the live-only wording, never (b)', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFakeFetch({
      '/api/live': liveWith(SIMULATOR_GENERATION_FIXTURE),
      '/api/data-batch': new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    });
    const { findByText, queryByText } = renderWithLive(
      <SimulatorBanner view="line" productTab="running" from={FROM} to={TO} />,
    );
    await findByText(LIVE_ONLY);
    expect(queryByText(LIVE_ONLY_PERIOD_REAL)).toBeNull();
    expect(queryByText(BOTH)).toBeNull();
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it('real live + failed period fetch: renders NOTHING (never asserts the period is real or simulated)', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = installFakeFetch({
      '/api/live': liveWith(GENERATION_FIXTURE),
      '/api/data-batch': new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    });
    const { container } = renderWithLive(<SimulatorBanner view="line" productTab="running" from={FROM} to={TO} />);
    await waitFor(() => expect(fake.requests.some((r) => r.startsWith('/api/data-batch'))).toBe(true));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(container.querySelector('.simulator-banner')).toBeNull();
    errSpy.mockRestore();
  });
});

/**
 * Backoff/logging task, 29 Sep 2026: a failed period fetch used to log
 * `console.error` on every RE-RENDER while `.error` stayed set, not once
 * per outage — with `usePolling`'s own retry now backed off (see
 * `lib/live.tsx`), a single outage lasting several retries must still print
 * exactly one failure line, plus one recovery line when it clears.
 */
describe('SimulatorBanner logs the console at most once per outage', () => {
  it('warns once when the period fetch starts failing, stays at one through a backed-off retry, then logs once more on recovery', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    installFakeFetch({
      '/api/live': liveWith(GENERATION_FIXTURE),
      '/api/data-batch': () => {
        calls += 1;
        return calls <= 2 ? new Response(JSON.stringify({ error: 'boom' }), { status: 500 }) : batchOf(false);
      },
    });
    renderWithLive(<SimulatorBanner view="line" productTab="running" from={FROM} to={TO} />);

    // Initial fetch — 1st failure of the streak.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // The backed-off retry (2nd failure, same streak): still exactly one warn.
    // ASYNC advance so the fake timer's own catch/`schedule()` microtasks run
    // before this window closes — see `live.polling.test.tsx`'s capped-delay
    // test for why the sync `advanceTimersByTime` isn't enough here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // The next retry succeeds: one more line, the recovery notice.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(String(warnSpy.mock.calls[1]?.[0])).toMatch(/recovered/);

    warnSpy.mockRestore();
  });
});

describe('SimulatorBanner — an empty batch list (no generation resolved at all) behaves like "real"', () => {
  it('renders NOTHING on a view with only period figures', async () => {
    installFakeFetch({ '/api/live': liveWith(GENERATION_FIXTURE), '/api/data-batch': EMPTY_BATCH });
    const { container } = renderWithLive(<SimulatorBanner view="rejects" productTab="running" from={FROM} to={TO} />);
    await waitFor(() => expect(container).toBeTruthy());
    expect(container.querySelector('.simulator-banner')).toBeNull();
  });
});

/* ----------------------------------------------- Wall's own short form */

describe("Wall's footer short form", () => {
  const wallRoutes = (g: LiveGenerationNote) => ({
    '/api/live': liveWith(g),
    '/api/stations': { stations: [] },
    '/api/attention': {
      data: {
        window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
        period: { from: '2026-09-07', to: '2026-09-07', shift: null },
        findings: [],
        totalFindings: 0,
        thresholds: { driftG: 15, minDaysHeld: 3 },
      },
      metadata: LIVE_FIXTURE.metadata,
    },
  });

  it('appears when the live generation is the simulator\'s', async () => {
    installFakeFetch(wallRoutes(SIMULATOR_GENERATION_FIXTURE));
    const { findByText } = renderWithLive(<WallScreen onExit={() => {}} />);
    await findByText(/this board is showing the plant simulator, not the plant/);
  });

  it('does NOT appear on a real generation — the IFL shape', async () => {
    installFakeFetch(wallRoutes(GENERATION_FIXTURE));
    const { findByText, queryByText } = renderWithLive(<WallScreen onExit={() => {}} />);
    // Wait for a settled render via a landmark that is always present.
    await findByText(/Readings to/);
    expect(queryByText(/plant simulator/i)).toBeNull();
  });
});
