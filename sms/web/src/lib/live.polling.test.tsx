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
