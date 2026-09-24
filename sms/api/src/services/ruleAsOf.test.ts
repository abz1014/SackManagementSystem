/**
 * RT24-04: the pure history-selection logic behind time-versioned rule reads.
 * No DB — `ruleAsOf`/`ruleChangesWithin` are given a history array directly,
 * the same shape the DB-backed loaders in ruleAsOf.ts build.
 */
import { describe, expect, it } from 'vitest';
import { ruleAsOf, ruleChangesWithin, plantDayStartMs, plantDayEndMs, type RuleVersion } from './ruleAsOf.js';

const T = (iso: string) => new Date(iso).getTime();

// Newest-first, matching `ORDER BY effective_from DESC`.
const history: RuleVersion<{ label: string }>[] = [
  { effectiveFromMs: T('2026-08-20T00:00:00.000Z'), value: { label: 'v3' } },
  { effectiveFromMs: T('2026-08-10T00:00:00.000Z'), value: { label: 'v2' } },
  { effectiveFromMs: T('2026-08-01T00:00:00.000Z'), value: { label: 'v1' } },
];

describe('ruleAsOf', () => {
  it('returns the newest version whose effective_from is at or before the instant', () => {
    expect(ruleAsOf(history, T('2026-08-05T00:00:00.000Z')).label).toBe('v1');
    expect(ruleAsOf(history, T('2026-08-15T00:00:00.000Z')).label).toBe('v2');
    expect(ruleAsOf(history, T('2026-08-25T00:00:00.000Z')).label).toBe('v3');
  });

  it('is inclusive at the exact boundary — the new version is in force AT its own effective_from', () => {
    expect(ruleAsOf(history, T('2026-08-10T00:00:00.000Z')).label).toBe('v2');
    expect(ruleAsOf(history, T('2026-08-20T00:00:00.000Z')).label).toBe('v3');
  });

  it('falls back to the OLDEST version for an instant that predates every known version', () => {
    expect(ruleAsOf(history, T('2026-01-01T00:00:00.000Z')).label).toBe('v1');
  });

  it('a single-version history answers every instant with that one version', () => {
    const one = [history[2]!];
    expect(ruleAsOf(one, T('2020-01-01T00:00:00.000Z')).label).toBe('v1');
    expect(ruleAsOf(one, T('2030-01-01T00:00:00.000Z')).label).toBe('v1');
  });
});

describe('ruleChangesWithin', () => {
  it('true when a version falls strictly after the start and at/before the end', () => {
    expect(ruleChangesWithin(history, T('2026-08-01T00:00:00.000Z'), T('2026-08-10T00:00:00.000Z'))).toBe(true);
    expect(ruleChangesWithin(history, T('2026-08-01T00:00:00.000Z'), T('2026-08-20T00:00:00.000Z'))).toBe(true);
  });

  it('false when no version falls in the window', () => {
    expect(ruleChangesWithin(history, T('2026-08-11T00:00:00.000Z'), T('2026-08-19T00:00:00.000Z'))).toBe(false);
  });

  it('false when the window is entirely before the oldest version, or entirely after the newest', () => {
    expect(ruleChangesWithin(history, T('2026-01-01T00:00:00.000Z'), T('2026-01-15T00:00:00.000Z'))).toBe(false);
    expect(ruleChangesWithin(history, T('2026-09-01T00:00:00.000Z'), T('2026-09-15T00:00:00.000Z'))).toBe(false);
  });
});

describe('plantDayStartMs / plantDayEndMs', () => {
  it('a day runs from its own 00:00 to the next day’s 00:00, on the plant-labelled convention', () => {
    expect(plantDayStartMs('2026-08-18')).toBe(T('2026-08-18T00:00:00.000Z'));
    expect(plantDayEndMs('2026-08-18')).toBe(T('2026-08-19T00:00:00.000Z'));
    expect(plantDayEndMs('2026-08-18') - plantDayStartMs('2026-08-18')).toBe(86_400_000);
  });
});
