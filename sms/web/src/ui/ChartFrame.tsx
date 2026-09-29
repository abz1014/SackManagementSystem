/**
 * Chart overhaul, wave 2, Task T3. The shared frame every chart in this app
 * mounts inside: sizing and a draggable height (`useChartSize`), the
 * existing readout line (`./chart`'s `Readout` — still the aria-live and
 * screen-reader path), a floating tooltip that is positioned so it never
 * covers the hovered mark (`chartLayout.ts`'s `placeTip`), keyboard
 * navigation, a drag-to-select brush that sets the WHOLE PAGE period
 * (`useChartBrush` + `brushToIndices` — the snapping to shift boundaries is
 * done by the caller, not here), and touch-tap pinning.
 *
 * RULE 3 REPLACEMENT (owner decision, this task). `chart.tsx`'s own header
 * still reads "the hover readout is a line of text above the chart, never a
 * floating tooltip" — that predates this task and does not apply to any
 * chart built on ChartFrame. `chart.tsx` is not owned by this task and is
 * deliberately left untouched; the text below is what replaces RULE 3
 * there, for whoever next touches that file:
 *
 *   RULE 3 — A floating tooltip, positioned so it never covers the hovered
 *   mark (`chartLayout.ts`'s `placeTip`), plus the existing readout line
 *   above the chart. The readout is not removed: it is the aria-live,
 *   screen-reader and wall-display path (a tooltip is invisible to all
 *   three), so every value the tooltip states is stated in the readout too,
 *   in words rather than a floating box.
 *
 * DESIGN: ChartFrame does not know how a caller draws its marks. `children`
 * renders the actual SVG (axes, bars, points) and its memo key is the SIZE
 * only (`width/height/fontPx/print`) — never `active` or `brush` — so a
 * pointer move re-renders the tooltip/brush overlay only, never the chart
 * underneath it (the brief's own requirement). Every piece of interactive
 * feedback — the tooltip, the live brush rectangle, the resize handle — is
 * drawn by ChartFrame ITSELF as an absolutely-positioned overlay on top of
 * whatever `children` returned, in the same wrapper-relative pixel frame
 * `hit(x,y)` and `brush.xs` are already given in, so the overlay never has
 * to reach into `children`'s own internal coordinate system (a chart drawn
 * as an SVG with its own viewBox scale, for instance).
 *
 * `state.active`/`state.brush` ARE still passed to `children` (a caller may
 * want to render a coarse default, e.g. an initial emphasis), but because
 * they sit outside the memo's dependency array, `children` only ever sees
 * the value current AT THE LAST SIZE CHANGE — never a live one. That is
 * deliberate, not a bug: it is what keeps a hover from re-running whatever
 * `children` does.
 */
import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Readout } from './chart';
import { useChartSize } from './useChartSize';
import { useChartBrush } from './useChartBrush';
import { placeTip, brushToIndices, type Rect } from './chartLayout';
import { W } from '../lib/words';

export interface ChartTipRow {
  name: string;
  value: string;
  mark?: 'ink' | 'graphite' | 'dashed' | 'acc';
}

export interface ChartTip {
  heading: string;
  rows: ChartTipRow[];
  context?: string[];
  /** Shown only when `onActivate` is supplied — "Open station 7", etc. */
  hint?: string;
}

export interface ChartFrameBrush {
  onCommit: (i0: number, i1: number) => void;
  /** Ascending, wrapper-relative pixel x of every data point — the same
   *  frame `hit(x, y)` reads. */
  xs: number[];
}

export interface ChartFrameState {
  active: number | null;
  brush: { i0: number; i1: number } | null;
}

export interface ChartFrameSize {
  width: number;
  height: number;
  fontPx: number;
  print: boolean;
}

export interface ChartFrameProps {
  chartId: string;
  defaultH: number;
  minH?: number;
  maxH?: number;
  title?: ReactNode;
  caption?: ReactNode;
  /** What the readout says at rest. Defaults to `caption`, then nothing. */
  resting?: ReactNode;
  ariaLabel?: string;
  /** Wrapper-relative pixel to data index, or null outside every mark. */
  hit: (x: number, y: number) => number | null;
  count: number;
  tipFor: (i: number) => ChartTip | null;
  /** Wrapper-relative rect of a mark. Feeds `placeTip`'s exclusion box and
   *  anchors the tooltip for keyboard/touch, where there is no pointer
   *  position to anchor on. */
  markRect?: (i: number) => Rect | null;
  onActivate?: (i: number) => void;
  brush?: ChartFrameBrush;
  /** Formats the live "Release to show …" label while dragging. */
  brushLabel?: (i0: number, i1: number) => string;
  onBack?: () => void;
  children: (size: ChartFrameSize, state: ChartFrameState) => ReactNode;
}

const TIP_WIDTH_PX = 240;
const TIP_ROW_H_PX = 18;
const TIP_PAD_PX = 24;
const RESIZE_STEP_PX = 20;
/** A pointer released within this many px of where it went down is a click,
 *  not a drag — mirrors `useChartBrush`'s own `DEFAULT_MIN_PX` (6), the
 *  distance a brush itself requires before it commits a range. */
const CLICK_MAX_MOVE_PX = 6;

/**
 * A pure-geometry estimate of the tooltip's rendered size, in the same
 * spirit as `chartLayout.ts`'s own `textPx`/`gutterFor` — no DOM
 * measurement, so `placeTip` can be called on the same render that decided
 * to show the tip, not one frame later.
 */
function estimateTipSize(tip: ChartTip): { w: number; h: number } {
  let h = TIP_PAD_PX + 18; // padding + heading line
  h += tip.rows.length * TIP_ROW_H_PX;
  if (tip.context && tip.context.length > 0) h += tip.context.length * 14 + 6;
  if (tip.hint) h += 18;
  return { w: TIP_WIDTH_PX, h };
}

export function ChartFrame(props: ChartFrameProps) {
  const {
    chartId,
    defaultH,
    minH,
    maxH,
    title,
    caption,
    resting,
    ariaLabel,
    hit,
    count,
    tipFor,
    markRect,
    onActivate,
    brush,
    brushLabel,
    onBack,
    children,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useChartSize(wrapRef, { chartId, defaultH, minH, maxH });

  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [kbAnchor, setKbAnchor] = useState<number | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  /* FIX 1 (re-audit, 29 Sep 2026): a mouse/pen click never reached
   * `onActivate` — only the Enter key did, and touch had its own tap path.
   * `chartBrush.active` cannot tell a plain click apart from a drag here:
   * for mouse/pen `useChartBrush.beginActive` sets it true on pointerDOWN,
   * before any movement, so a genuine zero-movement click would already
   * read as "was brushing". This ref instead tracks the pointer's OWN down
   * position, independent of whether a `brush` prop exists at all, so
   * click-activation works on a chart with no brush (StationCompare) and is
   * correctly suppressed on a chart WITH one once the drag clears the same
   * `minPx` distance `useChartBrush`'s own default uses. */
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);

  const wrapperPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: e.clientX - left, y: e.clientY - top };
  }, []);

  const commitBrushPixels = useCallback(
    (px0: number, px1: number) => {
      if (!brush) return;
      const idx = brushToIndices(px0, px1, brush.xs);
      if (idx) brush.onCommit(idx[0], idx[1]);
    },
    [brush],
  );

  const chartBrush = useChartBrush({
    enabled: !!brush && !size.print,
    onCommit: commitBrushPixels,
  });

  const onWrapperPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      chartBrush.bind.onPointerDown(e);
      if (e.pointerType !== 'touch') clickStartRef.current = wrapperPoint(e);
    },
    [chartBrush.bind, wrapperPoint],
  );

  const onWrapperPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      chartBrush.bind.onPointerMove(e);
      if (size.print) return;
      if (e.pointerType === 'touch') return; // touch pins on tap, it does not hover
      const p = wrapperPoint(e);
      lastPointerRef.current = p;
      setActive(hit(p.x, p.y));
    },
    [chartBrush.bind, hit, size.print, wrapperPoint],
  );

  const onWrapperPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wasBrushing = chartBrush.active;
      chartBrush.bind.onPointerUp(e);
      if (e.pointerType === 'touch' && !wasBrushing) {
        const p = wrapperPoint(e);
        const i = hit(p.x, p.y);
        if (i == null) {
          setPinned(false);
          setActive(null);
        } else if (pinned && active === i) {
          // Owner's touch policy: tap shows the tooltip, a SECOND tap on the
          // SAME already-pinned mark activates it — mirrors the mouse click
          // path below without changing the first-tap behaviour.
          onActivate?.(i);
        } else {
          setPinned(true);
          setActive(i);
        }
      } else if (e.pointerType !== 'touch' && !size.print && onActivate) {
        // FIX 1 (re-audit, 29 Sep 2026): mouse/pen click activation.
        // Deliberately NOT gated on `wasBrushing`/`chartBrush.active` — for
        // mouse/pen, `useChartBrush.beginActive` sets `active` true on
        // pointerDOWN itself, before any movement, so a genuine zero-
        // movement click would always read as "was brushing" and this would
        // never fire. Gated on the pointer's OWN measured movement instead,
        // so it works whether or not a `brush` prop exists, and is
        // correctly suppressed once a real drag (>= CLICK_MAX_MOVE_PX,
        // matching `useChartBrush`'s own minPx) has happened.
        const down = clickStartRef.current;
        const p = wrapperPoint(e);
        const moved = down ? Math.hypot(p.x - down.x, p.y - down.y) : Infinity;
        if (moved < CLICK_MAX_MOVE_PX) {
          const i = hit(p.x, p.y);
          if (i != null) onActivate(i);
        }
      }
      if (e.pointerType !== 'touch') clickStartRef.current = null;
    },
    [active, chartBrush.active, chartBrush.bind, hit, onActivate, pinned, size.print, wrapperPoint],
  );

  const onWrapperPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      chartBrush.bind.onPointerCancel(e);
    },
    [chartBrush.bind],
  );

  const onWrapperPointerLeave = useCallback(() => {
    if (pinned) return;
    setActive(null);
  }, [pinned]);

  /* The resize handle's own onDoubleClick calls stopPropagation(), so a
     double-click there never reaches this one — resetting the height must
     not also count as "back". */
  const onWrapperDoubleClick = useCallback(() => {
    onBack?.();
  }, [onBack]);

  const clampIndex = useCallback((i: number) => Math.min(count - 1, Math.max(0, i)), [count]);

  const onWrapperKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (size.print || count <= 0) return;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          const anchorBase = active;
          setActive((a) => {
            const cur = a ?? (dir < 0 ? count : -1);
            return clampIndex(cur + dir);
          });
          setPinned(true);
          if (e.shiftKey && brush) {
            setKbAnchor((anchor) => anchor ?? anchorBase ?? 0);
          } else {
            setKbAnchor(null);
          }
          break;
        }
        case 'Home':
          e.preventDefault();
          setActive(0);
          setPinned(true);
          setKbAnchor(null);
          break;
        case 'End':
          e.preventDefault();
          setActive(count - 1);
          setPinned(true);
          setKbAnchor(null);
          break;
        case 'Escape':
          setActive(null);
          setPinned(false);
          setKbAnchor(null);
          break;
        case 'Enter':
          if (active != null) onActivate?.(active);
          break;
        case '+':
        case '=':
          if (brush && active != null) {
            const i0 = Math.min(kbAnchor ?? active, active);
            const i1 = Math.max(kbAnchor ?? active, active);
            brush.onCommit(i0, i1);
            setKbAnchor(null);
          }
          break;
        case '-':
        case '_':
          onBack?.();
          break;
        default:
          break;
      }
    },
    [active, brush, clampIndex, count, kbAnchor, onActivate, onBack, size.print],
  );

  /* The resize handle. Drag: pointer capture + a delta from the pointer's
     start y. Keyboard: ArrowUp/ArrowDown +/-20px. Double-click resets — its
     own handler stops the click reaching the wrapper's onDoubleClick
     (onBack), which would otherwise fire on every reset. */
  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (size.print) return;
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* best-effort */
      }
      dragStartRef.current = { y: e.clientY, h: size.height };
      setResizing(true);
    },
    [size.height, size.print],
  );

  const onHandlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dy = e.clientY - start.y;
      size.setHeight(start.h + dy);
    },
    [size],
  );

  const onHandlePointerUp = useCallback(() => {
    dragStartRef.current = null;
    setResizing(false);
  }, []);

  const onHandleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        size.setHeight(size.height - RESIZE_STEP_PX);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        size.setHeight(size.height + RESIZE_STEP_PX);
      }
    },
    [size],
  );

  const onHandleDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      size.resetHeight();
    },
    [size],
  );

  const frameSize: ChartFrameSize = { width: size.width, height: size.height, fontPx: size.fontPx, print: size.print };
  const frameState: ChartFrameState = {
    active,
    brush: kbAnchor != null && active != null ? { i0: Math.min(kbAnchor, active), i1: Math.max(kbAnchor, active) } : null,
  };

  // See the header comment: intentionally NOT keyed on active/brush/state, so
  // a hover or keyboard move re-renders the overlay only, never `children`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const child = useMemo(
    () => children(frameSize, frameState),
    [frameSize.width, frameSize.height, frameSize.fontPx, frameSize.print, children],
  );

  const tip = active != null ? tipFor(active) : null;
  const markBox = active != null ? markRect?.(active) ?? null : null;
  const anchor = markBox ? { x: markBox.x + markBox.w, y: markBox.y + markBox.h / 2 } : lastPointerRef.current;
  const tipSize = tip ? estimateTipSize(tip) : { w: 0, h: 0 };
  const tipPos = tip
    ? placeTip(anchor, tipSize, { w: size.width, h: size.height }, markBox ?? undefined)
    : { x: 0, y: 0 };

  const liveBrush = chartBrush.brush;
  const liveIdx = liveBrush && brush ? brushToIndices(liveBrush.x0, liveBrush.x1, brush.xs) : null;
  const liveLabel = liveIdx && brushLabel ? brushLabel(liveIdx[0], liveIdx[1]) : liveIdx ? `${liveIdx[0]}–${liveIdx[1]}` : '';

  const hoveredReadout = tip
    ? tip.rows.length > 0
      ? `${tip.heading} · ${tip.rows.map((r) => `${r.name} ${r.value}`).join(', ')}`
      : tip.heading
    : null;

  return (
    <div className="chart-frame">
      {title && <p className="h2">{title}</p>}
      <Readout hovered={hoveredReadout} resting={resting ?? caption ?? ''} />
      <div
        ref={wrapRef}
        className={`chart-frame-body${resizing ? ' resizing' : ''}`}
        style={{ position: 'relative', height: size.height, touchAction: 'pan-y' }}
        tabIndex={size.print ? -1 : 0}
        role="img"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        title={brush ? W.chart.dragToSelectRange : undefined}
        onPointerDown={onWrapperPointerDown}
        onPointerMove={onWrapperPointerMove}
        onPointerUp={onWrapperPointerUp}
        onPointerCancel={onWrapperPointerCancel}
        onPointerLeave={onWrapperPointerLeave}
        onDoubleClick={onWrapperDoubleClick}
        onKeyDown={onWrapperKeyDown}
      >
        {child}

        {!size.print && brush && liveBrush && (
          <div
            className="chart-brush"
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              height: size.height,
              left: Math.min(liveBrush.x0, liveBrush.x1),
              width: Math.max(1, Math.abs(liveBrush.x1 - liveBrush.x0)),
            }}
          />
        )}
        {!size.print && brush && chartBrush.active && (
          <div className="chart-brush-label" role="status" aria-live="polite">
            {W.chart.releaseToShow(liveLabel)}
          </div>
        )}

        {!size.print && tip && (
          <div
            className="chart-tip"
            role="presentation"
            aria-hidden="true"
            style={{ position: 'absolute', left: tipPos.x, top: tipPos.y, width: TIP_WIDTH_PX, pointerEvents: 'none' }}
          >
            <p className="chart-tip-h">{tip.heading}</p>
            <ul>
              {tip.rows.map((r) => (
                <li key={r.name} className={r.mark ? `m-${r.mark}` : undefined}>
                  <span>{r.name}</span>
                  <b>{r.value}</b>
                </li>
              ))}
            </ul>
            {tip.context && tip.context.length > 0 && (
              <p className="chart-tip-ctx">{tip.context.join(' · ')}</p>
            )}
            {tip.hint && onActivate && <p className="chart-tip-hint">{tip.hint}</p>}
          </div>
        )}

        {!size.print && (
          <div
            className="chart-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label={W.chart.dragToResize}
            aria-valuenow={Math.round(size.height)}
            aria-valuemin={minH ?? 160}
            aria-valuemax={maxH ?? 720}
            tabIndex={0}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            onDoubleClick={onHandleDoubleClick}
            onKeyDown={onHandleKeyDown}
          />
        )}
      </div>
      {caption && <p className="chart-frame-caption">{caption}</p>}
    </div>
  );
}
