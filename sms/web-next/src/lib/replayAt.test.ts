import { describe, expect, it } from 'vitest';
import { normalizeAt } from './replayAt';

describe('normalizeAt (plant wall time labelled UTC)', () => {
  it('no value is no replay', () => {
    expect(normalizeAt(null)).toEqual({ kind: 'none' });
    expect(normalizeAt('')).toEqual({ kind: 'none' });
  });
  it('appends Z to a zone-less value and keeps a Z one', () => {
    expect(normalizeAt('2026-10-13T15:30:00.000')).toEqual({ kind: 'ok', value: '2026-10-13T15:30:00.000Z' });
    expect(normalizeAt('2026-10-13T15:30:00')).toEqual({ kind: 'ok', value: '2026-10-13T15:30:00Z' });
    expect(normalizeAt('2026-10-13T15:30')).toEqual({ kind: 'ok', value: '2026-10-13T15:30:00Z' });
    expect(normalizeAt('2026-10-13 15:30')).toEqual({ kind: 'ok', value: '2026-10-13T15:30:00Z' });
    expect(normalizeAt('2026-10-13T15:30:00Z')).toEqual({ kind: 'ok', value: '2026-10-13T15:30:00Z' });
  });
  it('names garbage and impossible dates as unreadable', () => {
    expect(normalizeAt('tomorrow')).toEqual({ kind: 'bad', raw: 'tomorrow' });
    expect(normalizeAt('2026-02-31T10:00:00')).toEqual({ kind: 'bad', raw: '2026-02-31T10:00:00' });
    expect(normalizeAt('2026-10-13T25:00:00')).toEqual({ kind: 'bad', raw: '2026-10-13T25:00:00' });
    expect(normalizeAt('2026-10-13T15:30:00+05:00')).toEqual({ kind: 'bad', raw: '2026-10-13T15:30:00+05:00' });
  });
});
