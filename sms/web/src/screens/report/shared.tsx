/**
 * Pieces every report section shares — roadmap Phase 8 (15 Sep 2026).
 * The figure, the line table and the day bars came out of Report.tsx
 * unchanged; the small helpers below are new.
 *
 * UX chart-primitives pass (22 Sep 2026): `RankBars` and `DeviationBars`,
 * added below `Histogram`. A design review measured seven of fourteen
 * report-shaped surfaces with zero graphical marks and found the actual
 * cause: `ui/chart.tsx` had per-series primitives (a line, a bar-per-day)
 * but no per-ROW mark, so every screen built after the handoff that needed
 * "one number per category" (a Pareto, a per-station deviation) reached for
 * a table instead. These two close that gap. GOVERNING RULE: each one draws
 * a number the report already prints — no new statistic, so no new
 * KPI-DEFINITIONS.md row and no new IFL approval.
 */
import { useState } from 'react';
import { W } from '../../lib/words';
import { Empty } from '../../ui/bits';
import {
  Readout, useChartWidth, edgeAnchor, linear, niceDomain, gridValues, RefLine,
  linePath, fittingTicks, tickIndices,
} from '../../ui/chart';
import { fmtDayLong, fmtInt } from '../../lib/fmt';
import type { ReportLine, StateCounts } from '../../api';

export function Fig({ v, u, n }: { v: string; u: string; n: string | null }) {
  return (
    <div>
      <b className="fig-val">{v}<span className="fig-unit">{u}</span></b>
      {n && <span className="fig-note">{n}</span>}
    </div>
  );
}

/** "31 Aug" — a bar label a person reads without decoding. */
export function fmtDayShort(day: string): string {
  return new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short',
  });
}

/** Grams with one decimal and a sign, for a bias: "+1.2 g" / "−0.8 g". */
export function fmtSignedG(n: number | null | undefined): string {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(1)} g`;
}

export function fmtG1(n: number | null | undefined): string {
  return n == null ? '—' : `${n.toFixed(1)} g`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  return n == null ? '—' : `${n.toFixed(digits)}%`;
}

/** The five states as one short line: "900 within · 10 low · 5 high · 3 rejected · 82 not judged". */
export function statesLine(s: StateCounts): string {
  return [
    `${fmtInt(s.within)} ${W.cone.stateShort.within.toLowerCase()}`,
    `${fmtInt(s.low)} ${W.cone.stateShort.low.toLowerCase()}`,
    `${fmtInt(s.high)} ${W.cone.stateShort.high.toLowerCase()}`,
    `${fmtInt(s.rejected)} ${W.cone.stateShort.rejected.toLowerCase()}`,
    `${fmtInt(s.unknown)} ${W.cone.stateShort.unknown.toLowerCase()}`,
  ].join(' · ');
}

/** The five state columns, for a table that carries them. */
export function StateCells({ s }: { s: StateCounts }) {
  return (
    <>
      <td className="n">{fmtInt(s.within)}</td>
      <td className="n">{fmtInt(s.low)}</td>
      <td className="n">{fmtInt(s.high)}</td>
      <td className="n">{fmtInt(s.rejected)}</td>
      <td className="n">{fmtInt(s.unknown)}</td>
    </>
  );
}
export function StateHeads() {
  return (
    <>
      <th className="n">{W.reports.colWithin}</th>
      <th className="n">{W.reports.colLow}</th>
      <th className="n">{W.reports.colHigh}</th>
      <th className="n">{W.reports.colRejected}</th>
      <th className="n">{W.reports.colNotJudged}</th>
    </>
  );
}

/* ------------------------------------------------------------- the tables */

export function LineTable({ rows, head }: { rows: ReportLine[]; head: string }) {
  const body = rows.filter((r) => r.group !== 'total');
  if (body.length === 0) return <Empty message={W.nothingHere} />;
  return (
    <table>
      <thead>
        <tr>
          <th>{head}</th>
          <th className="n">{W.report.colCones}</th>
          <th className="n">{W.report.colSacks}</th>
          <th className="n">{W.report.colSackWeight}</th>
          <th className="n">{W.reports.rejectedAtInspection}</th>
        </tr>
      </thead>
      <tbody>
        {body.map((r) => (
          <tr key={r.group}>
            <td>{head === W.report.colShift ? (W.shiftName[r.group as 'morning'] ?? r.group) : fmtDayShort(r.group)}</td>
            <td className="n">{fmtInt(r.cones)}</td>
            <td className="n">{fmtInt(r.sacks)}</td>
            <td className="n">{fmtInt(Math.round(r.sackWeightKg))} {W.fig.kg}</td>
            <td className="n">{fmtInt(r.rejectedCones)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------- the chart */

export function DayBars({ rows, label = W.report.conesPerDay }: { rows: ReportLine[]; label?: string }) {
  const [box, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240;
  const L = 56;
  const R = 8;
  const T = 24;
  const B = 30;

  const days = rows.filter((r) => r.group !== 'total');
  if (days.length === 0) return <Empty message={W.report.coverageNone('This period')} />;

  const max = Math.max(...days.map((d) => d.cones), 1);
  const slot = (width - L - R) / days.length;
  const bw = Math.max(4, slot * 0.62);
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);
  const cx = (i: number) => L + slot * i + slot / 2;

  // A label under every bar only when they fit; otherwise the ends and the
  // middles, anchored inward so no tick hangs off the plot.
  const step = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((width - L - R) / 90))));
  const grid = [0.25, 0.5, 0.75].map((f) => Math.round((max * f) / 500) * 500).filter((v) => v > 0);

  const h = hover != null ? days[hover] : null;

  return (
    <div ref={box}>
      <Readout
        hovered={h ? `${fmtDayLong(h.group)} · ${fmtInt(h.cones)} cones · ${fmtInt(h.sacks)} sacks` : null}
        resting={`${days.length} ${days.length === 1 ? 'day' : 'days'} · ${fmtInt(Math.min(...days.map((d) => d.cones)))} to ${fmtInt(max)} cones`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={label}>
        {[...new Set(grid)].map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={L - 8} y={y(v) + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">{fmtInt(v)}</text>
          </g>
        ))}
        {days.map((d, i) => (
          <rect
            key={d.group}
            x={cx(i) - bw / 2}
            y={y(d.cones)}
            width={bw}
            height={Math.max(0, H - B - y(d.cones))}
            fill={hover === i ? 'var(--ink)' : 'var(--graphite)'}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {days.map((d, i) =>
          i % step === 0 || i === days.length - 1 ? (
            <text
              key={`t${d.group}`}
              x={cx(i)}
              y={H - 8}
              fontSize="var(--fs-tick)"
              fill="var(--muted)"
              textAnchor={edgeAnchor(i, days.length)}
            >
              {fmtDayShort(d.group)}
            </text>
          ) : null,
        )}
        <line x1={L} x2={width - R} y1={H - B} y2={H - B} stroke="var(--rule-2)" />
      </svg>
    </div>
  );
}

/** A histogram as plain bars: bucket start on the x axis, count as height. */
export function Histogram({ buckets, unit, label }: { buckets: { bucket: number; count: number }[]; unit: string; label: string }) {
  const [box, width] = useChartWidth();
  const H = 180;
  const L = 48;
  const R = 8;
  const T = 12;
  const B = 28;
  if (buckets.length === 0) return <Empty message={W.nothingHere} />;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const slot = (width - L - R) / buckets.length;
  const bw = Math.max(2, slot * 0.8);
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);
  const step = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor((width - L - R) / 70))));
  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={label}>
        {buckets.map((b, i) => (
          <rect key={b.bucket} x={L + slot * i + (slot - bw) / 2} y={y(b.count)} width={bw} height={Math.max(0, H - B - y(b.count))} fill="var(--graphite)" />
        ))}
        {buckets.map((b, i) =>
          i % step === 0 || i === buckets.length - 1 ? (
            <text key={`t${b.bucket}`} x={L + slot * i + slot / 2} y={H - 8} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor={edgeAnchor(i, buckets.length)}>
              {b.bucket}{unit}
            </text>
          ) : null,
        )}
        <text x={L - 8} y={T + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">{fmtInt(max)}</text>
        <line x1={L} x2={width - R} y1={H - B} y2={H - B} stroke="var(--rule-2)" />
      </svg>
    </div>
  );
}

/* --------------------------------------------------------- rank & deviation */

export interface RankRow {
  key: string;
  label: string;
  value: number;
  /** A genuinely flagged row — the ONLY thing allowed to draw in the accent. */
  flagged?: boolean;
}

/** Below this many rows a rank or comparison is not a chart, it is one bar. */
const MIN_MULTIROW = 2;

/**
 * A ranked horizontal bar list: category, bar, value at the end — the shape
 * a Pareto or a "top N" belongs in, and the primitive `Rejects.tsx`'s `.bars`
 * (a CSS grid whose bar is an inline `background` on an `<i>`, app.css:748)
 * should have been. A `background` does not print with background graphics
 * off; an SVG `fill`, a presentation attribute rather than a style, does
 * (see this module's file header and `chart.tsx`'s own one). `.bars` is not
 * touched here — this is the primitive for screens built from now on.
 *
 * The table beside this chart stays the keyboard and screen-reader route
 * (`chart.tsx:93-95`); this is a second, visual route to numbers the report
 * already prints, not a replacement for the table.
 */
export function RankBars({
  rows,
  ariaLabel,
  valueFmt = fmtInt,
}: {
  rows: RankRow[];
  ariaLabel: string;
  valueFmt?: (v: number) => string;
}) {
  const [box, width] = useChartWidth();
  if (rows.length < MIN_MULTIROW) return null;

  const L = 168; // label gutter
  const R = 60; // value gutter
  const T = 6;
  const rowH = 28;
  const barH = 14;
  const H = T + rows.length * rowH + 6;

  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  // Domain anchored at exactly 0 (not `niceDomain`'s padded lo) so every bar's
  // length stays exactly proportional to its own value — a rank list is read
  // by comparing bar lengths to each other, and any padding that shifts the
  // zero point breaks that comparison.
  const x = linear([0, max], [L, Math.max(L + 1, width - R)]);

  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={ariaLabel}>
        {rows.map((r, i) => {
          const rowY = T + i * rowH;
          const barY = rowY + (rowH - barH) / 2;
          const bw = Math.max(0, x(Math.abs(r.value)) - L);
          return (
            <g key={r.key}>
              <text x={0} y={barY + barH - 3} fontSize="var(--fs-small)" fill="var(--ink)">
                {r.label}
              </text>
              <rect x={L} y={barY} width={bw} height={barH} fill={r.flagged ? 'var(--acc-fill)' : 'var(--graphite)'} />
              <text x={x(Math.abs(r.value)) + 8} y={barY + barH - 3} fontSize="var(--fs-tick)" fill="var(--muted)">
                {valueFmt(r.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface DeviationRow {
  key: string;
  label: string;
  value: number;
  /** A genuinely flagged row — the ONLY thing allowed to draw in the accent. */
  flagged?: boolean;
}

/**
 * Signed bars from a zero axis, one per row — "which of these N is off, and
 * by how much" (a station's bias from the line, a day's deviation from a
 * target). Draws numbers a report or table already states; it never derives
 * a new one and never shades a control band — X-bar bands were suppressed
 * everywhere in this app (commit 0877396) because the limit model does not
 * fit this process's variable-n subgroups, and that finding is not
 * reintroduced here under a different name. `threshold`, when given, draws
 * two labelled `RefLine`s (muted, not accent — the accent is reserved for a
 * row the caller has actually flagged, never for the line stating the rule).
 */
export function DeviationBars({
  rows,
  ariaLabel,
  threshold,
  thresholdLabel,
  zeroLabel,
  valueFmt = fmtSignedG,
}: {
  rows: DeviationRow[];
  ariaLabel: string;
  /** A symmetric flag distance either side of zero, in the same unit as `value`. */
  threshold?: number;
  thresholdLabel?: string;
  /** Label on the zero line itself — e.g. what "zero" means here (the line mean, a target). */
  zeroLabel?: string;
  valueFmt?: (v: number) => string;
}) {
  const [box, width] = useChartWidth();
  if (rows.length < MIN_MULTIROW) return null;

  const H = 220;
  const L = 48;
  const R = 8;
  const T = 18;
  const B = 40;

  const values = rows.map((r) => r.value);
  const withThreshold = threshold != null ? [threshold, -threshold] : [];
  // `0` is always in the values handed to `niceDomain` so the zero axis is
  // never padded away, whichever side of it every row happens to sit.
  const [lo, hi] = niceDomain([...values, 0, ...withThreshold], { pad: 0.15 });
  const y = linear([lo, hi], [H - B, T]);
  const slot = (width - L - R) / rows.length;
  const bw = Math.max(4, slot * 0.55);
  const cx = (i: number) => L + slot * i + slot / 2;
  const zeroY = y(0);
  const step = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((width - L - R) / 60))));

  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={ariaLabel}>
        {gridValues([lo, hi]).map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={L - 8} y={y(v) + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">
              {valueFmt(v)}
            </text>
          </g>
        ))}
        {threshold != null && (
          <>
            <RefLine y={y(threshold)} x1={L} x2={width - R} label={thresholdLabel} tone="muted" dashed />
            <RefLine y={y(-threshold)} x1={L} x2={width - R} tone="muted" dashed />
          </>
        )}
        <RefLine y={zeroY} x1={L} x2={width - R} label={zeroLabel} tone="ink" />
        {rows.map((r, i) => {
          const barTop = Math.min(zeroY, y(r.value));
          const h = Math.abs(y(r.value) - zeroY);
          return (
            <rect
              key={r.key}
              x={cx(i) - bw / 2}
              y={barTop}
              width={bw}
              height={h}
              fill={r.flagged ? 'var(--acc-fill)' : 'var(--graphite)'}
            />
          );
        })}
        {rows.map((r, i) =>
          i % step === 0 || i === rows.length - 1 ? (
            <text
              key={`t${r.key}`}
              x={cx(i)}
              y={H - B + 16}
              fontSize="var(--fs-tick)"
              fill="var(--muted)"
              textAnchor={edgeAnchor(i, rows.length)}
            >
              {r.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

/* ----------------------------------------------------------- reject trend */

/**
 * The one series shape both the Rejects screen and the Reject report chart
 * need: a bucket's own rate and its own control limits (a p-chart for
 * varying sample size gives every bucket its own band — see rejectSpc.ts's
 * file header). `rate`/`ucl`/`lcl` are FRACTIONS (0..1, matching
 * `RejectBucket` from the API and `sms.reject_event`'s own SPC service), not
 * percentages — the component multiplies by 100 once, so a caller holding a
 * percentage already (the report's `RejectTrendPoint`) divides by 100 first
 * rather than the component guessing which unit it was handed.
 */
export interface TrendBucket {
  bucketTs: string;
  rate: number | null;
  ucl: number | null;
  lcl: number | null;
  outOfControl: boolean;
  produced: number;
  rejects: number;
}

/**
 * Extracted from `Rejects.tsx`'s own `TrendChart` (22 Sep 2026) so the Reject
 * report can draw the same p-chart instead of printing 40+ rows of digits.
 * Unchanged in shape and behaviour from the screen's version: one line per
 * series, a filled band over runs of buckets that have a VALID limit (a
 * bucket too thin for one — rejectSpc.ts's `MIN_EXPECTED_REJECTS_FOR_VALID_LIMITS`
 * — breaks the band rather than being bridged by a made-up value), and an
 * accent mark on every out-of-control point. `weight` is optional: the
 * report's own trend has no quality/weight split (it is queried with
 * `rejectType: 'all'`, roadmap Phase 8), so it passes `quality` alone and the
 * chart draws one line, labelled by `singleName`.
 *
 * This band is NOT the X-bar band suppressed elsewhere in this app (commit
 * 0877396, referenced in `RankBars`/`DeviationBars` above): that band used a
 * single pooled limit for subgroups of different size, which is the wrong
 * distribution once n varies. This p-chart gives each bucket its own limit
 * from its own n (`UCL_i = p̄ + 3·√(p̄(1−p̄)/n_i)`), which is the textbook
 * correct treatment for varying-n proportion data — a genuinely different,
 * sounder thing, not the same defect under a new name.
 */
export function RejectTrendChart({
  quality,
  weight,
  singleName,
  periodFrom,
  periodTo,
  labelFmt = fmtDayShort,
  ariaLabel = 'Reject rate over time',
}: {
  quality: TrendBucket[];
  /** Null/omitted when the caller has no quality/weight split — one series is drawn. */
  weight?: TrendBucket[] | null;
  /** Label for the single series when `weight` is absent; ignored otherwise. */
  singleName?: string | null;
  /** The selected period, shaded over the trailing window — omit to shade nothing. */
  periodFrom?: string;
  periodTo?: string;
  labelFmt?: (ts: string) => string;
  ariaLabel?: string;
}) {
  const [box, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const L = 44;
  const R = 130;
  const T = 18;
  const B = 30;

  const days = quality;
  if (days.length === 0) return <Empty message={W.nothingHere} />;

  const wByTs = new Map((weight ?? []).map((b) => [b.bucketTs, b]));
  const pct = (r: number | null) => (r == null ? null : r * 100);
  const series = days.map((b) => {
    const wb = wByTs.get(b.bucketTs) ?? null;
    return {
      ts: b.bucketTs,
      q: pct(b.rate) ?? 0,
      w: pct(wb?.rate ?? null) ?? 0,
      qUcl: pct(b.ucl),
      qLcl: pct(b.lcl),
      wUcl: pct(wb?.ucl ?? null),
      qOut: b.outOfControl,
      wOut: wb?.outOfControl ?? false,
      produced: b.produced,
      qn: b.rejects,
      wn: wb?.rejects ?? 0,
    };
  });
  // The y-range covers the band too, or a ceiling above every point would
  // be clipped off the top of the plot.
  const max = Math.max(...series.map((s) => Math.max(s.q, s.w, s.qUcl ?? 0, s.wUcl ?? 0)), 1);
  const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (width - L - R);
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);

  const inPeriod = (ts: string) => periodFrom != null && periodTo != null && ts.slice(0, 10) >= periodFrom && ts.slice(0, 10) <= periodTo;
  const firstIn = series.findIndex((s) => inPeriod(s.ts));
  const lastIn = series.map((s) => inPeriod(s.ts)).lastIndexOf(true);

  // The band: UCL over LCL, per bucket (a p-chart for varying sample size
  // gives every day its own limits). Drawn only across runs of days that
  // HAVE limits — a day too thin for a valid limit (rejectSpc.ts) breaks the
  // band rather than being bridged by a made-up value.
  const bandRuns: number[][] = [];
  for (let i = 0; i < series.length; i++) {
    if (series[i]!.qUcl == null) continue;
    const run = bandRuns[bandRuns.length - 1];
    if (run && run[run.length - 1] === i - 1) run.push(i);
    else bandRuns.push([i]);
  }
  const bandPath = (run: number[]) => {
    const upper = run.map((i) => ({ x: x(i), y: y(series[i]!.qUcl!) }));
    const lower = [...run].reverse().map((i) => ({ x: x(i), y: y(series[i]!.qLcl ?? 0) }));
    return `${linePath(upper)} L ${lower.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
  };
  const wCeiling = series.map((s, i) => (s.wUcl == null ? null : { x: x(i), y: y(s.wUcl) }));

  const grid = [1, 2, 3, 4].filter((v) => v < max);
  const h = hover != null ? series[hover] : null;
  // How many day labels actually FIT. Four were hardcoded, which collided the
  // moment this chart moved into a half-width column: "Wed 26 Aug" printed on
  // top of "Sat 29 Aug".
  const ticks = tickIndices(series.length, fittingTicks(width - L - R, 11, 13, series.length, 4));
  const qName = singleName ?? W.rejects.quality;

  return (
    <div ref={box}>
      <Readout
        hovered={
          h
            ? weight
              ? `${labelFmt(h.ts)} · ${W.rejects.quality} ${h.q.toFixed(1)}% · ${W.rejects.weightKind} ${h.w.toFixed(1)}% · ${fmtInt(h.produced)} cones weighed${h.qOut || h.wOut ? ` · ${W.rejectsMore.aboveUsual}` : ''}`
              : `${labelFmt(h.ts)} · ${qName} ${h.q.toFixed(1)}% · ${fmtInt(h.produced)} cones weighed${h.qOut ? ` · ${W.rejectsMore.aboveUsual}` : ''}`
            : null
        }
        resting={periodFrom != null ? `${series.length} days · the shaded band is the selected period` : `${series.length} days`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={ariaLabel}
           onMouseLeave={() => setHover(null)}>
        {firstIn >= 0 && (
          <rect x={x(firstIn) - 4} y={T} width={Math.max(8, x(lastIn) - x(firstIn) + 8)} height={H - T - B} fill="var(--paper-2)" />
        )}
        {grid.map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={L - 8} y={y(v) + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">{v}%</text>
          </g>
        ))}
        {/* The usual range for the first series: filled, with its ceiling ruled. */}
        {bandRuns.map((run) => (
          <g key={run[0]}>
            <path d={bandPath(run)} fill="var(--paper-3)" opacity={0.9} />
            <path d={linePath(run.map((i) => ({ x: x(i), y: y(series[i]!.qUcl!) })))} fill="none" stroke="var(--rule-2)" strokeWidth={1} />
          </g>
        ))}
        {/* The weight series' ceiling, dashed like its line. */}
        {weight && wCeiling.some((p) => p != null) && (
          <path
            d={linePath(wCeiling.filter((p): p is { x: number; y: number } => p != null))}
            fill="none" stroke="var(--grid)" strokeWidth={1} strokeDasharray="2 3"
          />
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--rule-2)" />}
        <path d={linePath(series.map((s, i) => ({ x: x(i), y: y(s.q) })))} fill="none" stroke="var(--ink)" strokeWidth={1.75} strokeLinejoin="round" />
        {weight && (
          <path d={linePath(series.map((s, i) => ({ x: x(i), y: y(s.w) })))} fill="none" stroke="var(--graphite)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
        )}
        {/* Out-of-control days, in the mark Weight's control chart uses. */}
        {series.map((s, i) => (s.qOut ? <circle key={`q${i}`} cx={x(i)} cy={y(s.q)} r={4} fill="var(--acc-fill)" /> : null))}
        {weight && series.map((s, i) => (s.wOut ? <circle key={`w${i}`} cx={x(i)} cy={y(s.w)} r={4} fill="var(--acc-fill)" /> : null))}
        {/* Labelled on the mark, so the chart needs no legend. */}
        <text x={width - R + 10} y={y(series[series.length - 1]!.q) + 4} fontSize="var(--fs-small)" fill="var(--ink)">
          {qName} {series[series.length - 1]!.q.toFixed(1)}%
        </text>
        {weight && (
          <text x={width - R + 10} y={y(series[series.length - 1]!.w) + 4} fontSize="var(--fs-small)" fill="var(--graphite)">
            {W.rejects.weightKind} {series[series.length - 1]!.w.toFixed(1)}%
          </text>
        )}
        {series.map((_, i) => (
          <rect key={i} className="hit" x={x(i) - (width - L - R) / Math.max(1, series.length) / 2} y={T}
                width={(width - L - R) / Math.max(1, series.length)} height={H - T - B}
                onMouseEnter={() => setHover(i)} />
        ))}
        {ticks.map((i) => (
          <text key={`t${i}`} x={x(i)} y={H - 8} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor={edgeAnchor(i, series.length)}>
            {labelFmt(series[i]!.ts)}
          </text>
        ))}
      </svg>
    </div>
  );
}
