/**
 * Rejects — "How many cones are being rejected, why, is it getting worse, and
 * where?" Requirement 4, on one screen instead of three.
 *
 * TWO CORRECTIONS FROM THE ENGINEER'S REVIEW, both load-bearing:
 *
 *  1. WEIGHT AND QUALITY ARE DRAWN SEPARATELY. They have different causes and
 *     different owners: a rise in weight rejects sends you to the scales and
 *     the winders, a rise in quality codes sends you to tubes and material.
 *     The old single line merged them, so the one fact that tells you where to
 *     walk was averaged away.
 *  2. THE TREND IS DRAWN OVER THE TRAILING WINDOW WITH THE PERIOD SHADED, not
 *     over the period alone. A sustained rise cannot be seen inside an
 *     eight-hour window, so on "This shift" the old chart could only ever show
 *     noise. The rise stays visible from any period.
 *
 * ROADMAP PHASE 5 (14 Sep 2026) — the drilldowns the requirement names, and
 * the rules that keep this screen honest with the others:
 *
 *  - THE HEADLINE COUNTS WHAT LINE COUNTS. The period figures ask
 *    /api/reject-spc for the same from/to, SHIFT and TSTO Line sends to
 *    /api/production. Before this the route took neither, so "This shift" here
 *    was the whole production day and the two screens printed two numbers for
 *    one period (gap analysis §7). A test pins the agreement.
 *  - WHICH FIGURES FOLLOW THE PERIOD. The reasons list and the by-day table
 *    follow the selected period. The trend and its "rising" verdict look at
 *    the fixed trailing window, because the episode detector needs
 *    consecutive DAYS (lib/period.ts rule 2). The screen says which is which.
 *  - ONE FILTER SET FOR EVERY NUMBER. Station and product narrow the
 *    headline, the reasons, the trend and the table alike, through one
 *    `RejectFilters`. Choosing a reason (a Pareto bar) narrows the trend and
 *    the table to that code; the chip names it and clears it.
 *  - EVERY FETCH HAS A FAILURE STATE. "No cones were rejected" used to render
 *    when /api/rejects failed; a refusal or an outage is now the `Failed`
 *    sentence with a retry, per block, and the inline rename reports its own
 *    failure instead of swallowing it.
 *
 * There is no "by station" section here. That was the third screen ranking the
 * same fourteen stations, and it is now a link into the one station table on
 * Weight, which already carries a reject-rate column.
 */
import { useEffect, useState, useMemo } from 'react';
import { useLive, usePolling } from '../lib/live';
import { distinctProductLabels, productLabel } from '../lib/productLabel';
import { W } from '../lib/words';
import { trailingWindow, daysWithReadings, type Period } from '../lib/period';
import { Block, Chevron, Details, Empty, Failed, Loading, SkelChart, SkelLines, Toolbar, rowKeys } from '../ui/bits';
import { fmtDay, fmtInt, fmtPct1 } from '../lib/fmt';
import { vitalFew } from '../lib/pareto';
import { RejectTrendChart } from './report/shared';
// The SAME type Readings.tsx's headline uses, imported rather than restated,
// so this app has one idiom for "a count I have / have not been told" and not
// two. Type-only, so nothing of Readings is pulled into this module at
// runtime. If a third screen needs it, promote it to lib/ — do not copy it.
import type { CountState } from './Readings';
import {
  getRange, getStations, getProducts, stationLabel, setRejectLabel,
  getRejectsFiltered, getRejectSpcFiltered, getRejectsByDayCode, rejectCodeParam,
  type RejectReason, type RejectSpcData, type RejectDayCodeRow, type RejectFilters,
  type StationRow, type ProductOption,
} from '../api';

/**
 * A promise that never settles, for a poll whose window is not known yet.
 *
 * The alternative — `win!.from` while `win` is null — threw inside the
 * poller, which recorded a real error; the screen then flashed "could not
 * load" in the gap between the window arriving and the retry succeeding,
 * because usePolling keeps the last error until the next success. Never
 * settling instead means no request, no error and no state change: the hook
 * simply stays `loading` until the key changes and the real fetch runs. The
 * abandoned promise is dropped by the effect's own cancelled flag.
 */
const never = (): Promise<never> => new Promise<never>(() => {});

/** What the by-day table hands the reason sheet. */
export interface ReasonRef {
  day: string;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
}

export function RejectsScreen({
  period,
  station,
  onStationChange,
  product,
  onProductChange,
  code,
  onCodeChange,
  onSeeCones,
  onSeeStations,
  onOpenReason,
  canName,
}: {
  period: Period;
  /**
   * Roadmap Phase 2b (16 Sep 2026), overruling the comment this replaced.
   *
   * That comment kept these local on the theory that they were "a working
   * narrowing of this screen, not a period a colleague should inherit from a
   * pasted link — that is the global period's job." The distinction does not
   * hold up: station and product are not periods, and every sibling screen
   * that narrows by the same two things — Report's filter chips, Weight's
   * chart-station selector, Readings' station chip — is gaining a URL key in
   * this same phase for the identical reason (Phase 1's frontend audit).
   * Singling Rejects out would have meant a manager's "station 7 is rising"
   * link landing everyone on the unfiltered chart, the exact defect this
   * phase exists to close, and it would have left three-going-on-four
   * screen-local names for "which station" instead of the ONE the Phase 2a
   * IA review asked for (`audit/IA-PROPOSAL.md` §7). Station and product are
   * the SHARED `st`/`pr` keys — see App.tsx's Route note; setting one here
   * and switching to Weight keeps the same station in view. `code` is not
   * shared (no other screen has a reject reason to pick) but is exactly as
   * linkable, and already degrades safely: the effect below still drops a
   * code the period's reasons can no longer name, which is the "unknown
   * value falls back to the default" rule this phase requires, not a
   * consequence of being local state.
   */
  station: number | null;
  onStationChange: (v: number | null) => void;
  product: number | null;
  onProductChange: (v: number | null) => void;
  code: string | null;
  onCodeChange: (c: string | null, opts?: { replace?: boolean }) => void;
  onSeeCones: () => void;
  onSeeStations: () => void;
  onOpenReason: (r: ReasonRef) => void;
  canName: boolean;
}) {
  const { line } = useLive();
  // Rarely changes (it moves once a day at most), so a slow heartbeat is
  // plenty. Finding H6 (Sep 2026 audit): without this, trailingWindow() below
  // always claimed the full 14 days regardless of how much history actually
  // exists — the exact wrong side to be wrong on right after go-live, when
  // the record is a handful of days old.
  const range = usePolling(() => getRange(), 30 * 60_000, 'range');
  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');
  const products = usePolling(() => getProducts(), 10 * 60_000, 'products');
  // Wait for BOTH before computing the window. Deriving it from `line` alone
  // and letting `firstDay` arrive later meant the first paint used an
  // unclipped 14-day window: three requests went out against it, were thrown
  // away the moment /api/range resolved and the window shrank, and the "last
  // N days" label visibly changed under the reader. `range.error` also
  // releases the wait, so a failing /api/range degrades to the unclipped
  // window rather than holding the screen on a spinner forever.
  const rangeSettled = range.data != null || range.error != null;
  const win =
    line && rangeSettled
      ? trailingWindow({
          shiftDate: line.shift.shiftDate,
          shiftCode: line.shift.code,
          shiftStartUtc: line.shift.startUtc,
          plantNowUtc: line.plantNowUtc,
          dataAsOfUtc: line.dataAsOfUtc,
          firstDay: range.data?.minDate ?? null,
        })
      : null;

  // The narrowing every request shares. tsTo on the trend too: under a replay
  // the trailing window must not reach past the replayed instant either.
  const narrow: RejectFilters = { station: station ?? undefined, product: product ?? undefined, tsTo: period.tsTo };
  const narrowKey = `${station ?? 'any'}:${product ?? 'any'}:${period.tsTo}`;
  // The period, exactly as Line sends it to /api/production.
  const periodF: RejectFilters = { ...narrow, from: period.from, to: period.to, shift: period.shift };
  const periodKey = `${period.from}:${period.to}:${period.shift ?? 'all'}:${narrowKey}`;

  const quality = usePolling(
    () => (win ? getRejectSpcFiltered({ ...narrow, from: win.from, to: win.to, rejectType: 'quality', bucket: 'day' }) : never()),
    5 * 60_000,
    `rspc:q:${win?.from}:${win?.to}:${narrowKey}`,
  );
  const weight = usePolling(
    () => (win ? getRejectSpcFiltered({ ...narrow, from: win.from, to: win.to, rejectType: 'weight', bucket: 'day' }) : never()),
    5 * 60_000,
    `rspc:w:${win?.from}:${win?.to}:${narrowKey}`,
  );
  // One reason, followed through the window, when a Pareto bar is chosen.
  // The answer carries the code it was fetched for: usePolling keeps the last
  // data across a key change, so without this the chart would draw reason A's
  // series under reason B's name for the moment B takes to arrive.
  const coded = usePolling(
    async () => {
      if (!win || !code) return never();
      const env = await getRejectSpcFiltered({ ...narrow, from: win.from, to: win.to, rejectType: 'all', bucket: 'day', code });
      return { forCode: code, trend: env.data };
    },
    5 * 60_000,
    `rspc:c:${win?.from}:${win?.to}:${narrowKey}:${code ?? ''}`,
  );
  // Reasons FOLLOW THE PERIOD (roadmap Phase 5): they were fixed to the
  // trailing window, so "This shift" showed a fortnight's reasons.
  const reasons = usePolling(
    () => getRejectsFiltered(periodF),
    period.live ? 60_000 : 5 * 60_000,
    `reasons:${periodKey}`,
  );
  // The period figures, which are what the headline counts — the SAME
  // shift/tsTo Line sends, so the two screens agree.
  const periodQ = usePolling(
    () => getRejectSpcFiltered({ ...periodF, from: period.from, to: period.to, rejectType: 'quality', bucket: 'day' }),
    period.live ? 60_000 : 5 * 60_000,
    `pq:${periodKey}`,
  );
  const periodW = usePolling(
    () => getRejectSpcFiltered({ ...periodF, from: period.from, to: period.to, rejectType: 'weight', bucket: 'day' }),
    period.live ? 60_000 : 5 * 60_000,
    `pw:${periodKey}`,
  );
  const byDay = usePolling(
    () => getRejectsByDayCode({ ...periodF, from: period.from, to: period.to, code: code ?? undefined }),
    period.live ? 60_000 : 5 * 60_000,
    `byday:${periodKey}:${code ?? ''}`,
  );

  // A chosen reason that no longer appears in the period's reasons is still
  // a valid filter (it may simply have no rejects this period); it is only
  // dropped when the period's list has loaded and cannot name it, so the chip
  // never shows a code the reader cannot see in the list beside it.
  const reasonRows = reasons.data?.data.reasons ?? [];
  const activeReason = code ? reasonRows.find((r) => rejectCodeParam(r) === code) ?? null : null;
  useEffect(() => {
    // Replace, not push: an automatic correction the period's own answer
    // makes, not a choice the reader took — see App.tsx's push/replace rule.
    if (code && reasons.data && !activeReason) onCodeChange(null, { replace: true });
  }, [code, reasons.data, activeReason, onCodeChange]);

  if (!win) return <Loading />;

  const q = periodQ.data?.data ?? null;
  const w = periodW.data?.data ?? null;
  const figuresFailed = (periodQ.error && !periodQ.data) || (periodW.error && !periodW.data);
  // The band is drawn only where the period intersects the trailing window.
  const periodOverlapsWindow = period.from <= win.to && period.to >= win.from;
  const anyReasonUnnamed = reasonRows.some((r) => !r.label);

  /**
   * THE HEADLINE COUNT AS A STATE, not a number (23 Sep 2026 sweep, the same
   * defect and the same idiom as Readings.tsx's CountState — `git show
   * b759c88`).
   *
   * This used to be `(q?.totalRejects ?? 0) + (w?.totalRejects ?? 0)` with the
   * denominator `q?.totalProduced ?? 0` beside it. Two independent polls, two
   * `?? 0`s, so a half-loaded screen asserted a count and a RATE it had not
   * been told. Both states were reproduced on screen at 1366x768 on this
   * screen, by delaying /api/rejects* and changing the period:
   *
   *   "0 rejected · —"                     both polls still in flight
   *   "23 rejected · 100.0% of everything  the WEIGHT series landed alone:
   *    weighed"                            23 / (0 + 23), a rate whose
   *                                        denominator was the other poll's
   *                                        missing `totalProduced`
   *
   * The second is the arithmetically-impossible pair again: the headline two
   * lines above correctly printed "…" at that instant because it gates on
   * `q == null || w == null`, while this tile printed 100 %. One screen, two
   * answers — the exact shape Phase 7 fixed elsewhere.
   *
   * Both counts and the rate now hang off ONE state. `ok` is reachable only
   * when BOTH series have answered, so there is no longer any way to compute
   * a rate from a denominator one of them was going to supply.
   */
  const rejectCount: CountState =
    q && w
      ? { kind: 'ok', n: q.totalRejects + w.totalRejects }
      : figuresFailed
        ? { kind: 'failed' }
        : { kind: 'pending' };
  const produced = q && w ? q.totalProduced : null;
  const ratePct =
    rejectCount.kind === 'ok' && produced != null && produced + rejectCount.n > 0
      ? (100 * rejectCount.n) / (produced + rejectCount.n)
      : null;

  // The verdict follows what the trend shows: the chosen reason when one is
  // chosen, otherwise quality then weight.
  const codedTrend = code && coded.data?.forCode === code ? coded.data.trend : null;
  const codedPending = !!code && codedTrend == null;
  const rising = codedTrend ? ongoing(codedTrend) : ongoing(quality.data?.data) ?? ongoing(weight.data?.data);
  const risingKind = codedTrend
    ? (activeReason ? reasonName(activeReason) : W.rejects.quality)
    : ongoing(quality.data?.data) ? W.rejects.quality : W.rejects.weightKind;
  // Every rise in the window, not just one still running at the newest
  // bucket — otherwise the headline says "Steady." over a chart of spikes.
  const windowEpisodes = codedTrend
    ? codedTrend.episodes
    : [...(quality.data?.data.episodes ?? []), ...(weight.data?.data.episodes ?? [])];
  const lastEnded = windowEpisodes.map((e) => e.endTs).sort().slice(-1)[0] ?? null;
  const settledTail =
    windowEpisodes.length > 0 && lastEnded
      ? W.rejects.steadyAfterRises(windowEpisodes.length, dayLabel(lastEnded))
      : W.rejects.steady;
  /**
   * "Steady." IS A VERDICT, AND A VERDICT NEEDS THE TREND (23 Sep 2026 sweep).
   *
   * `rising` is null and `windowEpisodes` is empty in two completely different
   * situations: the detector looked at the trailing window and found no rise,
   * and the trailing-window fetch never answered. Both fell through to
   * `W.rejects.steady` — "Steady." — so a dead /api/reject-spc printed the
   * all-clear verdict, in the headline, over a chart that was showing its own
   * `<Failed>` two blocks below.
   *
   * This is GUARD 1 satisfied in letter and defeated in spirit: `quality.error`
   * and `weight.error` ARE read in this file (the chart block reads both), so
   * the guard passes — the headline simply never consulted them.
   *
   * The verdict is now stated only when the series it is a verdict ON has
   * answered. When it has not, the headline states the counts alone and stops,
   * which is the whole of what is known.
   */
  const verdictKnown = codedTrend != null || quality.data != null || weight.data != null;

  const unattributed = reasons.data?.data.unattributed ?? null;
  const M = W.rejectsMore;

  /**
   * The top-reason tile, as a state for the same reason as `rejectCount`.
   *
   * `reasonRows[0] ?? null` made a failed or in-flight /api/rejects render
   * `W.rejects.none` — "No cones were rejected in this period." — which is not
   * a hedge, it is a sentence asserting a fact. Observed on screen beside the
   * OTHER tile in the same block reading "1,271 rejected": the two tiles
   * contradicted each other, and the false one was the one written in words.
   *
   * The file header's own rule ("EVERY FETCH HAS A FAILURE STATE ... 'No cones
   * were rejected' used to render when /api/rejects failed") was applied to the
   * reasons LIST below and never to this tile, which reads the same poll.
   *
   * CountState is not reused here: it carries a count, and this tile's answer
   * is a ROW (or the genuine absence of one). It keeps the identical
   * ok/pending/failed discipline, which is the part that matters.
   */
  const topReason: { kind: 'ok'; row: RejectReason | null } | { kind: 'pending' } | { kind: 'failed' } =
    reasons.data ? { kind: 'ok', row: reasonRows[0] ?? null } : reasons.error ? { kind: 'failed' } : { kind: 'pending' };

  return (
    <>
      <div className="page">
      <p className="q">{W.question.rejects}</p>
      <h1 className="wide">
        {rejectCount.kind === 'failed'
          ? '—'
          : rejectCount.kind === 'pending' || q == null || w == null
            ? '…'
            : `${W.rejects.headline(fmtInt(rejectCount.n), fmtPct1(ratePct), q.totalRejects, w.totalRejects)}${
                verdictKnown
                  ? ` — ${rising ? W.rejects.risingSince(dayLabel(rising.startTs), risingKind) : settledTail}`
                  : ''
              }.`}
      </h1>
      </div>

      <Block first>
        {/* The two tiles answer from two DIFFERENT polls (the period series,
            and the reasons list), so they state their outcomes separately —
            one failing must not blank or, worse, falsify the other. */}
        {rejectCount.kind === 'failed' && topReason.kind === 'failed' ? (
          <Failed
            error={periodQ.error ?? periodW.error ?? reasons.error}
            onRetry={() => { periodQ.refresh(); periodW.refresh(); reasons.refresh(); }}
          />
        ) : (
          <div className="figs two">
            <div>
              {rejectCount.kind === 'failed' ? (
                <Failed error={periodQ.error ?? periodW.error} onRetry={() => { periodQ.refresh(); periodW.refresh(); }} />
              ) : rejectCount.kind === 'pending' ? (
                <div className="skel fig" />
              ) : (
                <>
                  <b className="fig-val">{fmtInt(rejectCount.n)}<span className="fig-unit">{W.fig.rejected}</span></b>
                  <span className="fig-note">{ratePct == null ? '—' : W.ofEverything(fmtPct1(ratePct))}</span>
                </>
              )}
            </div>
            <div>
              {topReason.kind === 'failed' ? (
                <Failed error={reasons.error} onRetry={reasons.refresh} />
              ) : topReason.kind === 'pending' ? (
                <div className="skel fig" />
              ) : (
                <>
                  <b className="fig-val">{topReason.row ? `${Math.round(topReason.row.pct)}%` : '—'}</b>
                  <span className="fig-note">
                    {topReason.row ? M.topReasonThisPeriod(reasonName(topReason.row)) : W.rejects.none}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          {/* The station and product lists are fetches too: when one fails
              its chip used to vanish without a word, which reads as "there
              are no stations", not "the list could not be loaded". */}
          {(stations.error && !stations.data) || (products.error && !products.data) ? (
            <Failed
              error={stations.error ?? products.error}
              onRetry={() => { stations.refresh(); products.refresh(); }}
            />
          ) : null}
          <Toolbar
            left={
              <>
                <StationChip stations={stations.data?.stations ?? []} value={station} onChange={onStationChange} />
                <ProductChip products={products.data?.products ?? []} value={product} onChange={onProductChange} />
                {code && (
                  <span className="chip on">
                    {M.codeChip(activeReason ? reasonName(activeReason) : code)}{' '}
                    <button type="button" className="linkish x" onClick={() => onCodeChange(null)} aria-label={`${M.clearCode} ${M.codeChip('')}`}>
                      ×
                    </button>
                  </span>
                )}
              </>
            }
          />
        </div>
        {/* The product caveat, only under a product filter: the same fact Line
            states for cones, for the rejects this screen counts. */}
        {product != null && unattributed && unattributed.rows > 0 && (
          <p className="mut sm" style={{ marginTop: 10 }}>
            {M.predateProduct(fmtInt(unattributed.rows), fmtInt(unattributed.of))}
          </p>
        )}
      </Block>

      {/* The rate over time on the left, what is causing it on the right:
          the two questions are read together, not one after the other. */}
      {/* Title and note both conditional: the shaded band is only drawn
          when the selected period overlaps the trailing window (pick older
          dates and there is no band), and "names have not been supplied"
          must not print on a screen where every shown code IS named — the
          same screen offers "Name it" and writes those labels. */}
      <Block
        label={periodOverlapsWindow ? M.trendTitle(win.requestedDays) : M.trendTitleNoShade(win.requestedDays)}
        note={anyReasonUnnamed ? W.rejects.namesAwaited : null}
      >
        <div className="two-col">
          <div>
            {/* Both series are fetches: a failed weight series used to leave
                the chart drawing quality alone, with nothing to say the other
                half was missing. Only when one reason is followed does the
                weight series not matter (the chart draws the reason alone). */}
            {quality.error && !quality.data ? (
              <Failed error={quality.error} onRetry={quality.refresh} />
            ) : !code && weight.error && !weight.data ? (
              <Failed error={weight.error} onRetry={weight.refresh} />
            ) : codedPending && coded.error ? (
              <Failed error={coded.error} onRetry={coded.refresh} />
            ) : (quality.loading && !quality.data) || (!code && weight.loading && !weight.data) || codedPending ? (
              <SkelChart />
            ) : (
              <RejectTrendChart
                quality={(codedTrend ?? quality.data?.data)?.buckets ?? []}
                weight={codedTrend ? null : (weight.data?.data?.buckets ?? null)}
                singleName={codedTrend && activeReason ? reasonName(activeReason) : null}
                periodFrom={period.from}
                periodTo={period.to}
                labelFmt={dayLabel}
              />
            )}
          </div>
          <div>
            {reasons.error && !reasons.data ? (
              <Failed error={reasons.error} onRetry={reasons.refresh} />
            ) : (
              <Reasons
                rows={reasonRows}
                loading={reasons.loading && !reasons.data}
                canName={canName}
                active={code}
                onChoose={(r) => onCodeChange(code === rejectCodeParam(r) ? null : rejectCodeParam(r))}
                onNamed={reasons.refresh}
              />
            )}
          </div>
        </div>
      </Block>

      <Block label={M.byDayTitle} note={M.byDayNote}>
        {byDay.error && !byDay.data ? (
          <Failed error={byDay.error} onRetry={byDay.refresh} />
        ) : byDay.loading && !byDay.data ? (
          <SkelLines n={6} />
        ) : (
          <ByDayTable rows={byDay.data?.data.rows ?? []} onOpen={onOpenReason} />
        )}
      </Block>

      <Block tight>
        <p>
          <button type="button" className="linkish" onClick={onSeeCones}>{W.rejects.seeTheCones}</button>{' '}
          <span className="mut">· {W.rejects.seeTheConesNote}</span>
        </p>
        <p style={{ marginTop: 8 }}>
          <button type="button" className="linkish" onClick={onSeeStations}>{W.rejects.byStation}</button>{' '}
          <span className="mut">· {W.rejects.byStationNote}</span>
        </p>
      </Block>

      <div className="page">
      <Details>
        <p>
          {M.reasonsFollowPeriod} {M.detectorFixed(win.requestedDays)}
          {/* The window clamps at the first day on record, not at a hole in
              the middle — and the record has one (10 Jul → 5 Aug 2026). Say
              how many of the requested days actually hold anything. */}
          {(() => {
            const held = daysWithReadings([
              ...(quality.data?.data.buckets ?? []),
              ...(weight.data?.data.buckets ?? []),
            ]);
            return held > 0 && held < win.requestedDays ? ` ${W.rejects.daysHoldReadings(held, win.requestedDays)}` : '';
          })()}
          {' '}A day is marked as a rise when its rate sits above the
          usual range for that many cones, and consecutive marked days are joined into one episode.
        </p>
        <p>{codedTrend ? M.bandNoteOneSeries : M.bandNote}</p>
        {(quality.data?.data.spansGenerations || weight.data?.data.spansGenerations) && (
          <p className="mut">{W.rejects.spansGenerations}</p>
        )}
        <p>
          Weight and quality rejects are counted separately throughout: a rise in one says nothing about the other.
          Reject rate is rejected cones over everything weighed, rejected cones included.
        </p>
        <p className="mut">{M.dayBasisCaveat}</p>
      </Details>
      </div>
    </>
  );
}

/** An episode that reaches the most recent day is still going. */
function ongoing(d: RejectSpcData | null | undefined) {
  if (!d || d.buckets.length === 0) return null;
  const last = d.buckets[d.buckets.length - 1]!.bucketTs;
  return d.episodes.find((e) => e.endTs === last) ?? null;
}

const dayLabel = (ts: string) =>
  new Date(ts).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

function reasonName(r: { label: string | null; tubeCode: number | null; materialCode: number | null; rejectType?: string }): string {
  if (r.label) return r.label;
  if (r.rejectType === 'weight') return W.readings.weightReject;
  if (r.tubeCode == null && r.materialCode == null) return W.rejects.noCode;
  return W.rejects.codeUnnamed(`${r.tubeCode ?? '—'}/${r.materialCode ?? '—'}`);
}

/* --------------------------------------------------------------- filters */

function StationChip({ stations, value, onChange }: { stations: StationRow[]; value: number | null; onChange: (v: number | null) => void }) {
  if (stations.length === 0) return null;
  return (
    <label className="chip">
      {W.rejectsMore.filterStation}
      <select
        value={value ?? ''}
        aria-label={W.rejectsMore.filterStation}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
      >
        <option value="">{W.rejectsMore.all}</option>
        {stations.map((s) => (
          <option key={s.stationId} value={s.stationId}>{stationLabel(s, s.stationId)}</option>
        ))}
      </select>
    </label>
  );
}

function ProductChip({ products, value, onChange }: { products: ProductOption[]; value: number | null; onChange: (v: number | null) => void }) {
  // Six PDAS materials on this line share the description "205-IL0-SD";
  // printed plain, the select repeated it six times (15 Sep 2026).
  const labels = useMemo(() => distinctProductLabels(products), [products]);
  if (products.length === 0) return null;
  return (
    <label className="chip">
      {W.rejectsMore.filterProduct}
      <select
        value={value ?? ''}
        aria-label={W.rejectsMore.filterProduct}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
      >
        <option value="">{W.rejectsMore.all}</option>
        {products.map((p) => (
          <option key={p.productId} value={p.productId}>{labels.get(p.productId) ?? productLabel(p)}</option>
        ))}
      </select>
    </label>
  );
}

/* ---------------------------------------------------------------- reasons */

function Reasons({
  rows,
  loading,
  canName,
  active,
  onChoose,
  onNamed,
}: {
  rows: RejectReason[];
  loading: boolean;
  canName: boolean;
  active: string | null;
  onChoose: (r: RejectReason) => void;
  onNamed: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  if (loading) return <SkelLines n={6} short />;
  if (rows.length === 0) return <Empty message={W.rejects.none} />;
  const max = Math.max(...rows.map((r) => r.count), 1);
  // UX Phase 5 Brief 4, unit U4 (16 Sep 2026): the "vital few" — the smallest
  // leading run of reasons whose cumulative share already reaches 80%. Pure
  // arithmetic over the server's own running cumulativePct (lib/pareto.ts);
  // no severity grouping, no cause inference — reject code MEANINGS are still
  // an unanswered IFL question (Q10).
  const vitalCount = vitalFew(rows, 80);
  const vitalPct = vitalCount > 0 ? rows[vitalCount - 1]!.cumulativePct : 0;

  // The inline rename, with its failure reported rather than swallowed: the
  // old handler awaited setRejectLabel with no catch, so a 403 or an outage
  // closed the editor as if the name had been saved.
  const save = async (r: RejectReason) => {
    try {
      await setRejectLabel(r.rejectCodeId!, draft.trim() || null);
      setSaveError(null);
      setEditing(null);
      onNamed();
    } catch (e) {
      setSaveError(String((e as Error).message ?? e));
    }
  };

  return (
    <div>
      <p className="mut sm" style={{ marginTop: 0, marginBottom: 4 }}>{W.rejects.vitalFew(vitalCount, fmtPct1(vitalPct))}</p>
      <p className="mut sm" style={{ marginTop: 0, marginBottom: 8 }}>{W.rejectsMore.clickBarHint}</p>
      <div className="bars">
        {rows.map((r) => {
          const isActive = active === rejectCodeParam(r);
          return (
            <div key={`${r.rejectType}:${r.tubeCode}:${r.materialCode}`}>
              {/* The bar's name is the control: choosing it follows this
                  reason through the trend and the days below. */}
              <button
                type="button"
                className={`linkish${r.label ? '' : ' g'}`}
                style={{ textAlign: 'left', fontWeight: isActive ? 600 : undefined }}
                aria-pressed={isActive}
                onClick={() => onChoose(r)}
              >
                {reasonName(r)}
              </button>
              <i style={{ width: `${Math.round((100 * r.count) / max)}%`, background: isActive ? 'var(--ink)' : r.label ? 'var(--graphite)' : 'var(--grid)' }} />
              {/* Roadmap UX Phase 5 Brief 4 (16 Sep 2026): the cumulative share joins
                  count/pct in this SAME cell — report/Reject.tsx:57 gives cumulativePct
                  its own <em>, but that report row has no naming control competing for
                  the fourth .bars grid column (app.css:616) that this row's Name-it
                  button/editor already occupies; a fifth cell would overflow the
                  4-column grid template. aria-label carries W.rejects.cumulativePct
                  since there is no <th> here to hold it. */}
              <em aria-label={W.rejects.cumulativePct}>
                {fmtInt(r.count)} · {Math.round(r.pct)}% · {fmtPct1(r.cumulativePct)} cum.
              </em>
              {canName && r.rejectCodeId != null ? (
                editing === r.rejectCodeId ? (
                  <span className="row" style={{ gap: 6 }}>
                    <input
                      type="text"
                      value={draft}
                      autoFocus
                      aria-label="Name for this code"
                      style={{ width: 120, fontSize: 'var(--fs-small)', padding: '2px 6px' }}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setEditing(null); setSaveError(null); }
                        if (e.key === 'Enter') void save(r);
                      }}
                    />
                  </span>
                ) : (
                  <button type="button" className="linkish sm" onClick={() => { setEditing(r.rejectCodeId!); setDraft(r.label ?? ''); setSaveError(null); }}>
                    {W.rejects.nameIt}
                  </button>
                )
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
      {saveError && (
        <p className="state err sm" role="alert" style={{ padding: '8px 0' }}>
          {W.rejectsMore.renameFailed} <span className="sr-only">{saveError}</span>
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------- by day, by code */

function ByDayTable({ rows, onOpen }: { rows: RejectDayCodeRow[]; onOpen: (r: ReasonRef) => void }) {
  const M = W.rejectsMore;
  if (rows.length === 0) return <Empty message={M.noneForFilters} />;
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: '9em' }}>{M.colDay}</th>
          <th>{M.colReason}</th>
          <th className="n" style={{ width: '6em' }}>{M.colCount}</th>
          <th className="n" style={{ width: '9em' }}>{M.colCones}</th>
          <th className="n" style={{ width: '6em' }}>{M.colRate}</th>
          <th className="n" style={{ width: '2em' }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const ref: ReasonRef = { day: r.day, rejectType: r.rejectType, tubeCode: r.tubeCode, materialCode: r.materialCode };
          const key = `${r.day}|${rejectCodeParam(r)}`;
          return (
            <tr key={key} className="click" tabIndex={0} onClick={() => onOpen(ref)} onKeyDown={rowKeys(() => onOpen(ref))}>
              <td>{fmtDay(`${r.day}T00:00:00Z`)}</td>
              <td className={r.label ? '' : 'g'}>{reasonName(r)}</td>
              <td className="n">{fmtInt(r.count)}</td>
              <td className="n">{fmtInt(r.cones)}</td>
              <td className="n">{r.ratePct == null ? '—' : fmtPct1(r.ratePct)}</td>
              <td className="n"><Chevron label={W.openRecord} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
