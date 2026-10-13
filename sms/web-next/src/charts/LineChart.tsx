/**
 * Lines over time or category. 2 px lines, >= 8 px markers, hover crosshair,
 * optional in-limit band; a point outside the limits gets a state-edge ring.
 * Up to four series are also labelled directly at their last point.
 */
import { useRef } from 'react';
import { C } from '../copy';
import { gridValues, leftGutterFor, linear, linePath, nearestIndex, niceDomain, type ChartTip } from '../bridge/chart';
import { zeroBasedDomain } from './domain';
import { XLabels, YAxis } from './Axes';
import { Frame, type LegendItem } from './Frame';
import { LimitBand } from './LimitBand';
import { catVar, chartTop, defaultFormat, type ChartCommonProps, type LimitSpec, type Margins } from './types';

export interface LineSeries {
  name: string;
  values: (number | null)[];
  slot?: number;
}

export interface LineChartProps extends ChartCommonProps {
  categories: string[];
  series: LineSeries[];
  limits?: LimitSpec;
  /** Include zero in the y domain (counts, rates). Measurements hug the data. */
  zeroBase?: boolean;
}

export function LineChart(p: LineChartProps) {
  const fmt = p.formatValue ?? defaultFormat;
  const n = p.categories.length;
  const all = p.series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const dvals = p.limits ? [...all, p.limits.lower, p.limits.upper] : all;
  const domain = p.zeroBase ? zeroBasedDomain(dvals) : niceDomain(dvals, {});
  const tickLabels = [...gridValues(domain, 3), domain[1]].map(fmt);
  const status = p.status ?? (n === 0 || all.length === 0 ? 'empty' : 'ready');
  const direct = p.series.length >= 2 && p.series.length <= 4;
  const last = useRef({ w: 0, h: 0, fontPx: 12 });

  const geo = (w: number, h: number, fontPx: number) => {
    const longest = direct ? Math.max(...p.series.map((s) => s.name.length)) : 0;
    const m: Margins = {
      left: leftGutterFor(tickLabels, fontPx, 44, 0) + 4,
      right: direct ? Math.min(120, Math.ceil(longest * fontPx * 0.55) + 14) : 16,
      top: chartTop(fontPx),
      bottom: 28,
    };
    const plotW = Math.max(1, w - m.left - m.right);
    const xs = p.categories.map((_, i) => m.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1)));
    return { m, xs, slot: plotW / Math.max(1, n), y: linear(domain, [h - m.bottom, m.top]) };
  };

  const outside = (v: number | null) => p.limits != null && v != null && (v < p.limits.lower || v > p.limits.upper);
  const legend: LegendItem[] = p.series.map((s, i) => ({ name: s.name, color: catVar(s.slot ?? i + 1), shape: 'line' }));

  const tipFor = (i: number): ChartTip | null => ({
    heading: p.categories[i] ?? '',
    rows: p.series.map((s, si) => {
      const v = s.values[i];
      return {
        name: s.name,
        value: v == null ? C.chart.noValue : `${fmt(v)} ${p.unit}${outside(v) ? ` · ${C.chart.outside}` : ''}`,
        mark: si === 0 ? ('ink' as const) : ('graphite' as const),
      };
    }),
  });

  return (
    <Frame
      chartId={p.chartId}
      title={p.title}
      unit={p.unit}
      caption={p.caption}
      status={status}
      errorPart={p.errorPart}
      onRetry={p.onRetry}
      emptyMessage={p.emptyMessage}
      emptyAction={p.emptyAction}
      defaultH={p.defaultH}
      reserve={p.reserve}
      legend={legend}
      table={{
        columns: ['', ...p.series.map((s) => `${s.name} (${p.unit})`)],
        rows: p.categories.map((c, i) => [c, ...p.series.map((s) => (s.values[i] == null ? '-' : fmt(s.values[i] as number)))]),
      }}
      frame={{
        count: n,
        hit: (x) => {
          const L = last.current;
          const g = geo(L.w, L.h, L.fontPx);
          if (x < g.m.left - g.slot / 2 || x > L.w - g.m.right + g.slot / 2 || n === 0) return null;
          return nearestIndex(x, g.xs);
        },
        tipFor,
        markRect: (i) => {
          const L = last.current;
          const g = geo(L.w, L.h, L.fontPx);
          return { x: (g.xs[i] as number) - 4, y: g.m.top, w: 8, h: L.h - g.m.top - g.m.bottom };
        },
        zoom: p.periodFor && p.onZoom ? { periodFor: p.periodFor, onZoom: p.onZoom } : undefined,
        onBack: p.onBack,
        children: ({ width, height, fontPx }, state) => {
          last.current = { w: width, h: height, fontPx };
          const g = geo(width, height, fontPx);
          const labels = direct
            ? p.series
                .map((s, si) => {
                  const idx = s.values.reduce<number>((a, v, i) => (v != null ? i : a), -1);
                  return { si, name: s.name, y: idx < 0 ? null : g.y(s.values[idx] as number) };
                })
                .filter((l): l is { si: number; name: string; y: number } => l.y != null)
                .sort((a, b) => a.y - b.y)
            : [];
          for (let k = 1; k < labels.length; k++) {
            const prev = labels[k - 1]!;
            const cur = labels[k]!;
            if (cur.y - prev.y < fontPx + 2) cur.y = prev.y + fontPx + 2;
          }
          return (
            <svg className="ck-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
              <YAxis scale={g.y} margins={g.m} width={width} unit={p.unit} format={fmt} fontPx={fontPx} />
              {p.limits && <LimitBand limits={p.limits} scale={g.y} from={g.m.left} to={width - g.m.right} fontPx={fontPx} />}
              {state.active != null && (
                <line x1={g.xs[state.active]} x2={g.xs[state.active]} y1={g.m.top} y2={height - g.m.bottom} className="ck-crosshair" />
              )}
              {p.series.map((s, si) => {
                const color = catVar(s.slot ?? si + 1);
                const segs: { x: number; y: number }[][] = [[]];
                s.values.forEach((v, i) => {
                  if (v == null) segs.push([]);
                  else segs[segs.length - 1]!.push({ x: g.xs[i] as number, y: g.y(v) });
                });
                return (
                  <g key={si} className="ck-series" data-series={s.name}>
                    {segs.filter((sg) => sg.length > 0).map((sg, k) => (
                      <path key={k} d={linePath(sg)} className="ck-line" stroke={color} fill="none" />
                    ))}
                    {n <= 40 &&
                      s.values.map((v, i) =>
                        v == null ? null : (
                          <g key={i}>
                            {outside(v) && <circle cx={g.xs[i]} cy={g.y(v)} r={8} className="ck-ring" />}
                            <circle cx={g.xs[i]} cy={g.y(v)} r={4} className="ck-dot" fill={color} />
                          </g>
                        ),
                      )}
                  </g>
                );
              })}
              {labels.map((l) => (
                <text key={l.si} x={width - g.m.right + 8} y={l.y} dy="0.32em" className="ck-direct" fontSize={fontPx}>
                  {l.name}
                </text>
              ))}
              <XLabels labels={p.categories} xs={g.xs} y={height - 8} slot={g.slot} fontPx={fontPx} />
            </svg>
          );
        },
      }}
    />
  );
}
