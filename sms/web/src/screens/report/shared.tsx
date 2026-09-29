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
import { useRef } from 'react';
import { W } from '../../lib/words';
import { Empty } from '../../ui/bits';
import {
  edgeAnchor, linear, niceDomain, gridValues, RefLine, RefLineGutterProvider,
  linePath, fittingTicks, tickIndices, CategoryBars, type BarDatum,
} from '../../ui/chart';
import { ChartFrame, type ChartTip, type ChartTipRow, type ChartFrameBrush } from '../../ui/ChartFrame';
import {
  gutterFor, textPx, bandHit, rowHit, nearestIndex, placeGutterLabels,
  type Rect, type GutterLabelIn,
} from '../../ui/chartLayout';
import { dayToShiftRange, snapToShifts, describePeriod, type ShiftRef, type PeriodParams } from '../../lib/period';
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

/**
 * Chart overhaul wave 3, Task T5 (29 Sep 2026): rebuilt on `CategoryBars`
 * (`ui/chart.tsx`) rather than a hand-rolled `<svg>` — the tooltip, re-layout,
 * drag-to-resize and (now optional) drag-to-select-sets-the-page-period all
 * come from `ChartFrame` for free. `onSelect`, when given, turns on the
 * brush: each bar is one production day, so a drag snaps to that day's
 * `D.morning..D.night` shift span (`dayToShiftRange`) — never a partial day.
 * Optional and defaulted to nothing so every existing caller (`Shift.tsx`,
 * `Daily.tsx`) compiles and renders exactly as before.
 */
export function DayBars({
  rows,
  label = W.report.conesPerDay,
  chartId = 'report-day-bars',
  onSelect,
}: {
  rows: ReportLine[];
  label?: string;
  chartId?: string;
  /** Wires the drag-to-select brush: fires with the whole-page period a drag
   *  snapped to. Omitted (the default) draws the chart with no brush. */
  onSelect?: (p: PeriodParams) => void;
}) {
  const days = rows.filter((r) => r.group !== 'total');
  if (days.length === 0) return <Empty message={W.report.coverageNone('This period')} />;

  const max = Math.max(...days.map((d) => d.cones), 1);
  const min = Math.min(...days.map((d) => d.cones));
  const data: BarDatum[] = days.map((d) => ({
    key: d.group,
    label: fmtDayShort(d.group),
    value: d.cones,
    detail: `${fmtDayLong(d.group)} · ${fmtInt(d.cones)} cones · ${fmtInt(d.sacks)} sacks`,
  }));
  const resting = `${days.length} ${days.length === 1 ? 'day' : 'days'} · ${fmtInt(min)} to ${fmtInt(max)} cones`;
  const brush = onSelect
    ? {
        refs: days.map((d): [ShiftRef, ShiftRef] => {
          const r = dayToShiftRange(d.group, d.group);
          return [r.from, r.to];
        }),
        onSelect,
      }
    : undefined;

  return (
    <div className={days.length < 2 ? 'no-print' : undefined}>
      <CategoryBars data={data} ariaLabel={label} resting={resting} valueFmt={fmtInt} chartId={chartId} brush={brush} />
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
/**
 * Chart overhaul wave 3, Task T5 (29 Sep 2026): moved onto `ChartFrame` for
 * a hover/tap tooltip (bin range, count, and — when the caller states where
 * the product's limits sit — inside/outside them) and a left gutter sized to
 * the y-max label rather than a fixed 48px (`gutterFor`, reused for the LEFT
 * margin: it only ever computes "how wide does this text need", which does
 * not care which side of the plot it sits on). No brush: a histogram's x
 * axis is a weight, not a timeline, and there is no page-period to select
 * from it.
 */
export function Histogram({
  buckets, bucketSize, unit, label, limitLo, limitHi, chartId,
}: {
  buckets: HistBucket[];
  bucketSize: number;
  unit: string;
  label: string;
  /** The product's tolerance band, in the same unit as `buckets`. Either or
   *  both may be omitted; the tooltip states inside/outside only when at
   *  least one bound is known. Neither caller passes these yet — wiring a
   *  screen's own limits through is left to whoever next touches that
   *  screen, same as every other optional prop here. */
  limitLo?: number;
  limitHi?: number;
  chartId?: string;
}) {
  const H = 180;
  const T = 12;
  const B = 28;
  if (buckets.length === 0) return <Empty message={W.nothingHere} />;
  const view = histogramView(buckets, bucketSize);
  const size = bucketSize > 0 ? bucketSize : 1;
  const dp = bucketDecimals(size);
  const max = Math.max(...view.drawn.map((b) => b.count), 1);
  const fmtB = (v: number) => v.toFixed(dp);
  const clipped = view.below ?? view.above;

  interface Layout { L: number; R: number; x: (v: number) => number; y: (v: number) => number; bw: number }
  const layoutRef = useRef<Layout | null>(null);

  const computeLayout = (width: number, fontPx: number): Layout => {
    const maxGutter = gutterFor([fmtInt(max)], fontPx, Math.max(1, width * 0.4));
    const L = Math.max(28, maxGutter === 'legend' ? 48 : maxGutter);
    const R = 10;
    const plotW = Math.max(1, width - L - R);
    const x = linear([view.lo, view.hi], [L, width - R]);
    const slot = plotW / Math.max(1, (view.hi - view.lo) / size);
    const bw = Math.max(2, slot * 0.9);
    const y = (v: number) => T + ((max - v) / max) * (H - T - B);
    return { L, R, x, y, bw };
  };

  const hit = (px: number, py: number): number | null => {
    const layout = layoutRef.current;
    if (!layout || py < T || py > H - B) return null;
    const xs = view.drawn.map((b) => layout.x(b.bucket + size / 2));
    const i = nearestIndex(px, xs);
    return i >= 0 && Math.abs(px - xs[i]!) <= layout.bw ? i : null;
  };

  const markRect = (i: number): Rect | null => {
    const layout = layoutRef.current;
    const b = view.drawn[i];
    if (!layout || !b) return null;
    const bx = layout.x(b.bucket + size / 2) - layout.bw / 2;
    const by = layout.y(b.count);
    return { x: bx, y: by, w: layout.bw, h: Math.max(0, H - B - by) };
  };

  const insideLabel = (mid: number): string => {
    if (limitLo != null && mid < limitLo) return W.cone.state.low;
    if (limitHi != null && mid > limitHi) return W.cone.state.high;
    return W.cone.state.within;
  };

  const tipFor = (i: number): ChartTip | null => {
    const b = view.drawn[i];
    if (!b) return null;
    const rows: ChartTipRow[] = [{ name: '', value: `${fmtInt(b.count)}` }];
    const context: string[] = [];
    if (limitLo != null || limitHi != null) context.push(insideLabel(b.bucket + size / 2));
    return { heading: `${fmtB(b.bucket)}–${fmtB(b.bucket + size)}${unit}`, rows, context };
  };

  return (
    <div>
      <ChartFrame
        chartId={chartId ?? label}
        defaultH={H}
        minH={H}
        maxH={H}
        ariaLabel={label}
        resting={`${view.drawn.length} bins · up to ${fmtInt(max)}`}
        hit={hit}
        count={view.drawn.length}
        tipFor={tipFor}
        markRect={markRect}
      >
        {(fsize) => {
          const layout = computeLayout(fsize.width, fsize.fontPx);
          layoutRef.current = layout;
          const { L, R, x, y, bw } = layout;
          const ticks = bucketTicks(view.lo, view.hi, size, Math.max(1, fsize.width - L - R));
          return (
            <svg className="chart" viewBox={`0 0 ${fsize.width} ${H}`} height={H} role="img" aria-label={label}>
              {view.drawn.map((b) => (
                <rect key={b.bucket} x={x(b.bucket + size / 2) - bw / 2} y={y(b.count)} width={bw} height={Math.max(0, H - B - y(b.count))} fill="var(--graphite)" />
              ))}
              {ticks.map((v, i) => (
                <text key={`t${v}`} x={x(v)} y={H - 8} fontSize={fsize.fontPx} fill="var(--muted)" textAnchor={edgeAnchor(i, ticks.length)}>
                  {fmtB(v)}{unit}
                </text>
              ))}
              {/* The axis is cut here, and the sentence under the chart says by how
                  much. A mark alone would be decoration; the count is the fact. */}
              {view.below && (
                <text x={L - 2} y={H - B - 4} fontSize={fsize.fontPx} fill="var(--muted)" textAnchor="end" aria-hidden="true">‹‹</text>
              )}
              {view.above && (
                <text x={fsize.width - R + 2} y={H - B - 4} fontSize={fsize.fontPx} fill="var(--muted)" textAnchor="start" aria-hidden="true">››</text>
              )}
              <text x={L - 8} y={T + 4} fontSize={fsize.fontPx} fill="var(--muted)" textAnchor="end">{fmtInt(max)}</text>
              <line x1={L} x2={fsize.width - R} y1={H - B} y2={H - B} stroke="var(--rule-2)" />
            </svg>
          );
        }}
      </ChartFrame>
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
  chartId,
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
  /** `ChartFrame`'s persisted-height key. Falls back to `ariaLabel`. */
  chartId?: string;
}) {
  if (rows.length < MIN_MULTIROW) return null;

  const L = labelWidth; // label gutter
  const T = 6;
  const rowH = rowHeight;
  // 14px at the default 28px row, thicker (to 18) on a taller one.
  const barH = Math.max(12, Math.min(18, rowHeight - 14));
  const H = T + rows.length * rowH + 6;

  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  interface Layout { R: number; x: (v: number) => number }
  const layoutRef = useRef<Layout | null>(null);

  const computeLayout = (width: number, fontPx: number): Layout => {
    // The value gutter fits the widest formatted value on this render — a
    // fixed 60px (the old figure) clips a five/six-digit count.
    const widest = Math.max(...rows.map((r) => valueFmt(Math.abs(r.value)).length));
    const R = Math.max(40, Math.ceil(textPx(widest, fontPx)) + 16);
    // Domain anchored at exactly 0 (not `niceDomain`'s padded lo) so every
    // bar's length stays exactly proportional to its own value — a rank list
    // is read by comparing bar lengths to each other, and any padding that
    // shifts the zero point breaks that comparison.
    const x = linear([0, max], [L, Math.max(L + 1, width - R)]);
    return { R, x };
  };

  // Truncates `text` with an ellipsis so it fits in `maxPx` at `fontPx` —
  // the full name always stays in the tooltip via `tipFor` below.
  const truncateLabel = (text: string, maxPx: number, fontPx: number): string => {
    if (textPx(text.length, fontPx) <= maxPx) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (textPx(mid, fontPx) + textPx(1, fontPx) <= maxPx) lo = mid;
      else hi = mid - 1;
    }
    return `${text.slice(0, Math.max(0, lo))}…`;
  };

  const hit = (px: number, py: number): number | null => rowHit(py, T, rowH, rows.length);

  const markRect = (i: number): Rect | null => {
    const layout = layoutRef.current;
    const r = rows[i];
    if (!layout || !r) return null;
    const rowY = T + i * rowH;
    const barY = rowY + (rowH - barH) / 2;
    const bw = Math.max(0, layout.x(Math.abs(r.value)) - L);
    return { x: L, y: barY, w: bw, h: barH };
  };

  const tipFor = (i: number): ChartTip | null => {
    const r = rows[i];
    if (!r) return null;
    return { heading: r.label, rows: [{ name: '', value: valueFmt(r.value) }] };
  };

  return (
    <ChartFrame
      chartId={chartId ?? ariaLabel}
      defaultH={H}
      minH={H}
      maxH={H}
      ariaLabel={ariaLabel}
      resting={`${rows.length} rows`}
      hit={hit}
      count={rows.length}
      tipFor={tipFor}
      markRect={markRect}
    >
      {(fsize) => {
        const layout = computeLayout(fsize.width, fsize.fontPx);
        layoutRef.current = layout;
        const { x } = layout;
        return (
          <svg className="chart" viewBox={`0 0 ${fsize.width} ${H}`} height={H} role="img" aria-label={ariaLabel}>
            {rows.map((r, i) => {
              const rowY = T + i * rowH;
              const barY = rowY + (rowH - barH) / 2;
              const bw = Math.max(0, x(Math.abs(r.value)) - L);
              const label = truncateLabel(r.label, L - 8, fsize.fontPx);
              return (
                <g key={r.key}>
                  <text x={0} y={barY + barH - 3} fontSize={fsize.fontPx} fill="var(--ink)">
                    {label}
                  </text>
                  <rect x={L} y={barY} width={bw} height={barH} fill={r.flagged ? 'var(--acc-fill)' : 'var(--graphite)'} />
                  <text x={x(Math.abs(r.value)) + 8} y={barY + barH - 3} fontSize={fsize.fontPx} fill="var(--muted)">
                    {valueFmt(r.value)}
                  </text>
                </g>
              );
            })}
          </svg>
        );
      }}
    </ChartFrame>
  );
}

export interface DeviationRow {
  key: string;
  label: string;
  value: number;
  /** A genuinely flagged row — the ONLY thing allowed to draw in the accent. */
  flagged?: boolean;
  /** Short x-axis label (e.g. "5" for a station) when `label` is too wide to
   *  show every tick; `label` still names the bar in its hover tooltip. */
  tick?: string;
  /** Hover tooltip text; defaults to "label: value". */
  title?: string;
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
  chartId,
  tip,
  onActivate,
  brush,
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
  /** `ChartFrame`'s persisted-height key. Falls back to `ariaLabel`. */
  chartId?: string;
  /** Per-bar tooltip, e.g. "Station 5 · 1,234 cones · 20 fewer than the row
   *  median of 1,254". Falls back to the bar's own `title`/`label: value`. */
  tip?: (i: number) => ChartTip | null;
  /** Line opens the station sheet; omitted, a bar is inert beyond hover. */
  onActivate?: (i: number) => void;
  /**
   * Drag-select sets the WHOLE PAGE period, ONLY when the caller states its
   * rows ARE days (`refs`, one `[ShiftRef, ShiftRef]` pair per row) — never
   * offered for a row of stations, which has no calendar position to drag
   * across. Omitted (the default), the chart draws with no brush.
   */
  brush?: { refs: [ShiftRef, ShiftRef][]; onSelect: (p: PeriodParams) => void };
}) {
  if (rows.length < MIN_MULTIROW) return null;

  const L = 48;
  const T = 18;
  const B = 40;

  const values = rows.map((r) => r.value);
  const withThreshold = threshold != null ? [threshold, -threshold] : [];
  const floor = minHalfSpan != null ? [minHalfSpan, -minHalfSpan] : [];
  // `0` is always in the values handed to `niceDomain` so the zero axis is
  // never padded away, whichever side of it every row happens to sit.
  const [lo, hi] = niceDomain([...values, 0, ...withThreshold, ...floor], { pad: 0.15 });
  const tickOf = (r: DeviationRow) => r.tick ?? r.label;

  interface Layout {
    H: number; R: number; y: (v: number) => number; slot: number; bw: number;
    cx: (i: number) => number; zeroY: number; legend: boolean; step: number;
  }
  const layoutRef = useRef<Layout | null>(null);

  // `h` is `ChartFrame`'s own current (possibly drag-resized) `size.height` —
  // resize-defect fix (chart overhaul, wave 3): this used to close over the
  // outer `height` PROP only, so `<svg height={H}>` below never changed even
  // though the drag handle moved `size.height` — the handle visibly resized
  // the chart-frame container while the SVG inside it stayed the original
  // fixed size. `height` (the prop) now serves only as `ChartFrame`'s
  // `defaultH`, the initial value before any drag.
  const computeLayout = (width: number, fontPx: number, h: number): Layout => {
    // The right margin comes from what the zero/threshold labels actually
    // need (`gutterFor`), not a fixed 8px — that fixed figure is the
    // screenshot defect this task exists to close: "row median" drawn over
    // the bars because the chart reserved no room for it at all.
    const gutterLabels = [zeroLabel, thresholdLabel].filter((s): s is string => !!s);
    const gutter = gutterFor(gutterLabels, fontPx, Math.max(1, width - L - 8));
    const legend = gutter === 'legend';
    const R = legend ? 8 : gutter;
    const y = linear([lo, hi], [h - B, T]);
    const slot = (width - L - R) / rows.length;
    const bw = Math.max(4, slot * 0.55);
    const cx = (i: number) => L + slot * i + slot / 2;
    const zeroY = y(0);
    // Thin the x labels by how wide the WIDEST label actually is, not by a
    // fixed 60px slot. With 23 day labels ("23 Sept") across a full-width
    // chart the fixed figure kept every one of them and the last two
    // overprinted each other (seen on Sacks, 23 Sep 2026).
    const labelPx = Math.ceil(textPx(Math.max(...rows.map((r) => tickOf(r).length)), fontPx)) + 16;
    const step = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((width - L - R) / labelPx))));
    return { H: h, R, y, slot, bw, cx, zeroY, legend, step };
  };

  const hit = (px: number, py: number): number | null => {
    const layout = layoutRef.current;
    if (!layout || py < T || py > layout.H - B) return null;
    return bandHit(px, L, layout.slot, rows.length);
  };

  const markRect = (i: number): Rect | null => {
    const layout = layoutRef.current;
    const r = rows[i];
    if (!layout || !r) return null;
    const barTop = Math.min(layout.zeroY, layout.y(r.value));
    const h = Math.max(1, Math.abs(layout.y(r.value) - layout.zeroY));
    return { x: layout.cx(i) - layout.bw / 2, y: barTop, w: layout.bw, h };
  };

  const tipFor = (i: number): ChartTip | null => {
    const r = rows[i];
    if (!r) return null;
    const extra = tip?.(i);
    if (extra) return extra;
    return { heading: r.label, rows: [{ name: '', value: r.title ?? valueFmt(r.value) }] };
  };

  const brushProp = brush
    ? {
        xs: rows.map((_, i) => (layoutRef.current ?? computeLayout(1036, 13, height)).cx(i)),
        onCommit: (i0: number, i1: number) => {
          const pair0 = brush.refs[i0];
          const pair1 = brush.refs[i1];
          if (!pair0 || !pair1) return;
          const snapped = snapToShifts(pair0[0], pair1[1]);
          if (snapped) brush.onSelect(snapped);
        },
      }
    : undefined;

  return (
    <ChartFrame
      chartId={chartId ?? ariaLabel}
      defaultH={height}
      ariaLabel={ariaLabel}
      resting={`${rows.length} rows`}
      hit={hit}
      count={rows.length}
      tipFor={tipFor}
      markRect={markRect}
      onActivate={onActivate}
      brush={brushProp}
    >
      {(fsize) => {
        // `fsize.height` is `ChartFrame`'s live, possibly drag-resized
        // height — reading it here (rather than the outer `height` prop) is
        // the fix: before this, the drag handle changed `ChartFrame`'s own
        // wrapper box but this component's `<svg>` stayed the original
        // fixed size inside it.
        const H = fsize.height;
        const layout = computeLayout(fsize.width, fsize.fontPx, H);
        layoutRef.current = layout;
        const { R, y, bw, cx, zeroY, legend, step } = layout;
        const plotRight = fsize.width - R;
        return (
          <RefLineGutterProvider top={T} bottom={H - B} fontPx={fsize.fontPx}>
            <svg className="chart" viewBox={`0 0 ${fsize.width} ${H}`} height={H} role="img" aria-label={ariaLabel}>
              {gridValues([lo, hi]).map((v) => (
                <g key={v}>
                  <line x1={L} x2={plotRight} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
                  <text x={L - 8} y={y(v) + 4} fontSize={fsize.fontPx} fill="var(--muted)" textAnchor="end">
                    {valueFmt(v)}
                  </text>
                </g>
              ))}
              {threshold != null && !legend && (
                <>
                  <RefLine y={y(threshold)} x1={L} x2={plotRight} label={thresholdLabel} tone="muted" dashed placement="gutter" fontPx={fsize.fontPx} />
                  <RefLine y={y(-threshold)} x1={L} x2={plotRight} tone="muted" dashed placement="gutter" fontPx={fsize.fontPx} />
                </>
              )}
              {threshold != null && legend && (
                <>
                  <line x1={L} x2={plotRight} y1={y(threshold)} y2={y(threshold)} stroke="var(--grid)" strokeDasharray="3 3" />
                  <line x1={L} x2={plotRight} y1={y(-threshold)} y2={y(-threshold)} stroke="var(--grid)" strokeDasharray="3 3" />
                </>
              )}
              <RefLine y={zeroY} x1={L} x2={plotRight} label={legend ? undefined : zeroLabel} tone="ink" placement="gutter" fontPx={fsize.fontPx} />
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
                  >
                    <title>{r.title ?? `${r.label}: ${valueFmt(r.value)}`}</title>
                  </rect>
                );
              })}
              {/* Evenly thinned: every `step`-th label only. Forcing the last one in
                  as well crammed it against its neighbour (Line, 25 Sep 2026). */}
              {rows.map((r, i) =>
                i % step === 0 ? (
                  <text
                    key={`t${r.key}`}
                    x={cx(i)}
                    y={H - B + 16}
                    fontSize={fsize.fontPx}
                    fill="var(--muted)"
                    textAnchor={edgeAnchor(i, rows.length)}
                  >
                    {tickOf(r)}
                  </text>
                ) : null,
              )}
            </svg>
            {legend && (zeroLabel || thresholdLabel) && (
              <p className="mut sm" style={{ marginTop: 4 }}>
                {[zeroLabel, thresholdLabel].filter(Boolean).join(' · ')}
              </p>
            )}
          </RefLineGutterProvider>
        );
      }}
    </ChartFrame>
  );
}

/**
 * The pure geometry `DeviationBars` itself uses for its right-margin gutter
 * and its zero/threshold label placement — exported so a test can prove "the
 * labels never land on a bar" without rendering the DOM, at any width. Not
 * called by the component above (which recomputes the same thing against its
 * own `fsize`), because `ChartFrame` supplies size only inside its render
 * prop; this is the same three calls (`gutterFor`, `linear`/`niceDomain`,
 * `placeGutterLabels`) a caller can run standalone with a chosen width.
 */
export function deviationBarsGeometry(
  rows: DeviationRow[],
  opts: {
    width: number;
    height?: number;
    fontPx?: number;
    threshold?: number;
    thresholdLabel?: string;
    zeroLabel?: string;
    minHalfSpan?: number;
    valueFmt?: (v: number) => string;
  },
): { bars: Rect[]; labels: { text: string; y: number; gutterX: number }[] } {
  const { width, height = 220, fontPx = 12, threshold, thresholdLabel, zeroLabel, minHalfSpan } = opts;
  const H = height;
  const L = 48;
  const T = 18;
  const B = 40;
  const values = rows.map((r) => r.value);
  const withThreshold = threshold != null ? [threshold, -threshold] : [];
  const floor = minHalfSpan != null ? [minHalfSpan, -minHalfSpan] : [];
  const [lo, hi] = niceDomain([...values, 0, ...withThreshold, ...floor], { pad: 0.15 });
  const gutterLabels = [zeroLabel, thresholdLabel].filter((s): s is string => !!s);
  const gutter = gutterFor(gutterLabels, fontPx, Math.max(1, width - L - 8));
  const legend = gutter === 'legend';
  const R = legend ? 8 : gutter;
  const y = linear([lo, hi], [H - B, T]);
  const slot = (width - L - R) / Math.max(1, rows.length);
  const bw = Math.max(4, slot * 0.55);
  const cx = (i: number) => L + slot * i + slot / 2;
  const zeroY = y(0);

  const bars: Rect[] = rows.map((r, i) => {
    const barTop = Math.min(zeroY, y(r.value));
    const h = Math.max(1, Math.abs(y(r.value) - zeroY));
    return { x: cx(i) - bw / 2, y: barTop, w: bw, h };
  });

  let labels: { text: string; y: number; gutterX: number }[] = [];
  if (!legend) {
    const gutterX = width - R + 8;
    const items: GutterLabelIn[] = [];
    if (zeroLabel) items.push({ y: zeroY, text: zeroLabel, prio: 1 });
    if (threshold != null && thresholdLabel) items.push({ y: y(threshold), text: thresholdLabel, prio: 0 });
    const outs = placeGutterLabels(items, { top: T, bottom: H - B, lineH: fontPx * 1.3 });
    labels = outs.filter((o) => o.text !== '').map((o) => ({ text: o.text, y: o.y, gutterX }));
  }

  return { bars, labels };
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
 *
 * Chart overhaul wave 3, Task T8b (29 Sep 2026): migrated onto `ChartFrame` —
 * the floating tooltip, keyboard navigation, drag-to-resize handle and a
 * shift-snapped brush this chart previously carried by hand
 * (`report.series.test.tsx`'s old `rect.hit`/`.readout` assertions were the
 * stated reason it was left off `ChartFrame` in `a9ee7e0`; that file's
 * assertions are rewritten to test tooltip BEHAVIOUR instead, so the reason
 * no longer holds). `hit` always resolves to the nearest day — every day
 * stays hoverable/focusable even on a gap, exactly as the old full-height
 * `rect.hit` per index did, so "no reading this day" is still reachable.
 */
export function RejectTrendChart({
  quality,
  weight,
  singleName,
  periodFrom,
  periodTo,
  labelFmt = fmtDayShort,
  ariaLabel = 'Reject rate over time',
  onSelect,
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
  /**
   * Drag-select (or Shift+Arrow, then `+`, on the keyboard — `ChartFrame`'s
   * own brush path) sets the WHOLE PAGE period, snapped to shift boundaries —
   * each day is one point on this chart, so a drag spans `dayToShiftRange`
   * for its first and last day. Omitted (the default), the chart draws with
   * no brush.
   */
  onSelect?: (p: PeriodParams) => void;
}) {
  const H = 250;
  const L = 44;
  const R = 130;
  const T = 18;
  const B = 30;

  interface Layout { width: number; height: number; x: (i: number) => number; y: (v: number) => number }
  const layoutRef = useRef<Layout | null>(null);

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

  const computeLayout = (width: number, height: number): Layout => {
    const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (width - L - R);
    const y = (v: number) => T + ((max - v) / max) * (height - T - B);
    return { width, height, x, y };
  };
  // 1036 mirrors `useChartSize.ts`'s own fallback width, the same device
  // `CategoryBars` uses so the very first brush.xs this component hands down
  // agrees with what ChartFrame is about to paint before its first real
  // measurement.
  const fallbackLayout = () => computeLayout(1036, H);

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
  // Used in the tooltip/readout when the hovered day is a gap. Was a
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

  const grid = [1, 2, 3, 4].filter((v) => v < max);
  const qName = singleName ?? W.rejects.quality;

  // Tooltip content: the UCL beside each series' own rate, so the tooltip/
  // readout states not just the value but the bound it is judged against —
  // "whether a point is above usual" is already `aboveUsual` below; this adds
  // the number that makes it checkable.
  const uclPart = (v: number | null): string => (v == null ? '' : ` · ${W.chart.ucl} ${v.toFixed(1)}%`);

  // Caption: the span the p-chart's OWN limits were worked out over — the
  // whole series, not the (possibly narrower) shaded selected period.
  const captionRange = series.length > 0 ? `${labelFmt(series[0]!.ts)} – ${labelFmt(series[series.length - 1]!.ts)}` : '';

  // `hit` always resolves to the NEAREST day, whether or not that day has a
  // value — every column stays hoverable/focusable, matching the old
  // full-height `rect.hit` per index (a gap day must still be reachable so
  // its tooltip can state "no reading this day", never silently skipped).
  const hit = (px: number, py: number): number | null => {
    const layout = layoutRef.current ?? fallbackLayout();
    if (py < T || py > layout.height - B) return null;
    const xs = series.map((_, i) => layout.x(i));
    return nearestIndex(px, xs);
  };

  const markRect = (i: number): Rect | null => {
    const layout = layoutRef.current ?? fallbackLayout();
    const s = series[i];
    if (!s) return null;
    const v = s.q ?? s.w;
    const cy = v != null ? layout.y(v) : T + (layout.height - T - B) / 2;
    return { x: layout.x(i) - 3, y: cy - 3, w: 6, h: 6 };
  };

  const tipFor = (i: number): ChartTip | null => {
    const s = series[i];
    if (!s) return null;
    const rows: ChartTipRow[] = [
      { name: qName, value: `${fmtRateOrGap(s.q)}${uclPart(s.qUcl)}`, mark: 'ink' },
    ];
    if (weight) rows.push({ name: W.rejects.weightKind, value: `${fmtRateOrGap(s.w)}${uclPart(s.wUcl)}`, mark: 'dashed' });
    rows.push({ name: '', value: `${fmtInt(s.produced)} cones weighed` });
    const context: string[] = [];
    if (s.qOut || s.wOut) context.push(W.rejectsMore.aboveUsual);
    return { heading: labelFmt(s.ts), rows, context };
  };

  const brushProp: ChartFrameBrush | undefined = onSelect
    ? {
        xs: series.map((_, i) => (layoutRef.current ?? fallbackLayout()).x(i)),
        onCommit: (i0: number, i1: number) => {
          const d0 = series[i0]!.ts.slice(0, 10);
          const d1 = series[i1]!.ts.slice(0, 10);
          const r0 = dayToShiftRange(d0, d0);
          const r1 = dayToShiftRange(d1, d1);
          const snapped = snapToShifts(r0.from, r1.to);
          if (snapped) onSelect(snapped);
        },
      }
    : undefined;

  const brushLabel = onSelect
    ? (i0: number, i1: number): string => {
        const d0 = series[i0]!.ts.slice(0, 10);
        const d1 = series[i1]!.ts.slice(0, 10);
        const r0 = dayToShiftRange(d0, d0);
        const r1 = dayToShiftRange(d1, d1);
        return describePeriod({
          key: 'range', from: r0.from.date, to: r1.to.date, tsTo: '',
          fromShift: r0.from, toShift: r1.to, live: false, days: 0,
        });
      }
    : undefined;

  return (
    <ChartFrame
      chartId="reject-trend"
      defaultH={H}
      ariaLabel={ariaLabel}
      resting={periodFrom != null ? `${series.length} days · the shaded band is the selected period` : `${series.length} days`}
      caption={captionRange ? W.chart.limitsOverPeriod(captionRange) : undefined}
      hit={hit}
      count={series.length}
      tipFor={tipFor}
      markRect={markRect}
      brush={brushProp}
      brushLabel={brushLabel}
    >
      {(fsize) => {
        const layout = computeLayout(fsize.width, fsize.height);
        layoutRef.current = layout;
        const { x, y } = layout;
        const bandPath = (run: number[]) => {
          const upper = run.map((i) => ({ x: x(i), y: y(series[i]!.qUcl!) }));
          const lower = [...run].reverse().map((i) => ({ x: x(i), y: y(series[i]!.qLcl ?? 0) }));
          return `${linePath(upper)} L ${lower.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
        };
        const wCeiling = series.map((s, i) => (s.wUcl == null ? null : { x: x(i), y: y(s.wUcl) }));
        // How many day labels actually FIT. Four were hardcoded, which
        // collided the moment this chart moved into a half-width column:
        // "Wed 26 Aug" printed on top of "Sat 29 Aug".
        const ticks = tickIndices(series.length, fittingTicks(fsize.width - L - R, 11, fsize.fontPx, series.length, 4));
        // The two end labels ("Quality x%", "Weight y%") de-collide
        // vertically via the same pure helper every other chart uses, rather
        // than being drawn at their literal y and left to overprint each
        // other when the two rates land close together.
        const endItems: GutterLabelIn[] = [];
        if (lastQIdx != null) endItems.push({ y: y(series[lastQIdx]!.q!), text: `${qName} ${series[lastQIdx]!.q!.toFixed(1)}%`, prio: 1 });
        if (weight && lastWIdx != null) endItems.push({ y: y(series[lastWIdx]!.w!), text: `${W.rejects.weightKind} ${series[lastWIdx]!.w!.toFixed(1)}%`, prio: 0 });
        // `lineH` must come from the MEASURED font size, not a guessed
        // constant: a fixed `14` under-stated the real line box whenever
        // `fsize.fontPx` scaled above ~10.7px (the Wall's 1.3x UI scale,
        // 13 * 1.3 = 16.9px, among others), so two close end values ("quality
        // X.X%" / "weight X.X%") were placed less than one true text line
        // apart and overlapped. `* 1.3` is the same line-height multiplier
        // `RefLineGutterProvider` already uses for the identical problem.
        const lineH = fsize.fontPx * 1.3;
        const endLabels = placeGutterLabels(endItems, { top: T, bottom: fsize.height - B, lineH });
        let endIdxCursor = 0;
        const qEndLabel = lastQIdx != null ? endLabels[endIdxCursor++] ?? null : null;
        const wEndLabel = weight && lastWIdx != null ? endLabels[endIdxCursor++] ?? null : null;

        return (
          <svg className="chart" viewBox={`0 0 ${fsize.width} ${fsize.height}`} height={fsize.height} role="img" aria-label={ariaLabel}>
            {firstIn >= 0 && (
              <rect x={x(firstIn) - 4} y={T} width={Math.max(8, x(lastIn) - x(firstIn) + 8)} height={fsize.height - T - B} fill="var(--paper-2)" />
            )}
            {grid.map((v) => (
              <g key={v}>
                <line x1={L} x2={fsize.width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
                <text x={L - 8} y={y(v) + 4} fontSize={fsize.fontPx} fill="var(--muted)" textAnchor="end">{v}%</text>
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
            {/* Rendered at the SAME fontPx the lineH above was measured
                from — the old `var(--fs-small)` CSS size did not necessarily
                match the fixed `14` the layout math assumed, which is the
                other half of why the two labels could still land closer than
                a real line apart. */}
            {lastQIdx != null && qEndLabel?.text && (
              <text x={fsize.width - R + 10} y={qEndLabel.y + 4} fontSize={fsize.fontPx} fill="var(--ink)">
                {qName} {series[lastQIdx]!.q!.toFixed(1)}%
              </text>
            )}
            {weight && lastWIdx != null && wEndLabel?.text && (
              <text x={fsize.width - R + 10} y={wEndLabel.y + 4} fontSize={fsize.fontPx} fill="var(--graphite)">
                {W.rejects.weightKind} {series[lastWIdx]!.w!.toFixed(1)}%
              </text>
            )}
            {ticks.map((i) => (
              <text key={`t${i}`} x={x(i)} y={fsize.height - 8} fontSize={fsize.fontPx} fill="var(--muted)" textAnchor={edgeAnchor(i, series.length)}>
                {labelFmt(series[i]!.ts)}
              </text>
            ))}
          </svg>
        );
      }}
    </ChartFrame>
  );
}
