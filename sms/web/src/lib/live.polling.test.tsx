/**
 * FIX 2 (ChartFrame/live-polling task, 29 Sep 2026). `usePolling` itself
 * cannot be exercised from `live.test.ts` — that file is `.ts`, so
 * `vitest.config.ts`'s `environmentMatchGlobs` (keyed on the file EXTENSION,
 * see `App.test.ts`'s own header for why) runs it under `node`, with no
 * timers/DOM the hook's `useEffect`/`setTimeout` loop needs. This file is
 * `.tsx` so it gets `jsdom`, and renders the hook directly with
 * `renderHook` + fake timers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePolling } from './live';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePolling({ enabled })', () => {
  it('enabled=false fetches once and does not repeat', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue('v1');

    const { result } = renderHook(() => usePolling(fn, 1000, 'k', { enabled: false }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe('v1');
    expect(result.current.error).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    // No repeat scheduled: still exactly one call after ten intervals' worth of time.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('switching from enabled=false to enabled=true resumes polling', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue('v1');

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => usePolling(fn, 1000, 'k', { enabled }),
      { initialProps: { enabled: false } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);

    // Still not live: time passing alone must not add calls.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);

    // The viewer returns to a live period.
    rerender({ enabled: true });
    await act(async () => {
      await Promise.resolve();
    });
    const callsAtResume = fn.mock.calls.length;
    expect(callsAtResume).toBeGreaterThanOrEqual(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fn.mock.calls.length).toBeGreaterThan(callsAtResume);
    expect(result.current.data).toBe('v1');
  });

  it('errors are still surfaced while enabled=false (the one fetch can still fail)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => usePolling(fn, 1000, 'k', { enabled: false }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('boom');
    expect(result.current.loading).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1); // still no retry loop while disabled
  });

  it('omitting opts (3-arg call) keeps polling on the existing interval, unchanged', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue('v1');

    renderHook(() => usePolling(fn, 1000, 'k'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

/**
 * Failure backoff (Task, 29 Sep 2026): while the API is down (e.g. mid
 * restart, Vite's dev proxy answering every request with a 500), a fixed
 * `intervalMs` retry means every open tab hammers the still-down server
 * forever. The delay must now double per consecutive failure, cap out, and
 * reset to `intervalMs` on the next success — with a manual `refresh()`
 * always firing immediately regardless of how backed off polling currently
 * is. `.error` must keep being set exactly as before; this changes only the
 * schedule, never the reliability contract `reliability.guard.test.ts` locks
 * down.
 */
describe('usePolling failure backoff', () => {
  it('consecutive failures back off with a growing delay (2x, 4x, 8x... the interval)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePolling(fn, 1000, 'k'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1); // initial fetch, 1st failure
    expect(result.current.error).toBe('boom');

    // Next retry is backed off to 2x the interval (2000ms), not 1000ms.
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1); // not due yet at 1000ms
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2); // due at 2000ms total, 2nd failure

    // The retry after THAT is backed off further still, to 4x (4000ms).
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2); // not due yet at +3000ms
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(3); // due at 4000ms total, 3rd failure
  });

  it('the backoff delay is capped rather than growing forever', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    renderHook(() => usePolling(fn, 1000, 'k'));

    // Retry attempts land at t = 0, 2000, 6000, 14000, 30000, 62000 (2x,4x,
    // 8x,16x,32x the 1000ms interval), then every 60000ms once the cap
    // (max(60_000, intervalMs*6) = 60_000 here) is reached. A single jump
    // spanning several of those retries needs the ASYNC advance so each
    // fake-timer callback's own microtasks (the rejected-promise catch, then
    // its own `schedule()` registering the NEXT timer) run before the next
    // due timer is considered — the plain sync `advanceTimersByTime` fires
    // whatever timers are already registered at call time and does not wait
    // for one timer's callback to register the next.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    }); // attempt 1, t=0

    await act(async () => {
      await vi.advanceTimersByTimeAsync(63_000);
    });
    expect(fn).toHaveBeenCalledTimes(6); // attempts through t=62000

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fn).toHaveBeenCalledTimes(7); // capped retry at t=122000, not sooner
  });

  it('a success resets the backoff to the normal interval', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('v1');
    renderHook(() => usePolling(fn, 1000, 'k'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1); // 1st call fails

    // Backed off to 2000ms.
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2); // 2nd call succeeds at t=2000

    // Back to the plain interval: the NEXT call is 1000ms later, not another backoff.
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('refresh() fires immediately even while backed off after failures', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePolling(fn, 1000, 'k'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1); // 1st failure; next retry backed off to 2000ms

    await act(async () => {
      vi.advanceTimersByTime(500); // well before the 2000ms backoff is due
      result.current.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2); // refresh() did not wait for the backoff
    expect(result.current.error).toBe('boom');
  });
});
