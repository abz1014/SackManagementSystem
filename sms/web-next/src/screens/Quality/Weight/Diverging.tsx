/**
 * Diverging bars around zero: one bar per item, left or right (rows) or up or down (columns).
 * Used for each station's offset from the line mean and for each day's sack mean against the
 * period mean. One series in one colour: direction is carried by the side of the zero line and by
 * the signed label, never by hue (no state tint). The axis is symmetric and never narrower than
 * `minHalfSpan`, so a tiny spread draws as the small thing it is.
 */
import { useRef } from 'react';
import { leftGutterFor, linear, nearestIndex, textPx, type ChartTip } from '../../../bridge/chart';
import { XLabels } from '../../../charts/Axes';
import { Frame } from '../../../charts/Frame';
import type { ChartStatus } from '../../../charts/types';

export interface DivergingItem {
  key: string;
  label: string;
  /** null = this item has no data; it is listed, never drawn as a zero. */
  value: number | null;
  /** Extra tooltip lines, already formatted. */
  detail?: string[];
}

export interface DivergingProps {
  chartId: string;
  title: string;
  /** Unit of the value, shown beside the axis. */
  unit: string;
  caption?: string;
  items: DivergingItem[];
  orientation: 'rows' | 'columns';
  /** Formats a value for labels and ticks, e.g. signed one-decimal grams. */
  format: (v: number) => string;
  /** Smallest half-width of the axis, in the value's unit. */
  minHalfSpan: number;
  /** Shaded zone of +/- this much around zero, with its label. */
  band?: { half: number; label: string };
  noDataLabel: string;
  valueName: string;
  status?: ChartStatus;
  errorPart?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  onActivate?: (i: number) => void;
  activateHint?: string;
}

const ROW_H = 26;

function niceHalf(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * p;
}

interface Margins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function DivergingBars(p: DivergingProps) {
  const n = p.items.length;
  const vals = p.items.map((i) => i.value).filter((v): v is number => v !== null);
  const widest = Math.max(p.minHalfSpan, p.band?.half ?? 0, ...vals.map((v) => Math.abs(v)));
  const half = niceHalf(widest * 1.08);
  const status = p.status ?? (n === 0 || vals.length === 0 ? 'empty' : 'ready');
  const last = useRef({ w: 0, h: 0, fontPx: 12 });
  const rows = p.orientation === 'rows';
  const longest = p.items.reduce((m, i) => Math.max(m, i.label.length), 0);

  const margins = (fontPx: number): Margins =>
    rows
      ? { left: Math.max(64, Math.ceil(textPx(longest, fontPx)) + 8), right: 44, top: 26, bottom: 30 }
      : { left: leftGutterFor([p.format(-half), p.format(half)], fontPx, 44, 0) + 4, right: 12, top: 22, bottom: 28 };

  /** Size of one item's slot along the category axis. */
  const slotOf = (w: number, h: number, m: Margins): number =>
    rows ? Math.max(1, h - m.top - m.bottom) / Math.max(1, n) : Math.max(1, w - m.left - m.right) / Math.max(1, n);

  const tipFor = (i: number): ChartTip | null => {
    const it = p.items[i];
    if (!it) return null;
    return {
      heading: it.label,
      rows: [{ name: p.valueName, value: it.value === null ? p.noDataLabel : `${p.format(it.value)} ${p.unit}`, mark: 'ink' }],
      context: it.detail,
      hint: p.onActivate ? p.activateHint : undefined,
    };
  };

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
      defaultH={rows ? Math.max(200, n * ROW_H + 56) : 240}
      table={{
        columns: ['', `${p.valueName} (${p.unit})`],
        rows: p.items.map((it) => [it.label, it.value === null ? '-' : p.format(it.value)]),
      }}
      frame={{
        count: n,
        hit: (x, y) => {
          const L = last.current;
          const m = margins(L.fontPx);
          const slot = slotOf(L.w, L.h, m);
          if (rows) {
            const i = Math.floor((y - m.top) / slot);
            return y < m.top || i < 0 || i >= n ? null : i;
          }
          if (x < m.left || x > L.w - m.right || n === 0) return null;
          return nearestIndex(x, p.items.map((_, i) => m.left + slot * i + slot / 2));
        },
        tipFor,
        markRect: (i) => {
          const L = last.current;
          const m = margins(L.fontPx);
          const slot = slotOf(L.w, L.h, m);
          return rows
            ? { x: m.left, y: m.top + slot * i, w: L.w - m.left - m.right, h: slot }
            : { x: m.left + slot * i, y: m.top, w: slot, h: L.h - m.top - m.bottom };
        },
        onActivate: p.onActivate,
        children: ({ width, height, fontPx }) => {
          last.current = { w: width, h: height, fontPx };
          const m = margins(fontPx);
          const slot = slotOf(width, height, m);
          const ticks = [-half, -half / 2, 0, half / 2, half];

          if (rows) {
            const x = linear([-half, half], [m.left, width - m.right]);
            const x0 = x(0);
            const plotH = height - m.top - m.bottom;
            return (
              <svg className="ck-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
                {p.band && (
                  <rect className="ck-band" x={x(-p.band.half)} y={m.top} width={x(p.band.half) - x(-p.band.half)} height={plotH} />
                )}
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={x(t)} x2={x(t)} y1={m.top} y2={m.top + plotH} className={t === 0 ? 'ck-base' : 'ck-grid'} />
                    <text x={x(t)} y={height - 8} textAnchor="middle" className="ck-tick" fontSize={fontPx}>{p.format(t)}</text>
                  </g>
                ))}
                <text x={width - m.right} y={m.top - 8} textAnchor="end" className="ck-unit-label" fontSize={fontPx}>{p.unit}</text>
                {p.band && (
                  <text x={x0} y={m.top - 8} textAnchor="middle" className="ck-band-text" fontSize={fontPx}>{p.band.label}</text>
                )}
                {p.items.map((it, i) => {
                  const cy = m.top + slot * i + slot / 2;
                  const bh = Math.min(16, slot * 0.62);
                  return (
                    <g key={it.key}>
                      <text x={m.left - 8} y={cy} dy="0.32em" textAnchor="end" className="ck-tick" fontSize={fontPx}>{it.label}</text>
                      {it.value === null ? (
                        <text x={x0 + 8} y={cy} dy="0.32em" className="ck-tick" fontSize={fontPx}>{p.noDataLabel}</text>
                      ) : (
                        <>
                          <rect
                            className="ck-bar qw-bar"
                            x={Math.min(x0, x(it.value))}
                            y={cy - bh / 2}
                            width={Math.abs(x(it.value) - x0)}
                            height={bh}
                            rx={3}
                          />
                          <text
                            x={it.value < 0 ? x(it.value) - 6 : x(it.value) + 6}
                            y={cy}
                            dy="0.32em"
                            textAnchor={it.value < 0 ? 'end' : 'start'}
                            className="ck-direct"
                            fontSize={fontPx}
                          >
                            {p.format(it.value)}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>
            );
          }

          const y = linear([-half, half], [height - m.bottom, m.top]);
          const y0 = y(0);
          const xs = p.items.map((_, i) => m.left + slot * i + slot / 2);
          const bw = Math.max(2, Math.min(28, slot * 0.7));
          return (
            <svg className="ck-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'ck-base' : 'ck-grid'} />
                  <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="ck-tick" fontSize={fontPx}>{p.format(t)}</text>
                </g>
              ))}
              <text x={m.left - 8} y={Math.max(fontPx, m.top - 8)} textAnchor="end" className="ck-unit-label" fontSize={fontPx}>{p.unit}</text>
              {p.items.map((it, i) =>
                it.value === null ? null : (
                  <rect
                    key={it.key}
                    className="ck-bar qw-bar"
                    x={xs[i]! - bw / 2}
                    y={Math.min(y0, y(it.value))}
                    width={bw}
                    height={Math.max(1, Math.abs(y(it.value) - y0))}
                    rx={2}
                  />
                ),
              )}
              <XLabels labels={p.items.map((it) => it.label)} xs={xs} y={height - 8} slot={slot} fontPx={fontPx} />
            </svg>
          );
        },
      }}
    />
  );
}
