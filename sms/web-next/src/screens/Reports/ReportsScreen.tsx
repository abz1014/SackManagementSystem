/**
 * Reports (task E11). TRACE A1-084, A1-085, A1-086, A3-080, A5-01..A5-31 (see the commit body).
 *
 * What this screen answers: what did the line make over this period, on paper (PDF, Excel, CSV)?
 *
 *  - FIVE CARDS, EIGHTEEN REPORTS. The cards group the report types by who reads them; every type stays one click
 *    away inside its card and keeps its `rt` value, so an old link lands on the right report (decision E-5).
 *  - THE DEFAULT FOLLOWS RANK (E-1). Managers open on the management summary (rank 3 on the server); everyone
 *    else opens on the daily report. A viewer or engineer is told the summary needs a manager account.
 *  - ONE PERIOD. The builder writes the shared period; the preview, Print and the downloads are the same query.
 *  - DOWNLOADS ARE RANK 3 AND ABSENT BELOW IT. A half-loaded report cannot be printed or downloaded.
 *  - PRINT IS KEYED TO A STABLE CLASS (E-6): this screen puts `report-print` on the page's <main>, and print.css
 *    binds the landscape page to `main.report-print`, never to a label that a copy edit could change.
 */
import { C, withFragments, FRAGMENTS } from '../../copy';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { getProducts, getStations, type ReportFilters } from '../../bridge/api';
import { useData, useRange } from '../../data';
import { usePeriod } from '../../data/usePeriod';
import { live, type period as PeriodNs } from '../../bridge/lib';
import { routeFor } from '../../ui/nav';
import type { Route } from '../../route';
import type { ScreenProps } from '../registry';
import { Builder } from './Builder';
import { Cards } from './Cards';
import { ReportDocument } from './ReportDocument';
import { cardOf, typeFromKeys, variantOf } from './model';
import { useReport } from './useReport';
import './reports.css';
import './legacy-report.css';
import './print.css';
const R = withFragments(C.reports, FRAGMENTS.reportsParts);

const SHIFTS: readonly string[] = ['morning', 'evening', 'night'];
const intKey = (v: string | undefined): number | null => (v !== undefined && /^\d{1,9}$/.test(v) ? Number(v) : null);

export function ReportsScreen({ route, rank, user, go }: ScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const periodState = usePeriod();
  const { period } = periodState;
  const { line } = live.useLive();
  const range = useRange();

  const type = typeFromKeys(route.keys, rank);
  const rsh = route.keys.rsh;
  const filters: ReportFilters = {
    shift: rsh && SHIFTS.includes(rsh) ? (rsh as PeriodNs.ShiftCode) : undefined,
    station: intKey(route.keys.st) ?? undefined,
    product: intKey(route.keys.pr) ?? undefined,
  };
  const variant = variantOf(type);
  const state = useReport(type, period, filters, rank, variant.title);

  // E-6: the stable print hook. The shell owns <main>; the screen adds the class while it is mounted.
  useLayoutEffect(() => {
    const main = rootRef.current?.closest('main');
    main?.classList.add('report-print');
    return () => main?.classList.remove('report-print');
  }, []);

  const stations = useData('the station list', () => getStations(), 'stations', { live: false });
  const products = useData('the product list', () => getProducts(), 'products', { live: false });

  const setKey = useCallback(
    (k: string, v: string | null, replace = true) => {
      const keys = { ...route.keys };
      if (v === null || v === '') delete keys[k];
      else keys[k] = v;
      go({ ...route, keys }, replace ? { replace: true } : undefined);
    },
    [go, route],
  );
  const onType = useCallback((t: typeof type) => setKey('rt', t, false), [setKey]);

  const preview = () => {
    const el = previewRef.current;
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };

  const names = stations.data?.stations ?? [];
  const productList = products.data?.products ?? [];
  const today = line?.shift.shiftDate ?? null;
  const held = range.data?.minDate && range.data.maxDate ? { minDate: range.data.minDate, maxDate: range.data.maxDate } : null;

  const openStation = (n: number) => go({ ...route, sheet: { kind: 'station', id: String(n) } });
  const openCode = (code: string) => {
    const base: Route = routeFor(route, { s: 'quality', t: 'rejects' });
    go({ ...base, keys: { ...base.keys, jc: code } });
  };

  return (
    <div className="rp-root" ref={rootRef}>
      <div className="rp-title no-print">
        <h1>{R.pageTitle}</h1>
        <p className="rp-title__sentence">{R.intro}</p>
      </div>

      <div className="rp-grid no-print">
        <Cards rank={rank} type={type} onPick={onType} />
        <Builder
          type={type}
          rank={rank}
          period={periodState}
          today={today}
          range={held}
          filters={filters}
          state={state}
          stations={{ names, failed: stations.error !== null && !stations.data }}
          products={{ list: productList, failed: products.error !== null && !products.data }}
          onType={onType}
          onFilter={(k, v) => setKey(k, v)}
          onPreview={preview}
        />
      </div>

      <section className="rp-preview" id="rp-preview" ref={previewRef} tabIndex={-1} aria-labelledby="rp-preview-h">
        <div className="rp-preview__hd no-print">
          <h2 id="rp-preview-h">{R.preview.heading}</h2>
          <span className="rp-preview__cap">{cardOf(type).title}, {variant.title}. {R.preview.pageNote}</span>
        </div>
        <ReportDocument
          type={type}
          period={period}
          state={state}
          user={user}
          names={names}
          products={productList}
          onOpenStation={openStation}
          onOpenCode={openCode}
          onSelectPeriod={periodState.setParams}
        />
      </section>
    </div>
  );
}
