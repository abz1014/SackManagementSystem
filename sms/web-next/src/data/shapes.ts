/**
 * Required body paths per API answer (see shape.ts). Only the fields a screen cannot draw without are listed; a field the
 * server may legitimately send as null is fine (null is present), only a hole (undefined) fails the part.
 */
import type { Shape } from './shape';

export const SHAPE = {
  /** /api/production rows: every figure on every screen comes from a row. */
  productionRows: ['data.rows[]'],
  /** /api/station-status: the thresholds feed the band sentence, each station's cone count its tile. */
  stationStatus: ['data.thresholds', 'data.stations[].cones'],
  /** /api/machines/running */
  machinesRunning: ['data.machines[]'],
  /** /api/attention */
  attention: ['data.window'],
  /** /api/sacks/summary */
  sackSummary: ['data.totals', 'data.byShift[]', 'data.byProduct[]', 'data.unattributed'],
  /** /api/rejects */
  rejects: ['data.reasons[]'],
  rejectsWithCounts: ['data.reasons[].count'],
  /** /api/reject-spc */
  rejectSpc: ['data.generations', 'data.buckets[]'],
  /** /api/spc (cone and sack weight control chart) */
  spc: ['data.mean', 'data.stdevOverall', 'data.stdevWithin', 'data.subgroups[]', 'data.spec', 'data.xLimits'],
  /** /api/weight-stations */
  weightStations: ['data.targetG', 'data.stations[]', 'data.disagreement'],
  weightStationsDays: ['data.stations[].days'],
} as const satisfies Record<string, Shape>;
