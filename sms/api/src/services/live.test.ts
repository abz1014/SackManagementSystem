import { describe, it, expect } from 'vitest';
import { shiftWindowAt, classifyLineState, STOP_THRESHOLD_SECONDS, IDLE_THRESHOLD_SECONDS } from './live.js';

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
});

describe('classifyLineState', () => {
  const now = t('2026-07-09T10:00:00Z');
  it('no cones ever → no_data', () => {
    expect(classifyLineState(null, now)).toEqual({ status: 'no_data', seconds: null });
  });
  it('a cone inside the stop threshold → running', () => {
    expect(classifyLineState(now - 30_000, now)).toEqual({ status: 'running', seconds: 30 });
    expect(classifyLineState(now - STOP_THRESHOLD_SECONDS * 1000, now).status).toBe('running');
  });
  it('past the threshold but within a shift → stopped', () => {
    expect(classifyLineState(now - 300_000, now)).toEqual({ status: 'stopped', seconds: 300 });
    expect(classifyLineState(now - IDLE_THRESHOLD_SECONDS * 1000, now).status).toBe('stopped');
  });
  it('longer than a whole shift → idle, not a stoppage', () => {
    expect(classifyLineState(now - 9 * 3600 * 1000, now).status).toBe('idle');
    expect(classifyLineState(now - 54 * 86_400_000, now).status).toBe('idle');
  });
  it('a reading stamped slightly ahead of the clock counts as just now', () => {
    expect(classifyLineState(now + 5_000, now)).toEqual({ status: 'running', seconds: 0 });
  });
});
