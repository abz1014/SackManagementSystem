/**
 * Canonical record contracts — what a row of each app-owned table IS,
 * column for column (roadmap Phase 3, 14 Sep 2026).
 *
 * WHY THIS FILE REPLACES events.ts. The old `events.ts` exported fourteen
 * names, had ZERO importers anywhere in the repository, and described a
 * nested camelCase shape (`merge: MergeKey`, `weight: RawWeight`) that no
 * table, no transform and no API ever used. Its `AttributionMethod` union did
 * not even contain `'source_column'`, the value 132,551 of 132,552 September
 * cones actually carry. A "single source of truth" nothing reads is a false
 * claim, and false claims about the data model are the class of defect the
 * Sep 2026 audit kept finding. So: these interfaces mirror the tables as the
 * migrations define them, in the tables' own column names, and the transform's
 * row builders are typed against them — a column added to a table and not to
 * the transform, or vice versa, is now a compile error rather than a silent
 * NULL.
 *
 * CONVENTIONS
 *  - snake_case, exactly the column name, so a row from `SELECT *` IS the type.
 *  - `Date` for DATETIME2/DATE/TIME columns as node-mssql returns them.
 *  - BIGINT columns are typed `number`. The driver returns BIGINT as a string
 *    unless told otherwise; every reader in this project already coerces with
 *    `Number(...)`, and the transform builds these from numbers. The type says
 *    what the value MEANS, not what tedious hands back.
 *  - Identity columns (`cone_event_id`, ...) are present on a READ row and
 *    absent on the row the transform BUILDS; the `*Insert` aliases below omit
 *    them, and the type-level test in the worker pins that a built row is
 *    assignable to the insert shape.
 *
 * Two clocks, named (CLAUDE.md, redesign rule 2): `production_ts_utc` and
 * `ingest_ts_utc` are the PLANT'S wall clock labelled UTC (IFL's own
 * ProductionDate / Date columns, stored verbatim); `ingested_at_utc`,
 * `effective_from`, `changed_at`, `at_utc` and every other `*_utc` written by
 * SMS itself are genuine UTC. On this plant they are five hours apart.
 */

import type { NightBelongsTo, ShiftCode, ShiftMode } from './shift.js';

// ---------------------------------------------------------------- vocabularies

/**
 * How a reading's product was resolved.
 *  - 'none'          the source row had no product column when it was read
 *                    (every row before IFL's 2026-08-05 rebuild)
 *  - 'source_column' the row's own MaterialId (IFL's, trusted 10 Sep 2026)
 *  - 'manual_entry'  the app-owned product timeline — reserved; not stamped
 *                    by the transform today
 */
export type AttributionMethod = 'none' | 'source_column' | 'manual_entry';

export type AttributionConfidence = 'high' | 'low' | 'ambiguous';

/**
 * `system_code` of the sms.data_source a row was read through. A string, not
 * a union: the codes are configuration (Setup › Sources), and a union here
 * would be the literal-'ifl_sql' coupling roadmap Phase 1 removed.
 */
export type SourceSystem = string;

export type RejectType = 'quality' | 'weight';

export type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

// ---------------------------------------------------------------- provenance

/**
 * Where a canonical reading came from, as a person needs it (Phase 3 item 4):
 * the chain canonical → raw → sync_run → source_epoch, flattened. Derived
 * from a record by `provenanceOf`; the API adds the joined epoch label and
 * source table name on top.
 */
export interface Provenance {
  sourceSystem: SourceSystem;
  /** sms.source_epoch.epoch_id — WHICH physical generation of the source table. */
  sourceEpoch: number;
  /** IFL's own `id` in that generation. Names two rows since 5 Aug 2026 without the epoch. */
  sourceRowId: number | null;
  /** IFL's insert time (their `Date` column) — plant wall clock labelled UTC. */
  sourceTsUtc: Date | null;
  /** The event time as epoch-ms of the wall clock: the merge key's time part. */
  productionTsUtcMs: number;
  /** When SMS read the row into sms_raw (the raw row's read_at_utc) — real UTC. */
  ingestedAtUtc: Date | null;
  /** sms.sync_run.run_id of the pass that read the raw row. */
  ingestRunId: string;
  /** sms_raw.<table>.raw_id — SMS's own identity, never reused across generations. */
  rawId: number | null;
  transformVersion: number;
  attributionMethod: AttributionMethod | null;
  attributionConfidence: AttributionConfidence | null;
}

/** The provenance columns the three reading tables share, so one function can read them. */
export interface ProvenanceColumns {
  source_system: SourceSystem;
  source_epoch: number;
  source_row_id: number | null;
  ingest_ts_utc: Date | null;
  production_ts_utc_ms: number;
  ingested_at_utc: Date | null;
  ingest_run_id: string;
  raw_id: number | null;
  transform_version: number;
  attribution_method: AttributionMethod | null;
  attribution_confidence: AttributionConfidence | null;
}

export function provenanceOf(row: ProvenanceColumns): Provenance {
  return {
    sourceSystem: row.source_system,
    sourceEpoch: row.source_epoch,
    sourceRowId: row.source_row_id,
    sourceTsUtc: row.ingest_ts_utc,
    productionTsUtcMs: row.production_ts_utc_ms,
    ingestedAtUtc: row.ingested_at_utc,
    ingestRunId: row.ingest_run_id,
    rawId: row.raw_id,
    transformVersion: row.transform_version,
    attributionMethod: row.attribution_method,
    attributionConfidence: row.attribution_confidence,
  };
}

// ---------------------------------------------------------------- readings

/** sms.cone_event — one row per cone weighing (migrations 003, 023, 024, 025, 029). */
export interface ConeReading extends ProvenanceColumns {
  cone_event_id: number;
  line_id: number;
  /** IFL's ProductionDate: the event time. Plant wall clock labelled UTC. */
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  /** IFL's Date: their insert time, ~18 min after the weighing. Not SMS's ingest time. */
  ingest_ts_utc: Date | null;
  shift_code: ShiftCode;
  shift_date: Date;
  /** IFL's own Shift value — derived from insert time, wrong for many rows (SCHEMA.md). */
  shift_code_legacy: string | null;
  /** The night-attribution rule that produced shift_date. */
  night_belongs_to: NightBelongsTo | null;
  hanger_num: number | null;
  /** IFL's MachineNo (Source until 5 Aug 2026): the winder that weighed it, 1..14. */
  source_station: number | null;
  lifter_station: number | null;
  /** RAW grams as recorded; the weight basis (gross/net, Q4/Q5) is applied at read time. */
  weight_g: number | null;
  /** The scale's own in-range bit — the ONE status vocabulary (redesign rule 1). */
  in_range: boolean | null;
  /** Phase 2 PLC path, deferred (Q22): always null. */
  cone_id: string | null;
  cone_id_source: 'plc_direct' | 'sql_sync' | null;
  /** PDAS MaterialId (sms.product.product_id); null when attribution_method is 'none'. */
  material_id: number | null;
  lot_code: string | null;
  attribution_method: AttributionMethod;
  attribution_confidence: AttributionConfidence | null;
  /** Ordinal within a merge-key collision group (DQ-2); 0 when unique. */
  ingest_seq: number;
  merge_key_is_unique: boolean;
}

/** sms.sack_event — one row per sack weighing (migrations 004, 023, 024, 025, 029). */
export interface SackReading extends ProvenanceColumns {
  sack_event_id: number;
  line_id: number;
  /** IFL's Date — sacks have no ProductionDate, so the insert time IS the event time (DQ-5). */
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  /** Always true today: says production_ts_utc is the insert time, so a reader can caveat it. */
  production_ts_is_insert_time: boolean;
  shift_code: ShiftCode;
  shift_date: Date;
  shift_code_legacy: string | null;
  night_belongs_to: NightBelongsTo | null;
  /** IFL's SackNum — NOT a key, it resets to 0 (SCHEMA.md DQ-3). */
  sack_num: number | null;
  /** RAW kg as recorded; tare (Q4/Q5) applied at read time. */
  weight_kg: number | null;
  in_range: boolean | null;
  material_id: number | null;
  lot_code: string | null;
  attribution_method: AttributionMethod;
  attribution_confidence: AttributionConfidence | null;
  ingest_seq: number;
  merge_key_is_unique: boolean;
}

/** sms.reject_event — one row per rejected cone, from either reject table (migrations 008, 023, 024, 025, 029). */
export interface RejectEvent extends ProvenanceColumns {
  reject_event_id: number;
  line_id: number;
  /** 'quality' from rejectQCS1_*, 'weight' from rejectWeight1_*; the two share source_row_id spaces. */
  reject_type: RejectType;
  production_ts_utc: Date;
  production_ts_utc_ms: number;
  ingest_ts_utc: Date | null;
  shift_code: ShiftCode;
  shift_date: Date;
  shift_code_legacy: string | null;
  night_belongs_to: NightBelongsTo | null;
  hanger_num: number | null;
  source_station: number | null;
  lifter_station: number | null;
  /** Raw TubeInspectResult, quality rejects only; meaning pending Q10 (sms.reject_code labels). */
  tube_inspect_code: number | null;
  material_inspect_code: number | null;
  /** Raw grams, weight rejects only. */
  weight_g: number | null;
  material_id: number | null;
  attribution_method: AttributionMethod;
  attribution_confidence: AttributionConfidence | null;
  ingest_seq: number;
}

/**
 * What the transform BUILDS: the row minus the identity the database assigns,
 * with the two lineage columns it always has. `raw_id` and `source_row_id`
 * are nullable in the tables only because migration 003 pre-dated the raw
 * layer; every row the SQL-sync transform has ever written carries both, and
 * the dedupe (persistCanonical.ts) is keyed on raw_id, so a built row without
 * one is a type error here rather than a silent duplicate there.
 */
type Built<T, Id extends keyof T> = Omit<T, Id> & { source_row_id: number; raw_id: number };
export type ConeReadingInsert = Built<ConeReading, 'cone_event_id'>;
export type SackReadingInsert = Built<SackReading, 'sack_event_id'>;
export type RejectEventInsert = Built<RejectEvent, 'reject_event_id'>;

// ---------------------------------------------------------------- products

/** sms.product — the PDAS Materials mirror (migrations 006, 012, 020). product_id IS PDAS MaterialId. */
export interface ProductRecord {
  product_id: number;
  blend_id: number | null;
  count_id: number | null;
  tube_type_id: number | null;
  /** Today's PDAS setpoint. Judge a reading by product_limit_version, never by this. */
  setpoint_weight_g: number | null;
  active_flag: boolean | null;
  description: string | null;
  lot_code: string | null;
  weight_offset_minus_g: number | null;
  weight_offset_plus_g: number | null;
  color: string | null;
}

/**
 * sms.product_limit_version — the limits in force for a product from
 * effective_from (migration 027). A reading is judged by the version in force
 * at ITS time; the 'pdas_observed' rows record when the mirror first SAW a
 * value, which is a lower bound on when it started (effective_is_lower_bound).
 */
export interface ProductLimitVersion {
  version_id: number;
  product_id: number;
  setpoint_g: number | null;
  offset_minus_g: number | null;
  offset_plus_g: number | null;
  effective_from: Date;
  effective_is_lower_bound: boolean;
  source: 'pdas_observed' | 'sms_write';
  changed_by: number | null;
  reason: string | null;
  recorded_at: Date;
}

// ---------------------------------------------------------------- the line

/** sms.machine — a physical machine on a line (migration 028). Q3 (machine vs station) still open with IFL. */
export interface Machine {
  machine_id: number;
  line_id: number;
  /** IFL's MachineNo as the source reports it; null for machines that never weigh (the packer). */
  machine_no: number | null;
  kind: 'winder' | 'packer' | 'other';
  make: string | null;
  model: string | null;
  name: string;
  is_active: boolean;
  notes: string | null;
  created_at_utc: Date;
}

/** sms.station — a weighing position; station_id IS the source's MachineNo (migrations 006, 028). */
export interface Station {
  station_id: number;
  line_id: number;
  name: string | null;
  /** Free text from before machines were rows; kept for the label. */
  machine: string | null;
  description: string | null;
  machine_id: number | null;
  /** 'confirmed_by_ifl' since migration 035: IFL confirmed machine = station (Q1/Q3, 15 Sep 2026). */
  link_source: 'default_by_number' | 'confirmed_by_ifl' | 'admin' | null;
  is_active: boolean;
}

/** sms.shift_rule — append-only; the newest effective_from wins (migration 006). Q7 (mode) open. */
export interface ShiftRule {
  shift_rule_id: number;
  line_id: number;
  morning_start: Date;
  evening_start: Date;
  night_start: Date;
  mode: ShiftMode;
  night_belongs_to: NightBelongsTo;
  effective_from: Date;
  changed_at: Date;
  changed_by: number | null;
  reason: string | null;
}

/** sms.calibration_adjustment — a physical scale adjustment an engineer logged (migrations 015, 019). */
export interface CalibrationAdjustment {
  adjustment_id: number;
  line_id: number;
  /** null = a whole-line adjustment, not one station's scale. */
  station_id: number | null;
  adjusted_at_utc: Date;
  recorded_at_utc: Date;
  recorded_by: number | null;
  reason: string | null;
  note: string | null;
  amount_g: number | null;
}

// ---------------------------------------------------------------- operations

/** sms.dq_finding — one standing data-quality finding (migration 009; dedup by detail since 016). */
export interface DataQualityEvent {
  finding_id: number;
  run_id: string;
  check_name: string;
  severity: Severity;
  /** Raw short name ('cone_raw') for findings about what the source sent; canonical name otherwise; null for the pass. */
  subject_table: string | null;
  /** raw_id of the first offending row when the finding concerns rows (Phase 3 item 3); else null. */
  subject_ref: number | null;
  detail: string | null;
  detected_at_utc: Date;
}

/** sms.audit_log — who changed what in Setup (migration 014). */
export interface AuditEvent {
  audit_id: number;
  at_utc: Date;
  actor_id: number | null;
  action: string;
  target_type: string;
  target_id: string | null;
  /** Plain-language "old -> new", meant to be read, not parsed. */
  detail: string | null;
}
