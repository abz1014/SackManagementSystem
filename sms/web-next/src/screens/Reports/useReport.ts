/**
 * The one report fetch of the Reports screen: the type, the period and the filters become one query
 * (queryFor, the same one the exports use), so Preview, Print and every download describe the same report.
 */
import { getReportOf, type ReportFilters, type ReportQuery, type ReportResponse, type ReportType } from '../../bridge/api';
import { live, type period as PeriodNs } from '../../bridge/lib';
import { pollKey, queryFor } from '../../bridge/report';
import { useData, type DataState } from '../../data';
import { canRead } from './model';

type Period = PeriodNs.Period;
type Envelope = Awaited<ReturnType<typeof getReportOf>>;

/** A request that never settles: the part stays "loading" until its inputs exist. */
const wait = (): Promise<never> => new Promise<never>(() => {});

export interface ReportState {
  /** The query the preview, Print and the exports all share; null until the plant clock is known. */
  q: ReportQuery | null;
  /** Rank is high enough to read this type. When false nothing is fetched. */
  readable: boolean;
  /** The response only when it names THIS type (a poll keeps the last good answer while a new key loads). */
  data: ReportResponse<ReportType> | null;
  /** The failed fetch's message, or null. A failed fetch is named by the preview, never drawn as an empty report. */
  error: string | null;
  fetch: DataState<Envelope | null>;
}

export function useReport(type: ReportType, period: Period | null, filters: ReportFilters, rank: number, title: string): ReportState {
  const { asOf } = live.useLive();
  const readable = canRead(type, rank);
  const q = period ? queryFor(type, period, filters, asOf) : null;
  const key = q ? `${pollKey(type, q)}:${readable ? 'ok' : 'no'}` : 'rp:wait';
  const fetch = useData<Envelope | null>(
    title,
    () => (q && readable ? getReportOf(type, q) : readable ? wait() : Promise.resolve(null)),
    key,
    { live: period?.live === true, intervalMs: period?.live ? 60_000 : 10 * 60_000 },
  );
  const env = fetch.data;
  const data = env && env.data.header.reportType === type ? env.data : null;
  return { q, readable, data, error: fetch.error, fetch };
}
