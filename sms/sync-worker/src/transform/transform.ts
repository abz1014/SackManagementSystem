/**
 * Pure raw → canonical transform (ARCHITECTURE §3). No DB access here; every
 * function is a deterministic mapping so it can be unit-tested and re-run to
 * rebuild canonical from raw. Stamps transform_version.
 */
import { TRANSFORM_VERSION, type NightBelongsTo, type ShiftBoundaries, type ShiftMode } from '@sms/shared';
import {
  wallClockOf,
  shiftCodeOf,
  shiftDateOf,
  normalizeLegacyShift,
} from './wallClock.js';

/**
 * The shift rule in force for a line — the newest sms.shift_rule row, as the
 * transform needs it. Resolved by `resolveShiftRule` (runTransform.ts) once per
 * pass; this module only consumes it. Q7 (fix-vs-reproduce, `mode`) is still
 * open with IFL, which is why both the corrected and the legacy code are
 * stored on every row and `mode` is carried but not applied here.
 */
export interface ShiftRule {
  boundaries: ShiftBoundaries;
  nightBelongsTo: NightBelongsTo;
  mode: ShiftMode;
}

/**
 * Everything a mapper needs that is not on the row. Roadmap Phase 1 (14 Sep
 * 2026): the mappers used to take the whole SyncConfig and read two things
 * from it — the line id, and a night rule frozen from the env at startup (the
 * H5 defect). Both are now resolved from configuration at the start of the
 * pass and handed in, so the mappers remain pure functions of their
 * arguments and a rule edited in Setup applies to the next pass and to a
 * rebuild alike.
 */
export interface TransformRules {
  lineId: number;
  shift: ShiftRule;
  /**
   * `system_code` of the data source the rows' table is read through
   * (sms.source_table → sms.data_source) — stamped as `source_system`. Was
   * the literal 'ifl_sql'.
   */
  sourceSystem: string;
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (v == null ? null : Number(v));
/**
 * Station ids, where 0 is not a station.
 *
 * The line numbers its winding positions 1-14; `sms.station` holds exactly
 * those. A 0 in the source is the PLC's zero-value, not position zero, and it
 * only ever appears on rows that zeroed out entirely — all three in the
 * supplied copy carry an epoch timestamp (1970-01-01) as well. Storing it as 0
 * created a fifteenth station that no screen could label and no lookup could
 * resolve; null says what is actually known, which is nothing.
 */
const station = (v: unknown): number | null => {
  const n = num(v);
  return n == null || n <= 0 ? null : n;
};
const bit = (v: unknown): boolean | null => (v == null ? null : Boolean(v));

/** Exposed for tests: 0 is the PLC's zero-value, never a winding position. */
export const __stationForTest = station;

export interface ConeRow {
  line_id: number;
  /** Source generation (sms.source_epoch). Part of the merge key: two cones nine
   *  weeks apart in different generations must never be mistaken for a collision. */
  source_epoch: number;
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  shift_code: string;
  shift_date: Date;
  shift_code_legacy: string | null;
  /** Which night-attribution rule produced this row's shift_date. */
  night_belongs_to: string;
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
  source_epoch: number;
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  production_ts_is_insert_time: boolean;
  shift_code: string;
  shift_date: Date;
  shift_code_legacy: string | null;
  /** Which night-attribution rule produced this row's shift_date. */
  night_belongs_to: string;
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
  source_epoch: number;
  reject_type: 'quality' | 'weight';
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  shift_code: string;
  shift_date: Date;
  shift_code_legacy: string | null;
  /** Which night-attribution rule produced this row's shift_date. */
  night_belongs_to: string;
  hanger_num: number | null;
  source_station: number | null;
  lifter_station: number | null;
  tube_inspect_code: number | null;
  material_inspect_code: number | null;
  weight_g: number | null;
  /** IFL's own product key (Sep 2026); null for rows read before it existed. */
  material_id: number | null;
  source_system: string;
  source_row_id: number;
  raw_id: number;
  ingest_run_id: string;
  ingest_seq: number;
  transform_version: number;
}

const BASE = {
  lot_code: null as string | null,
};

/**
 * Product attribution, from IFL's own `MaterialId` column (Sep 2026).
 *
 * This replaces NullAttribution, which was never a design choice — it was forced
 * by SCHEMA.md OQ-1: the weighing tables carried no product or lot key, so the
 * two databases could not be joined, and `attribution_method: 'none'` was stamped
 * on all 142,511 rows. IFL's 2026-08-05 rebuild added `MaterialId` to all four
 * wide tables, populated on 100% of rows (pack1 132,552/132,552, sack1 5,435/
 * 5,435, rejectQCS1 6,049/6,049), joining cleanly to PDAS.dbo.Materials. The
 * owner confirmed with IFL on 2026-09-10 that it is trustworthy.
 *
 * `source_column` is deliberately NOT `manual_entry`: this is the plant's own
 * recorded attribution for that individual cone, not a human telling the app
 * what was running. Confidence is 'high' because the value comes from the same
 * acquisition row as the weight — there is no inference step to be wrong about.
 *
 * Rows read BEFORE the rebuild keep `none`/null: the source column did not exist
 * when they were ingested, so their product is genuinely unknown. Saying so is
 * the point — back-filling them from today's active material would apply a
 * product to readings taken weeks before it existed, which is precisely the
 * class of bug CLAUDE.md rule 1 was written to stop.
 */
function attribution(rawMaterialId: unknown): {
  material_id: number | null;
  attribution_method: string;
  attribution_confidence: string | null;
} {
  const id = num(rawMaterialId);
  // MaterialId 0 is not a product: it appears only on the single 1970-01-01
  // clock-fault row, and joins to nothing in PDAS.
  if (id === null || id <= 0) {
    return { material_id: null, attribution_method: 'none', attribution_confidence: null };
  }
  return { material_id: id, attribution_method: 'source_column', attribution_confidence: 'high' };
}

/**
 * EVERY mapper below stamps `line_id: rules.lineId` — this PROCESS's configured
 * line, never anything read from the row itself (finding M3, Sep 2026 audit).
 * This is not a shortcut: IFL's source tables carry NO line-identifying
 * column at all (see iflTables.ts) — line identity is encoded entirely in
 * WHICH table you read (the `_TP1U2` suffix is Plant 1 / Unit 2), which
 * correlates with the deploying process's own config. There is nothing in a
 * row to check rules.lineId against, so no code-level verification is possible
 * with today's data model.
 *
 * Dormant with one line. The moment a second line is added (Q14, still open
 * with IFL — `line_id` is threaded everywhere for it), EVERY row that second
 * sync-worker instance reads will be stamped with WHATEVER LINE_ID that
 * instance's own .env says — correct only if that line's own sms.source_table
 * rows name its own, differently-named source tables (roadmap Phase 1 moved
 * the names from code to those rows; the pairing of LINE_ID with them is
 * still a deployment fact). Getting LINE_ID or the source table rows wrong on
 * a second deployment silently cross-contaminates canonical data between
 * lines, with nothing in this code able to detect it. This is a
 * deployment-discipline requirement to document loudly at that point
 * (DEPLOY.md), not a bug fixable here — there is no ground truth in the row
 * to verify against.
 */
export function mapCone(raw: Raw, rules: TransformRules, runId: string): ConeRow {
  const eventDt = (raw.src_ProductionDate ?? raw.src_Date) as Date;
  const wc = wallClockOf(eventDt);
  const { boundaries, nightBelongsTo } = rules.shift;
  return {
    line_id: rules.lineId,
    source_epoch: Number(raw.source_epoch),
    production_ts_utc: eventDt,
    production_ts_utc_ms: wc.ms,
    ingest_ts_utc: (raw.src_Date as Date) ?? null,
    shift_code: shiftCodeOf(wc, boundaries),
    shift_date: shiftDateOf(wc, nightBelongsTo, boundaries),
    shift_code_legacy: normalizeLegacyShift(raw.src_Shift),
    night_belongs_to: nightBelongsTo,
    hanger_num: num(raw.src_HangerNum),
    source_station: station(raw.src_MachineNo),
    lifter_station: station(raw.src_Lifter),
    weight_g: num(raw.src_Weight),
    in_range: bit(raw.src_inRange),
    cone_id: null,
    cone_id_source: null,
    ...BASE,
    source_system: rules.sourceSystem,
    ...attribution(raw.src_MaterialId),
    source_row_id: Number(raw.src_id),
    raw_id: Number(raw.raw_id),
    ingest_run_id: runId,
    ingest_seq: 0,
    merge_key_is_unique: true,
    transform_version: TRANSFORM_VERSION,
  };
}

export function mapSack(raw: Raw, rules: TransformRules, runId: string): SackRow {
  // sacks have no independent event time (DQ-5): use insert time, flag it.
  const eventDt = raw.src_Date as Date;
  const wc = wallClockOf(eventDt);
  const { boundaries, nightBelongsTo } = rules.shift;
  return {
    line_id: rules.lineId,
    source_epoch: Number(raw.source_epoch),
    production_ts_utc: eventDt,
    production_ts_utc_ms: wc.ms,
    ingest_ts_utc: eventDt ?? null,
    production_ts_is_insert_time: true,
    shift_code: shiftCodeOf(wc, boundaries),
    shift_date: shiftDateOf(wc, nightBelongsTo, boundaries),
    shift_code_legacy: normalizeLegacyShift(raw.src_Shift),
    night_belongs_to: nightBelongsTo,
    sack_num: num(raw.src_SackNum),
    weight_kg: num(raw.src_Weight),
    in_range: bit(raw.src_inRange),
    ...BASE,
    source_system: rules.sourceSystem,
    ...attribution(raw.src_MaterialId),
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
  rules: TransformRules,
  runId: string,
): RejectRow {
  const eventDt = (raw.src_ProductionDate ?? raw.src_Date) as Date;
  const wc = wallClockOf(eventDt);
  const { boundaries, nightBelongsTo } = rules.shift;
  return {
    line_id: rules.lineId,
    source_epoch: Number(raw.source_epoch),
    reject_type: kind,
    production_ts_utc: eventDt,
    production_ts_utc_ms: wc.ms,
    ingest_ts_utc: (raw.src_Date as Date) ?? null,
    shift_code: shiftCodeOf(wc, boundaries),
    shift_date: shiftDateOf(wc, nightBelongsTo, boundaries),
    shift_code_legacy: normalizeLegacyShift(raw.src_Shift),
    night_belongs_to: nightBelongsTo,
    hanger_num: num(raw.src_HangerNum),
    source_station: station(raw.src_MachineNo),
    lifter_station: station(raw.src_Lifter),
    tube_inspect_code: kind === 'quality' ? num(raw.src_TubeInspectResult) : null,
    material_inspect_code: kind === 'quality' ? num(raw.src_MaterialInspectResult) : null,
    weight_g: kind === 'weight' ? num(raw.src_Weight) : null,
    // A reject rate is only meaningful per product, so rejects carry the key too.
    material_id: attribution(raw.src_MaterialId).material_id,
    source_system: rules.sourceSystem,
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

// The epoch is part of every key. Without it two cones nine weeks apart in
// different generations that happen to share (ts, hanger) would be flagged as
// merge_key_is_unique = 0, which the app reports as DQ-2 "possibly the same cone
// weighed twice". They are not. It also means assignMergeKeys can never form a
// cross-epoch collision group, so its source_row_id sort stays deterministic.
export const coneKey = (r: ConeRow) => `${r.production_ts_utc_ms}|${r.hanger_num ?? ''}|${r.source_epoch}`;
export const sackKey = (r: SackRow) => `${r.production_ts_utc_ms}|${r.source_epoch}`;
export const rejectKey = (r: RejectRow) =>
  `${r.reject_type}|${r.production_ts_utc_ms}|${r.hanger_num ?? ''}|${r.source_epoch}`;
