import { useCallback, useEffect, useState } from 'react';
import { getLive, getRange } from '../bridge/api';
import { period as P } from '../bridge/lib';
import { useData } from './useData';

export type Compare = 'prev' | 'week';

export interface PeriodState {
  params: P.PeriodParams;
  /** null until the plant clock (/api/live) has been read. */
  period: P.Period | null;
  compare: Compare | null;
  /** 'error' names the part that could not be read; no period is invented then. */
  status: 'loading' | 'error' | 'ok';
  failed: string[];
  setParams: (p: P.PeriodParams) => void;
  setCompare: (c: Compare | null) => void;
}

const EVT = 'sms-next:urlchange';

export function parseCompare(sp: URLSearchParams): Compare | null {
  const v = sp.get('cmp');
  return v === 'prev' || v === 'week' ? v : null;
}

function useSearch(): string {
  const [s, setS] = useState(() => window.location.search);
  useEffect(() => {
    const on = () => setS(window.location.search);
    window.addEventListener('popstate', on);
    window.addEventListener(EVT, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(EVT, on);
    };
  }, []);
  return s;
}

function push(mutate: (sp: URLSearchParams) => void): void {
  const sp = new URLSearchParams(window.location.search);
  mutate(sp);
  const qs = sp.toString();
  window.history.pushState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  window.dispatchEvent(new Event(EVT));
}

export function usePeriod(): PeriodState {
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const params = P.parsePeriodParams(sp);
  const compare = parseCompare(sp);
  const at = sp.get('at');
  const liveD = useData('plant clock', () => getLive(at), `period:live:${at ?? 'now'}`);
  const rangeD = useData('data range', () => getRange(), 'period:range', { live: false });

  const line = liveD.data?.data.lines[0] ?? null;
  const period = line
    ? P.resolvePeriod(
        params.key,
        {
          shiftDate: line.shift.shiftDate,
          shiftCode: line.shift.code,
          shiftStartUtc: line.shift.startUtc,
          plantNowUtc: line.plantNowUtc,
          dataAsOfUtc: line.dataAsOfUtc ?? (rangeD.data?.maxDate ? `${rangeD.data.maxDate}T00:00:00Z` : null),
          firstDay: rangeD.data?.minDate ?? null,
        },
        params.picked,
        params.range,
      )
    : null;

  // A failed range fetch is named, never silent: the period may still resolve
  // from the live anchor, but firstDay / the data-as-of fallback are then missing.
  const failed = [
    ...(liveD.status === 'error' ? [liveD.part] : []),
    ...(rangeD.error !== null ? [rangeD.part] : []),
  ];
  const status = liveD.status === 'error' ? 'error' : period ? 'ok' : 'loading';

  const setParams = useCallback((p: P.PeriodParams) => push((s) => P.writePeriodParams(s, p)), []);
  const setCompare = useCallback(
    (c: Compare | null) => push((s) => (c ? s.set('cmp', c) : s.delete('cmp'))),
    [],
  );
  return { params, period, compare, status, failed, setParams, setCompare };
}
