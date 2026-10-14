/**
 * Station sheet (`sheet=station:N`), the evidence behind a station's row.
 *
 * Preserves everything the old sheet did (TRACE A3-059, A1-062/077/078, A6-S1, A6-H01..H07, G-4):
 * the working behind a finding, the daily means with click-to-zoom, the flagged days and the rule
 * that fired, the days-to-limit projection with its 90% range or "not established" (RT-020), the
 * adjustment ledger, the rank-2 adjustment form, the Nelson explanation, and the four hops.
 *
 * Two kinds of figure, kept apart on purpose:
 *   - for the period on the chip: the four KPIs, the reasons, the product;
 *   - the pattern check, ALWAYS the last 14 production days.
 * NO OVER-CLAIMING: no grams to adjust by (weighing data cannot tell a heavy scale from heavy
 * cones). The projection is a straight line through recent daily means and says so. A winder's
 * product is known only from the cones it weighed.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { NELSON_RULE_LABEL, type NelsonRuleId, type NelsonRuleInfo, type StationStatusRow, type WeightStationRow, type WeightStationsData } from '../../bridge/api';
import { fmt } from '../../bridge/lib';
import { projectionSentence } from '../../bridge/station';
import { W } from '../../bridge/words';
import { C, formatClock, formatDate, FRAGMENTS } from '../../copy';
import { useMachinesRunning, usePeriod, useStationStatus } from '../../data';
import { Disclosure } from '../../ui/Disclosure';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import { StatusPill } from '../../ui/StatusPill';
import { stationText } from '../../ui/StationTile';
import type { SheetProps } from '../../screens/registry';
import { patternOf, pct, signedG, targetOf } from '../../screens/Quality/Stations/model';
import { reasonShort } from '../../screens/Quality/Rejects/format';
import { useAdjustments, useLineReasons, useOneStationCounts, usePatternCheck } from '../../screens/Quality/Stations/useStationsData';
import { AdjustmentForm } from './AdjustmentForm';
import { DailyChart } from './DailyChart';
import { hopHref, hopRoute, type HopKind } from './hops';
import { stationProductText } from '../../lib/stationProduct';
import './stationSheet.css';

const S = C.qualityStations;
const SF = FRAGMENTS.qualityStations;

type Per = NonNullable<ReturnType<typeof usePeriod>['period']>;

interface Head {
  label: string;
  state: StationStatusRow['state'] | null;
  span: string | null;
}

export function StationSheet(props: SheetProps) {
  const per = usePeriod();
  const station = Number(props.route.sheet?.id);
  const valid = Number.isInteger(station) && station >= 1;
  // One Sheet for the whole life of the overlay: its focus trap and the "return focus to the row
  // that opened it" memory must not restart when the data arrives. The loaded body reports its
  // title and state up so the header can show them.
  const [head, setHead] = useState<Head | null>(null);

  let body: ReactNode;
  if (!valid) {
    body = <EmptyState message={W.stationNotFound} />;
  } else if (!per.period) {
    body =
      per.status === 'error' ? (
        <ErrorState part={C.periodUi.title.toLowerCase()} cause={C.periodUi.clockUnread} />
      ) : (
        <Skeleton part={C.periodUi.loading} height={240} />
      );
  } else {
    body = <Loaded {...props} station={station} period={per.period} setParams={per.setParams} onHead={setHead} />;
  }

  return (
    <Sheet
      open
      onClose={props.onClose}
      width={640}
      title={
        <>
          {valid ? (head?.label ?? C.station(station)) : C.nav.quality}
          {head?.span && <span className="ss-sub">{head.span}</span>}
        </>
      }
      status={head?.state ? <StatusPill state={head.state} /> : undefined}
    >
      {body}
    </Sheet>
  );
}

const short = (date: string) => formatDate(date);

function ruleLabel(id: number, rules: readonly NelsonRuleInfo[]): string {
  return rules.find((r) => r.id === id)?.label ?? NELSON_RULE_LABEL[id as NelsonRuleId] ?? `rule ${id}`;
}

function ruleList(ids: number[]): string {
  if (ids.length === 0) return '';
  if (ids.length === 1) return `rule ${ids[0]}`;
  return `rules ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

interface LoadedProps extends SheetProps {
  station: number;
  period: Per;
  setParams: ReturnType<typeof usePeriod>['setParams'];
  onHead: (h: Head) => void;
}

function Loaded({ route, rank, go, station, period, setParams, onHead }: LoadedProps) {
  const status = useStationStatus(period);
  const counts = useOneStationCounts(period, station);
  const pattern = usePatternCheck(period, SF.partSheetPattern);
  const reasons = useLineReasons(period);
  const log = useAdjustments(station);
  const machines = useMachinesRunning();

  const srow: StationStatusRow | undefined = status.data?.data.stations.find((s) => s.station === station);
  const wsd: WeightStationsData | null = pattern.data ? pattern.data.data : null;
  const wrow: WeightStationRow | undefined = wsd?.stations.find((s) => s.station === station);
  const machine = machines.data?.data.machines.find((m) => m.station === station) ?? null;
  const label = srow ? stationText(srow) : C.station(station);
  const periodSpan = period.from === period.to ? formatDate(period.from) : C.period(formatDate(period.from), formatDate(period.to));

  const headState = srow ? srow.state : null;
  useEffect(() => {
    onHead({ label, state: headState, span: periodSpan });
  }, [label, headState, periodSpan, onHead]);

  const gone = status.status === 'ok' && !srow && pattern.status === 'ok' && !wrow;

  const hop = (kind: HopKind) => {
    const next = hopRoute(route, kind, station);
    return { href: hopHref(next), onClick: (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      go(next);
    } };
  };

  return (
    <>
      {status.status === 'loading' && !srow ? (
        <Skeleton part={SF.partSheetStatus} height={320} onRetry={status.refresh} />
      ) : gone ? (
        <EmptyState message={W.stationNotFound} />
      ) : (
        <div className="ss">
          <Kpis srow={srow} statusFailed={status.status === 'error'} onRetry={status.refresh} counts={counts} wrow={wrow} wsd={wsd} />

          <Pattern
            station={station}
            wrow={wrow}
            wsd={wsd}
            status={pattern.status}
            onRetry={pattern.refresh}
            log={log.data}
            logFailed={log.status === 'error'}
            onZoom={setParams}
            zoomed={period.key === 'range'}
            label={label}
          />

          <section className="ss-sec" aria-labelledby="ss-reasons-h">
            <div className="ss-h2">
              <h3 id="ss-reasons-h" className="ss-h">{S.reasonsTitle}</h3>
              <span className="ss-cap">{SF.reasonsCaption}</span>
            </div>
            {reasons.status === 'error' ? (
              <ErrorState part={SF.partSheetReasons} onRetry={reasons.refresh} />
            ) : reasons.data ? (
              reasons.data.data.reasons.length === 0 ? (
                <p className="ss-note">{S.reasonsNone}</p>
              ) : (
                <ul className="ss-reasons">
                  {reasons.data.data.reasons.slice(0, 3).map((r) => (
                    <li key={`${r.rejectType}-${r.rejectCodeId ?? r.displayLabel}`}>
                      <span>{r.rejectType === 'weight' && !r.label ? r.displayLabel : reasonShort(r)}</span>
                      <b>{pct(r.pct)}</b>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <Skeleton part={SF.partSheetReasons} height={64} lines={3} onRetry={reasons.refresh} />
            )}
          </section>

          <section className="ss-sec" aria-labelledby="ss-product-h">
            <h3 id="ss-product-h" className="ss-h">{S.productTitle}</h3>
            <dl className="ss-dl">
              <div>
                <dt>{S.productJudged}</dt>
                <dd>{srow ? stationProductText(srow).full : SF.dash}</dd>
              </div>
              <div>
                <dt>{S.lastReading}</dt>
                <dd>
                  {machines.status === 'error'
                    ? SF.dash
                    : machine?.lastSeenUtc
                      ? `${formatDate(machine.lastSeenUtc)} ${formatClock(machine.lastSeenUtc)}`
                      : machines.data
                        ? S.noReading
                        : SF.dash}
                </dd>
              </div>
            </dl>
            <p className="ss-note">
              {machines.status === 'error' ? (
                <>
                  {C.couldntLoad(SF.partSheetMachine)}{' '}
                  <button type="button" className="ui-link" onClick={machines.refresh}>{C.tryAgain}</button>
                </>
              ) : machine?.state === 'running' && machine.productName ? (
                S.runningNow(machine.productName, stamp(machine.runStartUtc ?? machine.sinceUtc))
              ) : machine?.lastProductName ? (
                S.lastStamped(machine.lastProductName, stamp(machine.lastStampedUtc))
              ) : null}{' '}
              {S.productFromCones}
            </p>
          </section>

          <Ledger log={log} />

          <nav className="ss-sec" aria-labelledby="ss-hops-h">
            <h3 id="ss-hops-h" className="ss-h">{S.hopsTitle}</h3>
            <ul className="ss-hops">
              <li><a className="ui-link" data-hop="register" {...hop('register')}>{S.hopRegister(label)}</a></li>
              <li><a className="ui-link" data-hop="rejects" {...hop('rejects')}>{S.hopRejects}</a></li>
              <li><a className="ui-link" data-hop="calibration" {...hop('calibration')}>{S.hopCalibration}</a></li>
              <li><a className="ui-link" data-hop="machine-product" {...hop('machineProduct')}>{S.hopMachineProduct}</a></li>
            </ul>
          </nav>

          <AdjustmentForm
            rank={rank}
            station={station}
            stationLabel={label}
            offsetMinutes={log.data ? log.data.plantOffsetMinutes : 0}
            machine={machine}
            onLogged={log.refresh}
          />
        </div>
      )}
    </>
  );
}

function stamp(at: string | null | undefined): string {
  return at ? `${formatDate(at)} ${formatClock(at)}` : SF.dash;
}

/* ------------------------------------------------------------------ KPIs */

function Kpis(p: {
  srow: StationStatusRow | undefined;
  statusFailed: boolean;
  onRetry: () => void;
  counts: ReturnType<typeof useOneStationCounts>;
  wrow: WeightStationRow | undefined;
  wsd: WeightStationsData | null;
}) {
  const { srow, counts } = p;
  if (p.statusFailed) return <ErrorState part={SF.partSheetStatus} onRetry={p.onRetry} />;
  const c = counts.data ? counts.data.data.rows[0] : undefined;
  const countsFailed = counts.status === 'error';
  const weightFail = c && c.conesInRangePct != null ? Math.max(0, 100 - c.conesInRangePct) : null;
  const target = srow ? targetOf(srow, p.wrow, p.wsd) : null;
  const targetText =
    target == null || target.kind === 'unavailable'
      ? SF.dash
      : target.kind === 'value'
        ? target.text
        : target.kind === 'mixed'
          ? W.weight.mixedTargetShort(target.materials)
          : target.kind === 'none'
            ? W.weight.noTarget
            : S.noData;
  const cones = srow ? fmt.fmtInt(srow.cones) : SF.dash;

  return (
    <section aria-label={S.sheetPeriod('')} className="ss-kpis">
      <div className="ss-kpi">
        <span className="ss-cap">{S.kpiFailedInspection}</span>
        <b>{srow ? (pct(srow.failedPct) ?? S.noData) : SF.dash}</b>
        <span className="ss-cap">
          {countsFailed ? SF.dash : c && srow ? S.nOfCones(fmt.fmtInt(c.rejectedCones), cones) : srow && srow.cones === 0 ? S.noData : SF.dash}
        </span>
      </div>
      <div className="ss-kpi">
        <span className="ss-cap">{S.kpiFailedWeight}</span>
        <b>{countsFailed ? SF.dash : (pct(weightFail) ?? S.noData)}</b>
        <span className="ss-cap">{srow ? SF.ofConesWeighed(cones) : SF.dash}</span>
      </div>
      <div className="ss-kpi" title={target?.kind === 'mixed' ? W.weight.mixedTarget(target.materials) : undefined}>
        <span className="ss-cap">{S.kpiMeanVsTarget}</span>
        <b>{targetText}</b>
        <span className="ss-cap">{SF.vsTargetSub}</span>
      </div>
      <div className="ss-kpi">
        <span className="ss-cap">{S.kpiCones}</span>
        <b>{cones}</b>
      </div>
      {countsFailed && (
        <p className="ss-error" role="alert">
          {C.couldntLoad(SF.partSheetCounts)}{' '}
          <button type="button" className="ui-link" onClick={counts.refresh}>{C.tryAgain}</button>
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------- pattern check */

function Pattern(p: {
  station: number;
  wrow: WeightStationRow | undefined;
  wsd: WeightStationsData | null;
  status: 'loading' | 'error' | 'ok' | 'empty';
  onRetry: () => void;
  log: import('../../bridge/api').AdjustmentList | null;
  logFailed: boolean;
  onZoom: (x: import('../../bridge/chart').PeriodParams) => void;
  zoomed: boolean;
  label: string;
}) {
  const { wrow, wsd } = p;
  const head = (
    <div className="ss-h2">
      <h3 id="ss-pattern-h" className="ss-h">{S.patternTitle}</h3>
      <span className="ss-cap">{wsd ? S.patternSub(wsd.days) : S.patternSub(14)}</span>
    </div>
  );
  if (p.status === 'error') {
    return (
      <section className="ss-sec ss-box" aria-labelledby="ss-pattern-h">
        {head}
        <ErrorState part={SF.partSheetPattern} onRetry={p.onRetry} />
      </section>
    );
  }
  if (!wsd) {
    return (
      <section className="ss-sec ss-box" aria-labelledby="ss-pattern-h">
        {head}
        <Skeleton part={SF.partSheetPattern} height={220} onRetry={p.onRetry} />
      </section>
    );
  }
  if (!wrow) {
    return (
      <section className="ss-sec ss-box" aria-labelledby="ss-pattern-h">
        {head}
        <p className="ss-note">{S.noPatternData}</p>
      </section>
    );
  }

  const cell = patternOf(wrow, wsd);
  const sentence = cell.kind === 'flag' ? cell.text : W.weight.steady;
  const flaggedDays = wrow.days.filter((d) => d.nelson.length > 0);
  const cannot = wsd.rules.filter((r) => r.minPoints > wrow.longestRun).map((r) => r.id);
  const showLimits = wsd.limits != null && wrow.targetBasis !== 'mixed';
  const sentenceProjection = wrow.flagged ? projectionSentence(wrow.projection, wsd, wrow.longestRun) : null;
  const assumption = wrow.flagged && wrow.projection ? W.calibration.projectionAssumption : '';

  return (
    <section className="ss-sec ss-box" aria-labelledby="ss-pattern-h">
      {head}
      <p className={cell.kind === 'flag' ? 'ss-verdict ss-verdict--flag' : 'ss-verdict'}>{sentence}</p>
      {sentenceProjection && (
        <p className="ss-note" data-testid="projection">
          {sentenceProjection} <span className="ss-mut">{assumption}</span>
        </p>
      )}

      <DailyChart
        stationLabel={p.label}
        days={wrow.days}
        adjustedAtUtc={p.log ? p.log.adjustments.map((a) => a.adjustedAtUtc) : []}
        offsetMinutes={p.log ? p.log.plantOffsetMinutes : 0}
        limits={showLimits ? wsd.limits : null}
        zoomed={p.zoomed}
        onZoom={p.onZoom}
      />

      <h4 className="ss-h4">{W.calibration.flaggedDays}</h4>
      {flaggedDays.length === 0 ? (
        <p className="ss-note">{W.calibration.noFlaggedDays}</p>
      ) : (
        <table className="ss-table">
          <tbody>
            {flaggedDays.map((d) => (
              <tr key={d.date}>
                <td>{short(d.date)}</td>
                <td className="ss-n">{fmt.fmtG(d.mean)}</td>
                <td>{d.nelson.map((id) => ruleLabel(id, wsd.rules)).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dl className="ss-dl ss-dl--wide">
        <div><dt>{W.calibration.colMedian}</dt><dd>{wrow.medianG == null ? SF.dash : fmt.fmtG(wrow.medianG)}</dd></div>
        <div><dt>{W.calibration.colSd}</dt><dd>{wrow.sdG == null ? SF.dash : `${wrow.sdG.toFixed(1)} g`}</dd></div>
        <div><dt>{W.weight.colVsLine}</dt><dd>{signedG(wrow.vsLineG)}</dd></div>
        <div><dt>{W.weight.colRejects}</dt><dd>{wrow.rejectRatePct == null ? SF.dash : `${wrow.rejectRatePct.toFixed(1)} %`}</dd></div>
      </dl>

      <Disclosure id="station-sheet-nelson">
        <p>
          Flagged when the station has held one side of the line by at least {fmt.fmtG(wsd.thresholdG)} for {wsd.minDaysHeld} production days or
          more, and the pattern test has fired inside that run. The figures above are measured over that run, not over the whole window, so they
          describe the change being reported.
        </p>
        <p>
          {W.calibration.rulesRun}{' '}
          {W.calibration.centreline(fmt.fmtG(wrow.centrelineG), wrow.sigmaDayToDay == null ? SF.dash : `${wrow.sigmaDayToDay.toFixed(2)} g`)}
          {wrow.restartedOn ? `, ${W.calibration.restartedOn(short(wrow.restartedOn))}` : ''}.{' '}
          {cannot.length > 0 ? W.calibration.cannotFire(ruleList(cannot), wrow.longestRun) : W.calibration.allCanFire(wrow.longestRun)}{' '}
          {W.calibration.notApproved}
        </p>
        {wsd.rules.length > 0 && <p className="ss-mut">{wsd.rules.map((r) => `${r.id}: ${r.label} (${r.minPoints})`).join(' · ')}</p>}
        {wrow.flagged && !wrow.projection && <p>{projectionSentence(null, wsd, wrow.longestRun)}</p>}
      </Disclosure>
    </section>
  );
}

/* ---------------------------------------------------------------- ledger */

function Ledger({ log }: { log: ReturnType<typeof useAdjustments> }) {
  const beforeAfter = (a: import('../../bridge/api').CalibrationAdjustment) => {
    if (a.beforeG == null && a.afterG == null) return SF.dash;
    const ref = a.referenceG != null ? ` (ref ${fmt.fmtG(a.referenceG)})` : '';
    return `${a.beforeG == null ? SF.dash : fmt.fmtG(a.beforeG)} → ${a.afterG == null ? SF.dash : fmt.fmtG(a.afterG)}${ref}`;
  };
  return (
    <section className="ss-sec" aria-labelledby="ss-log-h">
      <h3 id="ss-log-h" className="ss-h">{W.weight.adjustmentLog}</h3>
      {log.status === 'error' && !log.data ? (
        <ErrorState part={SF.partSheetLog} onRetry={log.refresh} />
      ) : !log.data ? (
        <Skeleton part={SF.partSheetLog} height={64} lines={2} onRetry={log.refresh} />
      ) : log.data.adjustments.length === 0 ? (
        <p className="ss-note">{W.weight.adjustmentsIn(0, 14)}</p>
      ) : (
        <>
          <div className="ss-scroll">
            <table className="ss-table">
              <thead>
                <tr>
                  <th>{W.calibration.colWhen}</th>
                  <th className="ss-n">{W.calibration.colAmount}</th>
                  <th className="ss-n">{W.calibration.colBeforeAfter}</th>
                  <th>{W.calibration.colProduct}</th>
                  <th>{W.calibration.colWhy}</th>
                </tr>
              </thead>
              <tbody>
                {log.data.adjustments.map((a) => (
                  <tr key={a.adjustmentId}>
                    <td>
                      {short(a.adjustedAtPlant)} {formatClock(a.adjustedAtPlant)}
                      {a.stationId == null && <span className="ss-mut"> {'·'} {W.calibration.lineWide}</span>}
                    </td>
                    <td className="ss-n">{signedG(a.amountG) ?? SF.dash}</td>
                    <td className="ss-n">{beforeAfter(a)}</td>
                    <td>{a.productLabel ?? SF.dash}</td>
                    <td>
                      {a.reason ?? SF.dash}
                      {a.note && <span className="ss-mut"> {'·'} {a.note}</span>}
                      {a.recordedBy && <span className="ss-mut"> {'·'} {a.recordedBy}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ss-note">{W.calibration.allAdjustments(log.data.adjustments.length)}</p>
        </>
      )}
      <p className="ss-note">{W.weight.adjustmentResets}</p>
    </section>
  );
}
