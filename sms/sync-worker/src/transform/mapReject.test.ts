/**
 * mapReject, both kinds (roadmap Phase 5 item 6, 14 Sep 2026). The gap
 * analysis found zero tests on the reject import: the two source tables
 * (rejectQCS1_* and rejectWeight1_*) reach one canonical shape through this
 * one function, discriminated by `kind`, and nothing pinned which columns
 * each kind keeps and which it must leave NULL.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_BOUNDARIES, TRANSFORM_VERSION } from '@sms/shared';
import { mapReject, rejectKey, type TransformRules } from './transform.js';

const dt = (iso: string) => new Date(iso + 'Z'); // wall clock as UTC, as mssql useUTC=true returns it

const RULES: TransformRules = {
  lineId: 1,
  shift: { boundaries: DEFAULT_SHIFT_BOUNDARIES, nightBelongsTo: 'start_day', mode: 'corrected' },
  sourceSystem: 'ifl_sql',
};

/** A row from rejectQCS1_TP1U2 after the 2026-08-05 rebuild: codes, MaterialId, no weight. */
const QCS_RAW = {
  raw_id: 501,
  ingest_run_id: '9c1f2b7a-0c3e-4d5f-8a1b-2c3d4e5f6a7b',
  read_at_utc: dt('2026-09-07T04:20:00'),
  src_id: 77,
  source_epoch: 11,
  src_Date: dt('2026-09-07T09:32:00'),
  src_ProductionDate: dt('2026-09-07T09:14:00'),
  src_Shift: 'Morning',
  src_HangerNum: 4,
  src_MachineNo: 6,
  src_Lifter: 6,
  src_TubeInspectResult: 1,
  src_MaterialInspectResult: 3,
  src_MaterialId: 21,
};

/** A row from rejectWeight1_TP1U2: a weight, no inspection codes. */
const WEIGHT_RAW = {
  raw_id: 502,
  ingest_run_id: '9c1f2b7a-0c3e-4d5f-8a1b-2c3d4e5f6a7b',
  read_at_utc: dt('2026-09-07T04:20:00'),
  src_id: 77, // the same id as the quality row above: the two tables share an id space
  source_epoch: 12,
  src_Date: dt('2026-09-07T23:40:00'),
  src_ProductionDate: dt('2026-09-07T23:21:00'),
  src_Shift: 'Night',
  src_HangerNum: 9,
  src_MachineNo: 2,
  src_Lifter: 2,
  src_Weight: 1742.5,
  src_MaterialId: 21,
};

describe('mapReject — quality (inspection) rejects', () => {
  const row = mapReject(QCS_RAW, 'quality', RULES);

  it('keeps the raw code pair verbatim and has no weight', () => {
    expect(row.reject_type).toBe('quality');
    expect(row.tube_inspect_code).toBe(1);
    expect(row.material_inspect_code).toBe(3);
    expect(row.weight_g).toBeNull();
  });

  it('takes its event time from ProductionDate, not the insert time, and derives the shift from it', () => {
    expect(row.production_ts_utc).toEqual(QCS_RAW.src_ProductionDate);
    expect(row.ingest_ts_utc).toEqual(QCS_RAW.src_Date);
    expect(row.shift_code).toBe('morning');
    expect(row.shift_date.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(row.shift_code_legacy).toBe('morning');
  });

  it('carries station, hanger, the configured line and source system, and the raw row\'s provenance', () => {
    expect(row.line_id).toBe(1);
    expect(row.source_system).toBe('ifl_sql');
    expect(row.source_station).toBe(6);
    expect(row.lifter_station).toBe(6);
    expect(row.hanger_num).toBe(4);
    expect(row.source_epoch).toBe(11);
    expect(row.source_row_id).toBe(77);
    expect(row.raw_id).toBe(501);
    expect(row.ingest_run_id).toBe(QCS_RAW.ingest_run_id);
    expect(row.ingested_at_utc).toEqual(QCS_RAW.read_at_utc);
    expect(row.transform_version).toBe(TRANSFORM_VERSION);
  });

  it('is attributed from the row\'s own MaterialId', () => {
    expect(row.material_id).toBe(21);
    expect(row.attribution_method).toBe('source_column');
    expect(row.attribution_confidence).toBe('high');
  });

  it('a quality row with a Weight column set is still weightless — the column is not the reject\'s', () => {
    const r = mapReject({ ...QCS_RAW, src_Weight: 1900 }, 'quality', RULES);
    expect(r.weight_g).toBeNull();
  });
});

describe('mapReject — weight rejects', () => {
  const row = mapReject(WEIGHT_RAW, 'weight', RULES);

  it('keeps the weight in raw grams and has no code pair', () => {
    expect(row.reject_type).toBe('weight');
    expect(row.weight_g).toBe(1742.5);
    expect(row.tube_inspect_code).toBeNull();
    expect(row.material_inspect_code).toBeNull();
  });

  it('a weight row with inspection columns set still carries no code — they are not the reject\'s', () => {
    const r = mapReject({ ...WEIGHT_RAW, src_TubeInspectResult: 1, src_MaterialInspectResult: 3 }, 'weight', RULES);
    expect(r.tube_inspect_code).toBeNull();
    expect(r.material_inspect_code).toBeNull();
  });

  it('a 23:21 reject is the night shift of the 7th under start_day', () => {
    expect(row.shift_code).toBe('night');
    expect(row.shift_date.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(row.night_belongs_to).toBe('start_day');
  });

  it('a pre-rebuild row (no MaterialId column) is honestly unattributed', () => {
    const { src_MaterialId: _drop, ...older } = WEIGHT_RAW;
    const r = mapReject(older, 'weight', RULES);
    expect(r.material_id).toBeNull();
    expect(r.attribution_method).toBe('none');
    expect(r.attribution_confidence).toBeNull();
  });
});

describe('the two kinds share an id space and are told apart by reject_type', () => {
  it('rejectKey includes the type, so a quality and a weight reject never collide on merge', () => {
    const q = mapReject(QCS_RAW, 'quality', RULES);
    const w = mapReject({ ...WEIGHT_RAW, src_ProductionDate: QCS_RAW.src_ProductionDate, src_HangerNum: 4, source_epoch: 11 }, 'weight', RULES);
    expect(q.source_row_id).toBe(w.source_row_id);
    expect(q.production_ts_utc_ms).toBe(w.production_ts_utc_ms);
    expect(rejectKey(q)).not.toBe(rejectKey(w));
    expect(rejectKey(q)).toMatch(/^quality\|/);
    expect(rejectKey(w)).toMatch(/^weight\|/);
  });
});
