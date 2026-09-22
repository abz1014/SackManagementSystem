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
import { Readout, useChartWidth, edgeAnchor, RefLine, linePath, linear, niceDomain, fittingTicks, tickIndices } from '../ui/chart';
import { fmtAppInstant, fmtG, fmtInt, fmtKg, fmtPct1 } from '../lib/fmt';
import {
  getSpc, getWeightStations, getStations, getProduction, stationLabel, NELSON_RULE_LABEL,
  type SpcData, type SpcType, type StationRow, type WeightStationRow, type WeightStationsData,
} from '../api';

/** Roadmap Phase 2b (16 Sep 2026): the chart toggle, in the URL as `wm`. */
export type WeightMode = 'time' | 'dist';

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
        <h1 className="wide">{headline(d, sLine, coneLine.error)}</h1>
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
                {d == null ? (
                  W.weight.targetUnknown
                ) : d.targetG != null ? (
                  <>
                    {W.reports.target(fmtG(d.targetG), d.productLabel ?? W.reports.wholeLine)}
                    {d.targetEffectiveFromUtc && ` · ${W.reports.targetSince(fmtAppInstant(d.targetEffectiveFromUtc))}`}
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
          <OverTime spc={s} target={chartType === 'cone' ? (d?.targetG ?? null) : null} multiDay={period.from !== period.to} />
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
            Over this period: {fmtInt(s.count)} {kindWord(s.unit)}, mean {fmtW(s.mean, s.unit)}
            {s.median != null ? `, median ${fmtW(s.median, s.unit)}` : ''}, standard deviation{' '}
            {s.stdevOverall.toFixed(2)} {s.unit} overall and {s.stdevWithin.toFixed(2)} {s.unit} within{' '}
            {s.bucketLabel} groups. {s.xbarOutOfControl} group averages fell outside the control band and{' '}
            {s.nelsonFlagged} carried a non-random pattern.
            {s.capability.cpk != null && ` Cp ${s.capability.cp?.toFixed(2)}, Cpk ${s.capability.cpk.toFixed(2)}.`}
          </p>
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

function headline(d: WeightStationsData | null, s: SpcData | null, coneLineError?: string | null): string {
  // UX Phase 7 Brief 1: a FAILED /api/spc fetch used to fall through to the
  // `!s` branch below and print "No cones were weighed in this period" — the
  // app asserting an empty plant when the true state is "the request failed
  // and we do not know". The figures block above already swaps to `Failed`
  // with a retry button for the same condition (error, no data at all); this
  // is the same condition's headline. Stale data from a same-key refetch
  // failure (coneLineError set but `s` still holding the last good answer)
  // is not this case — that falls through to the ordinary headline below.
  if (coneLineError && !s) return W.couldNotLoad;
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
  const tail = need === 0 ? W.weight.allStationsSteady : W.weight.stationsNeedLook(need);
  if (d.targetG == null) return `${W.weight.headlineNoTarget(mean)} ${tail}`;
  // Until the weight basis is confirmed the difference is not stated as a
  // finding — see the file header. The target itself still carries its
  // product and the instant its limits took effect (UX Phase 5 Brief 3 unit
  // U2, 16 Sep 2026) — the bare "1,960 g" here used to name neither, so a
  // reader had no way to tell whether it was the same target the station
  // table below was judging against.
  return `${W.weight.headlineUnconfirmed(mean, targetPhrase(d))} ${tail}`;
}

/** "1,960 g (201-IH0-SD), in force since 16/09/2026, 09:00:00" — the target
 *  with its product and the instant its limits took effect, so the headline
 *  and the figure note never state a bare number the station table below
 *  cannot be checked against. */
function targetPhrase(d: WeightStationsData): string {
  const base = `${fmtG(d.targetG)} (${d.productLabel ?? W.reports.wholeLine})`;
  return d.targetEffectiveFromUtc ? `${base}, ${W.reports.targetSince(fmtAppInstant(d.targetEffectiveFromUtc))}` : base;
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
  // UX defect fix (22 Sep 2026): the y-domain used to fold the spec limits
  // (target/USL/LSL) into `niceDomain` alongside the data. The limits sit
  // ±40 g from target while the subgroup means span about 7 g, so the limits
  // set the scale and the data collapsed to a measured 3.2 px inside a 204 px
  // plot — 1.6% of the chart's height. The domain now comes from the data
  // alone; a limit outside it is drawn as an edge annotation below, not
  // folded into the range that decides how tall the real signal stands.
  const [lo, hi] = niceDomain(values, { pad: 0.15 });
  const x = (i: number) => L + (i / Math.max(1, g.length - 1)) * (width - L - R);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);

  // A limit inside [lo, hi] draws inline, at its own value. One off-scale
  // (above `hi` or below `lo`) pins to the plot's own edge instead of being
  // let to widen the domain — the reader still sees the limit exists and
  // which side it sits on, never a distorted chart. When more than one mark
  // lands off the SAME edge (target and the upper limit both above `hi` is
  // routine once the domain hugs a ~7 g run of subgroup means — caught live:
  // both printed "off scale" on the identical line and the two labels
  // overlapped into unreadable text), each additional one stacks a further
  // 13px in from that edge so the labels never share a baseline.
  let offTop = 0;
  let offBottom = 0;
  const limitLine = (value: number | null, label: string, tone: 'ink' | 'muted' = 'muted') => {
    if (value == null) return null;
    const dashed = tone !== 'ink';
    if (value >= lo && value <= hi) {
      return <RefLine y={y(value)} x1={L} x2={width - R} label={label} tone={tone} dashed={dashed} />;
    }
    const atTop = value > hi;
    const arrow = atTop ? '↑' : '↓';
    const yy = atTop ? T + offTop++ * 13 : H - B - offBottom++ * 13;
    return <RefLine y={yy} x1={L} x2={width - R} label={`${arrow} ${label} · off scale`} tone={tone} dashed={dashed} />;
  };

  // Width-aware for the same reason as Rejects: a multi-day window labels
  // ticks "2 Sept 06:00", which is twice as wide as a bare time.
  const ticks = tickIndices(g.length, fittingTicks(width - L - R, multiDay ? 13 : 6, 13, g.length, 4));
  const h = hover != null ? g[hover] : null;

  // The noise floor a subgroup of this size carries by chance alone —
  // σ_within/√n, already computed per subgroup for the X̄ control limits
  // (spc.ts). Stated in the resting readout rather than drawn as a band: a
  // band was investigated and rejected (see the file this chart lives under)
  // because per-subgroup n is ragged enough live to swing the band 4.5x
  // across one shift. A sentence survives that; a drawn contour would not.
  const avgN = spc.count / Math.max(1, g.length);
  const noiseG = avgN > 0 ? (2 * spc.stdevWithin) / Math.sqrt(avgN) : 0;

  return (
    <div ref={box}>
      <Readout
        hovered={
          h
            // The pattern named on hover (roadmap Phase 9 item 3): the rule
            // labels were defined for the UI and never rendered — this read
            // "non-random pattern" for every one of the eight.
            ? `${tickLabel(h.ts, multiDay)} · ${fmtW(h.mean, spc.unit)}, the average of ${fmtInt(h.n)} ${kindWord(spc.unit)}${
                h.nelson.length ? ` · ${W.calibration.patternOn(h.nelson.map((id) => NELSON_RULE_LABEL[id]).join(', '))}` : h.xViolates ? ` · ${W.calibration.patternOn(NELSON_RULE_LABEL[1])}` : ''
              }`
            : null
        }
        resting={`${g.length} groups of about ${fmtInt(Math.round(avgN))} ${kindWord(spc.unit)}${
          noiseG > 0 ? ` · ${W.weight.noiseFloor(`±${Math.round(noiseG)}${String.fromCharCode(0xa0)}${spc.unit}`)}` : ''
        }`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img"
           aria-label={spc.unit === 'kg' ? 'Average sack weight over time' : 'Average cone weight over time'}
           onMouseLeave={() => setHover(null)}>
        {limitLine(spc.spec.usl, `upper limit ${fmtW(spc.spec.usl, spc.unit)}`)}
        {limitLine(target, `target ${fmtG(target)}`, 'ink')}
        {limitLine(spc.spec.lsl, `lower limit ${fmtW(spc.spec.lsl, spc.unit)}`)}
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
        hovered={h ? `${fmtW(h.start, spc.unit)} to ${fmtW(h.end, spc.unit)} · ${fmtInt(h.count)} ${kindWord(spc.unit)}` : null}
        resting={`${fmtInt(spc.count)} ${kindWord(spc.unit)}, ${fmtW(bins[0]!.start, spc.unit)} to ${fmtW(bins[bins.length - 1]!.end, spc.unit)}`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img"
           aria-label={spc.unit === 'kg' ? 'Sack weight distribution' : 'Cone weight distribution'}
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
                {label} {label === 'target' ? fmtG(v) : fmtW(v, spc.unit)}
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

/**
 * UX experiment (22 Sep 2026): "which station has moved most over the last
 * eleven days, and roughly when did it start?" used to need opening fourteen
 * station sheets, one at a time — `vs line` is a single instant and cannot
 * answer "when" at all, and `Pattern` renders '—' on every row on live data
 * (it only ever holds a value when `flagged` is true). `row.days` — daily
 * mean plus per-day Nelson flag, for every station — was already on the wire
 * in `/api/weight-stations`; this is its first reader. No API change.
 */
export const SPARK_W = 120;
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

export function Sparkline({
  days,
  domain,
  lineMeanG,
}: {
  days: WeightStationRow['days'];
  domain: [number, number];
  lineMeanG: number | null;
}) {
  if (days.length < SPARK_MIN_DAYS) return <span className="mut">{'—'}</span>;
  const [lo, hi] = domain;
  const y = linear([lo, hi], [SPARK_H - 3, 3]);
  const x = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * SPARK_W : SPARK_W / 2);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      width={SPARK_W}
      height={SPARK_H}
      role="img"
      aria-label={`Daily average over ${days.length} days: ${fmtG(first.mean)} to ${fmtG(last.mean)}`}
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
    </svg>
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
    if (r.targetBasis === 'mixed') {
      return <span className="mut">{W.weight.mixedTarget(r.materialsInWindow ?? 0)}</span>;
    }
    if (r.targetBasis === 'line_product') {
      return <span title={W.weight.targetLineProduct}>{signed(r.vsTargetG)}</span>;
    }
    return signed(r.vsTargetG);
  };

  return (
    <>
      <table>
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
            <th style={{ paddingLeft: 28 }}>{W.weight.colTrend}</th>
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
              <td className="n">{r.medianG == null ? '—' : fmtG(r.medianG)}</td>
              <td className="n">{r.sdG == null ? '—' : `${r.sdG.toFixed(1)} g`}</td>
              <td className="n">{vsTargetCell(r)}</td>
              <td style={{ paddingLeft: 28 }}>
                <Sparkline days={r.days} domain={sparkDomain} lineMeanG={data.lineMeanG} />
              </td>
              <td className="n">{r.rejectRatePct == null ? '—' : `${r.rejectRatePct.toFixed(1)}%`}</td>
              <td style={{ paddingLeft: 28 }}>{verdict(r, data)}</td>
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