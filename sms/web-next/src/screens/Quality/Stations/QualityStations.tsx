/**
 * Quality > Stations (task E5; board design/redesign-2026-10/mockups/QualityStations.dc.html).
 *
 * The one station table, worst first. Its columns are two separate things and say so:
 *   - "This period": the state (decided on the server), cones, failed inspection, failed weight
 *     check (the scale's own verdict) and the mean weight against the product target.
 *   - "Pattern check", boxed: ALWAYS the last 14 production days, whatever the period chip says,
 *     because the pattern tests need consecutive days (CLAUDE.md, redesign rule 3; defect F38).
 * A row opens the station sheet (`sheet=station:N`). Nothing here advises an adjustment in grams:
 * weighing data cannot tell a scale that reads heavy from cones that really are heavy.
 */
import { useCallback } from 'react';
import { health as healthLib, fmt } from '../../../bridge/lib';
import { W } from '../../../bridge/words';
import { C, RESERVED, FRAGMENTS } from '../../../copy';
import { fmtRange } from '../../../lib/fmt';
import { PageHead } from '../../../ui/PageHead';
import { useRange, useStationStatus, usePeriod, useLive } from '../../../data';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { Disclosure } from '../../../ui/Disclosure';
import { Skeleton } from '../../../ui/Skeleton';
import { StatusPill } from '../../../ui/StatusPill';
import { QualityTabs } from '../QualityTabs';
import type { ScreenProps } from '../../registry';
import { buildRows, missingFromFeed, pct, sortWorstFirst } from './model';
import { StationsTable } from './StationsTable';
import { usePatternCheck, useStationCounts } from './useStationsData';
import './stations.css';

const S = C.qualityStations;
const SF = FRAGMENTS.qualityStations;

/** The line has fourteen stations; the loading table draws that many rows at the table's own row height. */
const SKEL_ROWS = 14;
const STATION_ROW_H = 52;

function span(from: string, to: string): string {
  return fmtRange(from, to);
}

function stationList(ns: readonly number[]): string {
  if (ns.length === 1) return `Station ${ns[0]}`;
  return `Stations ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

export function QualityStationsScreen(props: ScreenProps) {
  const { route, go } = props;
  const per = usePeriod();
  const tabs = <QualityTabs route={route} go={go} />;
  return (
    <div className="qs-page">
      {tabs}
      {per.period ? (
        <Body {...props} period={per.period} />
      ) : per.status === 'error' ? (
        <ErrorState part={C.periodUi.title.toLowerCase()} cause={C.periodUi.clockUnread} />
      ) : (
        <Skeleton part={C.periodUi.loading} height={320} />
      )}
    </div>
  );
}

function Body({ route, go, period }: ScreenProps & { period: NonNullable<ReturnType<typeof usePeriod>['period']> }) {
  const status = useStationStatus(period);
  const counts = useStationCounts(period);
  const pattern = usePatternCheck(period, SF.partPattern);
  const range = useRange();
  const { line } = useLive();
  const dataNow = healthLib.assessHealth(line).kind === 'ok';

  const open = useCallback(
    (n: number) => go({ ...route, sheet: { kind: 'station', id: String(n) } }),
    [go, route],
  );

  const selected = route.sheet?.kind === 'station' ? Number(route.sheet.id) : null;
  const periodSpan = span(period.from, period.to);

  let content;
  if (status.status === 'loading') {
    content = (
      <>
        <PageHead title={S.title} sentence={' '} />
        <p className="qs-note qs-period">{' '}</p>
        <section className="card qs-card" aria-busy="true">
          <div className="qs-card__head"><div><h2 className="qs-card__title">{S.tableTitle}</h2><span className="caption">{' '}</span></div></div>
          <Skeleton part={SF.partStations} rows={SKEL_ROWS} rowHeight={STATION_ROW_H} onRetry={status.refresh} />
        </section>
      </>
    );
  } else if (status.status === 'error' || !status.data) {
    content = (
      <>
        <PageHead title={S.title} />
        <ErrorState part={SF.partStations} cause={status.error ?? undefined} onRetry={status.refresh} />
      </>
    );
  } else {
    const sd = status.data.data;
    const countsRows = counts.data ? counts.data.data.rows : null;
    const wsData = pattern.data ? pattern.data.data : null;
    const rows = sortWorstFirst(buildRows(sd.stations, countsRows, wsData));
    const totalCones = rows.reduce((n, r) => n + r.cones, 0);
    const nothing = rows.length === 0 || totalCones === 0;
    const newest = range.data ? range.data.maxDate : null;
    const acting = rows.filter((r) => r.state === 'act').length;
    const linePct = pct(sd.lineFailedPct, 2);
    const missing = missingFromFeed(rows);
    const anyMixed = rows.some((r) => r.target.kind === 'mixed');
    const patternSpan = wsData ? span(wsData.from, wsData.to) : null;
    const countsFailed = counts.status === 'error';
    const patternFailed = pattern.status === 'error';
    const t = sd.thresholds;
    const actOver = sd.lineFailedPct != null ? pct(Math.round(t.act * sd.lineFailedPct * 10) / 10) : null;
    const watchOver = sd.lineFailedPct != null ? pct(Math.round(t.watch * sd.lineFailedPct * 10) / 10) : null;

    content = (
      <>
        <PageHead
          title={S.title}
          sentence={
            nothing ? undefined : (
              <>
                <b className="qs-lead">{acting > 0 ? S.needAction(acting) : S.noneNeedAction}</b>
                {acting > 0 && linePct ? ` ${S.actRule(t.act, linePct)}` : ''}
              </>
            )
          }
        />
        <p className="qs-note qs-period">{S.periodCaption(periodSpan, period.days)}</p>

        {!dataNow && <p className="qs-fail">{S.dataNotCurrent}</p>}

        <section className="card qs-card" aria-labelledby="qs-table-title">
          <div className="qs-card__head">
            <div>
              <h2 id="qs-table-title" className="qs-card__title">{S.tableTitle}</h2>
              {!nothing && linePct && <span className="caption">{S.tableCaption(rows.length, fmt.fmtInt(totalCones), linePct)}</span>}
            </div>
            <div className="qs-legend" aria-label="States">
              <StatusPill state="act" />
              <StatusPill state="watch" />
              <StatusPill state="ok" />
              <StatusPill state="nodata" />
            </div>
          </div>

          {nothing ? (
            <EmptyState newest={newest} />
          ) : (
            <>
              <StationsTable
                rows={rows}
                periodSpan={periodSpan}
                patternSpan={patternSpan}
                countsFailed={countsFailed}
                patternFailed={patternFailed}
                selected={selected}
                onOpen={open}
              />
              {countsFailed && (
                <p className="qs-fail" role="alert">
                  {S.failedPart(SF.partCounts)}{' '}
                  <button type="button" className="ui-link" onClick={counts.refresh}>{C.tryAgain}</button>
                </p>
              )}
              {patternFailed && (
                <p className="qs-fail" role="alert">
                  {S.failedPart(SF.partPattern)}{' '}
                  <button type="button" className="ui-link" onClick={pattern.refresh}>{C.tryAgain}</button>
                </p>
              )}
              {anyMixed && <p className="qs-note">{W.weight.mixedTargetNote}</p>}
              {missing.length > 0 && <p className="qs-note">{S.stationsMissingFromFeed(stationList(missing))}</p>}
              <p className="qs-note">{S.failedWeightNote}</p>
              <Disclosure id="stations-how-states" label={S.howStatesDecided}>
                <p>
                  {actOver ? S.actRuleLong(t.act, actOver, periodSpan) : `Act: more than ${t.act} times the line's rate.`}{' '}
                  {watchOver ? S.watchRuleLong(t.watch, watchOver) : `Watch: more than ${t.watch} times.`}
                </p>
                <p>{S.tooFew(t.minCones)}</p>
                <p>{S.boxExplain}</p>
                <p>{RESERVED.assumedHeading}.</p>
              </Disclosure>
            </>
          )}
        </section>
      </>
    );
  }

  return <>{content}</>;
}
