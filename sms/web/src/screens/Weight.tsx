/**
 * Weight — "Are the cones at the right weight, and does any station's scale
 * need attention?"
 *
 * One screen where there were three (Spread, Stability, Calibration), and the
 * one the audit named as most guilty of IFL's charge: a single useful finding
 * buried under a tolerance picker, three export buttons, a provisional
 * tonnes-per-year figure inside its own disclaimer box, and two paragraphs of
 * self-explanation.
 *
 * THE CORRECTIONS BOTH CRITICS INSISTED ON, all visible here:
 *
 *  - THE TIME CHART IS PRIMARY. A distribution tells you the spread; it cannot
 *    tell you that weight stepped up at 09:40 after a doff, which is the thing
 *    an engineer fixes during a shift. Distribution is the second position on
 *    a toggle, not the default, and the control chart is not buried in a
 *    disclosure.
 *  - THE HEADLINE DOES NOT STATE A DIFFERENCE UNTIL THE BASIS IS CONFIRMED.
 *    If the recorded weight and the product setpoint are stated on opposite
 *    bases, the comparison is out by a whole tube. Until Setup says which,
 *    the mean and the target are two facts side by side, not a finding.
 *  - THE STATION TABLE SHOWS BOTH BIASES. Against the line AND against the
 *    target, because a line running twelve grams heavy everywhere reads "Fine"
 *    on all fourteen rows if you only show the first.
 *  - NO "REDUCE BY 9 G". Weighing data cannot tell a heavy scale from heavy
 *    cones. The row says what was measured and stops.
 *  - THE DRIFT WINDOW IS FIXED. Fourteen production days, whatever the period
 *    is set to, and the table says so.
 */
import { useState } from 'react';
import { usePolling } from '../lib/live';
import { W } from '../lib/words';
import { TRAILING_DAYS, type Period } from '../lib/period';
import {
  Block, Chevron, Details, Empty, Failed, rowKeys, Toggle,
  SkelChart, SkelFigures, SkelLines,
} from '../ui/bits';
import { Readout, useChartWidth, edgeAnchor, RefLine, linePath, niceDomain, fittingTicks, tickIndices } from '../ui/chart';
import { fmtG, fmtInt, fmtPct1 } from '../lib/fmt';
import {
  getSpc, getWeightStations, getStations, getProduction, stationLabel,
  type SpcData, type StationRow, type WeightStationRow, type WeightStationsData,
} from '../api';

export function WeightScreen({
  period,
  onOpenStation,
  onSeeOutside,
}: {
  period: Period;
  onOpenStation: (station: number) => void;
  onSeeOutside: () => void;
}) {
  const [mode, setMode] = useState<'time' | 'dist'>('time');

  const st = usePolling(
    () =>
      getWeightStations({
        trailingDays: TRAILING_DAYS,
        periodFrom: period.from,
        periodTo: period.to,
        shift: period.shift,
      }),
    5 * 60_000,
    `wstations:${period.from}:${period.to}:${period.shift ?? 'all'}`,
  );

  // The product is passed so the chart can draw the LIMITS, not just the
  // target: without it /api/spc has no spec and the chart shows a line with
  // nothing to judge it against.
  const productId = st.data?.data.productId ?? null;
  const spc = usePolling(
    () =>
      getSpc({
        type: 'cone',
        from: period.from,
        to: period.to,
        shift: period.shift ?? undefined,
        productId: productId ?? undefined,
      }),
    period.live ? 60_000 : 5 * 60_000,
    `spc:${period.from}:${period.to}:${period.shift ?? 'all'}:${productId ?? 'none'}`,
  );

  const names = usePolling(() => getStations(), 10 * 60_000, 'stations');

  // The share the SCALE rejected, taken from the register rather than derived
  // from the control chart: the chart excludes implausible readings, and this
  // figure has to agree with the count the Readings screen shows.
  const prod = usePolling(
    () => getProduction({ from: period.from, to: period.to, shift: period.shift, groupBy: 'none' }),
    period.live ? 60_000 : 5 * 60_000,
    `prod:${period.from}:${period.to}:${period.shift ?? 'all'}`,
  );

  if (st.error && !st.data) return <Failed error={st.error} onRetry={st.refresh} />;
  // Not a bare spinner: the screen's own shape, at its own heights, so nothing
  // moves when the figures and the table arrive.
  if (!st.data) return <ScreenSkeleton question={W.question.weight} figures={3} table={8} />;
  const d = st.data.data;
  const s = spc.data?.data ?? null;

  return (
    <>
      <div className="page">
        <p className="q">{W.question.weight}</p>
        <h1 className="wide">{headline(d, s)}</h1>
      </div>

      <Block first>
        <div className="figs">
          <div>
            <b className="fig-val">
              {/* count === 0, not just `!s`: an empty period comes back as a
                  real SpcData with mean 0, which printed a confident "0 g
                  average" for a period in which nothing was weighed. */}
              {s && s.count > 0 ? fmtInt(Math.round(s.mean)) : '—'}
              <span className="fig-unit">{W.fig.gAverage}</span>
            </b>
            <span className="fig-note">
              {d.targetG != null ? `product target ${fmtG(d.targetG)}` : W.weight.noTarget}
            </span>
          </div>
          <div>
            <b className="fig-val">{rejectedShare(prod.data?.data.rows?.[0]?.conesInRangePct ?? null)}</b>
            <span className="fig-note">rejected by the scale</span>
          </div>
          <div>
            <b className="fig-val small">
              {s && s.count > 0
                ? W.weight.spread(fmtInt(Math.round(s.mean - 2 * s.stdevOverall)), fmtInt(Math.round(s.mean + 2 * s.stdevOverall)))
                : '—'}
            </b>
            <span className="fig-note">{W.weight.spreadNote}</span>
          </div>
        </div>
      </Block>

      {/* The disagreement, on the surface and only when it is not zero. */}
      {d.disagreement.passedButOutside > 0 && (
        <Block tight plain>
          <span className="acc">{W.disagreement(d.disagreement.passedButOutside)}</span>{' '}
          <button type="button" className="linkish" onClick={onSeeOutside}>{W.seeThem}</button>
        </Block>
      )}

      <Block>
        <div className="row between" style={{ marginBottom: 12 }}>
          <Toggle
            label="Chart"
            value={mode}
            onChange={setMode}
            options={[
              { key: 'time', label: W.weight.overTime },
              { key: 'dist', label: W.weight.distribution },
            ]}
          />
        </div>
        {spc.error && !s ? (
          // Finding H14 (Sep 2026 audit): this used to fall through to
          // "Nothing recorded in this period" on a fetch failure — a false
          // claim indistinguishable from a genuinely quiet period.
          <Failed error={spc.error} onRetry={spc.refresh} />
        ) : spc.loading && !s ? (
          <SkelChart />
        ) : !s || s.subgroups.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : mode === 'time' ? (
          <OverTime spc={s} target={d.targetG} multiDay={period.from !== period.to} />
        ) : (
          <Distribution spc={s} target={d.targetG} />
        )}
        {/* The limit lines are one version of the product's tolerance — the
            one in force at the end of the period. When the tolerance changed
            inside the period, say so; the dashed lines then did not apply to
            every point, and a reader judging last week's cones by this
            week's limits is the error the versioned history exists to end. */}
        {s && s.spec.source === 'product' && (s.spec.limitsChangedInPeriod ?? 0) > 0 && (
          <p className="mut sm" style={{ marginTop: 10 }}>
            {W.weight.limitsChanged(s.spec.limitsChangedInPeriod!)}
          </p>
        )}
      </Block>

      <Block
        label={`${W.weight.stationsTable}, ${W.judgedOver(d.days)}`}
        note={d.targetG != null ? W.weight.sortNote : W.weight.sortNoteNoTarget}
      >
        <div className="tw">
          <StationTable rows={d.stations} data={d} names={names.data?.stations ?? []} onOpen={onOpenStation} />
        </div>
      </Block>

      <div className="page">
      <Details>
        <p>
          A station is flagged when it has held one side of the line by at least {fmtG(d.thresholdG)} for{' '}
          {d.minDaysHeld} production days or more and the pattern test has fired inside that run. The threshold is a
          tenth of the product&apos;s tolerance when one is recorded.
        </p>
        {s && (
          <p>
            Over this period: {fmtInt(s.count)} cones, mean {fmtG(s.mean)}, standard deviation{' '}
            {s.stdevOverall.toFixed(2)} g overall and {s.stdevWithin.toFixed(2)} g within{' '}
            {s.bucketLabel} groups. {s.xbarOutOfControl} group averages fell outside the control band and{' '}
            {s.nelsonFlagged} carried a non-random pattern.
            {s.capability.cpk != null && ` Cp ${s.capability.cp?.toFixed(2)}, Cpk ${s.capability.cpk.toFixed(2)}.`}
          </p>
        )}
        <p>
          Scale against product over this period: {fmtInt(d.disagreement.passedButOutside)} passed by the scale but
          outside the product&apos;s limits, {fmtInt(d.disagreement.rejectedButInside)} rejected by the scale but
          inside them, out of {fmtInt(d.disagreement.judged)} judged.
          {d.disagreement.unjudged > 0 &&
            ` ${fmtInt(d.disagreement.unjudged)} could not be judged because no product was recorded at the time.`}
        </p>
      </Details>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- headline */

function headline(d: WeightStationsData, s: SpcData | null): string {
  // `s` is non-null but EMPTY for a period that holds no readings: /api/spc
  // answers with count 0 and mean 0 rather than with nothing at all, so `!s`
  // alone only ever catches loading and error. Without the count check this
  // headline stated "Average cone weight is 0 g" and "Every station is
  // steady" about a period in which nothing was weighed — three false
  // sentences, and the honest one below was unreachable.
  if (!s || s.count === 0) return 'No cones were weighed in this period.';
  const mean = fmtG(s.mean);
  const need = d.stations.filter((x) => x.flagged).length;
  const tail = need === 0 ? W.weight.allStationsSteady : W.weight.stationsNeedLook(need);
  if (d.targetG == null) return `${W.weight.headlineNoTarget(mean)} ${tail}`;
  // Until the weight basis is confirmed the difference is not stated as a
  // finding — see the file header.
  return `${W.weight.headlineUnconfirmed(mean, fmtG(d.targetG))} ${tail}`;
}

/** The complement of the in-range share, to one decimal. */
function rejectedShare(inRangePct: number | null): string {
  // fmtPct1, so this tile reads "2.0%" like the station table and the sheet
  // beside it rather than dropping the zero to "2%".
  return inRangePct == null ? '—' : fmtPct1(100 - inRangePct);
}

/* ----------------------------------------------------------------- charts */

/**
 * Axis labels carry the day as soon as the window spans more than one.
 *
 * Without this a week of half-hour groups labels four ticks "06:00", "08:00",
 * "10:00", "10:00" — two of them identical and none of them saying which day.
 */
function tickLabel(ts: string, multiDay: boolean): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  if (!multiDay) return time;
  return `${d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })} ${time}`;
}

function OverTime({ spc, target, multiDay }: { spc: SpcData; target: number | null; multiDay: boolean }) {
  const [box, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const L = 8;
  const R = 150;
  const T = 16;
  const B = 30;

  const g = spc.subgroups;
  const values = g.map((x) => x.mean);
  const marks = [target, spc.spec.usl, spc.spec.lsl].filter((v): v is number => v != null);
  const [lo, hi] = niceDomain([...values, ...marks], { pad: 0.15 });
  const x = (i: number) => L + (i / Math.max(1, g.length - 1)) * (width - L - R);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);

  // Width-aware for the same reason as Rejects: a multi-day window labels
  // ticks "2 Sept 06:00", which is twice as wide as a bare time.
  const ticks = tickIndices(g.length, fittingTicks(width - L - R, multiDay ? 13 : 6, 13, g.length, 4));
  const h = hover != null ? g[hover] : null;

  return (
    <div ref={box}>
      <Readout
        hovered={
          h
            ? `${tickLabel(h.ts, multiDay)} · ${fmtG(h.mean)}, the average of ${fmtInt(h.n)} cones${h.nelson.length ? ' · non-random pattern' : ''}`
            : null
        }
        resting={`${g.length} groups of about ${fmtInt(Math.round(spc.count / Math.max(1, g.length)))} cones`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label="Average cone weight over time"
           onMouseLeave={() => setHover(null)}>
        {spc.spec.usl != null && <RefLine y={y(spc.spec.usl)} x1={L} x2={width - R} label={`upper limit ${fmtG(spc.spec.usl)}`} dashed />}
        {target != null && <RefLine y={y(target)} x1={L} x2={width - R} label={`target ${fmtG(target)}`} tone="ink" />}
        {spc.spec.lsl != null && <RefLine y={y(spc.spec.lsl)} x1={L} x2={width - R} label={`lower limit ${fmtG(spc.spec.lsl)}`} dashed />}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--rule-2)" />}
        <path d={linePath(g.map((p, i) => ({ x: x(i), y: y(p.mean) })))} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
        {g.map((p, i) =>
          p.nelson.length > 0 || p.xViolates ? <circle key={i} cx={x(i)} cy={y(p.mean)} r={4} fill="var(--acc-fill)" /> : null,
        )}
        {g.map((_, i) => (
          <rect key={`h${i}`} className="hit" x={x(i) - (width - L - R) / Math.max(1, g.length) / 2}
                y={T} width={(width - L - R) / Math.max(1, g.length)} height={H - T - B}
                onMouseEnter={() => setHover(i)} />
        ))}
        {ticks.map((i) => (
          <text key={`t${i}`} x={x(i)} y={H - 8} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor={edgeAnchor(i, g.length)}>
            {tickLabel(g[i]!.ts, multiDay)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * The band above the plot that the three reference labels hang in.
 *
 * They used to be drawn INSIDE the plot, on the same baseline a bar can reach,
 * so whether "target 1,960 g" was readable depended on that day's bin heights.
 * Nothing may share a line with the data marks.
 */
const REF_BAND = 22;

function Distribution({ spc, target }: { spc: SpcData; target: number | null }) {
  const [box, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const L = 8;
  const R = 150;
  const T = 16 + REF_BAND;
  const B = 30;

  const bins = spc.histogram;
  if (bins.length === 0) return <Empty message={W.nothingHere} />;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const slot = (width - L - R) / bins.length;
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);
  const cx = (i: number) => L + slot * i + slot / 2;
  const xOf = (weight: number) => {
    const i = bins.findIndex((b) => weight >= b.start && weight < b.end);
    return i >= 0 ? cx(i) : null;
  };
  const outside = (b: { start: number; end: number }) =>
    (spc.spec.lsl != null && b.end <= spc.spec.lsl) || (spc.spec.usl != null && b.start >= spc.spec.usl);

  const h = hover != null ? bins[hover] : null;

  return (
    <div ref={box}>
      <Readout
        hovered={h ? `${fmtG(h.start)} to ${fmtG(h.end)} · ${fmtInt(h.count)} cones` : null}
        resting={`${fmtInt(spc.count)} cones, ${fmtG(bins[0]!.start)} to ${fmtG(bins[bins.length - 1]!.end)}`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label="Cone weight distribution"
           onMouseLeave={() => setHover(null)}>
        {bins.map((b, i) => (
          <rect key={i} x={cx(i) - slot * 0.42} y={y(b.count)} width={slot * 0.84}
                height={Math.max(0, H - B - y(b.count))}
                fill={outside(b) ? 'var(--acc-fill)' : hover === i ? 'var(--ink)' : 'var(--graphite)'}
                onMouseEnter={() => setHover(i)} />
        ))}
        {/* The rule runs the height of the plot; its label hangs in the band
            ABOVE it. The lower limit reads back toward its own rule so it
            cannot collide with the target label beside it. */}
        {[['lower limit', spc.spec.lsl], ['target', target], ['upper limit', spc.spec.usl]].map(([label, v]) =>
          typeof v === 'number' && xOf(v) != null ? (
            <g key={String(label)}>
              <line x1={xOf(v)!} x2={xOf(v)!} y1={T} y2={H - B} stroke={label === 'target' ? 'var(--graphite)' : 'var(--grid)'}
                    strokeDasharray={label === 'target' ? undefined : '3 3'} />
              <text
                x={label === 'lower limit' ? xOf(v)! - 5 : xOf(v)! + 5}
                y={T - 8}
                textAnchor={label === 'lower limit' ? 'end' : 'start'}
                fontSize="var(--fs-tick)"
                fill="var(--muted)"
              >
                {label} {fmtG(v)}
              </text>
            </g>
          ) : null,
        )}
        <line x1={L} x2={width - R} y1={H - B} y2={H - B} stroke="var(--rule-2)" />
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------- station table */

function StationTable({
  rows,
  data,
  names,
  onOpen,
}: {
  rows: WeightStationRow[];
  data: WeightStationsData;
  names: StationRow[];
  onOpen: (station: number) => void;
}) {
  if (rows.length === 0) return <Empty message={W.nothingHere} />;
  const byId = new Map(names.map((n) => [n.stationId, n]));
  // A rounded zero must not print as "−0 g", which reads as a measurement
  // that is very slightly negative rather than as no difference at all.
  const signed = (v: number | null) => {
    if (v == null) return '—';
    const g = fmtG(Math.abs(v));
    if (Math.round(v) === 0) return g;
    return `${v > 0 ? '+' : '−'}${g}`;
  };

  return (
    <table>
      <thead>
        <tr>
          <th>{W.weight.colStation}</th>
          <th className="n">{W.weight.colAverage}</th>
          <th className="n">{W.weight.colVsLine}</th>
          <th className="n">{W.weight.colVsTarget}</th>
          <th style={{ paddingLeft: 28 }}>{W.weight.colPattern}</th>
          <th className="n">{W.weight.colRejects}</th>
          <th style={{ paddingLeft: 28 }}>{W.weight.colShows}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.station}
            className="click"
            tabIndex={0}
            onClick={() => onOpen(r.station)}
            onKeyDown={rowKeys(() => onOpen(r.station))}
          >
            <td className={r.flagged ? 'acc' : ''} style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
              {stationLabel(byId.get(r.station), r.station)}
              <Chevron label={W.openRecord} />
            </td>
            <td className="n">{fmtG(r.meanG)}</td>
            <td className="n">{signed(r.vsLineG)}</td>
            <td className="n">{signed(r.vsTargetG)}</td>
            <td style={{ paddingLeft: 28, whiteSpace: 'nowrap' }} className={r.flagged ? 'acc' : ''}>
              {r.flagged ? `${r.daysHeld} days` : '—'}
            </td>
            <td className="n">{r.rejectRatePct == null ? '—' : `${r.rejectRatePct.toFixed(1)}%`}</td>
            <td style={{ paddingLeft: 28 }}>{verdict(r, data)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What the data shows, and nothing beyond it. */
function verdict(r: WeightStationRow, d: WeightStationsData): string {
  if (r.lastAdjustedUtc && !r.flagged) {
    // Date.now() is correct HERE and almost nowhere else on this screen:
    // lastAdjustedUtc is an app-written instant in genuine UTC, not a
    // production timestamp on the plant's wall clock. See plantClock.ts.
    const days = Math.max(
      0,
      Math.floor((Date.now() - new Date(r.lastAdjustedUtc).getTime()) / 86_400_000),
    );
    return W.weight.adjustedSince(W.weight.adjustedSpan(days));
  }
  if (!r.flagged) return W.weight.steady;
  const g = fmtG(Math.abs(r.vsLineG));
  return r.vsLineG > 0 ? W.weight.readsHeavier(g, r.daysHeld) : W.weight.readsLighter(g, r.daysHeld);
}

/**
 * The screen's own shape while it loads: the question, a headline-sized bar,
 * the figure row, the chart and the table, each at its real height. A spinner
 * reserves nothing, so the page jumps twice as the two requests land.
 */
function ScreenSkeleton({ question, figures, table }: { question: string; figures: number; table: number }) {
  return (
    <>
      <div className="page">
        <p className="q">{question}</p>
        <div className="skel line" style={{ height: 'var(--fs-head)', maxWidth: '34ch' }} />
      </div>
      <Block first>
        <SkelFigures n={figures} />
      </Block>
      <Block>
        <SkelChart />
      </Block>
      <Block label={W.weight.stationsTable}>
        <SkelLines n={table} />
      </Block>
    </>
  );
}