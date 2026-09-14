/**
 * Type-level test (roadmap Phase 3 item 1): the transform's row builders are
 * typed against @sms/shared's canonical contracts, so a column added to a
 * table and not to the transform — or vice versa — is a COMPILE error here,
 * which `npm run typecheck` (tsc -b sync-worker includes test files) reports.
 * This is what the deleted events.ts falsely claimed to guarantee: it had
 * fourteen exports and zero importers.
 *
 * The runtime assertions are trivial on purpose; the assignments are the test.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHIFT_BOUNDARIES,
  provenanceOf,
  type ConeReading,
  type ConeReadingInsert,
  type Provenance,
  type RejectEvent,
  type RejectEventInsert,
  type SackReading,
  type SackReadingInsert,
} from '@sms/shared';
import { mapCone, mapReject, mapSack, type TransformRules } from './transform.js';

const dt = (iso: string) => new Date(iso + 'Z');
const rules: TransformRules = {
  lineId: 1,
  shift: { boundaries: DEFAULT_SHIFT_BOUNDARIES, nightBelongsTo: 'start_day', mode: 'corrected' },
  sourceSystem: 'ifl_sql',
};
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
  src_SackNum: 12,
  src_TubeInspectResult: 1,
  src_MaterialInspectResult: 0,
};

describe('the transform builds rows assignable to the canonical contracts', () => {
  it('cone', () => {
    const built: ConeReadingInsert = mapCone(raw, rules);
    const stored: ConeReading = { ...built, cone_event_id: 1 };
    const prov: Provenance = provenanceOf(stored);
    expect(prov.ingestRunId).toBe(raw.ingest_run_id);
    expect(prov.sourceEpoch).toBe(9);
    expect(prov.rawId).toBe(7);
  });

  it('sack', () => {
    const built: SackReadingInsert = mapSack(raw, rules);
    const stored: SackReading = { ...built, sack_event_id: 1 };
    expect(provenanceOf(stored).sourceTsUtc).toEqual(raw.src_Date);
  });

  it('reject', () => {
    const built: RejectEventInsert = mapReject(raw, 'quality', rules);
    const stored: RejectEvent = { ...built, reject_event_id: 1 };
    expect(provenanceOf(stored).attributionMethod).toBe('source_column');
  });

  it('a built row is not a stored row: the identity is the database\'s to assign', () => {
    // @ts-expect-error — cone_event_id is missing on what the transform builds
    const stored: ConeReading = mapCone(raw, rules);
    expect(stored.cone_event_id).toBeUndefined();
  });

  it('a stored row is not an insert row when it lacks the lineage the transform always has', () => {
    const noLineage = { ...mapCone(raw, rules), cone_event_id: 1, raw_id: null as number | null };
    // @ts-expect-error — raw_id may be null on a read row, never on a built one
    const built: ConeReadingInsert = noLineage;
    expect(built).toBeDefined();
  });
});
