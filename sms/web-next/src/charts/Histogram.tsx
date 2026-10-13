/**
 * Distribution of a measured value. Bins are contiguous (no gap between bars beyond the 2 px
 * surface line), the bin width is stated in the caption, and the product limits can be drawn
 * as a vertical in-limit band.
 */
import { useRef } from 'react';
import { bandHit, gridValues, leftGutterFor, linear, niceDomain, type ChartTip } from '../bridge/chart';
import { YAxis } from './Axes';
import { barPath } from './BarChart';
import { Frame } from './Frame';
import { LimitBand } from './LimitBand';
import { CHART_COPY } from './chartCopy';
import { defaultFormat, type ChartCommonProps, type LimitSpec, type Margins } from './types';

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface HistogramProps extends ChartCommonProps {
  bins: HistogramBin[];
  /** Unit of the measured value on the x axis ("g", "kg"). `unit` stays the y unit (cones). */
  valueUnit: string;
  limits?: LimitSpec;
}

export function Histogram(p: HistogramProps) {
  const fmt = p.formatValue ?? defaultFormat;
  const n = p.bins.length;
  const width0 = n > 0 ? (p.bins[0] as HistogramBin).to - (p.bins[0] as HistogramBin).from : 0;
  const domain = niceDomain(p.bins.map((b) => b.count), { zero: true, pad: 0.05 });
  const tickLabels = [...gridValues(domain, 3), domain[1]].map(fmt);
  const status = p.status ?? (n === 0 ? 'empty' : 'ready');
  const last = useRef({ w: 0, h: 0, fontPx: 12 });
  const xMin = n > 0 ? (p.bins[0] as HistogramBin).from : 0;
  const xMax = n > 0 ? (p.bins[n - 1] as HistogramBin).to : 1;

  const geo = (w: number, h: number, fontPx: number) => {
    const m: Margins = { left: leftGutterFor(tickLabels, fontPx, 44, 0) + 4, right: 12, top: 22, bottom: 40 };
    return {
      m,
      slot: Math.max(1, w - m.left - m.right) / Math.max(1, n),
      y: linear(domain, [h - m.bottom, m.top]),
      x: linear([xMin, xMax], [m.left, w - m.right]),
    };
  };

  const label = (b: HistogramBin) => `${fmt(b.from)} to ${fmt(b.to)} ${p.valueUnit}`;
  const tipFor = (i: number): ChartTip | null => {
    const b = p.bins[i];
    return b ? { heading: label(b), rows: [{ name: 'Count', value: `${fmt(b.count)} ${p.unit}`, mark: 'ink' }] } : null;
  };

  return (
    <Frame
      chartId={p.chartId}
      title={p.title}
      unit={p.unit}
      caption={
        <>
          {p.caption} {n > 0 && CHART_COPY.binWidth(fmt(width0), p.valueUnit)}
        </>
      }
      status={status}
      errorPart={p.errorPart}
      onRetry={p.onRetry}
      emptyMessage={p.emptyMessage}
      emptyAction={p.emptyAction}
      defaultH={p.defaultH}
      table={{ columns: [`Range (${p.valueUnit})`, `Count (${p.unit})`], rows: p.bins.map((b) => [label(b), fmt(b.count)]) }}
      frame={{
        count: n,
        hit: (x) => {
          const L = last.current;
          const g = geo(L.w, L.h, L.fontPx);
          return bandHit(x, g.m.left, g.slot, n);
        },
        tipFor,
        markRect: (i) => {
          const L = last.current;
          const g = geo(L.w, L.h, L.fontPx);
          return { x: g.m.left + i * g.slot, y: g.m.top, w: g.slot, h: L.h - g.m.top - g.m.bottom };
        },
        children: ({ width, height, fontPx }) => {
          last.current = { w: width, h: height, fontPx };
          const g = geo(width, height, fontPx);
          const gradId = `ck-hist-${p.chartId}`;
          const tickIdx = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
          return (
            <svg className="ck-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--bar-from)" />
                  <stop offset="1" stopColor="var(--bar-to)" />
                </linearGradient>
              </defs>
              <YAxis scale={g.y} margins={g.m} width={width} unit={p.unit} format={fmt} fontPx={fontPx} />
              {p.limits && <LimitBand limits={p.limits} scale={g.x} axis="x" from={g.m.top} to={height - g.m.bottom} fontPx={fontPx} />}
              {p.bins.map((b, i) => (
                <path
                  key={i}
                  d={barPath(g.x(b.from) + 1, g.y(b.count), Math.max(1, g.x(b.to) - g.x(b.from) - 2), g.y(0) - g.y(b.count), 4)}
                  fill={`url(#${gradId})`}
                  className="ck-bar"
                />
              ))}
              {tickIdx.map((i) => (
                <text key={i} x={g.x((p.bins[i] as HistogramBin).from)} y={height - 22} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="ck-tick" fontSize={fontPx}>
                  {fmt((p.bins[i] as HistogramBin).from)}
                </text>
              ))}
              <text x={width - g.m.right} y={height - 6} textAnchor="end" className="ck-unit-label" fontSize={fontPx}>{p.valueUnit}</text>
            </svg>
          );
        },
      }}
    />
  );
}
