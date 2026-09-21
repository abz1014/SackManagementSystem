/**
 * Typed test fixtures for the wire envelopes screens actually consume —
 * typed as `api.ts`'s OWN exported interfaces (never a hand-rolled shape),
 * so a wire-contract change breaks `npm run typecheck` here, not just a
 * test that happened to still pass on a stale fixture.
 *
 * TWO CLOCKS (CLAUDE.md's UI-redesign section, `api/src/services/
 * plantClock.ts`): production timestamps are the plant's own wall clock,
 * LABELLED UTC but not genuine UTC; app-written instants (sync runs, the
 * product timeline, this fixture module's own `Meta.lastSyncUtc`) are
 * genuine UTC. The two are five hours apart on this plant. `LIVE_FIXTURE`
 * below encodes that split on purpose: `line.plantNowUtc` is
 * `2026-09-07T17:00:00Z` (the plant's wall clock, mislabelled UTC) for the
 * SAME real moment `metadata.lastSyncUtc` reports as `2026-09-07T12:00:00Z`
 * (the sync worker's genuine UTC write instant). A fixture that set both
 * clocks to the identical string would silently encode the very bug this
 * project's live screens were built to avoid (see CLAUDE.md's "TWO CLOCKS,
 * NAMED" rule and the 2 Sep 2026 18-minute-lag postmortem) — any screen
 * test built on a single-clock fixture could pass while hiding exactly that
 * defect shape.
 *
 * This file must NOT contain `nominalSetpointG`, `nominalSource` or
 * `FALLBACK_CONE_SETPOINT_G` — `targets.guard.test.ts` scans all of
 * `web/src` (this directory included) for those three identifiers outside
 * their one legitimate home, `weights.ts`, and fails the build if they leak
 * into anything that looks like test/report plumbing.
 *
 * UX Phase 8 Brief A (21 Sep 2026).
 */
import type { Envelope, LiveData, LiveLine, Meta, OperationsData, RegisterPage, RegisterRow } from '../api';

/** Genuine UTC — when the sync worker last wrote, per `plantClock.ts`. */
export const META_FIXTURE: Meta = {
  generatedAtUtc: '2026-09-07T12:00:05Z',
  weightBasis: 'gross',
  shiftMode: 'measured',
  transformVersion: 7,
  lastSyncUtc: '2026-09-07T12:00:00Z',
  sourceAgeSeconds: 42,
};

const LIVE_LINE_FIXTURE: LiveLine = {
  lineId: 1,
  lineName: 'TP1 Line 3 · Unit 2',
  lineShortName: 'Line 3',
  plantName: 'TP1',
  unitName: 'Unit 2',
  // Plant wall clock, LABELLED UTC — five hours ahead of META_FIXTURE's
  // genuine-UTC lastSyncUtc above, for the same real moment. See header.
  plantNowUtc: '2026-09-07T17:00:00Z',
  replay: false,
  plantOffsetMinutes: 300,
  shift: {
    code: 'evening',
    shiftDate: '2026-09-07',
    startUtc: '2026-09-07T09:00:00Z',
    endUtc: '2026-09-07T17:00:00Z',
    elapsedSeconds: 28_800,
    remainingSeconds: 0,
  },
  dataAsOfUtc: '2026-09-07T16:41:00Z',
  ingestLagSeconds: 1140,
  health: {
    kind: 'ok',
    ageSeconds: 90,
    oldestTable: 'sack1_TP1U2',
    cadenceSeconds: 60,
    staleAfterSeconds: 300,
    lagCeilingSeconds: 1800,
  },
  state: {
    status: 'running',
    sinceLastReadingSeconds: 90,
    behindSeconds: 0,
    runStartUtc: '2026-09-07T09:02:00Z',
    stopThresholdSeconds: 120,
  },
  thisShift: {
    cones: 4820,
    conesInRange: 4715,
    conesInRangePct: 97.8,
    rejectedCones: 61,
    sacks: 96,
    sackWeightKg: 2649.6,
    conesPerHour: 602.5,
  },
  recent: { conesLast10Min: 98, conesLastHour: 596, sacksLastHour: 12 },
  lastSack: { ts: '2026-09-07T16:40:12Z', eventId: 88213, sourceRowId: 41207, sackNum: 96, weightKg: 27.6, inRange: true },
  lastCone: { ts: '2026-09-07T16:40:58Z', eventId: 512044, sourceRowId: 132551, station: 5, weightG: 1948.2, inRange: true },
  lastReject: { ts: '2026-09-07T16:22:03Z', rejectType: 'quality', station: 3 },
  stations: [
    { station: 1, cones: 812, lastTs: '2026-09-07T16:40:40Z' },
    { station: 2, cones: 799, lastTs: '2026-09-07T16:40:11Z' },
    { station: 3, cones: 781, lastTs: '2026-09-07T16:39:58Z' },
  ],
};

export const LIVE_FIXTURE: Envelope<LiveData> = {
  data: { lines: [LIVE_LINE_FIXTURE] },
  metadata: META_FIXTURE,
};

const REGISTER_ROW_FIXTURE: RegisterRow = {
  event_id: 512044,
  source_row_id: 132551,
  source_epoch: 2,
  source_epoch_label: 'September copy — cones',
  production_ts_utc: '2026-09-07T16:40:58Z',
  shift_code: 'evening',
  shift_date: '2026-09-07',
  shift_code_legacy: 'evening',
  hanger_num: 14,
  source_station: 5,
  lifter_station: 5,
  weight_g: 1948.2,
  in_range: true,
  material_id: 231,
  lot_code: null,
  merge_key_is_unique: true,
};

export const REGISTER_PAGE_FIXTURE: Envelope<RegisterPage> = {
  data: { rows: [REGISTER_ROW_FIXTURE], total: 1, page: 1, pageSize: 50 },
  metadata: META_FIXTURE,
};

export const OPERATIONS_FIXTURE: Envelope<OperationsData> = {
  data: {
    sync: [
      {
        targetTable: 'sms.cone_event',
        outcome: 'ok',
        watermarkFrom: 132000,
        watermark: 132551,
        epochId: 2,
        epochLabel: 'September copy — cones',
        rowsRead: 551,
        rowsWritten: 551,
        finishedAtUtc: '2026-09-07T12:00:00Z',
        ageSeconds: 42,
      },
    ],
    shiftRuleRegimes: [],
    lifetime: {
      passes: 4102,
      tableRuns: 16408,
      failures: 3,
      firstRunUtc: '2026-08-05T00:01:00Z',
      lastRunUtc: '2026-09-07T12:00:00Z',
      medianMs: 340,
      p95Ms: 890,
      slowestMs: 4210,
      lastFailure: null,
    },
    schema: [
      { table: 'sack1_TP1U2', fingerprint: 'abc123', status: 'enforced-by-worker', epochId: 2, epochLabel: 'September copy — sacks' },
    ],
    dq: { latestRunId: 'dq-2026-09-07T12:00:00Z', bySeverity: { info: 2, warn: 1 }, findings: [] },
  },
  metadata: META_FIXTURE,
};
