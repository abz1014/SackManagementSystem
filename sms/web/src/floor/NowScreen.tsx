/**
 * Now — the floor's home screen. One glance answers: is the line running,
 * which shift is it, how many cones and sacks so far, what was the last sack.
 * Refreshes itself every ten seconds through <LiveProvider>; nothing here is
 * ever "yesterday" unless the URL carries a replay instant, and then it says so.
 */
import { CurrentProductBar } from '../product';
import type { LiveLine } from '../api';
import { useLive, usePlantNow } from './live';
import { S } from './strings';
import { fmtAgo, fmtClock, fmtClockSec, fmtDay, fmtInt, fmtKg, fmtSpan, gParts, kgParts, secondsBetween } from './fmt';
import { Measure, Pill, ReplayBanner, LiveFooter } from './bits';

type StateCls = 'run' | 'stop' | 'idle' | 'none';

/**
 * The state block's words.
 *
 * Timings come from the server's classification rather than from the wall
 * clock, because IFL's acquisition layer writes a row about 18 minutes after
 * the cone is weighed. "Stopped" therefore uses `behindSeconds`, which is net
 * of that lag and is how long the line has actually been down; the raw
 * wall-clock age of the newest reading is shown separately as "as of", so a
 * reader can see both without the two being confused.
 */
export function describeState(line: LiveLine, nowIso: string): { cls: StateCls; title: string; detail: string } {
  const lc = line.lastCone;
  const since = lc ? Math.max(0, secondsBetween(lc.ts, nowIso)) : null;
  const asOf = line.dataAsOfUtc ?? lc?.ts ?? null;
  switch (line.state.status) {
    case 'running': {
      const runFor = line.state.runStartUtc ? fmtSpan(secondsBetween(line.state.runStartUtc, nowIso)) : null;
      const parts = [
        runFor ? `${S.runningFor} ${runFor}` : null,
        asOf ? `${S.asOf} ${fmtClockSec(asOf)}` : null,
      ].filter(Boolean);
      return { cls: 'run', title: S.running, detail: parts.join(' · ') };
    }
    case 'stopped':
      return {
        cls: 'stop',
        title: `${S.stopped} ${fmtSpan(line.state.behindSeconds ?? since ?? 0)}`,
        detail: lc ? `${S.stoppedAt} ${fmtClockSec(lc.ts)}` : '',
      };
    case 'idle':
      return {
        cls: 'idle',
        title: S.noReadings,
        detail: lc ? `${S.since} ${fmtDay(lc.ts)}, ${fmtClock(lc.ts)} (${fmtAgo(since)})` : '',
      };
    default:
      return { cls: 'none', title: S.noData, detail: S.noDataDetail };
  }
}

const STATION_COUNT = 14;
const STATION_DIM_SECONDS = 300;

export function NowScreen({
  rank,
  onOpenSack,
  onOpenCone,
  onOpenTimeline,
  onProductChanged,
}: {
  rank: number;
  onOpenSack: (id: number) => void;
  onOpenCone: (id: number) => void;
  onOpenTimeline: () => void;
  onProductChanged: () => void;
}) {
  const live = useLive();
  const plantNow = usePlantNow();
  const line = live.line;

  if (!line) {
    if (live.loading) return <div className="sk sk-ribbon" aria-busy="true" />;
    return (
      <div className="error-card" role="alert">
        <b>{S.offline}</b> {live.error}
      </div>
    );
  }

  const nowIso = plantNow ?? line.plantNowUtc;
  const st = describeState(line, nowIso);
  const t = line.thisShift;
  const byStation = new Map(line.stations.map((s) => [s.station, s]));
  const stationIds = Array.from(
    { length: Math.max(STATION_COUNT, ...line.stations.map((s) => s.station)) },
    (_, i) => i + 1,
  );
  // Station activity is measured against the newest reading, not the wall
  // clock. Against the clock every station is permanently more than five
  // minutes quiet, because the plant's readings arrive about eighteen minutes
  // late — which dimmed all fourteen at once and made the panel meaningless.
  const stationAnchor = line.dataAsOfUtc ?? nowIso;

  return (
    <div className="now">
      <ReplayBanner />

      <section className={`now-state ${st.cls}`} aria-live="polite">
        <div className="ns-main">
          <div className="ns-title">{st.title}</div>
          <div className="ns-detail">{st.detail}</div>
        </div>
        <div className="ns-side">
          <div className="ns-shift">{S.shift[line.shift.code]}</div>
          <div className="ns-shift-times">
            {S.shiftStarted} {fmtClock(line.shift.startUtc)} · {S.shiftEnds} {fmtClock(line.shift.endUtc)}
          </div>
          <div className="ns-clock">
            <span className="eyebrow">{S.plantTime}</span>
            <span className="ns-clock-val">{fmtClockSec(nowIso)}</span>
            <span className="ns-clock-day">{fmtDay(nowIso)}</span>
          </div>
        </div>
      </section>

      <div className="tiles">
        <section className="tile">
          <div className="tile-label">{S.conesThisShift}</div>
          <div className="tile-value">{fmtInt(t.cones)}</div>
          <div className="tile-foot">
            {t.conesPerHour != null ? `${fmtInt(t.conesPerHour)} ${S.perHour}` : '—'}
            {t.conesInRangePct != null && <> · {t.conesInRangePct}% {S.inWeightRange}</>}
          </div>
        </section>
        <section className="tile">
          <div className="tile-label">{S.sacksThisShift}</div>
          <div className="tile-value">{fmtInt(t.sacks)}</div>
          <div className="tile-foot">{fmtKg(t.sackWeightKg)} {S.totalKg}</div>
        </section>
        <section className="tile">
          <div className="tile-label">{S.rejectedThisShift}</div>
          <div className="tile-value">{fmtInt(t.rejectedCones)}</div>
          <div className="tile-foot">
            {line.lastReject
              ? `${S.lastReject} ${fmtClock(line.lastReject.ts)}${line.lastReject.station ? ` · ${S.station} ${line.lastReject.station}` : ''}`
              : S.noneYet}
          </div>
        </section>
        {line.lastSack ? (
          <button type="button" className="tile tile-btn" onClick={() => onOpenSack(line.lastSack!.sourceRowId)}>
            {/* The pass/fail pill rides beside the LABEL, not beside the number.
                Inline with the number it competed for the same line, and on a
                narrow window the row wrapped and clipped the unit. */}
            <div className="tile-head">
              <span className="tile-label">{S.lastSack}</span>
              <Pill inRange={line.lastSack.inRange} />
            </div>
            <div className="tile-value"><Measure parts={kgParts(line.lastSack.weightKg)} /></div>
            <div className="tile-foot">
              #{line.lastSack.sackNum ?? '—'} · {fmtClockSec(line.lastSack.ts)} · {fmtAgo(secondsBetween(line.lastSack.ts, nowIso))}
              <span className="tile-go" aria-hidden="true">›</span>
            </div>
          </button>
        ) : (
          <section className="tile">
            <div className="tile-label">{S.lastSack}</div>
            <div className="tile-value">—</div>
            <div className="tile-foot">{S.noneYet}</div>
          </section>
        )}
      </div>

      <div className="tiles tiles-small">
        {line.lastCone ? (
          <button type="button" className="tile tile-btn" onClick={() => onOpenCone(line.lastCone!.sourceRowId)}>
            <div className="tile-head">
              <span className="tile-label">{S.lastCone}</span>
              <Pill inRange={line.lastCone.inRange} />
            </div>
            <div className="tile-value"><Measure parts={gParts(line.lastCone.weightG)} /></div>
            <div className="tile-foot">
              {S.station} {line.lastCone.station ?? '—'} · {fmtClockSec(line.lastCone.ts)}
              <span className="tile-go" aria-hidden="true">›</span>
            </div>
          </button>
        ) : (
          <section className="tile">
            <div className="tile-label">{S.lastCone}</div>
            <div className="tile-value">—</div>
            <div className="tile-foot">{S.noneYet}</div>
          </section>
        )}
        {/* These windows end at the newest reading, not at the wall clock. With
            an 18-minute acquisition lag a window ending now is always empty,
            so each says which moment it counts back from. */}
        <section className="tile">
          <div className="tile-label">{S.last10Min}</div>
          <div className="tile-value">{fmtInt(line.recent.conesLast10Min)}</div>
          <div className="tile-foot">{line.dataAsOfUtc ? `${S.upTo} ${fmtClock(line.dataAsOfUtc)}` : ''}</div>
        </section>
        <section className="tile">
          <div className="tile-label">{S.lastHourCones}</div>
          <div className="tile-value">{fmtInt(line.recent.conesLastHour)}</div>
          <div className="tile-foot">{line.dataAsOfUtc ? `${S.upTo} ${fmtClock(line.dataAsOfUtc)}` : ''}</div>
        </section>
        <section className="tile">
          <div className="tile-label">{S.lastHourSacks}</div>
          <div className="tile-value">{fmtInt(line.recent.sacksLastHour)}</div>
          <div className="tile-foot">{line.dataAsOfUtc ? `${S.upTo} ${fmtClock(line.dataAsOfUtc)}` : ''}</div>
        </section>
      </div>

      <section className="panel stations-panel">
        <div className="panel-head">
          <h3 className="panel-title">{S.stations}</h3>
          <span className="mono-note">{S.thisShift}</span>
        </div>
        <div className="stations">
          {stationIds.map((id) => {
            const s = byStation.get(id);
            const quiet = !s || secondsBetween(s.lastTs, stationAnchor) > STATION_DIM_SECONDS;
            const off = !s && line.state.status === 'running';
            return (
              <div
                key={id}
                className={`st-cell${quiet ? ' dim' : ''}${off ? ' off' : ''}`}
                title={s ? `${S.station} ${id} · ${S.lastCone} ${fmtClockSec(s.lastTs)}` : `${S.station} ${id} · ${S.noneYet}`}
              >
                <span className="st-n">{id}</span>
                <span className="st-c">{s ? fmtInt(s.cones) : '—'}</span>
              </div>
            );
          })}
        </div>
        <div className="panel-foot">{S.stationsNote}</div>
      </section>

      <CurrentProductBar rank={rank} onOpenTimeline={onOpenTimeline} onProductChanged={onProductChanged} />

      <LiveFooter />
    </div>
  );
}
