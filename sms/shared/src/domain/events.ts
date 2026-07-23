/**
 * Canonical event shapes — the single source of truth for what a cone/sack
 * weighing IS, independent of where it came from. Both the sync-worker (which
 * produces them) and the api (which serves them) import these, so the shape
 * cannot drift. See ARCHITECTURE.md §2, §3 and SPEC.md §4.
 */

import type { ShiftCode } from './shift.js';

/** Where a row originated. Phase 1 only ever produces 'ifl_sql'. */
export type SourceSystem = 'ifl_sql' | 'plc_direct';

/** Provenance of cone_id — null in Phase 1 (no PLC, no id). */
export type ConeIdSource = 'plc_direct' | 'sql_sync' | null;

/** How product attribution was resolved. Phase 1 default is 'none'. */
export type AttributionMethod =
  | 'none'
  | 'active_material'
  | 'manual_entry'
  | 'cone_id';

export type AttributionConfidence = 'high' | 'low' | 'ambiguous' | null;

export type RejectType = 'quality' | 'weight';

/** The cross-source merge key (SPEC §3.2). Both sources must compute it
 *  identically, using the RAW epoch-ms PLC timestamp — never a converted one. */
export interface MergeKey {
  lineId: number;
  productionTsUtcMs: number;
  hangerNum: number | null;
}

/** Fields every synced row carries so a Phase-2 PLC write is distinguishable. */
export interface Provenance {
  sourceSystem: SourceSystem;
  sourceRowId: number | null;
  ingestRunId: string;
}

/** Weight kept RAW plus a basis tag — interpreted at read time (Q4/Q5). */
export interface RawWeight {
  /** exactly as recorded by the line; never mutated */
  value: number;
  unit: 'kg' | 'g';
}

export interface CanonicalConeEvent {
  kind: 'cone';
  merge: MergeKey;
  productionTsUtc: Date;
  productionTsUtcMs: number;
  ingestTsUtc: Date | null;
  shiftCode: ShiftCode; // corrected, from ProductionDate
  shiftCodeLegacy: string | null; // IFL's original (buggy) value
  sourceStation: number | null;
  lifterStation: number | null;
  weight: RawWeight; // grams
  inRange: boolean | null;
  coneId: string | null; // null in Phase 1
  coneIdSource: ConeIdSource;
  provenance: Provenance;
  mergeKeyIsUnique: boolean;
}

export interface CanonicalSackEvent {
  kind: 'sack';
  merge: MergeKey; // hangerNum null for sacks
  productionTsUtc: Date;
  productionTsUtcMs: number;
  ingestTsUtc: Date | null;
  shiftCode: ShiftCode;
  shiftCodeLegacy: string | null;
  sackNum: number | null; // NOT a key — resets (SCHEMA DQ-3)
  weight: RawWeight; // kg
  inRange: boolean | null;
  provenance: Provenance;
  mergeKeyIsUnique: boolean;
}

export interface CanonicalRejectEvent {
  kind: 'reject';
  merge: MergeKey;
  rejectType: RejectType;
  productionTsUtc: Date;
  productionTsUtcMs: number;
  shiftCode: ShiftCode;
  shiftCodeLegacy: string | null;
  sourceStation: number | null;
  lifterStation: number | null;
  /** raw QC codes, kept verbatim; meaning pending Q10 */
  tubeInspectCode: number | null;
  materialInspectCode: number | null;
  weight: RawWeight | null; // only for weight rejects
  provenance: Provenance;
}

export type CanonicalEvent =
  | CanonicalConeEvent
  | CanonicalSackEvent
  | CanonicalRejectEvent;

export interface AttributionResult {
  materialId: number | null;
  lotCode: string | null;
  method: AttributionMethod;
  confidence: AttributionConfidence;
}

/** Watermark for incremental sync — max source row id seen per table. */
export interface Watermark {
  lineId: number;
  sourceMaxId: number;
}
