/**
 * Chart overhaul wave 1, Task T2. A drag-to-select brush for time charts.
 * This hook reports only the pixel range dragged — snapping that range to
 * shift boundaries and turning it into a page period is owned elsewhere, per
 * the brief for this task.
 *
 * Built on Pointer Events so one set of handlers covers mouse, pen and
 * touch. Touch needs its own rule: a bare touch-drag must scroll the page
 * (`touch-action: pan-y` is set in CSS elsewhere), so a touch pointer only
 * starts a brush after `longPressMs` held roughly still; a touch that moves
 * first is read as the reader trying to scroll and is left alone — no
 * capture, no `preventDefault`. Mouse and pen brush immediately on
 * pointerdown. No wheel handling exists here at all, by design.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface ChartBrushOptions {
  enabled: boolean;
  onCommit: (px0: number, px1: number) => void;
  /** A released drag shorter than this is a click, not a brush. Default 6. */
  minPx?: number;
  /** How long a still touch must be held before it starts brushing. Default 400. */
  longPressMs?: number;
}

export interface ChartBrushRange {
  x0: number;
  x1: number;
}

export interface ChartBrushBind {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
}

export interface ChartBrush {
  bind: ChartBrushBind;
  /** The live (uncommitted) drag range, element-relative pixels. Null when nothing is being dragged. */
  brush: ChartBrushRange | null;
  active: boolean;
}

const DEFAULT_MIN_PX = 6;
const DEFAULT_LONG_PRESS_MS = 400;
/** A touch that moves more than this before the long press fires is a scroll, not a brush attempt. */
const TOUCH_MOVE_CANCEL_PX = 10;

function relativeX(e: ReactPointerEvent): number {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  return e.clientX - rect.left;
}

interface BrushState {
  pointerId: number | null;
  startX: number;
  /** Touch only: true between pointerdown and either the long-press firing or the pointer being released/moved away. */
  pending: boolean;
  longPressTimer: ReturnType<typeof setTimeout> | null;
}

export function useChartBrush(opts: ChartBrushOptions): ChartBrush {
  const { enabled, onCommit } = opts;
  const minPx = opts.minPx ?? DEFAULT_MIN_PX;
  const longPressMs = opts.longPressMs ?? DEFAULT_LONG_PRESS_MS;

  const [brush, setBrush] = useState<ChartBrushRange | null>(null);
  const [active, setActive] = useState(false);

  const stateRef = useRef<BrushState>({ pointerId: null, startX: 0, pending: false, longPressTimer: null });

  const clearTimer = useCallback(() => {
    const s = stateRef.current;
    if (s.longPressTimer != null) {
      clearTimeout(s.longPressTimer);
      s.longPressTimer = null;
    }
  }, []);

  /** Drops any in-progress gesture without committing — Esc, cancel, disable, or a touch that turned out to be a scroll. */
  const reset = useCallback(() => {
    clearTimer();
    stateRef.current.pointerId = null;
    stateRef.current.pending = false;
    setActive(false);
    setBrush(null);
  }, [clearTimer]);

  const beginActive = useCallback((x: number, target: Element, pointerId: number) => {
    stateRef.current.pending = false;
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      /* best-effort — a brush still works without capture, just less robustly under fast drags */
    }
    setActive(true);
    setBrush({ x0: x, x1: x });
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const x = relativeX(e);
      const s = stateRef.current;
      s.pointerId = e.pointerId;
      s.startX = x;

      if (e.pointerType === 'touch') {
        s.pending = true;
        const target = e.currentTarget as Element;
        const pointerId = e.pointerId;
        s.longPressTimer = setTimeout(() => {
          stateRef.current.longPressTimer = null;
          if (stateRef.current.pending && stateRef.current.pointerId === pointerId) {
            beginActive(stateRef.current.startX, target, pointerId);
          }
        }, longPressMs);
        return; // no capture yet: let the page scroll unless the long press fires
      }

      beginActive(x, e.currentTarget as Element, e.pointerId);
    },
    [enabled, longPressMs, beginActive],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId == null || e.pointerId !== s.pointerId) return;
      const x = relativeX(e);

      if (s.pending) {
        if (Math.abs(x - s.startX) > TOUCH_MOVE_CANCEL_PX) reset();
        return;
      }
      setBrush((prev) => (prev ? { x0: prev.x0, x1: x } : null));
    },
    [reset],
  );

  const commitOrCancel = useCallback(() => {
    const s = stateRef.current;
    if (s.pending) {
      // Released before the long press fired: a tap, not a brush attempt.
      reset();
      return;
    }
    clearTimer();
    s.pointerId = null;
    setActive(false);
    setBrush((prev) => {
      if (prev) {
        const lo = Math.min(prev.x0, prev.x1);
        const hi = Math.max(prev.x0, prev.x1);
        if (hi - lo >= minPx) onCommit(lo, hi);
      }
      return null;
    });
  }, [reset, clearTimer, minPx, onCommit]);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId == null || e.pointerId !== s.pointerId) return;
      commitOrCancel();
    },
    [commitOrCancel],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId == null || e.pointerId !== s.pointerId) return;
      reset();
    },
    [reset],
  );

  // Esc cancels an in-progress brush without committing a range.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, reset]);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    brush,
    active,
  };
}
