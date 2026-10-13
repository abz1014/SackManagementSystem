import type { Scale } from '../bridge/chart';
import { CHART_COPY } from './chartCopy';
import type { LimitSpec } from './types';

/**
 * The in-limit band: soft OK-green tint, dashed grey limit lines, each labelled.
 * `axis` 'y' draws a horizontal band over a value axis; 'x' a vertical one
 * (histograms). The band is labelled "In limits" so it is never read as a series.
 */
export function LimitBand({
  limits, scale, axis = 'y', from, to, fontPx = 12,
}: {
  limits: LimitSpec;
  scale: Scale;
  axis?: 'y' | 'x';
  /** Extent across the other axis (px). */
  from: number;
  to: number;
  fontPx?: number;
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
        <text x={to} y={hi - 4} textAnchor="end" className="ck-limit-text" fontSize={fontPx}>{CHART_COPY.upperLimit(limits.upperText)}</text>
        <text x={to} y={lo + fontPx + 2} textAnchor="end" className="ck-limit-text" fontSize={fontPx}>{CHART_COPY.lowerLimit(limits.lowerText)}</text>
        <text x={from + 6} y={top + fontPx + 4} className="ck-band-text" fontSize={fontPx}>{CHART_COPY.inLimits}</text>
      </g>
    );
  }
  const left = Math.min(lo, hi);
  return (
    <g className="ck-limit" data-testid="limit-band">
      <rect x={left} y={from} width={Math.abs(lo - hi)} height={Math.max(0, to - from)} className="ck-band" />
      <line x1={lo} x2={lo} y1={from} y2={to} className="ck-limit-line" />
      <line x1={hi} x2={hi} y1={from} y2={to} className="ck-limit-line" />
      <text x={left + 6} y={from + fontPx + 2} className="ck-band-text" fontSize={fontPx}>{CHART_COPY.inLimits}</text>
    </g>
  );
}
