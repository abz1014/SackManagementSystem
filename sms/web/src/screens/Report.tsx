/**
 * Report — "What did the line make over this period, on paper."
 *
 * The reporting half of requirement 8 and the sack log of requirement 6.
 * Since roadmap Phase 8 (15 Sep 2026) it is ONE surface for the NINE report
 * types IFL's quotation names — Daily · Shift · Product · Machine/station ·
 * Rejects · Cone weight · Sacks · Calibration · Management summary — plus a
 * TENTH, Product by machine, added on IFL's 15 Sep 2026 answer to Q28 (the
 * per-machine, per-shift changeover view Hassan asked for by name). Each
 * one composed response from `/api/reports/<type>`, one section set under
 * `screens/report/`, one CSV from the server (rank 3, audited), and one
 * printed page with a header naming the line, the period, when it was
 * generated on the plant's clock, by whom, and from which SMS version.
 *
 * Two things it must say that the old one did not, and still does:
 *  - coverage FIRST, before a single figure, because "this quarter" on a
 *    19-day copy is 19 days of a 92-day period;
 *  - one sentence under the sack totals explaining why sack stock per
 *    machine is missing.
 *
 * Roadmap Phase 2b (16 Sep 2026): the report type and its filters now DO live
 * in the URL — a user who picks "Rejects" and pastes the link used to send a
 * colleague to Daily instead, the worst of the ten defects that phase fixed.
 * The type is App.tsx's `rt`; the shift override is `rsh`; station and
 * product are the SHARED `st`/`pr` keys Weight's chart selector and Readings'
 * station chip also read and write (see App.tsx's Route note). Switching
 * type no longer prunes a filter the new type does not take — `acceptsFilter`
 * already keeps it out of both the query (`queryFor`) and the chip row below,
 * so there is nothing left for pruning to protect, and NOT pruning is what
 * lets the shared station/product survive a type change instead of a report
 * silently wiping a selection Weight or Rejects still wants.
 */
import { useMemo } from 'react';
import { usePolling, useLive } from '../lib/live';
import { W } from '../lib/words';
import type { Period, ShiftCode } from '../lib/period';
import { Block, Failed, SkelChart, SkelFigures, SkelLines } from '../ui/bits';
import { fmtDayLong, fmtInt } from '../lib/fmt';
import {
  getReportOf, reportExportUrl, getStations, getProducts, REPORT_TYPES, ROLE_RANK, rejectCodeParam,
  type AuthUser, type ProductOption, type RejectReason, type ReportFilters, type ReportHeader, type ReportResponse, type ReportType, type StationRow,
} from '../api';
import { distinctProductLabels } from '../lib/productLabel';
import { EXPORT_MIN_RANK, FILTERS_BY_TYPE, pollKey, queryFor, REPORT_MIN_RANK } from './report/model';
import { PrintHead, generatedLine } from './report/PrintHead';
import { fmtDayShort } from './report/shared';
import { DailySection } from './report/Daily';
import { ShiftSection } from './report/Shift';
import { ProductSection } from './report/Product';
import { StationSection } from './report/Station';
import { RejectSection } from './report/Reject';
import { ConeWeightSection } from './report/ConeWeight';
import { SackSection } from './report/Sack';
import { CalibrationSection } from './report/Calibration';
import { SummarySection } from './report/Summary';
import { MachineProductSection } from './report/MachineProduct';

export function ReportScreen({
  period,
  user,
  type,
  onTypeChange,
  filters,
  onShiftChange,
  onStationChange,
  onProductChange,
  onOpenStation,
  onOpenCode,
}: {
  period: Period;
  user: AuthUser;
  type: ReportType;
  onTypeChange: (t: ReportType) => void;
  filters: ReportFilters;
  onShiftChange: (s: ShiftCode | undefined) => void;
  onStationChange: (v: number | null) => void;
  onProductChange: (v: number | null) => void;
  /**
   * Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md §6.1
   * "Report · any total → the screen that explains it" — Report had no
   * outbound link of any kind). Opens the station sheet over this report;
   * the station and machine-product sections are the only ones that name a
   * station per row.
   */
  onOpenStation: (station: number) => void;
  /** Same pass: the reject report's reasons are the only rows on this screen
   *  that name a reject code, so the code hop from §6.5 lands here. */
  onOpenCode: (code: string) => void;
}) {
  const { line, asOf } = useLive();
  const rank = ROLE_RANK[user.role] ?? 1;
  const allowed = FILTERS_BY_TYPE[type];

  // Station names and the product list, for the filter chips. Fetched once
  // each; both are small.
  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');
  const products = usePolling(() => getProducts(), 10 * 60_000, 'products');
  const names: StationRow[] = stations.data?.stations ?? [];
  const productList: ProductOption[] = products.data?.products ?? [];
  // Six PDAS materials share one description on this line; the chip appends what differs.
  const productLabels = useMemo(() => distinctProductLabels(productList), [productList]);

  const q = queryFor(type, period, filters, asOf);
  const canRead = rank >= REPORT_MIN_RANK[type];
  const r = usePolling(
    () => (canRead ? getReportOf(type, q) : Promise.resolve(null)),
    period.live ? 60_000 : 10 * 60_000,
    `${pollKey(type, q)}:${canRead ? 'ok' : 'no'}`,
  );

  // usePolling keeps the LAST GOOD answer while a new key loads, so for a
  // moment after the type changes `r.data` is the previous report. Only a
  // response that names this type is this type's data; anything else is
  // the skeleton, not a crash on the wrong shape.
  const data = r.data && r.data.data.header.reportType === type ? r.data.data : null;
  const header = data?.header ?? null;

  return (
    <>
      <PrintHead header={header} />
      <div className="page">
        <div className="head-row">
          <div>
            <p className="q no-print">{W.reports.question[type]}</p>
            <h1 className="wide">{headline(type, data, period)}</h1>
          </div>
          <div className="head-actions">
            {/* Print and Export sit at the TOP of the screen. A control the
                reader has to scroll past the content to find is a control they
                do not know exists. Both are disabled while the report is still
                arriving: a half-loaded report must not be printable. Export is
                a LINK to the server's CSV, XLSX or PDF (rank 3, audited as
                `export.csv` / `export.xlsx` / `export.pdf`) and is absent for a role the
                server would refuse — a 403 is a bug, not a state. CSV stays
                first and is what a plain click reaches, so nothing already
                depending on this control's position or default changes. */}
            <div className="row no-print">
              <button type="button" className="btn" disabled={!data} onClick={() => window.print()}>
                {W.report.print}
              </button>
              {rank >= EXPORT_MIN_RANK && canRead && (
                data ? (
                  <>
                    <a className="btn" href={reportExportUrl(type, q)}>{W.report.exportCsv}</a>
                    <a className="btn" href={reportExportUrl(type, q, 'xlsx')}>{W.report.exportXlsx}</a>
                    <a className="btn" href={reportExportUrl(type, q, 'pdf')}>{W.report.exportPdf}</a>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn" disabled>{W.report.exportCsv}</button>
                    <button type="button" className="btn" disabled>{W.report.exportXlsx}</button>
                    <button type="button" className="btn" disabled>{W.report.exportPdf}</button>
                  </>
                )
              )}
            </div>
            <Verdict type={type} data={data} lineName={line?.lineName ?? ''} />
          </div>
        </div>

        {/* The nine report types, as chips that wrap. Then the filters the
            chosen type accepts — never one it would refuse. */}
        <div className="row no-print" style={{ marginTop: 18 }} role="group" aria-label={W.reports.selectorLabel}>
          {REPORT_TYPES.map((t) => (
            <button key={t} type="button" className={`chip${t === type ? ' on' : ''}`} aria-pressed={t === type} onClick={() => onTypeChange(t)}>
              {W.reports.type[t]}
            </button>
          ))}
        </div>
        {allowed.length > 0 && (
          <div className="row no-print" style={{ marginTop: 10 }}>
            {allowed.includes('shift') && (
              <label className="chip">
                {W.reports.filterShift}
                <select
                  value={filters.shift ?? ''}
                  aria-label={W.reports.filterShift}
                  onChange={(e) => onShiftChange((e.target.value || undefined) as ReportFilters['shift'])}
                  style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
                >
                  <option value="">{period.shift ? W.shiftName[period.shift] : W.reports.all}</option>
                  <option value="morning">{W.shiftName.morning}</option>
                  <option value="evening">{W.shiftName.evening}</option>
                  <option value="night">{W.shiftName.night}</option>
                </select>
              </label>
            )}
            {/* UX Phase 7 Brief 1: `names.length > 0` alone could not tell a
                failed /api/stations from a genuinely empty roster — a failed
                fetch used to just drop the chip, offering the report with a
                filter it actually has but silently could not show. */}
            {allowed.includes('station') && (stations.error && !stations.data ? (
              <span className="chip mut">{W.reports.filterStationUnavailable}</span>
            ) : names.length > 0 && (
              <label className="chip">
                {W.reports.filterStation}
                <select
                  value={filters.station ?? ''}
                  aria-label={W.reports.filterStation}
                  onChange={(e) => onStationChange(e.target.value === '' ? null : Number(e.target.value))}
                  style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
                >
                  <option value="">{W.reports.all}</option>
                  {names.map((s) => (
                    <option key={s.stationId} value={s.stationId}>{s.name?.trim() || `Station ${s.stationId}`}</option>
                  ))}
                </select>
              </label>
            ))}
            {allowed.includes('product') && (products.error && !products.data ? (
              <span className="chip mut">{W.reports.filterProductUnavailable}</span>
            ) : productList.length > 0 && (
              <label className="chip">
                {W.reports.filterProduct}
                <select
                  value={filters.product ?? ''}
                  aria-label={W.reports.filterProduct}
                  onChange={(e) => onProductChange(e.target.value === '' ? null : Number(e.target.value))}
                  style={{ border: 0, background: 'none', padding: 0, font: 'inherit' }}
                >
                  <option value="">{W.reports.all}</option>
                  {productList.map((p) => (
                    <option key={p.productId} value={p.productId}>{productLabels.get(p.productId) ?? p.description ?? `Product ${p.productId}`}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>

      {!canRead ? (
        <Block first>
          <p className="state err">{W.reports.notAllowed}</p>
        </Block>
      ) : r.error && !data ? (
        <Block first>
          <Failed error={r.error} onRetry={r.refresh} />
        </Block>
      ) : !data ? (
        <ReportSkeleton />
      ) : (
        <Sections type={type} data={data} names={names} products={productList} onOpenStation={onOpenStation} onOpenCode={onOpenCode} />
      )}
    </>
  );
}

/** One switch, so a new type is one line here and one file under report/. */
function Sections({
  type, data, names, products, onOpenStation, onOpenCode,
}: {
  type: ReportType;
  data: ReportResponse<ReportType>;
  names: StationRow[];
  products: ProductOption[];
  onOpenStation: (station: number) => void;
  onOpenCode: (code: string) => void;
}) {
  switch (type) {
    case 'daily': return <DailySection d={(data as ReportResponse<'daily'>).report} />;
    case 'shift': return <ShiftSection d={(data as ReportResponse<'shift'>).report} />;
    case 'product': return <ProductSection d={(data as ReportResponse<'product'>).report} products={products} />;
    case 'station': return <StationSection d={(data as ReportResponse<'station'>).report} names={names} onOpen={onOpenStation} />;
    case 'reject': return <RejectSection d={(data as ReportResponse<'reject'>).report} onOpenCode={(r: RejectReason) => onOpenCode(rejectCodeParam(r))} />;
    case 'cone-weight': return <ConeWeightSection d={(data as ReportResponse<'cone-weight'>).report} names={names} />;
    case 'sack': return <SackSection d={(data as ReportResponse<'sack'>).report} products={products} />;
    case 'calibration': return <CalibrationSection d={(data as ReportResponse<'calibration'>).report} names={names} />;
    case 'management-summary': return <SummarySection d={(data as ReportResponse<'management-summary'>).report} products={products} />;
    case 'machine-product': return <MachineProductSection d={(data as ReportResponse<'machine-product'>).report} onOpen={onOpenStation} />;
  }
}

/* --------------------------------------------------------------- headline */

/**
 * Coverage first, always: a period with holes must say so before its totals.
 * Reports without a coverage block of their own (rejects, stations, cone
 * weight, calibration) say the period and their headline count.
 */
function headline(type: ReportType, data: ReportResponse<ReportType> | null, period: Period): string {
  const label = `${fmtDayLong(period.from)} to ${fmtDayLong(period.to)}`;
  const short = period.from === period.to ? fmtDayLong(period.from) : label;
  if (!data) return short;
  const rep = data.report as { coverage?: { daysWithData: number; daysInPeriod: number; complete: boolean; firstDayWithData: string | null; lastDayWithData: string | null } };
  const c =
    type === 'management-summary'
      ? (data as ReportResponse<'management-summary'>).report.coverage.current
      : type === 'shift'
        ? (data as ReportResponse<'shift'>).report.shifts[0]?.coverage
        : rep.coverage;
  if (!c) return `${W.reports.type[type]} · ${short}`;
  if (c.daysWithData === 0) return W.report.coverageNone(short);
  if (c.complete) return W.report.coverageAll(short, c.daysInPeriod);
  return W.report.coveragePartial(
    short, c.daysWithData, c.daysInPeriod,
    c.firstDayWithData ? fmtDayLong(c.firstDayWithData) : '—',
    c.lastDayWithData ? fmtDayLong(c.lastDayWithData) : '—',
  );
}

/**
 * THE VERDICT MARK — the one ink fill in the application, and the reason
 * this is the only screen carrying it: Report is the only one whose output
 * leaves the building. It states the figure that was signed for, its period
 * and its line, and who generated it. Absent when the period holds no
 * production days: there is nothing to sign for. Present on the daily
 * report and the management summary, the two pages a GM signs.
 */
function Verdict({ type, data, lineName }: { type: ReportType; data: ReportResponse<ReportType> | null; lineName: string }) {
  if (!data) return null;
  let totals: { cones: number; sacks: number; sackWeightKg: number } | null = null;
  if (type === 'daily') {
    const d = (data as ReportResponse<'daily'>).report;
    if (d.coverage.daysWithData > 0) totals = d.totals;
  } else if (type === 'management-summary') {
    const d = (data as ReportResponse<'management-summary'>).report;
    if (d.coverage.current.daysWithData > 0) totals = d.verdict;
  }
  if (!totals) return null;
  const h: ReportHeader = data.header;
  return (
    <div className="verdict">
      <span className="lbl">{W.report.verdict}</span>
      <span className="val">
        {fmtInt(totals.cones)} {W.fig.cones}, {fmtInt(totals.sacks)} {W.fig.sacks},{' '}
        {fmtInt(Math.round(totals.sackWeightKg))} {W.fig.kg}
        <br />
        {fmtDayShort(h.period.from)} – {fmtDayShort(h.period.to)} · {lineName || h.lineName}
      </span>
      <span className="who">{generatedLine(h)}</span>
    </div>
  );
}

/** Report's shape while it loads: coverage sentence, four totals, chart, tables. */
function ReportSkeleton() {
  return (
    <>
      <Block first>
        <SkelFigures n={4} />
      </Block>
      <Block label={W.report.conesPerDay}>
        <SkelChart />
      </Block>
      <Block label={W.report.byDay}>
        <SkelLines n={7} />
      </Block>
    </>
  );
}
