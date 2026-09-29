/**
 * Chart primitives. Not a charting library — the four shapes this app needs,
 * drawn as plain SVG, plus the rules that made the old charts unreadable and
 * are enforced here so no screen can break them again.
 *
 * RULE 1 — NOTHING SHARES A LINE WITH THE DATA MARKS. The old run/stop ribbon
 * drew the shift names inside the band, so a stoppage block landed on top of
 * "EVENING" and cut the word in half. Labels get their own row, always.
 *
 * RULE 2 — EDGE LABELS ANCHOR INWARD. A tick at x=0 centred on its position
 * hangs half its width off the left of the plot; the last one runs off the
 * right. First tick anchors `start`, last anchors `end`, the rest `middle`.
 *
 * RULE 3 — A floating tooltip, positioned so it never covers the hovered
 * mark (chartLayout.ts's placeTip), plus the existing readout line above the
 * chart. The readout is not removed: it is the aria-live, screen-reader and
 * wall-display path (a tooltip is invisible to all three), so every value the
 * tooltip states is stated in the readout too, in words rather than a
 * floating box.
 *
 * (This rule was rewritten for the chart overhaul, wave 3, Task T4, 29 Sep
 * 2026 — replacing the original "hover readout only, never a floating
 * tooltip" text, which predated `ChartFrame.tsx` and had already been
 * superseded there in wave 2/Task T3's own header comment. `CategoryBars`
 * below is the first caller built on `ChartFrame`; `RefLine`'s label
 * placement is fixed separately, in the right gutter rather than a tooltip,
 * since a reference line's label is a standing fact about the chart, not
 * something that only appears on hover.)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { ChartFrame, type ChartTip, type ChartTipRow, type ChartFrameZoom } from './ChartFrame';
import { placeGutterLabels, bandHit, textPx, type GutterLabelIn, type GutterLabelOut, type Rect } from './chartLayout';
import { useChartWidthFromSize } from './useChartSize';
import { snapToShifts, type PeriodParams, type ShiftRef } from '../lib/period';

/* ------------------------------------------------------------------ sizing */

/**
 * The rendered width of a block, so a chart can choose how many labels fit
 * rather than drawing a fixed number and letting them collide.
 *
 * A thin wrapper over `useChartSize.ts`'s `useChartWidthFromSize` (chart
 * overhaul wave 1, Task T2) — that module owns the resize/print/height
 * logic now; this keeps every existing caller (`Weight.tsx`,
 * `report/shared.tsx`) compiling against the same `[ref, width]` shape
 * without duplicating any of it here.
 */
export function useChartWidth(fallback = 1036): [RefObject<HTMLDivElement>, number] {
  // Cast, not a real narrowing: `useChartWidthFromSize`'s ref can only ever
  // be null before the wrapped <div> mounts, same as `useRef<HTMLDivElement>
  // (null)` always was here before this task — every existing caller
  // (`Weight.tsx`, `report/shared.tsx`) already assigns this ref straight
  // onto a `<div>` and never reads `.current` before that div exists.
  return useChartWidthFromSize(fallback) as [RefObject<HTMLDivElement>, number];
}

/**
 * How many x labels fit without touching, given the plot width and the widest
 * label. Returns at least 2 (the two ends) and never more than the data length.
 */
export function fittingTicks(plotW: number, labelChars: number, fontPx: number, dataLen: number, max = 8): number {
  const labelW = labelChars * fontPx * 0.58 + 18; // 0.58em average advance + gutter
  const fits = Math.max(2, Math.floor(plotW / labelW));
  return Math.max(2, Math.min(max, fits, dataLen));
}

/** Indices of `count` labels spread evenly across `len` points, ends included. */
export function tickIndices(len: number, count: number): number[] {
  if (len <= 1) return [0];
  const n = Math.max(2, Math.min(count, len));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((i * (len - 1)) / (n - 1)));
  return [...new Set(out)];
}

/** RULE 2: the first label anchors to its start, the last to its end. */
export function edgeAnchor(i: number, len: number): 'start' | 'middle' | 'end' {
  if (i === 0) return 'start';
  if (i === len - 1) return 'end';
  return 'middle';
}

/* ---------------------------------------------------------------- readout */

/**
 * The line of text above a chart. `resting` is what it says when nobody is
 * pointing at anything, so the chart is not mute on a wall display. Also the
 * aria-live/screen-reader path for `ChartFrame`'s own floating tooltip — see
 * RULE 3 above.
 */
export function Readout({ hovered, resting }: { hovered: ReactNode; resting: ReactNode }) {
  return (
    <div className="readout" aria-live="polite">
      <span className="dim">{resting}</span>
      {hovered != null && <span className="sr-only">{hovered}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ hover bands */

/**
 * One invisible hit rectangle per data point, plus a crosshair on the hovered
 * one. Bands rather than the marks themselves: a 4px circle is a hard target
 * with a mouse and impossible with a finger, and the gap between marks belongs
 * to the nearer of the two.
 *
 * Keyboard reaches the same readings through the table beneath every chart, so
 * the bands are correctly `aria-hidden`; a chart that is the ONLY route to a
 * value must expose it in its readout instead.
 *
 * Kept for charts not yet moved onto `ChartFrame` (`Weight.tsx`,
 * `report/shared.tsx`) — `CategoryBars` below no longer uses this, having
 * moved onto `ChartFrame`'s own `hit()`-based hover instead.
 */
export function HoverBands({
  count,
  x,
  top,
  height,
  onHover,
}: {
  count: number;
  x: (i: number) => number;
  top: number;
  height: number;
  onHover: (i: number | null) => void;
}) {
  const band = count > 1 ? (x(count - 1) - x(0)) / (count - 1) : 0;
  return (
    <g aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <rect
          key={i}
          className="hit"
          x={x(i) - band / 2}
          y={top}
          width={Math.max(band, 1)}
          height={height}
          onMouseEnter={() => onHover(i)}
          onFocus={() => onHover(i)}
        />
      ))}
    </g>
  );
}

/** A vertical crosshair through the hovered point. */
export function Crosshair({ x, top, bottom }: { x: number; top: number; bottom: number }) {
  return <line x1={x} x2={x} y1={top} y2={bottom} stroke="var(--rule-2)" strokeWidth={1} aria-hidden="true" />;
}

/* -------------------------------------------------------------- scales */

export interface Scale {
  (v: number): number;
  domain: [number, number];
}

/** A linear scale. `nice` pads the domain out to round numbers. */
export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const f = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as Scale;
  f.domain = domain;
  return f;
}

/**
 * A y domain that includes zero for counts, or hugs the data for measurements
 * where zero is meaningless — a cone weight chart with a zero baseline flattens
 * every real variation into a straight line.
 */
export function niceDomain(values: number[], opts: { zero?: boolean; pad?: number } = {}): [number, number] {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length === 0) return [0, 1];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (opts.zero) lo = Math.min(0, lo);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * (opts.pad ?? 0.12);
  lo -= pad;
  hi += pad;
  if (opts.zero) lo = Math.min(0, lo);
  const step = niceStep((hi - lo) / 4);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** At most `count` gridline values inside the domain. Three is the house limit. */
export function gridValues([lo, hi]: [number, number], count = 3): number[] {
  const step = niceStep((hi - lo) / (count + 1));
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Number(v.toFixed(6)));
  // Drop the domain ends: a gridline exactly on the frame is a duplicate of it.
  return out.filter((v) => v > lo && v < hi).slice(0, count + 1);
}

/* ------------------------------------------------------- labelled markers */

/**
 * A shared collector for a chart's `RefLine`s in `placement="gutter"` mode:
 * every `RefLine` inside one provider registers its natural y and label text,
 * and the provider runs `chartLayout.ts`'s `placeGutterLabels` once over all
 * of them, so two reference lines that land near the same y get pushed apart
 * instead of overprinting each other — the "row median"/"Flag threshold"
 * defect a screenshot caught 25 Sep 2026 (see `DeviationBars` in
 * `report/shared.tsx`, and `RefLine`'s own history below).
 *
 * Registration happens in a `useLayoutEffect` writing into React state
 * (`items`), so a `RefLine` mounting/unmounting or changing its `y`/`label`
 * triggers exactly one extra render of the subtree the provider wraps, and
 * `act()` in tests flushes it before the test's next assertion.
 */
interface GutterCtxValue {
  register: (id: string, item: GutterLabelIn) => void;
  unregister: (id: string) => void;
  results: Map<string, GutterLabelOut>;
  fontPx: number;
}

const RefLineGutterContext = createContext<GutterCtxValue | null>(null);

export function RefLineGutterProvider({
  top,
  bottom,
  fontPx = 12,
  children,
}: {
  top: number;
  bottom: number;
  /** Measured chart font size (`ChartFrameSize.fontPx`), used for the
   *  gutter's line-height math — a caller not yet on `ChartFrame` may pass a
   *  fixed fallback instead. */
  fontPx?: number;
  children: ReactNode;
}) {
  const [items, setItems] = useState<Map<string, GutterLabelIn>>(new Map());

  const register = useCallback((id: string, item: GutterLabelIn) => {
    setItems((prev) => {
      const existing = prev.get(id);
      if (existing && existing.y === item.y && existing.text === item.text && existing.prio === item.prio) return prev;
      const next = new Map(prev);
      next.set(id, item);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setItems((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const ids = Array.from(items.keys());
  const ins = ids.map((id) => items.get(id)!);
  const lineH = fontPx * 1.3;
  const outs = placeGutterLabels(ins, { top, bottom, lineH });
  const results = new Map<string, GutterLabelOut>();
  ids.forEach((id, i) => results.set(id, outs[i]!));

  const value: GutterCtxValue = { register, unregister, results, fontPx };

  return <RefLineGutterContext.Provider value={value}>{children}</RefLineGutterContext.Provider>;
}

/**
 * A horizontal reference line — a target, a limit, a line mean. Drawn as a
 * thin labelled line rather than a shaded statistical band, because a band
 * invites the question "what is that band?" and the answer belongs behind
 * the Details disclosure.
 */
export function RefLine({
  y,
  x1,
  x2,
  label,
  tone = 'muted',
  dashed,
  labelInside,
  placement,
  fontPx = 12,
  gutterX,
  prio,
}: {
  y: number;
  x1: number;
  x2: number;
  label?: string;
  tone?: 'ink' | 'muted' | 'accent';
  dashed?: boolean;
  /** @deprecated 29 Sep 2026 (Task T4) — kept compiling for `Weight.tsx` and
   *  `report/shared.tsx`, which both still pass it, but it no longer draws
   *  the label INSIDE the plot: it now maps straight onto `placement="gutter"`
   *  below, so those callers get the de-collided gutter behaviour "for free"
   *  the next time they render, even standalone (see the no-provider
   *  fallback below). Use `placement="gutter"` directly in new code instead;
   *  `labelInside` is not read once `placement` is given explicitly. */
  labelInside?: boolean;
  /** 'end' (default): label drawn once, at `x2 + 8`, inline with the line —
   *  the original behaviour, correct only for a chart that reserves a right
   *  margin wide enough for its longest label and draws at most one RefLine.
   *  'gutter': the label is handed to the nearest `RefLineGutterProvider`
   *  ancestor, which de-collides it against every other gutter `RefLine` in
   *  the same chart (see that component's own doc comment). A 6px leader
   *  tick is drawn from the line to a label that had to move to avoid a
   *  collision, so the reader can still tell which line it belongs to. */
  placement?: 'end' | 'gutter';
  /** Measured font size (`ChartFrameSize.fontPx`) — gutter mode's label is
   *  drawn at this size explicitly (never the `var(--fs-tick)` CSS custom
   *  property 'end' mode uses), because the gutter's own vertical spacing
   *  (`RefLineGutterProvider`'s `lineH`) is computed from the same number and
   *  the two must agree for the de-collision to be correct. */
  fontPx?: number;
  /** The gutter column's left edge. Defaults to `x2 + 8`, matching 'end'
   *  mode's own offset, so switching a `RefLine` from 'end' to 'gutter'
   *  moves nothing horizontally unless the caller widened its own right
   *  margin (`chartLayout.ts`'s `gutterFor` sizes that margin). */
  gutterX?: number;
  /** Forwarded to `placeGutterLabels` — a higher-priority label survives a
   *  drop first when the gutter is too short for every registered line. */
  prio?: number;
}) {
  const stroke = tone === 'ink' ? 'var(--graphite)' : tone === 'accent' ? 'var(--acc)' : 'var(--grid)';
  const fill = tone === 'accent' ? 'var(--acc)' : 'var(--graphite)';
  const mode: 'end' | 'gutter' = placement ?? (labelInside ? 'gutter' : 'end');

  const gid = useId();
  const ctx = useContext(RefLineGutterContext);
  const gutterFontPx = ctx?.fontPx ?? fontPx;
  // `register`/`unregister` are memoized with empty deps in the provider, so
  // THEIR identity is stable across every provider render; `ctx` itself is a
  // fresh object every provider render (it carries `results`, which legitimately
  // changes whenever any sibling RefLine registers). Depending on `ctx` here
  // instead of these two functions would re-run this effect — cleanup
  // (unregister) then re-run (register) — on every provider re-render, and
  // since unregister always produces a real state change when the item
  // exists, that becomes an infinite unregister/register ping-pong (caught
  // the hard way: it crashed the vitest worker outright rather than looping
  // visibly). Depend on the stable functions, never on `ctx` as a whole.
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    if (mode !== 'gutter' || !register || !unregister || !label) return;
    register(gid, { y, text: label, prio });
    return () => unregister(gid);
  }, [mode, register, unregister, gid, label, y, prio]);

  const gx = gutterX ?? x2 + 8;

  if (mode === 'gutter') {
    const out = ctx ? ctx.results.get(gid) ?? null : null;
    // No provider (a caller not yet wrapped in one, or `labelInside` used
    // standalone): fall back to the label's own natural y, uncollided —
    // still in the gutter column, never overprinting the line the way the
    // old `labelInside` behaviour risked for a bare `x2+8` margin.
    const labelY = out ? out.y : y;
    const dropped = out ? out.text === '' && out.displaced : false;
    const displaced = out?.displaced ?? false;
    const text = out ? out.text : label;
    return (
      <g aria-hidden="true">
        <line x1={x1} x2={x2} y1={y} y2={y} stroke={stroke} strokeWidth={1} strokeDasharray={dashed ? '3 3' : undefined} />
        {label && displaced && !dropped && (
          <line x1={x2} y1={y} x2={x2 + 6} y2={labelY} stroke={stroke} strokeWidth={1} className="refline-leader" />
        )}
        {label && !dropped && (
          <text x={gx} y={labelY + gutterFontPx * 0.35} fontSize={gutterFontPx} fill={fill}>
            {text}
          </text>
        )}
      </g>
    );
  }

  return (
    <g aria-hidden="true">
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={stroke} strokeWidth={1} strokeDasharray={dashed ? '3 3' : undefined} />
      {label && (
        <text x={x2 + 8} y={y + 4} fontSize="var(--fs-tick)" fill={fill}>
          {label}
        </text>
      )}
    </g>
  );
}

/* --------------------------------------------------------- category bars */

export interface BarDatum {
  key: string;
  /** The x-axis tick, already short. */
  label: string;
  value: number;
  /** The whole readout/tooltip line for this bar, when hovered. */
  detail?: ReactNode;
}

/**
 * Vertical bars over categories — days, shifts, products — with a zero
 * baseline, at most three gridlines, ticks that thin themselves to fit, and
 * a tooltip + readout on hover/focus, built on `ChartFrame` (chart overhaul
 * wave 3, Task T4, 29 Sep 2026 — was a hand-rolled `Readout`/`HoverBands`/
 * `Crosshair` stack before this).
 *
 * BARS, NEVER A LINE, and that is a rule rather than a preference on this
 * data. The plant dropped and recreated its weighing tables on 2026-08-05,
 * and the sidecar additionally holds simulator rows overlapping the real
 * ones, so a period can span two source generations with a hole between
 * them. A line drawn across that gap asserts one continuous process; a bar
 * says nothing whatever about the day beside it. Every caller on Line and
 * Sacks draws days this way for that reason.
 *
 * The caller passes the resting summary: a chart on a wall display that says
 * nothing until someone points at it is mute to the room it hangs in.
 *
 * SIZING NOTE, stated honestly rather than glossed over: `ChartFrame` owns
 * its own width/height measurement internally (`useChartSize`) and only
 * hands it to the `hit`/`tipFor`/`markRect` callbacks THIS component
 * supplies, not the other way round — so this component cannot know the
 * true measured width before ChartFrame's own first render. The bars
 * themselves are drawn correctly from the very first paint (the `children`
 * render function gets the live `size` argument directly). Only
 * `hit`/`markRect` (via `layoutRef`, updated every render) can lag the true
 * width by up to one paint after a resize, self-correcting on this
 * component's next render (a data refresh, in practice, arrives well
 * under a minute later on every screen that uses this).
 */
export function CategoryBars({
  data,
  height = 280,
  ariaLabel,
  resting,
  valueFmt = (v: number) => String(v),
  leftGutter = 56,
  chartId,
  tip,
  onActivate,
  zoom,
  onBack,
}: {
  data: BarDatum[];
  height?: number;
  ariaLabel: string;
  resting: ReactNode;
  valueFmt?: (v: number) => string;
  leftGutter?: number;
  /** `ChartFrame`'s persisted-height storage key. Falls back to `ariaLabel`
   *  (always distinct per chart in this app's own screens) when omitted. */
  chartId?: string;
  /** Extra tooltip content per bar index, appended after the day/shift label
   *  heading and the bar's own value row `ChartFrame` always states. */
  tip?: (i: number) => ChartTip | null;
  onActivate?: (i: number) => void;
  /**
   * Clicking a bar (or Enter on the keyboard-active one, or a second tap on
   * touch) sets the WHOLE PAGE's period, snapped to shift boundaries — one
   * `ShiftRef` pair per bar, `[first, last]` of the shifts that bar covers:
   * a day bar is `D.morning..D.night`, a shift bar is `[that shift, that
   * shift]`. Ignored when `onActivate` is also given (see `ChartFrame`'s own
   * `activate` precedence).
   */
  zoom?: { refs: [ShiftRef, ShiftRef][]; onSelect: (p: PeriodParams) => void };
  onBack?: () => void;
}) {
  interface Layout {
    L: number;
    R: number;
    T: number;
    B: number;
    y: Scale;
    slot: number;
    bw: number;
    cx: (i: number) => number;
    zeroY: number;
  }

  const layoutRef = useRef<Layout | null>(null);

  const computeLayout = useCallback(
    (width: number, h: number): Layout => {
      const L = leftGutter;
      const R = 10;
      const T = 16;
      const B = 30;
      const [lo, hi] = niceDomain(
        data.map((d) => d.value),
        { zero: true, pad: 0.06 },
      );
      const y = linear([lo, hi], [h - B, T]);
      const slot = (width - L - R) / Math.max(1, data.length);
      // Capped, or a two-day period draws two 400px-wide slabs across a
      // full-width chart. Past about 64px of width a bar stops reading as a
      // bar at all.
      const bw = Math.min(64, Math.max(3, slot * 0.62));
      const cx = (i: number) => L + slot * i + slot / 2;
      return { L, R, T, B, y, slot, bw, cx, zeroY: y(0) };
    },
    [data, leftGutter],
  );

  const hit = useCallback(
    (px: number, py: number): number | null => {
      const layout = layoutRef.current;
      if (!layout) return null;
      // Outside the plot's own vertical band (above the top margin, or below
      // where the x-axis labels/bottom margin start): no bar there, even if
      // the pointer is still inside ChartFrame's wrapper div.
      if (py < layout.T) return null;
      return bandHit(px, layout.L, layout.slot, data.length);
    },
    [data.length],
  );

  const markRect = useCallback(
    (i: number): Rect | null => {
      const layout = layoutRef.current;
      const d = data[i];
      if (!layout || !d) return null;
      const bx = layout.cx(i) - layout.bw / 2;
      const by = Math.min(layout.zeroY, layout.y(d.value));
      const bh = Math.max(1, Math.abs(layout.y(d.value) - layout.zeroY));
      return { x: bx, y: by, w: layout.bw, h: bh };
    },
    [data],
  );

  const tipFor = useCallback(
    (i: number): ChartTip | null => {
      const d = data[i];
      if (!d) return null;
      const extra = tip?.(i);
      // Strip a leading "<label> · " from the caller's detail string — the
      // readout already states the label once as the heading, and a value
      // row repeating it produced the "Night · Night · …" defect this task
      // closes (ChartFrame's own readout, not this tooltip, but the same
      // string feeds both).
      const prefix = `${d.label} · `;
      let detailStr = typeof d.detail === 'string' ? d.detail : valueFmt(d.value);
      if (detailStr.startsWith(prefix)) detailStr = detailStr.slice(prefix.length);
      const valueRow: ChartTipRow = { name: '', value: detailStr };
      const rows: ChartTipRow[] = [valueRow, ...(extra?.rows ?? [])].filter((r) => r.value !== d.label);
      return { heading: d.label, rows, context: extra?.context, hint: extra?.hint };
    },
    [data, tip, valueFmt],
  );

  const zoomProp: ChartFrameZoom | undefined = zoom
    ? {
        periodFor: (i: number): PeriodParams | null => {
          const pair = zoom.refs[i];
          if (!pair) return null;
          return snapToShifts(pair[0], pair[1]);
        },
        onZoom: zoom.onSelect,
      }
    : undefined;

  if (data.length === 0) return <NoChartData message="Nothing to draw for this period." />;

  return (
    <ChartFrame
      chartId={chartId ?? ariaLabel}
      defaultH={height}
      resting={resting}
      ariaLabel={ariaLabel}
      hit={hit}
      count={data.length}
      tipFor={tipFor}
      markRect={markRect}
      onActivate={onActivate}
      zoom={zoomProp}
      onBack={onBack}
    >
      {(size, state) => {
        const layout = computeLayout(size.width, size.height);
        layoutRef.current = layout;
        const { L, R, y, bw, cx, zeroY } = layout;
        const [lo, hi] = niceDomain(
          data.map((d) => d.value),
          { zero: true, pad: 0.06 },
        );
        // Thinning is measured against the bar's own SLOT width, not an
        // estimate of how many labels fit the whole plot (`fittingTicks`,
        // still used elsewhere) — with a short data set (e.g. three shifts)
        // `fittingTicks` can say "all of them fit" while each label is
        // actually wider than the one slot it has to sit in, which is
        // exactly what overlapped "Morning"/"Evening" at 600px. `textPx` is
        // the same measured-width estimate `chartLayout.ts`'s other gutter/
        // thinning math already uses, so this stays consistent with
        // `DeviationBars`' own slot-based `step` in report/shared.tsx.
        const widest = Math.max(...data.map((d) => d.label.length));
        const labelPx = Math.ceil(textPx(widest, size.fontPx)) + 12;
        const perTick = Math.max(1, Math.ceil(labelPx / Math.max(1, layout.slot)));
        const tickCount = Math.max(2, Math.min(data.length, Math.ceil(data.length / perTick)));
        const ticks = new Set(tickIndices(data.length, tickCount));

        // `role="img" aria-label` here duplicates ChartFrame's own wrapper div
        // (also `role="img"`, same label) — a nested accessible-image is not
        // a clean ARIA pattern, but several existing screen tests
        // (`Line.render.test.tsx` among them) already assert
        // `svg[aria-label="..."]` against this component's OWN svg, from
        // before it moved onto ChartFrame, and this task does not own those
        // test files to update them. Kept for that reason, not out of design
        // preference — a caller wiring this chart onto a real screen could
        // reasonably drop one of the two.
        return (
          <svg
            className="chart"
            viewBox={`0 0 ${size.width} ${size.height}`}
            height={size.height}
            role="img"
            aria-label={ariaLabel}
          >
            {gridValues([lo, hi]).map((v) => (
              <g key={v}>
                <line x1={L} x2={size.width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
                <text x={L - 8} y={y(v) + 4} fontSize={size.fontPx} fill="var(--muted)" textAnchor="end">
                  {valueFmt(v)}
                </text>
              </g>
            ))}
            {data.map((d, i) => (
              <rect
                // Keyed by INDEX, not `d.key`: a bar's own data key is a
                // caller-supplied identity (`BarDatum.key`) that this
                // component does not itself guarantee is unique across the
                // whole array — a duplicate (seen with cycling shift labels
                // sharing the same key across several bars) makes React's
                // reconciliation reuse/misplace DOM nodes across a re-render
                // at a different width, leaving stale bars/ticks from an
                // earlier layout still in the DOM. The bar's position in
                // `data` is always unique and always what this element
                // actually represents.
                key={`bar-${i}`}
                x={cx(i) - bw / 2}
                y={Math.min(zeroY, y(d.value))}
                width={bw}
                // `state.active` reflects hover only as of ChartFrame's last
                // SIZE change, not live (see ChartFrame.tsx's own header
                // comment) — this is a coarse initial emphasis, not a
                // per-hover highlight; the tooltip and readout are the live
                // feedback now.
                height={Math.max(0, Math.abs(y(d.value) - zeroY))}
                fill={state.active === i ? 'var(--ink)' : 'var(--graphite)'}
              />
            ))}
            {data.map((d, i) =>
              ticks.has(i) ? (
                <text
                  // Same reasoning as the bar's own key above.
                  key={`tick-${i}`}
                  x={cx(i)}
                  y={size.height - 8}
                  fontSize={size.fontPx}
                  fill="var(--muted)"
                  textAnchor={edgeAnchor(i, data.length)}
                >
                  {d.label}
                </text>
              ) : null,
            )}
            <line x1={L} x2={size.width - R} y1={zeroY} y2={zeroY} stroke="var(--rule-2)" />
          </svg>
        );
      }}
    </ChartFrame>
  );
}

/* ------------------------------------------------------------ empty state */

export function NoChartData({ message }: { message: string }) {
  return <p className="state">{message}</p>;
}

/* --------------------------------------------------------------- helpers */

/** An SVG path through points, or '' when there is nothing to draw. */
export function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Guards a hover index against a data set that changed under it. */
export function useHoverIndex(len: number): [number | null, (i: number | null) => void] {
  const [i, setI] = useState<number | null>(null);
  const set = useCallback((next: number | null) => setI(next == null ? null : next), []);
  const safe = i != null && i < len ? i : null;
  return [safe, set];
}
