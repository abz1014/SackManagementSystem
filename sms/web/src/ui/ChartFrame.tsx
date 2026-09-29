/**
 * Chart overhaul, wave 2, Task T3. The shared frame every chart in this app
 * mounts inside: sizing and a draggable height (`useChartSize`), the
 * existing readout line (`./chart`'s `Readout` — still the aria-live and
 * screen-reader path), a floating tooltip that is positioned so it never
 * covers the hovered mark (`chartLayout.ts`'s `placeTip`), keyboard
 * navigation, and touch-tap pinning.
 *
 * RULE 3 REPLACEMENT (owner decision, wave 2). `chart.tsx`'s own header
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
 * CLICK-TO-ZOOM (owner decision, wave 4, Task W1, 29 Sep 2026): drag-to-
 * select is REMOVED from every chart in this app. `useChartBrush.ts` is
 * deleted outright, along with `brushToIndices` (`chartLayout.ts`) and every
 * brush-shaped prop this file used to carry (`brush`, `brushLabel`,
 * `ChartFrameBrush`, `ChartFrameState.brush`). In its place: clicking a day
 * or shift mark zooms the whole page to that day/shift; Enter does the same
 * for the keyboard-active mark; on touch, a first tap pins the tooltip and a
 * second tap on the SAME pinned mark zooms. `zoom` is index-based
 * (`periodFor(i)`), not pixel-based — there is no drag geometry left to
 * reason about. Station bars keep using `onActivate` to open the station
 * sheet; a caller passing BOTH `onActivate` and `zoom` gets `onActivate` —
 * see `activate` below.
 *
 * DESIGN: ChartFrame does not know how a caller draws its marks. `children`
 * renders the actual SVG (axes, bars, points) and its memo key is the SIZE
 * only (`width/height/fontPx/print`) — never `active` — so a pointer move
 * re-renders the tooltip overlay only, never the chart underneath it (the
 * brief's own requirement). Every piece of interactive feedback — the
 * tooltip, the resize handle — is drawn by ChartFrame ITSELF as an
 * absolutely-positioned overlay on top of whatever `children` returned, in
 * the same wrapper-relative pixel frame `hit(x,y)` is already given in, so
 * the overlay never has to reach into `children`'s own internal coordinate
 * system (a chart drawn as an SVG with its own viewBox scale, for instance).
 *
 * `state.active` IS still passed to `children` (a caller may want to render
 * a coarse default, e.g. an initial emphasis), but because it sits outside
 * the memo's dependency array, `children` only ever sees the value current
 * AT THE LAST SIZE CHANGE — never a live one. That is deliberate, not a bug:
 * it is what keeps a hover from re-running whatever `children` does.
 */
import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Readout } from './chart';
import { useChartSize } from './useChartSize';
import { placeTip, type Rect } from './chartLayout';
import { W } from '../lib/words';
import type { PeriodParams } from '../lib/period';

export interface ChartTipRow {
  name: string;
  value: string;
  mark?: 'ink' | 'graphite' | 'dashed' | 'acc';
}

export interface ChartTip {
  heading: string;
  rows: ChartTipRow[];
  context?: string[];
  /** Shown only when the mark can be activated (`onActivate` or `zoom`
   *  resolving a period for it) — "Open station 7", etc. Takes precedence
   *  over `zoom`'s own `hint`/the built-in `zoomHint` fallback. */
  hint?: string;
}

/**
 * Click-to-zoom (chart overhaul wave 4, Task W1): a mark that, when
 * activated, sets the WHOLE PAGE's period rather than opening a detail
 * sheet. `periodFor` returning null means that particular mark has nothing
 * to zoom to (e.g. a bin/product bar) — such a mark is not activatable and
 * gets no pointer cursor, no hint, no click/Enter/tap behaviour.
 */
export interface ChartFrameZoom {
  periodFor: (i: number) => PeriodParams | null;
  onZoom: (p: PeriodParams) => void;
  /** Overrides the built-in `zoomHint` copy for a specific mark. */
  hint?: (i: number) => string;
}

export interface ChartFrameState {
  active: number | null;
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
  /** Opens a per-mark detail (a station sheet, say). Wins over `zoom` when
   *  both are given — see `activate` below. */
  onActivate?: (i: number) => void;
  /** Zooms the whole page to the period a mark represents. Ignored when
   *  `onActivate` is also given. */
  zoom?: ChartFrameZoom;
  onBack?: () => void;
  children: (size: ChartFrameSize, state: ChartFrameState) => ReactNode;
}

const TIP_WIDTH_PX = 240;
const TIP_ROW_H_PX = 18;
const TIP_PAD_PX = 24;
const RESIZE_STEP_PX = 20;
/** A pointer released within this many px of where it went down is a click,
 *  not a drag. */
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

/**
 * The built-in hint copy for a zoomable mark, used when neither the tip
 * itself (`ChartTip.hint`) nor the zoom config (`ChartFrameZoom.hint`)
 * supplies one. `p` is whatever `zoom.periodFor(i)` returned for the active
 * mark — always a 'range' period with `range` set, in practice, since that
 * is the only shape `snapToShifts` ever produces, but this reads the fields
 * defensively rather than assuming the caller only ever uses that helper.
 */
export function zoomHint(p: PeriodParams | null): string {
  const range = p?.range;
  if (!range) return W.chart.clickToShowRange;
  const { from, to } = range;
  if (from.date === to.date && from.shift === to.shift) return W.chart.clickToShowShift;
  if (from.date === to.date && from.shift === 'morning' && to.shift === 'night') return W.chart.clickToShowDay;
  return W.chart.clickToShowRange;
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
    zoom,
    onBack,
    children,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useChartSize(wrapRef, { chartId, defaultH, minH, maxH });

  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  /* The pointer's OWN down position, so a click can be told apart from a
   * drag on any chart, brush or no brush (there is no brush any more, but
   * the distinction still matters: a chart pan/selection elsewhere on the
   * page must not itself count as a click on the mark underneath). */
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);

  /* CLICK-TO-ZOOM: `onActivate` wins when both are supplied — a caller
   * offering a detail sheet (station bars) never has that silently
   * replaced by a page-wide zoom. */
  const activate = onActivate ?? (zoom ? (i: number) => {
    const p = zoom.periodFor(i);
    if (p) zoom.onZoom(p);
  } : undefined);

  const wrapperPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: e.clientX - left, y: e.clientY - top };
  }, []);

  const onWrapperPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'touch') clickStartRef.current = wrapperPoint(e);
    },
    [wrapperPoint],
  );

  const onWrapperPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (size.print) return;
      if (e.pointerType === 'touch') return; // touch pins on tap, it does not hover
      const p = wrapperPoint(e);
      lastPointerRef.current = p;
      setActive(hit(p.x, p.y));
    },
    [hit, size.print, wrapperPoint],
  );

  const onWrapperPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'touch') {
        const p = wrapperPoint(e);
        const i = hit(p.x, p.y);
        if (i == null) {
          setPinned(false);
          setActive(null);
        } else if (pinned && active === i) {
          // Owner's touch policy: tap shows the tooltip, a SECOND tap on the
          // SAME already-pinned mark activates it — mirrors the mouse click
          // path below without changing the first-tap behaviour.
          activate?.(i);
        } else {
          setPinned(true);
          setActive(i);
        }
      } else if (!size.print && activate) {
        const down = clickStartRef.current;
        const p = wrapperPoint(e);
        const moved = down ? Math.hypot(p.x - down.x, p.y - down.y) : Infinity;
        if (moved < CLICK_MAX_MOVE_PX) {
          const i = hit(p.x, p.y);
          if (i != null) activate(i);
        }
      }
      if (e.pointerType !== 'touch') clickStartRef.current = null;
    },
    [active, activate, hit, pinned, size.print, wrapperPoint],
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
          setActive((a) => {
            const cur = a ?? (dir < 0 ? count : -1);
            return clampIndex(cur + dir);
          });
          setPinned(true);
          break;
        }
        case 'Home':
          e.preventDefault();
          setActive(0);
          setPinned(true);
          break;
        case 'End':
          e.preventDefault();
          setActive(count - 1);
          setPinned(true);
          break;
        case 'Escape':
          setActive(null);
          setPinned(false);
          break;
        case 'Enter':
          if (active != null) activate?.(active);
          break;
        case '-':
        case '_':
          onBack?.();
          break;
        default:
          break;
      }
    },
    [active, activate, clampIndex, count, onBack, size.print],
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
  const frameState: ChartFrameState = { active };

  // See the header comment: intentionally NOT keyed on active/state, so a
  // hover or keyboard move re-renders the overlay only, never `children`.
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

  // The period the active mark would zoom to, if any — computed once here
  // rather than inside the JSX below, since both the cursor class and the
  // tooltip hint need it.
  const activePeriod = zoom && active != null ? zoom.periodFor(active) : null;
  const canActivateActive = active != null && (!!onActivate || (!!zoom && activePeriod != null));
  const hintText = canActivateActive
    ? (tip?.hint ?? (zoom ? zoom.hint?.(active as number) ?? zoomHint(activePeriod) : undefined))
    : undefined;

  const hoveredReadout = tip
    ? tip.rows.length > 0
      ? `${tip.heading} · ${tip.rows.map((r) => (r.name ? `${r.name} ${r.value}` : r.value)).join(' · ')}`
      : tip.heading
    : null;

  return (
    <div className="chart-frame">
      {title && <p className="h2">{title}</p>}
      <Readout hovered={hoveredReadout} resting={resting ?? caption ?? ''} />
      <div
        ref={wrapRef}
        className={`chart-frame-body${resizing ? ' resizing' : ''}${canActivateActive ? ' can-activate' : ''}`}
        style={{ position: 'relative', height: size.height, touchAction: 'pan-y' }}
        tabIndex={size.print ? -1 : 0}
        role="img"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        onPointerDown={onWrapperPointerDown}
        onPointerMove={onWrapperPointerMove}
        onPointerUp={onWrapperPointerUp}
        onPointerLeave={onWrapperPointerLeave}
        onDoubleClick={onWrapperDoubleClick}
        onKeyDown={onWrapperKeyDown}
      >
        {child}

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
            {hintText && <p className="chart-tip-hint">{hintText}</p>}
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
