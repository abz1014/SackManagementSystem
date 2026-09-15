/**
 * Machine / station report — roadmap Phase 8 item 1 (15 Sep 2026).
 *
 * Per station: cones and rejects (production.ts, `groupBy: 'station'`), the
 * weight mean and its bias against the line AND against the target, days
 * held, the drift flag, the reject rate and the last logged adjustment (all
 * from weightStations.ts — THE one station ranking in the application, so
 * this page cannot rank the fourteen stations differently from the Weight
 * screen), and the five-state counts (the shared CASE grouped by station,
 * which no service does).
 *
 * "Machine" here means the numbered weighing station, station N ↔ winder N
 * (Setup › Stations, the Phase 1 default IFL has not yet confirmed — Q3).
 * Sacks carry no station at any layer, so this report has no sack column.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { bindStateCase, foldStateCounts, loadStateContext, type StateCounts } from '../coneState.js';
import { getProduction } from '../production.js';
import type { ResolvedPeriod } from '../report.js';
import { getWeightStations, type WeightStationsData } from '../weightStations.js';
import { pct, type ReportFilters } from './common.js';
import type { CsvRow, CsvTable } from './csv.js';

export interface StationReportRow {
  station: number;
  /** Every cone weighed at the station (any weight). */
  cones: number;
  /** Cones over the plausible population — what the mean is computed over. */
  weighedPlausible: number;
  meanG: number | null;
  vsLineG: number | null;
  vsTargetG: number | null;
  daysHeld: number;
  flagged: boolean;
  rejectedAtInspection: number;
  rejectRatePct: number | null;
  conesInRangePct: number | null;
  lastAdjustedUtc: string | null;
  states: StateCounts;
}

export interface StationReportData {
  period: ResolvedPeriod;
  lineMeanG: number | null;
  targetG: number | null;
  productLabel: string | null;
  thresholdG: number;
  minDaysHeld: number;
  lineRejectRatePct: number | null;
  rows: StationReportRow[];
  note: string;
}

export async function getStationReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  _filters: ReportFilters,
): Promise<StationReportData> {
  const { from, to } = resolved;
  const [ws, prod, ctx] = await Promise.all([
    getWeightStations(pool, lineId, from, to),
    getProduction(pool, lineId, { from, to, groupBy: 'station' }),
    loadStateContext(pool, lineId),
  ]);

  const sReq = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const stateCase = bindStateCase(sReq, ctx, '', 'cs');
  const states = await sReq.query<{ st: number; state: string; n: number }>(
    `SELECT source_station AS st, ${stateCase} AS state, COUNT(*) n
       FROM sms.cone_event
      WHERE line_id = @line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL
      GROUP BY source_station, ${stateCase}`,
  );
  const statesOf = new Map<number, { state: string; n: number }[]>();
  for (const r of states.recordset) {
    const list = statesOf.get(Number(r.st)) ?? [];
    list.push({ state: r.state, n: Number(r.n) });
    statesOf.set(Number(r.st), list);
  }

  const wsOf = new Map(ws.stations.map((s) => [s.station, s]));
  const prodOf = new Map(prod.rows.map((r) => [Number(r.group), r]));
  const stationsSeen = new Set<number>([...wsOf.keys(), ...prodOf.keys()]);

  const rows: StationReportRow[] = [...stationsSeen]
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((station) => {
      const w = wsOf.get(station);
      const p = prodOf.get(station);
      const cones = p?.cones ?? 0;
      const rejects = p?.rejectedCones ?? 0;
      return {
        station,
        cones,
        weighedPlausible: w?.n ?? 0,
        meanG: w?.meanG ?? null,
        vsLineG: w?.vsLineG ?? null,
        vsTargetG: w?.vsTargetG ?? null,
        daysHeld: w?.daysHeld ?? 0,
        flagged: w?.flagged ?? false,
        rejectedAtInspection: rejects,
        // The station table's own rate when it has one (cones + rejects at
        // the station); the same rule applied to the production counts otherwise.
        rejectRatePct: w?.rejectRatePct ?? pct(rejects, cones + rejects),
        conesInRangePct: p?.conesInRangePct ?? null,
        lastAdjustedUtc: w?.lastAdjustedUtc ?? null,
        states: foldStateCounts(statesOf.get(station) ?? []),
      };
    });

  return {
    period: resolved,
    lineMeanG: ws.lineMeanG,
    targetG: ws.targetG,
    productLabel: ws.productLabel,
    thresholdG: ws.thresholdG,
    minDaysHeld: ws.minDaysHeld,
    lineRejectRatePct: ws.lineRejectRatePct,
    rows,
    note:
      'The mean and the bias are over readings inside the plausibility window; the cone count is every reading. ' +
      'The target is the product in force at the end of the period, line-wide. Weighing data cannot tell a heavy scale from heavy cones.',
  };
}

export const STATION_CSV_HEADERS = [
  'station', 'cones', 'weighed_plausible', 'mean_g', 'vs_line_g', 'vs_target_g', 'days_held', 'flagged',
  'rejected_at_inspection', 'reject_rate_pct', 'cones_in_range_pct', 'last_adjusted_utc',
  'within', 'low', 'high', 'rejected', 'unknown',
] as const;

export function stationCsv(d: StationReportData): CsvTable {
  const rows: CsvRow[] = d.rows.map((r) => [
    r.station, r.cones, r.weighedPlausible, r.meanG, r.vsLineG, r.vsTargetG, r.daysHeld, r.flagged,
    r.rejectedAtInspection, r.rejectRatePct, r.conesInRangePct, r.lastAdjustedUtc,
    r.states.within, r.states.low, r.states.high, r.states.rejected, r.states.unknown,
  ]);
  return { headers: STATION_CSV_HEADERS, rows };
}

export type { WeightStationsData };
