import { getMachinesRunning, getProduction, getRange, getStationStatus } from '../bridge/api';
import { period as P } from '../bridge/lib';
import { useData, type DataState } from './useData';
import type { Compare } from './usePeriod';

type Api = typeof import('../bridge/api');
type Unwrap<T> = T extends Promise<infer R> ? R : never;
export type ProductionResult = Unwrap<ReturnType<Api['getProduction']>>;
export type StationStatusResult = Unwrap<ReturnType<Api['getStationStatus']>>;
export type MachinesRunningResult = Unwrap<ReturnType<Api['getMachinesRunning']>>;
export type RangeResult = Unwrap<ReturnType<Api['getRange']>>;

function periodKey(p: P.Period): string {
  return [p.key, p.from, p.to, p.shift ?? '', p.fromShift ? P.encodeShiftRef(p.fromShift) : '', p.toShift ? P.encodeShiftRef(p.toShift) : ''].join('|');
}

/** Production for the period; with `compare`, data.previous carries the comparison period. Polls only a live period. */
export function useProduction(period: P.Period, compare: Compare | null = null): DataState<ProductionResult> {
  return useData(
    'production',
    () => getProduction({ ...P.periodQuery(period), groupBy: 'none', ...(compare ? { compare } : {}) }),
    `production:${periodKey(period)}:${compare ?? ''}:${period.live ? period.tsTo : ''}`,
    { live: period.live },
  );
}

/** Per-station status. The route takes no instant cap, so tsTo is dropped. */
export function useStationStatus(period: P.Period): DataState<StationStatusResult> {
  const { tsTo: _tsTo, ...q } = P.periodQuery(period);
  void _tsTo;
  return useData('station status', () => getStationStatus(q), `station-status:${periodKey(period)}`, { live: period.live });
}

/** Which product each winder runs now. Always live: it describes the present. */
export function useMachinesRunning(): DataState<MachinesRunningResult> {
  return useData('machines running', () => getMachinesRunning(null), 'machines-running');
}

/** First and last production day held. Fetched once. */
export function useRange(): DataState<RangeResult> {
  return useData('data range', () => getRange(), 'range', { live: false });
}
