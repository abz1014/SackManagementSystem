import { describe, it, expect } from 'vitest';
import { loadAppConfig, interpretWeight } from './appConfig.js';

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
