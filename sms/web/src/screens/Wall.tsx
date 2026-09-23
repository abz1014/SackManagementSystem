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
 *
 * KEEPING THE FIGURES IS NOT THE SAME AS KEEPING THE VERDICT (23 Sep 2026).
 * A frozen count is a true statement about a past instant, and the footer says
 * which instant. "Line 3 is running" is a claim about NOW, and a frozen payload
 * cannot support it. So the counts stay when the link drops and the state
 * sentence stops — see OUT_OF_CONTACT_MS below for what was on screen before
 * this rule existed.
 */
import { useEffect, useMemo } from 'react';
import { LIVE_POLL_MS, useLive, usePlantNow, usePolling, useTicker } from '../lib/live';
import { assessHealth, stateIsKnowable } from '../lib/health';
import { W } from '../lib/words';
import { fmtClock, fmtClockSec, fmtG, fmtInt, fmtKg, fmtPct1, fmtSpan } from '../lib/fmt';
import { getAttention, getStations, type LiveLine } from '../api';

/**
 * A station is quiet after twenty minutes without a cone, measured from the
 * newest reading rather than from the clock — the plant writes a cone's row
 * about a quarter of an hour after it is weighed, so measuring from now would
 * call every station quiet on a healthy line.
 */
const QUIET_AFTER_SECONDS = 20 * 60;

/**
 * The shortest a bar may be while still saying "this station produced", as a
 * fraction of the reserved row.
 *
 * Without a floor, a station that made three cones against a row maximum of
 * three hundred draws a bar under a pixel high and reads as a gap — the same
 * as a station that made none. Zero must be the only genuine gap.
 *
 * A FRACTION, not a pixel count: the row itself is `--bar-max` in the
 * stylesheet, sized in vw so the board stays proportional if the panel is ever
 * driven at 2560 or 3840. This is the 4px floor as it stood on a 1920 panel.
 */
const BAR_MIN_RATIO = 0.045;

/**
 * How long /api/live may go unanswered before this board stops asserting
 * whether the line is running. Three poll cycles: two consecutive misses.
 *
 * WHY THIS EXISTS (23 Sep 2026 sweep; reproduced at 1920×1080 by failing every
 * /api/live request and waiting). Everything the board says about the line is
 * computed from ONE payload — `assessHealth(line)` compares `line.plantNowUtc`
 * against `line.dataAsOfUtc`, and both of those are fields of that payload.
 * When the fetch stops succeeding the payload FREEZES, so the two fields keep
 * their old relationship and the health verdict stays `ok` for as long as the
 * link is down. The board went on printing
 *
 *     "Line 3 is running"                                   (79px, the headline)
 *     "Readings to 10:59 AM · they reach this system
 *      about 17 min after weighing."                        (the all-clear lag line)
 *
 * with the server unreachable for half a minute and counting — the two
 * most-reassuring sentences it owns, asserted while blind. The only contrary
 * signal was six words at the tail of the footer's second line.
 *
 * That is the CLAUDE.md rule inverted: "when it is not `ok`, no screen asserts
 * whether the line is running." It never became not-`ok`, because nothing
 * measured the age of the FETCH as distinct from the age of the READING.
 *
 * ON THE CLOCK THIS USES. This is the one measurement on the board that is
 * allowed to read the browser's clock, and it does not break the TWO CLOCKS
 * rule: it asks "how long since THIS BROWSER last got an answer", which is a
 * fact about this browser, not about the plant. No plant timestamp is compared
 * to `Date.now()` here.
 */
const OUT_OF_CONTACT_MS = 3 * LIVE_POLL_MS;

/** The middle value of a set of station counts — see Line.tsx's own copy of
 *  this (StationRowGrid's `median`) for why median rather than mean. Kept
 *  as a separate local copy rather than a shared import: both are small,
 *  pure, and screen-local, and neither screen's owner should have to touch
 *  the other's file to change it. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function WallScreen({ onExit }: { onExit: () => void }) {
  const { line, error, updatedAt } = useLive();
  const plantNow = usePlantNow();
  const browserNow = useTicker(1000);
  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');

  // See OUT_OF_CONTACT_MS. `error` alone is not enough: one missed poll on a
  // plant LAN is ordinary and must not make a working board go blank. Both
  // conditions together mean the last answer is old AND the retries are still
  // failing.
  const outOfContact = !!error && updatedAt != null && browserNow - updatedAt > OUT_OF_CONTACT_MS;

  // The board marks a station the drift test has flagged, so it can be
  // identified from the doorway. Same finding the Line screen names in words.
  // Not asked for until the plant's shift date is known (roadmap Phase 8,
  // 15 Sep 2026, gap analysis §10): on first render `line` is null, and the
  // call went out with from=undefined — answered for whatever day the API
  // defaulted to, cached under 'none', and thrown away when the real date
  // arrived. One request that could only ever be wrong.
  const shiftDate = line?.shift.shiftDate ?? null;
  const attention = usePolling(
    () => (shiftDate ? getAttention({ from: shiftDate, to: shiftDate }) : Promise.resolve(null)),
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
  // Out of contact is a SECOND reason the state is unknowable, on top of the
  // reading's own age. The figures below stay (a blank wall reads as a dead
  // PC — see the file header), but the sentence that says what the line is
  // doing stops claiming to know.
  const knowable = stateIsKnowable(health) && !outOfContact;
  const alarm = health.kind !== 'ok' || outOfContact;
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
  // UX Phase 11 (22 Sep 2026): max-normalised bars alone draw the eye to
  // absolute height, nearly identical across stations on a healthy line,
  // rather than to deviation — the actual question a glance from the
  // doorway needs answered. A dashed line at the median count, on the same
  // 0..rowMax basis as every bar, is what makes "above/below typical" the
  // thing that's readable, not just "all fourteen are tall".
  const rowMedianRatio = Math.min(1, medianOf(ids.map((id) => byId.get(id)?.cones ?? 0)) / rowMax);

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
          {/* The address, from the line's own row: plant and unit here, the
              line in the sentence beneath. Two screens used to recover
              these by parsing lineName on '·' (roadmap Phase 1, 14 Sep 2026). */}
          <div className="w-line">{[line.plantName, line.unitName].filter(Boolean).join(' · ')}</div>
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
            {t.conesInRangePct != null && ` · ${W.withinLimits(fmtPct1(t.conesInRangePct))}`}
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
          <span>{W.stations} — {W.stationsNoteShift}</span>
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
            const r = cones === 0 ? 0 : Math.max(BAR_MIN_RATIO, cones / rowMax);
            return (
              <div key={id} className={flag ? 'flag' : quiet ? 'quiet' : undefined}>
                <span className="bar-track">
                  <span className="bar" style={{ height: `calc(var(--bar-max) * ${r.toFixed(4)})` }} />
                  {/* [PHASE 11 R3] Same fraction on every station's cell, so the
                      dashed line lands at the same height across the row and
                      reads as one reference line, not fourteen disconnected
                      ones. Line.tsx's own per-cell version of this technique
                      (its old StationBar) was replaced on 23 Sep 2026 by one
                      comparative chart (StationCompare) — this Wall board is
                      a fixed TV layout with no room for that, so its per-cell
                      dashed line is unchanged. */}
                  <span className="bar-median" style={{ bottom: `calc(var(--bar-max) * ${rowMedianRatio.toFixed(4)})` }} />
                </span>
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
          {/* The pulse stops when the board is blind, for the same reason it
              stops when the readings are stale: motion on a TV reads as
              "this is live". */}
          <span className={`dot live${health.kind === 'stale' || outOfContact ? ' bad' : health.kind === 'late' ? ' warn' : ''}`} />
          {/* Out of contact REPLACES the lag sentence rather than sitting
              beside it. "Readings to 10:59 AM · they reach this system about
              17 min after weighing" is the all-clear, and printing it next to
              an outage notice invites reading the reassuring half. */}
          {outOfContact ? W.offline : lagSentence(line, health)}
        </span>
        <span>
          {line.lastSack && `${W.lastSack} ${fmtKg(line.lastSack.weightKg)} ${fmtClock(line.lastSack.ts)}`}
          {line.lastCone &&
            ` · ${W.lastCone} ${fmtG(line.lastCone.weightG)} ${fmtClock(line.lastCone.ts)}`}
          {/* Below the out-of-contact threshold a single missed poll still gets
              said, quietly, here — where it has always been said. Above it the
              lag line above carries the same words, so it is not said twice. */}
          {error && !outOfContact && ` · ${W.offline}`}
          {/* UX Phase 7 Brief 1: a failed roster/attention fetch used to be
              invisible here — the board just quietly drew fewer bars, which
              on a TV nobody is retrying reads as "that station is fine"
              rather than "the roster failed to load". One sentence, no new
              skeleton, no layout change (see the file header on why). */}
          {((stations.error && !stations.data) || (attention.error && !attention.data)) &&
            ` · ${W.wallBoardIncomplete}`}
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
 * What to call the line in the state sentence: its display name, verbatim.
 *
 * Until roadmap Phase 1 (14 Sep 2026) this split LINE_NAME on '·' to find
 * the segment that said "Line", because the env string was a whole address.
 * The name is a row now (sms.line.display_name, edited in Setup › Line), the
 * plant and unit are their own fields and are printed in the board's header
 * above this sentence, so the sentence carries only the line.
 */
function lineTitle(line: LiveLine): string {
  return line.lineShortName || line.lineName;
}
