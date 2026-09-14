/**
 * Readings — the single register. "Every cone and every sack that was weighed,
 * with the rejected ones flagged."
 *
 * Replaces FOUR screens that all listed the same rows: the Sacks list, the
 * Cones list, Records, and the full record page. One toggle picks what is
 * listed; one sheet opens any row without losing the list, the filters or the
 * scroll position.
 *
 * THE STATUS COLUMN IS THE POINT OF THIS SCREEN, and it is where the old app
 * was actually wrong rather than merely cluttered. Every cone carries TWO
 * verdicts — the scale's own in-range bit, and whether it sits inside the
 * product's tolerance — and they disagree on about a thousand readings in the
 * record. The old screens said "outside limits" without ever saying which, and
 * computed the product comparison against the product recorded TODAY even for
 * readings weighed weeks earlier. Here the scale's verdict is the single flag,
 * named as the scale's; the product comparison appears only when a product was
 * actually in force at that reading's time, and says so when none was.
 */
import { useEffect, useState } from 'react';
import { useLive, usePolling, LIST_POLL_MS } from '../lib/live';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { Block, Chevron, Empty, Failed, rowKeys, SkelLines, Toolbar, Toggle } from '../ui/bits';
import { fmtClock, fmtDayLong, fmtG, fmtInt, fmtKg, fmtSpan } from '../lib/fmt';
import { assessHealth } from '../lib/health';
import type { ReadingsFilter } from '../ui/Bar';
import {
  getEvents, eventsExportUrl, getStations, stationLabel,
  type RegisterQuery, type RegisterRow, type RegisterType, type StationRow,
} from '../api';

const PAGE_SIZE = 100;

// 'inspectionRejects' added for finding H4 (Sep 2026 audit): a different
// population from 'rejected' (the scale's own in_range=0) — these are
// reject_event rows, cones the inspection stations threw out before they
// were ever weighed as a cone_event row at all.
type Listing = 'cones' | 'sacks' | 'rejected' | 'inspectionRejects';

/** What each listing asks the register for. */
function queryFor(
  listing: Listing,
  period: Period,
  station: number | null,
  page: number,
  outsideLimitsOnly: boolean,
): RegisterQuery {
  const type: RegisterType = listing === 'sacks' ? 'sack' : listing === 'inspectionRejects' ? 'reject' : 'cone';
  const base: RegisterQuery = {
    type,
    from: period.from,
    to: period.to,
    shift: period.shift,
    tsFrom: period.tsFrom,
    tsTo: period.tsTo,
    page,
    pageSize: PAGE_SIZE,
    sort: 'time',
    dir: 'desc',
  };
  // "Rejected cones" means the SCALE rejected them — cone_event.in_range = 0.
  // It is a different population from the Rejects screen, which counts cones
  // the inspection stations threw out before they were ever weighed as cones.
  if (listing === 'rejected') base.inRange = false;
  if (station != null && type !== 'sack') base.station = station;
  // cone only — see the H4 fix note on ReadingsScreen below.
  if (outsideLimitsOnly && type === 'cone') base.outsideProductLimits = true;
  return base;
}

export function ReadingsScreen({
  period,
  initialFilter,
  onFilterChange,
  onOpenReading,
  canExport,
}: {
  period: Period;
  /**
   * Arrives set when Weight's disagreement banner, the Home attention list,
   * or Rejects' "see the rejected cones" link opened this screen — finding
   * H4 (Sep 2026 audit): all three used to land here with no filter applied
   * at all, regardless of which specific population they had just promised.
   */
  initialFilter?: ReadingsFilter;
  /** Clears/changes the filter in the URL — see `outsideOnly` below. */
  onFilterChange?: (f: ReadingsFilter) => void;
  onOpenReading: (type: RegisterType, id: string | number) => void;
  canExport: boolean;
}) {
  const [listing, setListing] = useState<Listing>(initialFilter === 'inspectionRejects' ? 'inspectionRejects' : 'cones');
  // DERIVED from the URL, never local state. As local state it desynced: the
  // chip's Clear button and the listing toggle both dropped the filter from
  // the view while `?rf=outsideLimits` stayed in the address bar, so a
  // refresh — or the link a manager pasted to someone else — silently
  // reapplied a filter the header no longer mentioned.
  const outsideOnly = initialFilter === 'outsideLimits';
  const [station, setStation] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // Finding H12 (Sep 2026 audit): narrowing the global period while parked on
  // a later page used to show a truthful, nonzero header count over a
  // visibly empty table, with the pager hidden because the new, smaller
  // total no longer needed it.
  useEffect(() => {
    setPage(1);
  }, [period.from, period.to, period.shift]);
  const { line } = useLive();
  const health = assessHealth(line);
  const stale = health.kind !== 'ok';
  const lagText =
    health.kind === 'stale'
      ? W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—')
      : health.kind === 'late'
        ? W.lag.late(fmtSpan(health.lagSeconds))
        : W.lag.noData;

  const key = `${listing}:${period.from}:${period.to}:${period.shift ?? 'all'}:${station ?? 'any'}:${outsideOnly}:${page}`;
  const rows = usePolling(
    () => getEvents(queryFor(listing, period, station, page, outsideOnly)),
    // Only a live period can gain rows while it is open; a closed one is
    // polled at a slow heartbeat rather than never, so a re-sync still shows.
    period.live ? LIST_POLL_MS : 5 * 60_000,
    key,
  );

  // The count of readings the SCALE rejected, for the count line. Asked for
  // separately rather than derived from a percentage, so the sentence states a
  // number the register itself would return.
  const rejected = usePolling(
    () => getEvents({ ...queryFor('rejected', period, station, 1, false), pageSize: 1 }),
    period.live ? LIST_POLL_MS : 5 * 60_000,
    `rejcount:${key}`,
  );

  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');
  const stationList = stations.data?.stations ?? [];

  const total = rows.data?.data.total ?? 0;
  const rejectedTotal = rejected.data?.data.total ?? 0;

  const setListingReset = (l: Listing) => {
    setListing(l);
    setPage(1);
    // A deep-linked filter is a one-shot arrival, not a standing preference —
    // manually switching what to list is a distinct choice from clearing it
    // via the chip below. Goes through the URL so the two cannot disagree.
    if (outsideOnly) onFilterChange?.(null);
  };

  return (
    <>
      <div className="page">
        <p className="q">{W.question.readings}</p>
        <h1 className="wide">{countLine(period, listing, total, rejectedTotal, outsideOnly)}</h1>
      </div>

      <Block first tight>
        <Toolbar
          left={
            <>
              <Toggle
                label="What to list"
                value={listing}
                onChange={setListingReset}
                options={[
                  { key: 'cones', label: W.readings.cones },
                  { key: 'sacks', label: W.readings.sacks },
                  { key: 'rejected', label: W.readings.rejectedCones },
                  { key: 'inspectionRejects', label: W.readings.inspectionRejects },
                ]}
              />
              {listing !== 'sacks' && (
                <StationChip
                  stations={stationList}
                  value={station}
                  onChange={(v) => {
                    setStation(v);
                    setPage(1);
                  }}
                />
              )}
              {outsideOnly && (
                <span className="chip">
                  {W.readings.filterOutsideLimits}{' '}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      onFilterChange?.(null);
                      setPage(1);
                    }}
                  >
                    {W.readings.clear}
                  </button>
                </span>
              )}
            </>
          }
          right={
            <>
              {canExport && (
                <a className="btn" href={eventsExportUrl(queryFor(listing, period, station, 1, outsideOnly))}>
                  {W.report.exportCsv}
                </a>
              )}
              <button type="button" className="btn" onClick={() => window.print()}>
                {W.report.print}
              </button>
            </>
          }
        />
      </Block>

      <Block>
      {rows.error && !rows.data ? (
        <Failed error={rows.error} onRetry={rows.refresh} />
      ) : rows.loading && !rows.data ? (
        <SkelLines n={12} />
      ) : total === 0 ? (
        <Empty message={outsideOnly ? W.readings.nothingOutside : W.readings.nothing} />
      ) : (
        <>
          <div className="tw">
            <ReadingTable rows={rows.data?.data.rows ?? []} listing={listing} onOpen={onOpenReading} />
          </div>
          {/* Left: the pulse and what it means. Right: the count. Under lag
              the left sentence becomes the lag sentence, because "new readings
              appear every 15 seconds" is then untrue. */}
          <p className="row between mut sm" style={{ marginTop: 14 }}>
            <span>
              {period.live && (
                <span className={`dot live${stale ? ' bad' : ''}`} aria-hidden="true" />
              )}
              {stale ? lagText : period.live ? W.readings.liveNote : null}
            </span>
            <span>
              {W.readings.perPage(PAGE_SIZE, fmtInt(total))}
              <Pager page={page} total={total} onPage={setPage} />
            </span>
          </p>
        </>
      )}
      </Block>
    </>
  );
}

/* -------------------------------------------------------------- the count */

function countLine(period: Period, listing: Listing, total: number, rejected: number, outsideOnly: boolean): string {
  const what = fmtDayLong(period.from) === fmtDayLong(period.to) ? fmtDayLong(period.from) : `${period.from} to ${period.to}`;
  if (listing === 'sacks') return `${what}: ${fmtInt(total)} sacks weighed.`;
  if (listing === 'inspectionRejects') return `${what}: ${fmtInt(total)} cones rejected before weighing.`;
  // With the outside-limits filter on, `total` counts only the filtered cones
  // while `rejected` counts every scale-rejected cone in the period — two
  // different populations. Stating them as "N weighed, M rejected (P%)" made
  // P unbounded: 40 shown against 160 scale rejects printed "400.0%".
  if (outsideOnly) return `${what}: ${W.readings.countLineOutside(fmtInt(total))}`;
  const pct = total > 0 ? `${Math.round((1000 * rejected) / total) / 10}%` : '0%';
  if (listing === 'rejected') return `${what}: ${fmtInt(total)} cones rejected by the scale.`;
  return `${what}: ${W.readings.countLine(fmtInt(total), fmtInt(rejected), pct)}`;
}

/* ------------------------------------------------------------ the filters */

function StationChip({
  stations,
  value,
  onChange,
}: {
  stations: StationRow[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  if (stations.length === 0) return null;
  return (
    <label className="chip">
      {W.readings.filterStation}
      <select
        value={value ?? ''}
        aria-label={W.readings.filterStation}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
      >
        <option value="">All</option>
        {stations.map((s) => (
          <option key={s.stationId} value={s.stationId}>
            {stationLabel(s, s.stationId)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <span className="no-print">
      {' · '}
      <button type="button" className="linkish" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ {W.readings.previous}
      </button>
      {` ${page} ${W.of} ${pages} `}
      <button type="button" className="linkish" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {W.readings.next} ›
      </button>
    </span>
  );
}

/* -------------------------------------------------------------- the table */

function ReadingTable({
  rows,
  listing,
  onOpen,
}: {
  rows: RegisterRow[];
  listing: Listing;
  onOpen: (type: RegisterType, id: string | number) => void;
}) {
  const isSack = listing === 'sacks';
  const isInspectionReject = listing === 'inspectionRejects';
  const type: RegisterType = isSack ? 'sack' : isInspectionReject ? 'reject' : 'cone';

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: '9em' }}>{W.readings.time}</th>
          <th style={{ width: '11em' }}>{isSack ? W.readings.sackNo : W.readings.record}</th>
          <th className="n" style={{ width: '7em' }}>{W.readings.weight}</th>
          <th style={{ paddingLeft: 32 }}>{W.readings.status}</th>
          <th className="n" style={{ width: '2em' }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          // event_id is the canonical PK under one name on every type. Not
          // source_row_id: IFL reset their counter on 2026-08-05, so that
          // number now names two different readings nine weeks apart.
          const id = r.event_id;
          const rejectedByScale = r.in_range === false;
          return (
            <tr
              key={`${id}`}
              /* A wash and accent text, never a red left border — that would
                 read as a card, and there are no cards here. */
              className={`click${rejectedByScale || isInspectionReject ? ' rej' : ''}`}
              tabIndex={0}
              onClick={() => onOpen(type, id)}
              onKeyDown={rowKeys(() => onOpen(type, id))}
            >
              <td>{fmtClock(r.production_ts_utc)}</td>
              <td>{isSack ? (r.sack_num ?? '—') : String(id)}</td>
              <td className="n">{isSack ? fmtKg(r.weight_kg) : fmtG(r.weight_g)}</td>
              <td style={{ paddingLeft: 32 }}>
                {isInspectionReject ? (
                  <span className="acc">{r.reject_label ?? (r.reject_type === 'weight' ? 'Weight reject' : 'Quality reject')}</span>
                ) : rejectedByScale ? (
                  <span className="acc">{W.rejectedByScale}</span>
                ) : (
                  W.passed
                )}
              </td>
              <td className="n">
                <Chevron label={W.openRecord} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
