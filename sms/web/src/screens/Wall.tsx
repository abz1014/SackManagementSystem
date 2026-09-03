/**
 * Wall — a glance from a doorway, four metres away. 1920×1080, 16:9.
 * No hover, no click, no logout. Esc returns to Line.
 *
 * This is a BOARD, composed once, not the desk screen with its chrome removed
 * and its type in viewport units. That was a scale trick: it inherited a
 * reading order built for a mouse at 60cm, and its fourteen bordered station
 * boxes with numbers inside them were illegible from a doorway.
 *
 * THREE RULES IT FOLLOWS THAT THE DESK SCREEN DOES NOT:
 *
 *  1. ONE thing is biggest, and it is the state sentence. 4.1vw is 79px on a
 *     1920 panel — the only thing readable from outside the room, which is the
 *     whole job.
 *  2. STATIONS ENCODE THEIR COUNT AS BAR HEIGHT, with the number below a rule.
 *     A quiet station becomes a visible gap in the row: the fastest read on
 *     the board, and it needs no colour at all.
 *  3. THE FOOTER IS PINNED and never leaves. A display left on for a week must
 *     always be able to say how fresh it is.
 *
 * And two the desk screen shares: nothing is measured against the browser
 * clock, and a display that has stopped receiving data must LOOK stopped —
 * the pulse ceases rather than turning red.
 *
 * It never blanks on failure. A blank wall screen looks like a dead PC, so the
 * last good figures stay and the footer carries the error. There are no
 * skeletons either: motion at this size is a distraction, and the state line
 * says "waiting" in words.
 */
import { useEffect, useMemo } from 'react';
import { useLive, usePlantNow, usePolling } from '../lib/live';
import { assessHealth, stateIsKnowable } from '../lib/health';
import { W } from '../lib/words';
import { fmtClock, fmtClockSec, fmtInt, fmtKg, fmtSpan } from '../lib/fmt';
import { getAttention, getStations, type LiveLine } from '../api';

/**
 * A station is quiet after twenty minutes without a cone, measured from the
 * newest reading rather than from the clock — the plant writes a cone's row
 * about a quarter of an hour after it is weighed, so measuring from now would
 * call every station quiet on a healthy line.
 */
const QUIET_AFTER_SECONDS = 20 * 60;

/** The tallest a bar may be. The CSS reserves the row for exactly this. */
const BAR_MAX_PX = 92;

/**
 * The shortest a bar may be while still saying "this station produced".
 *
 * Without a floor, a station that made three cones against a row maximum of
 * three hundred draws a bar under a pixel high and reads as a gap — the same
 * as a station that made none. Zero must be the only genuine gap.
 */
const BAR_MIN_PX = 4;

export function WallScreen({ onExit }: { onExit: () => void }) {
  const { line, error } = useLive();
  const plantNow = usePlantNow();
  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');

  // The board marks a station the drift test has flagged, so it can be
  // identified from the doorway. Same finding the Line screen names in words.
  const shiftDate = line?.shift.shiftDate;
  const attention = usePolling(
    () => getAttention({ from: shiftDate!, to: shiftDate! }),
    5 * 60_000,
    `wall-attention:${shiftDate ?? 'none'}`,
  );

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onExit();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onExit]);

  const flagged = useMemo(() => {
    const out = new Set<number>();
    for (const f of attention.data?.data.findings ?? []) {
      if (f.kind === 'station_drift' && f.station != null) out.add(f.station);
    }
    return out;
  }, [attention.data]);

  // Never blank: without a line there is nothing to draw, but the board still
  // says so in the one place a person will look.
  if (!line) {
    return (
      <div className="wall">
        <div className="w-head">
          <div>
            <div className="w-line">SMS</div>
            <div className="w-state">{W.lag.noData}</div>
          </div>
        </div>
        <div className="w-foot">
          <span>{error ? W.offline : W.loading}</span>
        </div>
      </div>
    );
  }

  const health = assessHealth(line);
  const knowable = stateIsKnowable(health);
  const alarm = health.kind !== 'ok';
  const t = line.thisShift;
  const names = stations.data?.stations ?? [];
  const anchor = line.dataAsOfUtc ?? line.plantNowUtc;

  const byId = new Map(line.stations.map((s) => [s.station, s]));
  const ids = [...new Set([...names.map((s) => s.stationId), ...line.stations.map((s) => s.station)])]
    .sort((a, b) => a - b);

  // The row scales to its own maximum, so the board reads every shift rather
  // than sitting at a tenth of a fixed ceiling. It is a picture of THIS shift,
  // not a comparison against another day's photograph of the wall.
  const rowMax = Math.max(1, ...ids.map((id) => byId.get(id)?.cones ?? 0));

  const quietSeconds = (lastTs: string) =>
    Math.max(0, (new Date(anchor).getTime() - new Date(lastTs).getTime()) / 1000);

  const quietCount = ids.filter((id) => {
    const row = byId.get(id);
    return !row || quietSeconds(row.lastTs) > QUIET_AFTER_SECONDS;
  }).length;

  return (
    <div className="wall" onDoubleClick={onExit}>
      <div className="w-head">
        <div>
          <div className="w-line">{line.lineName}</div>
          <div className={`w-state${knowable ? '' : ' acc'}`}>{stateSentence(line, knowable, anchor)}</div>
        </div>
        <div className="w-clock">
          <b>{plantNow ? fmtClockSec(plantNow) : '—'}</b>
          <span>
            {W.shiftName[line.shift.code]} {fmtClock(line.shift.startUtc)}–{fmtClock(line.shift.endUtc)}
          </span>
        </div>
      </div>

      <div className="w-figs">
        <div>
          <b>{fmtInt(t.cones)}</b>
          <span>
            {W.fig.cones}
            {t.conesInRangePct != null && ` · ${W.withinLimits(`${t.conesInRangePct}%`)}`}
          </span>
        </div>
        <div>
          <b>{fmtInt(t.sacks)}</b>
          <span>
            {W.fig.sacks} · {fmtInt(Math.round(t.sackWeightKg))} {W.fig.kg}
          </span>
        </div>
        <div>
          <b>{fmtInt(t.rejectedCones)}</b>
          <span>{W.fig.rejected}</span>
        </div>
      </div>

      <div className="w-stwrap">
        <div className="w-sub">
          <span>{W.stations} — {W.stationsNote}</span>
          {quietCount > 0 && (
            <span className="w-note acc">
              {quietCount} {W.quiet}
            </span>
          )}
        </div>
        <div className="w-st" style={{ ['--st-count' as string]: String(ids.length) }}>
          {ids.map((id) => {
            const row = byId.get(id);
            const cones = row?.cones ?? 0;
            const quiet = !row || quietSeconds(row.lastTs) > QUIET_AFTER_SECONDS;
            const flag = flagged.has(id);
            // Zero is the only genuine gap; anything produced gets a bar.
            const h = cones === 0 ? 0 : Math.max(BAR_MIN_PX, Math.round((cones / rowMax) * BAR_MAX_PX));
            return (
              <div key={id} className={flag ? 'flag' : quiet ? 'quiet' : undefined}>
                <span className="bar" style={{ height: `${h}px` }} />
                <span className="cap">
                  <b>{cones === 0 ? '—' : fmtInt(cones)}</b>
                  <i>{names.find((n) => n.stationId === id)?.name?.trim() || id}</i>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`w-foot${alarm ? ' acc' : ''}`}>
        <span>
          <span className={`dot live${health.kind === 'stale' ? ' bad' : health.kind === 'late' ? ' warn' : ''}`} />
          {lagSentence(line, health)}
        </span>
        <span>
          {line.lastSack && `${W.lastSack} ${fmtKg(line.lastSack.weightKg)} ${fmtClock(line.lastSack.ts)}`}
          {line.lastCone &&
            ` · ${W.lastCone} ${fmtInt(Math.round(line.lastCone.weightG ?? 0))} g ${fmtClock(line.lastCone.ts)}`}
          {error && ` · ${W.offline}`}
        </span>
      </div>
    </div>
  );
}

/** The biggest thing on the board, and the only one read from outside the room. */
function stateSentence(line: LiveLine, knowable: boolean, anchor: string): string {
  if (!knowable) return W.state.unknown;
  const name = lineTitle(line);
  switch (line.state.status) {
    case 'running':
      return `${name} ${W.state.running}`;
    case 'stopped':
      return `${name} ${W.state.stopped(fmtSpan(line.state.behindSeconds ?? 0))}`;
    default:
      return `${name} ${W.state.idle(fmtClock(anchor))}`;
  }
}

function lagSentence(line: LiveLine, health: ReturnType<typeof assessHealth>): string {
  switch (health.kind) {
    case 'stale':
      return W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—');
    case 'late':
      return W.lag.late(fmtSpan(health.lagSeconds));
    case 'ok':
      return health.lagSeconds != null
        ? W.lag.ok(fmtClock(health.readingUtc), fmtSpan(health.lagSeconds))
        : W.lag.okNoLag(fmtClock(health.readingUtc));
    default:
      return W.lag.noData;
  }
}

/**
 * LINE_NAME is a full address — "TP1 · Line 3 · Unit 2" — which is right above
 * the state sentence but too long inside it. The segment that says "Line" is
 * what a person calls the line.
 */
function lineTitle(line: LiveLine): string {
  const parts = line.lineName.split('·').map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => /line/i.test(p)) ?? parts[parts.length - 1] ?? line.lineName;
}

