/**
 * The chart kit's frame (DESIGN-SYSTEM 6.9 chart kit). Wraps the existing
 * `ChartFrame` (tooltip, keyboard, resize, click-to-zoom, "Zoomed in - Back")
 * and adds what the redesign requires around it: title + unit row, legend
 * (always for >= 2 series), the "Show as table" toggle, and the four states.
 * A failed fetch never draws a plot.
 */
import { useId, useState, type ReactNode } from 'react';
import { ChartFrame, type ChartFrameProps } from '../bridge/chart';
import { CHART_COPY } from './chartCopy';
import { TableView, type TableData } from './TableView';
import type { ChartStatus } from './types';

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

/* TODO(C6): swap for ui/EmptyState and ui/ErrorState once they land; these are the minimal stand-ins. */
export function ChartEmpty({ message, action, height }: { message: string; action?: { label: string; onClick: () => void }; height: number }) {
  return (
    <div className="ck-state" style={{ minHeight: height }} role="status">
      <p>{message}</p>
      {action && (
        <button type="button" className="ck-btn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ChartError({ part, onRetry, height }: { part: string; onRetry?: () => void; height: number }) {
  return (
    <div className="ck-state ck-error" style={{ minHeight: height }} role="alert">
      <p>
        <span className="ck-act-glyph" aria-hidden="true" /> {CHART_COPY.couldntLoad(part)}
      </p>
      {onRetry && (
        <button type="button" className="ck-btn" onClick={onRetry}>
          {CHART_COPY.tryAgain}
        </button>
      )}
    </div>
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
  return (
    <section className="ck-frame" aria-labelledby={`${tid}-t`}>
      <header className="ck-head">
        <h3 id={`${tid}-t`} className="ck-title">{p.title}</h3>
        <span className="ck-unit">{p.unit}</span>
        {status === 'ready' && (
          <button type="button" className="ck-toggle no-print" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            {asTable ? CHART_COPY.showAsChart : CHART_COPY.showAsTable}
          </button>
        )}
      </header>
      {status === 'ready' && p.legend && <Legend items={p.legend} />}
      {status === 'loading' && <div className="skel ck-skel" style={{ height: h }} role="status" aria-label={CHART_COPY.loading} />}
      {status === 'error' && <ChartError part={p.errorPart ?? p.title} onRetry={p.onRetry} height={h} />}
      {status === 'empty' && <ChartEmpty message={p.emptyMessage ?? CHART_COPY.nothingInPeriod} action={p.emptyAction} height={h} />}
      {status === 'ready' &&
        (asTable ? (
          <TableView caption={CHART_COPY.tableCaption(p.title)} data={p.table} />
        ) : (
          <ChartFrame chartId={p.chartId} defaultH={h} caption={p.caption} ariaLabel={`${p.title}, ${p.unit}`} {...p.frame} />
        ))}
      {status === 'ready' && asTable && p.caption && <p className="ck-caption">{p.caption}</p>}
    </section>
  );
}
