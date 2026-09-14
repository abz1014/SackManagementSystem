import { describe, it, expect } from 'vitest';
import { DEFAULT_SHIFT_BOUNDARIES, type ShiftBoundaries } from '@sms/shared';
import { wallClockOf, shiftCodeOf, shiftDateOf, normalizeLegacyShift } from './wallClock.js';
import { assignMergeKeys, attribution, mapCone, mapSack, mapReject, type TransformRules } from './transform.js';

// mssql with useUTC=true returns a stored '2026-07-10 11:23:10' as this Date:
const dt = (iso: string) => new Date(iso + 'Z'); // wall clock as UTC
const B = DEFAULT_SHIFT_BOUNDARIES;

describe('wallClock (tz-safe shift derivation)', () => {
  it('reads wall-clock parts via UTC accessors', () => {
    const wc = wallClockOf(dt('2026-07-10T11:23:10'));
    expect(wc.minuteOfDay).toBe(11 * 60 + 23);
    expect([wc.y, wc.mo, wc.d]).toEqual([2026, 7, 10]);
  });

  it('buckets shifts on the seed boundaries when handed them', () => {
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T08:00:00')), B)).toBe('morning');
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T14:00:00')), B)).toBe('evening');
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T22:00:00')), B)).toBe('night');
    expect(shiftCodeOf(wallClockOf(dt('2026-07-10T02:00:00')), B)).toBe('night');
  });

  it('night after midnight belongs to previous day (start_day)', () => {
    const d = shiftDateOf(wallClockOf(dt('2026-07-08T02:00:00')), 'start_day', B);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-07');
  });

  it('night after midnight keeps its date (calendar_day)', () => {
    const d = shiftDateOf(wallClockOf(dt('2026-07-08T02:00:00')), 'calendar_day', B);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-08');
  });

  it("the start_day cut-off is the rule's morning boundary, not the seed's", () => {
    // Under a rule whose morning starts at 08:00, 07:30 is still the night
    // shift that began yesterday — and belongs to yesterday.
    const late: ShiftBoundaries = { morningStart: 8 * 60, eveningStart: 16 * 60, nightStart: 24 * 60 - 60 };
    const d = shiftDateOf(wallClockOf(dt('2026-07-08T07:30:00')), 'start_day', late);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-07');
    // The same reading under the seed rule is the morning of the 8th.
    expect(shiftDateOf(wallClockOf(dt('2026-07-08T07:30:00')), 'start_day', B).toISOString().slice(0, 10)).toBe('2026-07-08');
  });

  it('normalises legacy shift strings', () => {
    expect(normalizeLegacyShift('Morning')).toBe('morning');
    expect(normalizeLegacyShift(null)).toBe(null);
  });
});

/**
 * Roadmap Phase 1 (14 Sep 2026): the shift rule is an argument to every
 * mapper, so a rule edited in Setup › Rules — boundaries included, not only
 * the night half — is what stamps shift_code and shift_date. Before this the
 * boundaries were a shared constant and only the night rule was read from the
 * table, so a rule with different start times was half-applied.
 */
describe('mappers stamp the shift from the rule they are handed', () => {
  const raw = {
    raw_id: 7,
    ingest_run_id: '2f1c9e1a-6f1b-4a3c-9d2e-1c0b4a8e7f00',
    read_at_utc: dt('2026-07-10T02:50:00'),
    src_id: 7,
    source_epoch: 9,
    src_Date: dt('2026-07-10T07:48:00'),
    src_ProductionDate: dt('2026-07-10T07:30:00'),
    src_Shift: 'Morning',
    src_HangerNum: 3,
    src_MachineNo: 5,
    src_Lifter: 5,
    src_Weight: 1950,
    src_inRange: true,
    src_MaterialId: 21,
  };
  const rulesWith = (boundaries: ShiftBoundaries, sourceSystem = 'ifl_sql'): TransformRules => ({
    lineId: 1,
    shift: { boundaries, nightBelongsTo: 'start_day', mode: 'corrected' },
    sourceSystem,
  });
  const eightOclock: ShiftBoundaries = { morningStart: 8 * 60, eveningStart: 16 * 60, nightStart: 23 * 60 };

  it("a 07:30 cone is 'morning' under 06/14/22 and 'night' under a rule whose morning starts at 08:00", () => {
    const seed = mapCone(raw, rulesWith(B));
    expect(seed.shift_code).toBe('morning');
    expect(seed.shift_date.toISOString().slice(0, 10)).toBe('2026-07-10');

    const late = mapCone(raw, rulesWith(eightOclock));
    expect(late.shift_code).toBe('night');
    // start_day: the night that began on the 9th
    expect(late.shift_date.toISOString().slice(0, 10)).toBe('2026-07-09');
    expect(late.night_belongs_to).toBe('start_day');
  });

  it('sacks and rejects follow the same rule', () => {
    expect(mapSack(raw, rulesWith(B)).shift_code).toBe('morning');
    expect(mapSack(raw, rulesWith(eightOclock)).shift_code).toBe('night');
    expect(mapReject(raw, 'quality', rulesWith(B)).shift_code).toBe('morning');
    expect(mapReject(raw, 'weight', rulesWith(eightOclock)).shift_code).toBe('night');
  });

  it("source_system is the configured system code, not a literal", () => {
    expect(mapCone(raw, rulesWith(B, 'plant_sql')).source_system).toBe('plant_sql');
    expect(mapSack(raw, rulesWith(B, 'plant_sql')).source_system).toBe('plant_sql');
    expect(mapReject(raw, 'quality', rulesWith(B, 'plant_sql')).source_system).toBe('plant_sql');
  });

  it('line_id is the configured line, never read from the row (finding M3)', () => {
    expect(mapCone({ ...raw, line_id: 99 }, { ...rulesWith(B), lineId: 2 }).line_id).toBe(2);
  });

  /**
   * Provenance is COPIED from the raw row (roadmap Phase 3 item 2): the raw
   * row's ingest_run_id IS sms.sync_run.run_id, and its read_at_utc is when
   * SMS read it. A transform-minted UUID joined to nothing (migration 029).
   */
  describe('provenance comes from the raw row, never minted', () => {
    it('ingest_run_id and ingested_at_utc are the raw row\'s own, on all three kinds', () => {
      for (const row of [mapCone(raw, rulesWith(B)), mapSack(raw, rulesWith(B)), mapReject(raw, 'quality', rulesWith(B))]) {
        expect(row.ingest_run_id).toBe('2f1c9e1a-6f1b-4a3c-9d2e-1c0b4a8e7f00');
        expect(row.ingested_at_utc).toEqual(dt('2026-07-10T02:50:00'));
        expect(row.raw_id).toBe(7);
        expect(row.source_row_id).toBe(7);
        expect(row.transform_version).toBe(2);
      }
    });

    it('ingest_ts_utc stays IFL\'s insert time — a different clock from ingested_at_utc', () => {
      const c = mapCone(raw, rulesWith(B));
      expect(c.ingest_ts_utc).toEqual(dt('2026-07-10T07:48:00'));
      expect(c.ingested_at_utc).not.toEqual(c.ingest_ts_utc);
    });

    it('refuses a raw row without ingest_run_id rather than inventing one', () => {
      const { ingest_run_id: _omit, ...noRun } = raw;
      expect(() => mapCone(noRun, rulesWith(B))).toThrow(/raw row 7 has no ingest_run_id/);
      expect(() => mapReject(noRun, 'weight', rulesWith(B))).toThrow(/ingest_run_id/);
    });

    it('a raw row read before migration 029\'s columns existed cannot occur, but a null read_at_utc is carried as null', () => {
      expect(mapSack({ ...raw, read_at_utc: null }, rulesWith(B)).ingested_at_utc).toBeNull();
    });
  });

  /**
   * Attribution (roadmap Phase 3 item 2): from the row's own MaterialId,
   * 'source_column'/'high'; without one, honestly 'none'. Rejects follow the
   * same rule as cones since migration 029 — they carried the material id
   * and no method for three weeks.
   */
  describe('attribution from MaterialId, on cones AND rejects', () => {
    it("a MaterialId gives 'source_column' with 'high' confidence", () => {
      expect(attribution(21)).toEqual({ material_id: 21, attribution_method: 'source_column', attribution_confidence: 'high' });
      const cone = mapCone(raw, rulesWith(B));
      expect([cone.material_id, cone.attribution_method, cone.attribution_confidence]).toEqual([21, 'source_column', 'high']);
      const q = mapReject(raw, 'quality', rulesWith(B));
      expect([q.material_id, q.attribution_method, q.attribution_confidence]).toEqual([21, 'source_column', 'high']);
      const w = mapReject(raw, 'weight', rulesWith(B));
      expect([w.material_id, w.attribution_method, w.attribution_confidence]).toEqual([21, 'source_column', 'high']);
    });

    it("no MaterialId (a pre-August row), or the 0 the clock-fault row carries, is 'none' with no confidence", () => {
      for (const id of [null, undefined, 0, -1]) {
        expect(attribution(id)).toEqual({ material_id: null, attribution_method: 'none', attribution_confidence: null });
      }
      const cone = mapCone({ ...raw, src_MaterialId: null }, rulesWith(B));
      expect([cone.material_id, cone.attribution_method, cone.attribution_confidence]).toEqual([null, 'none', null]);
      const rej = mapReject({ ...raw, src_MaterialId: 0 }, 'quality', rulesWith(B));
      expect([rej.material_id, rej.attribution_method, rej.attribution_confidence]).toEqual([null, 'none', null]);
      expect(mapSack({ ...raw, src_MaterialId: undefined }, rulesWith(B)).attribution_method).toBe('none');
    });
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
