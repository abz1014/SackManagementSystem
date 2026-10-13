import { gridValues, type Scale } from '../bridge/chart';
import { defaultFormat, type Margins } from './types';

/**
 * Y gridlines (solid, recessive), tick labels and the unit above the axis.
 * `side` 'right' is the Pareto's second axis: labels only, no gridlines.
 */
export function YAxis({
  scale, margins, width, unit, format = defaultFormat, side = 'left', ticks, fontPx = 12,
}: {
  scale: Scale;
  margins: Margins;
  width: number;
  unit: string;
  format?: (v: number) => string;
  side?: 'left' | 'right';
  ticks?: number[];
  fontPx?: number;
}) {
  const vals = ticks ?? gridValues(scale.domain, 3);
  const all = Array.from(new Set([scale.domain[0], ...vals, scale.domain[1]])).sort((a, b) => a - b);
  const x0 = margins.left;
  const x1 = width - margins.right;
  const left = side === 'left';
  return (
    <g className={`ck-yaxis ${side}`}>
      {all.map((v) => (
        <g key={v}>
          {left && <line x1={x0} x2={x1} y1={scale(v)} y2={scale(v)} className={v === scale.domain[0] ? 'ck-base' : 'ck-grid'} />}
          <text x={left ? x0 - 8 : x1 + 8} y={scale(v)} dy="0.32em" textAnchor={left ? 'end' : 'start'} className="ck-tick" fontSize={fontPx}>
            {format(v)}
          </text>
        </g>
      ))}
      <text x={left ? x0 - 8 : x1 + 8} y={Math.max(fontPx, margins.top - 8)} textAnchor={left ? 'end' : 'start'} className="ck-unit-label" fontSize={fontPx}>
        {unit}
      </text>
    </g>
  );
}

/** Category or time labels along the bottom, thinned so they never overprint. */
export function XLabels({
  labels, xs, y, slot, fontPx = 12,
}: {
  labels: string[];
  xs: number[];
  y: number;
  slot: number;
  fontPx?: number;
}) {
  const widest = labels.reduce((m, s) => Math.max(m, Math.min(s.length, 14)), 1);
  const every = Math.max(1, Math.ceil((widest * fontPx * 0.6 + 6) / Math.max(slot, 1)));
  return (
    <g className="ck-xlabels">
      {labels.map((l, i) =>
        i % every === 0 ? (
          <text key={i} x={xs[i]} y={y} textAnchor="middle" className="ck-tick" fontSize={fontPx}>
            {l.length > 14 ? `${l.slice(0, 13)}…` : l}
          </text>
        ) : null,
      )}
    </g>
  );
}
