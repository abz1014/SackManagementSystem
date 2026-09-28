/**
 * Chart overhaul wave 1, Task T2.
 *
 * Uses the CONTROLLABLE ResizeObserver stub (`testkit/domStubs.ts`), never
 * the silent default `installDomStubs()` installs — these tests need a
 * resize to actually reach `useChartSize`'s observer callback. This file
 * does not import `testkit/render` (which calls `installDomStubs()`) for
 * exactly that reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChartSize } from './useChartSize';
import { installControllableResizeObserver, fireResize } from '../testkit/domStubs';

installControllableResizeObserver();

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.style.removeProperty('--ui-scale');
});

/** A DOM node with a real ResizeObserver-observable identity but no jsdom layout. */
function makeContainer(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/**
 * A stable ref-like object, reused across re-renders — `renderHook`'s
 * callback re-runs on every state update, so an inline `{ current: el }`
 * literal would hand `useChartSize` a NEW ref identity each time and tear
 * down/rebuild its ResizeObserver on every render. A real caller's `useRef`
 * does not have this problem; this stands in for one.
 */
function stableRef(el: HTMLElement): { current: HTMLElement | null } {
  return { current: el };
}

describe('useChartSize width', () => {
  it('coalesces two resizes fired before the rAF flush into a single update', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    let rafCb: FrameRequestCallback | null = null;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCb = cb;
      return 42;
    });
    try {
      const el = makeContainer();
      const ref = stableRef(el);
      const { result } = renderHook(() => useChartSize(ref, { defaultH: 300 }));

      act(() => {
        fireResize(el, 500);
        fireResize(el, 900); // second fire before the rAF flush — only the last should stick
      });
      expect(result.current.width).toBe(1036); // fallback: nothing applied until rAF flushes
      expect(rafSpy).toHaveBeenCalledTimes(2); // each fire schedules...
      expect(cancelSpy).toHaveBeenCalledWith(42); // ...but the first pending frame is cancelled, never applied

      // Flushing the one frame that survived produces exactly one state update.
      act(() => {
        rafCb?.(0);
      });
      expect(result.current.width).toBe(900);
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });

  it('ignores a resize of 1px or less (hysteresis)', () => {
    vi.useFakeTimers();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    try {
      const el = makeContainer();
    const ref = stableRef(el);
      const { result } = renderHook(() => useChartSize(ref, { defaultH: 300 }));

      act(() => fireResize(el, 1036 + 1));
      expect(result.current.width).toBe(1036); // 1px change: suppressed

      act(() => fireResize(el, 1036 + 2));
      expect(result.current.width).toBe(1038); // 2px change: applied
    } finally {
      rafSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('falls back to fallbackW when ResizeObserver is absent', () => {
    const saved = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    // @ts-expect-error — deliberately simulating a jsdom without any RO stub installed
    delete globalThis.ResizeObserver;
    try {
      const el = makeContainer();
    const ref = stableRef(el);
      const { result } = renderHook(() => useChartSize(ref, { defaultH: 300, fallbackW: 777 }));
      expect(result.current.width).toBe(777);
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved;
    }
  });
});

describe('useChartSize fontPx', () => {
  it('reads 13 * the numeric --ui-scale computed on documentElement', () => {
    document.documentElement.style.setProperty('--ui-scale', '1.3');
    const el = makeContainer();
    const ref = stableRef(el);
    const { result } = renderHook(() => useChartSize(ref, { defaultH: 300 }));
    expect(result.current.fontPx).toBeCloseTo(16.9, 5);
  });

  it('defaults to scale 1 when the variable is unset', () => {
    const el = makeContainer();
    const ref = stableRef(el);
    const { result } = renderHook(() => useChartSize(ref, { defaultH: 300 }));
    expect(result.current.fontPx).toBe(13);
  });

  it('re-reads the scale on window resize', () => {
    const el = makeContainer();
    const ref = stableRef(el);
    const { result } = renderHook(() => useChartSize(ref, { defaultH: 300 }));
    expect(result.current.fontPx).toBe(13);

    document.documentElement.style.setProperty('--ui-scale', '1.3');
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.fontPx).toBeCloseTo(16.9, 5);
  });
});

describe('useChartSize height', () => {
  it('clamps a stored height to [minH, maxH]', () => {
    localStorage.setItem('sms.chartH.weight', '5000');
    const el = makeContainer();
    const ref = stableRef(el);
    const { result } = renderHook(() =>
      useChartSize(ref, { chartId: 'weight', defaultH: 300, minH: 160, maxH: 720 }),
    );
    expect(result.current.height).toBe(720);
  });

  it('setHeight persists (clamped) and resetHeight removes the stored key', () => {
    const el = makeContainer();
    const ref = stableRef(el);
    const { result } = renderHook(() =>
      useChartSize(ref, { chartId: 'rejects', defaultH: 300, minH: 160, maxH: 720 }),
    );

    act(() => result.current.setHeight(50)); // below minH
    expect(result.current.height).toBe(160);
    expect(localStorage.getItem('sms.chartH.rejects')).toBe('160');

    act(() => result.current.resetHeight());
    expect(result.current.height).toBe(300);
    expect(localStorage.getItem('sms.chartH.rejects')).toBeNull();
  });

  it('survives localStorage.getItem throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const el = makeContainer();
    const ref = stableRef(el);
      const { result } = renderHook(() =>
        useChartSize(ref, { chartId: 'weight', defaultH: 300 }),
      );
      expect(result.current.height).toBe(300);
    } finally {
      spy.mockRestore();
    }
  });

  it('survives localStorage.setItem throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      const el = makeContainer();
    const ref = stableRef(el);
      const { result } = renderHook(() =>
        useChartSize(ref, { chartId: 'weight', defaultH: 300 }),
      );
      expect(() => act(() => result.current.setHeight(400))).not.toThrow();
      expect(result.current.height).toBe(400); // in-memory state still updates
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useChartSize print mode', () => {
  let matchMediaSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matchMediaSpy = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    (window as unknown as { matchMedia: unknown }).matchMedia = matchMediaSpy;
  });

  it('gives the fixed non-report width and the default height while printing', () => {
    const el = makeContainer();
    const ref = stableRef(el);
    const { result } = renderHook(() => useChartSize(ref, { defaultH: 300, minH: 160, maxH: 720 }));

    act(() => result.current.setHeight(500));
    expect(result.current.height).toBe(500);

    act(() => window.dispatchEvent(new Event('beforeprint')));
    expect(result.current.print).toBe(true);
    expect(result.current.width).toBe(680);
    expect(result.current.height).toBe(300); // default height, not the dragged 500

    act(() => window.dispatchEvent(new Event('afterprint')));
    expect(result.current.print).toBe(false);
    expect(result.current.height).toBe(500); // dragged height restored once not printing
  });

  it('gives the wide report width inside a Report main group', () => {
    const main = document.createElement('main');
    // `.report` doubles as a fallback hook alongside the `:has()` selector
    // (see `isReportPrintContext`'s doc comment) — belt-and-braces here so
    // this test does not depend on whether the pinned jsdom implements
    // `:has()`.
    main.className = 'report';
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Report');
    main.appendChild(group);
    document.body.appendChild(main);

    const el = makeContainer();
    const ref = stableRef(el);
    const { result } = renderHook(() => useChartSize(ref, { defaultH: 300 }));

    act(() => window.dispatchEvent(new Event('beforeprint')));
    expect(result.current.width).toBe(1000);
  });
});
