/**
 * Wall mode — for a TV in the warehouse or beside the line. No navigation, no
 * scrolling, dark ground, type sized in viewport units so it reads from across
 * a room on any screen. One card per line the API reports (one line today;
 * the layout is a grid so more simply appear beside it).
 *
 * Reached at ?v=wall after a normal login. Sessions renew while in use (see
 * api auth.ts), so a display left on this page stays on it. Esc, or the small
 * button in the corner, returns to the Now screen.
 */
import { useEffect } from 'react';
import type { LiveLine } from '../api';
import { ageLabel, freshnessLevel } from '../format';
import { useLive, usePlantNow, useTicker } from '../floor/live';
import { describeState } from '../floor/NowScreen';
import { S } from '../floor/strings';
import { fmtAgo, fmtClock, fmtClockSec, fmtDay, fmtInt, fmtKg, kgParts, secondsBetween } from '../floor/fmt';
import { Measure } from '../floor/bits';

const STATION_COUNT = 14;
const STATION_DIM_SECONDS = 300;

function WallLine({ line, nowIso }: { line: LiveLine; nowIso: string }) {
  const st = describeState(line, nowIso);
  const t = line.thisShift;
  const byStation = new Map(line.stations.map((s) => [s.station, s]));
  const stationIds = Array.from(
    { length: Math.max(STATION_COUNT, ...line.stations.map((s) => s.station)) },
    (_, i) => i + 1,
  );
  return (
    <section className="wline" aria-label={line.lineName}>
      <div className="wl-head">
        <span className="wl-name">{line.lineName}</span>
        <span className="wl-shift">
          {S.shift[line.shift.code]} · {fmtClock(line.shift.startUtc)} – {fmtClock(line.shift.endUtc)}
        </span>
      </div>

      <div className={`wall-state ${st.cls}`} aria-live="polite">
        <div className="ws-title">{st.title}</div>
        <div className="ws-detail">{st.detail}</div>
      </div>

      <div className="wall-nums">
        <div className="wn">
          <div className="wn-label">{S.conesThisShift}</div>
          <div className="wn-val">{fmtInt(t.cones)}</div>
          <div className="wn-foot">{t.conesPerHour != null ? `${fmtInt(t.conesPerHour)} ${S.perHour}` : ' '}</div>
        </div>
        <div className="wn">
          <div className="wn-label">{S.sacksThisShift}</div>
          <div className="wn-val">{fmtInt(t.sacks)}</div>
          <div className="wn-foot">{fmtKg(t.sackWeightKg)}</div>
        </div>
        <div className="wn">
          <div className="wn-label">{S.rejectedThisShift}</div>
          <div className="wn-val">{fmtInt(t.rejectedCones)}</div>
          <div className="wn-foot">
            {line.lastReject ? `${S.lastReject} ${fmtClock(line.lastReject.ts)}` : S.noneYet}
          </div>
        </div>
        <div className={`wn wn-last${line.lastSack && line.lastSack.inRange === false ? ' alarm' : ''}`}>
          {/* Pill beside the label. Beside the number it took roughly a quarter
              of the card's width and pushed "kg" past the card's right edge. */}
          <div className="wn-head">
            <span className="wn-label">{S.lastSack}</span>
            {line.lastSack && (
              <span className={`wn-pill ${line.lastSack.inRange == null ? 'none' : line.lastSack.inRange ? 'on' : 'off'}`}>
                {line.lastSack.inRange == null ? '—' : line.lastSack.inRange ? S.ok : S.out}
              </span>
            )}
          </div>
          {line.lastSack ? (
            <>
              <div className="wn-val"><Measure parts={kgParts(line.lastSack.weightKg)} /></div>
              <div className="wn-foot">
                #{line.lastSack.sackNum ?? '—'} · {fmtClock(line.lastSack.ts)} · {fmtAgo(secondsBetween(line.lastSack.ts, nowIso))}
              </div>
            </>
          ) : (
            <>
              <div className="wn-val">—</div>
              <div className="wn-foot">{S.noneYet}</div>
            </>
          )}
        </div>
      </div>

      <div className="wall-stations" aria-label={S.stations}>
        {stationIds.map((id) => {
          const s = byStation.get(id);
          const quiet = !s || secondsBetween(s.lastTs, nowIso) > STATION_DIM_SECONDS;
          const off = !s && line.state.status === 'running';
          return (
            <div key={id} className={`wst${quiet ? ' dim' : ''}${off ? ' off' : ''}`}>
              <span className="wst-n">{id}</span>
              <span className="wst-c">{s ? fmtInt(s.cones) : '—'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function WallScreen({ onExit }: { onExit: () => void }) {
  const live = useLive();
  const plantNow = usePlantNow();
  const now = useTicker(1000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const first = live.lines[0] ?? null;
  const nowIso = plantNow ?? first?.plantNowUtc ?? null;
  const age = live.updatedAt == null ? null : Math.round((now - live.updatedAt) / 1000);

  return (
    <div className={`wall${live.lines.length > 1 ? ' multi' : ''}`}>
      <header className="wall-head">
        <div className="wall-brand">
          SMS <span>{first?.lineName ?? ''}</span>
        </div>
        {nowIso && (
          <div className="wall-clock">
            <span className="wc-time">{fmtClock(nowIso)}</span>
            <span className="wc-day">{fmtDay(nowIso)}</span>
          </div>
        )}
      </header>

      {first?.replay && nowIso && (
        <div className="wall-replay" role="status">
          {S.replayBanner} {fmtDay(nowIso)}, {fmtClockSec(nowIso)}. {S.replayNote}
        </div>
      )}

      {!first ? (
        <div className="wall-state none">
          <div className="ws-title">{live.loading ? S.loading : S.noData}</div>
          <div className="ws-detail">{live.error ?? ''}</div>
        </div>
      ) : (
        <div className="wall-lines">
          {live.lines.map((l) => (
            <WallLine key={l.lineId} line={l} nowIso={nowIso ?? l.plantNowUtc} />
          ))}
        </div>
      )}

      <footer className="wall-foot">
        <span className={live.error ? 'alarm' : ''}>
          {live.error ? S.offline : `${S.updated} ${fmtAgo(age)}`}
        </span>
        {live.meta && (
          <span>
            <span className={`dot ${freshnessLevel(live.meta.sourceAgeSeconds)}`} /> {S.plantLink}{' '}
            {ageLabel(live.meta.sourceAgeSeconds)}
          </span>
        )}
        <button type="button" className="wall-exit" onClick={onExit}>
          {S.exitWall}
        </button>
      </footer>
    </div>
  );
}
