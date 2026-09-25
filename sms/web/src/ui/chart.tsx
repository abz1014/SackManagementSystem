/**
 * Chart primitives. Not a charting library — the four shapes this app needs,
 * drawn as plain SVG, plus the three rules that made the old charts unreadable
 * and are enforced here so no screen can break them again.
 *
 * RULE 1 — NOTHING SHARES A LINE WITH THE DATA MARKS. The old run/stop ribbon
 * drew the shift names inside the band, so a stoppage block landed on top of
 * "EVENING" and cut the word in half. Labels get their own row, always.
 *
 * RULE 2 — EDGE LABELS ANCHOR INWARD. A tick at x=0 centred on its position
 * hangs half its width off the left of the plot; the last one runs off the
 * right. First tick anchors `start`, last anchors `end`, the rest `middle`.
 *
 * RULE 3 — THE HOVER READOUT IS A LINE OF TEXT ABOVE THE CHART, never a
 * floating tooltip. A tooltip covers the marks it describes, is unreadable on
 * a wall display, and does not exist for someone using a keyboard. The readout
 * also states the resting summary when nothing is hovered, so the chart says
 * what it is worth even to a reader who never points at it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------ sizing */

/**
 * The rendered width of a block, so a chart can choose how many labels fit
 * rather than drawing a fixed number and letting them collide.
 */
export function useChartWidth(fallback = 1036): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setW(Math.round(width));
    });
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width) || fallback);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
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
 * pointing at anything, so the chart is not mute on a wall display.
 */
export function Readout({ hovered, resting }: { hovered: ReactNode; resting: ReactNode }) {
  return (
    <div className="readout" aria-live="polite">
      {hovered ?? <span className="dim">{resting}</span>}
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
 * A horizontal reference line labelled at its right end, in the gutter — a
 * target, a limit, a line mean. Drawn as a thin labelled line rather than a
 * shaded statistical band, because a band invites the question "what is that
 * band?" and the answer belongs behind the Details disclosure.
 */
export function RefLine({
  y,
  x1,
  x2,
  label,
  tone = 'muted',
  dashed,
  labelInside,
}: {
  y: number;
  x1: number;
  x2: number;
  label?: string;
  tone?: 'ink' | 'muted' | 'accent';
  dashed?: boolean;
  /** Draw the label INSIDE the plot, right-aligned just above the line,
   *  for charts that reserve no right margin (DeviationBars' R is 8px, so
   *  the default `x2 + 8` placement put "row median" / "Flag threshold"
   *  outside the viewBox, clipped — 25 Sep 2026). A page-coloured halo keeps
   *  it legible where it crosses a bar. */
  labelInside?: boolean;
}) {
  const stroke = tone === 'ink' ? 'var(--graphite)' : tone === 'accent' ? 'var(--acc)' : 'var(--grid)';
  return (
    <g aria-hidden="true">
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={stroke} strokeWidth={1} strokeDasharray={dashed ? '3 3' : undefined} />
      {label && labelInside && (
        <text
          x={x2 - 2}
          y={y - 5}
          fontSize="var(--fs-tick)"
          textAnchor="end"
          fill={tone === 'accent' ? 'var(--acc)' : 'var(--graphite)'}
          stroke="var(--paper)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
      {label && !labelInside && (
        <text x={x2 + 8} y={y + 4} fontSize="var(--fs-tick)" fill={tone === 'accent' ? 'var(--acc)' : 'var(--graphite)'}>
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
  /** The whole readout line for this bar, when hovered. */
  detail?: ReactNode;
}

/**
 * Vertical bars over categories — days, shifts, products — with a zero
 * baseline, at most three gridlines, ticks that thin themselves to fit, and
 * the house readout above.
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
 */
export function CategoryBars({
  data,
  height = 280,
  ariaLabel,
  resting,
  valueFmt = (v: number) => String(v),
  leftGutter = 56,
}: {
  data: BarDatum[];
  height?: number;
  ariaLabel: string;
  resting: ReactNode;
  valueFmt?: (v: number) => string;
  leftGutter?: number;
}) {
  const [box, width] = useChartWidth();
  const [hover, setHover] = useHoverIndex(data.length);
  const H = height;
  const L = leftGutter;
  const R = 10;
  const T = 16;
  const B = 30;

  if (data.length === 0) return <NoChartData message="Nothing to draw for this period." />;

  const [lo, hi] = niceDomain(data.map((d) => d.value), { zero: true, pad: 0.06 });
  const y = linear([lo, hi], [H - B, T]);
  const slot = (width - L - R) / data.length;
  // Capped, or a two-day period draws two 400px-wide slabs across a
  // full-width chart (seen on Line with "This week" on a Wednesday). A bar's
  // job is to be compared by height; past about 64px of width it stops
  // reading as a bar at all.
  const bw = Math.min(64, Math.max(3, slot * 0.62));
  const cx = (i: number) => L + slot * i + slot / 2;
  const widest = Math.max(...data.map((d) => d.label.length));
  const ticks = new Set(tickIndices(data.length, fittingTicks(width - L - R, widest, 12, data.length, 12)));
  const zeroY = y(0);

  const h = hover != null ? data[hover] : null;

  return (
    <div ref={box}>
      <Readout hovered={h ? (h.detail ?? `${h.label} · ${valueFmt(h.value)}`) : null} resting={resting} />
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${H}`}
        height={H}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {gridValues([lo, hi]).map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={L - 8} y={y(v) + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">
              {valueFmt(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <rect
            key={d.key}
            x={cx(i) - bw / 2}
            y={Math.min(zeroY, y(d.value))}
            width={bw}
            height={Math.max(0, Math.abs(y(d.value) - zeroY))}
            fill={hover === i ? 'var(--ink)' : 'var(--graphite)'}
          />
        ))}
        <HoverBands count={data.length} x={cx} top={T} height={H - B - T} onHover={setHover} />
        {hover != null && <Crosshair x={cx(hover)} top={T} bottom={H - B} />}
        {data.map((d, i) =>
          ticks.has(i) ? (
            <text
              key={`t${d.key}`}
              x={cx(i)}
              y={H - 8}
              fontSize="var(--fs-tick)"
              fill="var(--muted)"
              textAnchor={edgeAnchor(i, data.length)}
            >
              {d.label}
            </text>
          ) : null,
        )}
        <line x1={L} x2={width - R} y1={zeroY} y2={zeroY} stroke="var(--rule-2)" />
      </svg>
    </div>
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
