/**
 * The client-side two-clocks conversion (roadmap Phase 9 item 4, 15 Sep
 * 2026). Every case takes the offset as an argument — the API's figure —
 * and none depends on the machine running the test, so the suite answers
 * the same under TZ=UTC (CI) and UTC+5 (the development machine).
 */
import { describe, expect, it } from 'vitest';
import { dayEndsAtOrAfter, fromPlantLocal, plantDayOf, plantLocalValue, toPlantIso, toPlantMs } from './plantClock';

const PK = 300; // UTC+5, no daylight saving

describe('toPlantMs / toPlantIso', () => {
  it('adds the plant offset so a genuine-UTC instant lines up with production time', () => {
    // The one ledger row on the sidecar: 2026-09-03T11:56:07.499Z is 16:56 on the floor.
    expect(toPlantIso('2026-09-03T11:56:07.499Z', PK)).toBe('2026-09-03T16:56:07.499Z');
    expect(toPlantMs('2026-09-03T11:56:07.499Z', PK)).toBe(new Date('2026-09-03T16:56:07.499Z').getTime());
  });

  it('is the identity on a zero-offset plant', () => {
    expect(toPlantIso('2026-09-03T11:56:07.000Z', 0)).toBe('2026-09-03T11:56:07.000Z');
  });
});

describe('plantDayOf', () => {
  it('moves an instant logged late on a UTC evening onto the NEXT production day', () => {
    // 21:30Z is 02:30 on 4 Sep on the plant: the day the old string comparison got wrong.
    expect(plantDayOf('2026-09-03T21:30:00Z', PK)).toBe('2026-09-04');
  });

  it('keeps an afternoon instant on the same day', () => {
    expect(plantDayOf('2026-09-03T11:56:07Z', PK)).toBe('2026-09-03');
  });
});

describe('fromPlantLocal / plantLocalValue', () => {
  it('turns a typed plant time into the genuine-UTC instant the API stores', () => {
    expect(fromPlantLocal('2026-09-03T16:56', PK)).toBe('2026-09-03T11:56:00.000Z');
  });

  it('round-trips through the form value', () => {
    const plantIso = toPlantIso('2026-09-03T11:56:00.000Z', PK);
    expect(plantLocalValue(plantIso)).toBe('2026-09-03T16:56');
    expect(fromPlantLocal(plantLocalValue(plantIso), PK)).toBe('2026-09-03T11:56:00.000Z');
  });

  it('accepts a value with seconds as well', () => {
    expect(fromPlantLocal('2026-09-03T16:56:30', PK)).toBe('2026-09-03T11:56:30.000Z');
  });
});

describe('dayEndsAtOrAfter — the day a new scale starts, by the server’s own rule', () => {
  const adjustedAtUtc = '2026-09-03T21:30:00Z'; // 02:30 on 4 Sep, plant time

  it('the production day the adjustment fell on ends after it', () => {
    expect(dayEndsAtOrAfter('2026-09-04', adjustedAtUtc, PK)).toBe(true);
  });

  it('the day before does not — the old string comparison said it did', () => {
    expect(dayEndsAtOrAfter('2026-09-03', adjustedAtUtc, PK)).toBe(false);
    // What StationSheet used to do: compare the strings with no conversion.
    expect(`2026-09-03T23:59:59Z` >= adjustedAtUtc).toBe(true);
  });
});
