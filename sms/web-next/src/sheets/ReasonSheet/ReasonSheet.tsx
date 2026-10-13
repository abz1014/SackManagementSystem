/**
 * Reason sheet (`sheet=reason:<day>|<type>|<tube>|<material>`, TRACE A1-067, A3-057, A6-S5, A4-13).
 * One reason, followed through the period day by day, then the cones of the chosen day.
 *
 *  - The name is the engineer's label, else "Code 2/1 (not named yet)"; "Name it" is rank 2 and absent below.
 *  - The per-day table follows the page's period; picking a day swaps the id in the URL (replace, not push),
 *    so the sheet keeps its place and Back still closes it.
 *  - Hops: the day in the Register, the day on the reject report, one cone's reading sheet.
 *  - Every fetch has its own failure state that names the part; a malformed id is "couldn't load", not a crash.
 */
import { C, FRAGMENTS } from '../../copy';
import { getRejectReason, getRejectsByDayCode, getStations, stationLabel, type RejectDayCodeRow, type RejectReasonRow } from '../../bridge/api';
import { batchName, fmt, period as P } from '../../bridge/lib';
import { W } from '../../bridge/words';
import { fmtDate, fmtDayShort, fmtTime } from '../../lib/fmt';
import { useData } from '../../data';
import { usePeriod } from '../../data/usePeriod';
import { hrefFor, plainClick } from '../../ui/nav';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import type { SheetProps } from '../../screens/registry';
import { dayRegisterHop, dayReportHop, parseReasonId, reasonIdOf, type ReasonId } from '../../screens/Quality/Rejects/model';
import { reasonName, fmtCount, fmtRate } from '../../screens/Quality/Rejects/format';
import { NameIt } from './NameIt';
import './reasonSheet.css';

const R = C.qualityRejects;
const RF = FRAGMENTS.qualityRejects;

const codeOf = (id: ReasonId): string => (id.rejectType === 'weight' ? 'weight' : `${id.tubeCode ?? 'null'}-${id.materialCode ?? 'null'}`);

export function ReasonSheet({ route, rank, go, onClose }: SheetProps) {
  const raw = route.sheet?.kind === 'reason' ? route.sheet.id : '';
  const ref = parseReasonId(raw);
  const title = ref ? (ref.rejectType === 'weight' ? R.weightRecords : reasonName({ label: null, tubeCode: ref.tubeCode, materialCode: ref.materialCode })) : R.sheetTitle;
  return (
    <Sheet open onClose={onClose} title={title} width={640}>
      {ref ? <Body key={raw} id={ref} rank={rank} route={route} go={go} /> : <ErrorState part={RF.part.thisReason} cause={R.malformed} />}
    </Sheet>
  );
}

function Body({ id, rank, route, go }: { id: ReasonId; rank: number; route: SheetProps['route']; go: SheetProps['go'] }) {
  const code = codeOf(id);
  const { period, status: periodStatus, failed: periodFailed } = usePeriod();
  const reason = useData('this reason', () => getRejectReason({ day: id.day, code, pageSize: 200 }), `reason:${id.day}:${code}`, { live: false });
  const stations = useData('station list', () => getStations(), 'stations', { live: false });
  const pq = period ? P.periodQuery(period) : null;
  const days = useData(
    'days for this reason',
    () => (pq ? getRejectsByDayCode({ ...pq, code }) : periodStatus === 'error' ? Promise.reject(new Error(`${periodFailed[0] ?? 'The plant clock'} could not be read, so the days cannot be listed.`)) : new Promise<never>(() => {})),
    `reason-days:${code}:${pq ? [pq.from, pq.to, pq.shift ?? '', pq.fromShift ?? '', pq.toShift ?? ''].join('|') : `wait:${periodStatus}`}`,
    { live: false },
  );

  const d = reason.data?.data ?? null;
  const name = d ? reasonName({ label: d.label, tubeCode: d.code.tubeCode, materialCode: d.code.materialCode }) : null;
  const dayRows = (days.data?.data.rows ?? []).filter((r) => r.rejectType === id.rejectType);

  const openDay = (day: string) =>
    go({ ...route, sheet: { kind: 'reason', id: reasonIdOf({ ...id, day }) } }, { replace: true });
  const hop = (r: ReturnType<typeof dayRegisterHop>) => ({ href: hrefFor(r), onClick: (e: React.MouseEvent) => plainClick(e, () => go(r)) });

  const dayCols: Column<RejectDayCodeRow>[] = [
    { key: 'day', header: R.colDay, render: (r) => fmtDayShort(`${r.day}T12:00:00Z`) },
    { key: 'count', header: R.colCones, numeric: true, render: (r) => fmtCount(r.count) },
    { key: 'cones', header: R.colConesThatDay, numeric: true, render: (r) => fmtCount(r.cones) },
    { key: 'rate', header: R.colRate, numeric: true, render: (r) => fmtRate(r.ratePct) },
  ];
  const coneCols: Column<RejectReasonRow>[] = [
    {
      key: 'time',
      header: R.colTimeStation,
      render: (r) => (
        <>
          <span className="rs-nowrap">{fmtTime(r.productionTsUtc)}</span>
          <span className="rs-sub">{r.station == null ? '–' : stationLabel(stations.data?.stations.find((x) => x.stationId === r.station), r.station)}</span>
        </>
      ),
    },
    {
      key: 'product',
      header: R.colProductRecord,
      render: (r) => (
        <>
          <span>{r.productLabel ?? R.noProductThen}</span>
          <span className="rs-sub">
            {r.sourceRowId == null ? '–' : String(r.sourceRowId)}
            {r.epochOrdinal != null && ` · ${batchName.batchName({ ordinal: r.epochOrdinal, simulator: r.epochSimulator })}`}
          </span>
        </>
      ),
    },
    { key: 'weight', header: R.colWeight, numeric: true, render: (r) => (r.weightG == null ? W.rejectsMore.notWeighed : fmt.fmtG(r.weightG)) },
  ];

  return (
    <div className="rs-body">
      {stations.status === 'error' && <p className="rs-note" role="status">{R.stationNamesMissing} {stations.error}</p>}
      <p className="rs-day">{R.dayBasisLine(fmtDate(id.day))}</p>

      {reason.status === 'error' ? (
        <ErrorState part={RF.part.thisReason} cause={reason.error} onRetry={reason.refresh} />
      ) : !d ? (
        <Skeleton part={RF.part.thisReason} height={72} onRetry={reason.refresh} />
      ) : (
        <>
          <p className="rs-count">
            {id.rejectType === 'weight' ? R.sheetCountWeight(fmtCount(d.total)) : R.sheetCount(fmtCount(d.total), name ?? '')}
          </p>
          <NameIt rank={rank} codeId={d.rejectCodeId} label={d.label} onSaved={reason.refresh} />
        </>
      )}

      <h3 className="rs-h">{R.perDayTitle}</h3>
      <DataTable<RejectDayCodeRow>
        caption={R.perDayTitle}
        columns={dayCols}
        rows={dayRows}
        rowKey={(r) => r.day}
        onRowOpen={(r) => openDay(r.day)}
        loading={days.status === 'loading'}
        loadingRows={4}
        error={days.status === 'error' ? <ErrorState part={RF.part.byDay} cause={days.error} onRetry={days.refresh} /> : undefined}
        empty={<EmptyState message={R.noDaysForReason} />}
      />

      <h3 className="rs-h">{R.conesOnDay(fmtDayShort(`${id.day}T12:00:00Z`))}</h3>
      <DataTable<RejectReasonRow>
        caption={R.conesOnDay(id.day)}
        columns={coneCols}
        rows={d?.rows ?? []}
        rowKey={(r) => String(r.eventId)}
        onRowOpen={(r) => go({ ...route, sheet: { kind: 'reject', id: String(r.eventId) } })}
        total={d?.total}
        loading={reason.status === 'loading'}
        loadingRows={4}
        error={reason.status === 'error' ? <ErrorState part={RF.part.thisReason} cause={reason.error} onRetry={reason.refresh} /> : undefined}
        empty={<EmptyState message={R.sheetEmpty} />}
      />
      {(d?.rows ?? []).some((r) => r.weightG == null) && <p className="rs-note">{R.noWeightNote}</p>}

      <p className="rs-hop">
        <a className="ui-link" {...hop(dayRegisterHop(id.day))}>{R.hopDayRegister}</a>
        <span className="rs-note"> · {RF.hopDayRegisterNote}</span>
      </p>
      <p className="rs-hop">
        <a className="ui-link" {...hop(dayReportHop(id.day))}>{R.hopDayReport}</a>
        <span className="rs-note"> · {RF.hopDayReportNote}</span>
      </p>
      <p className="rs-note">{R.dayBasis}</p>
    </div>
  );
}
