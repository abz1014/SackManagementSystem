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
import { fmtDayLong, fmtInt, fmtPct1 } from '../../lib/fmt';
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

/**
 * `sackScale` adds the share of each group's sacks the SCALE passed — the
 * one column that makes "how did sack packing go over the period?" readable
 * per day. Opt-in rather than always-on because this table also builds the
 * Daily and Shift reports, which are about cones; a sack column on those
 * would be the "no two screens answer the same question" rule read
 * backwards. The Sack report passes it; nothing else does.
 */
export function LineTable({ rows, head, sackScale = false }: { rows: ReportLine[]; head: string; sackScale?: boolean }) {
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
          {sackScale && <th className="n">{W.reports.colSacksPassedScale}</th>}
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
            {/* An em dash, never 0 %: null means no sack here carried the
                scale's verdict, which is not the same as the scale failing
                every one of them. */}
            {sackScale && <td className="n">{r.sacksPassedScalePct == null ? '—' : fmtPct1(r.sacksPassedScalePct)}</td>}
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

/* ----------------------------------------------------------- histogram */

export interface HistBucket {
  /** The bucket's START value, in `unit`. Buckets are `bucketSize` apart. */
  bucket: number;
  count: number;
}

/**
 * How many EMPTY buckets may sit between two occupied ones before the far
 * side stops counting as part of the same body.
 *
 * Eight, and that is not a taste: `weights.ts` bins every histogram this
 * screen draws at 32 bins across +/-4 sd, so one standard deviation is
 * four buckets wide whatever the unit and whatever the generation. Eight
 * empty buckets is therefore two sd of nothing at all — a distance no
 * shoulder of a real distribution crosses, and the distance the isolated
 * readings on this data actually sit at.
 */
const CORE_GAP_BUCKETS = 8;

/**
 * Above this share of readings outside the core, DO NOT clip. A tail
 * carrying more than one reading in fifty is not a stray, it is a second
 * population, and putting it behind an edge marker would hide a bimodal
 * distribution — the exact failure this chart exists to make visible.
 */
const MAX_OVERFLOW_SHARE = 0.02;

/**
 * And below this saving, do not clip either: if the core still spans 80 %
 * of the full range, an edge marker costs the reader a sentence and buys
 * them almost no resolution.
 */
const MIN_CLIP_SAVING = 0.2;

/** Readings pushed outside the drawn axis at one end. Never dropped — named. */
export interface HistOverflow {
  count: number;
  /** The START of the furthest occupied bucket on this side. */
  extremeBucket: number;
}

export interface HistogramView {
  /** Domain actually drawn: [lo, hi) in the chart's own unit. */
  lo: number;
  hi: number;
  drawn: HistBucket[];
  below: HistOverflow | null;
  above: HistOverflow | null;
}

/**
 * THE X AXIS IS LINEAR IN VALUE, and this function is what makes that
 * survivable.
 *
 * Until 23 Sep 2026 `Histogram` laid its bars out BY INDEX: every occupied
 * bucket got an equal slot, so an empty bucket occupied no width at all and
 * distance along the axis measured nothing. That was invisible while the
 * server's bucket was wider than the spread it was drawing (one bar, or
 * three). `b91f7d5` fixed the bucketing — 47 bars on gen-1 sacks, 75 on
 * gen-1 cones, 21 on gen-3 sacks — and at 21 bars the index layout became a
 * measurable misrepresentation: gen-3 sacks hold strays at 45.12 and 55.48
 * kg with nothing between them, and the chart drew 55.45 immediately beside
 * 49.15, the same 36 px it gave the 0.05 kg step from 45.10 to 45.15. A 126:1
 * distortion at the worst adjacency, measured in the browser before the fix.
 *
 * A linear axis over the FULL range fixes the lie and creates a second
 * problem: gen-3 sacks then span 208 buckets, of which the entire body
 * (46.95-47.65 kg, 3,113 of 3,122 readings) occupies 14 — 51 px of the
 * 760 px plot measured at 1366 px. So the axis is clipped to the body, and
 * the nine readings outside it are
 * COUNTED AND NAMED under the chart rather than dropped. An axis that
 * quietly omits a real reading asserts that the reading does not exist;
 * this one says how many there are and where the furthest sits.
 *
 * The body is grown outward from the modal bucket across gaps of at most
 * `CORE_GAP_BUCKETS`, and the result is discarded entirely — full range,
 * no marker — if it would hide more than `MAX_OVERFLOW_SHARE` of the
 * readings or if it saves less than `MIN_CLIP_SAVING` of the width.
 */
export function histogramView(buckets: HistBucket[], bucketSize: number): HistogramView {
  const all = [...buckets].sort((a, b) => a.bucket - b.bucket);
  const size = bucketSize > 0 ? bucketSize : 1;
  const full: HistogramView = {
    lo: all[0]!.bucket,
    hi: all[all.length - 1]!.bucket + size,
    drawn: all,
    below: null,
    above: null,
  };
  if (all.length < 3) return full;

  // Empty buckets strictly between two occupied ones.
  const gap = (a: HistBucket, b: HistBucket) => Math.round((b.bucket - a.bucket) / size) - 1;

  let peak = 0;
  for (let i = 1; i < all.length; i++) if (all[i]!.count > all[peak]!.count) peak = i;
  let lo = peak;
  let hi = peak;
  while (lo > 0 && gap(all[lo - 1]!, all[lo]!) <= CORE_GAP_BUCKETS) lo--;
  while (hi < all.length - 1 && gap(all[hi]!, all[hi + 1]!) <= CORE_GAP_BUCKETS) hi++;
  if (lo === 0 && hi === all.length - 1) return full;

  const sum = (from: number, to: number) => all.slice(from, to).reduce((t, b) => t + b.count, 0);
  const total = sum(0, all.length);
  const hidden = sum(0, lo) + sum(hi + 1, all.length);
  if (total <= 0 || hidden / total > MAX_OVERFLOW_SHARE) return full;

  const fullSpan = Math.round((full.hi - full.lo) / size);
  const coreSpan = Math.round((all[hi]!.bucket + size - all[lo]!.bucket) / size);
  if (coreSpan / fullSpan > 1 - MIN_CLIP_SAVING) return full;

  return {
    lo: all[lo]!.bucket,
    hi: all[hi]!.bucket + size,
    drawn: all.slice(lo, hi + 1),
    below: lo > 0 ? { count: sum(0, lo), extremeBucket: all[0]!.bucket } : null,
    above: hi < all.length - 1 ? { count: sum(hi + 1, all.length), extremeBucket: all[all.length - 1]!.bucket } : null,
  };
}

/** Decimals a bucket label needs at this width: 0.05 -> 2, 2 -> 0. */
function bucketDecimals(size: number): number {
  return size > 0 ? Math.max(0, -Math.floor(Math.log10(size))) : 0;
}

/**
 * Evenly spaced tick VALUES across [lo, hi), each a whole multiple of the
 * bucket width so every label is a real bucket boundary and stays as round
 * as the server made it. The step is the smallest multiple of `bucketSize`
 * at least `minPx` wide, so labels thin themselves rather than overprint —
 * the same rule `fittingTicks` applies to the other charts, expressed in
 * value rather than in index because this axis is now value-positioned.
 */
function bucketTicks(lo: number, hi: number, size: number, plotW: number, minPx = 70): number[] {
  const span = hi - lo;
  if (!(span > 0) || !(size > 0) || !(plotW > 0)) return [lo];
  const perBucket = plotW / (span / size);
  const step = Math.max(1, Math.ceil(minPx / perBucket)) * size;
  const dp = bucketDecimals(size);
  const round = (v: number) => Number(v.toFixed(dp + 3));
  const out: number[] = [];
  for (let v = Math.ceil(round(lo / step)) * step; round(v) < round(hi); v += step) out.push(round(v));
  if (out.length === 0) out.push(round(lo));
  return out;
}

/**
 * A histogram as plain bars: bucket start on a LINEAR x axis, count as
 * height. `bucketSize` is required rather than inferred from the gaps
 * between the buckets, because the wire payload is SPARSE (weights.ts:55,
 * "empty buckets are omitted") and a one-bar or two-bar distribution has no
 * gap to infer it from — and guessing the unit of the axis is exactly the
 * kind of unsupported assertion this app does not make. Both callers
 * already hold it: they print it in the block label beside the chart.
 */
export function Histogram({ buckets, bucketSize, unit, label }: { buckets: HistBucket[]; bucketSize: number; unit: string; label: string }) {
  const [box, width] = useChartWidth();
  const H = 180;
  const L = 48;
  const R = 8;
  const T = 12;
  const B = 28;
  if (buckets.length === 0) return <Empty message={W.nothingHere} />;
  const view = histogramView(buckets, bucketSize);
  const size = bucketSize > 0 ? bucketSize : 1;
  const dp = bucketDecimals(size);
  const plotW = Math.max(1, width - L - R);
  const max = Math.max(...view.drawn.map((b) => b.count), 1);
  const x = linear([view.lo, view.hi], [L, width - R]);
  // The natural width of one bucket on this axis. Floored at 2px, because a
  // bar that renders as nothing is its own defect; when the floor bites, the
  // bar is re-centred on its own interval so it still sits where its value is.
  const slot = plotW / Math.max(1, (view.hi - view.lo) / size);
  const bw = Math.max(2, slot * 0.9);
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);
  const ticks = bucketTicks(view.lo, view.hi, size, plotW);
  const fmtB = (v: number) => v.toFixed(dp);
  const clipped = view.below ?? view.above;
  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={label}>
        {view.drawn.map((b) => (
          <rect key={b.bucket} x={x(b.bucket + size / 2) - bw / 2} y={y(b.count)} width={bw} height={Math.max(0, H - B - y(b.count))} fill="var(--graphite)" />
        ))}
        {ticks.map((v, i) => (
          <text key={`t${v}`} x={x(v)} y={H - 8} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor={edgeAnchor(i, ticks.length)}>
            {fmtB(v)}{unit}
          </text>
        ))}
        {/* The axis is cut here, and the sentence under the chart says by how
            much. A mark alone would be decoration; the count is the fact. */}
        {view.below && (
          <text x={L - 2} y={H - B - 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end" aria-hidden="true">‹‹</text>
        )}
        {view.above && (
          <text x={width - R + 2} y={H - B - 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="start" aria-hidden="true">››</text>
        )}
        <text x={L - 8} y={T + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">{fmtInt(max)}</text>
        <line x1={L} x2={width - R} y1={H - B} y2={H - B} stroke="var(--rule-2)" />
      </svg>
      {clipped && (
        <p className="mut sm" style={{ marginTop: 6 }}>
          {W.reports.histogramClipped(
            view.below ? fmtInt(view.below.count) : null,
            view.below ? `${fmtB(view.below.extremeBucket)}${unit}` : null,
            view.above ? fmtInt(view.above.count) : null,
            view.above ? `${fmtB(view.above.extremeBucket)}${unit}` : null,
            `${fmtB(view.lo)}${unit}`,
            `${fmtB(view.hi)}${unit}`,
          )}
        </p>
      )}
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
  labelWidth = 168,
  rowHeight = 28,
}: {
  rows: RankRow[];
  ariaLabel: string;
  valueFmt?: (v: number) => string;
  /**
   * The label gutter. 168px fits a station name; it does NOT fit a PDAS
   * product whose plain description collides with five others and is
   * therefore printed with the parts that distinguish it appended
   * ("205-IL0-SD · Star Green · PVSD8020 · 18" — see productLabel.ts).
   * Callers drawing products pass a wider gutter rather than letting the
   * label run under its own bar. Default unchanged, so every existing
   * caller renders exactly as before.
   */
  labelWidth?: number;
  rowHeight?: number;
}) {
  const [box, width] = useChartWidth();
  if (rows.length < MIN_MULTIROW) return null;

  const L = labelWidth; // label gutter
  const R = 60; // value gutter
  const T = 6;
  const rowH = rowHeight;
  // 14px at the default 28px row, thicker (to 18) on a taller one.
  const barH = Math.max(12, Math.min(18, rowHeight - 14));
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
  height = 220,
  minHalfSpan,
}: {
  rows: DeviationRow[];
  ariaLabel: string;
  height?: number;
  /**
   * The smallest half-domain the y axis may use, in the rows' own unit.
   *
   * Without it the axis always fits the data, so a set of readings that
   * barely move — every production day's mean sack weight within 0.1 kg of
   * the period's own mean — is magnified until the bars look like a problem.
   * A caller that knows what size of difference would MATTER passes it here,
   * and a flat week then draws flat, which is the true answer. Never a
   * tolerance: this app has no sack tolerance from IFL (CLAUDE.md), and this
   * is a drawing bound, not a limit, so it is not labelled as one.
   */
  minHalfSpan?: number;
  /** A symmetric flag distance either side of zero, in the same unit as `value`. */
  threshold?: number;
  thresholdLabel?: string;
  /** Label on the zero line itself — e.g. what "zero" means here (the line mean, a target). */
  zeroLabel?: string;
  valueFmt?: (v: number) => string;
}) {
  const [box, width] = useChartWidth();
  if (rows.length < MIN_MULTIROW) return null;

  const H = height;
  const L = 48;
  const R = 8;
  const T = 18;
  const B = 40;

  const values = rows.map((r) => r.value);
  const withThreshold = threshold != null ? [threshold, -threshold] : [];
  const floor = minHalfSpan != null ? [minHalfSpan, -minHalfSpan] : [];
  // `0` is always in the values handed to `niceDomain` so the zero axis is
  // never padded away, whichever side of it every row happens to sit.
  const [lo, hi] = niceDomain([...values, 0, ...withThreshold, ...floor], { pad: 0.15 });
  const y = linear([lo, hi], [H - B, T]);
  const slot = (width - L - R) / rows.length;
  const bw = Math.max(4, slot * 0.55);
  const cx = (i: number) => L + slot * i + slot / 2;
  const zeroY = y(0);
  // Thin the x labels by how wide the WIDEST label actually is, not by a
  // fixed 60px slot. With 23 day labels ("23 Sept") across a full-width
  // chart the fixed figure kept every one of them and the last two
  // overprinted each other (seen on Sacks, 23 Sep 2026). Station labels are
  // shorter than the old 60px assumption in the common case, so no existing
  // caller loses a tick it was drawing before.
  const labelPx = Math.max(...rows.map((r) => r.label.length)) * 7 + 16;
  const step = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((width - L - R) / labelPx))));

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
  // UX Phase WS-B2 (23 Sep 2026): `q`/`w` are `number | null`, never `?? 0`.
  // `b.rate` is already nullable in the wire type ("no valid rate this
  // bucket"), and `wb` itself can be entirely absent ("no matching
  // weight-reject bucket for this day at all") — both used to collapse
  // through `pct(...) ?? 0` into a literal 0%, indistinguishable on the
  // chart from a genuinely perfect day. `wn` mirrors that: `wb?.rejects`
  // stays null rather than a fabricated zero reject count.
  const series = days.map((b) => {
    const wb = wByTs.get(b.bucketTs) ?? null;
    return {
      ts: b.bucketTs,
      q: pct(b.rate),
      w: pct(wb?.rate ?? null),
      qUcl: pct(b.ucl),
      // `qLcl ?? 0` below (bandPath) is a defensive fallback only, never
      // observed to fire: rejectSpc.ts sets ucl and lcl together in the same
      // branch (api/src/services/rejectSpc.ts:374-396), so any index this
      // component treats as "has a valid ucl" also has a valid lcl. Kept as
      // `?? 0` rather than a non-null assertion so a future change to that
      // invariant fails soft (a 0% floor) instead of throwing on this chart.
      qLcl: pct(b.lcl),
      wUcl: pct(wb?.ucl ?? null),
      qOut: b.outOfControl,
      wOut: wb?.outOfControl ?? false,
      produced: b.produced,
      qn: b.rejects,
      wn: wb?.rejects ?? null,
    };
  });
  // The y-range covers the band too, or a ceiling above every point would
  // be clipped off the top of the plot. Built from only the values a bucket
  // actually reported — a missing rate/limit must not silently cap the
  // scale by pretending it was a zero (the same `?? 0` collapse this pass
  // removes from the plotted points themselves).
  const numericExtents = series.flatMap((s) => [s.q, s.w, s.qUcl, s.wUcl].filter((v): v is number => v != null));
  const max = Math.max(...numericExtents, 1);
  const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (width - L - R);
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);

  const inPeriod = (ts: string) => periodFrom != null && periodTo != null && ts.slice(0, 10) >= periodFrom && ts.slice(0, 10) <= periodTo;
  const firstIn = series.findIndex((s) => inPeriod(s.ts));
  const lastIn = series.map((s) => inPeriod(s.ts)).lastIndexOf(true);

  /** Indices grouped into consecutive runs where `pred(i)` holds — the same
   *  device the band below already used for "a day too thin for a valid
   *  limit breaks the band rather than being bridged"; from this pass, also
   *  used for the quality/weight LINES themselves so a missing bucket draws
   *  a gap rather than a point bridged through a fabricated 0. */
  const runsWhere = (pred: (i: number) => boolean): number[][] => {
    const runs: number[][] = [];
    for (let i = 0; i < series.length; i++) {
      if (!pred(i)) continue;
      const run = runs[runs.length - 1];
      if (run && run[run.length - 1] === i - 1) run.push(i);
      else runs.push([i]);
    }
    return runs;
  };
  const qRuns = runsWhere((i) => series[i]!.q != null);
  const wRuns = weight ? runsWhere((i) => series[i]!.w != null) : [];
  let lastQIdx: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i]!.q != null) { lastQIdx = i; break; }
  let lastWIdx: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i]!.w != null) { lastWIdx = i; break; }
  // Used only in the hover readout when the hovered day is a gap. Was a
  // local-only string awaiting a `words.ts` home; `W.rejectsMore.noReadingThisDay`
  // (added 7055be1) is that home.
  const fmtRateOrGap = (v: number | null): string => (v == null ? W.rejectsMore.noReadingThisDay : `${v.toFixed(1)}%`);

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
              ? `${labelFmt(h.ts)} · ${W.rejects.quality} ${fmtRateOrGap(h.q)} · ${W.rejects.weightKind} ${fmtRateOrGap(h.w)} · ${fmtInt(h.produced)} cones weighed${h.qOut || h.wOut ? ` · ${W.rejectsMore.aboveUsual}` : ''}`
              : `${labelFmt(h.ts)} · ${qName} ${fmtRateOrGap(h.q)} · ${fmtInt(h.produced)} cones weighed${h.qOut ? ` · ${W.rejectsMore.aboveUsual}` : ''}`
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
        {/* UX Phase WS-B2 (23 Sep 2026): one <path> per RUN of consecutive
            days that actually have a value, not one path spanning the whole
            series — a bucket with no valid rate (or, for weight, no
            matching bucket at all) breaks the line instead of being bridged
            through a fabricated 0%. A run of exactly one day still needs a
            mark: a single moveto with no lineto paints nothing, so an
            isolated real reading gets its own dot rather than vanishing. */}
        {qRuns.map((run) =>
          run.length === 1 ? (
            <circle key={`ql${run[0]}`} cx={x(run[0]!)} cy={y(series[run[0]!]!.q!)} r={2.5} fill="var(--ink)" />
          ) : (
            <path
              key={`ql${run[0]}`}
              d={linePath(run.map((i) => ({ x: x(i), y: y(series[i]!.q!) })))}
              fill="none" stroke="var(--ink)" strokeWidth={1.75} strokeLinejoin="round"
            />
          ),
        )}
        {weight &&
          wRuns.map((run) =>
            run.length === 1 ? (
              <circle key={`wl${run[0]}`} cx={x(run[0]!)} cy={y(series[run[0]!]!.w!)} r={2} fill="var(--graphite)" />
            ) : (
              <path
                key={`wl${run[0]}`}
                d={linePath(run.map((i) => ({ x: x(i), y: y(series[i]!.w!) })))}
                fill="none" stroke="var(--graphite)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round"
              />
            ),
          )}
        {/* Out-of-control days, in the mark Weight's control chart uses.
            `s.qOut`/`s.wOut` can only be true where the bucket had a valid
            rate (rejectSpc.ts sets `outOfControl` inside the same branch
            that sets `rate`), but `s.q != null` is kept as an explicit guard
            here rather than a non-null assertion, matching this pass's rule
            of never asserting past a value this component cannot itself
            verify. */}
        {series.map((s, i) => (s.qOut && s.q != null ? <circle key={`q${i}`} cx={x(i)} cy={y(s.q)} r={4} fill="var(--acc-fill)" /> : null))}
        {weight && series.map((s, i) => (s.wOut && s.w != null ? <circle key={`w${i}`} cx={x(i)} cy={y(s.w)} r={4} fill="var(--acc-fill)" /> : null))}
        {/* Labelled on the mark, so the chart needs no legend — on the LAST
            day that actually has a value, not the last index: the newest
            bucket in the window may itself be the gap. */}
        {lastQIdx != null && (
          <text x={width - R + 10} y={y(series[lastQIdx]!.q!) + 4} fontSize="var(--fs-small)" fill="var(--ink)">
            {qName} {series[lastQIdx]!.q!.toFixed(1)}%
          </text>
        )}
        {weight && lastWIdx != null && (
          <text x={width - R + 10} y={y(series[lastWIdx]!.w!) + 4} fontSize="var(--fs-small)" fill="var(--graphite)">
            {W.rejects.weightKind} {series[lastWIdx]!.w!.toFixed(1)}%
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
