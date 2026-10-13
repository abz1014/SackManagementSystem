/**
 * The chart kit's frame (DESIGN-SYSTEM 6.9 chart kit). Wraps the existing
 * `ChartFrame` (tooltip, keyboard, resize, click-to-zoom, "Zoomed in - Back")
 * and adds what the redesign requires around it: title + unit row, legend
 * (always for >= 2 series), the "Show as table" toggle, and the four states.
 * A failed fetch never draws a plot.
 */
import { useId, useState, type ReactNode } from 'react';
import { C } from '../copy';
import { ChartFrame, type ChartFrameProps } from '../bridge/chart';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { TableView, type TableData } from './TableView';
import type { ChartStatus } from './types';
import { markingZoom } from './zoomMarker';

export interface LegendItem {
  name: string;
  color: string;
  /** 'line' draws a short stroke, 'dashed' a dashed one, default is a square. */
  shape?: 'box' | 'line' | 'dashed';
}

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="ck-legend" aria-label="Legend">
      {items.map((it) => (
        <li key={it.name}>
          <span
            className={`ck-swatch ${it.shape ?? 'box'}`}
            style={{ background: it.shape === 'dashed' ? 'none' : it.color, borderColor: it.color }}
            aria-hidden="true"
          />
          {it.name}
        </li>
      ))}
    </ul>
  );
}

export interface FrameProps {
  chartId: string;
  title: string;
  unit: string;
  caption?: ReactNode;
  status?: ChartStatus;
  errorPart?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  emptyAction?: { label: string; onClick: () => void };
  legend?: LegendItem[];
  table: TableData;
  defaultH?: number;
  /** Everything ChartFrame needs to draw and hover the plot. */
  frame: Omit<ChartFrameProps, 'chartId' | 'defaultH' | 'title' | 'caption' | 'ariaLabel'>;
}

export function Frame(p: FrameProps) {
  const status = p.status ?? 'ready';
  const h = p.defaultH ?? 260;
  const [asTable, setAsTable] = useState(false);
  const tid = useId();
  /* CSS-053: a click-zoom marks its history entry so "Zoomed in - Back" (here and in the top bar) knows the page is zoomed. */
  const frame = p.frame.zoom ? { ...p.frame, zoom: { ...p.frame.zoom, onZoom: markingZoom(p.frame.zoom.onZoom) } } : p.frame;
  return (
    <section className="ck-frame" aria-labelledby={`${tid}-t`}>
      <header className="ck-head">
        <h3 id={`${tid}-t`} className="ck-title">{p.title}</h3>
        <span className="ck-unit">{p.unit}</span>
        {status === 'ready' && (
          <button type="button" className="ck-toggle no-print" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            {asTable ? C.chart.showAsChart : C.chart.showAsTable}
          </button>
        )}
      </header>
      {status === 'ready' && p.legend && <Legend items={p.legend} />}
      {status === 'loading' && <div className="skel ck-skel" style={{ height: h }} role="status" aria-label={C.chart.loading} />}
      {status === 'error' && <ErrorState part={p.errorPart ?? p.title} onRetry={p.onRetry} minHeight={h} />}
      {status === 'empty' && <EmptyState message={p.emptyMessage} action={p.emptyAction} />}
      {status === 'ready' &&
        (asTable ? (
          <TableView caption={C.chart.tableCaption(p.title)} data={p.table} />
        ) : (
          <ChartFrame chartId={p.chartId} defaultH={h} caption={p.caption} ariaLabel={`${p.title}, ${p.unit}`} {...frame} />
        ))}
      {status === 'ready' && asTable && p.caption && <p className="ck-caption">{p.caption}</p>}
    </section>
  );
}
