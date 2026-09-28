/**
 * Chart overhaul wave 1, Task T2. Drives `useChartBrush`'s handlers directly
 * with synthetic-shaped event objects rather than dispatching real DOM
 * PointerEvents — the hook only reads `pointerId`, `pointerType`, `button`,
 * `clientX` and `currentTarget` off whatever it's handed, and jsdom's own
 * PointerEvent support is inconsistent across environments, so constructing
 * plain objects is both simpler and exercises exactly what the hook reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChartBrush, type ChartBrushOptions } from './useChartBrush';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A fake SVG/overlay element whose bounding box starts at x=0, for simple relative-x math. */
function fakeTarget(): { getBoundingClientRect: () => { left: number } } {
  return { getBoundingClientRect: () => ({ left: 0 }) };
}

function pointerEvent(over: Partial<{
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  currentTarget: unknown;
}>): any {
  const target = over.currentTarget ?? fakeTarget();
  return {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 0,
    ...over,
    currentTarget: target,
  };
}

function setup(opts: Partial<ChartBrushOptions> & { onCommit: ChartBrushOptions['onCommit'] }) {
  const options: ChartBrushOptions = { enabled: true, ...opts };
  return renderHook(() => useChartBrush(options));
}

describe('useChartBrush mouse/pen drag', () => {
  it('commits px0 < px1 in order for a left-to-right drag', () => {
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit });

    act(() => result.current.bind.onPointerDown(pointerEvent({ pointerId: 1, clientX: 20, currentTarget: target })));
    expect(result.current.active).toBe(true);
    act(() => result.current.bind.onPointerMove(pointerEvent({ pointerId: 1, clientX: 80, currentTarget: target })));
    act(() => result.current.bind.onPointerUp(pointerEvent({ pointerId: 1, clientX: 80, currentTarget: target })));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(20, 80);
    expect(result.current.active).toBe(false);
    expect(result.current.brush).toBeNull();
  });

  it('commits px0 < px1 in order for a right-to-left drag', () => {
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit });

    act(() => result.current.bind.onPointerDown(pointerEvent({ pointerId: 1, clientX: 80, currentTarget: target })));
    act(() => result.current.bind.onPointerMove(pointerEvent({ pointerId: 1, clientX: 20, currentTarget: target })));
    act(() => result.current.bind.onPointerUp(pointerEvent({ pointerId: 1, clientX: 20, currentTarget: target })));

    expect(onCommit).toHaveBeenCalledWith(20, 80);
  });

  it('a drag under minPx is a click, not a brush — no commit', () => {
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit, minPx: 6 });

    act(() => result.current.bind.onPointerDown(pointerEvent({ pointerId: 1, clientX: 20, currentTarget: target })));
    act(() => result.current.bind.onPointerMove(pointerEvent({ pointerId: 1, clientX: 23, currentTarget: target })));
    act(() => result.current.bind.onPointerUp(pointerEvent({ pointerId: 1, clientX: 23, currentTarget: target })));

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.brush).toBeNull();
  });

  it('Esc cancels an in-progress brush without committing', () => {
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit });

    act(() => result.current.bind.onPointerDown(pointerEvent({ pointerId: 1, clientX: 20, currentTarget: target })));
    act(() => result.current.bind.onPointerMove(pointerEvent({ pointerId: 1, clientX: 90, currentTarget: target })));
    expect(result.current.active).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.active).toBe(false);
    expect(result.current.brush).toBeNull();

    act(() => result.current.bind.onPointerUp(pointerEvent({ pointerId: 1, clientX: 90, currentTarget: target })));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit, enabled: false });

    act(() => result.current.bind.onPointerDown(pointerEvent({ pointerId: 1, clientX: 20, currentTarget: target })));
    expect(result.current.active).toBe(false);
  });
});

describe('useChartBrush touch long-press', () => {
  it('starts brushing only after the long press fires, held still', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit, longPressMs: 400 });

    act(() =>
      result.current.bind.onPointerDown(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 50, currentTarget: target }),
      ),
    );
    expect(result.current.active).toBe(false); // still pending, not yet a brush

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current.active).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.active).toBe(true);

    act(() =>
      result.current.bind.onPointerMove(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 130, currentTarget: target }),
      ),
    );
    act(() =>
      result.current.bind.onPointerUp(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 130, currentTarget: target }),
      ),
    );
    expect(onCommit).toHaveBeenCalledWith(50, 130);
  });

  it('a touch released before the long press is a tap, not a brush', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit, longPressMs: 400 });

    act(() =>
      result.current.bind.onPointerDown(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 50, currentTarget: target }),
      ),
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() =>
      result.current.bind.onPointerUp(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 50, currentTarget: target }),
      ),
    );

    expect(result.current.active).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();

    // The long-press timer must also be defused — firing it later must not retroactively start a brush.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.active).toBe(false);
  });

  it('a touch that moves before the long press is read as a scroll and never brushes', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const target = fakeTarget();
    const { result } = setup({ onCommit, longPressMs: 400 });

    act(() =>
      result.current.bind.onPointerDown(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 50, currentTarget: target }),
      ),
    );
    act(() =>
      result.current.bind.onPointerMove(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 75, currentTarget: target }),
      ),
    ); // 25px > the 10px cancel threshold, before the long press fires

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.active).toBe(false);

    act(() =>
      result.current.bind.onPointerUp(
        pointerEvent({ pointerId: 2, pointerType: 'touch', clientX: 75, currentTarget: target }),
      ),
    );
    expect(onCommit).not.toHaveBeenCalled();
  });
});
