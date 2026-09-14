import { describe, it, expect } from 'vitest';
import {
  shiftWindowAt,
  classifyLineState,
  STOP_THRESHOLD_SECONDS,
  IDLE_THRESHOLD_SECONDS,
  MAX_CREDIBLE_LAG_SECONDS,
} from './live.js';

const t = (s: string) => new Date(s).getTime();

describe('shiftWindowAt', () => {
  it('morning: 06:00–14:00 on the same production day', () => {
    const w = shiftWindowAt(t('2026-07-09T10:30:00Z'), 'start_day');
    expect(w.code).toBe('morning');
    expect(w.shiftDate).toBe('2026-07-09');
    expect(new Date(w.startMs).toISOString()).toBe('2026-07-09T06:00:00.000Z');
    expect(new Date(w.endMs).toISOString()).toBe('2026-07-09T14:00:00.000Z');
  });

  it('evening starts exactly at 14:00', () => {
    const w = shiftWindowAt(t('2026-07-09T14:00:00Z'), 'start_day');
    expect(w.code).toBe('evening');
    expect(new Date(w.startMs).toISOString()).toBe('2026-07-09T14:00:00.000Z');
    expect(new Date(w.endMs).toISOString()).toBe('2026-07-09T22:00:00.000Z');
  });

  it('night before midnight belongs to its own date under both rules', () => {
    for (const rule of ['start_day', 'calendar_day'] as const) {
      const w = shiftWindowAt(t('2026-07-09T23:15:00Z'), rule);
      expect(w.code).toBe('night');
      expect(w.shiftDate).toBe('2026-07-09');
      expect(new Date(w.startMs).toISOString()).toBe('2026-07-09T22:00:00.000Z');
      expect(new Date(w.endMs).toISOString()).toBe('2026-07-10T06:00:00.000Z');
    }
  });

  it('night after midnight: start_day keeps yesterday, calendar_day moves on', () => {
    const a = shiftWindowAt(t('2026-07-10T02:00:00Z'), 'start_day');
    expect(a.code).toBe('night');
    expect(a.shiftDate).toBe('2026-07-09');
    expect(new Date(a.startMs).toISOString()).toBe('2026-07-09T22:00:00.000Z');
    const b = shiftWindowAt(t('2026-07-10T02:00:00Z'), 'calendar_day');
    expect(b.shiftDate).toBe('2026-07-10');
    expect(b.startMs).toBe(a.startMs);
  });

  it('05:59 is still night; 06:00 is morning', () => {
    expect(shiftWindowAt(t('2026-07-10T05:59:00Z'), 'start_day').code).toBe('night');
    expect(shiftWindowAt(t('2026-07-10T06:00:00Z'), 'start_day').code).toBe('morning');
  });

  /**
   * Roadmap Phase 1 (14 Sep 2026): the boundaries are the line's shift rule,
   * not the 06/14/22 constant. With starts at 08:00 / 16:00 / 22:00 the
   * shifts are no longer equal, so each must end where the next begins.
   */
  describe('with a configured rule of 08:00 / 16:00 / 22:00', () => {
    const b = { morningStart: 8 * 60, eveningStart: 16 * 60, nightStart: 22 * 60 };

    it('07:30 is night, and its window began at 22:00 the previous day', () => {
      const w = shiftWindowAt(t('2026-07-10T07:30:00Z'), 'start_day', b);
      expect(w.code).toBe('night');
      expect(new Date(w.startMs).toISOString()).toBe('2026-07-09T22:00:00.000Z');
      expect(new Date(w.endMs).toISOString()).toBe('2026-07-10T08:00:00.000Z');
      expect(w.shiftDate).toBe('2026-07-09');
      expect(shiftWindowAt(t('2026-07-10T07:30:00Z'), 'calendar_day', b).shiftDate).toBe('2026-07-10');
    });

    it('morning runs 08:00–16:00 and evening 16:00–22:00 (six hours, not eight)', () => {
      const m = shiftWindowAt(t('2026-07-10T08:00:00Z'), 'start_day', b);
      expect(m.code).toBe('morning');
      expect(new Date(m.startMs).toISOString()).toBe('2026-07-10T08:00:00.000Z');
      expect(new Date(m.endMs).toISOString()).toBe('2026-07-10T16:00:00.000Z');
      const e = shiftWindowAt(t('2026-07-10T21:59:00Z'), 'start_day', b);
      expect(e.code).toBe('evening');
      expect(new Date(e.startMs).toISOString()).toBe('2026-07-10T16:00:00.000Z');
      expect(new Date(e.endMs).toISOString()).toBe('2026-07-10T22:00:00.000Z');
    });

    it('night after 22:00 ends at the next morning start', () => {
      const w = shiftWindowAt(t('2026-07-10T23:00:00Z'), 'start_day', b);
      expect(w.code).toBe('night');
      expect(new Date(w.endMs).toISOString()).toBe('2026-07-11T08:00:00.000Z');
    });

    it('07:30 under the DEFAULT rule is morning — the same instant, a different shift', () => {
      expect(shiftWindowAt(t('2026-07-10T07:30:00Z'), 'start_day').code).toBe('morning');
    });
  });
});

describe('classifyLineState', () => {
  const now = t('2026-07-09T10:00:00Z');
  const MIN = 60_000;

  it('no cones ever → no_data', () => {
    expect(classifyLineState(null, now)).toEqual({
      status: 'no_data', sinceLastReadingSeconds: null, behindSeconds: null,
    });
  });

  it('with no lag, a recent cone is running and an old one is stopped', () => {
    expect(classifyLineState(now - 30_000, now)).toEqual({
      status: 'running', sinceLastReadingSeconds: 30, behindSeconds: 30,
    });
    expect(classifyLineState(now - STOP_THRESHOLD_SECONDS * 1000, now).status).toBe('running');
    expect(classifyLineState(now - 300_000, now).status).toBe('stopped');
  });

  /**
   * The regression the 2 Sep 2026 live rehearsal found. IFL's acquisition layer
   * writes a row ~18 minutes after the cone is weighed, so a perfectly healthy
   * line's newest reading is ALWAYS about 18 minutes old. Judged against the
   * wall clock that reads as a permanent stoppage.
   */
  it('a running line whose newest reading is one acquisition lag old reads as RUNNING', () => {
    const lag = 18 * MIN;
    const s = classifyLineState(now - lag, now, lag);
    expect(s.status).toBe('running');
    expect(s.behindSeconds).toBe(0);
    // The wall-clock age is still reported, because that is what a person sees.
    expect(s.sinceLastReadingSeconds).toBe(18 * 60);
  });

  it('without the lag the same line would have read as stopped', () => {
    const lag = 18 * MIN;
    expect(classifyLineState(now - lag, now, 0).status).toBe('stopped');
  });

  it('a genuine stop is still caught, and measured net of the lag', () => {
    const lag = 18 * MIN;
    // Weighed 25 minutes ago: 18 of those are the pipeline, 7 are a real stop.
    const s = classifyLineState(now - 25 * MIN, now, lag);
    expect(s.status).toBe('stopped');
    expect(s.behindSeconds).toBe(7 * 60);
    expect(s.sinceLastReadingSeconds).toBe(25 * 60);
  });

  it('an implausible lag cannot mask a stopped line forever', () => {
    const absurd = 40 * 86_400_000;
    expect(classifyLineState(now - 30 * 86_400_000, now, absurd).status).not.toBe('running');
    expect(classifyLineState(now - 30 * 86_400_000, now, MAX_CREDIBLE_LAG_SECONDS * 1000).status).toBe('idle');
  });

  it('longer than a whole shift behind → idle, not a stoppage', () => {
    expect(classifyLineState(now - 9 * 3600 * 1000, now).status).toBe('idle');
    expect(classifyLineState(now - 54 * 86_400_000, now).status).toBe('idle');
    expect(classifyLineState(now - IDLE_THRESHOLD_SECONDS * 1000, now).status).toBe('stopped');
  });

  it('a reading stamped slightly ahead of the clock counts as just now', () => {
    expect(classifyLineState(now + 5_000, now)).toEqual({
      status: 'running', sinceLastReadingSeconds: 0, behindSeconds: 0,
    });
  });
});
