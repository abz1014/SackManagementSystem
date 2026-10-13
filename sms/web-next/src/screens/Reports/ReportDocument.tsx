/**
 * The preview: one report drawn as a clean page (task E11). The 18 report bodies are the existing renderers
 * (bridge/report.ts); this file only chooses which one, frames it, and says what is wrong when it cannot be drawn.
 *
 *  - NOTHING ASSERTED WITHOUT DATA. A failed fetch names the report that failed; a half-loaded report is a
 *    skeleton, never a figure; a period after the newest reading says when the newest reading is (X-3).
 *  - EVERY EMPTY MACHINE-AND-PRODUCT PERIOD IS EMPTY (E-7): rows with no cones on any station are not "0 machines".
 */
import { useMemo } from 'react';
import {
  rejectCodeParam,
  type AuthUser,
  type ProductOption,
  type RejectReason,
  type ReportHeader,
  type ReportResponse,
  type ReportType,
  type StationRow,
} from '../../bridge/api';
import { fmt, live, period as P } from '../../bridge/lib';
import { W } from '../../bridge/words';
import {
  AfterNewestProvider,
  CalibrationSection,
  ConeWeightSection,
  DailySection,
  ExecSummary,
  GenerationDisclosure,
  MachineProductSection,
  PrintHead,
  PrintNotes,
  ProductSection,
  RejectSection,
  RejectedConesSection,
  RejectedHangersSection,
  RejectedSacksSection,
  RejectedUnknownLifterSection,
  SackSection,
  SackWeightRangeSection,
  SackWeightSummarySection,
  ShiftProductionSection,
  ShiftSection,
  SpsPackingSection,
  StationSection,
  SummarySection,
  fmtDayShort,
  generatedLine,
} from '../../bridge/report';
import { C, withFragments, FRAGMENTS } from '../../copy';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Skeleton } from '../../ui/Skeleton';
import { coverageOf, isEmptyReport, variantOf } from './model';
import type { ReportState } from './useReport';
const R = withFragments(C.reports, FRAGMENTS.reportsParts);

type Data = ReportResponse<ReportType>;

/** The sentence over the preview: coverage first, because "this quarter" on a 34-day record is 34 days of a longer period. */
export function headline(type: ReportType, data: Data | null, period: P.Period, afterNewest: string | null): string {
  const label = `${fmt.fmtDayLong(period.from)} to ${fmt.fmtDayLong(period.to)}`;
  const short = period.from === period.to ? fmt.fmtDayLong(period.from) : label;
  if (!data) return short;
  const c = coverageOf(type, data);
  if (!c) return `${W.reports.type[type]}, ${short}`;
  if (c.daysWithData === 0) return afterNewest ?? W.report.coverageNone(short);
  if (c.complete) return W.report.coverageAll(short, c.daysInPeriod);
  return W.report.coveragePartial(
    short,
    c.daysWithData,
    c.daysInPeriod,
    c.firstDayWithData ? fmt.fmtDayLong(c.firstDayWithData) : '-',
    c.lastDayWithData ? fmt.fmtDayLong(c.lastDayWithData) : '-',
  );
}

/**
 * THE VERDICT MARK: the one ink fill in the report, on the two pages a GM signs (daily and management summary).
 * It states the figure that was signed for, its period and its line, and who generated it. Absent when the period
 * holds no production days: there is nothing to sign for.
 */
export function Verdict({ type, data, lineName }: { type: ReportType; data: Data | null; lineName: string }) {
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
        {fmt.fmtInt(totals.cones)} {W.fig.cones}, {fmt.fmtInt(totals.sacks)} {W.fig.sacks},{' '}
        {fmt.fmtInt(Math.round(totals.sackWeightKg))} {W.fig.kg}
        <br />
        {fmtDayShort(h.period.from)} - {fmtDayShort(h.period.to)} · {lineName || h.lineName}
      </span>
      <span className="who">{generatedLine(h)}</span>
    </div>
  );
}

interface SectionsProps {
  type: ReportType;
  data: Data;
  names: StationRow[];
  products: ProductOption[];
  shiftRangeApplied: boolean;
  onOpenStation: (station: number) => void;
  onOpenCode: (code: string) => void;
  onSelectPeriod?: (p: P.PeriodParams) => void;
}

/** One switch, so a new type is one line here and one file under screens/report/. */
function Sections({ type, data, names, products, shiftRangeApplied, onOpenStation, onOpenCode, onSelectPeriod }: SectionsProps) {
  switch (type) {
    case 'daily': return <DailySection d={(data as ReportResponse<'daily'>).report} onSelectPeriod={onSelectPeriod} />;
    case 'shift': return <ShiftSection d={(data as ReportResponse<'shift'>).report} onSelectPeriod={onSelectPeriod} />;
    case 'product': return <ProductSection d={(data as ReportResponse<'product'>).report} products={products} />;
    case 'station': return <StationSection d={(data as ReportResponse<'station'>).report} names={names} onOpen={onOpenStation} />;
    case 'reject': return <RejectSection d={(data as ReportResponse<'reject'>).report} onOpenCode={(r: RejectReason) => onOpenCode(rejectCodeParam(r))} onSelectPeriod={onSelectPeriod} />;
    case 'cone-weight': return <ConeWeightSection d={(data as ReportResponse<'cone-weight'>).report} names={names} />;
    case 'sack': return <SackSection d={(data as ReportResponse<'sack'>).report} products={products} shiftRangeApplied={shiftRangeApplied} />;
    case 'calibration': return <CalibrationSection d={(data as ReportResponse<'calibration'>).report} names={names} />;
    case 'management-summary': return <SummarySection d={(data as ReportResponse<'management-summary'>).report} products={products} />;
    case 'machine-product': return <MachineProductSection d={(data as ReportResponse<'machine-product'>).report} onOpen={onOpenStation} />;
    case 'shift-production': return <ShiftProductionSection d={(data as ReportResponse<'shift-production'>).report} />;
    case 'rejected-cones': return <RejectedConesSection d={(data as ReportResponse<'rejected-cones'>).report} />;
    case 'rejected-sacks': return <RejectedSacksSection d={(data as ReportResponse<'rejected-sacks'>).report} />;
    case 'sps-packing': return <SpsPackingSection d={(data as ReportResponse<'sps-packing'>).report} />;
    case 'sack-weight-range': return <SackWeightRangeSection d={(data as ReportResponse<'sack-weight-range'>).report} />;
    case 'sack-weight-summary': return <SackWeightSummarySection d={(data as ReportResponse<'sack-weight-summary'>).report} />;
    case 'rejected-hangers': return <RejectedHangersSection d={(data as ReportResponse<'rejected-hangers'>).report} />;
    case 'rejected-unknown-lifter': return <RejectedUnknownLifterSection d={(data as ReportResponse<'rejected-unknown-lifter'>).report} />;
  }
}

export interface ReportDocumentProps {
  type: ReportType;
  period: P.Period | null;
  state: ReportState;
  user: AuthUser;
  names: StationRow[];
  products: ProductOption[];
  onOpenStation: (station: number) => void;
  onOpenCode: (code: string) => void;
  onSelectPeriod?: (p: P.PeriodParams) => void;
}

export function ReportDocument({ type, period, state, names, products, onOpenStation, onOpenCode, onSelectPeriod }: ReportDocumentProps) {
  const { line } = live.useLive();
  const variant = variantOf(type);
  const { data, readable, error, fetch } = state;
  // X-3: a period that starts after the newest reading on record says when that reading is.
  const afterNewest = useMemo(
    () => (period && line?.dataAsOfUtc && P.periodAfterNewest(period, line.dataAsOfUtc) ? W.periodAfterNewest(fmt.fmtClockOn(line.dataAsOfUtc, line.plantNowUtc)) : null),
    [period, line?.dataAsOfUtc, line?.plantNowUtc],
  );

  let body: React.ReactNode;
  if (!readable) {
    body = <p className="rp-note" role="status">{R.preview.notAllowed}</p>;
  } else if (error !== null && !data) {
    body = <ErrorState part={R.preview.failed(variant.title)} onRetry={fetch.refresh} />;
  } else if (!data || !period) {
    body = <Skeleton part={`the ${variant.title} report`} height={320} lines={6} onRetry={fetch.refresh} />;
  } else if (isEmptyReport(type, data)) {
    body = <EmptyState message={afterNewest ?? R.preview.empty} />;
  } else {
    body = (
      <>
        <div className="page print-only pd-host"><ExecSummary type={type} data={data} /></div>
        <AfterNewestProvider sentence={afterNewest}>
          <Sections
            type={type}
            data={data}
            names={names}
            products={products}
            shiftRangeApplied={state.q?.fromShift != null}
            onOpenStation={onOpenStation}
            onOpenCode={onOpenCode}
            onSelectPeriod={onSelectPeriod}
          />
        </AfterNewestProvider>
        <div className="page print-only"><PrintNotes type={type} data={data} header={data.header} /></div>
      </>
    );
  }

  const header = data?.header ?? null;
  return (
    <article className="rp-paper rp-doc" aria-label={variant.title} data-report-type={type}>
      <PrintHead header={header} />
      <header className="rp-doc__head no-print">
        <div>
          <h3 className="rp-doc__title">{variant.title}</h3>
          <p className="rp-doc__period">{period ? headline(type, data, period, afterNewest) : ''}</p>
          <p className="rp-doc__question">{W.reports.question[type]}</p>
          <GenerationDisclosure header={header} />
        </div>
        <Verdict type={type} data={data} lineName={line?.lineName ?? ''} />
      </header>
      {fetch.staleError && data ? <p className="rp-note no-print" role="status">{C.couldntLoad(R.preview.failed(variant.title))}</p> : null}
      {body}
    </article>
  );
}
