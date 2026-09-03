/**
 * Wall — the Line screen for a monitor beside the line or in the office.
 *
 * Fullscreen, no bar, viewport-unit type, read from across a room. It is not a
 * navigation destination: it is a button, and Escape comes back.
 *
 * THREE THINGS A WALL DISPLAY NEEDS THAT A DESK SCREEN DOES NOT:
 *  1. It must never log itself out. Sessions renew while in use, so a display
 *     left on for a week keeps working.
 *  2. It must keep the last good figures when the network drops, and SAY that
 *     it is not updating — a frozen screen that looks live is worse than a
 *     blank one.
 *  3. Nothing on it may be hover-only. Every number carries its own label.
 */
import { useEffect } from 'react';
import { useLive, usePlantNow } from '../lib/live';
import { assessHealth, stateIsKnowable } from '../lib/health';
import { W } from '../lib/words';
import { fmtClock, fmtInt, fmtKg, fmtSpan } from '../lib/fmt';
import { getStations, type LiveLine } from '../api';
import { usePolling } from '../lib/live';

const QUIET_AFTER_SECONDS = 20 * 60;

export function WallScreen({ onExit }: { onExit: () => void }) {
  const { line, error } = useLive();
  const plantNow = usePlantNow();
  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onExit();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onExit]);

  if (!line) {
    return (
      <div className="wall">
        <div className="w-state">{W.lag.noData}</div>
      </div>
    );
  }

  const health = assessHealth(line);
  const knowable = stateIsKnowable(health);
  const t = line.thisShift;
  const names = stations.data?.stations ?? [];
  const ids = [...new Set([...names.map((s) => s.stationId), ...line.stations.map((s) => s.station)])].sort((a, b) => a - b);
  const byId = new Map(line.stations.map((s) => [s.station, s]));
  const anchor = line.dataAsOfUtc ?? line.plantNowUtc;

  return (
    <div className="wall" onDoubleClick={onExit}>
      <div className="w-head">
        <div className={`w-state${knowable ? '' : ' acc'}`}>
          {knowable
            ? `${lineTitle(line)} ${line.state.status === 'running' ? W.state.running : line.state.status === 'stopped' ? W.state.stopped(fmtSpan(line.state.behindSeconds ?? 0)) : W.state.idle(fmtClock(anchor))}`
            : W.state.unknown}
        </div>
        <div className="w-shift">
          {W.shiftName[line.shift.code]} {fmtClock(line.shift.startUtc)}–{fmtClock(line.shift.endUtc)}
          {plantNow && <> · {fmtClock(plantNow)}</>}
        </div>
      </div>

      <div className="w-figs">
        <div>
          <b>{fmtInt(t.cones)}</b>
          <span>{W.fig.cones} · {t.conesInRangePct != null ? `${t.conesInRangePct}% within limits` : '—'}</span>
        </div>
        <div>
          <b>{fmtInt(t.sacks)}</b>
          <span>{W.fig.sacks} · {fmtInt(Math.round(t.sackWeightKg))} {W.fig.kg}</span>
        </div>
        <div>
          <b>{fmtInt(t.rejectedCones)}</b>
          <span>{W.fig.rejected}</span>
        </div>
      </div>

      <div>
        <div className="w-sub">
          {line.lastSack && <>Last sack {fmtKg(line.lastSack.weightKg)} at {fmtClock(line.lastSack.ts)}</>}
          {line.lastCone && <> · last cone {fmtInt(Math.round(line.lastCone.weightG ?? 0))} g at {fmtClock(line.lastCone.ts)}</>}
        </div>
        <div className="w-st" style={{ ['--st-count' as string]: String(Math.min(ids.length, 14)) }}>
          {ids.map((id) => {
            const row = byId.get(id);
            const quiet = row ? (new Date(anchor).getTime() - new Date(row.lastTs).getTime()) / 1000 > QUIET_AFTER_SECONDS : true;
            return (
              <div key={id} className={quiet ? 'quiet' : ''}>
                <i>{names.find((n) => n.stationId === id)?.name?.trim() || id}</i>
                <b>{row ? fmtInt(row.cones) : '—'}</b>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`w-foot${health.kind === 'ok' ? '' : ' acc'}`}>
        <span>
          {health.kind === 'stale'
            ? W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—')
            : health.kind === 'late'
              ? W.lag.late(fmtSpan(health.lagSeconds))
              : line.dataAsOfUtc
                ? W.lag.ok(fmtClock(line.dataAsOfUtc), line.ingestLagSeconds != null ? fmtSpan(line.ingestLagSeconds) : '—')
                : W.lag.noData}
        </span>
        <span>{error ? W.offline : 'Esc to leave'}</span>
      </div>
    </div>
  );
}

function lineTitle(line: LiveLine): string {
  const parts = line.lineName.split('·').map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => /line/i.test(p)) ?? parts[parts.length - 1] ?? line.lineName;
}
