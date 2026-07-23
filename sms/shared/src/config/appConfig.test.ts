import { describe, it, expect } from 'vitest';
import { loadAppConfig, interpretWeight } from './appConfig.js';
import {
  shiftCodeFromLocalTime,
  shiftDateFromLocalTime,
} from '../domain/shift.js';

describe('appConfig defaults (honest, not assumed)', () => {
  it('defaults to as_recorded weight + corrected shift on empty env', () => {
    const cfg = loadAppConfig({} as NodeJS.ProcessEnv);
    expect(cfg.weight.basis).toBe('as_recorded');
    expect(cfg.shift.mode).toBe('corrected');
    expect(cfg.shift.nightBelongsTo).toBe('start_day');
    expect(cfg.lineId).toBe(1);
  });

  it('rejects an invalid weight basis rather than guessing', () => {
    expect(() =>
      loadAppConfig({ WEIGHT_BASIS: 'kilos' } as unknown as NodeJS.ProcessEnv),
    ).toThrow();
  });
});

describe('interpretWeight (Q4/Q5 — read-time interpretation)', () => {
  const w = { basis: 'as_recorded', coneTubeWeightG: 70, sackTareKg: 0.5 } as const;

  it('returns raw value under as_recorded', () => {
    expect(interpretWeight(1951, 'cone', w)).toBe(1951);
  });

  it('subtracts tube weight under net', () => {
    expect(interpretWeight(1951, 'cone', { ...w, basis: 'net' })).toBe(1881);
    expect(interpretWeight(47.3, 'sack', { ...w, basis: 'net' })).toBeCloseTo(46.8);
  });

  it('never returns a negative from a garbage reading', () => {
    expect(interpretWeight(30, 'cone', { ...w, basis: 'net' })).toBe(30);
  });
});

describe('shift derivation (Q7/Q8)', () => {
  it('maps times to confirmed boundaries', () => {
    expect(shiftCodeFromLocalTime(new Date(2026, 6, 5, 8, 0))).toBe('morning');
    expect(shiftCodeFromLocalTime(new Date(2026, 6, 5, 15, 0))).toBe('evening');
    expect(shiftCodeFromLocalTime(new Date(2026, 6, 5, 23, 0))).toBe('night');
    expect(shiftCodeFromLocalTime(new Date(2026, 6, 5, 2, 0))).toBe('night');
  });

  it('night after midnight belongs to previous day under start_day', () => {
    const d = shiftDateFromLocalTime(new Date(2026, 6, 8, 2, 0), 'start_day');
    expect(d).toEqual({ year: 2026, month: 7, day: 7 });
  });

  it('night after midnight keeps its own date under calendar_day', () => {
    const d = shiftDateFromLocalTime(new Date(2026, 6, 8, 2, 0), 'calendar_day');
    expect(d).toEqual({ year: 2026, month: 7, day: 8 });
  });
});
