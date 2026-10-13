/**
 * The fetches behind Quality > Stations and the station sheet. Each is its own named part, so a
 * failure names itself (a screen never collapses several fetches into one blanket error).
 * The 14-day pattern check is fetched with the period only as its END anchor: the detectors
 * ignore the period (CLAUDE.md, redesign rule 3).
 */
import { getProduction, getRejects, getWeightStations, listAdjustments } from '../../../bridge/api';
import { period as P } from '../../../bridge/lib';
import { useData, type DataState } from '../../../data';
import type { Envelope, ProductionData, RejectData, WeightStationsData, AdjustmentList } from '../../../bridge/api';
import { S } from './stationsCopy';

function key(period: P.Period): string {
  const q = P.periodQuery(period);
  return [q.from, q.to, q.shift ?? '', q.fromShift ?? '', q.toShift ?? '', period.live ? q.tsTo : ''].join('|');
}

/** Cones, rejected cones and the scale's in-range share, one row per station, for the period. */
export function useStationCounts(period: P.Period): DataState<Envelope<ProductionData>> {
  return useData(
    S.partCounts,
    () => getProduction({ ...P.periodQuery(period), groupBy: 'station' }),
    `stations:counts:${key(period)}`,
    { live: period.live },
  );
}

/** One station's counts for the period (groupBy none). */
export function useOneStationCounts(period: P.Period, station: number): DataState<Envelope<ProductionData>> {
  return useData(
    S.partSheetCounts,
    () => getProduction({ ...P.periodQuery(period), station, groupBy: 'none' }),
    `station:${station}:counts:${key(period)}`,
    { live: period.live },
  );
}

/** The pattern check: the trailing window ends at the period's end; the period rows ride along. */
export function usePatternCheck(period: P.Period, part: string): DataState<Envelope<WeightStationsData>> {
  const pq = P.periodQuery(period);
  return useData(
    part,
    () =>
      getWeightStations({
        trailingDays: P.TRAILING_DAYS,
        to: period.to,
        periodFrom: period.from,
        periodTo: period.to,
        shift: period.shift,
        periodFromShift: pq.fromShift,
        periodToShift: pq.toShift,
      }),
    `stations:pattern:${key(period)}`,
    { live: period.live, intervalMs: 5 * 60_000 },
  );
}

/** Line-wide reasons for the period (the API does not split them by station). */
export function useLineReasons(period: P.Period): DataState<Envelope<RejectData>> {
  const q = P.periodQuery(period);
  return useData(
    S.partSheetReasons,
    () => getRejects(q.from, q.to, q.fromShift, q.toShift),
    `stations:reasons:${key(period)}`,
    { live: period.live },
  );
}

/** This station's adjustments plus the line-wide ones. Fetched once; refresh() after a save. */
export function useAdjustments(station: number): DataState<AdjustmentList> {
  return useData(S.partSheetLog, () => listAdjustments({ station }), `station:${station}:adjustments`, { live: false });
}
