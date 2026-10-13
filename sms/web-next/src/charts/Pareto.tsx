/**
 * Pareto of reject reasons: bars (count, descending) and the cumulative-share line.
 * The only chart in the kit with a second axis, and it is labelled
 * "Cumulative share (%)" so it can never be read against the count axis.
 * The cumulative values are the server's own running `cumulativePct`; the
 * "vital few" cut comes from the shared `lib/pareto` (no arithmetic here).
 */
import { useRef } from 'react';
import { pareto } from '../bridge/lib';
import { bandHit, gridValues, leftGutterFor, linear, linePath, niceDomain, type ChartTip } from '../bridge/chart';
import { XLabels, YAxis } from './Axes';
import { barPath } from './BarChart';
import { CHART_COPY } from './chartCopy';
import { Frame, type LegendItem } from './Frame';
import { defaultFormat, type ChartCommonProps, type Margins } from './types';

export interface ParetoRow {
  label: string;
  count: number;
  /** Running share in percent, 0-100, as /api/rejects returns it. */
  cumulativePct: number;
}

export interface ParetoProps extends ChartCommonProps {
  rows: ParetoRow[];
  /** Threshold for the vital few and the dashed reference line. Default 80. */
  thresholdPct?: number;
}

export function Pareto(p: ParetoProps) {
  const fmt = p.formatValue ?? defaultFormat;
  const th = p.thresholdPct ?? 80;
  const n = p.rows.length;
  const vital = pareto.vitalFew(p.rows, th);
  const domain = niceDomain(p.rows.map((r) => r.count), { zero: true, pad: 0.05 });
  const tickLabels = [...gridValues(domain, 3), domain[1]].map(fmt);
  const status = p.status ?? (n === 0 ? 'empty' : 'ready');
  const last = useRef({ w: 0, h: 0, fontPx: 12 });
  const gradId = `ck-pareto-${p.chartId}`;

  const geo = (w: number, h: number, fontPx: number) => {
    const m: Margins = { left: leftGutterFor(tickLabels, fontPx, 44, 0) + 4, right: 56, top: 22, bottom: 28 };
    const slot = Math.max(1, w - m.left - m.right) / Math.max(1, n);
    return { m, slot, yL: linear(domain, [h - m.bottom, m.top]), yR: linear([0, 100], [h - m.bottom, m.top]) };
  };

  const legend: LegendItem[] = [
    { name: `${p.title.split(' (')[0] ?? 'Rejects'}`, color: 'var(--bar-from)' },
    { name: CHART_COPY.cumulative, color: 'var(--cat-2)', shape: 'line' },
  ];
  legend[0]!.name = `Count (${p.unit})`;

  const tipFor = (i: number): ChartTip | null => {
    const r = p.rows[i];
    if (!r) return null;
    return {
      heading: r.label,
      rows: [
        { name: 'Count', value: `${fmt(r.count)} ${p.unit}`, mark: 'ink' },
        { name: CHART_COPY.cumulative, value: `${fmt(r.cumulativePct)} %`, mark: 'graphite' },
      ],
    };
  };

  return (
    <Frame
      chartId={p.chartId}
      title={p.title}
      unit={p.unit}
      caption={p.caption ?? (n > 0 ? CHART_COPY.vitalFew(vital, n) : undefined)}
      status={status}
      errorPart={p.errorPart}
      onRetry={p.onRetry}
      emptyMessage={p.emptyMessage}
      emptyAction={p.emptyAction}
      defaultH={p.defaultH}
      legend={legend}
      table={{
        columns: ['', `Count (${p.unit})`, CHART_COPY.cumulativeAxis],
        rows: p.rows.map((r) => [r.label, fmt(r.count), fmt(r.cumulativePct)]),
      }}
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
          const xs = p.rows.map((_, i) => g.m.left + g.slot * (i + 0.5));
          const barW = Math.max(2, Math.min(g.slot * 0.7, 56));
          const pts = p.rows.map((r, i) => ({ x: xs[i] as number, y: g.yR(r.cumulativePct) }));
          return (
            <svg className="ck-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--bar-from)" />
                  <stop offset="1" stopColor="var(--bar-to)" />
                </linearGradient>
              </defs>
              <YAxis scale={g.yL} margins={g.m} width={width} unit={p.unit} format={fmt} fontPx={fontPx} />
              <YAxis
                scale={g.yR}
                margins={g.m}
                width={width}
                unit={CHART_COPY.cumulativeAxis}
                side="right"
                ticks={[0, 25, 50, 75, 100]}
                format={(v) => `${v}`}
                fontPx={fontPx}
              />
              <line x1={g.m.left} x2={width - g.m.right} y1={g.yR(th)} y2={g.yR(th)} className="ck-limit-line" />
              <text x={g.m.left + 4} y={g.yR(th) - 4} className="ck-limit-text" fontSize={fontPx}>{`${th} %`}</text>
              {p.rows.map((r, i) => (
                <path
                  key={i}
                  d={barPath((xs[i] as number) - barW / 2, g.yL(r.count), barW, g.yL(0) - g.yL(r.count))}
                  fill={i < vital ? `url(#${gradId})` : 'var(--cat-other)'}
                  className="ck-bar"
                />
              ))}
              <path d={linePath(pts)} className="ck-line" stroke="var(--cat-2)" fill="none" />
              {pts.map((pt, i) => (
                <circle key={i} cx={pt.x} cy={pt.y} r={4} className="ck-dot" fill="var(--cat-2)" />
              ))}
              <XLabels labels={p.rows.map((r) => r.label)} xs={xs} y={height - 8} slot={g.slot} fontPx={fontPx} />
            </svg>
          );
        },
      }}
    />
  );
}
