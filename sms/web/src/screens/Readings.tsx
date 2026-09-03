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
import { useState } from 'react';
import { useLive, usePolling, LIST_POLL_MS } from '../lib/live';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { Block, Chevron, Empty, Failed, SkelLines, Toolbar, Toggle } from '../ui/bits';
import { fmtClock, fmtDayLong, fmtG, fmtInt, fmtKg, fmtSpan } from '../lib/fmt';
import { assessHealth } from '../lib/health';
import {
  getEvents, eventsExportUrl, getStations, stationLabel,
  type RegisterQuery, type RegisterRow, type RegisterType, type StationRow,
} from '../api';

const PAGE_SIZE = 100;

type Listing = 'cones' | 'sacks' | 'rejected';

/** What each listing asks the register for. */
function queryFor(listing: Listing, period: Period, station: number | null, page: number): RegisterQuery {
  const base: RegisterQuery = {
    type: (listing === 'sacks' ? 'sack' : 'cone') as RegisterType,
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
  if (station != null && listing !== 'sacks') base.station = station;
  return base;
}

export function ReadingsScreen({
  period,
  onOpenReading,
  canExport,
}: {
  period: Period;
  onOpenReading: (type: RegisterType, id: string | number) => void;
  canExport: boolean;
}) {
  const [listing, setListing] = useState<Listing>('cones');
  const [station, setStation] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const { line } = useLive();
  const health = assessHealth(line);
  const stale = health.kind !== 'ok';
  const lagText =
    health.kind === 'stale'
      ? W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—')
      : health.kind === 'late'
        ? W.lag.late(fmtSpan(health.lagSeconds))
        : W.lag.noData;

  const key = `${listing}:${period.from}:${period.to}:${period.shift ?? 'all'}:${station ?? 'any'}:${page}`;
  const rows = usePolling(
    () => getEvents(queryFor(listing, period, station, page)),
    // Only a live period can gain rows while it is open; a closed one is
    // polled at a slow heartbeat rather than never, so a re-sync still shows.
    period.live ? LIST_POLL_MS : 5 * 60_000,
    key,
  );

  // The count of readings the SCALE rejected, for the count line. Asked for
  // separately rather than derived from a percentage, so the sentence states a
  // number the register itself would return.
  const rejected = usePolling(
    () => getEvents({ ...queryFor('rejected', period, station, 1), pageSize: 1 }),
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
  };

  return (
    <>
      <div className="page">
        <p className="q">{W.question.readings}</p>
        <h1 className="wide">{countLine(period, listing, total, rejectedTotal)}</h1>
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
            </>
          }
          right={
            <>
              {canExport && (
                <a className="btn" href={eventsExportUrl(queryFor(listing, period, station, 1))}>
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

      <div className="page">
      {rows.error && !rows.data ? (
        <Failed error={rows.error} onRetry={rows.refresh} />
      ) : rows.loading && !rows.data ? (
        <SkelLines n={12} />
      ) : total === 0 ? (
        <Empty message={W.readings.nothing} />
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
      </div>
    </>
  );
}

/* -------------------------------------------------------------- the count */

function countLine(period: Period, listing: Listing, total: number, rejected: number): string {
  const what = fmtDayLong(period.from) === fmtDayLong(period.to) ? fmtDayLong(period.from) : `${period.from} to ${period.to}`;
  if (listing === 'sacks') return `${what}: ${fmtInt(total)} sacks weighed.`;
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
          const id = r.source_row_id;
          const rejectedByScale = r.in_range === false;
          return (
            <tr
              key={`${id}`}
              /* A wash and accent text, never a red left border — that would
                 read as a card, and there are no cards here. */
              className={`click${rejectedByScale ? ' rej' : ''}`}
              onClick={() => onOpen(isSack ? 'sack' : 'cone', id)}
            >
              <td>{fmtClock(r.production_ts_utc)}</td>
              <td>{isSack ? (r.sack_num ?? '—') : String(id)}</td>
              <td className="n">{isSack ? fmtKg(r.weight_kg) : fmtG(r.weight_g)}</td>
              <td style={{ paddingLeft: 32 }}>
                {rejectedByScale ? <span className="acc">{W.rejectedByScale}</span> : W.passed}
              </td>
              <td className="n">
                <Chevron />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
