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
 *
 * Since roadmap Phase 4 (14 Sep 2026) the column is the ONE five-state
 * classification the server computes for every cone (within / under / over
 * the limit / rejected by the scale / not judged), filterable by state, with
 * the reading's own product beside it. Nothing about a cone's state is
 * decided in this file.
 */
import { useEffect } from 'react';
import { useLive, usePolling, LIST_POLL_MS } from '../lib/live';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { Block, Chevron, Empty, Failed, rowKeys, SkelLines, Toolbar, Toggle } from '../ui/bits';
import { fmtClock, fmtDayLong, fmtG, fmtInt, fmtKg, fmtSpan } from '../lib/fmt';
import { assessHealth } from '../lib/health';
import type { ReadingsFilter } from '../ui/Bar';
import {
  getEvents, eventsExportUrl, getStations, stationLabel, CONE_STATES,
  type ConeState, type RegisterQuery, type RegisterRow, type RegisterType, type StationRow,
} from '../api';
import { RegisterPrintHead } from './report/PrintHead';

export const PAGE_SIZE = 100;

// 'inspectionRejects' added for finding H4 (Sep 2026 audit): a different
// population from 'rejected' (the scale's own in_range=0) — these are
// reject_event rows, cones the inspection stations threw out before they
// were ever weighed as a cone_event row at all.
export type Listing = 'cones' | 'sacks' | 'rejected' | 'inspectionRejects';
export const LISTINGS: readonly Listing[] = ['cones', 'sacks', 'rejected', 'inspectionRejects'];

/** What each listing asks the register for. */
function queryFor(
  listing: Listing,
  period: Period,
  station: number | null,
  page: number,
  outsideLimitsOnly: boolean,
  states: ConeState[] = [],
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
  // cone only — see the H4 fix note on ReadingsScreen below. Since Phase 4
  // "outside product limits" is the 'low' + 'high' states of the one
  // classification, and any chip selection is sent the same way.
  if (type === 'cone') {
    const wanted = outsideLimitsOnly ? (['low', 'high'] as ConeState[]) : states;
    if (wanted.length > 0) base.state = wanted;
  }
  return base;
}

export function ReadingsScreen({
  period,
  listing,
  onListingChange,
  station,
  onStationChange,
  states,
  onStatesChange,
  page,
  onPageChange,
  initialFilter,
  onFilterChange,
  onOpenReading,
  canExport,
}: {
  period: Period;
  /**
   * Roadmap Phase 2b (16 Sep 2026): what to list, the station and state
   * chips, and the page all live in the URL now (App.tsx's `route`), not in
   * this component — a refresh or a pasted link used to lose all four.
   * Controlled the same way the period is: a value and a setter, no local
   * mirror, so the address bar and the screen cannot disagree.
   */
  listing: Listing;
  onListingChange: (l: Listing) => void;
  station: number | null;
  onStationChange: (v: number | null) => void;
  /** The state chips (Phase 4). Empty = every state. Cones only; the other
   *  listings have no classification and the chips are not shown for them. */
  states: ConeState[];
  onStatesChange: (v: ConeState[]) => void;
  page: number;
  onPageChange: (p: number) => void;
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
  // DERIVED from the URL, never local state. As local state it desynced: the
  // chip's Clear button and the listing toggle both dropped the filter from
  // the view while `?rf=outsideLimits` stayed in the address bar, so a
  // refresh — or the link a manager pasted to someone else — silently
  // reapplied a filter the header no longer mentioned.
  const outsideOnly = initialFilter === 'outsideLimits';
  // Finding H12 (Sep 2026 audit): narrowing the global period while parked on
  // a later page used to show a truthful, nonzero header count over a
  // visibly empty table, with the pager hidden because the new, smaller
  // total no longer needed it. Replace, not push: this is a correction the
  // period change makes on the reader's behalf, not a choice of its own.
  useEffect(() => {
    if (page !== 1) onPageChange(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.from, period.to, period.shift]);
  const { line, asOf } = useLive();
  const health = assessHealth(line);
  const stale = health.kind !== 'ok';
  const lagText =
    health.kind === 'stale'
      ? W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—')
      : health.kind === 'late'
        ? W.lag.late(fmtSpan(health.lagSeconds))
        : W.lag.noData;

  const key = `${listing}:${period.from}:${period.to}:${period.shift ?? 'all'}:${station ?? 'any'}:${outsideOnly}:${states.join('+')}:${page}`;
  const rows = usePolling(
    () => getEvents(queryFor(listing, period, station, page, outsideOnly, states)),
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

  // The headline's two counts, as STATES rather than numbers — see CountState
  // below. `?? 0` is what let a not-yet-arrived count reach the sentence as a
  // real zero.
  const totalState = countStateOf(rows.error, rows.data?.data.total);
  const rejectedState = countStateOf(rejected.error, rejected.data?.data.total);
  // For the body only, every branch of which already gates on rows.error /
  // rows.loading / rows.data before it reads this.
  const total = totalState.kind === 'ok' ? totalState.n : 0;

  return (
    <>
      {/* The same print header the reports carry (roadmap Phase 8, 15 Sep
          2026): the line, the period, generated when on the plant's clock,
          by whom, from which version. Print used to output whatever 100
          rows were on screen with none of it (gap analysis §10). Hidden on
          screen; first on paper. */}
      <RegisterPrintHead
        from={period.from}
        to={period.to}
        at={asOf}
        title={`${W.nav.readings} · ${listingTitle(listing)}${station != null ? ` · ${stationLabel(stationList.find((s) => s.stationId === station), station)}` : ''}`}
      />
      <div className="page">
        <p className="q">{W.question.readings}</p>
        <h1 className="wide">
          {countLine(period, listing, totalState, rejectedState, outsideOnly, states)}
        </h1>
      </div>

      <Block first tight>
        <Toolbar
          left={
            <>
              <Toggle
                label="What to list"
                value={listing}
                // Page-reset and clearing a stale outside-limits deep link
                // are both baked into App.tsx's onListingChange, in the same
                // history entry — see the Route note there.
                onChange={onListingChange}
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
                  onChange={onStationChange}
                  failed={!!stations.error && !stations.data}
                />
              )}
              {listing === 'cones' && !outsideOnly && (
                <StateChips
                  value={states}
                  onChange={onStatesChange}
                />
              )}
              {outsideOnly && (
                <span className="chip">
                  {W.readings.filterOutsideLimits}{' '}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => onFilterChange?.(null)}
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
                <a className="btn" href={eventsExportUrl(queryFor(listing, period, station, 1, outsideOnly, states))}>
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
              <Pager page={page} total={total} onPage={onPageChange} />
            </span>
          </p>
        </>
      )}
      </Block>
    </>
  );
}

/* -------------------------------------------------------------- the count */

/** The listing's own name, for the print header's title line. */
function listingTitle(listing: Listing): string {
  switch (listing) {
    case 'cones': return W.readings.cones;
    case 'sacks': return W.readings.sacks;
    case 'rejected': return W.readings.rejectedCones;
    case 'inspectionRejects': return W.readings.inspectionRejects;
  }
}

/**
 * One of the headline's counts. The point of the type is that there is no
 * way to hand `countLine` a number it has not actually been told.
 *
 * Before 23 Sep 2026 both counts arrived here as plain `number`s, defaulted
 * with `?? 0` at the call site, plus two separate booleans saying whether
 * their fetch had failed. That made "not loaded yet" and "genuinely none"
 * the same value, so a half-loaded screen printed a count of zero as fact.
 * The two counts come from two independent polls, so they can also be in
 * DIFFERENT states at the same instant — which is how `0 weighed, 402
 * rejected by the scale (0%)` reached the screen: the lighter reject query
 * (pageSize 1) landed while the register's own count was still in flight.
 * A pending count can no longer be confused with zero, and the combined
 * "N weighed, M rejected (P%)" sentence is only reachable when BOTH counts
 * are `ok`.
 */
export type CountState =
  | { kind: 'ok'; n: number }
  | { kind: 'pending' }
  | { kind: 'failed' };

/** A poll's error + data, as a CountState. Data wins: a poll that has a good
 *  number and a later transient error keeps showing the number, which is
 *  usePolling's own documented rule. */
export function countStateOf(error: string | null, n: number | undefined): CountState {
  if (n != null) return { kind: 'ok', n };
  return error ? { kind: 'failed' } : { kind: 'pending' };
}

export function countLine(
  period: Period,
  listing: Listing,
  total: CountState,
  rejected: CountState,
  outsideOnly: boolean,
  states: ConeState[],
): string {
  const what = fmtDayLong(period.from) === fmtDayLong(period.to) ? fmtDayLong(period.from) : `${period.from} to ${period.to}`;
  // The register itself failed to load: nothing below `total` can be
  // trusted, so the whole sentence is replaced rather than any of its
  // numbers — the body's own Failed block (rendered from the same
  // `rows.error && !rows.data` condition) carries the retry action.
  // UX Phase 7 Brief 1 established this branch; it now reads the state
  // rather than a separate boolean.
  if (total.kind === 'failed') return W.readings.countLineFailed;
  // Not failed, not yet answered. Every sentence below states a number, and
  // there is no number to state.
  if (total.kind === 'pending') return `${what}: ${W.readings.countLinePending}`;
  if (listing === 'sacks') return `${what}: ${fmtInt(total.n)} sacks weighed.`;
  // Corrected 23 Sep 2026 (reject-denominator brief): "before weighing"
  // asserted an order the data contradicts — matching reject_event to
  // cone_event finds a weighed cone (in_range = 1) for 98%+ of these,
  // rejected downstream of weighing, not before it. See words.ts
  // readings.inspectionRejects for the fuller note.
  if (listing === 'inspectionRejects') return `${what}: ${fmtInt(total.n)} cones rejected by inspection.`;
  // With state chips on, `total` is the filtered count — the same reason the
  // outside-limits sentence below does not reuse the "N weighed, M rejected
  // (P%)" form.
  if (listing === 'cones' && states.length > 0) {
    return `${what}: ${W.cone.countLineState(fmtInt(total.n), states.map((st) => W.cone.state[st].toLowerCase()).join(' or '))}`;
  }
  // With the outside-limits filter on, `total` counts only the filtered cones
  // while `rejected` counts every scale-rejected cone in the period — two
  // different populations. Stating them as "N weighed, M rejected (P%)" made
  // P unbounded: 40 shown against 160 scale rejects printed "400.0%".
  if (outsideOnly) return `${what}: ${W.readings.countLineOutside(fmtInt(total.n))}`;
  if (listing === 'rejected') return `${what}: ${fmtInt(total.n)} cones rejected by the scale.`;
  // The register loaded fine (`total` is real) but the separate scale-reject
  // count did not — say what is known and name what is not, rather than
  // stating "0 rejected by the scale (0%)" as if the scale rejected nothing.
  if (rejected.kind === 'failed') return `${what}: ${W.readings.countLineRejectUnknown(fmtInt(total.n))}`;
  // Same sentence, different reason: it has not arrived yet.
  if (rejected.kind === 'pending') return `${what}: ${W.readings.countLineRejectPending(fmtInt(total.n))}`;
  // Both counts are real from here down. A rate between them needs a
  // non-zero denominator; "402 out of 0" is not 0%, so when the register
  // genuinely returns none weighed the two numbers are stated without one.
  if (total.n === 0 && rejected.n > 0) {
    return `${what}: ${W.readings.countLineNoRate(fmtInt(total.n), fmtInt(rejected.n))}`;
  }
  const pct = total.n > 0 ? `${Math.round((1000 * rejected.n) / total.n) / 10}%` : '0%';
  return `${what}: ${W.readings.countLine(fmtInt(total.n), fmtInt(rejected.n), pct)}`;
}

/* ------------------------------------------------------------ the filters */

function StationChip({
  stations,
  value,
  onChange,
  failed,
}: {
  stations: StationRow[];
  value: number | null;
  onChange: (v: number | null) => void;
  /** UX Phase 7 Brief 1: /api/stations failing and /api/stations answering
   *  with a genuinely empty roster look identical to `stations.length === 0`
   *  below — this used to return null either way, so a failed fetch quietly
   *  REMOVED the station filter from the toolbar rather than saying it could
   *  not be reached. A day with no stations at all (unseen in practice, but
   *  not ruled out) still shows nothing, which is the honest answer there. */
  failed?: boolean;
}) {
  if (failed) return <span className="chip mut">{W.readings.stationFilterUnavailable}</span>;
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

/**
 * The five states as toggle chips — any combination, none meaning all. The
 * words are the state's own (W.cone.state), so the chip, the column and the
 * sheet never name one state three ways.
 */
function StateChips({ value, onChange }: { value: ConeState[]; onChange: (v: ConeState[]) => void }) {
  const toggle = (st: ConeState) => onChange(value.includes(st) ? value.filter((x) => x !== st) : [...value, st]);
  return (
    <span className="chip" role="group" aria-label={W.cone.filterState}>
      {W.cone.filterState}{' '}
      <button type="button" className="linkish" aria-pressed={value.length === 0} onClick={() => onChange([])}
              style={{ fontWeight: value.length === 0 ? 600 : 400 }}>
        {W.cone.anyState}
      </button>
      {CONE_STATES.map((st) => (
        <button key={st} type="button" className="linkish" aria-pressed={value.includes(st)} onClick={() => toggle(st)}
                style={{ marginLeft: 8, fontWeight: value.includes(st) ? 600 : 400 }}>
          {W.cone.stateShort[st]}
        </button>
      ))}
    </span>
  );
}

export function Pager({
  page,
  total,
  onPage,
  /** The caller's own page size. Sacks' history listing is 25, not the
   *  register's 100 (see Sacks.tsx's HISTORY_PAGE_SIZE); without this the
   *  page count here would be computed from a size that listing never asked
   *  for, and the pager would stop four pages early. */
  size = PAGE_SIZE,
}: { page: number; total: number; onPage: (p: number) => void; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
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

export function ReadingTable({
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
          <th style={{ paddingLeft: 32 }}>{isSack ? W.readings.status : W.cone.colState}</th>
          {!isSack && <th style={{ paddingLeft: 24 }}>{W.cone.colProduct}</th>}
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
                ) : r.state ? (
                  // The one classification, in its own words. Low/high are
                  // accented like a rejection: the product's tolerance is the
                  // second fact, and a cone outside it is worth a glance.
                  <span className={r.state === 'within' ? '' : r.state === 'unknown' ? 'mut' : 'acc'}>{W.cone.state[r.state]}</span>
                ) : rejectedByScale ? (
                  <span className="acc">{W.rejectedByScale}</span>
                ) : (
                  W.passed
                )}
              </td>
              {!isSack && <td style={{ paddingLeft: 24 }} className={r.product_name ? '' : 'mut'}>{r.product_name ?? W.cone.noProductOnRow}</td>}
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
