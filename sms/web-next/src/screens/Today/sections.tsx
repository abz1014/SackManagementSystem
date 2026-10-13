/**
 * Detail cards of the Today screen: cones per shift or day, failed inspection reasons, attention,
 * latest readings, and the sack section (the front of the old Sacks screen). Each card owns its four
 * states (loading, error naming its part, empty, ready); a failed fetch never draws a zero.
 */
import type { ReactNode } from 'react';
import type {
  AttentionData, AttentionFinding, Envelope, LiveLine, ProductionData, ProductionRow, RejectDataFiltered, SackSummaryData,
} from '../../bridge/api';
import { fmt, period as P } from '../../bridge/lib';
import { projectionSentence } from '../../bridge/station';
import { W } from '../../bridge/words';
import { BarChart, Pareto } from '../../charts';
import { C, formatClock, formatDate, FRAGMENTS } from '../../copy';
import type { DataState } from '../../data';
import type { Route } from '../../route';
import { AttentionList, type AttentionItem } from '../../ui/AttentionList';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Segmented } from '../../ui/Segmented';
import { stationText } from '../../ui/StationTile';
import { ChartSkeleton, Skeleton } from '../../ui/Skeleton';
import type { ScreenProps } from '../registry';
import { reasonShort } from '../Quality/Rejects/format';
import { Hop } from './Hop';
import { findingKind, nf0, nf1, periodWords } from './model';

const T = C.today;
const TF = FRAGMENTS.today;

type Go = ScreenProps['go'];
const SHIFT_ORDER = ['morning', 'evening', 'night'] as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Rows of a by-shift or by-day answer, in reading order. */
function orderedRows(rows: readonly ProductionRow[], spreadKind: 'day' | 'shift'): ProductionRow[] {
  const real = rows.filter((r) => r.group !== 'total');
  return spreadKind === 'shift'
    ? [...real].sort((a, b) => SHIFT_ORDER.indexOf(a.group as (typeof SHIFT_ORDER)[number]) - SHIFT_ORDER.indexOf(b.group as (typeof SHIFT_ORDER)[number]))
    : [...real].sort((a, b) => (a.group < b.group ? -1 : 1));
}

const shiftName = (g: string): string => (W.shiftName as Record<string, string>)[g] ?? g;
const dayLabel = (d: string): string => formatDate(`${d}T12:00:00Z`).replace(/ \d{4}$/, '');

function labelOf(g: string, spreadKind: 'day' | 'shift'): string {
  return spreadKind === 'shift' ? shiftName(g) : dayLabel(g);
}

/** The page period a bar zooms to: one production day, or one shift of the single day on screen. */
function zoomFor(spreadKind: 'day' | 'shift', group: string, day: string): P.PeriodParams | null {
  if (spreadKind === 'day') return { key: 'range', range: P.dayToShiftRange(group, group) };
  if (!(SHIFT_ORDER as readonly string[]).includes(group)) return null;
  const ref = { date: day, shift: group as (typeof SHIFT_ORDER)[number] };
  return { key: 'range', range: { from: ref, to: ref } };
}

/* ---------------------------------------------------------------- shifts */

export function ShiftsCard({
  spread, spreadKind, period, sacks, onZoom,
}: {
  spread: DataState<Envelope<ProductionData>>;
  spreadKind: 'day' | 'shift';
  period: P.Period;
  sacks: DataState<Envelope<SackSummaryData>>;
  onZoom: (p: P.PeriodParams) => void;
}) {
  const title = T.shifts.title(spreadKind);
  return (
    <section className="card today-card" aria-label={title}>
      {spread.status === 'loading' && !spread.data && <ChartSkeleton part={TF.shifts.partName} />}
      {spread.status === 'error' && <ErrorState part={TF.shifts.partName} cause={spread.error ?? undefined} onRetry={spread.refresh} minHeight={200} />}
      {spread.data && (() => {
        const rows = orderedRows(spread.data.data.rows, spreadKind);
        const values = rows.map((r) => num(r.cones));
        const readable = values.filter((v): v is number => v !== null);
        const total = readable.reduce((a, b) => a + b, 0);
        const byShift = sacks.data?.data.byShift ?? [];
        const sackParts = byShift.length > 0 && spreadKind === 'shift'
          ? T.shifts.sacksBy(SHIFT_ORDER.flatMap((s) => {
              const b = byShift.find((x) => x.shift === s);
              return b ? [`${shiftName(s).toLowerCase()} ${nf0(b.sacks)}`] : [];
            }).join(', '))
          : null;
        return (
          <>
            {rows.length < 2 && <p className="cap-sm">{T.shifts.onePoint(spreadKind)}</p>}
            <BarChart
              chartId={`today-cones-${spreadKind}`}
              title={title}
              unit={TF.shifts.unit}
              categories={rows.map((r) => labelOf(r.group, spreadKind))}
              series={[{ name: T.shifts.series, values }]}
              caption={T.shifts.caption(periodWords(period), nf0(total), sackParts)}
              formatValue={nf0}
              periodFor={(i) => (rows[i] ? zoomFor(spreadKind, rows[i].group, period.from) : null)}
              onZoom={onZoom}
            />
            {spread.staleError && <p className="cap">{W.chartStale}</p>}
          </>
        );
      })()}
    </section>
  );
}

/* --------------------------------------------------------------- reasons */

export function ReasonsCard({ reasons, period }: { reasons: DataState<Envelope<RejectDataFiltered>>; period: P.Period }) {
  return (
    <section className="card today-card" aria-label={T.reasons.title}>
      {reasons.status === 'loading' && !reasons.data && <ChartSkeleton part={TF.reasons.partName} />}
      {reasons.status === 'error' && <ErrorState part={TF.reasons.partName} cause={reasons.error ?? undefined} onRetry={reasons.refresh} minHeight={200} />}
      {reasons.data && (() => {
        const quality = reasons.data.data.reasons.filter((r) => r.rejectType === 'quality');
        if (quality.length === 0) return <EmptyState message={T.reasons.none} />;
        // The server's running share covers every reason it sent. With only failed-inspection reasons it is used as is;
        // with weight-check reasons mixed in, the share is restated over the failed-inspection reasons alone.
        const pure = quality.length === reasons.data.data.reasons.length;
        const total = quality.reduce((a, r) => a + r.count, 0);
        let running = 0;
        const rows = quality.map((r) => {
          running += r.count;
          return {
            label: reasonShort(r),
            count: r.count,
            cumulativePct: pure ? r.cumulativePct : Math.round((1000 * running) / total) / 10,
          };
        });
        return (
          <Pareto
            chartId="today-reasons"
            title={T.reasons.title}
            unit={TF.reasons.unit}
            rows={rows}
            formatValue={nf0}
            caption={T.reasons.caption(periodWords(period), nf0(total))}
          />
        );
      })()}
    </section>
  );
}

/* ------------------------------------------------------------- attention */

export function AttentionCard({
  attention, names, onOpenStation, go, quality, rejectsRoute, limitsRoute,
}: {
  attention: DataState<Envelope<AttentionData>>;
  names: ReadonlyMap<number, string | null>;
  onOpenStation: (n: number) => void;
  go: Go;
  quality: Route;
  rejectsRoute: Route;
  limitsRoute: Route;
}) {
  const data = attention.data?.data ?? null;
  const sentence = (f: AttentionFinding): string => {
    switch (f.kind) {
      case 'station_drift': {
        const name = f.station == null ? T.latest.unknownStation : stationText({ station: f.station, name: names.get(f.station) ?? null });
        if (f.deltaG == null || f.days == null) return T.attention.driftUnreadable(name);
        const g = fmt.fmtG(Math.abs(f.deltaG));
        const said = `${name} ${f.deltaG > 0 ? W.weight.readsHeavier(g, f.days) : W.weight.readsLighter(g, f.days)}`;
        // The same projection line the station sheet draws, in the same words, only when the API computed one.
        return f.projection ? `${said} ${projectionSentence(f.projection, { targetG: f.projection.targetG })}` : said;
      }
      case 'reject_rise':
        return T.attention.rejectRise(
          findingKind(f),
          f.sinceUtc ? formatClock(f.sinceUtc) : '-',
          fmt.fmtPct1(f.ratePct),
          fmt.fmtPct1(f.usualPct),
        );
      default:
        return W.outsideLimitsThisPeriod;
    }
  };
  // A finding exists only because a detector fired, so it is listed as Watch. Whether it is worse is for the
  // station, rejects or register page it opens, never decided here.
  const items: AttentionItem[] = (data?.findings ?? []).map((f, i) => ({
    id: `${f.kind}:${f.station ?? i}`,
    state: 'watch' as const,
    sentence: sentence(f),
  }));
  const open = (item: AttentionItem) => {
    const f = data?.findings[items.indexOf(item)];
    if (!f) return;
    if (f.kind === 'station_drift' && f.station != null) onOpenStation(f.station);
    else go(f.kind === 'reject_rise' ? rejectsRoute : limitsRoute);
  };
  const more = data && data.totalFindings > data.findings.length ? data.totalFindings - data.findings.length : 0;
  const tooFew = data !== null && data.window.days < data.thresholds.minDaysHeld;
  return (
    <div className="today-card card">
      {attention.status === 'loading' && <Skeleton part={TF.attention.partName} height={120} />}
      {attention.status === 'error' && <ErrorState part={TF.attention.partName} cause={attention.error ?? undefined} onRetry={attention.refresh} minHeight={120} />}
      {data && (
        <>
          <AttentionList items={items} onOpen={open} />
          <p className="cap">{T.attention.caption(data.window.days, formatDate(`${data.window.from}T12:00:00Z`), formatDate(`${data.window.to}T12:00:00Z`))}</p>
          {tooFew && <p className="cap">{T.attention.tooFew(data.window.days)}</p>}
          {more > 0 && (
            <p className="cap-sm">
              {T.attention.more(more)} <Hop to={quality} go={go}>{T.attention.openQuality}</Hop>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- latest */

export function LatestCard({
  line, loading, error, refresh, onOpenCone, onOpenSack, failedRoute, go,
}: {
  line: LiveLine | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  onOpenCone: (id: string) => void;
  onOpenSack: (id: string) => void;
  failedRoute: Route;
  go: Go;
}) {
  let body: ReactNode;
  if (!line) {
    body = loading
      ? <Skeleton part={TF.latest.partName} height={140} />
      : <ErrorState part={TF.latest.partName} cause={error ?? undefined} onRetry={refresh} minHeight={120} />;
  } else {
    const verdict = (inRange: boolean | null) => (inRange === false ? C.checks.failedWeight : C.checks.passedWeight);
    const rows: ReactNode[] = [];
    if (line.lastCone) {
      const c = line.lastCone;
      rows.push(
        <li key="cone">
          <span className="k">{T.latest.cone}</span>
          <span className="v">
            <button type="button" className="ui-link" onClick={() => onOpenCone(String(c.eventId))}>
              {T.latest.coneText(
                c.weightG === null ? '-' : fmt.fmtG(c.weightG),
                c.inRange === null ? C.checks.notChecked : verdict(c.inRange),
                c.station === null ? T.latest.unknownStation : C.station(c.station),
                formatClock(c.ts),
              )}
            </button>
          </span>
        </li>,
      );
    }
    if (line.lastSack) {
      const s = line.lastSack;
      rows.push(
        <li key="sack">
          <span className="k">{T.latest.sack}</span>
          <span className="v">
            <button type="button" className="ui-link" onClick={() => onOpenSack(String(s.eventId))}>
              {T.latest.sackText(
                s.weightKg === null ? '-' : fmt.fmtKg(s.weightKg),
                s.inRange === null ? C.checks.notChecked : verdict(s.inRange),
                formatClock(s.ts),
              )}
            </button>
          </span>
        </li>,
      );
    }
    if (line.lastReject) {
      const r = line.lastReject;
      rows.push(
        <li key="failed">
          <span className="k">{T.latest.failed}</span>
          <span className="v">
            {T.latest.failedText(r.station === null ? T.latest.unknownStation : C.station(r.station), formatClock(r.ts))}
            <Hop to={failedRoute} go={go}>{T.latest.failedHop}</Hop>
          </span>
        </li>,
      );
    }
    body = rows.length === 0 ? <p className="cap-sm">{T.latest.none}</p> : <ul className="today-latest">{rows}</ul>;
  }
  return (
    <section className="card today-card" aria-label={T.latest.title}>
      <h2>{T.latest.title}</h2>
      {body}
    </section>
  );
}

/* ----------------------------------------------------------------- sacks */

interface GroupRow {
  key: string;
  label: string;
  sacks: number;
  kg: number;
  avgKg: number | null;
  inRangePct: number | null;
}

export function SacksSection({
  route, go, period, sacks, spread, spreadKind, products, labels, onZoom, weights, list, stock,
}: {
  route: Route;
  go: Go;
  period: P.Period;
  sacks: DataState<Envelope<SackSummaryData>>;
  spread: DataState<Envelope<ProductionData>>;
  spreadKind: 'day' | 'shift';
  products: DataState<unknown>;
  labels: Map<number, string>;
  onZoom: (p: P.PeriodParams) => void;
  weights: Route;
  list: Route;
  stock: Route;
}) {
  const unit: 'sacks' | 'kg' = route.keys.su === 'kg' ? 'kg' : 'sacks';
  const setUnit = (u: string) => go({ ...route, keys: { ...route.keys, su: u === 'kg' ? 'kg' : 'sacks' } });
  const s = sacks.data?.data ?? null;

  const body = (() => {
    if (sacks.status === 'loading') return <Skeleton part={TF.sacks.partName} height={200} />;
    if (sacks.status === 'error' || s === null) return <ErrorState part={TF.sacks.partName} cause={sacks.error ?? undefined} onRetry={sacks.refresh} minHeight={160} />;
    if (s.totals.sacks === 0) return <EmptyState message={T.sacks.none} />;
    const nameOf = (id: number | null, plain: string | null) =>
      id === null ? T.sacks.noProduct : (labels.get(id) ?? plain ?? `Product ${id}`);
    const shiftRows: GroupRow[] = SHIFT_ORDER.flatMap((sh) => {
      const b = s.byShift.find((x) => x.shift === sh);
      return b ? [{ key: sh, label: shiftName(sh), sacks: b.sacks, kg: b.kg, avgKg: b.avgKg, inRangePct: b.inRangePct }] : [];
    });
    const productRows: GroupRow[] = s.byProduct.map((b) => ({
      key: String(b.materialId ?? 'none'), label: nameOf(b.materialId, b.productName),
      sacks: b.sacks, kg: b.kg, avgKg: b.avgKg, inRangePct: b.inRangePct,
    }));
    const cols = (head: string): Column<GroupRow>[] => [
      { key: 'label', header: head },
      { key: 'sacks', header: T.sacks.colSacks, numeric: true, render: (r) => nf0(r.sacks), sortValue: (r) => r.sacks },
      { key: 'kg', header: T.sacks.colKg, numeric: true, render: (r) => nf1(r.kg), sortValue: (r) => r.kg },
      { key: 'avg', header: T.sacks.colAvg, numeric: true, render: (r) => (r.avgKg === null ? '-' : nf1(r.avgKg)) },
      { key: 'pass', header: T.sacks.colPassed, numeric: true, render: (r) => (r.inRangePct === null ? '-' : `${nf1(r.inRangePct)} %`) },
    ];

    const rows = spread.data ? orderedRows(spread.data.data.rows, spreadKind) : [];
    const values = rows.map((r) => num(unit === 'kg' ? r.sackWeightKg : r.sacks));
    const t = s.totals;
    return (
      <>
        <dl className="today-sackfigs">
          <div><dt>{T.sacks.unitSacks}</dt><dd>{nf0(t.sacks)}</dd></div>
          <div><dt>{T.kpi.packed}</dt><dd>{nf1(t.kg)} kg</dd></div>
          <div><dt>{T.sacks.average}</dt><dd>{t.avgKg === null ? '-' : `${nf1(t.avgKg)} kg`}</dd></div>
          <div><dt>{T.sacks.passedScale}</dt><dd>{t.inRangePct === null ? '-' : `${nf1(t.inRangePct)} %`}</dd></div>
          <div><dt>{T.sacks.conesPerSack}</dt><dd>{t.conesPerSack === null ? '-' : nf1(t.conesPerSack)}</dd></div>
        </dl>
        {spread.status === 'error' && <ErrorState part={TF.shifts.partName} cause={spread.error ?? undefined} onRetry={spread.refresh} minHeight={120} />}
        {rows.length > 1 && (
          <BarChart
            chartId={`today-sacks-${spreadKind}-${unit}`}
            title={spreadKind === 'day' ? T.sacks.perDay(unit) : T.sacks.perShift(unit)}
            unit={unit === 'kg' ? 'kg' : 'sacks'}
            categories={rows.map((r) => labelOf(r.group, spreadKind))}
            series={[{ name: unit === 'kg' ? T.kpi.packed : T.sacks.title, values }]}
            formatValue={unit === 'kg' ? nf1 : nf0}
            caption={periodWords(period)}
            periodFor={(i) => (rows[i] ? zoomFor(spreadKind, rows[i].group, period.from) : null)}
            onZoom={onZoom}
          />
        )}
        {shiftRows.length > 0 && (
          <DataTable columns={cols(T.sacks.colShift)} rows={shiftRows} rowKey={(r) => r.key} caption={T.sacks.perShift('sacks')} />
        )}
        <h3 className="today-subhead">{T.sacks.byProduct}</h3>
        {products.status === 'error' && <p className="cap">{T.sacks.namesNotDistinct}</p>}
        <DataTable columns={cols(T.sacks.colProduct)} rows={productRows} rowKey={(r) => r.key} caption={T.sacks.byProduct} />
        {s.unattributed.rows > 0 && <p className="cap">{T.sacks.unattributed(nf0(s.unattributed.rows), nf0(s.unattributed.of))}</p>}
      </>
    );
  })();

  return (
    <section className="card today-card" aria-label={T.sacks.title}>
      <div className="today-head">
        <h2>{T.sacks.title}</h2>
        <Segmented
          label={T.sacks.unitLabel}
          value={unit}
          onChange={setUnit}
          options={[{ id: 'sacks', label: T.sacks.unitSacks }, { id: 'kg', label: TF.sacks.unitKg }]}
        />
      </div>
      {body}
      <p className="today-sackhops">
        <Hop to={list} go={go}>{T.sacks.list}</Hop>
        <Hop to={stock} go={go}>{T.sacks.stock}</Hop>
        <Hop to={weights} go={go}>{T.sacks.weights}</Hop>
      </p>
    </section>
  );
}

