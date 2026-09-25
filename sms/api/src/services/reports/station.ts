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
import { andEpoch, noteOf, resolveGenerationScope, type GenerationNote } from '../generation.js';
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
  /**
   * RT-018 (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md): the line-wide
   * target's own retired flag, carried straight through from
   * `getWeightStations`'s own `productActive` — PDAS's MaterialActive, as
   * last mirrored, no retirement TIMESTAMP anywhere in PDAS or its mirror.
   * Null when there was no line-wide target at all.
   */
  productActive: boolean | null;
  thresholdG: number;
  minDaysHeld: number;
  lineRejectRatePct: number | null;
  rows: StationReportRow[];
  note: string;
  /**
   * RT-002/RT-029 (23 Sep 2026 red-team audit): the raw per-station state
   * count below is this report's OWN query, unlike `cones` (production.ts,
   * already generation-scoped) and `rows[].mean/vsLine/...` (weightStations.ts,
   * NOT YET scoped — a held file, reported not edited). Without its own
   * epoch predicate this query pooled the plant's real September generation
   * with the local dev simulator's overlapping one, so a station's own
   * `states` (within+low+high+rejected+unknown) could exceed its own
   * `cones` — an arithmetically impossible row, visible on screen. Scoped
   * to the newest generation in the period, same rule as every other caller
   * of `resolveGenerationScope`.
   */
  generationNote: GenerationNote;
}

export async function getStationReport(
  pool: ConnectionPool,
  lineId: number,
  resolved: ResolvedPeriod,
  _filters: ReportFilters,
): Promise<StationReportData> {
  const { from, to } = resolved;
  // RT-002/RT-029: resolved by THIS service, over the SAME (lineId, from, to)
  // key every other caller of resolveGenerationScope uses — guaranteed to
  // land on the same generation as production.ts's own scoping of `prod`
  // below, without threading a scope through either signature. One extra
  // round trip, accepted per the remediation brief.
  const [ws, prod, ctx, scope] = await Promise.all([
    getWeightStations(pool, lineId, from, to),
    getProduction(pool, lineId, { from, to, groupBy: 'station' }),
    loadStateContext(pool, lineId),
    resolveGenerationScope(pool, lineId, { from, to }, ['cone_event']),
  ]);

  const sReq = pool.request().input('line', mssql.Int, lineId).input('from', mssql.Date, from).input('to', mssql.Date, to);
  const stateCase = bindStateCase(sReq, ctx, '', 'cs');
  const statesWhere = andEpoch(
    'line_id = @line AND shift_date BETWEEN @from AND @to AND source_station IS NOT NULL',
    sReq, scope, 'cone_event',
  );
  const states = await sReq.query<{ st: number; state: string; n: number }>(
    `SELECT source_station AS st, ${stateCase} AS state, COUNT(*) n
       FROM sms.cone_event
      WHERE ${statesWhere}
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
    productActive: ws.productActive ?? null,
    thresholdG: ws.thresholdG,
    minDaysHeld: ws.minDaysHeld,
    lineRejectRatePct: ws.lineRejectRatePct,
    rows,
    note:
      'The mean and the bias are over readings inside the plausibility window; the cone count is every reading. ' +
      'The target is the product in force at the end of the period, line-wide. Weighing data cannot tell a heavy scale from heavy cones.',
    generationNote: noteOf(scope),
  };
}

export const STATION_CSV_HEADERS = [
  'station', 'cones', 'weighed_plausible', 'mean_g', 'vs_line_g', 'vs_target_g', 'days_held', 'flagged',
  'rejected_at_inspection', 'reject_rate_pct', 'cones_in_range_pct', 'last_adjusted_utc',
  'within', 'low', 'high', 'rejected', 'unknown',
  // RT-018 (25 Sep 2026): two columns appended at the END so every existing
  // positional row/index above is untouched. `row_kind` distinguishes an
  // ordinary station row from the one trailing summary row this report's
  // line-wide target fact goes in — the same "trailing row after the table,
  // never a header comment" convention `coneWeight.ts`'s summary kv rows and
  // the generic attribution block (csv.ts) already use; Excel shows a `#`
  // comment header as a mangled first row (CLAUDE.md's "Open question 4").
  // `target_product_active` is null on every ordinary station row (the fact
  // belongs to the PERIOD, not to any one station) and set only on the
  // trailing row.
  'row_kind', 'target_product_active',
] as const;

export function stationCsv(d: StationReportData): CsvTable {
  const rows: CsvRow[] = d.rows.map((r) => [
    r.station, r.cones, r.weighedPlausible, r.meanG, r.vsLineG, r.vsTargetG, r.daysHeld, r.flagged,
    r.rejectedAtInspection, r.rejectRatePct, r.conesInRangePct, r.lastAdjustedUtc,
    r.states.within, r.states.low, r.states.high, r.states.rejected, r.states.unknown,
    'station', null,
  ]);
  // Emitted only when there was a line-wide target at all — the ordinary
  // "no product was in force" case needs no extra row to say so twice.
  if (d.productLabel != null) {
    rows.push([null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'summary', d.productActive]);
  }
  return { headers: STATION_CSV_HEADERS, rows };
}

export type { WeightStationsData };
