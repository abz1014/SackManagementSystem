import { describe, expect, it } from 'vitest';
import { getRange } from './api';
import { period } from './lib';
import { W } from './words';

describe('bridge', () => {
  it('re-exports existing web code', () => {
    expect(typeof getRange).toBe('function');
    expect(typeof period.resolvePeriod).toBe('function');
    expect(W).toBeDefined();
  });
});
