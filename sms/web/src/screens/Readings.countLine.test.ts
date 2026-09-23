/**
 * The Readings headline states two counts that must agree. They come from
 * two independent polls, so at any instant they can be in different states —
 * and before 23 Sep 2026 both reached the sentence as plain numbers,
 * defaulted with `?? 0` at the call site. "Not loaded yet" and "genuinely
 * none" were the same value, so a half-loaded screen printed
 *
 *     0 weighed, 402 rejected by the scale (0%)
 *
 * which is not a state that can exist. (Observed in a browser, Readings ›
 * This month, 1366×768 — see `web/src/sheet.remount.test.tsx` for the full
 * capture and for the remount that made it happen on every drilldown click.)
 *
 * `CountState` is what makes it unrepresentable: there is no way to hand
 * `countLine` a number it was not told, and the combined
 * "N weighed, M rejected (P%)" sentence is reachable only when BOTH counts
 * are `ok`. These cases walk every pair.
 */
import { describe, it, expect } from 'vitest';
import { countLine, countStateOf, type CountState } from './Readings';
import { W } from '../lib/words';
import type { Period } from '../lib/period';

const PERIOD = {
  from: '2026-09-01', to: '2026-09-23', shift: null, live: false,
} as unknown as Period;

const ok = (n: number): CountState => ({ kind: 'ok', n });
const pending: CountState = { kind: 'pending' };
const failed: CountState = { kind: 'failed' };

const line = (total: CountState, rejected: CountState) =>
  countLine(PERIOD, 'cones', total, rejected, false, []);

describe('countStateOf', () => {
  it('a number, however small, is a real count', () => {
    expect(countStateOf(null, 0)).toEqual({ kind: 'ok', n: 0 });
    expect(countStateOf(null, 402)).toEqual({ kind: 'ok', n: 402 });
  });
  it('no number and no error is pending, not zero', () => {
    expect(countStateOf(null, undefined)).toEqual({ kind: 'pending' });
  });
  it('no number and an error is failed', () => {
    expect(countStateOf('ECONNREFUSED', undefined)).toEqual({ kind: 'failed' });
  });
  it('data wins over a later transient error — usePolling keeps the last good value', () => {
    expect(countStateOf('ECONNREFUSED', 402)).toEqual({ kind: 'ok', n: 402 });
  });
});

describe('countLine never states a count it was not given', () => {
  it('both pending: says it is counting, states no number', () => {
    const s = line(pending, pending);
    expect(s).toContain(W.readings.countLinePending);
    expect(s).not.toMatch(/\d+ weighed/);
  });

  it('THE DEFECT: register pending, reject count landed — no "0 weighed", no 402', () => {
    const s = line(pending, ok(402));
    expect(s).not.toContain('0 weighed');
    expect(s).not.toContain('402');
    expect(s).not.toContain('0%');
    expect(s).toContain(W.readings.countLinePending);
  });

  it('register landed, reject count still in flight: states what is known', () => {
    const s = line(ok(1000), pending);
    expect(s).toContain('1,000 weighed');
    expect(s).toContain('still counting');
    // No rate, because one side of it is unknown.
    expect(s).not.toContain('%');
  });

  it('register landed, reject count failed: names the failure, does not print 0', () => {
    const s = line(ok(1000), failed);
    expect(s).toBe(`2026-09-01 to 2026-09-23: ${W.readings.countLineRejectUnknown('1,000')}`);
    expect(s).not.toContain('0 rejected');
  });

  it('register failed: the whole sentence is replaced', () => {
    expect(line(failed, ok(402))).toBe(W.readings.countLineFailed);
    expect(line(failed, pending)).toBe(W.readings.countLineFailed);
  });

  it('both real: the ordinary sentence, with the rate', () => {
    expect(line(ok(1000), ok(402))).toContain(W.readings.countLine('1,000', '402', '40.2%'));
  });

  it('both real and genuinely empty: zero is a legitimate answer', () => {
    expect(line(ok(0), ok(0))).toContain(W.readings.countLine('0', '0', '0%'));
  });

  it('both real but none weighed and some rejected: states both, claims no rate', () => {
    // Only reachable from the API itself now. If it ever shows, the
    // contradiction is in the data, not in the fetch — so it is stated, not
    // smoothed over with a "(0%)" that 402-out-of-0 does not mean.
    const s = line(ok(0), ok(402));
    expect(s).toContain(W.readings.countLineNoRate('0', '402'));
    expect(s).not.toContain('%');
  });
});
