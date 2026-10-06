/** CSS-067 fixture: /api/operations with reject_event DQ findings (long prose in Detail, as the real findings are, and the long "source row cannot be identified" sentence in Source row). Synthetic only. */
import { META } from './mocks';

export function operationsWithFindings(n = 10) {
  const findings = Array.from({ length: n }, (_, i) => ({
    findingId: 100 + i,
    checkName: i % 2 ? 'source_columns_changed' : 'raw_read_without_write',
    severity: i % 3 ? 'WARNING' : 'ERROR',
    subjectTable: 'reject_event',
    detail: `Reading ${i + 1}: the source recorded a weight of exactly 0 g for a cone that was also marked as accepted by the scale, which no working scale produces; the reading is kept as recorded and counted here so a person can decide what it means.`,
    subjectRef: 5000 + i,
    acknowledgeable: true,
    acknowledgedBy: null,
    acknowledgedUtc: null,
    acknowledgedReason: null,
  }));
  return {
    data: {
      sync: [],
      shiftRuleRegimes: [],
      lifetime: { passes: 1, tableRuns: 1, failures: 0, firstRunUtc: null, lastRunUtc: null, medianMs: null, p95Ms: null, slowestMs: null, lastFailure: null },
      schema: [],
      dq: { latestRunId: 'run-1', bySeverity: { WARNING: n }, findings },
      source: { lastProbeOk: true, lastProbeAtUtc: '2026-09-07T11:59:00Z', lastProbeMs: 40, lastHalt: null, halted: [] },
    },
    metadata: META,
  };
}

/** /api/health (not enveloped), minimal and healthy, so Health renders around the findings table. */
export function healthReport() {
  return {
    status: 'ok',
    service: { version: 'test', uptimeSeconds: 3600, startedAtUtc: '2026-09-07T11:00:00Z', pid: 1 },
    database: { ok: true, latencyMs: 4, sizeMb: 100, capMb: 10240, pctOfCap: 1 },
    acquisition: { kind: 'ok', ageSeconds: 40, cadenceSeconds: 60, halted: [], generation: null },
    backup: null,
    degradedReason: null,
    pdasWrite: null,
    disk: null,
    lastVerifyRunUtc: null,
    workerLastPassUtc: null,
    dqAcknowledged: 0,
  };
}

/** /api/reconciliation, empty-but-valid, so the Health reconciliation block renders. */
export function reconciliation() {
  const agg = { n: 0, sumG: null, avgG: null, minG: null, maxG: null };
  return {
    data: {
      from: '2026-09-01', to: '2026-09-07', shift: null, total: agg, plausible: agg, implausible: agg, noWeight: 0,
      byState: { within: agg, low: agg, high: agg, rejected: agg, unknown: agg }, plausibility: { loG: 1500, hiG: 2600 },
      limitWindows: 1, basis: 'as_recorded', note: 'test',
    },
    metadata: META,
  };
}
