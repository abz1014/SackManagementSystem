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
import { useRef, useState } from 'react';
import { usePolling } from '../lib/live';
import { W } from '../lib/words';
import { TRAILING_DAYS, describePeriod, snapToShifts, type Period, type PeriodParams, type ShiftRef } from '../lib/period';
import {
  Block, Chevron, Details, Empty, Failed, rowKeys, Toggle,
  SkelChart, SkelFigures, SkelLines,
} from '../ui/bits';
import { edgeAnchor, linePath, linear, niceDomain, fittingTicks, tickIndices } from '../ui/chart';
import { ChartFrame, type ChartTip, type ChartTipRow } from '../ui/ChartFrame';
import { placeGutterLabels, placeTip, packRow, textPx, bandHit, nearestIndex, type Rect } from '../ui/chartLayout';
import { fmtAppInstant, fmtG, fmtInt, fmtKg, fmtPct1 } from '../lib/fmt';
import {
  getSpc, getWeightStations, getStations, getProduction, stationLabel, NELSON_RULE_LABEL,
  type SpcData, type SpcType, type StationRow, type Subgroup, type WeightStationRow, type WeightStationsData,
} from '../api';

/** Roadmap Phase 2b (16 Sep 2026): the chart toggle, in the URL as `wm`. */
export type WeightMode = 'time' | 'dist';

/**
 * F6 (23 Sep 2026). `spc.ts` withholds the USL/LSL band, Cp/Cpk and the
 * scale-against-product agreement when the only limits version on record
 * begins AFTER the period ended, and sends the reason as
 * `SpecLimits.limitsOmittedReason`. Read loosely rather than through api.ts's
 * `SpecLimits`: api.ts is being edited by another worker today and a field
 * added there would have travelled into this commit. The field belongs on
 * that interface as soon as the tree settles — reported, not forgotten.
 */
function specOmittedReason(spec: SpcData['spec']): string | null {
  const r = (spec as { limitsOmittedReason?: string }).limitsOmittedReason;
  return typeof r === 'string' && r.length > 0 ? r : null;
}

export function WeightScreen({
  period,
  mode,
  onModeChange,
  chartType,
  onChartTypeChange,
  chartStation,
  onChartStationChange,
  onOpenStation,
  onSeeOutside,
  onSelectPeriod,
}: {
  period: Period;
  mode: WeightMode;
  onModeChange: (m: WeightMode) => void;
  /**
   * UX Phase 5 Brief 3 unit U6 (16 Sep 2026), URL key `wt`, default `cone`:
   * the chart's own population. spc.ts deliberately returns `source:'none'`
   * for sacks — the product setpoint is a CONE weight in grams, a sack
   * weight is kilograms, so no tolerance ever applies to a sack chart. The
   * headline, the three figures above and the station table below stay
   * cone-only regardless of this toggle — see the note printed under the
   * chart when `chartType === 'sack'`.
   */
  chartType: SpcType;
  onChartTypeChange: (v: SpcType) => void;
  /**
   * One station's stream, or the whole line (roadmap Phase 4, 14 Sep 2026).
   * The chart only: the figures above it and the station table below stay
   * line-wide, so the selector cannot make the headline describe one scale.
   * SHARED with Readings, Report and Rejects (Phase 2b) — see App.tsx's
   * Route note: it is the same "which station" a link should carry between
   * them, not a Weight-only value. Sacks carry no station column at all
   * (CLAUDE.md), so it is ignored while `chartType === 'sack'`.
   */
  chartStation: number | null;
  onChartStationChange: (v: number | null) => void;
  onOpenStation: (station: number) => void;
  onSeeOutside: () => void;
  /**
   * Chart overhaul wave 3, Task T6 (29 Sep 2026). Drag-select on the OverTime
   * chart snaps the WHOLE PAGE period to shift boundaries
   * (`lib/period.ts`'s `snapToShifts`) and hands the result here, the same
   * `onSelectPeriod?` contract `StationSheet.tsx`'s `DailyMeans` already
   * uses. **Not yet wired in `App.tsx`** — that file belongs to Task T8a
   * today; wiring it there is `go({ period: p })`, the same setter
   * `StationSheet`'s own (currently unwired) `onSelectPeriod` would use.
   * Optional so every existing caller keeps compiling unchanged until T8
   * wires it.
   */
  onSelectPeriod?: (p: PeriodParams) => void;
}) {

  const st = usePolling(
    () =>
      getWeightStations({
        trailingDays: TRAILING_DAYS,
        // Finding H4, 15 Sep 2026: `to` anchors the fixed 14-day detector
        // window on the SELECTED period's end, not on the newest production
        // day (the server's old default). Without it, picking June or July
        // still resolved the product and its limits at today's instant, so
        // the dashed USL/LSL lines and Cp/Cpk described September's material
        // against June's readings — violating ONE STATUS VOCABULARY (a
        // reading is judged by the limits in force at its own time) and
        // THE DETECTORS IGNORE THE PERIOD (fixed LENGTH, not a fixed anchor).
        // Deliberately no `from` here: the server derives it from
        // `trailingDays` (mirroring `trailingWindow` in lib/period.ts), so
        // the 14-day rule has exactly one definition, not one on each side.
        to: period.to,
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
  // ALWAYS cone, line-wide: feeds the headline and the three figures, which
  // stay cone-only no matter what the chart toggle below is set to (UX Phase
  // 5 Brief 3 unit U6, 16 Sep 2026) — a sack chart's own mean is grams-vs-
  // kilograms nonsense sitting under a headline about cones if this and the
  // chart's own query below were ever the same call.
  const coneLine = usePolling(
    () =>
      getSpc({
        type: 'cone',
        from: period.from,
        to: period.to,
        shift: period.shift ?? undefined,
        productId: productId ?? undefined,
      }),
    period.live ? 60_000 : 5 * 60_000,
    `spc-cone:${period.from}:${period.to}:${period.shift ?? 'all'}:${productId ?? 'none'}`,
  );
  // The CHART's own population — follows `chartType`. For 'cone' with no
  // station chosen this duplicates `coneLine` above; the two are kept as
  // separate calls (rather than one shared for both purposes) so a future
  // change to either never has to worry about the other's contract. Never
  // sent a productId for a sack chart: spc.ts returns source:'none' for
  // sacks regardless, and a cone product id beside a sack request would
  // misleadingly imply one was consulted.
  const spc = usePolling(
    () =>
      getSpc({
        type: chartType,
        from: period.from,
        to: period.to,
        shift: period.shift ?? undefined,
        productId: chartType === 'cone' ? (productId ?? undefined) : undefined,
      }),
    period.live ? 60_000 : 5 * 60_000,
    `spc:${chartType}:${period.from}:${period.to}:${period.shift ?? 'all'}:${productId ?? 'none'}`,
  );
  // One station's stream for the chart (Phase 4), cone only: sack1_TP1U2
  // carries no station/machine column, so there is nothing to select a
  // station's stream from when chartType is 'sack'.
  const stationSpc = usePolling(
    () =>
      chartType !== 'cone' || chartStation == null
        ? Promise.resolve(null)
        : getSpc({
            type: 'cone',
            from: period.from,
            to: period.to,
            shift: period.shift ?? undefined,
            productId: productId ?? undefined,
            station: chartStation,
          }),
    period.live ? 60_000 : 5 * 60_000,
    `spc-station:${chartType}:${period.from}:${period.to}:${period.shift ?? 'all'}:${productId ?? 'none'}:${chartStation ?? 'none'}`,
  );

  const names = usePolling(() => getStations(), 10 * 60_000, 'stations');

  // The share the SCALE rejected, taken from the register rather than derived
  // from the control chart: the chart excludes implausible readings, and this
  // figure has to agree with the count the Readings screen shows.
  // `tsTo` since roadmap Phase 8 (15 Sep 2026, gap analysis §10): without
  // it this count covered the whole shift under a replay (?at=) while Line
  // and Wall stopped at the replay instant, so the same shift read two
  // different reject counts on two screens. The key carries it too, or a
  // replay moved to a new instant would keep the old answer.
  const prod = usePolling(
    () => getProduction({ from: period.from, to: period.to, shift: period.shift, tsTo: period.tsTo, groupBy: 'none' }),
    period.live ? 60_000 : 5 * 60_000,
    `prod:${period.from}:${period.to}:${period.shift ?? 'all'}:${period.tsTo}`,
  );

  // UX Phase 7 Brief 5 (21 Sep 2026): `st` used to gate the WHOLE screen —
  // `if (st.error && !st.data) return <Failed/>` returned before the chart
  // section below, which is fed by `coneLine`/`spc`/`stationSpc`, three
  // entirely separate fetches. A failed /api/weight-stations therefore blanked
  // a perfectly good chart along with the headline, figures and station table
  // that genuinely depend on it — exactly the "one failure collapses the whole
  // picture" shape the owner's principle forbids. `d` is now nullable and each
  // section below guards on it independently; the chart section never checks
  // it at all.
  if (!st.data && !st.error) return <ScreenSkeleton question={W.question.weight} figures={3} table={8} />;
  const d: WeightStationsData | null = st.data?.data ?? null;
  // `sLine` feeds the headline and the three figures — always cone, always
  // the whole line, from `coneLine` above, never from the chart's own
  // (possibly sack, possibly one-station) query. `s` is what the CHART
  // draws — the station's stream while one is chosen, the line otherwise. A
  // station stream only ever exists for cone (stationSpc is deliberately
  // never fetched for sack, above), so a leftover `st=` from
  // Readings/Rejects/Report cannot make a sack chart read as empty.
  const usingStation = chartType === 'cone' && chartStation != null;
  const sLine = coneLine.data?.data ?? null;
  const s = usingStation ? (stationSpc.data?.data ?? null) : (spc.data?.data ?? null);
  const chartLoading = usingStation ? stationSpc.loading : spc.loading;
  const chartError = usingStation ? stationSpc.error : spc.error;
  const chartRefresh = usingStation ? stationSpc.refresh : spc.refresh;

  return (
    <>
      <div className="page">
        <p className="q">{W.question.weight}</p>
        <h1 className="wide">{headline(d, sLine, coneLine.error, coneLine.loading)}</h1>
      </div>

      <Block first>
        {/* UX Phase 7 Brief 1: coneLine's error was never read here or in the
            headline above, so a FAILED /api/spc fetch fell through to the
            same three dashes a genuinely empty period draws — indistinguishable
            from "nothing was weighed". Same shape Line.tsx uses for `totals`:
            a failed first load replaces the figures with Failed and a retry;
            stale data from a same-key refetch failure (coneLine.error with
            sLine still set, see lib/live.tsx's keepDataAcrossKeyChange) keeps
            showing the last good figures rather than blanking them. */}
        {coneLine.error && !sLine ? (
          <Failed error={coneLine.error} onRetry={coneLine.refresh} />
        ) : (
          <div className="figs">
            <div>
              <b className="fig-val">
                {/* count === 0, not just `!s`: an empty period comes back as a
                    real SpcData with mean 0, which printed a confident "0 g
                    average" for a period in which nothing was weighed. */}
                {sLine && sLine.count > 0 ? fmtInt(Math.round(sLine.mean)) : '—'}
                <span className="fig-unit">{W.fig.gAverage}</span>
              </b>
              <span className="fig-note">
                {/* The median beside the mean (roadmap Phase 9 item 1): the same
                    population, the same period and shift, from the same call. */}
                {sLine && sLine.count > 0 && sLine.median != null ? `${W.calibration.medianNote(fmtG(sLine.median))} · ` : ''}
                {/* UX Phase 5 Brief 3 unit U2 (16 Sep 2026): the bare "product
                    target 1,960 g" carried no product name and no time
                    statement — the same target object the station table below
                    already resolves (targetG/productLabel/targetEffectiveFromUtc,
                    Wave 1's be5ac3e), so the figure and the table can never
                    disagree about which product or which version of its limits
                    is being shown. Same phrasing report/ConeWeight.tsx (U1)
                    uses for the identical fact.
                    UX Phase 7 Brief 5: `d` is now nullable — st.error with no
                    data must read as "unknown", never fall into the same
                    branch as the honest "no target recorded" case below. */}
                {/* F6 (23 Sep 2026): three states, not two. The middle one is
                    new and is the whole point of this pass — the server has
                    WITHHELD the target because the only limits version on
                    record begins after this period ended, and it supplies the
                    reason in words (`targetOmittedReason`). Printing that
                    reason here is what makes this tile agree with the station
                    table below it, whose `vs target` column the server blanked
                    for the same reason and in the same breath. Before this,
                    `d.targetG` was a bare 1,960 g and `targetSince` printed
                    "in force since 11/09/2026" beneath a period ending
                    20/08/2026 — a start date four weeks AFTER the readings it
                    was judging.
                    The lower-bound case keeps its number and is qualified
                    rather than withheld: those limits did apply, only their
                    start is unproven. That is resolvePeriodTarget's own split
                    and this tile follows it rather than inventing a third. */}
                {d == null ? (
                  W.weight.targetUnknown
                ) : d.targetG != null ? (
                  <>
                    {W.reports.target(fmtG(d.targetG), d.productLabel ?? W.reports.wholeLine)}
                    {d.targetEffectiveFromUtc &&
                      ` · ${
                        d.targetEffectiveIsLowerBound
                          ? W.reports.targetNoLaterThan(fmtAppInstant(d.targetEffectiveFromUtc))
                          : W.reports.targetSince(fmtAppInstant(d.targetEffectiveFromUtc))
                      }`}
                    {/* RT-018: the target product may be marked retired in PDAS
                        (no retirement date exists, only this current bit) while
                        readings against it keep arriving — say so beside the
                        figure, not as a silent unflagged number. */}
                    {d.productActive === false && <> · {W.retiredProduct.marker}</>}
                  </>
                ) : d.targetOmittedReason ? (
                  <>
                    {W.weight.noTarget} · {d.targetOmittedReason}
                  </>
                ) : (
                  W.weight.noTarget
                )}
              </span>
            </div>
            <div>
              {/* UX Phase 7 Brief 5 (21 Sep 2026): `prod`'s error was never
                  read anywhere in this file (KNOWN_DEFECTS in
                  reliability.guard.test.ts, tracked by Brief 4) — a failed
                  /api/production fell through to `rejectedShare(null)`,
                  printing the same "—" as a genuinely empty period. Fixed
                  the same shape Brief 1 fixed for `coneLine` two figures to
                  the left: a first-load failure gets its own Failed+retry,
                  confined to this one tile so the other two figures (which
                  do not depend on `prod`) keep showing. */}
              {prod.error && !prod.data ? (
                <Failed error={prod.error} onRetry={prod.refresh} />
              ) : (
                <>
                  <b className="fig-val">{rejectedShare(prod.data?.data.rows?.[0]?.conesInRangePct ?? null)}</b>
                  <span className="fig-note">rejected by the scale</span>
                </>
              )}
            </div>
            <div>
              <b className="fig-val small">
                {sLine && sLine.count > 0
                  ? W.weight.spread(fmtInt(Math.round(sLine.mean - 2 * sLine.stdevOverall)), fmtInt(Math.round(sLine.mean + 2 * sLine.stdevOverall)))
                  : '—'}
              </b>
              <span className="fig-note">{W.weight.spreadNote}</span>
            </div>
          </div>
        )}
      </Block>

      {/* The disagreement, on the surface and only when it is not zero. */}
      {d != null && d.disagreement.passedButOutside > 0 && (
        <Block tight plain>
          <span className="acc">{W.disagreement(d.disagreement.passedButOutside)}</span>{' '}
          <button type="button" className="linkish" onClick={onSeeOutside}>{W.seeThem}</button>
        </Block>
      )}

      <Block>
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="row">
            <Toggle
              label="Chart"
              value={mode}
              onChange={onModeChange}
              options={[
                { key: 'time', label: W.weight.overTime },
                { key: 'dist', label: W.weight.distribution },
              ]}
            />
            {/* UX Phase 5 Brief 3 unit U6 (16 Sep 2026), URL key `wt`: the
                chart's own population, cone or sack. Sacks carry no station
                column (CLAUDE.md), so the station selector beside this one
                only applies to cone and is hidden otherwise. */}
            <Toggle
              label="Weight"
              value={chartType}
              onChange={onChartTypeChange}
              options={[
                { key: 'cone', label: W.readings.cones },
                { key: 'sack', label: W.readings.sacks },
              ]}
            />
          </div>
          {/* The station selector (Phase 4): the chart for one scale's stream. */}
          {chartType === 'cone' && (
            <label className="chip">
              {W.cone.stationSelect}
              <select
                value={chartStation ?? ''}
                aria-label={W.cone.stationSelect}
                onChange={(e) => onChartStationChange(e.target.value === '' ? null : Number(e.target.value))}
                style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
              >
                <option value="">{W.cone.wholeLine}</option>
                {(names.data?.stations ?? []).map((n) => (
                  <option key={n.stationId} value={n.stationId}>
                    {stationLabel(n, n.stationId)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {chartError && !s ? (
          // Finding H14 (Sep 2026 audit): this used to fall through to
          // "Nothing recorded in this period" on a fetch failure — a false
          // claim indistinguishable from a genuinely quiet period.
          <Failed error={chartError} onRetry={chartRefresh} />
        ) : chartLoading && !s ? (
          <SkelChart />
        ) : !s || s.subgroups.length === 0 ? (
          <Empty message={W.nothingHere} />
        ) : mode === 'time' ? (
          // UX Phase 7 Brief 5: `d` can be null on a station-data failure
          // while the chart itself (`s`) is fine — the target/limit lines
          // are simply omitted rather than the whole chart being withheld.
          <OverTime
            spc={s}
            target={chartType === 'cone' ? (d?.targetG ?? null) : null}
            multiDay={period.from !== period.to}
            periodLabel={describePeriod(period)}
            onSelectPeriod={onSelectPeriod}
          />
        ) : (
          <Distribution spc={s} target={chartType === 'cone' ? (d?.targetG ?? null) : null} />
        )}
        {/* The limit lines are one version of the product's tolerance — the
            one in force at the end of the period. When the tolerance changed
            inside the period, say so; the dashed lines then did not apply to
            every point, and a reader judging last week's cones by this
            week's limits is the error the versioned history exists to end.
            Cone only: spc.ts always answers source:'none' for sack. */}
        {s && s.spec.source === 'product' && (s.spec.limitsChangedInPeriod ?? 0) > 0 && (
          <p className="mut sm" style={{ marginTop: 10 }}>
            {W.weight.limitsChanged(s.spec.limitsChangedInPeriod!)}
          </p>
        )}
        {/* F6 (23 Sep 2026): the chart used to draw a USL/LSL band, a Cp/Cpk
            and a scale-against-product agreement from a limits version that
            began AFTER the period ended — on the dev copy, 5-20 Aug was
            judged against limits first recorded on 11 Sep, while the report
            tile and the station table two screens over already refused that
            same target. spc.ts now routes through resolvePeriodTarget and
            withholds all three. This is the only render site that change
            needs, because every product-derived figure on this chart was
            already null-guarded for the no-product case — but a silent blank
            is the reliability defect Phase 7 spent itself eliminating, so the
            service's own sentence is printed here, verbatim, followed by what
            this screen specifically does and does not still stand behind. */}
        {/* Read LOOSELY, off the wire object rather than through `SpecLimits`
            in api.ts, and deliberately so: api.ts carries another worker's
            in-flight change today, and adding a field there would have put
            their unfinished hunks into this commit. The sentence is composed
            server-side (spc.ts's CHART_LIMITS_WITHHELD) and printed verbatim,
            the same route weightStations.ts's targetOmittedReason already
            takes — words.ts became another worker's file mid-task, and the
            brief's own instruction for that case is to report the string
            rather than edit the file. Same loose-read idiom as
            coneWeight.ts's `(w.cone as { median?: number|null }).median`.
            Reported for a one-line follow-up: `limitsOmittedReason?: string`
            belongs on api.ts's own SpecLimits once that file settles. */}
        {s && specOmittedReason(s.spec) && (
          <p className="mut sm" style={{ marginTop: 10 }}>{specOmittedReason(s.spec)}</p>
        )}
        {/* UX Phase 5 Brief 3 unit U6: a sack weight is kilograms and the
            product setpoint is a cone weight in grams, so spc.ts refuses to
            invent a tolerance for it (source:'none' always, spc.ts:202-204).
            State the absence — never a number — and that the headline, the
            three figures above and the station table below stay cone-only,
            so a reader cannot mistake them for describing this chart. */}
        {chartType === 'sack' && (
          <>
            <p className="mut sm" style={{ marginTop: 10 }}>{W.weight.sackNoTarget}</p>
            <p className="mut sm" style={{ marginTop: 4 }}>{W.weight.sackChartOnly}</p>
          </>
        )}
        {/* The population under the chart, stated once: the same count and
            the same exclusion the report and the reconciliation print. */}
        {s && s.count + s.implausible > 0 && (
          <p className="mut sm" style={{ marginTop: 10 }}>
            {W.cone.excludedNote(fmtInt(s.count + s.implausible), fmtInt(s.implausible))}
            {s.station != null ? ` · ${stationLabel(names.data?.stations.find((n) => n.stationId === s.station), s.station)}` : ''}
          </p>
        )}
      </Block>

      <Block
        label={d == null ? W.weight.stationsTable : `${W.weight.stationsTable}, ${W.judgedOver(d.days)}`}
        note={d == null ? null : d.targetG != null ? W.weight.sortNote : W.weight.sortNoteNoTarget}
      >
        {/* UX Phase 7 Brief 5 (21 Sep 2026): this table is entirely `d`'s —
            unlike the chart above, there is no partial content to keep when
            `d` failed to load, so it gets its own Failed+retry rather than
            being folded into the top-of-screen gate that used to blank the
            chart along with it. */}
        {d == null ? (
          <Failed error={st.error} onRetry={st.refresh} />
        ) : (
          <>
            <div className="tw">
              <StationTable rows={d.stations} data={d} names={names.data?.stations ?? []} onOpen={onOpenStation} />
            </div>
            {/* UX Phase 5 Brief 3 unit U2 (16 Sep 2026): the chart's sibling
                qualifiers, previously stopping at the chart (`limitsChanged`
                above) and never printed under the table it equally applies to.
                Both describe the LINE-WIDE target's own history over the window
                — a station on `targetBasis: 'station_material'` is unaffected by
                either, but the table carries no per-row space to say so, and the
                line-wide target is still what a `targetBasis: 'line_product'` or
                'mixed' fallback ultimately traces back to. */}
            {(d.limitsChangedInWindow ?? 0) > 0 && (
              <p className="mut sm" style={{ marginTop: 10 }}>
                {W.weight.limitsChangedTable(d.limitsChangedInWindow!)}
              </p>
            )}
            {d.productChangesInWindow > 0 && (
              <p className="mut sm" style={{ marginTop: 10 }}>
                {W.weight.productChangedTable(d.productChangesInWindow)}
              </p>
            )}
          </>
        )}
      </Block>

      <div className="page">
      <Details>
        {/* UX Phase 7 Brief 5: the threshold rule and the Nelson-rule reach
            below both come from `d`; when it failed to load, say so once
            rather than throw a TypeError on `d.thresholdG`/`d.stations`. */}
        {d == null ? (
          <p>{W.weight.headlineStationDataFailed}</p>
        ) : (
          <>
            <p>
              A station is flagged when it has held one side of the line by at least {fmtG(d.thresholdG)} for{' '}
              {d.minDaysHeld} production days or more and the pattern test has fired inside that run. The threshold is a
              tenth of the product&apos;s tolerance when one is recorded.
            </p>
            {/* Which rules could not have fired on this window's series (roadmap
                Phase 9 item 3): the longest run any station had, against each
                rule's minimum, so an absence of rules 4 and 7 is never read as
                evidence. The station sheet states the same for one station. */}
            {(d.rules ?? []).length > 0 && (() => {
              const longest = Math.max(0, ...d.stations.map((r) => r.longestRun ?? 0));
              const cannot = d.rules.filter((r) => r.minPoints > longest).map((r) => r.id);
              const list = cannot.length === 1 ? `rule ${cannot[0]}` : `rules ${cannot.slice(0, -1).join(', ')} and ${cannot[cannot.length - 1]}`;
              return (
                <p>
                  {cannot.length > 0 ? W.calibration.cannotFire(list, longest) : W.calibration.allCanFire(longest)}{' '}
                  {W.calibration.notApproved}
                </p>
              );
            })()}
          </>
        )}
        {s && (
          <p>
            {/* UX Phase 5 Brief 3 unit U6 (16 Sep 2026): `s` follows the
                chart toggle now, so its population word and its unit (spc.ts's
                own `unit`, 'g' for cones or 'kg' for sacks) must too — this
                used to hardcode "cones" and "g" unconditionally. */}
            {/* DEFECTS.md D-10, restored 23 Sep 2026. The 22 Sep suppression
                removed the s.xbarOutOfControl sentence because the band it
                counted against (X̿ ± 3σ_within/√n) assumed no movement at all
                between groups and flagged 16-38% of them. spc.ts replaced
                that band with an I-MR band on the group averages themselves
                (6052b69), so the count is now a statement about a defensible
                model and comes back — with the band's own basis named in the
                same sentence, because 5.6-13.1% of groups still fall outside
                it on real data and a bare count would read as that many
                crises. s.nelsonFlagged does NOT come back: see
                W.weight.patternsWithheld and this file's OverTime chart. */}
            Over this period: {fmtInt(s.count)} {kindWord(s.unit)}, mean {fmtW(s.mean, s.unit)}
            {s.median != null ? `, median ${fmtW(s.median, s.unit)}` : ''}, standard deviation{' '}
            {s.stdevOverall.toFixed(2)} {s.unit} overall and {s.stdevWithin.toFixed(2)} {s.unit} within{' '}
            {s.bucketLabel} groups.{' '}
            {s.xLimits.valid
              ? W.weight.outsideBand(fmtInt(s.xbarOutOfControl), fmtInt(s.subgroups.length))
              : W.weight.bandInvalid}{' '}
            {W.weight.patternsWithheld}
            {s.capability.cpk != null && ` Cp ${s.capability.cp?.toFixed(2)}, Cpk ${s.capability.cpk.toFixed(2)}.`}
          </p>
        )}
        {/* ONE SOURCE GENERATION (23 Sep 2026). getWeightSpc scopes every
            query to a single generation of the source tables and reports how
            much of the requested period that left out. Excluding the rest is
            right; excluding it silently is not — on a 21 Aug - 15 Sep window
            of the dev copy the chart drew 55,058 of the period's 219,942
            readings and said nothing. */}
        {s && s.spansGenerations && (
          <p>{W.weight.oneGeneration(fmtInt(s.count), fmtInt(s.otherGenerationExcluded))}</p>
        )}
        {d != null && (
          <p>
            Scale against product over this period: {fmtInt(d.disagreement.passedButOutside)} passed by the scale but
            outside the product&apos;s limits, {fmtInt(d.disagreement.rejectedButInside)} rejected by the scale but
            inside them, out of {fmtInt(d.disagreement.judged)} judged.
            {d.disagreement.unjudged > 0 &&
              ` ${fmtInt(d.disagreement.unjudged)} could not be judged because no product was recorded at the time.`}
          </p>
        )}
      </Details>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- headline */

function headline(
  d: WeightStationsData | null,
  s: SpcData | null,
  coneLineError?: string | null,
  coneLineLoading?: boolean,
): string {
  // UX Phase 7 Brief 1: a FAILED /api/spc fetch used to fall through to the
  // `!s` branch below and print "No cones were weighed in this period" — the
  // app asserting an empty plant when the true state is "the request failed
  // and we do not know". The figures block above already swaps to `Failed`
  // with a retry button for the same condition (error, no data at all); this
  // is the same condition's headline. Stale data from a same-key refetch
  // failure (coneLineError set but `s` still holding the last good answer)
  // is not this case — that falls through to the ordinary headline below.
  if (coneLineError && !s) return W.couldNotLoad;
  // DEFECTS.md D-7 (captured 22 Sep 2026, fixed here): `s` reads exactly the
  // same — null, no error — while `coneLine` is genuinely still loading as it
  // does the instant after its poll KEY changes (`usePolling` deliberately
  // clears stale data/error on a key change, `lib/live.tsx`'s
  // `keepDataAcrossKeyChange`, so a refetch for a new question never shows
  // the old question's answer or its error under a new heading). `coneLine`'s
  // own key is `productId`-dependent, and `productId` itself arrives from a
  // SEPARATE fetch (`getWeightStations`, `st` above) — so the moment `st`
  // resolves after `coneLine`'s first attempt has already failed, `coneLine`
  // restarts: for one render `error` and `data` are both null although a real
  // failure was just observed and a real refetch is already in flight. Before
  // this check, that render fell into the `!s` branch below and asserted "No
  // cones were weighed" — a failed fetch reading as an empty plant, the exact
  // defect class UX Phase 7 exists to close, just reached through a race
  // instead of a permanent failure. `loading` is set `true` in the very same
  // state batch that clears `data`/`error` on a key change (`live.tsx`'s
  // effect calls `setData(null); setError(null); ...; setLoading(true)`
  // together before the new fetch starts), so checking it here distinguishes
  // "no answer yet" from "no cones exist" without touching `usePolling`
  // itself or any other of its ~20 consumers.
  if (coneLineLoading && (!s || s.count == null || s.count === 0)) return W.loading;
  // WS-GF (23 Sep 2026 red-team remediation, missingField.fuzz.test.tsx):
  // `s.count` itself missing (a field-stripped response — a valid 200 with a
  // hole in it, not an error and not a genuine zero) used to satisfy neither
  // `!s` nor `s.count === 0`, so it fell all the way through to the
  // confident-mean branch below and stated `s.mean` as if the count that
  // mean is drawn from were known. Caught here, distinct from BOTH the
  // genuine-empty sentence two lines down (a real count of 0) and the
  // confident mean below (a real count) — the one thing unknown is the
  // count itself, so no mean may be printed beside it.
  if (s && s.count == null) return W.weight.countCouldNotRead;
  // `s` is non-null but EMPTY for a period that holds no readings: /api/spc
  // answers with count 0 and mean 0 rather than with nothing at all, so `!s`
  // alone only ever catches loading and error. Without the count check this
  // headline stated "Average cone weight is 0 g" and "Every station is
  // steady" about a period in which nothing was weighed — three false
  // sentences, and the honest one below was unreachable.
  if (!s || s.count === 0) return d == null ? W.weight.headlineStationDataFailed : 'No cones were weighed in this period.';
  const mean = fmtG(s.mean);
  // UX Phase 7 Brief 5 (21 Sep 2026): `d` (getWeightStations) is a separate
  // fetch from `s`/`coneLine` above — the average can be known while the
  // station table and target failed to load, or vice versa. A failed `d`
  // used to blank this whole headline (and the figures and table below it)
  // via a top-of-screen `if (st.error && !st.data) return <Failed/>`; now the
  // average still prints and the missing half is named rather than silently
  // dropped into "Every station is steady" (which the flagged-count check
  // below would otherwise print falsely — an empty `d.stations` array reads
  // identically to "checked every station, none flagged").
  if (d == null) return `Average cone weight is ${mean}. ${W.weight.headlineStationDataFailed}`;
  const need = d.stations.filter((x) => x.flagged).length;
  // "Steady"/"needs a look" is the PATTERN-TEST verdict (weightStations.ts
  // `flagged`), not the on-target verdict `lineOffset` below states — see
  // words.ts's comment on `allStationsSteady` for why the wording now names
  // what question this answers.
  const tail = need === 0 ? W.weight.allStationsSteady : W.weight.stationsNeedLook(need);
  if (d.targetG == null) return `${W.weight.headlineNoTarget(mean)} ${tail}`;
  // Until the weight basis is confirmed the difference is not stated as a
  // finding — see the file header. The target itself still carries its
  // product and the instant its limits took effect (UX Phase 5 Brief 3 unit
  // U2, 16 Sep 2026) — the bare "1,960 g" here used to name neither, so a
  // reader had no way to tell whether it was the same target the station
  // table below was judging against.
  const offset = lineOffsetSentence(d);
  return `${W.weight.headlineUnconfirmed(mean, targetPhrase(d))}${offset ? ` ${offset}` : ''} ${tail}`;
}

/**
 * The line-level counterpart of the per-station `vs target` column (Weight
 * brief item 1, 23 Sep 2026). 132,552 cones × a shared per-station offset is
 * the largest fact in this dataset (~1.2 t/generation at 34 days) and it was
 * never stated once — only restated fourteen times as fourteen small
 * numbers, see `stationsTable` below.
 *
 * Deliberately conservative: returns null (says nothing) unless the data
 * makes the claim safe —
 *  - at least a handful of stations so "all"/"nearly all" means something,
 *  - nearly every station resolved to SOME target (a run of `targetBasis:
 *    'mixed'` rows means several materials are in force and there is no
 *    single line-wide fact to state),
 *  - every included station's own implied target (its mean minus its own
 *    signed `vsTargetG`) agrees to within rounding — 'station_material' rows
 *    can each carry a DIFFERENT material's limits, and this must never
 *    average two products' tolerances into one number,
 *  - nearly all of them sit on the SAME side of that target.
 * If stations disagree, or more than one target is genuinely in force among
 * them, the function returns null and the per-row `vs target` column is left
 * to speak for itself, exactly as the brief requires.
 */
function lineOffsetSentence(d: WeightStationsData): string | null {
  const total = d.stations.length;
  const MIN_STATIONS = 3;
  const COVERAGE_RATIO = 0.85; // nearly all stations must resolve to a target
  const AGREE_RATIO = 0.85; // nearly all of those must sit on the same side
  const TARGET_TOLERANCE_G = 1; // rounding slack for "a single shared target"
  if (total < MIN_STATIONS) return null;

  const rows = d.stations.filter((r) => r.vsTargetG != null);
  if (rows.length / total < COVERAGE_RATIO) return null;

  const impliedTargets = rows.map((r) => r.meanG - (r.vsTargetG as number));
  const minTarget = Math.min(...impliedTargets);
  const maxTarget = Math.max(...impliedTargets);
  if (maxTarget - minTarget > TARGET_TOLERANCE_G) return null; // not one shared target

  const signed = rows.map((r) => r.vsTargetG as number);
  const negative = signed.filter((v) => v < 0).length;
  const positive = signed.filter((v) => v > 0).length;
  const dirNegative = negative >= positive;
  const agreeing = dirNegative ? negative : positive;
  if (agreeing === 0 || agreeing / rows.length < AGREE_RATIO) return null; // stations disagree

  const magnitudes = signed.filter((v) => (dirNegative ? v < 0 : v > 0)).map((v) => Math.abs(v));
  const lo = Math.round(Math.min(...magnitudes));
  const hi = Math.round(Math.max(...magnitudes));
  const target = (minTarget + maxTarget) / 2;

  return W.weight.lineOffset(
    agreeing,
    total,
    fmtInt(lo),
    fmtInt(hi),
    dirNegative ? W.weight.below : W.weight.above,
    fmtG(target),
  );
}

/** "1,960 g (201-IH0-SD), in force since 16/09/2026, 09:00:00" — the target
 *  with its product and the instant its limits took effect, so the headline
 *  and the figure note never state a bare number the station table below
 *  cannot be checked against.
 *
 *  F6 (23 Sep 2026): the SECOND place on this screen that states the period's
 *  target, and it was missed on the first pass of this fix — the figure note
 *  had already been taught to say "no later than" while this sentence, four
 *  lines above it in the same viewport, still said "in force since" about the
 *  same instant. A component test caught it, which is the only reason it is
 *  not in the commit. The rule the whole pass exists for applies here too: a
 *  version the app merely OBSERVED in place has no start date to state. */
function targetPhrase(d: WeightStationsData): string {
  const retired = d.productActive === false ? ` ${W.retiredProduct.marker}` : '';
  const base = `${fmtG(d.targetG)} (${d.productLabel ?? W.reports.wholeLine}${retired})`;
  if (!d.targetEffectiveFromUtc) return base;
  const instant = fmtAppInstant(d.targetEffectiveFromUtc);
  return `${base}, ${d.targetEffectiveIsLowerBound ? W.reports.targetNoLaterThan(instant) : W.reports.targetSince(instant)}`;
}

/** The complement of the in-range share, to one decimal. */
function rejectedShare(inRangePct: number | null): string {
  // fmtPct1, so this tile reads "2.0%" like the station table and the sheet
  // beside it rather than dropping the zero to "2%".
  return inRangePct == null ? '—' : fmtPct1(100 - inRangePct);
}

/* ----------------------------------------------------------------- charts */

/**
 * UX Phase 5 Brief 3 unit U6 (16 Sep 2026): the chart now draws sack weights
 * too (spc.ts's own `unit` field, 'g' | 'kg'), so every value it formats and
 * every population word it prints has to follow the data's own type — a
 * sack mean run through `fmtG` printed "47 g" for a genuinely 47-kilogram
 * average, and "cones" read wrong under a sack chart. `W.readings.cones` /
 * `.sacks` are the only existing plural words for the two populations
 * (lowercased for mid-sentence use); there is no dedicated singular form in
 * words.ts, so the aria-label below spells the two cases out rather than
 * fabricate a new key.
 */
function fmtW(n: number | null | undefined, unit: 'g' | 'kg'): string {
  return unit === 'kg' ? fmtKg(n) : fmtG(n);
}
function kindWord(unit: 'g' | 'kg'): string {
  return unit === 'kg' ? W.readings.sacks.toLowerCase() : W.readings.cones.toLowerCase();
}

/** A signed weight difference, unit-aware — the OverTime tooltip's own "vs
 *  target" row. Same "no −0 g" rule as `StationTable`'s local `signed()`:
 *  a rounded zero must read as no difference, not as a very slightly
 *  negative measurement. */
function signedW(v: number, unit: 'g' | 'kg'): string {
  if (Math.round(v) === 0) return fmtW(Math.abs(v), unit);
  return `${v > 0 ? '+' : '−'}${fmtW(Math.abs(v), unit)}`;
}

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

/**
 * De-collided USL/target/LSL gutter labels for `OverTime` (chart overhaul
 * wave 3, Task T6, 29 Sep 2026) — exported for its own geometry test. A
 * limit inside `[lo, hi]` gets a real reference LINE at its own value; one
 * off-scale (above `hi` or below `lo`) pins its line to the plot's own edge
 * instead of widening the domain, exactly the 22/28 Sep behaviour this
 * replaces. The one thing that changes: every label — on-scale AND
 * off-scale alike — now goes through ONE `placeGutterLabels` pass
 * (`chartLayout.ts`), so two labels that would land on the same baseline
 * (either two in-range values within a line height of each other, or two
 * pinned to the same edge) are pushed apart instead of overprinting. The
 * old code handled only the second case, with a pair of per-edge counters;
 * this handles both with the one mechanism `report/shared.tsx`'s
 * `DeviationBars` already trusts. `lineY` (where the reference line itself
 * is drawn) is never displaced — only `labelY` (where its text sits) moves;
 * a leader tick is drawn between the two whenever they differ, so a moved
 * label still reads as belonging to its own line.
 */
export interface OverTimeGutterLabel {
  kind: 'usl' | 'target' | 'lsl';
  lineY: number;
  labelY: number;
  text: string;
  tone: 'ink' | 'muted';
  displaced: boolean;
}

export function overTimeGutterLabels(
  spec: { usl: number | null; lsl: number | null },
  target: number | null,
  domain: [number, number],
  top: number,
  bottom: number,
  fontPx: number,
  unit: 'g' | 'kg',
): OverTimeGutterLabel[] {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const yAt = (v: number) => top + ((hi - v) / span) * (bottom - top);

  type Item = { kind: OverTimeGutterLabel['kind']; y: number; text: string; tone: 'ink' | 'muted'; prio: number };
  const items: Item[] = [];
  const push = (kind: Item['kind'], value: number | null, label: string, tone: 'ink' | 'muted', prio: number) => {
    if (value == null) return;
    if (value >= lo && value <= hi) {
      items.push({ kind, y: yAt(value), text: label, tone, prio });
      return;
    }
    const atTop = value > hi;
    const arrow = atTop ? '↑' : '↓';
    items.push({ kind, y: atTop ? top : bottom, text: `${arrow} ${label} · off scale`, tone, prio });
  };
  // Target survives a squeeze first (prio 2): it is the one line every other
  // figure on this screen is stated against.
  push('usl', spec.usl, `upper limit ${fmtW(spec.usl, unit)}`, 'muted', 1);
  push('target', target, `target ${fmtG(target)}`, 'ink', 2);
  push('lsl', spec.lsl, `lower limit ${fmtW(spec.lsl, unit)}`, 'muted', 1);
  if (items.length === 0) return [];

  const lineH = Math.ceil(fontPx * 1.4) || 18;
  const placed = placeGutterLabels(items, { top, bottom, lineH });
  return placed.map((p, i) => ({
    kind: items[i]!.kind,
    lineY: items[i]!.y,
    labelY: p.y,
    text: p.text,
    tone: items[i]!.tone,
    displaced: p.displaced,
  }));
}

function subgroupSpan(p: Subgroup, bucketMinutes: number, multiDay: boolean): string {
  const startMs = new Date(p.ts).getTime();
  const endIso = Number.isFinite(startMs) ? new Date(startMs + bucketMinutes * 60_000).toISOString() : p.ts;
  return `${tickLabel(p.ts, multiDay)} – ${tickLabel(endIso, multiDay)}`;
}

/** The brush's shift-ref pair for a subgroup range, or null when the API
 *  response predates the shift fields (962a18b) — a caller must then not
 *  offer the brush at all rather than snap against undefined dates. */
function subgroupShiftRange(g: Subgroup[], i0: number, i1: number): { from: ShiftRef; to: ShiftRef } | null {
  const p0 = g[i0];
  const p1 = g[i1];
  if (!p0 || !p1 || !p0.firstShiftDate || !p0.firstShiftCode || !p1.lastShiftDate || !p1.lastShiftCode) return null;
  return { from: { date: p0.firstShiftDate, shift: p0.firstShiftCode }, to: { date: p1.lastShiftDate, shift: p1.lastShiftCode } };
}

function OverTime({
  spc,
  target,
  multiDay,
  periodLabel,
  onSelectPeriod,
}: {
  spc: SpcData;
  target: number | null;
  multiDay: boolean;
  /** `describePeriod(period)` — the WHOLE PAGE period, for the caption
   *  (`W.chart.limitsOverPeriod`), not just this chart's own data span. */
  periodLabel: string;
  onSelectPeriod?: (p: PeriodParams) => void;
}) {
  const H = 250;
  const L = 8;
  const T = 16;
  const B = 30;

  const g = spc.subgroups;
  const values = g.map((x) => x.mean);
  // UX defect fix (22 Sep 2026, kept through the ChartFrame rebuild): the
  // y-domain comes from the data alone, never folding in the spec limits —
  // see `overTimeGutterLabels` above for how an off-scale limit is drawn
  // instead.
  const [lo, hi] = niceDomain(values, { pad: 0.15 });

  const avgN = spc.count / Math.max(1, g.length);
  const groupLo = values.length > 0 ? Math.min(...values) : null;
  const groupHi = values.length > 0 ? Math.max(...values) : null;
  const resting = `${g.length} groups of about ${fmtInt(Math.round(avgN))} ${kindWord(spc.unit)}${
    groupLo != null && groupHi != null && groupHi > groupLo
      ? ` · ${W.weight.spanNote(fmtW(groupLo, spc.unit), fmtW(groupHi, spc.unit))}`
      : ''
  }`;

  // Kept fresh by `children` below on every ChartFrame render (a resize
  // included); `hit`/`markRect` read `.current` at call time, always after
  // the render that set it — same idiom as `StationSheet.tsx`'s
  // `DailyMeans`. `xsRef` is mutated in place, never reassigned, because the
  // `brush` prop object below captures it by reference at THIS component's
  // own last render.
  const geoRef = useRef<{ x: (i: number) => number; y: (v: number) => number } | null>(null);
  const xsRef = useRef<number[]>([]);

  const hit = (px: number, py: number): number | null => {
    if (py < T || xsRef.current.length === 0) return null;
    return nearestIndex(px, xsRef.current);
  };

  const markRect = (i: number): Rect | null => {
    const geo = geoRef.current;
    const p = g[i];
    if (!geo || !p) return null;
    return { x: geo.x(i) - 4, y: geo.y(p.mean) - 4, w: 8, h: 8 };
  };

  const tipFor = (i: number): ChartTip | null => {
    const p = g[i];
    if (!p) return null;
    const rows: ChartTipRow[] = [
      { name: W.reports.colMean, value: `${fmtW(p.mean, spc.unit)} (${fmtInt(p.n)} ${kindWord(spc.unit)})`, mark: 'ink' },
    ];
    // Only when a target is in force — the file header's own rule: the
    // headline does not state a difference until the basis is confirmed,
    // and this tooltip must not say more than the figures above it do.
    if (target != null) rows.push({ name: W.chart.vsTarget, value: signedW(p.mean - target, spc.unit) });
    const context: string[] = [];
    const limits: string[] = [];
    if (spc.spec.usl != null) limits.push(`upper limit ${fmtW(spc.spec.usl, spc.unit)}`);
    if (spc.spec.lsl != null) limits.push(`lower limit ${fmtW(spc.spec.lsl, spc.unit)}`);
    if (limits.length > 0) context.push(limits.join(' · '));
    // DEFECTS.md D-10: rule 1 only, under the same `xLimits.valid` gate the
    // dot itself is drawn under — the tooltip and the mark can never
    // disagree about whether the band exists.
    if (spc.xLimits.valid && p.xViolates) context.push(W.calibration.patternOn(NELSON_RULE_LABEL[1]));
    return { heading: subgroupSpan(p, spc.bucketMinutes, multiDay), rows, context: context.length > 0 ? context : undefined };
  };

  const commitBrush = (i0: number, i1: number) => {
    if (!onSelectPeriod) return;
    const range = subgroupShiftRange(g, i0, i1);
    if (!range) return;
    const params = snapToShifts(range.from, range.to);
    if (params) onSelectPeriod(params);
  };

  const brushLabel = (i0: number, i1: number): string => {
    const range = subgroupShiftRange(g, i0, i1);
    if (!range) return '';
    const { from, to } = range;
    const sameShift = from.date === to.date && from.shift === to.shift;
    return describePeriod({
      key: 'range', from: from.date, to: to.date, tsTo: '', live: false, days: 1,
      fromShift: from, toShift: to, shift: sameShift ? from.shift : undefined,
    });
  };

  return (
    <ChartFrame
      chartId="weight-overtime"
      defaultH={H}
      minH={180}
      maxH={520}
      resting={resting}
      caption={W.chart.limitsOverPeriod(periodLabel)}
      ariaLabel={spc.unit === 'kg' ? 'Average sack weight over time' : 'Average cone weight over time'}
      hit={hit}
      count={g.length}
      tipFor={tipFor}
      markRect={markRect}
      brush={onSelectPeriod ? { onCommit: commitBrush, xs: xsRef.current } : undefined}
      brushLabel={onSelectPeriod ? brushLabel : undefined}
    >
      {(size, state) => {
        const Wd = size.width;
        const Hd = size.height;
        const b0 = Hd - B;
        // Gutter labels computed BEFORE the right margin they need, exactly
        // as `StationSheet.tsx`'s `DailyMeans` does: their text does not
        // depend on the margin's own width, only the margin's width depends
        // on the widest of them.
        const labels = overTimeGutterLabels(spc.spec, target, [lo, hi], T, b0, size.fontPx, spc.unit);
        const widest = labels.reduce((m, l) => Math.max(m, l.text.length), 0);
        const R = widest > 0 ? Math.min(Math.max(60, Math.ceil(textPx(widest, size.fontPx)) + 16), Wd * 0.3) : 8;

        const x = (i: number) => L + (i / Math.max(1, g.length - 1)) * (Wd - L - R);
        const y = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (b0 - T);
        geoRef.current = { x, y };
        xsRef.current.length = 0;
        xsRef.current.push(...g.map((_, i) => x(i)));

        // Width-aware for the same reason as Rejects: a multi-day window
        // labels ticks "2 Sept 06:00", twice as wide as a bare time.
        const ticks = tickIndices(g.length, fittingTicks(Wd - L - R, multiDay ? 13 : 6, size.fontPx, g.length, 4));

        return (
          <svg className="chart" viewBox={`0 0 ${Wd} ${Hd}`} height={Hd} role="presentation" aria-hidden="true">
            {labels.map((l) => (
              <g key={l.kind}>
                <line
                  x1={L} x2={Wd - R} y1={l.lineY} y2={l.lineY}
                  stroke={l.tone === 'ink' ? 'var(--graphite)' : 'var(--grid)'}
                  strokeDasharray={l.tone === 'ink' ? undefined : '3 3'}
                />
                {l.displaced && <line x1={Wd - R} y1={l.lineY} x2={Wd - R + 6} y2={l.labelY} stroke="var(--grid)" />}
                <text
                  x={Wd - R + 8} y={l.labelY + size.fontPx * 0.35} fontSize={size.fontPx}
                  fill={l.tone === 'ink' ? 'var(--graphite)' : 'var(--muted)'}
                >
                  {l.text}
                </text>
              </g>
            ))}
            <path d={linePath(g.map((p, i) => ({ x: x(i), y: y(p.mean) })))} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
            {/* DEFECTS.md D-10, restored 23 Sep 2026 — RULE 1 ONLY. See the
                original comment history in git blame for the full account of
                why rules 2-8 (`p.nelson`) stay withheld (37.6-54.8% flag
                rate on real generations) while rule 1 (`xViolates`, judged
                against spc.ts's own I-MR band) does not. */}
            {spc.xLimits.valid &&
              g.map((p, i) => (
                p.xViolates ? (
                  <circle key={`v${i}`} cx={x(i)} cy={y(p.mean)} r={4} fill={state.active === i ? 'var(--acc)' : 'var(--acc-fill)'} />
                ) : null
              ))}
            {ticks.map((i) => (
              <text key={`t${i}`} x={x(i)} y={Hd - 8} fontSize={size.fontPx} fill="var(--muted)" textAnchor={edgeAnchor(i, g.length)}>
                {tickLabel(g[i]!.ts, multiDay)}
              </text>
            ))}
          </svg>
        );
      }}
    </ChartFrame>
  );
}

/** One reference label above the Distribution plot, before de-collision. */
export interface DistRefLabelIn {
  key: 'lsl' | 'target' | 'usl';
  x: number;
  text: string;
}

/** After `packRow` (chartLayout.ts): where to draw it, and which row. */
export interface DistRefLabelOut extends DistRefLabelIn {
  labelX: number;
  anchor: 'start' | 'middle' | 'end';
  row: 0 | 1;
  overflow: boolean;
}

/** How many rows of reference labels the band above the plot reserves —
 *  `packRow` moves a colliding label to row 1 before it ever resorts to
 *  `overflow`, so the band must be tall enough for both. */
export const DIST_REF_ROWS = 2;
export const DIST_REF_ROW_H = 13;

/**
 * Horizontal de-collision for the "target"/"upper limit"/"lower limit"
 * labels hanging in the band above the Distribution plot (chart overhaul
 * wave 3, Task T6, 29 Sep 2026). They used to be drawn at a hardcoded ±5px
 * offset from their own rule with no check for whether that put them on top
 * of a NEIGHBOURING label — routine when USL/target/LSL sit within a couple
 * of bins of each other. `packRow` (`chartLayout.ts`) flips a label's own
 * anchor first, then moves it to a second row, then marks it `overflow`
 * (still drawn, in place, on row 1) only if both fail — never drawn on top
 * of another label. Exported for its own geometry test at more than one
 * chart width.
 */
export function distributionRefLabels(items: DistRefLabelIn[], range: [number, number], fontPx: number): DistRefLabelOut[] {
  const packed = packRow(
    items.map((it) => ({ x: it.x, w: Math.ceil(textPx(it.text.length, fontPx)), anchor: 'middle' as const, text: it.text })),
    range,
  );
  return items.map((it, i) => {
    const p = packed[i]!;
    return { ...it, labelX: p.x, anchor: p.anchor, row: p.row, overflow: p.overflow };
  });
}

function Distribution({ spc, target }: { spc: SpcData; target: number | null }) {
  const H = 250;
  const L = 8;
  const B = 30;
  // The band above the plot the three reference labels hang in — they used
  // to be drawn INSIDE the plot, on the same baseline a bar can reach, so
  // whether "target 1,960 g" was readable depended on that day's bin
  // heights. Nothing may share a line with the data marks. Two rows tall so
  // `packRow` has a second row to move a colliding label into.
  const REF_TOP = 16;
  const REF_BAND = DIST_REF_ROWS * DIST_REF_ROW_H + 8;
  const T = REF_TOP + REF_BAND;

  const bins = spc.histogram;
  if (bins.length === 0) return <Empty message={W.nothingHere} />;
  const max = Math.max(...bins.map((b) => b.count), 1);

  const layoutRef = useRef<{ slot: number; R: number; y: (v: number) => number; cx: (i: number) => number } | null>(null);

  const outside = (b: { start: number; end: number }) =>
    (spc.spec.lsl != null && b.end <= spc.spec.lsl) || (spc.spec.usl != null && b.start >= spc.spec.usl);

  const hit = (px: number, py: number): number | null => {
    const layout = layoutRef.current;
    if (!layout || py < T) return null;
    return bandHit(px, L, layout.slot, bins.length);
  };

  const markRect = (i: number): Rect | null => {
    const layout = layoutRef.current;
    const b = bins[i];
    if (!layout || !b) return null;
    const by = Math.min(H - B, layout.y(b.count));
    return { x: layout.cx(i) - layout.slot * 0.42, y: by, w: layout.slot * 0.84, h: Math.max(0, H - B - by) };
  };

  const tipFor = (i: number): ChartTip | null => {
    const b = bins[i];
    if (!b) return null;
    const rows: ChartTipRow[] = [
      { name: '', value: `${fmtInt(b.count)} ${kindWord(spc.unit)}`, mark: outside(b) ? 'acc' : 'graphite' },
    ];
    return {
      heading: `${fmtW(b.start, spc.unit)} to ${fmtW(b.end, spc.unit)}`,
      rows,
      context: [outside(b) ? 'outside the product’s limits' : 'inside the product’s limits'],
    };
  };

  return (
    <ChartFrame
      chartId="weight-distribution"
      defaultH={H}
      minH={180}
      maxH={520}
      resting={`${fmtInt(spc.count)} ${kindWord(spc.unit)}, ${fmtW(bins[0]!.start, spc.unit)} to ${fmtW(bins[bins.length - 1]!.end, spc.unit)}`}
      ariaLabel={spc.unit === 'kg' ? 'Sack weight distribution' : 'Cone weight distribution'}
      hit={hit}
      count={bins.length}
      tipFor={tipFor}
      markRect={markRect}
    >
      {(size, state) => {
        const Wd = size.width;
        const R = 8;
        const slot = (Wd - L - R) / bins.length;
        const y = (v: number) => T + ((max - v) / max) * (H - T - B);
        const cx = (i: number) => L + slot * i + slot / 2;
        layoutRef.current = { slot, R, y, cx };
        const xOf = (weight: number) => {
          const i = bins.findIndex((b) => weight >= b.start && weight < b.end);
          return i >= 0 ? cx(i) : null;
        };

        const refIn: DistRefLabelIn[] = [];
        if (spc.spec.lsl != null && xOf(spc.spec.lsl) != null) {
          refIn.push({ key: 'lsl', x: xOf(spc.spec.lsl)!, text: `lower limit ${fmtW(spc.spec.lsl, spc.unit)}` });
        }
        if (target != null && xOf(target) != null) {
          refIn.push({ key: 'target', x: xOf(target)!, text: `target ${fmtG(target)}` });
        }
        if (spc.spec.usl != null && xOf(spc.spec.usl) != null) {
          refIn.push({ key: 'usl', x: xOf(spc.spec.usl)!, text: `upper limit ${fmtW(spc.spec.usl, spc.unit)}` });
        }
        const refOut = distributionRefLabels(refIn, [L, Wd - R], size.fontPx);

        return (
          <svg className="chart" viewBox={`0 0 ${Wd} ${H}`} height={H} role="presentation" aria-hidden="true">
            {bins.map((b, i) => (
              <rect
                key={i} x={cx(i) - slot * 0.42} y={y(b.count)} width={slot * 0.84}
                height={Math.max(0, H - B - y(b.count))}
                fill={outside(b) ? 'var(--acc-fill)' : state.active === i ? 'var(--ink)' : 'var(--graphite)'}
              />
            ))}
            {/* The rule runs the height of the plot; its label hangs in the
                band above it, de-collided by row/anchor via `packRow`
                rather than a fixed ±5px offset from the rule. */}
            {refOut.map((l) => (
              <g key={l.key}>
                <line
                  x1={l.x} x2={l.x} y1={T} y2={H - B}
                  stroke={l.key === 'target' ? 'var(--graphite)' : 'var(--grid)'}
                  strokeDasharray={l.key === 'target' ? undefined : '3 3'}
                />
                <text
                  x={l.labelX}
                  y={REF_TOP + DIST_REF_ROW_H * (l.row + 1)}
                  textAnchor={l.anchor}
                  fontSize={size.fontPx}
                  fill="var(--muted)"
                >
                  {l.text}
                </text>
              </g>
            ))}
            <line x1={L} x2={Wd - R} y1={H - B} y2={H - B} stroke="var(--rule-2)" />
          </svg>
        );
      }}
    </ChartFrame>
  );
}

/* ---------------------------------------------------------- station table */

/**
 * UX experiment (22 Sep 2026): "which station has moved most over the last
 * eleven days, and roughly when did it start?" used to need opening fourteen
 * station sheets, one at a time — `vs line` is a single instant and cannot
 * answer "when" at all, and `Pattern` renders '—' on every row on live data
 * (it only ever holds a value when `flagged` is true). `row.days` — daily
 * mean plus per-day Nelson flag, for every station — was already on the wire
 * in `/api/weight-stations`; this is its first reader. No API change.
 */
/* UX overflow sweep (23 Sep 2026): was 120. The station table needed 905px
   for 816px of column (see StationTable's own note below) and this column
   was the single biggest lever that did not mean dropping a fact — the
   sparkline is drawn to a `viewBox`, so it rescales losslessly; a station
   name or a signed gram figure does not. */
export const SPARK_W = 96;
export const SPARK_H = 28;
/** Fewer points than this cannot honestly show a trend — render nothing
 *  rather than a two-point line pretending to be one. Exported for its own
 *  test. */
export const SPARK_MIN_DAYS = 3;

/** One shared y-domain for every row, or the strokes cannot be compared —
 *  that is the entire point of the column. Includes the line mean so its
 *  reference line never sits off a row's own scale. Exported for its own
 *  test. */
export function sparklineDomain(rows: WeightStationRow[], lineMeanG: number | null): [number, number] {
  const vals = rows.flatMap((r) => r.days.map((d) => d.mean));
  if (lineMeanG != null) vals.push(lineMeanG);
  return niceDomain(vals, { pad: 0.15 });
}

/** "12 Sep", for the Sparkline tooltip only — day and short month, matching
 *  `StationSheet.tsx`'s own `short()` (not exported from there, so a small
 *  local copy rather than an import that would couple two unrelated files). */
function shortSparkDate(date: string): string {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

/**
 * Chart overhaul wave 3, Task T6 (29 Sep 2026): a hover tooltip only — "day ·
 * mean g" — added to the existing hand-drawn SVG. Deliberately NOT rebuilt on
 * `ChartFrame`: the owner's own brief for this chart is "no resize and no
 * brush", and `ChartFrame` always renders a resize handle outside print,
 * which this 96×28 table cell has no room for and no use of (fourteen of
 * these render per screen; fourteen resize handles would be its own defect).
 * The tooltip box reuses `.chart-tip`'s existing CSS classes (`app.css`,
 * already shipped for `ChartFrame`'s own tooltip) rather than adding new
 * rules, and `chartLayout.ts`'s `placeTip` so it never overlaps the marks
 * it describes even in this small a frame.
 */
export function Sparkline({
  days,
  domain,
  lineMeanG,
}: {
  days: WeightStationRow['days'];
  domain: [number, number];
  lineMeanG: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (days.length < SPARK_MIN_DAYS) return <span className="mut">{'—'}</span>;
  const [lo, hi] = domain;
  const y = linear([lo, hi], [SPARK_H - 3, 3]);
  const x = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * SPARK_W : SPARK_W / 2);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const h = hover != null ? days[hover] : null;
  const slot = SPARK_W / Math.max(1, days.length);
  const tipSize = { w: 108, h: 22 };
  const tipPos = h ? placeTip({ x: x(hover!), y: y(h.mean) }, tipSize, { w: SPARK_W, h: SPARK_H }) : null;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <svg
        className="spark"
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        width={SPARK_W}
        height={SPARK_H}
        role="img"
        aria-label={`Daily average over ${days.length} days: ${fmtG(first.mean)} to ${fmtG(last.mean)}`}
        onMouseLeave={() => setHover(null)}
      >
        {lineMeanG != null && lineMeanG >= lo && lineMeanG <= hi && (
          <line x1={0} x2={SPARK_W} y1={y(lineMeanG)} y2={y(lineMeanG)} stroke="var(--grid)" strokeWidth={1} />
        )}
        <path
          d={linePath(days.map((d, i) => ({ x: x(i), y: y(d.mean) })))}
          fill="none"
          stroke="var(--graphite)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {days.map((d, i) =>
          d.nelson.length > 0 ? <circle key={i} cx={x(i)} cy={y(d.mean)} r={2} fill="var(--acc-fill)" /> : null,
        )}
        {days.map((_, i) => (
          <rect
            key={`h${i}`}
            className="hit"
            x={x(i) - slot / 2}
            y={0}
            width={slot}
            height={SPARK_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {h && tipPos && (
        <div
          className="chart-tip"
          role="presentation"
          aria-hidden="true"
          style={{ position: 'absolute', left: tipPos.x, top: tipPos.y, width: tipSize.w, pointerEvents: 'none', zIndex: 1 }}
        >
          <p className="chart-tip-h">{`${shortSparkDate(h.date)} · ${fmtG(h.mean)}`}</p>
        </div>
      )}
    </span>
  );
}

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
  const sparkDomain = sparklineDomain(rows, data.lineMeanG);
  // A rounded zero must not print as "−0 g", which reads as a measurement
  // that is very slightly negative rather than as no difference at all.
  const signed = (v: number | null) => {
    if (v == null) return '—';
    const g = fmtG(Math.abs(v));
    if (Math.round(v) === 0) return g;
    return `${v > 0 ? '+' : '−'}${g}`;
  };

  /**
   * UX Phase 5 Brief 3 unit U2 (16 Sep 2026): the three outcomes of
   * `targetBasis` (weightStations.ts, Wave 1 be5ac3e), rendered where the
   * plain `signed(r.vsTargetG)` used to sit unconditionally.
   *  - 'mixed': NO NUMBER — more than one material ran here in the window,
   *    so no single target applies. The row's own `projection` is already
   *    null server-side (weightStations.ts:295-300); nothing here computes
   *    a substitute.
   *  - 'line_product': the line-wide fallback (July generation, no
   *    material_id at all) — the number is shown, marked with a `title`
   *    tooltip carrying the reason, the same pattern report/Summary.tsx
   *    (U5) uses for its own "not comparable" cells.
   *  - 'station_material': the plain signed figure, unmarked.
   */
  const vsTargetCell = (r: WeightStationRow) => {
    // RT-018: a retired-in-PDAS target is marked the same way regardless of
    // which of the three bases produced it — the figure itself is unaffected,
    // only what it should prompt a reader to check.
    const retired = r.targetProductActive === false && (
      <span className="mut sm" style={{ marginLeft: 4 }} title={W.retiredProduct.stillRunning}>
        {W.retiredProduct.marker}
      </span>
    );
    if (r.targetBasis === 'mixed') {
      return <span className="mut">{W.weight.mixedTarget(r.materialsInWindow ?? 0)}</span>;
    }
    if (r.targetBasis === 'line_product') {
      return <span title={W.weight.targetLineProduct}>{signed(r.vsTargetG)}{retired}</span>;
    }
    return <>{signed(r.vsTargetG)}{retired}</>;
  };

  return (
    <>
      {/* UX overflow sweep (23 Sep 2026): this table needed 905px of the
          816px a desktop content column has, so `.tw`'s overflow-x:auto
          (app.css:658) put it behind a horizontal scrollbar with the Trend
          column — the one column the caption below the table explicitly
          describes — scrolled out of view. `table-layout: fixed` with an
          explicit `<colgroup>` (below) replaces "grow every column to fit
          its widest cell, whatever that costs" with a fixed budget that
          sums to 100%; `.station-tbl td` (app.css) turns off the plain `td`
          default's forced single line so "What the data shows" wraps inside
          its own column instead of pushing the table wider. Paired with
          SPARK_W dropping to 96 (above) and the Trend/Shows columns' left
          padding dropping from 28px to 14px, this fits at 1366px AND 1920px
          — the page caps at 1100px either way (app.css:450), so the
          content column's width does not change between them. */}
      <table className="station-tbl">
        <colgroup>
          <col style={{ width: '15%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '25%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>{W.weight.colStation}</th>
            <th className="n">{W.weight.colAverage}</th>
            {/* Median and SD (roadmap Phase 9 items 1-2): the SD was computed
                for every station and rendered nowhere; the median nowhere at all. */}
            <th className="n">{W.calibration.colMedian}</th>
            <th className="n">{W.calibration.colSd}</th>
            <th className="n">{W.weight.colVsTarget}</th>
            {/* UX experiment (22 Sep 2026): replaces `vs line` and `Pattern`
                — see the note above Sparkline. A single instant and a column
                that reads '—' on every live row, for one mark that answers
                "which station moved, and roughly when". */}
            <th style={{ paddingLeft: 14 }}>{W.weight.colTrend}</th>
            <th className="n">{W.weight.colRejects}</th>
            <th style={{ paddingLeft: 14 }}>{W.weight.colShows}</th>
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
              <td className={r.flagged ? 'acc' : ''} style={{ fontWeight: 500 }}>
                {stationLabel(byId.get(r.station), r.station)}
                <Chevron label={W.openRecord} />
              </td>
              <td className="n">{fmtG(r.meanG)}</td>
              <td className="n">{r.medianG == null ? '—' : fmtG(r.medianG)}</td>
              <td className="n">{r.sdG == null ? '—' : `${r.sdG.toFixed(1)} g`}</td>
              <td className="n">{vsTargetCell(r)}</td>
              <td style={{ paddingLeft: 14 }}>
                <Sparkline days={r.days} domain={sparkDomain} lineMeanG={data.lineMeanG} />
              </td>
              <td className="n">{r.rejectRatePct == null ? '—' : `${r.rejectRatePct.toFixed(1)}%`}</td>
              <td style={{ paddingLeft: 14 }}>{verdict(r, data)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* States the one shared scale every stroke in the column above is
          drawn against — without it "which line is steeper" cannot be read
          honestly from row to row. */}
      <p className="mut sm" style={{ marginTop: 10 }}>
        {W.weight.trendScale(fmtG(sparkDomain[0]), fmtG(sparkDomain[1]))}
      </p>
    </>
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