/**
 * Quality > Rejects (task E7). TRACE A3-039..A3-043, A1-038, A1-040, A1-063..A1-067, A2-018, A2-022, A2-073, A4-13, G-9.
 *
 * What this screen answers: how many cones failed a check, why, is it getting worse, and where?
 *
 *  - ONE STATUS VOCABULARY. "Failed inspection" and "Failed weight check (scale)" are two verdicts, drawn as
 *    two figures, never merged and never a bare "rejected". Both rates divide by the cones checked the
 *    server reports (`totalInspected`), the definition Today and Reports use.
 *  - THE REASON LIST AND THE MATRIX FOLLOW THE PERIOD; THE TREND DOES NOT. The trend and its "rising"
 *    verdict look at a fixed window of production days (the detectors need consecutive days), and the
 *    chart says so.
 *  - ONE FILTER SET. Station (`st`), product (`pr`) and the followed reason (`jc`) narrow what they are
 *    documented to narrow; the URL carries all three.
 *  - EVERY FETCH HAS ITS OWN FAILURE STATE that names the part. A failed fetch never reads as "none".
 *  - Capped lists: eight reasons in the Pareto, the list and the matrix, then "Show all N".
 */
import { useEffect, useMemo, useState } from 'react';
import {
  getProducts,
  getRejectSpcFiltered,
  getRejectsByDayCode,
  getRejectsFiltered,
  getStations,
  type RejectFilters,
} from '../../../bridge/api';
import { period as P, productLabel } from '../../../bridge/lib';
import { C, FRAGMENTS } from '../../../copy';
import { fmtDate, fmtRange } from '../../../lib/fmt';
import { SHAPE, useData, useRange, useLive } from '../../../data';
import { usePeriod } from '../../../data/usePeriod';
import { Pareto, LineChart } from '../../../charts';
import { NameIt } from '../../../sheets/ReasonSheet/NameIt';
import { Chip } from '../../../ui/Chip';
import { Disclosure } from '../../../ui/Disclosure';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { SelectField } from '../../../ui/Field';
import { Icon } from '../../../ui/Icon';
import { KpiCard } from '../../../ui/KpiCard';
import { hrefFor, plainClick } from '../../../ui/nav';
import { PageHead } from '../../../ui/PageHead';
import { ChartSkeleton, KpiRowSkeleton, Skeleton } from '../../../ui/Skeleton';
import type { Route } from '../../../route';
import type { ScreenProps } from '../../registry';
import { QualityTabs } from '../QualityTabs';
import { HeatMatrix } from './HeatMatrix';
import {
  TOP_REASONS,
  buildHeat,
  conesHop,
  coverage,
  dayLabel,
  figures,
  inspectionReasons,
  paretoRows,
  ratePct,
  reasonIdOf,
  risingState,
  stationsHop,
  type ReasonRow,
} from './model';
import { fmtCount, fmtRate, rateNum, reasonName, reasonShort } from './format';
import './qualityRejects.css';

const R = C.qualityRejects;

/** Plot height of the Pareto's card while the page waits for the plant clock (the loaded card is 442 px tall: head, legend, readout, plot, caption). */
const PARETO_SKEL_H = 374;
const RF = FRAGMENTS.qualityRejects;

/** A request that never settles: the part stays "loading" until its inputs exist, with no request and no error. */
const wait = (): Promise<never> => new Promise<never>(() => {});

const keyOf = (p: P.Period): string => [p.key, p.from, p.to, p.shift ?? '', p.fromShift ? P.encodeShiftRef(p.fromShift) : '', p.toShift ? P.encodeShiftRef(p.toShift) : ''].join('|');
const intKey = (v: string | undefined): number | null => (v !== undefined && /^\d{1,9}$/.test(v) ? Number(v) : null);

export function QualityRejectsScreen(props: ScreenProps) {
  return (
    <>
      <QualityTabs route={props.route} go={props.go} />
      <RejectsBody {...props} />
    </>
  );
}

function RejectsBody({ route, rank, go }: ScreenProps) {
  const { period, status: periodStatus, failed: periodFailed } = usePeriod();
  const { line } = useLive();
  const range = useRange();

  const station = intKey(route.keys.st);
  const product = intKey(route.keys.pr);
  const code = route.keys.jc ?? null;
  const [showAll, setShowAll] = useState(false);

  const setKey = (k: 'st' | 'pr' | 'jc', v: string | null, replace = false) => {
    const keys = { ...route.keys };
    if (v === null || v === '') delete keys[k];
    else keys[k] = v;
    go({ ...route, keys }, replace ? { replace: true } : undefined);
  };

  // ---- the filters every request shares
  const narrow: RejectFilters = { station: station ?? undefined, product: product ?? undefined, tsTo: period?.tsTo };
  const narrowKey = `${station ?? 'any'}:${product ?? 'any'}:${route.keys.at ?? 'now'}`;
  const pq = period ? P.periodQuery(period) : null;
  const periodF: RejectFilters | null =
    period && pq ? { ...narrow, from: period.from, to: period.to, shift: period.shift, fromShift: pq.fromShift, toShift: pq.toShift } : null;
  const pKey = period ? `${keyOf(period)}:${narrowKey}` : 'wait';
  const polls = period?.live === true;

  // ---- the period's figures, reasons and days
  const reasons = useData('reasons', () => (periodF ? getRejectsFiltered(periodF) : wait()), `rj:reasons:${pKey}`, { live: polls, shape: SHAPE.rejectsWithCounts });
  const periodQ = useData('the failed-inspection rate', () => (periodF ? getRejectSpcFiltered({ ...periodF, from: periodF.from!, to: periodF.to!, rejectType: 'quality', bucket: 'day' }) : wait()), `rj:pq:${pKey}`, { live: polls, shape: SHAPE.rejectSpc });
  const periodW = useData('the weight-reject rate', () => (periodF ? getRejectSpcFiltered({ ...periodF, from: periodF.from!, to: periodF.to!, rejectType: 'weight', bucket: 'day' }) : wait()), `rj:pw:${pKey}`, { live: polls, shape: SHAPE.rejectSpc });
  const byDay = useData('the days by reason', () => (periodF ? getRejectsByDayCode({ ...periodF, from: periodF.from!, to: periodF.to! }) : wait()), `rj:byday:${pKey}`, { live: polls });

  // ---- the trend: the fixed window, never the period
  const rangeSettled = range.status === 'ok' || range.status === 'error' || range.status === 'empty';
  const win =
    line && rangeSettled
      ? P.trailingWindow({
          shiftDate: line.shift.shiftDate,
          shiftCode: line.shift.code,
          shiftStartUtc: line.shift.startUtc,
          plantNowUtc: line.plantNowUtc,
          dataAsOfUtc: line.dataAsOfUtc,
          firstDay: range.data?.minDate ?? null,
        })
      : null;
  const trend = useData(
    'the trend',
    () => (win ? getRejectSpcFiltered({ ...narrow, from: win.from, to: win.to, rejectType: code ? 'all' : 'quality', bucket: 'day', code: code ?? undefined }) : wait()),
    `rj:trend:${win?.from ?? 'wait'}:${win?.to ?? ''}:${narrowKey}:${code ?? ''}`,
    { live: polls, shape: SHAPE.rejectSpc },
  );

  const stations = useData('the station list', () => getStations(), 'stations', { live: false });
  const products = useData('the product list', () => getProducts(), 'products', { live: false });

  // ---- shaped
  const rows = useMemo<ReasonRow[]>(() => inspectionReasons(reasons.data?.data.reasons ?? []), [reasons.data]);
  const shown = showAll ? rows : rows.slice(0, TOP_REASONS);
  const heat = useMemo(() => buildHeat(byDay.data?.data.rows ?? [], rows), [byDay.data, rows]);
  const fig = figures(periodQ.data?.data ?? null, periodW.data?.data ?? null);
  const active = code ? (rows.find((r) => r.code === code) ?? null) : null;

  // A followed reason the period cannot name any more is dropped (replace, not push: an automatic correction).
  useEffect(() => {
    if (code && reasons.status !== 'loading' && reasons.status !== 'error' && !active) setKey('jc', null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, reasons.status, active]);

  const openReason = (reason: ReasonRow, day: string) =>
    go({ ...route, sheet: { kind: 'reason', id: reasonIdOf({ day, rejectType: 'quality', tubeCode: reason.tubeCode, materialCode: reason.materialCode }) } });
  const hop = (r: Route) => ({ href: hrefFor(r), onClick: (e: React.MouseEvent) => plainClick(e, () => go(r)) });

  if (periodStatus === 'error') {
    return <ErrorState part={periodFailed[0] ?? 'the plant clock'} onRetry={() => window.location.reload()} />;
  }
  if (!period) {
    return (
      <div className="qr">
        <PageHead title={C.tabs.quality.rejects} sentence={' '} />
        <div className="qr-filters qr-filters--skel" aria-hidden="true" />
        <KpiRowSkeleton cards={3} minWidth={224} />
        <ChartSkeleton part={RF.part.reasons} height={PARETO_SKEL_H} />
      </div>
    );
  }

  const afterNewest = !!line?.dataAsOfUtc && P.periodAfterNewest(period, line.dataAsOfUtc);
  const top = rows[0] ?? null;

  // ---- headline: said only when both parts are known
  const headline =
    fig && reasons.status === 'ok'
      ? `${fmtRate(fig.inspectionPct)} of cones failed inspection.${top ? ` ${reasonName(top)} accounts for ${rateNum(top.share)} % of them.` : ''}`
      : R.question;

  const risk = risingState(trend.data?.data ?? null);
  const trendRows = trend.data?.data.buckets ?? [];
  const mean = trend.data?.data.pBar != null ? 100 * trend.data.data.pBar : null;
  const heldDays = P.daysWithReadings(trendRows);
  const trendStatus = trend.status === 'loading' ? 'loading' : trend.status === 'error' ? 'error' : trendRows.length === 0 ? 'empty' : 'ready';

  const kpiStatus = (...parts: Array<{ status: string }>): 'loading' | 'error' | 'ok' =>
    parts.some((p) => p.status === 'error') ? 'error' : parts.some((p) => p.status === 'loading') ? 'loading' : 'ok';
  const figStatus = kpiStatus(periodQ, periodW);
  const figState: 'loading' | 'error' | 'ok' = figStatus === 'ok' && !fig ? 'error' : figStatus;
  const retryFigs = () => { periodQ.refresh(); periodW.refresh(); };
  const figError = periodQ.error ?? periodW.error;
  const unattributed = reasons.data?.data.unattributed ?? null;

  const cover = coverage(rows, TOP_REASONS);
  const days = win ? win.requestedDays : null;

  return (
    <div className="qr">
      <PageHead title={C.tabs.quality.rejects} sentence={headline} />
      <p className="qr-note qr-period">{fmtRange(period.from, period.to)}</p>
      {(periodQ.data?.data.spansGenerations || periodW.data?.data.spansGenerations) && <p className="qr-note">{R.periodGenerations}</p>}

      <div className="qr-filters">
        <SelectField
          label={R.filterStation}
          value={station === null ? '' : String(station)}
          placeholder={R.all}
          onChange={(v) => setKey('st', v)}
          options={(stations.data?.stations ?? []).map((s) => ({ value: String(s.stationId), label: C.stationOption(s) }))}
        />
        <SelectField
          label={R.filterProduct}
          value={product === null ? '' : String(product)}
          placeholder={R.all}
          onChange={(v) => setKey('pr', v)}
          options={(() => {
            const list = products.data?.products ?? [];
            // Six PDAS materials share one description; the distinct-label rule lives in lib/productLabel.
            const labels = productLabel.distinctProductLabels(list);
            return list.map((p) => ({ value: String(p.productId), label: labels.get(p.productId) ?? productLabel.productLabel(p) }));
          })()}
        />
        {code && active && (
          <Chip label={R.reasonChip(reasonName(active))} onRemove={() => setKey('jc', null)}>
            {R.reasonChip(reasonName(active))}
          </Chip>
        )}
      </div>
      {(stations.status === 'error' || products.status === 'error') && (
        <ErrorState
          part={stations.status === 'error' ? RF.part.stations : RF.part.products}
          cause={stations.error ?? products.error}
          onRetry={() => { stations.refresh(); products.refresh(); }}
        />
      )}
      {product !== null && unattributed && unattributed.rows > 0 && (
        <p className="qr-note">{R.predateProduct(fmtCount(unattributed.rows), fmtCount(unattributed.of))}</p>
      )}

      {/* ---- KPI row: two verdicts and the top reason, never merged */}
      <section className="qr-sec" aria-label={R.failedInspection}>
        <div className="qr-kpis">
            <KpiCard
              label={R.failedInspection}
              icon={<Icon name="rejects" size={18} />}
              value={fig ? rateNum(fig.inspectionPct) : null}
              unit="%"
              chip={1}
              status={figState}
              part={RF.part.figureInspection}
              onRetry={retryFigs}
              note={fig && figState === 'ok' ? R.ofChecked(fmtCount(fig.inspectionN), fmtCount(fig.inspected)) : null}
            />
            <KpiCard
              label={R.weightRecords}
              icon={<Icon name="weight" size={18} />}
              value={fig ? rateNum(fig.weightPct) : null}
              unit="%"
              chip={3}
              status={figState}
              part={RF.part.figureWeight}
              onRetry={retryFigs}
              note={fig && figState === 'ok' ? R.recordsOf(fmtCount(fig.weightN), fmtCount(fig.inspected)) : null}
            />
            <KpiCard
              label={R.topReasonShare}
              icon={<Icon name="rejects" size={18} />}
              value={top ? rateNum(top.share) : null}
              unit="%"
              chip={2}
              status={reasons.status === 'error' ? 'error' : reasons.status === 'loading' ? 'loading' : top ? 'ok' : 'empty'}
              part={RF.part.reasons}
              onRetry={reasons.refresh}
              note={top ? `${reasonName(top)} · ${fmtCount(top.count)} ${RF.cones}` : null}
            />
        </div>
        {figState === 'error' && figError && <p className="qr-note">{figError}</p>}
        {fig && figState === 'ok' && (
          <p className="qr-note">{R.together(fmtCount(fig.inspectionN + fig.weightN), fmtRate(fig.togetherPct), fmtCount(fig.inspected))}</p>
        )}
      </section>

      {/* ---- Pareto and the list that makes it clickable */}
      <section className="qr-sec" aria-label={R.paretoTitle}>
        {reasons.status === 'error' ? (
          <ErrorState part={RF.part.reasons} cause={reasons.error} onRetry={reasons.refresh} />
        ) : reasons.status === 'loading' ? (
          <div className="qr-two">
            <Pareto chartId="qr-pareto" title={R.paretoTitle} unit={RF.cones} rows={[]} status="loading" reserve={{ legend: true, captionLines: 2 }} />
            <Skeleton part={RF.part.reasons} height={PARETO_SKEL_H} onRetry={reasons.refresh} />
          </div>
        ) : rows.length === 0 ? (
          afterNewest ? <EmptyState newest={line?.dataAsOfUtc ?? null} /> : <EmptyState message={R.noReasons} />
        ) : (
          <div className="qr-two">
            <Pareto
              chartId="qr-pareto"
              title={R.paretoTitle}
              unit={RF.cones}
              rows={paretoRows(shown, reasonShort)}
              caption={cover ? `${R.coverTop(cover.k, rateNum(cover.pct) + ' %')} ${R.paretoCaption(fmtRange(period.from, period.to), fmtCount(rows.reduce((s, r) => s + r.count, 0)))}` : undefined}
              errorPart={RF.part.reasons}
              reserve={{ legend: true, captionLines: 2 }}
            />
            <div>
              <ul className="qr-list" aria-label={R.paretoTitle}>
                <li className="qr-list__row qr-list__head" aria-hidden="true">
                  <span>{R.colReason}</span>
                  <span className="qr-list__num">{R.colCones}</span>
                  <span className="qr-list__num">{R.colShare}</span>
                </li>
                {shown.map((r) => (
                  <li key={r.code} className={`qr-list__row${code === r.code ? ' qr-list__row--on' : ''}`}>
                    <span className="qr-list__name">
                      <button
                        type="button"
                        className="qr-list__pick"
                        aria-pressed={code === r.code}
                        title={R.follow}
                        onClick={() => setKey('jc', code === r.code ? null : r.code)}
                      >
                        {reasonName(r)}
                      </button>
                      <NameIt rank={rank} codeId={r.rejectCodeId} label={r.label} onSaved={reasons.refresh} />
                    </span>
                    <span className="qr-list__num">{fmtCount(r.count)}</span>
                    <span className="qr-list__num">{`${rateNum(r.share)} %`}</span>
                  </li>
                ))}
              </ul>
              {rows.length > TOP_REASONS && (
                <div className="qr-more">
                  <button type="button" className="ui-link" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                    {showAll ? R.showTop(TOP_REASONS) : R.showAll(rows.length)}
                  </button>
                </div>
              )}
              {rows.some((r) => !r.label) && <p className="qr-note">{R.namesAwaited}</p>}
            </div>
          </div>
        )}
      </section>

      {/* ---- reason x day */}
      <section className="qr-sec" aria-labelledby="qr-heat-h">
        <h2 id="qr-heat-h" className="qr-sec__h">{R.heatTitle}</h2>
        {byDay.status === 'error' ? (
          <ErrorState part={RF.part.byDay} cause={byDay.error} onRetry={byDay.refresh} />
        ) : byDay.status === 'loading' || reasons.status === 'loading' ? (
          <Skeleton part={RF.part.byDay} height={240} onRetry={byDay.refresh} />
        ) : heat.days.length === 0 || shown.length === 0 ? (
          <EmptyState message={R.heatNoRows} />
        ) : (
          <>
            <HeatMatrix heat={heat} rows={heat.rows.slice(0, shown.length)} activeCode={code} onOpen={(row, day) => openReason(row.reason, day)} />
            {rows.length > TOP_REASONS && (
              <p className="qr-note">
                {showAll ? '' : `${R.heatCapped(TOP_REASONS, rows.length)} `}
                <button type="button" className="ui-link" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? R.showTop(TOP_REASONS) : R.showAll(rows.length)}
                </button>
              </p>
            )}
          </>
        )}
      </section>

      {/* ---- trend: fixed window with a mean line */}
      <section className="qr-sec" aria-label={active ? R.trendTitleOne(reasonName(active), days) : R.trendTitle(days)}>
        {risk && trendStatus === 'ready' && (
          <p className="qr-verdict" role="status">
            {risk.since
              ? R.rising(dayLabel(risk.since))
              : risk.episodes > 0 && risk.lastEnded
                ? R.notRisingAfter(risk.episodes, dayLabel(risk.lastEnded))
                : R.notRising}
          </p>
        )}
        {trendStatus === 'empty' ? (
          <p className="qr-note" role="status">{R.trendEmpty(days, line?.dataAsOfUtc ? fmtDate(line.dataAsOfUtc) : null)}</p>
        ) : (
        <LineChart
          chartId="qr-trend"
          title={active ? R.trendTitleOne(reasonName(active), days) : R.trendTitle(days)}
          unit={RF.trendUnit}
          zeroBase
          categories={trendRows.map((b) => dayLabel(b.bucketTs))}
          series={[
            { name: R.seriesDaily, values: trendRows.map((b) => ratePct(b.rate)), slot: 1 },
            ...(mean != null ? [{ name: R.seriesMean, values: trendRows.map(() => mean), slot: 5 }] : []),
          ]}
          formatValue={(v) => rateNum(v)}
          caption={`${R.trendCaption}${win && heldDays > 0 && heldDays < win.requestedDays ? ` ${R.daysHold(heldDays, win.requestedDays)}` : ''}`}
          status={trendStatus}
          errorPart={RF.part.trend}
          onRetry={trend.refresh}
        />
        )}
      </section>

      {/* ---- hops (TRACE G-9) */}
      <nav className="qr-hops" aria-label="Related">
        <p>
          <a className="ui-link" {...hop(conesHop(route))}>{R.hopCones}</a>
          <span className="qr-note"> · {RF.hopConesNote}</span>
        </p>
        <p>
          <a className="ui-link" {...hop(stationsHop(route))}>{R.hopStations}</a>
          <span className="qr-note"> · {RF.hopStationsNote}</span>
        </p>
      </nav>

      <Disclosure id="qr-about" label={C.ui.aboutFigures}>
        <div className="qr-about">
          {fig && <p>{R.aboutCounts(fmtCount(fig.inspectionN), fmtCount(fig.weightN))}</p>}
          {fig && <p>{R.aboutScale(fmtCount(fig.weightN))}</p>}
          {R.about.map((t) => <p key={t}>{t}</p>)}
          {win && <p>{R.detectorFixed(win.requestedDays)}</p>}
          {trend.data?.data.spansGenerations && <p>{R.spansBatches}</p>}
          <p>{R.dayBasis}</p>
        </div>
      </Disclosure>
    </div>
  );
}
