/**
 * Vertical bars. One series: gradient fill (--bar-from -> --bar-to), 6 px rounded data end,
 * zero baseline. Several series: grouped, flat --cat-n fills, 2 px surface gap, legend.
 * Optional in-limit band for measured values.
 */
import { useRef } from 'react';
import { bandHit, gridValues, leftGutterFor, linear, type ChartTip } from '../bridge/chart';
import { zeroBasedDomain } from './domain';
import { XLabels, YAxis } from './Axes';
import { Frame, type LegendItem } from './Frame';
import { LimitBand } from './LimitBand';
import { catVar, defaultFormat, type ChartCommonProps, type LimitSpec, type Margins } from './types';

export interface BarSeries {
  name: string;
  values: (number | null)[];
  /** Categorical slot 1-5; defaults to the series order. */
  slot?: number;
}

export interface BarChartProps extends ChartCommonProps {
  categories: string[];
  series: BarSeries[];
  limits?: LimitSpec;
}

const R = 6;

/** A bar with rounded data end only (top), square on the baseline. */
export function barPath(x: number, y: number, w: number, h: number, r = R): string {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function BarChart(p: BarChartProps) {
  const fmt = p.formatValue ?? defaultFormat;
  const n = p.categories.length;
  const all = p.series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const domain = zeroBasedDomain(p.limits ? [...all, p.limits.upper] : all, { pad: 0.05 });
  const tickLabels = [...gridValues(domain, 3), domain[1]].map(fmt);
  const status = p.status ?? (n === 0 || all.length === 0 ? 'empty' : 'ready');
  const multi = p.series.length > 1;
  const legend: LegendItem[] | undefined = multi
    ? p.series.map((s, i) => ({ name: s.name, color: catVar(s.slot ?? i + 1) }))
    : undefined;

  const geo = (w: number, h: number, fontPx: number) => {
    const m: Margins = { left: leftGutterFor(tickLabels, fontPx, 44, 0) + 4, right: 12, top: 22, bottom: 28 };
    const plotW = Math.max(1, w - m.left - m.right);
    const slot = plotW / Math.max(1, n);
    const y = linear(domain, [h - m.bottom, m.top]);
    return { m, plotW, slot, y };
  };

  const tipFor = (i: number): ChartTip | null => ({
    heading: p.categories[i] ?? '',
    rows: p.series.map((s, si) => ({
      name: s.name,
      value: s.values[i] == null ? 'No value' : `${fmt(s.values[i] as number)} ${p.unit}`,
      mark: si === 0 ? ('ink' as const) : ('graphite' as const),
    })),
  });

  const table = {
    columns: ['', ...p.series.map((s) => `${s.name} (${p.unit})`)],
    rows: p.categories.map((c, i) => [c, ...p.series.map((s) => (s.values[i] == null ? '-' : fmt(s.values[i] as number)))]),
  };

  const gradId = `ck-bar-${p.chartId}`;
  const last = useRef({ w: 0, h: 0, fontPx: 12 });

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
      legend={legend}
      table={table}
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
        zoom: p.periodFor && p.onZoom ? { periodFor: p.periodFor, onZoom: p.onZoom } : undefined,
        onBack: p.onBack,
        children: ({ width, height, fontPx }) => {
          last.current = { w: width, h: height, fontPx };
          const g = geo(width, height, fontPx);
          const xs = p.categories.map((_, i) => g.m.left + g.slot * (i + 0.5));
          const groupW = Math.min(g.slot * 0.7, multi ? 64 * p.series.length : 56);
          const barW = Math.max(2, groupW / p.series.length - (multi ? 2 : 0));
          return (
            <svg className="ck-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--bar-from)" />
                  <stop offset="1" stopColor="var(--bar-to)" />
                </linearGradient>
              </defs>
              <YAxis scale={g.y} margins={g.m} width={width} unit={p.unit} format={fmt} fontPx={fontPx} />
              {p.limits && <LimitBand limits={p.limits} scale={g.y} from={g.m.left} to={width - g.m.right} fontPx={fontPx} />}
              {p.series.map((s, si) =>
                s.values.map((v, i) => {
                  if (v == null) return null;
                  const x0 = (xs[i] as number) - groupW / 2 + si * (groupW / p.series.length);
                  const top = g.y(v);
                  return (
                    <path
                      key={`${si}-${i}`}
                      d={barPath(x0, top, barW, g.y(0) - top)}
                      fill={multi ? catVar(s.slot ?? si + 1) : `url(#${gradId})`}
                      className="ck-bar"
                      data-series={s.name}
                    />
                  );
                }),
              )}
              <XLabels labels={p.categories} xs={xs} y={height - 8} slot={g.slot} fontPx={fontPx} />
            </svg>
          );
        },
      }}
    />
  );
}
