/**
 * assessHealth must only ever answer 'ok' when the server said 'ok'.
 *
 * Before 25 Sep 2026 the switch's `default` branch returned 'ok', and it was
 * reached not only by the server's own 'ok' but by ANY other value — most
 * reachably `undefined`, when a `/api/live` line arrives without its
 * `health` object at all (a partial 200). `stateIsKnowable` then read true
 * and every screen asserted running/stopped from a payload that carried no
 * health verdict — the same false-all-clear class the red-team found in
 * SyncHealthBlock's own verdict the same day. The conservative answer for an
 * unrecognised or missing kind, when a reading does exist, is 'lag_unknown':
 * a reading is on screen, and the line's state may not be asserted.
 */
import { describe, expect, it } from 'vitest';
import { assessHealth, stateIsKnowable } from './health';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import type { LiveLine } from '../api';

const base = LIVE_FIXTURE.data.lines[0]! as LiveLine;

function withHealth(health: unknown): LiveLine {
  return { ...base, dataAsOfUtc: base.dataAsOfUtc ?? '2026-09-07T12:00:00.000Z', health } as unknown as LiveLine;
}

describe('assessHealth — only an explicit server "ok" is ok', () => {
  it('the server\'s own ok is ok (two-sided partner)', () => {
    const h = assessHealth(withHealth({ ...base.health, kind: 'ok' }));
    expect(h.kind).toBe('ok');
    expect(stateIsKnowable(h)).toBe(true);
  });

  it('a line with no health object at all is NOT ok', () => {
    const h = assessHealth(withHealth(undefined));
    expect(h.kind).not.toBe('ok');
    expect(stateIsKnowable(h)).toBe(false);
  });

  it('an unrecognised kind is NOT ok', () => {
    const h = assessHealth(withHealth({ kind: 'halted', ageSeconds: 5 }));
    expect(h.kind).not.toBe('ok');
    expect(stateIsKnowable(h)).toBe(false);
  });
});
