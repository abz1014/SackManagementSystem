import { describe, expect, it } from 'vitest';
import {
  fmtAppDate, fmtAppDateTime, fmtAppTime, fmtDate, fmtDateTime, fmtDayShort, fmtInt, fmtRange, fmtTime, fmtTimeSec,
} from './fmt';

describe('plant-clock formats', () => {
  it('prints the redesign shapes', () => {
    expect(fmtDate('2026-09-01T21:33:02Z')).toBe('1 Sep 2026');
    expect(fmtDateTime('2026-09-01T21:33:02Z')).toBe('1 Sep 2026, 21:33');
    expect(fmtTime('2026-09-01T21:33:02Z')).toBe('21:33');
    expect(fmtTimeSec('2026-09-01T21:33:02Z')).toBe('21:33:02');
    expect(fmtDayShort('2026-09-01T21:33:02Z')).toBe('Tue 1 Sep');
    expect(fmtRange('2026-08-05', '2026-09-07')).toBe('5 Aug 2026 – 7 Sep 2026');
  });
  it('never says Sept or AM/PM, and is 24-hour at both ends of the day', () => {
    for (const iso of ['2026-09-01T00:00:00Z', '2026-09-01T23:59:00Z', '2026-09-01T12:05:00Z']) {
      const s = `${fmtDateTime(iso)} ${fmtTimeSec(iso)}`;
      expect(s).not.toMatch(/Sept| [AP]M/);
    }
    expect(fmtTime('2026-09-01T00:00:00Z')).toBe('00:00');
    expect(fmtTime('2026-09-01T23:59:00Z')).toBe('23:59');
  });
  it('takes a bare production day as that day', () => {
    expect(fmtDate('2026-09-01')).toBe('1 Sep 2026');
    expect(fmtDayShort('2026-12-31')).toBe('Thu 31 Dec');
  });
  it('a single-day range is one date; bad input is a dash', () => {
    expect(fmtRange('2026-09-01', '2026-09-01T23:00:00Z')).toBe('1 Sep 2026');
    expect(fmtDate('nonsense')).toBe('–');
  });
  it('is independent of the viewer zone', () => {
    const before = process.env.TZ;
    const out: string[] = [];
    try {
      for (const tz of ['UTC', 'Asia/Karachi', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        out.push(fmtDateTime('2026-09-01T23:59:00Z'));
      }
    } finally {
      process.env.TZ = before;
    }
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toBe('1 Sep 2026, 23:59');
  });
});

describe('app-instant formats follow the viewer zone', () => {
  it('reads local fields', () => {
    const d = new Date(2026, 8, 1, 21, 33, 2);
    expect(fmtAppDate(d)).toBe('1 Sep 2026');
    expect(fmtAppDateTime(d)).toBe('1 Sep 2026, 21:33');
    expect(fmtAppTime(d)).toBe('21:33');
  });
});

describe('number helpers are re-exported', () => {
  it('fmtInt groups thousands', () => expect(fmtInt(3089)).toMatch(/3.?089/));
});
