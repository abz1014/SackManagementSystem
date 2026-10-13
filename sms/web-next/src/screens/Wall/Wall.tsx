/**
 * TV wall in dark Style C (task E4). Rendered by AppShell in wall mode, so there
 * is no chrome; Esc is handled by the frame, and a small link leaves as well.
 *
 * Rules carried over from the old board (web/src/screens/Wall.tsx):
 *  - It never blanks on failure: the last good figures stay and the footer names
 *    what failed. A failed part says so in words; it is never drawn as a zero.
 *  - Keeping the figures is not keeping the verdict. When health is not ok, when
 *    this browser has had no answer for three polls, or when the readings belong
 *    to a data set that has ended, the big sentence stops saying whether the line
 *    runs and reads "Not updating since HH:MM".
 *  - Station states come decided from /api/station-status. This file only orders
 *    and counts them. Act and Watch glow; nothing else does.
 *  - A quiet station is a visible gap: a muted tile with the time it went quiet.
 *  - Nothing is measured against the browser clock except the age of this
 *    browser's own last answer (a fact about the browser, not the plant).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getProduction, type LiveLine, type StationStatusRow } from '../../bridge/api';
import { fmt, generationWords, health as healthLib, live, period as P, simulatorWords } from '../../bridge/lib';
import { W } from '../../bridge/words';
import { C, FRAGMENTS } from '../../copy';
import { todayRoute } from '../../appRoute';
import { useData, usePeriod, useProduction, useStationStatus, useLive } from '../../data';
import { hrefFor, plainClick } from '../../ui/nav';
import { StatusPill, type UiState } from '../../ui/StatusPill';
import type { ScreenProps } from '../registry';
import { readUiScale } from '../../ui/uiScale';
import { fmtTime } from '../../lib/fmt';
import { clockOn } from '../Today/model';
import { inShiftOrder } from './shifts';
import './wall.css';

const WC = C.wall;
const WCF = FRAGMENTS.wall;

/** Quiet after twenty minutes without a cone, measured from the newest reading (the plant writes rows ~15 min late). */
const QUIET_AFTER_SECONDS = 20 * 60;
/** How long /api/live may go unanswered before the board stops asserting the line's state. */
const OUT_OF_CONTACT_MS = 3 * live.LIVE_POLL_MS;

const ORDER: Record<UiState, number> = { act: 0, watch: 1, ok: 2, nodata: 3 };

function lineName(line: LiveLine): string {
  return line.lineShortName || line.lineName;
}

/** The sentence about the line itself. Only called when its state is knowable. */
function stateSentence(line: LiveLine, anchor: string): string {
  const name = lineName(line);
  switch (line.state.status) {
    case 'running':
      return `${name} ${W.state.running}`;
    case 'stopped':
      return line.state.behindSeconds != null
        ? `${name} ${W.state.stopped(fmt.fmtSpan(line.state.behindSeconds))}`
        : `${name} ${W.state.stoppedUnknownDuration}`;
    default:
      return `${name} ${W.state.idle(fmtTime(anchor))}`;
  }
}

function lagSentence(health: ReturnType<typeof healthLib.assessHealth>): string {
  switch (health.kind) {
    case 'stale':
      return W.lag.stale(health.readingUtc ? fmtTime(health.readingUtc) : '—');
    case 'late':
      return W.lag.late(fmt.fmtSpan(health.lagSeconds));
    case 'ok':
      return health.lagSeconds != null
        ? W.lag.ok(fmtTime(health.readingUtc), fmt.fmtSpan(health.lagSeconds))
        : W.lag.okNoLag(fmtTime(health.readingUtc));
    default:
      return W.lag.noData;
  }
}

interface Kpi { key: string; label: string; value: string; unit: string; cls: string }

/** Waits for the plant clock (which fixes the period), then draws the board. Nothing is fetched for an invented period. */
/** The Wall honours the old app's saved display scale (localStorage sms.uiScale: 1 Desk, 1.3 Wall). */
/* Saved Wall size (1.3) enlarges the board's type 1.25x; wall-dark.css multiplies it into --wall-scale and also steps it down on narrower screens. */
const wallStyleNow = (): CSSProperties => ({ '--wall-ui': readUiScale() > 1 ? 1.25 : 1 } as CSSProperties);

/** Fix-wave owner decision 13 Oct 2026: the TV wall is for large screens only. No matchMedia (jsdom) counts as large. */
export const WALL_MIN_WIDTH = 1024;
function useLargeScreen(): boolean {
  const q = `(min-width: ${WALL_MIN_WIDTH}px)`;
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : true);
  const [large, setLarge] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(q);
    const on = () => setLarge(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [q]);
  return large;
}

export function WallScreen(props: ScreenProps) {
  const large = useLargeScreen();
  if (!large) return <WallNeedsLargeScreen route={props.route} />;
  return <WallLoader {...props} />;
}

/** Below 1024 px there is no wall layout: one sentence and the way back to Today. */
function WallNeedsLargeScreen({ route }: Pick<ScreenProps, 'route'>) {
  const back = todayRoute(route);
  return (
    <div className="wall dark wl wl-small" data-wall data-wall-small style={wallStyleNow()}>
      <h1 className="wl-small-text">{C.shell.wallNeedsLargeScreen}</h1>
      <a className="wl-small-link" href={hrefFor(back)} onClick={(e) => plainClick(e, () => window.location.assign(hrefFor(back)))}>
        {C.nav.today}
      </a>
    </div>
  );
}

function WallLoader(props: ScreenProps) {
  const { period, status, failed } = usePeriod();
  const { error } = useLive();
  if (!period) {
    return (
      <div className="wall dark wl" data-wall style={wallStyleNow()}>
        <a className="wl-exit" href={hrefFor(todayRoute(props.route))}>{WC.exit}</a>
        <p className="wl-hero state" data-state="watch">{WC.waiting}</p>
        <p className="wl-foot">
          {status === 'error' && failed.length > 0 ? failed.map((p) => WC.couldntRead(p)).join(' ') : error ? W.offline : W.loading}
        </p>
      </div>
    );
  }
  return <WallBoard {...props} period={period} />;
}

function WallBoard({ route, period }: ScreenProps & { period: P.Period }) {
  const { line, error, updatedAt } = useLive();
  const browserNow = live.useTicker(1000);
  const stationsD = useStationStatus(period);
  const prodD = useProduction(period);
  const shiftsD = useData(
    'shift output',
    () => getProduction({ ...P.periodQuery(period), groupBy: 'shift' }),
    `wall-shifts:${period.key}|${period.from}|${period.to}|${period.shift ?? ''}:${period.live ? period.tsTo : ''}`,
    { live: period.live },
  );

  const outOfContact = error != null && updatedAt != null && browserNow - updatedAt > OUT_OF_CONTACT_MS;
  const exitRoute = todayRoute(route);

  const exit = (
    <a className="wl-exit" href={hrefFor(exitRoute)} onClick={(e) => plainClick(e, () => window.location.assign(hrefFor(exitRoute)))}>
      {WC.exit}
    </a>
  );

  const rows = stationsD.data?.data.stations ?? null;
  const sorted = useMemo(
    () => (rows ? [...rows].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.station - b.station) : null),
    [rows],
  );

  if (!line) {
    return (
      <div className="wall dark wl" data-wall style={wallStyleNow()}>
        {exit}
        <p className="wl-hero state" data-state="watch">{WC.waiting}</p>
        <p className="wl-foot">{error ? W.offline : W.loading}</p>
      </div>
    );
  }

  const health = healthLib.assessHealth(line);
  const generationEnded = generationWords.hasNewerElsewhere(line.generation);
  const knowable = healthLib.stateIsKnowable(health) && !outOfContact && !generationEnded;
  const anchor = line.dataAsOfUtc ?? line.plantNowUtc;
  const sinceUtc = health.kind === 'none' ? null : health.readingUtc ?? anchor;

  const act = sorted ? sorted.filter((s) => s.state === 'act').length : 0;
  const watch = sorted ? sorted.filter((s) => s.state === 'watch').length : 0;

  const hero = knowable ? stateSentence(line, anchor) : sinceUtc ? WC.notUpdatingSince(fmtTime(sinceUtc)) : WC.notUpdating;

  const liveByStation = new Map(line.stations.map((s) => [s.station, s]));
  const quietClock = (id: number): string | null => {
    const r = liveByStation.get(id);
    if (!r) return null;
    const t = new Date(r.lastTs).getTime();
    if (Number.isNaN(t)) return null;
    return (new Date(anchor).getTime() - t) / 1000 > QUIET_AFTER_SECONDS ? fmtTime(r.lastTs) : null;
  };

  const prodRow = prodD.data?.data.rows[0] ?? null;
  const unread = WC.unreadable;
  const packed = prodRow ? fmt.kgParts(prodRow.sackWeightKg) : { value: unread, unit: '' };
  const failedPct = stationsD.data ? stationsD.data.data.lineFailedPct : null;
  const kpis: Kpi[] = [
    { key: 'cones', label: WC.kpi.cones, value: prodRow ? fmt.fmtInt(prodRow.cones) : unread, unit: '', cls: 'k-cone' },
    { key: 'sacks', label: WC.kpi.sacks, value: prodRow ? fmt.fmtInt(prodRow.sacks) : unread, unit: '', cls: 'k-sack' },
    { key: 'packed', label: WC.kpi.packed, value: packed.value, unit: packed.unit, cls: 'k-pack' },
    {
      key: 'failed',
      label: WC.kpi.failed,
      value: stationsD.data ? (failedPct == null ? '–' : failedPct.toFixed(1)) : unread,
      unit: failedPct == null ? '' : '%',
      cls: 'k-insp',
    },
  ];

  const shiftRows = shiftsD.data ? inShiftOrder(shiftsD.data.data.rows) : null;
  const shiftMax = shiftRows ? Math.max(1, ...shiftRows.map((r) => r.cones)) : 1;

  const failedParts: string[] = [];
  if (stationsD.status === 'error') failedParts.push(WCF.parts.stations);
  if (prodD.status === 'error') failedParts.push(WCF.parts.production);
  if (shiftsD.status === 'error') failedParts.push(WCF.parts.shifts);
  const staleParts = [stationsD, prodD, shiftsD].some((d) => d.staleError);

  const periodText = P.describePeriod(period);
  const placeText = [line.plantName, line.unitName].filter(Boolean).join(', ');

  return (
    <div className="wall dark wl" data-wall data-known={knowable ? 'yes' : 'no'} style={wallStyleNow()}>
      <header className="wl-hdr">
        <div className="wl-brand">
          SMS <span>{[placeText, periodText].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="wl-clock">
          <span>{WC.updated}</span>
          <b>{fmtTime(line.plantNowUtc)}</b>
          {exit}
        </div>
      </header>

      <p className="wl-hero state" data-state={knowable ? undefined : 'watch'} aria-live="polite">
        {hero}
        {sorted && (act > 0 || watch > 0) ? (
          <span className="wl-hero-rest">
            {'. '}
            {act > 0 && <span className="state" data-state="act">{WC.stationsAction(act)}</span>}
            {act > 0 && watch > 0 && ', '}
            {watch > 0 && <span className="state" data-state="watch">{WC.stationsWatch(watch)}</span>}
            {'.'}
          </span>
        ) : sorted ? (
          <span className="wl-hero-rest">{'. '}{WC.allStationsOk}</span>
        ) : null}
      </p>

      <div className="wl-kpis">
        {kpis.map((k) => (
          <div key={k.key} className={`wl-kpi ${k.cls}`}>
            <div className="wl-kpi-label">{k.label}</div>
            <div className="wl-kpi-value">
              {k.value}
              {k.unit && <span className="wl-kpi-unit">{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {sorted ? (
        <div className="wl-heat" role="list">
          {sorted.map((s) => (
            <WallTile key={s.station} row={s} quiet={quietClock(s.station)} />
          ))}
        </div>
      ) : (
        <p className="wl-missing" role="status">
          {stationsD.status === 'error' ? WC.couldntRead(WCF.parts.stations) : WC.loading}
        </p>
      )}

      <div className="wl-shifts" aria-label={WC.shiftBars}>
        {shiftRows ? (
          shiftRows.map((r) => (
            <div key={r.group} className="wl-shift">
              <span>{(W.shiftName as Record<string, string>)[r.group] ?? r.group}</span>
              <span className="wl-trk">
                <span className="wl-fil" style={{ width: `${((r.cones / shiftMax) * 100).toFixed(1)}%` }} />
              </span>
              <b>{fmt.fmtInt(r.cones)}</b>
            </div>
          ))
        ) : shiftsD.status === 'error' ? (
          <p className="wl-missing" role="status">{WC.couldntRead(WCF.parts.shifts)}</p>
        ) : null}
      </div>

      <footer className="wl-foot state" data-state={knowable ? undefined : 'watch'}>
        <span>
          {outOfContact ? W.offline : lagSentence(health)}
          {!outOfContact && generationEnded && line.generation && (
            <> · {generationWords.quietBecauseGenerationShort(line.generation, clockOn(anchor, line.plantNowUtc)) ?? ''}</>
          )}
          {generationWords.currentIsSimulator(line.generation) && <> · {simulatorWords.wallSimulatorNote}</>}
          {error && !outOfContact && <> · {W.offline}</>}
          {failedParts.length > 0 ? (
            <> · {failedParts.map((p) => WC.couldntRead(p)).join(' ')}</>
          ) : (
            staleParts && <> · {WC.boardIncomplete}</>
          )}
        </span>
      </footer>
    </div>
  );
}

function WallTile({ row, quiet }: { row: StationStatusRow; quiet: string | null }) {
  const nodata = row.state === 'nodata';
  const label = row.name?.trim() ?? '';
  const big = nodata || row.failedPct == null ? '–' : `${row.failedPct.toFixed(1)} %`;
  const m1 = nodata
    ? quiet
      ? WC.silentSince(quiet)
      : C.noCones
    : `${C.stationUi.cones(row.cones)}${quiet ? ` · ${WC.quietSince(quiet)}` : ''}`;
  return (
    <div className="wl-tile state" role="listitem" data-station={row.station} data-state={row.state}>
      <span className="wl-tile-top">
        <span className="wl-tile-name">
          <span className="wl-tile-no">{C.station(row.station)}</span>
          {label && (
            <span className="wl-tile-sub">
              <span className="sr-only"> · </span>
              {label}
            </span>
          )}
        </span>
        <StatusPill state={row.state} compact />
      </span>
      <span className="wl-tile-big">{big}</span>
      <span className="wl-tile-meta">{m1}</span>
      <span className="wl-tile-meta">{row.product ?? (nodata ? '' : C.stationUi.noProduct)}</span>
    </div>
  );
}

export default WallScreen;
