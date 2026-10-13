/**
 * The preview: one report drawn as a clean page (task E11). The 18 report bodies are the existing renderers
 * (bridge/report.ts); this file only chooses which one, frames it, and says what is wrong when it cannot be drawn.
 *
 *  - NOTHING ASSERTED WITHOUT DATA. A failed fetch names the report that failed; a half-loaded report is a
 *    skeleton, never a figure; a period after the newest reading says when the newest reading is (X-3).
 *  - EVERY EMPTY MACHINE-AND-PRODUCT PERIOD IS EMPTY (E-7): rows with no cones on any station are not "0 machines".
 */
import { useEffect, useMemo, useRef } from 'react';
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
import { fmt, period as P } from '../../bridge/lib';
import { NextDateFmt } from '../../bridge/dateFmt';
import { fmtDate, fmtDateTime, fmtRange } from '../../lib/fmt';
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
  generatedLine,
} from '../../bridge/report';
import { C, withFragments, FRAGMENTS } from '../../copy';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Skeleton } from '../../ui/Skeleton';
import { coverageOf, isEmptyReport, variantOf } from './model';
import type { ReportState } from './useReport';
import { useLive } from '../../data';
const R = withFragments(C.reports, FRAGMENTS.reportsParts);

type Data = ReportResponse<ReportType>;

/** A table cell that holds a date, a clock time or a shift name and nothing else must stay on one line (M-12). */
const ONE_LINE_CELL = /^\s*(\d{1,2}-\d{1,2}-\d{4}|\d{1,2} [A-Z][a-z]{2} \d{4}|\d{1,2}:\d{2}|Morning|Evening|Night)\b/;

/**
 * The old renderers print dates as plain text, which a browser may break at a hyphen or a space. Cells that start with a
 * date, a time or a shift name get `data-nw` (report-style-c.css makes them nowrap). Only an attribute is set, and only on
 * cells, so React's own rendering is untouched; a MutationObserver keeps it true as the report loads.
 */
function useOneLineCells(ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mark = () => {
      for (const c of root.querySelectorAll<HTMLElement>('td, th')) {
        if (!c.hasAttribute('data-nw') && ONE_LINE_CELL.test(c.textContent ?? '')) c.setAttribute('data-nw', '');
      }
    };
    mark();
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(mark);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [ref]);
}

/** The sentence over the preview: coverage first, because "this quarter" on a 34-day record is 34 days of a longer period. */
export function headline(type: ReportType, data: Data | null, period: P.Period, afterNewest: string | null): string {
  const label = `${fmtDate(period.from)} to ${fmtDate(period.to)}`;
  const short = period.from === period.to ? fmtDate(period.from) : label;
  if (!data) return short;
  const c = coverageOf(type, data);
  if (!c) return `${W.reports.type[type]}, ${short}`;
  if (c.daysWithData === 0) return afterNewest ?? W.report.coverageNone(short);
  if (c.complete) return W.report.coverageAll(short, c.daysInPeriod);
  return W.report.coveragePartial(
    short,
    c.daysWithData,
    c.daysInPeriod,
    c.firstDayWithData ? fmtDate(c.firstDayWithData) : '-',
    c.lastDayWithData ? fmtDate(c.lastDayWithData) : '-',
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
        {fmtRange(h.period.from, h.period.to)} · {lineName || h.lineName}
      </span>
      <span className="who">{generatedLine(h, fmtDateTime)}</span>
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
  /** The part that failed when there is no period because the plant clock could not be read (named, never a spinner). */
  periodFailed?: string | null;
}

export function ReportDocument({ type, period, state, periodFailed = null, names, products, onOpenStation, onOpenCode, onSelectPeriod }: ReportDocumentProps) {
  const { line } = useLive();
  const paper = useRef<HTMLElement>(null);
  useOneLineCells(paper);
  const variant = variantOf(type);
  const { data, readable, error, fetch } = state;
  // X-3: a period that starts after the newest reading on record says when that reading is.
  const afterNewest = useMemo(
    () => (period && line?.dataAsOfUtc && P.periodAfterNewest(period, line.dataAsOfUtc) ? W.periodAfterNewest(fmtDateTime(line.dataAsOfUtc)) : null),
    [period, line?.dataAsOfUtc, line?.plantNowUtc],
  );

  let body: React.ReactNode;
  if (!readable) {
    body = <p className="rp-note" role="status">{R.preview.notAllowed}</p>;
  } else if (error !== null && !data) {
    body = <ErrorState part={R.preview.failed(variant.title)} onRetry={fetch.refresh} />;
  } else if (!period && periodFailed !== null) {
    body = <ErrorState part={periodFailed} cause={R.preview.needsClock} />;
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
    <NextDateFmt>
    <article ref={paper} className="rp-paper rp-doc" aria-label={variant.title} data-report-type={type}>
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
    </NextDateFmt>
  );
}
