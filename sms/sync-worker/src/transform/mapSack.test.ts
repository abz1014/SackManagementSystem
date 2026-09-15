/**
 * mapSack (roadmap Phase 7, 15 Sep 2026) — the one test the gap analysis
 * (§9) found missing for the sack half of the transform. Kept beside
 * mapReject.test.ts rather than inside transform.test.ts, which Phase 4
 * owns this wave.
 *
 * What a sack row must carry, and why each line is here:
 *  - production_ts_utc is IFL's INSERT time (`Date`), because a sack has no
 *    ProductionDate (SCHEMA DQ-5), and the row SAYS so through
 *    production_ts_is_insert_time — the flag every sack screen prints as
 *    "Recorded", not "Weighed";
 *  - the product is the row's own MaterialId, by the same rule as cones;
 *    a pre-August row is honestly 'none';
 *  - SackNum is carried and never used as a key; the weight is raw kg;
 *  - no machine or station of any kind: the source has none, and the row
 *    must not grow one.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_BOUNDARIES } from '@sms/shared';
import { mapSack, sackKey, type TransformRules } from './transform.js';

const dt = (iso: string) => new Date(iso + 'Z'); // stored wall clock as UTC

const rules: TransformRules = {
  lineId: 1,
  shift: { boundaries: DEFAULT_SHIFT_BOUNDARIES, nightBelongsTo: 'start_day', mode: 'corrected' },
  sourceSystem: 'ifl_sql',
};

const raw = {
  raw_id: 501,
  ingest_run_id: '3a4b5c6d-0000-4000-8000-000000000001',
  read_at_utc: dt('2026-09-07T04:10:00'),
  src_id: 5435,
  source_epoch: 10,
  src_Date: dt('2026-09-07T01:52:10'),
  src_Shift: 'Night',
  src_Area: 'Sack-3',
  src_SackNum: 812,
  src_Weight: 50.35,
  src_inRange: true,
  src_MaterialId: 23,
};

describe('mapSack', () => {
  it('uses the insert time as the event time and flags that it did', () => {
    const row = mapSack(raw, rules);
    expect(row.production_ts_utc).toEqual(dt('2026-09-07T01:52:10'));
    expect(row.ingest_ts_utc).toEqual(dt('2026-09-07T01:52:10'));
    expect(row.production_ts_is_insert_time).toBe(true);
    // 01:52 is the night shift that began on the 6th
    expect(row.shift_code).toBe('night');
    expect(row.shift_date.toISOString().slice(0, 10)).toBe('2026-09-06');
    expect(row.shift_code_legacy).toBe('night');
  });

  it("carries the sack's own product from MaterialId, with the same attribution rule as cones", () => {
    const row = mapSack(raw, rules);
    expect(row.material_id).toBe(23);
    expect(row.attribution_method).toBe('source_column');
    expect(row.attribution_confidence).toBe('high');
    const july = mapSack({ ...raw, src_MaterialId: undefined }, rules);
    expect(july.material_id).toBeNull();
    expect(july.attribution_method).toBe('none');
    expect(july.attribution_confidence).toBeNull();
  });

  it('carries SackNum, the raw kg and the scale bit; the identity is the source row id and the raw id', () => {
    const row = mapSack(raw, rules);
    expect(row.sack_num).toBe(812);
    expect(row.weight_kg).toBe(50.35);
    expect(row.in_range).toBe(true);
    expect(row.source_row_id).toBe(5435);
    expect(row.raw_id).toBe(501);
    expect(row.source_epoch).toBe(10);
    expect(row.line_id).toBe(1);
    expect(row.source_system).toBe('ifl_sql');
    expect(row.ingest_run_id).toBe(raw.ingest_run_id);
    expect(row.ingested_at_utc).toEqual(raw.read_at_utc);
    // the merge key is time + generation: a sack has no hanger
    expect(sackKey(row)).toBe(`${row.production_ts_utc_ms}|10`);
  });

  it('never carries a machine or station — the source records none and the row must not invent one', () => {
    const row = mapSack({ ...raw, src_MachineNo: 7, src_Source: 7 }, rules) as unknown as Record<string, unknown>;
    for (const k of Object.keys(row)) {
      expect(k, k).not.toMatch(/machine|station/);
    }
  });

  it('a null SackNum and a null weight stay null rather than 0', () => {
    const row = mapSack({ ...raw, src_SackNum: null, src_Weight: null, src_inRange: null }, rules);
    expect(row.sack_num).toBeNull();
    expect(row.weight_kg).toBeNull();
    expect(row.in_range).toBeNull();
  });
});
