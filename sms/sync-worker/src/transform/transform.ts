/**
 * Pure raw → canonical transform (ARCHITECTURE §3). No DB access here; every
 * function is a deterministic mapping so it can be unit-tested and re-run to
 * rebuild canonical from raw. Stamps transform_version.
 */
import { TRANSFORM_VERSION } from '@sms/shared';
import type { SyncConfig } from '../config.js';
import {
  wallClockOf,
  shiftCodeOf,
  shiftDateOf,
  normalizeLegacyShift,
} from './wallClock.js';

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const bit = (v: unknown): boolean | null => (v == null ? null : Boolean(v));

export interface ConeRow {
  line_id: number;
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  shift_code: string;
  shift_date: Date;
  shift_code_legacy: string | null;
  hanger_num: number | null;
  source_station: number | null;
  lifter_station: number | null;
  weight_g: number | null;
  in_range: boolean | null;
  cone_id: string | null;
  cone_id_source: string | null;
  material_id: number | null;
  lot_code: string | null;
  attribution_method: string;
  attribution_confidence: string | null;
  source_system: string;
  source_row_id: number;
  raw_id: number;
  ingest_run_id: string;
  ingest_seq: number;
  merge_key_is_unique: boolean;
  transform_version: number;
}

export interface SackRow {
  line_id: number;
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  production_ts_is_insert_time: boolean;
  shift_code: string;
  shift_date: Date;
  shift_code_legacy: string | null;
  sack_num: number | null;
  weight_kg: number | null;
  in_range: boolean | null;
  material_id: number | null;
  lot_code: string | null;
  attribution_method: string;
  attribution_confidence: string | null;
  source_system: string;
  source_row_id: number;
  raw_id: number;
  ingest_run_id: string;
  ingest_seq: number;
  merge_key_is_unique: boolean;
  transform_version: number;
}

export interface RejectRow {
  line_id: number;
  reject_type: 'quality' | 'weight';
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  shift_code: string;
  shift_date: Date;
  shift_code_legacy: string | null;
  hanger_num: number | null;
  source_station: number | null;
  lifter_station: number | null;
  tube_inspect_code: number | null;
  material_inspect_code: number | null;
  weight_g: number | null;
  source_system: string;
  source_row_id: number;
  raw_id: number;
  ingest_run_id: string;
  ingest_seq: number;
  transform_version: number;
}

const BASE = {
  source_system: 'ifl_sql',
  attribution_method: 'none', // NullAttribution (Q1: no historical product-wise)
  attribution_confidence: null as string | null,
  material_id: null as number | null,
  lot_code: null as string | null,
};

export function mapCone(raw: Raw, cfg: SyncConfig, runId: string): ConeRow {
  const eventDt = (raw.src_ProductionDate ?? raw.src_Date) as Date;
  const wc = wallClockOf(eventDt);
  return {
    line_id: cfg.lineId,
    production_ts_utc: eventDt,
    production_ts_utc_ms: wc.ms,
    ingest_ts_utc: (raw.src_Date as Date) ?? null,
    shift_code: shiftCodeOf(wc),
    shift_date: shiftDateOf(wc, cfg.appConfig.shift.nightBelongsTo),
    shift_code_legacy: normalizeLegacyShift(raw.src_Shift),
    hanger_num: num(raw.src_HangerNum),
    source_station: num(raw.src_Source),
    lifter_station: num(raw.src_Lifter),
    weight_g: num(raw.src_Weight),
    in_range: bit(raw.src_inRange),
    cone_id: null,
    cone_id_source: null,
    ...BASE,
    source_row_id: Number(raw.src_id),
    raw_id: Number(raw.raw_id),
    ingest_run_id: runId,
    ingest_seq: 0,
    merge_key_is_unique: true,
    transform_version: TRANSFORM_VERSION,
  };
}

export function mapSack(raw: Raw, cfg: SyncConfig, runId: string): SackRow {
  // sacks have no independent event time (DQ-5): use insert time, flag it.
  const eventDt = raw.src_Date as Date;
  const wc = wallClockOf(eventDt);
  return {
    line_id: cfg.lineId,
    production_ts_utc: eventDt,
    production_ts_utc_ms: wc.ms,
    ingest_ts_utc: eventDt ?? null,
    production_ts_is_insert_time: true,
    shift_code: shiftCodeOf(wc),
    shift_date: shiftDateOf(wc, cfg.appConfig.shift.nightBelongsTo),
    shift_code_legacy: normalizeLegacyShift(raw.src_Shift),
    sack_num: num(raw.src_SackNum),
    weight_kg: num(raw.src_Weight),
    in_range: bit(raw.src_inRange),
    ...BASE,
    source_row_id: Number(raw.src_id),
    raw_id: Number(raw.raw_id),
    ingest_run_id: runId,
    ingest_seq: 0,
    merge_key_is_unique: true,
    transform_version: TRANSFORM_VERSION,
  };
}

export function mapReject(
  raw: Raw,
  kind: 'quality' | 'weight',
  cfg: SyncConfig,
  runId: string,
): RejectRow {
  const eventDt = (raw.src_ProductionDate ?? raw.src_Date) as Date;
  const wc = wallClockOf(eventDt);
  return {
    line_id: cfg.lineId,
    reject_type: kind,
    production_ts_utc: eventDt,
    production_ts_utc_ms: wc.ms,
    ingest_ts_utc: (raw.src_Date as Date) ?? null,
    shift_code: shiftCodeOf(wc),
    shift_date: shiftDateOf(wc, cfg.appConfig.shift.nightBelongsTo),
    shift_code_legacy: normalizeLegacyShift(raw.src_Shift),
    hanger_num: num(raw.src_HangerNum),
    source_station: num(raw.src_Source),
    lifter_station: num(raw.src_Lifter),
    tube_inspect_code: kind === 'quality' ? num(raw.src_TubeInspectResult) : null,
    material_inspect_code: kind === 'quality' ? num(raw.src_MaterialInspectResult) : null,
    weight_g: kind === 'weight' ? num(raw.src_Weight) : null,
    source_system: 'ifl_sql',
    source_row_id: Number(raw.src_id),
    raw_id: Number(raw.raw_id),
    ingest_run_id: runId,
    ingest_seq: 0,
    transform_version: TRANSFORM_VERSION,
  };
}

/**
 * Assign ingest_seq (and merge_key_is_unique where the row has it) within
 * collision groups, deterministically by source_row_id — so re-transform is
 * stable. keyFn returns the merge-key string. Mutates + returns rows.
 */
export function assignMergeKeys<T extends { source_row_id: number; ingest_seq: number }>(
  rows: T[],
  keyFn: (r: T) => string,
): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyFn(r);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.source_row_id - b.source_row_id);
    group.forEach((r, i) => {
      r.ingest_seq = i;
      if ('merge_key_is_unique' in r) {
        (r as { merge_key_is_unique: boolean }).merge_key_is_unique = group.length === 1;
      }
    });
  }
  return rows;
}

export const coneKey = (r: ConeRow) => `${r.production_ts_utc_ms}|${r.hanger_num ?? ''}`;
export const sackKey = (r: SackRow) => `${r.production_ts_utc_ms}`;
export const rejectKey = (r: RejectRow) =>
  `${r.reject_type}|${r.production_ts_utc_ms}|${r.hanger_num ?? ''}`;
