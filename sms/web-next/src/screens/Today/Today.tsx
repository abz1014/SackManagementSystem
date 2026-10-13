/**
 * Today (task E2): "Is the line running, what has it made, and does anything need attention?"
 *
 * Page template (DESIGN-SYSTEM 7.1): status band, KPI row, hero (station heat grid), detail.
 * Replaces the old Line screen and the front of the old Sacks screen. Everything here is read from
 * the server or from lib/ through the bridge: station states from /api/station-status, health from
 * assessHealth, period maths from lib/period. Nothing is decided in this file except word choice.
 *
 * TRACE rows satisfied: A3-023 (headline, KPIs), A3-025 (cones per shift or day), A3-026 (attention),
 * A3-027 (station heat grid), A3-029 (product change note, links to Products), A3-030 / G-10 (latest
 * readings), A3-031 + A3-044 + A3-045 (sack section), A6-H14 (hops), A1-042, A1-057, A1-061, A1-080.
 */
import { useMemo, type ReactNode } from 'react';
import {
  getAttention, getMachinesRunning, getProducts, getProduction, getRejectsFiltered, getSackSummary,
  type AttentionData, type Envelope, type MachinesRunningData, type ProductionData, type StationStatusData,
} from '../../bridge/api';
import { W } from '../../bridge/words';
import { fmt, generationWords, health as healthLib, live, period as P, productLabel } from '../../bridge/lib';
import { C, RESERVED, formatClock, formatDate, FRAGMENTS } from '../../copy';
import { useData, useRange, useStationStatus, usePeriod, useProduction, type DataState } from '../../data';
import type { Compare } from '../../data';
import type { Route } from '../../route';
import { Disclosure } from '../../ui/Disclosure';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Icon } from '../../ui/Icon';
import { KpiCard } from '../../ui/KpiCard';
import { routeFor } from '../../ui/nav';
import { Skeleton } from '../../ui/Skeleton';
import { StationHeatGrid } from '../../ui/StationHeatGrid';
import { stationText } from '../../ui/StationTile';
import type { ScreenProps } from '../registry';
import { AttentionCard, LatestCard, ReasonsCard, SacksSection, ShiftsCard } from './sections';
import {
  countDelta, dayRange, isEmptyProduction, kpis, nf0, periodWords, productChanges, changeTime,
  rateDelta, ranSentence, stationCounts, stationSentence,
} from './model';
import { Hop } from './Hop';
import './Today.css';

const T = C.today;
const TF = FRAGMENTS.today;

type Go = ScreenProps['go'];
type Prod = DataState<Envelope<ProductionData>>;
type Stations = DataState<Envelope<StationStatusData>>;
type Machines = DataState<Envelope<MachinesRunningData>>;
type Attention = DataState<Envelope<AttentionData>>;

function periodKey(p: P.Period): string {
  return [
    p.key, p.from, p.to, p.shift ?? '',
    p.fromShift ? P.encodeShiftRef(p.fromShift) : '',
    p.toShift ? P.encodeShiftRef(p.toShift) : '',
  ].join('|');
}

export function TodayScreen({ route, go }: ScreenProps) {
  const ps = usePeriod();
  if (ps.period === null) {
    if (ps.status === 'error') {
      return <ErrorState part={ps.failed[0] ?? 'the plant clock'} cause="Today needs the plant clock to know which period to show." />;
    }
    return <Skeleton part="today" height={320} />;
  }
  return <TodayBody route={route} go={go} period={ps.period} compare={ps.compare} setParams={ps.setParams} />;
}

function TodayBody({
  route, go, period, compare, setParams,
}: {
  route: Route;
  go: Go;
  period: P.Period;
  compare: Compare | null;
  setParams: (p: P.PeriodParams) => void;
}) {
  const liveCtx = live.useLive();
  const line = liveCtx.line;
  const asOf = live.useAsOf();
  const pq = P.periodQuery(period);
  const key = `${periodKey(period)}:${asOf ?? 'now'}`;
  const isLive = period.live;
  const spreadKind: 'day' | 'shift' = period.days >= 2 ? 'day' : 'shift';

  const prod = useProduction(period, compare);
  const spread = useData(TF.shifts.partName, () => getProduction({ ...pq, groupBy: spreadKind }), `today-spread:${spreadKind}:${key}`, { live: isLive });
  const stations = useStationStatus(period);
  const sacks = useData(TF.sacks.partName, () => getSackSummary(pq), `today-sacks:${key}`, { live: isLive });
  const reasons = useData(TF.reasons.partName, () => getRejectsFiltered(pq), `today-reasons:${key}`, { live: isLive });
  const attention = useData(TF.attention.partName, () => getAttention({
    from: period.from, to: period.to, shift: period.shift, fromShift: pq.fromShift, toShift: pq.toShift,
  }), `today-attention:${periodKey(period)}`, { live: isLive });
  const machines = useData(TF.productChange.partName, () => getMachinesRunning(period.tsTo), `today-machines:${isLive ? (asOf ?? 'now') : period.tsTo}`, { live: isLive });
  const products = useData(TF.sacks.productsPartName, () => getProducts(), 'today-products', { live: false });
  const range = useRange();

  const hop = (s: 'quality' | 'products', t: string, extra: Record<string, string> = {}): Route => {
    const base = routeFor(route, { s, t });
    return { ...base, keys: { ...base.keys, ...extra } };
  };
  const openStation = (n: number) => go({ ...route, sheet: { kind: 'station', id: String(n) } });
  const labels = useMemo(() => productLabel.distinctProductLabels(products.data?.products ?? []), [products.data]);

  const prodData = prod.data?.data ?? null;
  const empty = prodData !== null && isEmptyProduction(prodData);
  const health = healthLib.assessHealth(line);

  // Parts that failed with nothing to show are named in the notes too, so a missing card is never a silent absence.
  const unloaded: string[] = [];
  if (sacks.error !== null && sacks.data === null) unloaded.push(TF.sacks.partName);
  if (reasons.error !== null && reasons.data === null) unloaded.push(TF.reasons.partName);
  if (attention.error !== null && attention.data === null) unloaded.push(TF.attention.partName);
  if (products.error !== null && products.data === null) unloaded.push(TF.sacks.productsPartName);

  const showNewest = () => {
    const day = range.data?.maxDate ?? line?.dataAsOfUtc?.slice(0, 10) ?? null;
    if (day) setParams({ key: 'pick', picked: { from: day, to: day } });
  };

  return (
    <div className="today">
      <Band
        period={period} prod={prod} spread={spread} stations={stations} spreadKind={spreadKind}
        empty={empty} health={health}
      />

      <div className="today-kpis">
        <KpiRow prod={prod} period={period} empty={empty} />
      </div>
      {prodData !== null && !empty && (
        <p className="today-links">
          <span>{T.links.label}:</span>
          <Hop to={hop('quality', 'register')} go={go}>{T.links.cones}</Hop>
          <Hop to={hop('quality', 'register', { rl: 'sacks' })} go={go}>{T.links.sacks}</Hop>
          <Hop to={hop('quality', 'rejects')} go={go}>{T.links.failedInspection}</Hop>
          <Hop to={hop('quality', 'register', { rf: 'outsideLimits' })} go={go}>
            {T.links.outsideLimits(prodData.states ? nf0(prodData.states.low + prodData.states.high) : null)}
          </Hop>
        </p>
      )}
      {prod.status === 'ok' && compare !== null && prodData !== null && prodData.previous === undefined && (
        <p className="today-note" role="status">{T.band.comparisonMissing}</p>
      )}

      {empty ? (
        <EmptyState
          newest={line?.dataAsOfUtc ?? null}
          onShowNewest={line?.dataAsOfUtc ? showNewest : undefined}
          message={emptyMessage(line, period.live)}
        />
      ) : (
        <>
          <StationsCard
            stations={stations} machines={machines} labels={labels} period={period} go={go}
            onOpen={openStation} products={hop('products', 'board')}
          />
          <div className="today-grid">
            <div className="span-7">
              <ShiftsCard spread={spread} spreadKind={spreadKind} period={period} sacks={sacks} onZoom={setParams} />
            </div>
            <div className="span-5">
              <ReasonsCard reasons={reasons} period={period} />
            </div>
            <div className="span-6">
              <AttentionCard attention={attention} names={new Map((stations.data?.data.stations ?? []).map((x) => [x.station, x.name] as const))} onOpenStation={openStation} go={go} quality={hop('quality', 'stations')} rejectsRoute={hop('quality', 'rejects')} limitsRoute={hop('quality', 'register', { rf: 'outsideLimits' })} />
            </div>
            <div className="span-6">
              <LatestCard
                line={line} loading={liveCtx.loading} error={liveCtx.error} refresh={liveCtx.refresh}
                onOpenCone={(id) => go({ ...route, sheet: { kind: 'cone', id } })}
                onOpenSack={(id) => go({ ...route, sheet: { kind: 'sack', id } })}
                failedRoute={hop('quality', 'rejects')} go={go}
              />
            </div>
          </div>
          <SacksSection
            route={route} go={go} period={period} sacks={sacks} spread={spread} spreadKind={spreadKind} products={products} labels={labels}
            onZoom={setParams}
            weights={hop('quality', 'weight', { wt: 'sack' })}
            list={hop('quality', 'register', { rl: 'sacks' })}
            stock={hop('quality', 'register', { rl: 'stock' })}
          />
        </>
      )}

      <Notes unloaded={unloaded} prodData={prodData} stations={stations} machines={machines} attention={attention} line={line} period={period} />
    </div>
  );
}

function emptyMessage(line: ReturnType<typeof live.useLive>['line'], periodIsLive: boolean): ReactNode {
  if (!line || !line.dataAsOfUtc) return C.noDataYet;
  const when = C.nothingInPeriod(formatDate(line.dataAsOfUtc));
  if (!periodIsLive) return when;
  const age = fmt.fmtSpan(fmt.secondsBetween(line.dataAsOfUtc, line.plantNowUtc));
  return (
    <>
      {when} {T.empty.lineMayBeStopped(age)}{' '}
      <a className="ui-link" href="?s=system&t=diagnostics">{T.empty.openDiagnostics}</a>
    </>
  );
}

/* ------------------------------------------------------------------ band */

function Band({
  period, prod, spread, stations, spreadKind, empty, health,
}: {
  period: P.Period;
  prod: Prod;
  spread: Prod;
  stations: Stations;
  spreadKind: 'day' | 'shift';
  empty: boolean;
  health: healthLib.Health;
}) {
  const { line, loading } = live.useLive();
  const counts = stations.data ? stationCounts(stations.data.data.stations) : null;
  const known = healthLib.stateIsKnowable(health);

  let first: string | null = null;
  let pending = prod.status === 'loading' || stations.status === 'loading';
  if (period.live) {
    if (!line) {
      if (loading) pending = true;
      else first = C.couldntLoad('the line status');
    } else if (!known) {
      first = health.kind === 'stale' && health.readingUtc
        ? C.lineStatusUnknown(formatClock(health.readingUtc))
        : health.kind === 'none' ? C.noDataYet : `${W.state.unknown}.`;
    } else {
      const title = line.lineShortName || line.lineName;
      if (line.state.status === 'running') first = T.band.running(title);
      else if (line.state.status === 'stopped') {
        const behind = line.state.behindSeconds;
        first = `${title} ${behind === null ? W.state.stoppedUnknownDuration : W.state.stopped(fmt.fmtSpan(behind))}.`;
      } else first = `${title} ${W.state.idle(line.dataAsOfUtc ? fmt.fmtClockOn(line.dataAsOfUtc, line.plantNowUtc) : '-')}.`;
    }
  } else {
    if (spread.status === 'loading') pending = true;
    first = ranSentence(spread.data ? spread.data.data.rows : null, spreadKind, period);
  }
  const second = stationSentence(counts);
  const sentence = empty && !(period.live && !known) ? T.band.nothing : [first, second].filter((s) => s !== null).join(' ');

  // TRACE A3-024: when a newer reading sits in another data set, say which figures are counted (RT-007, both directions).
  const quiet = line && line.dataAsOfUtc && generationWords.hasNewerElsewhere(line.generation)
    ? generationWords.quietBecauseGeneration(
        line.generation,
        fmt.fmtClockOn(line.dataAsOfUtc, line.plantNowUtc),
        fmt.secondsBetween(line.dataAsOfUtc, line.plantNowUtc) >= 60 ? fmt.fmtSpan(fmt.secondsBetween(line.dataAsOfUtc, line.plantNowUtc)) : null,
      )
    : null;

  const prev = prod.data?.data.previous;
  const caption = `${periodWords(period)}, ${TF.band.plantTime}${prev ? `, ${TF.band.comparedWith(dayRange(prev.from, prev.to))}` : ''}`;

  return (
    <header className="band">
      <h1>{C.nav.today}</h1>
      {pending && sentence === '' ? <span className="band-skel" role="status" aria-label="Loading the line status" /> : <p className="sentence">{sentence}</p>}
      <p className="cap">{caption}.</p>
      <p className="cap">{T.answers}</p>
      {quiet && <p className="cap" data-testid="today-generation">{quiet}</p>}
      {period.live && <p className="cap">{T.band.updatedLive}</p>}
    </header>
  );
}

/* ------------------------------------------------------------------- KPIs */

function KpiRow({ prod, period, empty }: { prod: Prod; period: P.Period; empty: boolean }) {
  const status = prod.status === 'loading' ? 'loading' : prod.status === 'error' ? 'error' : empty ? 'empty' : 'ok';
  const d = prod.data?.data ?? null;
  const k = d ? kpis(d) : null;
  const prevData = d?.previous?.result ?? null;
  const pk = prevData ? kpis(prevData) : null;
  const live = period.live;

  const common = { status, part: TF.kpi.partName, onRetry: prod.refresh } as const;
  const fmtRate = (r: { pct: number | null; unreadable: boolean }) => (r.unreadable || r.pct === null ? null : r.pct.toFixed(1));
  const rateNote = (r: { n: number | null; of: number | null }, kind: 'inspection' | 'weight'): string | null =>
    r.n === null ? null
      : kind === 'inspection' ? T.kpi.coneCount(nf0(r.n))
      : T.kpi.ofCones(nf0(r.n), r.of === null ? '-' : nf0(r.of));

  return (
    <>
      <KpiCard {...common} label={T.kpi.cones} chip={1} icon={<Icon name="stations" />}
        value={k?.cones.text ?? null} delta={k && pk ? countDelta(k.cones, pk.cones, live, TF.kpi.vsCount) : null} />
      <KpiCard {...common} label={T.kpi.sacks} chip={2} icon={<Icon name="sacks" />}
        value={k?.sacks.text ?? null} delta={k && pk ? countDelta(k.sacks, pk.sacks, live, TF.kpi.vsCount) : null} />
      <KpiCard {...common} label={T.kpi.packed} chip={3} icon={<Icon name="weight" />}
        value={k?.kg.text ?? null} unit={TF.kpi.kg} delta={k && pk ? countDelta(k.kg, pk.kg, live, TF.kpi.vsKg) : null} />
      <KpiCard {...common} label={C.checks.failedInspection} chip={4} icon={<Icon name="rejects" />}
        value={k ? fmtRate(k.inspection) : null} unit={TF.kpi.percent} note={k ? rateNote(k.inspection, 'inspection') : null}
        delta={k && pk ? rateDelta(k.inspection, pk.inspection) : null} />
      <KpiCard {...common} label={C.checks.failedWeight} chip={5} icon={<Icon name="health" />}
        value={k ? fmtRate(k.weight) : null} unit={TF.kpi.percent} note={k ? rateNote(k.weight, 'weight') : null}
        delta={k && pk ? rateDelta(k.weight, pk.weight) : null} />
    </>
  );
}

/* --------------------------------------------------------------- stations */

function StationsCard({
  stations, machines, labels, period, go, onOpen, products,
}: {
  stations: Stations;
  machines: Machines;
  labels: Map<number, string>;
  period: P.Period;
  go: Go;
  onOpen: (n: number) => void;
  products: Route;
}) {
  const rows = stations.data?.data.stations ?? null;
  const noData = rows ? rows.filter((s) => s.state === 'nodata') : [];
  const words = periodWords(period);
  const changes = machines.data
    ? productChanges(machines.data.data.machines, period.tsFrom, period.tsTo)
    : [];
  const top = changes[0];
  const nameOf = (n: number, name: string | null) => stationText({ station: n, name: name ?? null });
  const stationNames = new Map((rows ?? []).map((s) => [s.station, s.name] as const));
  const productFor = (c: (typeof changes)[number]) =>
    (c.materialId !== null ? labels.get(c.materialId) : undefined) ?? c.productName ?? null;

  return (
    <section className="card today-card" aria-labelledby="today-stations-h">
      <div className="today-head">
        <h2 id="today-stations-h">{T.stations.title}</h2>
      </div>
      {top && (
        <div className="today-change" role="status">
          <p>
            {T.productChange.changed(nameOf(top.station, stationNames.get(top.station) ?? null), productFor(top))}{' '}
            {T.productChange.firstCone(changeTime(top.atUtc, period.to, period.from))}
            {changes.length > 1 ? ` ${T.productChange.others(changes.length - 1)}` : ''}
          </p>
          <Hop to={products} go={go}>{T.productChange.link}</Hop>
        </div>
      )}
      {machines.status === 'error' && (
        <p className="cap-sm" role="status">{C.couldntLoad(TF.productChange.partName)}</p>
      )}
      {stations.status === 'loading' && <Skeleton part={TF.stations.partName} height={240} />}
      {stations.status === 'error' && (
        <ErrorState part={TF.stations.partName} cause={stations.error ?? undefined} onRetry={stations.refresh} minHeight={160} />
      )}
      {rows !== null && rows.length === 0 && <EmptyState message={T.stations.none} />}
      {rows !== null && rows.length > 0 && (
        <>
          <StationHeatGrid stations={rows} onOpen={onOpen} />
          <p className="cap">{T.stations.caption(words)}</p>
          {noData.length > 0 && (
            <p className="cap">
              {T.stations.noCones(
                `${T.stations.stationsWord(noData.length)} ${noData.map((s) => s.station).join(', ')}`,
                words,
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- disclosures */

function Notes({
  unloaded, prodData, stations, machines, attention, line, period,
}: {
  unloaded: readonly string[];
  prodData: ProductionData | null;
  stations: Stations;
  machines: Machines;
  attention: Attention;
  line: ReturnType<typeof live.useLive>['line'];
  period: P.Period;
}) {
  const st = stations.data?.data ?? null;
  const att = attention.data?.data ?? null;
  const pct = (mult: number) => (st && st.lineFailedPct !== null ? `${(mult * st.lineFailedPct).toFixed(1)} %` : null);
  const lookbackLimited = (machines.data?.data.machines ?? []).some((m) => m.runStartIsLookbackLimit === true);
  const generation = prodData?.generationNote;
  return (
    <>
      {st && (
        <Disclosure id="today-states" label={T.states.title}>
          <div className="today-details">
            <p>{T.states.rule(String(st.thresholds.act), String(st.thresholds.watch), pct(st.thresholds.act), pct(st.thresholds.watch), periodWords(period))}</p>
            <p>{T.states.minCones(st.thresholds.minCones)}</p>
            {st.thresholds.assumed && <p>{RESERVED.assumedHeading}.</p>}
          </div>
        </Disclosure>
      )}
      <Disclosure id="today-about" label={C.ui.aboutFigures}>
        <div className="today-details">
          <p>{T.about.countedOnce}</p>
          <p>{T.about.productStamped}</p>
          {lookbackLimited && <p>{T.about.lookback}</p>}
          {generation?.spansGenerations && (
            <p>{W.state.periodGenerations(generation.otherGenerationExcluded > 0 ? nf0(generation.otherGenerationExcluded) : null)}</p>
          )}
          {prodData?.limitProvenance?.note && <p>{prodData.limitProvenance.note}</p>}
          {prodData?.implausible != null && prodData.implausible > 0 && <p>{W.detailsImplausible(nf0(prodData.implausible))}</p>}
          {line && (
            <p>
              {T.about.lag(
                line.ingestLagSeconds != null ? fmt.fmtSpan(line.ingestLagSeconds) : 'a quarter of an hour',
                fmt.fmtSpan(line.state.stopThresholdSeconds),
              )}
            </p>
          )}
          <p>{T.about.detectors(att ? att.window.days : null, att ? fmt.fmtG(att.thresholds.driftG) : null, att ? att.thresholds.minDaysHeld : null)}</p>
          {unloaded.length > 0 && <p>{T.about.notLoaded(unloaded.join(', '))}</p>}
          <p>{T.about.plantTimes}</p>
        </div>
      </Disclosure>
    </>
  );
}
