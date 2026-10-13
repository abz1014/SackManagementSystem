/**
 * One reading in a sheet over the Register: the shared body of the cone, sack and inspection-fail sheets
 * (TRACE A3-056 reading sheet, A1-043/A1-044 detail, A1-054 product-at, A6-S2..S4).
 *
 *  - ONE STATUS VOCABULARY. The scale's check and the product's limits are two facts with two names. The product
 *    comparison appears only when a product was in force at the reading's OWN time, and says so when none was.
 *  - A sack shows the cones weighed since the previous sack with the caveat in the same sentence: an approximate
 *    count, never a packing list (the plant records no cone-to-sack key).
 *  - TWO CLOCKS. Production times are the plant clock (24 hours); "read by SMS" is a genuine instant in the viewer's zone.
 *  - Every fetch is its own part. A missing part is named; it is never drawn as a zero or a blank.
 */
import { stationLabel, type RegisterRow, type RegisterType } from '../../bridge/api';
import { batchName, fmt, provenance as prov } from '../../bridge/lib';
import { formatClock, formatDate } from '../../copy';
import { Disclosure } from '../../ui/Disclosure';
import { ErrorState } from '../../ui/ErrorState';
import { Skeleton } from '../../ui/Skeleton';
import { hrefFor, plainClick } from '../../ui/nav';
import { Sheet } from '../../ui/Sheet';
import type { Route } from '../../route';
import type { SheetProps } from '../../screens/registry';
import { coneVerdict } from '../../screens/Quality/Register/model';
import { R, RF } from '../../screens/Quality/Register/registerCopy';
import { reasonName } from '../../screens/Quality/Rejects/format';
import { useConesAround, useProductThen, useReadingDetail, useReadingStations, validId, type ReadingData } from './useReading';
import './readingSheet.css';

const KIND_TITLE: Record<RegisterType, string> = { cone: R.coneTitle, sack: R.sackTitle, reject: R.rejectTitle };

/** "12 g under the lower limit" from the server's signed distance; a miss under half a gram never rounds to 0. */
function describeMiss(byG: number): string {
  const magnitude = Math.abs(byG);
  const g = magnitude < 1 ? `${magnitude.toFixed(1)} g` : fmt.fmtG(magnitude);
  return byG < 0 ? R.missLow(g) : R.missHigh(g);
}

function rejectReason(row: RegisterRow): string {
  if (row.reject_label) return row.reject_label;
  if (row.reject_type === 'weight') return RF.weightFailRecord;
  return reasonName({ label: null, tubeCode: row.tube_inspect_code ?? null, materialCode: row.material_inspect_code ?? null });
}

const plantDay = (d: string): string => formatDate(`${d.slice(0, 10)}T12:00:00Z`);

export function ReadingSheet({ kind, route, rank: _rank, go, onClose }: SheetProps & { kind: RegisterType }) {
  void _rank;
  const raw = route.sheet?.id ?? '';
  return (
    <Sheet open onClose={onClose} title={KIND_TITLE[kind]} width={640}>
      {validId(raw) ? (
        <Body key={`${kind}:${raw}`} kind={kind} id={raw} route={route} go={go} />
      ) : (
        <ErrorState part={RF.detailPart} cause={R.malformedId} />
      )}
    </Sheet>
  );
}

function Body({ kind, id, route, go }: { kind: RegisterType; id: string; route: Route; go: SheetProps['go'] }) {
  const detail = useReadingDetail(kind, id);
  const row = detail.data?.row ?? null;
  if (detail.status === 'error') return <ErrorState part={detail.part} cause={detail.error} onRetry={detail.refresh} />;
  if (!row) return <Skeleton part={detail.part} height={160} onRetry={detail.refresh} />;
  return <Detail kind={kind} id={id} row={row} detail={detail} route={route} go={go} />;
}

function Detail({ kind, id, row, detail, route, go }: { kind: RegisterType; id: string; row: RegisterRow & Record<string, unknown>; detail: ReadingData['detail']; route: Route; go: SheetProps['go'] }) {
  const d = { detail, product: useProductThen(kind, id, row), stations: useReadingStations(), around: useConesAround(kind, id, row) };
  const isSack = kind === 'sack';
  const isReject = kind === 'reject';
  const p = d.product.data;
  const stationList = d.stations.data?.stations ?? [];
  const station = row.source_station ?? null;
  // reject_event has no in_range column: the row IS a failed inspection (or a weight-check record).
  const scaleFailed = isReject || row.in_range === false;
  const coneState = isSack || isReject ? null : (row.state ?? p?.verdict?.state ?? null);
  const verdict = !isSack && p?.verdict && p.verdict.inside !== null ? p.verdict : null;
  const headline = isReject
    ? R.failedFor(rejectReason(row))
    : isSack
      ? (scaleFailed ? R.failedWeight : R.passedWeight)
      : coneVerdict({ state: coneState ?? undefined, in_range: row.in_range }).text;

  const hop = (r: Route) => ({ href: hrefFor(r), onClick: (e: React.MouseEvent) => plainClick(e, () => go(r)) });
  const day = String(row.shift_date).slice(0, 10);

  /* the second fact: the product's limits at this reading's own time */
  let limitsLine: React.ReactNode = null;
  if (!isSack && row.weight_g != null) {
    if (d.product.status === 'error') {
      limitsLine = <ErrorState part={d.product.part} cause={d.product.error} onRetry={d.product.refresh} />;
    } else if (!p) {
      limitsLine = <Skeleton part={d.product.part} height={24} onRetry={d.product.refresh} />;
    } else if (coneState === 'unknown' && p.verdict?.unknownReason === 'implausible' && p.plausibility) {
      limitsLine = R.implausible(fmt.fmtG(p.plausibility.loG), fmt.fmtG(p.plausibility.hiG));
    } else if (p.product === null) {
      limitsLine = coneState === 'unknown' ? R.noLimitsKnown : R.noLimitsNow;
    } else if (p.limits === null) {
      limitsLine = R.noTarget;
    } else if (verdict === null) {
      limitsLine = null;
    } else if (coneState === 'rejected') {
      limitsLine = verdict.inside ? R.failedInside(p.limits.label) : R.failedOutside(describeMiss(verdict.outsideByG ?? 0), p.limits.label);
    } else if (coneState === 'low' || coneState === 'high') {
      limitsLine = R.lowHigh(describeMiss(verdict.outsideByG ?? 0), p.limits.label, verdict.scalePassed ?? null);
    } else if (verdict.inside) {
      limitsLine = R.withinOf(p.limits.label);
    } else {
      limitsLine = R.lowHigh(describeMiss(verdict.outsideByG ?? 0), p.limits.label, true);
    }
  }

  const productHopId = p?.product?.productId ?? null;
  const reportHop: Route | null =
    productHopId === null
      ? null
      : { s: 'reports', t: null, sheet: null, wall: false, keys: { rt: 'product', pr: String(productHopId), p: 'pick', from: day, to: day } };
  const catalogueHop: Route | null =
    productHopId === null ? null : { s: 'products', t: 'catalogue', sheet: null, wall: false, keys: { pr: String(productHopId) } };
  const stationHop: Route | null =
    station === null ? null : { s: 'quality', t: 'register', sheet: null, wall: false, keys: { ...periodKeys(route), st: String(station) } };

  return (
    <div className="rd">
      <div className="rd-big">{isSack ? fmt.fmtKg(row.weight_kg) : row.weight_g == null ? R.notWeighed : fmt.fmtG(row.weight_g)}</div>
      <p className={`rd-verdict${scaleFailed || coneState === 'low' || coneState === 'high' ? ' rd-verdict--flag' : ''}`}>{headline}</p>
      {limitsLine !== null && <div className="rd-limits">{limitsLine}</div>}

      <dl className="rd-dl">
        <div>
          <dt>{isReject || (isSack && row.production_ts_is_insert_time) ? R.recordedLabel : R.weighed}</dt>
          <dd>
            {plantDay(day)}, {formatClock(row.production_ts_utc, true)}
          </dd>
        </div>
        <div>
          <dt>{R.shift}</dt>
          <dd>{String(row.shift_code)}</dd>
        </div>
        {!isSack && station !== null && (
          <div>
            <dt>{R.station}</dt>
            <dd>{stationLabel(stationList.find((s) => s.stationId === station), station)}</dd>
          </div>
        )}
        {isSack && row.sack_num != null && (
          <div>
            <dt>{R.sackNo}</dt>
            <dd>{String(row.sack_num)}</dd>
          </div>
        )}
        <div>
          <dt>{R.sourceRecord}</dt>
          <dd>{row.source_row_id == null ? '–' : String(row.source_row_id)}</dd>
        </div>
        {p?.product && (
          <div>
            <dt>{R.productThen}</dt>
            <dd>
              {p.product.label}
              {p.productActive === false && <span className="rd-mut"> {RF.retired}</span>}
            </dd>
          </div>
        )}
      </dl>
      {d.stations.status === 'error' && <p className="rd-note" role="status">{d.stations.part}: {d.stations.error}</p>}

      {(reportHop || catalogueHop || stationHop) && (
        <ul className="rd-hops">
          {reportHop && <li><a className="ui-link" {...hop(reportHop)}>{R.seeProductReport}</a></li>}
          {catalogueHop && <li><a className="ui-link" {...hop(catalogueHop)}>{R.seeProductCatalogue}</a></li>}
          {stationHop && <li><a className="ui-link" {...hop(stationHop)}>{R.seeStation}</a></li>}
        </ul>
      )}

      {isSack && row.production_ts_is_insert_time && <p className="rd-note">{R.insertTimeCaveat}</p>}
      {isSack && <Around d={d} />}

      <Disclosure id="register-provenance" label={R.provenance}>
        <Provenance row={row} />
      </Disclosure>
    </div>
  );
}

function periodKeys(route: Route): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['p', 'from', 'to', 'at', 'cmp']) if (route.keys[k] !== undefined) out[k] = route.keys[k]!;
  return out;
}

function Around({ d }: { d: ReadingData }) {
  if (d.around.status === 'error') return <ErrorState part={d.around.part} cause={d.around.error} onRetry={d.around.refresh} />;
  if (!d.around.data) return <Skeleton part={d.around.part} height={40} onRetry={d.around.refresh} />;
  const a = d.around.data.around;
  return <p className="rd-note">{a ? R.aroundSack(fmt.fmtInt(a.cones)) : R.noPreviousSack}</p>;
}

/** Where the reading came from. Reads ONLY row.provenance: an older API answers without it, and "not available" is the honest rendering. */
function Provenance({ row }: { row: RegisterRow }) {
  const p = row.provenance;
  const L = R.prov;
  const dash = '–';
  const id = (v: number | string | null | undefined) => (v == null ? dash : String(v));
  return (
    <div className="rd-prov">
      <p className="rd-note">{R.provenanceNote}</p>
      {p == null && <p className="rd-note">{R.provNotAvailable}</p>}
      <dl className="rd-dl rd-dl--one">
        {p != null && (
          <>
            <div><dt>{L.sourceTable}</dt><dd>{p.sourceTable || dash}</dd></div>
            <div><dt>{L.sourceSystem}</dt><dd>{p.sourceSystem || dash}</dd></div>
            <div>
              <dt>{L.dataSet}</dt>
              <dd>{p.epochOrdinal != null ? batchName.batchName({ ordinal: p.epochOrdinal, simulator: !!p.epochSimulator }) : (p.epochLabel ?? dash)}</dd>
            </div>
            <div><dt>{L.sourceRow}</dt><dd>{id(p.sourceRowId)}</dd></div>
            {/* TWO CLOCKS: the plant's insert time is the plant clock; the read time is a genuine instant, in the viewer's zone. */}
            <div><dt>{L.insertedAt}</dt><dd>{p.sourceInsertUtc == null ? dash : `${plantDay(p.sourceInsertUtc)}, ${formatClock(p.sourceInsertUtc, true)}`}</dd></div>
            <div><dt>{L.readAt}</dt><dd>{p.ingestedAtUtc == null ? dash : fmt.fmtAppInstant(p.ingestedAtUtc)}</dd></div>
            <div><dt>{L.transform}</dt><dd>{p.transformVersion == null ? dash : String(p.transformVersion)}</dd></div>
            <div><dt>{L.product}</dt><dd>{prov.describeAttribution(p.attributionMethod, p.attributionConfidence)}</dd></div>
            <div><dt>{L.rawRow}</dt><dd>{id(p.rawId)}</dd></div>
            <div><dt>{L.syncPass}</dt><dd>{p.ingestRunId ?? dash}</dd></div>
          </>
        )}
        <div><dt>{L.plantShift}</dt><dd>{row.shift_code_legacy ?? dash}</dd></div>
        <div><dt>{L.productionDay}</dt><dd>{String(row.shift_date).slice(0, 10)}</dd></div>
      </dl>
    </div>
  );
}
