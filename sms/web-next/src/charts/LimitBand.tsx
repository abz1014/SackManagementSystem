import type { Scale } from '../bridge/chart';
import { C } from '../copy';
import type { LimitSpec } from './types';

/**
 * The in-limit band: soft OK-green tint, dashed grey limit lines, each labelled.
 * `axis` 'y' draws a horizontal band over a value axis; 'x' a vertical one
 * (histograms). The band is labelled "In limits" so it is never read as a series.
 */
export function LimitBand({
  limits, scale, axis = 'y', from, to, fontPx = 12, bounds,
}: {
  limits: LimitSpec;
  scale: Scale;
  axis?: 'y' | 'x';
  /** Extent across the other axis (px). */
  from: number;
  to: number;
  fontPx?: number;
  /** Axis 'x' only: the plot's left and right edge. A band wider than the data is clipped to it, never drawn across the card. */
  bounds?: [number, number];
}) {
  const lo = scale(limits.lower);
  const hi = scale(limits.upper);
  if (axis === 'y') {
    const top = Math.min(lo, hi);
    return (
      <g className="ck-limit" data-testid="limit-band">
        <rect x={from} y={top} width={Math.max(0, to - from)} height={Math.abs(lo - hi)} className="ck-band" />
        <line x1={from} x2={to} y1={hi} y2={hi} className="ck-limit-line" />
        <line x1={from} x2={to} y1={lo} y2={lo} className="ck-limit-line" />
        <text x={to} y={hi - 4} textAnchor="end" className="ck-limit-text" fontSize={fontPx}>{C.chart.upperLimit(limits.upperText)}</text>
        <text x={to} y={lo + fontPx + 2} textAnchor="end" className="ck-limit-text" fontSize={fontPx}>{C.chart.lowerLimit(limits.lowerText)}</text>
        <text x={from + 6} y={top + fontPx + 4} className="ck-band-text" fontSize={fontPx}>{C.chart.inLimits}</text>
      </g>
    );
  }
  const [b0, b1] = bounds ?? [-Infinity, Infinity];
  const clip = (v: number) => Math.min(b1, Math.max(b0, v));
  const left = clip(Math.min(lo, hi));
  const right = clip(Math.max(lo, hi));
  return (
    <g className="ck-limit" data-testid="limit-band">
      <rect x={left} y={from} width={Math.max(0, right - left)} height={Math.max(0, to - from)} className="ck-band" />
      {lo >= b0 && lo <= b1 && <line x1={lo} x2={lo} y1={from} y2={to} className="ck-limit-line" />}
      {hi >= b0 && hi <= b1 && <line x1={hi} x2={hi} y1={from} y2={to} className="ck-limit-line" />}
      <text x={left + 6} y={from + fontPx + 2} className="ck-band-text" fontSize={fontPx}>{C.chart.inLimits}</text>
    </g>
  );
}
