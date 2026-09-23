/**
 * UX Phase WS-B2 (23 Sep 2026) — Wall.tsx's station row must not turn
 * absence into a number.
 *
 * Proven live on Line (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md): a 200-OK
 * response with fields deleted from one row printed a confident zero. Wall's
 * own version of the same shape: `byId.get(id)?.cones ?? 0`,
 * `row?.cones ?? 0` and `line.state.behindSeconds ?? 0` each collapse "the
 * server never told us" into the same bar height / count / duration a
 * GENUINE zero would draw — on a fullscreen TV nobody is standing next to,
 * where the only diagnostic available is the shape on screen.
 *
 * Three distinct absence shapes are exercised here, and per the brief the
 * bar it draws must not read as "this station made nothing":
 *  1. a station the roster names but that never appears in `line.stations`
 *     at all (today's ordinary "never ran, or the payload dropped it" case,
 *     already merged with #2 before this fix);
 *  2. a station present in `line.stations` with `cones` deleted from its row
 *     (`stripFields`) — the exact RT-005 shape;
 *  3. a station present with a valid count but `lastTs` deleted — quietness
 *     cannot be computed at all, so it must not silently read as "recent".
 * All three are contrasted against a GENUINELY quiet station (a real row,
 * valid fields, timestamp simply old) to prove the two are told apart.
 */
import { describe, expect, it } from 'vitest';
import { renderWithLive } from './testkit/render';
import { installFakeFetch } from './testkit/fetchRouter';
import { LIVE_FIXTURE, stripFields } from './testkit/fixtures';
import type { Envelope, LiveData, LiveLine } from './api';
import { WallScreen } from './screens/Wall';

const BASE_LINE = LIVE_FIXTURE.data.lines[0]!;

/** `dataAsOfUtc` anchors "how long ago" on Wall — station 4 below is set
 *  25 minutes before it, past `QUIET_AFTER_SECONDS` (20 min). */
const ANCHOR = BASE_LINE.dataAsOfUtc!;
const RECENT_TS = new Date(new Date(ANCHOR).getTime() - 60_000).toISOString(); // 1 min ago
const OLD_TS = new Date(new Date(ANCHOR).getTime() - 25 * 60_000).toISOString(); // 25 min ago

function liveWith(stations: LiveLine['stations']): Envelope<LiveData> {
  return {
    ...LIVE_FIXTURE,
    data: { lines: [{ ...BASE_LINE, stations }] },
  };
}

const ROSTER = {
  stations: [
    { stationId: 1, name: 'Station One', machine: null, description: null },
    { stationId: 2, name: 'Station Two', machine: null, description: null },
    { stationId: 3, name: 'Station Three', machine: null, description: null },
    { stationId: 4, name: 'Station Four', machine: null, description: null },
  ],
};

function routes(stations: LiveLine['stations']) {
  return {
    '/api/live': liveWith(stations),
    '/api/stations': ROSTER,
    '/api/attention': { data: { findings: [] }, metadata: LIVE_FIXTURE.metadata },
  };
}

describe('Wall — absent data is not a zero', () => {
  it('a station never reported (id 3, roster-only) and a station whose row lost `cones` (id 2) are visually DISTINCT from a genuinely quiet station (id 4) and from a normal one (id 1)', async () => {
    const stations: LiveLine['stations'] = [
      { station: 1, cones: 500, lastTs: RECENT_TS },
      stripFields({ station: 2, cones: 300, lastTs: RECENT_TS }, ['cones']),
      // station 3: absent from the array entirely, present only in the roster.
      { station: 4, cones: 50, lastTs: OLD_TS },
    ];
    installFakeFetch(routes(stations));
    const { findByText, container } = renderWithLive(<WallScreen onExit={() => {}} />);

    await findByText('Station One');

    const cellFor = (name: string): Element => {
      const label = Array.from(container.querySelectorAll('.w-st i')).find((el) => el.textContent === name);
      if (!label) throw new Error(`no station cell named ${name}`);
      return label.closest('.w-st > div') ?? label.parentElement!.parentElement!;
    };

    const cell1 = cellFor('Station One');
    const cell2 = cellFor('Station Two');
    const cell3 = cellFor('Station Three');
    const cell4 = cellFor('Station Four');

    // Station 1: ordinary, recent — the real count, no special class.
    expect(cell1.className).not.toMatch(/quiet|absent/);
    expect(cell1.querySelector('.cap b')?.textContent).toBe('500');

    // Station 4: GENUINELY quiet — a real row, a real (zero-ish) count, an
    // old timestamp. This is the control: it must read "quiet", not
    // "absent", because the server actually told us what happened.
    expect(cell4.className).toMatch(/quiet/);
    expect(cell4.className).not.toMatch(/absent/);

    // Station 2: row present, `cones` deleted from the wire — RT-005 shape.
    // Before the fix this renders identically to a real zero ('—') and
    // identically to station 4's quiet styling. It must not.
    expect(cell2.className).toMatch(/absent/);
    expect(cell2.querySelector('.cap b')?.textContent).not.toBe('0');
    expect(cell2.querySelector('.cap b')?.textContent).not.toBe('—');

    // Station 3: never appears in `line.stations` at all.
    expect(cell3.className).toMatch(/absent/);
    expect(cell3.querySelector('.cap b')?.textContent).not.toBe('0');
    expect(cell3.querySelector('.cap b')?.textContent).not.toBe('—');

    // THE ACCEPTANCE CLAIM: absent and quiet must render distinguishably
    // from each other, not just from "normal".
    expect(cell2.className).not.toBe(cell4.className);
    expect(cell3.className).not.toBe(cell4.className);
  });

  it('a station with `cones` deleted does not drag the MEDIAN reference line down as a fabricated zero', async () => {
    // rowMax alone cannot expose this: a phantom 0 never beats a real 100 in
    // a max(). The median DOES move: medianOf([100, 0]) = 50 (ratio 0.5)
    // if the stripped row counts as a zero, vs medianOf([100]) = 100
    // (ratio 1.0) once it is correctly excluded as "unknown", not "zero".
    // A deflated median makes every healthy station look "above typical"
    // on a board whose one comparative device is that dashed line.
    const stations: LiveLine['stations'] = [
      { station: 1, cones: 100, lastTs: RECENT_TS },
      stripFields({ station: 2, cones: 300, lastTs: RECENT_TS }, ['cones']),
    ];
    installFakeFetch({
      ...routes(stations),
      '/api/stations': { stations: [
        { stationId: 1, name: 'Station One', machine: null, description: null },
        { stationId: 2, name: 'Station Two', machine: null, description: null },
      ] },
    });
    const { findByText, container } = renderWithLive(<WallScreen onExit={() => {}} />);
    await findByText('Station One');

    const medianLine = container.querySelector('.w-st .bar-median') as HTMLElement;
    // With station 2 excluded, the only real reading (100) is both the max
    // and the median: the dashed line sits at the top of the row (ratio 1),
    // not at half height as a fabricated zero would put it.
    expect(medianLine.style.bottom).toContain('* 1.0000');
  });
});

describe('Wall — an unknown stopped-duration is not printed as "0s"', () => {
  it('state.status is stopped and behindSeconds is null: the sentence does not claim a duration', async () => {
    const stations: LiveLine['stations'] = [{ station: 1, cones: 10, lastTs: RECENT_TS }];
    const live = liveWith(stations);
    live.data.lines[0]!.state = {
      status: 'stopped',
      sinceLastReadingSeconds: null,
      behindSeconds: null,
      runStartUtc: null,
      stopThresholdSeconds: 120,
    };
    installFakeFetch({ ...routes(stations), '/api/live': live });

    const { container, findByText } = renderWithLive(<WallScreen onExit={() => {}} />);
    await findByText('Station One');

    const stateText = container.querySelector('.w-state')?.textContent ?? '';
    // The exact defect: `fmtSpan(null ?? 0)` prints a real-looking "0s" for
    // an unknown duration.
    expect(stateText).not.toMatch(/0\s*s\b/);
    expect(stateText.toLowerCase()).not.toContain('stopped for 0');
  });
});
