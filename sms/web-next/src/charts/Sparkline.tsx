/**
 * Axis-less trend line for KPI cards. It sits inside a card whose own figure states the value,
 * so it has no axes; its numbers are still reachable as a visually hidden table. Never draws
 * for loading, error or no data: those render a plain-size placeholder.
 */
import { catVar, defaultFormat, type ChartStatus } from './types';

export interface SparklineProps {
  label: string;
  unit: string;
  values: (number | null)[];
  /** Same length as values, for the table; defaults to 1..n. */
  categories?: string[];
  width?: number;
  height?: number;
  slot?: number;
  status?: ChartStatus;
}

export function Sparkline(p: SparklineProps) {
  const w = p.width ?? 96;
  const h = p.height ?? 28;
  const status = p.status ?? (p.values.some((v) => v != null) ? 'ready' : 'empty');
  if (status === 'loading') return <span className="skel ck-spark-skel" style={{ width: w, height: h }} role="status" aria-label="Loading" />;
  if (status !== 'ready') return <span className="ck-spark-none" style={{ width: w, height: h }} title={status === 'error' ? 'Could not load' : 'No data'} />;
  const nums = p.values.filter((v): v is number => v != null);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const n = p.values.length;
  const pad = 3;
  const pts = p.values.map((v, i) => (v == null ? null : { x: pad + (n === 1 ? (w - 2 * pad) / 2 : ((w - 2 * pad) * i) / (n - 1)), y: pad + (h - 2 * pad) * (1 - (v - lo) / span) }));
  let d = '';
  let pen = false;
  for (const pt of pts) {
    if (!pt) pen = false;
    else {
      d += `${pen ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      pen = true;
    }
  }
  const lastPt = [...pts].reverse().find((x) => x != null);
  const color = catVar(p.slot ?? 1);
  return (
    <span className="ck-spark">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${p.label}, trend`}>
        <path d={d} fill="none" stroke={color} className="ck-line" />
        {lastPt && <circle cx={lastPt.x} cy={lastPt.y} r={3} fill={color} className="ck-dot" />}
      </svg>
      <table className="sr-only ck-spark-table">
        <caption>{p.label}</caption>
        <thead>
          <tr><th scope="col" /><th scope="col">{p.unit}</th></tr>
        </thead>
        <tbody>
          {p.values.map((v, i) => (
            <tr key={i}>
              <th scope="row">{p.categories?.[i] ?? String(i + 1)}</th>
              <td>{v == null ? '-' : defaultFormat(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  );
}
