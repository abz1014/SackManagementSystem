import { describe, it, expect } from 'vitest';
import { wallClockOf, shiftCodeOf, shiftDateOf, normalizeLegacyShift } from './wallClock.js';
import { assignMergeKeys } from './transform.js';

// mssql with useUTC=true returns a stored '2026-07-10 11:23:10' as this Date:
const dt = (iso: string) => new Date(iso + 'Z'); // wall clock as UTC

describe('wallClock (tz-safe shift derivation)', () => {
  it('reads wall-clock parts via UTC accessors', () => {
    const wc = wallClockOf(dt('2026-07-10T11:23:10'));
    expect(wc.minuteOfDay).toBe(11 * 60 + 23);
    expect([wc.y, wc.mo, wc.d]).toEqual([2026, 7, 10]);
  });

  it('buckets shifts on confirmed boundaries', () => {
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T08:00:00')))).toBe('morning');
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T14:00:00')))).toBe('evening');
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T22:00:00')))).toBe('night');
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T02:00:00')))).toBe('night');
  });

  it('night after midnight belongs to previous day (start_day)', () => {
    const d = shiftDateOf(wallClockOf(dt('2026-07-08T02:00:00')), 'start_day');
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-07');
  });

  it('night after midnight keeps its date (calendar_day)', () => {
    const d = shiftDateOf(wallClockOf(dt('2026-07-08T02:00:00')), 'calendar_day');
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-08');
  });

  it('normalises legacy shift strings', () => {
    expect(normalizeLegacyShift('Morning')).toBe('morning');
    expect(normalizeLegacyShift(null)).toBe(null);
  });
});

describe('assignMergeKeys (DQ-2 collision handling)', () => {
  it('flags collisions and assigns stable seq by source_row_id', () => {
    const rows = [
      { source_row_id: 5, ingest_seq: 0, merge_key_is_unique: true, k: 'A' },
      { source_row_id: 2, ingest_seq: 0, merge_key_is_unique: true, k: 'A' },
      { source_row_id: 9, ingest_seq: 0, merge_key_is_unique: true, k: 'B' },
    ];
    assignMergeKeys(rows, (r) => r.k);
    const a = rows.filter((r) => r.k === 'A').sort((x, y) => x.ingest_seq - y.ingest_seq);
    expect(a.map((r) => r.source_row_id)).toEqual([2, 5]); // ordered by src id
    expect(a.map((r) => r.ingest_seq)).toEqual([0, 1]);
    expect(a.every((r) => r.merge_key_is_unique === false)).toBe(true);
    expect(rows.find((r) => r.k === 'B')!.merge_key_is_unique).toBe(true);
  });
});

describe('station normalisation', () => {
  it('treats 0 and negatives as no station, not as position zero', async () => {
    const { __stationForTest } = await import('./transform.js');
    expect(__stationForTest(0)).toBeNull();
    expect(__stationForTest(-1)).toBeNull();
    expect(__stationForTest(null)).toBeNull();
    expect(__stationForTest(1)).toBe(1);
    expect(__stationForTest(14)).toBe(14);
  });
});
