/**
 * Quality > Weight. "Are the cones at the right weight, and does any station need a look?"
 *
 * Every mode of the old Weight and Sacks weight views is here, in the redesign's frame:
 *  - the headline states the mean and the target as TWO facts until the weight basis is confirmed
 *    (RESERVED wording, never a "g below target" verdict);
 *  - `wt` Cone / Sack, `wm` Over time / Distribution, `st` one station's stream (cone only);
 *  - the product tolerance is a SECOND fact, shown only when a product was in force (the scale's own
 *    in-range bit is the one flag, named as the scale's);
 *  - station offsets, the sack charts, the drift advisory and both hops (outside limits, stations).
 * Each fetch fails on its own and is named; nothing collapses into a zero.
 */
import { useState } from 'react';
import {
  getProducts,
  getReportOf,
  getSackSummary,
  getSpc,
  getStations,
  getWeightStations,
  type Envelope,
  type SpcData,
  type StationRow,
  type Subgroup,
  type WeightStationsData,
} from '../../../bridge/api';
import { projectionSentence } from '../../../bridge/station';
import { QualityTabs } from '../QualityTabs';
import { fmt, live, period as P, productLabel as PL } from '../../../bridge/lib';
import { W } from '../../../bridge/words';
import { C, formatDate, RESERVED } from '../../../copy';
import { Histogram, LineChart } from '../../../charts';
import type { LimitSpec } from '../../../charts';
import { useData, useProduction, usePeriod, type DataState } from '../../../data';
import { Disclosure } from '../../../ui/Disclosure';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { SelectField } from '../../../ui/Field';
import { Segmented } from '../../../ui/Segmented';
import { Skeleton } from '../../../ui/Skeleton';
import type { ScreenProps } from '../../registry';
import { DivergingBars, type DivergingItem } from './Diverging';
import {
  groupLabel,
  outsideLimitsHop,
  readChartType,
  readMode,
  readStation,
  resolveMode,
  positive,
  signed1,
  stationSheetHop,
  stationsHop,
  withKeys,
  type WeightMode,
} from './model';
import { QW } from './strings';
import './weight.css';

const TRAILING_DAYS = P.TRAILING_DAYS;
const POLL = 60_000;
const SLOW_POLL = 5 * 60_000;

const oneDecimal = (v: number) => v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDecimals = (v: number) => v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedKg = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? '0.00' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`;
};
const shortDay = (date: string) => {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : formatDate(d).replace(/ \d{4}$/, '');
};

/* ------------------------------------------------------------------ entry */

export function QualityWeightScreen({ route, go }: ScreenProps) {
  return (
    <>
      <QualityTabs route={route} go={go} />
      <WeightEntry route={route} go={go} />
    </>
  );
}

function WeightEntry({ route, go }: Pick<ScreenProps, 'route' | 'go'>) {
  const ps = usePeriod();
  if (!ps.period) {
    return ps.status === 'error' ? (
      <ErrorState part="the plant clock" cause={C.periodUi.clockUnread} />
    ) : (
      <Skeleton part="the weight screen" height={320} />
    );
  }
  return <WeightBody route={route} go={go} period={ps.period} params={ps.params} setParams={ps.setParams} />;
}

interface BodyProps extends Pick<ScreenProps, 'route' | 'go'> {
  period: P.Period;
  params: P.PeriodParams;
  setParams: (p: P.PeriodParams) => void;
}

function useAfterNewest(period: P.Period): { text: string | null; newest: string | null } {
  let newest: string | null = null;
  let plantNow: string | null = null;
  try {
    const { line } = live.useLive();
    newest = line?.dataAsOfUtc ?? null;
    plantNow = line?.plantNowUtc ?? null;
  } catch {
    /* no provider (a test mount): no newest reading is known */
  }
  if (!newest || !plantNow || !P.periodAfterNewest(period, newest)) return { text: null, newest };
  return { text: W.periodAfterNewest(fmt.fmtClockOn(newest, plantNow)), newest };
}

function WeightBody({ route, go, period, params, setParams }: BodyProps) {
  const chartType = readChartType(route.keys);
  const station = chartType === 'cone' ? readStation(route.keys) : null;
  const mode: WeightMode = resolveMode(readMode(route.keys), period.days);
  const isSack = chartType === 'sack';

  const pq = P.periodQuery(period);
  const asOf = live.useAsOf();
  const pkey = `${period.from}:${period.to}:${pq.fromShift ?? ''}:${pq.toShift ?? ''}:${period.shift ?? 'all'}`;
  const every = period.live ? POLL : SLOW_POLL;
  const after = useAfterNewest(period);
  const [backTo, setBackTo] = useState<P.PeriodParams | null>(null);

  const names = useData('station names', () => getStations(), 'qw:stations', { live: false });
  const stationsD = useData(
    'the station and target figures',
    () =>
      getWeightStations({
        trailingDays: TRAILING_DAYS,
        to: period.to,
        periodFrom: period.from,
        periodTo: period.to,
        shift: period.shift,
        periodFromShift: pq.fromShift,
        periodToShift: pq.toShift,
      }),
    `qw:ws:${pkey}`,
    { live: period.live, intervalMs: SLOW_POLL },
  );
  const productId = stationsD.data?.data.productId ?? null;
  const spcQuery = (type: 'cone' | 'sack', extra: { station?: number; productId?: number }) => ({
    type,
    from: period.from,
    to: period.to,
    shift: period.shift ?? undefined,
    fromShift: pq.fromShift,
    toShift: pq.toShift,
    ...extra,
  });
  // The headline and the KPI row: always cone, always the whole line.
  // They wait for the station/target answer: it names the product the limits are drawn for, and
  // asking twice would flash the headline back to "Loading" when the product arrives.
  const productKnown = stationsD.status !== 'loading';
  const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
  const coneLine = useData(
    'the cone weight figures',
    () => (productKnown ? getSpc(spcQuery('cone', { productId: productId ?? undefined })) : never<Envelope<SpcData>>()),
    `qw:cone:${pkey}:${productKnown ? (productId ?? 'none') : 'wait'}`,
    { live: period.live, intervalMs: every, isEmpty: (e) => e.data.count === 0 },
  );
  // The chart's own population. A plain cone chart of the whole line reuses coneLine.
  const ownChart = !(chartType === 'cone' && station === null);
  const chartD = useData(
    isSack ? 'the sack weight chart' : 'the station weight chart',
    () =>
      !ownChart
        ? Promise.resolve(null)
        : productKnown
          ? getSpc(spcQuery(chartType, isSack ? {} : { productId: productId ?? undefined, station: station ?? undefined }))
          : never<Envelope<SpcData>>(),
    `qw:chart:${chartType}:${station ?? 'line'}:${pkey}:${productKnown ? (productId ?? 'none') : 'wait'}`,
    { live: period.live, intervalMs: every },
  );
  const prod = useProduction(period);
  const sackSum = useData(
    'the sack summary',
    () => (isSack ? getSackSummary({ ...pq, tsTo: undefined }) : Promise.resolve(null)),
    `qw:sacks:${isSack}:${pkey}:${asOf ?? 'now'}`,
    { live: period.live, intervalMs: every },
  );
  const sackDays = useData(
    'the sack weights by day',
    () => (isSack ? getReportOf('sack', pq) : Promise.resolve(null)),
    `qw:sackdays:${isSack}:${pkey}:${asOf ?? 'now'}`,
    { live: period.live, intervalMs: every },
  );
  const products = useData('the product names', () => getProducts(), 'qw:products', { live: false });

  const d = stationsD.data?.data ?? null;
  const cone = coneLine.data?.data ?? null;
  const chart: SpcData | null = ownChart ? (chartD.data?.data ?? null) : cone;
  const chartStatus: DataState<unknown>['status'] = ownChart ? chartD.status : coneLine.status;
  const chartRetry = ownChart ? chartD.refresh : coneLine.refresh;
  const stationRows: StationRow[] = names.data?.stations ?? [];
  const nameOf = (n: number) => RESERVED.stationLabel(stationRows.find((s) => s.stationId === n), n);

  const setKey = (patch: Record<string, string | null>) => go(withKeys(route, patch));
  const zoomTo = (p: P.PeriodParams | null) => {
    if (!p) return;
    setBackTo(params);
    setParams(p);
  };

  const noCones = cone !== null && cone.count === 0;
  const coneBlank = !isSack && noCones;

  return (
    <div className="qw">
      <Headline
        isSack={isSack}
        cone={cone}
        coneStatus={coneLine.status}
        d={d}
        stationsStatus={stationsD.status}
        sack={sackSum.data?.data ?? null}
        afterNewest={after.text}
      />
      {cone?.spansGenerations && !isSack && (
        <p className="qw-note">{W.state.periodGenerations(cone.otherGenerationExcluded > 0 ? fmt.fmtInt(cone.otherGenerationExcluded) : null)}</p>
      )}

      <div className="qw-bar" role="group" aria-label={QW.toolbar.chart}>
        <Segmented
          label={QW.toolbar.weight}
          value={chartType}
          onChange={(v) => setKey({ wt: v === 'sack' ? 'sack' : null, st: null })}
          options={[
            { id: 'cone', label: W.readings.cones },
            { id: 'sack', label: W.readings.sacks },
          ]}
        />
        <Segmented
          label={QW.toolbar.chart}
          value={mode}
          onChange={(v) => setKey({ wm: v === 'dist' ? 'dist' : 'time' })}
          options={[
            { id: 'time', label: W.weight.overTime },
            { id: 'dist', label: W.weight.distribution },
          ]}
        />
        {!isSack && (
          <SelectField
            label={W.cone.stationSelect}
            value={station === null ? '' : String(station)}
            onChange={(v) => setKey({ st: v === '' ? null : v })}
            options={[
              { value: '', label: W.cone.wholeLine },
              ...stationRows.map((s) => ({ value: String(s.stationId), label: nameOf(s.stationId) })),
            ]}
          />
        )}
      </div>
      {names.status === 'error' && !isSack && <p className="qw-note">{C.stationListIncomplete}</p>}

      {isSack ? (
        <SackKpis sum={sackSum} />
      ) : (
        <ConeKpis cone={cone} coneLine={coneLine} d={d} stationsD={stationsD} prod={prod} />
      )}

      {!isSack && d !== null && d.disagreement.passedButOutside > 0 && (
        <p className="qw-hop">
          <span>{W.disagreement(d.disagreement.passedButOutside)}</span>{' '}
          <button type="button" className="ui-link" onClick={() => go(outsideLimitsHop(route))}>
            {W.seeThem}
          </button>
        </p>
      )}

      {coneBlank ? (
        <EmptyState newest={after.text ? after.newest : null} message={after.text ?? undefined} />
      ) : (
        <>
          <MainChart
            mode={mode}
            isSack={isSack}
            spc={chart}
            status={chartStatus}
            onRetry={chartRetry}
            target={isSack ? null : (d?.targetG ?? null)}
            period={period}
            params={params}
            onZoom={zoomTo}
            onBack={backTo ? () => { setParams(backTo); setBackTo(null); } : undefined}
          />
          {chart !== null && !isSack && chart.spec.source === 'product' && positive(chart.spec.limitsChangedInPeriod) && (
            <p className="qw-note">{W.weight.limitsChanged(chart.spec.limitsChangedInPeriod)}</p>
          )}
          {chart !== null && chart.spec.limitsOmittedReason && <p className="qw-note">{chart.spec.limitsOmittedReason}</p>}
          {isSack && <p className="qw-note">{W.weight.sackNoTarget}</p>}
          {chart !== null && chart.spansGenerations && (
            <p className="qw-note">{W.weight.oneGeneration(fmt.fmtInt(chart.count), fmt.fmtInt(chart.otherGenerationExcluded))}</p>
          )}
          {chart !== null && chart.count + chart.implausible > 0 && (
            <p className="qw-note">
              {W.cone.excludedNote(fmt.fmtInt(chart.count + chart.implausible), fmt.fmtInt(chart.implausible))}
              {chart.station !== null ? ` · ${nameOf(chart.station)}` : ''}
            </p>
          )}

          {isSack ? (
            <SackExtras
              sackDays={sackDays}
              sackSum={sackSum}
              products={products.data?.products ?? []}
              productsFailed={products.status === 'error'}
              onDay={(day) => zoomTo(P.snapToShifts(P.dayToShiftRange(day, day).from, P.dayToShiftRange(day, day).to, params))}
            />
          ) : (
            <Offsets
              spc={cone}
              status={coneLine.status}
              onRetry={coneLine.refresh}
              nameOf={nameOf}
              roster={stationRows.filter((r) => r.isActive !== false).map((r) => r.stationId)}
              onOpen={(n) => go(stationSheetHop(route, n))}
            />
          )}
        </>
      )}

      {!isSack && (
        <Advisory
          d={d}
          status={stationsD.status}
          error={stationsD.error}
          onRetry={stationsD.refresh}
          nameOf={nameOf}
          onStations={() => go(stationsHop(route))}
        />
      )}

      <About d={d} spc={isSack ? chart : cone} sackBasis={sackSum.data?.data.weightBasis ?? null} isSack={isSack} />
    </div>
  );
}

/* ---------------------------------------------------------------- headline */

function Headline({
  isSack,
  cone,
  coneStatus,
  d,
  stationsStatus,
  sack,
  afterNewest,
}: {
  isSack: boolean;
  cone: SpcData | null;
  coneStatus: DataState<unknown>['status'];
  d: WeightStationsData | null;
  stationsStatus: DataState<unknown>['status'];
  sack: { totals: { sacks: number; avgKg: number | null } } | null;
  afterNewest: string | null;
}) {
  let text: string;
  if (isSack) {
    if (sack === null) text = W.loading;
    else if (sack.totals.sacks === 0) text = afterNewest ?? QW.headline.noSacks;
    else if (sack.totals.avgKg === null) text = QW.headline.sackNoMean(fmt.fmtInt(sack.totals.sacks));
    else text = QW.headline.sack(fmt.fmtKg(sack.totals.avgKg), fmt.fmtInt(sack.totals.sacks));
  } else if (coneStatus === 'error' && cone === null) {
    text = W.couldNotLoad;
  } else if (cone === null) {
    text = W.loading;
  } else if (cone.count == null) {
    text = W.weight.countCouldNotRead;
  } else if (cone.count === 0 || cone.mean === null) {
    text = afterNewest ?? QW.headline.noCones;
  } else if (d === null) {
    text = stationsStatus === 'error' ? `${QW.headline.mean(fmt.fmtG(cone.mean))} ${W.weight.headlineStationDataFailed}` : QW.headline.mean(fmt.fmtG(cone.mean));
  } else if (d.targetG === null) {
    text = W.weight.headlineNoTarget(fmt.fmtG(cone.mean));
  } else {
    text = RESERVED.weightHeadlineUnconfirmed(fmt.fmtG(cone.mean), targetPhrase(d));
  }
  return <h1 className="qw-sentence">{text}</h1>;
}

/** "1,960 g (201-IH0-SD), in force since ...": the target with its product and the instant its limits began. */
function targetPhrase(d: WeightStationsData): string {
  const retired = d.productActive === false ? ` ${W.retiredProduct.marker}` : '';
  const base = `${fmt.fmtG(d.targetG)} (${d.productLabel ?? W.reports.wholeLine}${retired})`;
  if (!d.targetEffectiveFromUtc) return base;
  const at = fmt.fmtAppInstant(d.targetEffectiveFromUtc);
  return `${base}, ${d.targetEffectiveIsLowerBound ? W.reports.targetNoLaterThan(at) : W.reports.targetSince(at)}`;
}

/* --------------------------------------------------------------------- KPIs */

interface KpiProps {
  label: string;
  info?: string;
  value?: string | null;
  unit?: string;
  detail?: string | null;
  status?: 'loading' | 'ok' | 'error';
  part?: string;
  onRetry?: () => void;
}

function Kpi({ label, info, value, unit, detail, status = 'ok', part, onRetry }: KpiProps) {
  return (
    <section className="kpi qw-kpi" aria-busy={status === 'loading' || undefined} data-status={status}>
      <div className="kpi-label">
        {label}
        {info && (
          <button type="button" className="qw-info" aria-label={`How ${label.toLowerCase()} is counted`} title={info}>
            ?
          </button>
        )}
      </div>
      {status === 'loading' ? (
        <div className="kpi-skel" aria-label={C.chart.loading} />
      ) : status === 'error' ? (
        <>
          <div className="kpi-value">{'–'}</div>
          <div className="kpi-errtext" role="alert">{C.couldntLoad(part ?? label.toLowerCase())}</div>
          {onRetry && <button type="button" className="kpi-retry" onClick={onRetry}>{C.tryAgain}</button>}
        </>
      ) : (
        <>
          <div className="kpi-value">
            {value ?? '–'}
            {unit && value != null && <span className="kpi-unit">{unit}</span>}
          </div>
          {detail && <div className="qw-detail">{detail}</div>}
        </>
      )}
    </section>
  );
}

const asKpi = (s: DataState<unknown>['status']): 'loading' | 'ok' | 'error' =>
  s === 'loading' ? 'loading' : s === 'error' ? 'error' : 'ok';

function ConeKpis({
  cone,
  coneLine,
  d,
  stationsD,
  prod,
}: {
  cone: SpcData | null;
  coneLine: DataState<Envelope<SpcData>>;
  d: WeightStationsData | null;
  stationsD: DataState<Envelope<WeightStationsData>>;
  prod: ReturnType<typeof useProduction>;
}) {
  const hasMean = cone !== null && cone.count > 0 && cone.mean !== null;
  const meanDetail =
    hasMean && cone.stdevOverall !== null
      ? cone.median != null
        ? QW.kpi.medianDetail(fmt.fmtG(cone.median), `${oneDecimal(cone.stdevOverall)} g`)
        : QW.kpi.meanDetail(`${oneDecimal(cone.stdevOverall)} g`)
      : null;

  // The target: its product, and when its limits began. Withheld with the server's own reason.
  let targetValue: string | null = null;
  let targetDetail: string | null = null;
  if (d !== null) {
    if (d.targetG !== null) {
      targetValue = d.targetG.toLocaleString('en-GB');
      const at = d.targetEffectiveFromUtc ? fmt.fmtAppInstant(d.targetEffectiveFromUtc) : null;
      targetDetail = [
        `${d.productLabel ?? W.reports.wholeLine}${d.productActive === false ? ` ${W.retiredProduct.marker}` : ''}`,
        at ? (d.targetEffectiveIsLowerBound ? W.reports.targetNoLaterThan(at) : W.reports.targetSince(at)) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    } else {
      targetDetail = d.targetOmittedReason ?? W.weight.noTarget;
    }
  }

  const offset = hasMean && d !== null && d.targetG !== null ? cone.mean! - d.targetG : null;

  // Within tolerance: only when cones were judged by a product's limits at their own time.
  const row = prod.data?.data.rows?.[0] ?? null;
  const states = prod.data?.data.states ?? null;
  const judged = states ? states.within + states.low + states.high : 0;
  const omitted = cone?.spec.limitsOmittedReason ?? null;
  const spec = cone?.spec ?? null;
  const prodStatus = asKpi(prod.status);
  const failedPct = row && row.conesInRangePct !== null ? 100 - row.conesInRangePct : null;
  const offsetStatus = asKpi(
    stationsD.status === 'error' || coneLine.status === 'error'
      ? 'error'
      : stationsD.status === 'loading' || coneLine.status === 'loading'
        ? 'loading'
        : 'ok',
  );

  return (
    <div className="qw-kpis" role="group" aria-label={QW.kpi.mean}>
      <Kpi
        label={QW.kpi.mean}
        info={QW.kpi.infoMean}
        status={asKpi(coneLine.status)}
        part="the cone weight figures"
        onRetry={coneLine.refresh}
        value={hasMean ? oneDecimal(cone.mean!) : null}
        unit="g"
        detail={meanDetail}
      />
      <Kpi
        label={QW.kpi.target}
        status={asKpi(stationsD.status)}
        part="the target"
        onRetry={stationsD.refresh}
        value={targetValue}
        unit="g"
        detail={targetDetail}
      />
      <Kpi
        label={QW.kpi.offset}
        status={offsetStatus}
        part="the offset"
        value={offset === null ? null : signed1(offset)}
        unit="g"
        detail={offset === null ? QW.kpi.offsetNone : QW.kpi.offsetDetail}
      />
      <Kpi
        label={QW.kpi.within}
        info={QW.kpi.infoWithin}
        status={prodStatus}
        part="the product tolerance share"
        onRetry={prod.refresh}
        value={states && judged > 0 && !omitted ? oneDecimal((states.within / judged) * 100) : null}
        unit="%"
        detail={
          omitted
            ? omitted
            : states && judged > 0
              ? QW.kpi.withinDetail(
                  spec && spec.lsl !== null ? fmt.fmtG(spec.lsl) : '–',
                  spec && spec.usl !== null ? fmt.fmtG(spec.usl) : '–',
                  fmt.fmtInt(judged),
                )
              : C.checks.notChecked
        }
      />
      <Kpi
        label={QW.kpi.failedCheck}
        info={QW.kpi.infoFailed}
        status={prodStatus}
        part="the scale check share"
        onRetry={prod.refresh}
        value={failedPct === null ? null : oneDecimal(failedPct)}
        unit="%"
        detail={row ? QW.kpi.failedDetail(fmt.fmtInt(row.cones)) : null}
      />
    </div>
  );
}

function SackKpis({ sum }: { sum: DataState<Envelope<import('../../../bridge/api').SackSummaryData> | null> }) {
  const t = sum.data?.data.totals ?? null;
  const st = asKpi(sum.status);
  return (
    <div className="qw-kpis" role="group" aria-label={W.readings.sacks}>
      <Kpi label={QW.sackKpi.weighed} status={st} part="the sack summary" onRetry={sum.refresh} value={t ? fmt.fmtInt(t.sacks) : null} detail={t ? QW.sackKpi.weighedDetail : null} />
      <Kpi
        label={QW.sackKpi.mean}
        status={st}
        part="the sack summary"
        onRetry={sum.refresh}
        value={t && t.avgKg !== null ? twoDecimals(t.avgKg) : null}
        unit="kg"
        detail={t && t.implausible > 0 ? W.sacks.avgExcluded(fmt.fmtInt(t.implausible)) : null}
      />
      <Kpi
        label={QW.sackKpi.passed}
        info={QW.sackKpi.infoPassed}
        status={st}
        part="the sack summary"
        onRetry={sum.refresh}
        value={t && t.inRangePct !== null ? oneDecimal(t.inRangePct) : null}
        unit="%"
        detail={t ? W.sacks.inRangeNote(fmt.fmtInt(t.inRange), fmt.fmtInt(t.sacks - t.noFlag)) : null}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- charts */

function limitSpec(spc: SpcData, unitFmt: (v: number) => string): LimitSpec | undefined {
  if (spc.spec.source === 'none' || spc.spec.limitsOmittedReason) return undefined;
  const { lsl, usl } = spc.spec;
  if (lsl === null || usl === null) return undefined;
  return { lower: lsl, upper: usl, lowerText: unitFmt(lsl), upperText: unitFmt(usl) };
}

function shiftRange(g: Subgroup[], i: number): { from: P.ShiftRef; to: P.ShiftRef } | null {
  const a = g[i];
  if (!a || !a.firstShiftDate || !a.firstShiftCode || !a.lastShiftDate || !a.lastShiftCode) return null;
  return { from: { date: a.firstShiftDate, shift: a.firstShiftCode }, to: { date: a.lastShiftDate, shift: a.lastShiftCode } };
}

function MainChart({
  mode,
  isSack,
  spc,
  status,
  onRetry,
  target,
  period,
  params,
  onZoom,
  onBack,
}: {
  mode: WeightMode;
  isSack: boolean;
  spc: SpcData | null;
  status: DataState<unknown>['status'];
  onRetry: () => void;
  target: number | null;
  period: P.Period;
  params: P.PeriodParams;
  onZoom: (p: P.PeriodParams | null) => void;
  onBack?: () => void;
}) {
  const unit = isSack ? 'kg' : 'g';
  const fmtV = isSack ? twoDecimals : oneDecimal;
  const fmtLimit = (v: number) => (isSack ? fmt.fmtKg(v) : fmt.fmtG(v));
  const part = isSack ? 'the sack weight chart' : 'the cone weight chart';
  const common = {
    errorPart: part,
    onRetry,
    status: spc === null ? (status === 'error' ? ('error' as const) : ('loading' as const)) : undefined,
    formatValue: fmtV,
  };

  if (mode === 'dist') {
    return (
      <Histogram
        chartId={`qw-dist-${isSack ? 'sack' : 'cone'}`}
        title={isSack ? QW.charts.distSack : QW.charts.distCone}
        unit={isSack ? 'sacks' : 'cones'}
        valueUnit={unit}
        caption={target !== null ? `${QW.charts.target} ${fmt.fmtG(target)}.` : undefined}
        bins={(spc?.histogram ?? []).map((b) => ({ from: b.start, to: b.end, count: b.count }))}
        limits={spc ? limitSpec(spc, fmtLimit) : undefined}
        emptyMessage={W.nothingHere}
        {...common}
      />
    );
  }

  const g = spc?.subgroups ?? [];
  const multiDay = period.from !== period.to;
  const categories = g.map((p) => groupLabel(p.ts, multiDay));
  const series: { name: string; values: (number | null)[]; slot?: number }[] = [
    { name: isSack ? QW.charts.sackMean : QW.charts.coneMean, values: g.map((p) => p.mean) },
  ];
  if (target !== null && g.length > 0) series.push({ name: `${QW.charts.target} ${fmt.fmtG(target)}`, values: g.map(() => target), slot: 9 });
  const avgN = spc ? spc.count / Math.max(1, g.length) : 0;

  return (
    <LineChart
      chartId={`qw-time-${isSack ? 'sack' : 'cone'}`}
      title={isSack ? QW.charts.overTimeSack : QW.charts.overTimeCone}
      unit={unit}
      caption={
        spc && g.length > 0
          ? `${QW.charts.groupsCaption(String(g.length), `${fmt.fmtInt(Math.round(avgN))} ${isSack ? W.readings.sacks.toLowerCase() : W.readings.cones.toLowerCase()}`)}. ${W.chart.limitsOverPeriod(P.describePeriod(period))}`
          : undefined
      }
      categories={categories}
      series={series}
      limits={spc ? limitSpec(spc, fmtLimit) : undefined}
      periodFor={(i) => {
        const r = shiftRange(g, i);
        return r ? P.snapToShifts(r.from, r.to, params) : null;
      }}
      onZoom={onZoom}
      onBack={onBack}
      defaultH={260}
      emptyMessage={W.nothingHere}
      {...common}
    />
  );
}

function Offsets({
  spc,
  status,
  onRetry,
  nameOf,
  roster,
  onOpen,
}: {
  spc: SpcData | null;
  status: DataState<unknown>['status'];
  onRetry: () => void;
  nameOf: (n: number) => string;
  /** Station numbers on the roster, so a station with no cones is listed as "No data", never dropped. */
  roster: number[];
  onOpen: (n: number) => void;
}) {
  const stations = spc?.stations ?? [];
  const withData = [...stations].sort((a, b) => a.delta - b.delta);
  const seen = new Set(withData.map((s) => s.station));
  const without = roster.filter((n) => !seen.has(n)).sort((a, b) => a - b);
  const order = [...withData.map((s) => s.station), ...without];
  const items: DivergingItem[] = [
    ...withData.map((s) => ({
      key: String(s.station),
      label: nameOf(s.station),
      value: s.delta as number | null,
      detail: [`${QW.charts.stationMean} ${fmt.fmtG(s.mean)} · ${fmt.fmtInt(s.n)} ${W.readings.cones.toLowerCase()}`],
    })),
    ...without.map((n) => ({ key: String(n), label: nameOf(n), value: null as number | null })),
  ];
  const bandHalf = spc?.practicalThresholdG;
  return (
    <DivergingBars
      chartId="qw-offsets"
      title={QW.charts.offsets}
      unit="g"
      caption={QW.charts.offsetsCaption}
      items={items}
      orientation="rows"
      format={signed1}
      minHalfSpan={4}
      band={bandHalf ? { half: bandHalf, label: QW.charts.withinBand(oneDecimal(bandHalf)) } : undefined}
      noDataLabel={QW.charts.stationNoData}
      valueName={QW.charts.offsetName}
      status={spc === null ? (status === 'error' ? 'error' : 'loading') : undefined}
      errorPart="the station offsets"
      onRetry={onRetry}
      emptyMessage={QW.charts.offsetsEmpty}
      onActivate={(i) => {
        const n = order[i];
        if (n !== undefined) onOpen(n);
      }}
      activateHint={QW.charts.openStation}
    />
  );
}

/* --------------------------------------------------------------- sack extras */

function SackExtras({
  sackDays,
  sackSum,
  products,
  productsFailed,
  onDay,
}: {
  sackDays: DataState<Awaited<ReturnType<typeof getReportOf<'sack'>>> | null>;
  sackSum: DataState<Envelope<import('../../../bridge/api').SackSummaryData> | null>;
  products: import('../../../bridge/api').ProductOption[];
  productsFailed: boolean;
  onDay: (day: string) => void;
}) {
  const rep = sackDays.data?.data.report ?? null;
  const days = rep ? rep.byDay.filter((r) => r.group !== 'total' && r.avgSackKg !== null) : [];
  const mean = rep?.totals.avgSackKg ?? null;
  const items: DivergingItem[] =
    mean === null
      ? []
      : days.map((r) => ({
          key: r.group,
          label: shortDay(r.group),
          value: Number(((r.avgSackKg as number) - mean).toFixed(3)),
          detail: [`${fmt.fmtKg(r.avgSackKg)} · ${fmt.fmtInt(r.sacks)} ${W.readings.sacks.toLowerCase()}`],
        }));
  const labels = PL.distinctProductLabels(products);
  const sum = sackSum.data?.data ?? null;
  const attributed = sum ? sum.byProduct.filter((r) => r.materialId !== null).sort((a, b) => b.sacks - a.sacks) : [];

  return (
    <>
      <DivergingBars
        chartId="qw-sack-days"
        title={QW.charts.sackPerDay}
        unit="kg"
        caption={mean !== null ? QW.charts.sackPerDayCaption(fmt.fmtKg(mean)) : undefined}
        items={items}
        orientation="columns"
        format={signedKg}
        minHalfSpan={0.1}
        noDataLabel={QW.charts.stationNoData}
        valueName={QW.charts.vsPeriodMean}
        status={rep === null ? (sackDays.status === 'error' ? 'error' : 'loading') : items.length < 2 ? 'empty' : undefined}
        errorPart="the sack weights by day"
        onRetry={sackDays.refresh}
        emptyMessage={QW.charts.sackPerDayShort}
        onActivate={(i) => {
          const it = items[i];
          if (it) onDay(it.key);
        }}
        activateHint={QW.zoomHint}
      />
      <section className="ck-frame qw-products" aria-labelledby="qw-prod-h">
        <h3 id="qw-prod-h" className="ck-title">{QW.sack.byProduct}</h3>
        {sackSum.status === 'error' && sum === null ? (
          <ErrorState part="the sack summary" onRetry={sackSum.refresh} />
        ) : sum === null ? (
          <Skeleton part="the sack summary" height={96} />
        ) : attributed.length < 2 ? (
          <EmptyState message={QW.sack.none} />
        ) : (
          <div className="ck-table-wrap">
            <table className="ck-table">
              <caption>{QW.sack.byProductCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{QW.sack.colProduct}</th>
                  <th scope="col" className="num">{QW.sack.colSacks}</th>
                  <th scope="col" className="num">{QW.sack.colPassed}</th>
                </tr>
              </thead>
              <tbody>
                {attributed.map((r) => (
                  <tr key={r.materialId}>
                    <th scope="row">{labels.get(r.materialId as number) ?? r.productName ?? `Product ${r.materialId}`}</th>
                    <td className="num">{fmt.fmtInt(r.sacks)}</td>
                    <td className="num">{fmt.fmtPct1(r.inRangePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {productsFailed && <p className="qw-note">{QW.sack.namesMissing}</p>}
        {sum !== null && sum.unattributed.rows > 0 && (
          <p className="qw-note">{W.sacks.unattributed(fmt.fmtInt(sum.unattributed.rows), fmt.fmtInt(sum.unattributed.of))}</p>
        )}
      </section>
    </>
  );
}

/* ----------------------------------------------------------------- advisory */

function Advisory({
  d,
  status,
  error,
  onRetry,
  nameOf,
  onStations,
}: {
  d: WeightStationsData | null;
  status: DataState<unknown>['status'];
  error: string | null;
  onRetry: () => void;
  nameOf: (n: number) => string;
  onStations: () => void;
}) {
  return (
    <section className="ck-frame qw-advisory" aria-labelledby="qw-adv-h">
      <h3 id="qw-adv-h" className="ck-title">{QW.advisory.title}</h3>
      {d === null ? (
        status === 'error' ? (
          <ErrorState part="the station pattern check" cause={error ?? undefined} onRetry={onRetry} />
        ) : (
          <Skeleton part="the station pattern check" height={72} />
        )
      ) : (
        <AdvisoryBody d={d} nameOf={nameOf} onStations={onStations} />
      )}
    </section>
  );
}

function AdvisoryBody({ d, nameOf, onStations }: { d: WeightStationsData; nameOf: (n: number) => string; onStations: () => void }) {
  const drifting = d.stations.filter((r) => r.flagged);
  return (
    <>
      <p className="qw-lead">
        {drifting.length === 0 ? W.weight.allStationsSteady : W.weight.stationsNeedLook(drifting.length)}{' '}
        <span className="qw-muted">{W.judgedOver(d.days)}</span>
      </p>
      {drifting.length > 0 && (
        <ul className="qw-adv-list">
          {drifting.map((r) => {
            const g = fmt.fmtG(Math.abs(r.vsLineG));
            return (
              <li key={r.station}>
                <b>{nameOf(r.station)}</b>{' '}
                {r.vsLineG > 0 ? W.weight.readsHeavier(g, r.daysHeld) : W.weight.readsLighter(g, r.daysHeld)}
                <span className="qw-muted"> {projectionSentence(r.projection, d, r.longestRun)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="qw-note">{QW.advisory.window(TRAILING_DAYS)} {QW.advisory.recommendationOnly}</p>
      <button type="button" className="ui-link" onClick={onStations}>{QW.advisory.seeStations}</button>
    </>
  );
}

/* -------------------------------------------------------------------- about */

function About({
  d,
  spc,
  sackBasis,
  isSack,
}: {
  d: WeightStationsData | null;
  spc: SpcData | null;
  sackBasis: string | null;
  isSack: boolean;
}) {
  return (
    <Disclosure id="quality-weight-about" label={C.ui.aboutFigures}>
      <p>
        {RESERVED.weightBasisLabel}: {QW.about.basisSentence}
        {isSack && sackBasis ? ` ${sackBasis}` : ''}
      </p>
      {!isSack && d !== null && d.targetG !== null && (
        <p>{QW.about.targetSource(d.productLabel ?? W.reports.wholeLine)}</p>
      )}
      {!isSack && d !== null && positive(d.limitsChangedInWindow) && <p>{W.weight.limitsChangedTable(d.limitsChangedInWindow)}</p>}
      {!isSack && d !== null && d.productChangesInWindow > 0 && <p>{W.weight.productChangedTable(d.productChangesInWindow)}</p>}
      {!isSack && d !== null && (
        <p>
          {QW.about.agreement(
            fmt.fmtInt(d.disagreement.passedButOutside),
            fmt.fmtInt(d.disagreement.rejectedButInside),
            fmt.fmtInt(d.disagreement.judged),
          )}
          {d.disagreement.unjudged > 0 && ` ${QW.about.unjudged(fmt.fmtInt(d.disagreement.unjudged))}`}
        </p>
      )}
      {spc !== null && spc.count > 0 && spc.mean !== null && spc.stdevOverall !== null && spc.stdevWithin !== null && (
        <p>
          {QW.about.working(
            fmt.fmtInt(spc.count),
            isSack ? W.readings.sacks.toLowerCase() : W.readings.cones.toLowerCase(),
            isSack ? fmt.fmtKg(spc.mean) : fmt.fmtG(spc.mean),
            spc.stdevOverall.toFixed(2),
            spc.stdevWithin.toFixed(2),
            spc.unit,
            spc.bucketLabel,
          )}{' '}
          {spc.xLimits.valid ? W.weight.outsideBand(fmt.fmtInt(spc.xbarOutOfControl), fmt.fmtInt(spc.subgroups.length)) : W.weight.bandInvalid}{' '}
          {W.weight.patternsWithheld}
        </p>
      )}
      <p>{QW.about.plantTime}</p>
    </Disclosure>
  );
}
