/**
 * Reports model (task E11): the five cards and the 18 report types they hold, the default per rank
 * (decision E-1), legacy `rt` handling and the one empty-report rule that is the screen's own (E-7).
 *
 * The four merges (shift into daily, sack into sack-weight-summary, product into machine-product, station into
 * cone-weight) are UI-only: each merged type stays a variant here and its `rt` value, query and exports are unchanged.
 */
import { REPORT_GROUPS, REPORT_MIN_RANK } from '../../bridge/report';
import { REPORT_TYPES, type ReportResponse, type ReportType } from '../../bridge/api';
import { W } from '../../bridge/words';
import { RESERVED } from '../../copy';

export type CardId = 'summary' | 'production' | 'rejects' | 'sacks' | 'machine';

export interface Variant {
  type: ReportType;
  /** The report's title as the reader sees it. IFL's eight are IFL's own words, verbatim. */
  title: string;
  /** One line under the title. */
  hint: string;
  /** Position in IFL's own numbering (their email of 29 Sep 2026), 1 to 8; null for the other ten. */
  ifl: number | null;
  /** A view of another variant (a merged type): still a full `rt`. */
  view: boolean;
}

export interface ReportCard {
  id: CardId;
  title: string;
  who: string;
  what: string;
  variants: readonly Variant[];
}

const iflNo = (t: ReportType): number | null => {
  const i = (REPORT_GROUPS.ifl as readonly ReportType[]).indexOf(t);
  return i < 0 ? null : i + 1;
};
const iflTitle = (t: keyof typeof RESERVED.iflReportTitles): string => RESERVED.iflReportTitles[t];

const v = (type: ReportType, title: string, hint: string, view = false): Variant => ({ type, title, hint, ifl: iflNo(type), view });

export const CARDS: readonly ReportCard[] = [
  {
    id: 'summary',
    title: 'Management summary',
    who: 'One page, for the GM',
    what: 'The verdict in a sentence, the figures that matter and how they moved since the previous period.',
    variants: [v('management-summary', W.reports.type['management-summary'], 'The verdict, the key figures and the change since the previous period')],
  },
  {
    id: 'production',
    title: 'Production by day and shift',
    who: 'For shift managers',
    what: 'What the line made, day by day or shift by shift.',
    variants: [
      v('daily', 'Daily production', 'Cones, sacks and kg for each day'),
      v('shift', 'Daily production, by shift', 'The same days split into morning, evening and night', true),
      v('shift-production', iflTitle('shift-production'), 'Cones passed and weight rejected in each shift'),
    ],
  },
  {
    id: 'rejects',
    title: 'Rejects and quality',
    who: 'For quality and process engineers',
    what: 'Which cones and sacks were rejected, and why.',
    variants: [
      v('reject', 'Rejects by reason', 'Reason codes over the days'),
      v('rejected-sacks', iflTitle('rejected-sacks'), 'Sacks the scale marked out of range, by day'),
      v('rejected-cones', iflTitle('rejected-cones'), 'Each cone the scale rejected, with its weight and limits'),
      v('rejected-hangers', iflTitle('rejected-hangers'), 'Hangers that stand out for rejected cones'),
      v('rejected-unknown-lifter', iflTitle('rejected-unknown-lifter'), 'Rejects with no lifter or winder recorded'),
    ],
  },
  {
    id: 'sacks',
    title: 'Sacks',
    who: 'For packing supervisors',
    what: 'Sacks packed, their weight and where they were packed.',
    variants: [
      v('sps-packing', iflTitle('sps-packing'), 'Sacks packed by yarn count at each scale'),
      v('sack-weight-range', iflTitle('sack-weight-range'), 'How sack weights spread across 0.1 kg bands'),
      v('sack-weight-summary', iflTitle('sack-weight-summary'), 'Sacks and kg by shift and product'),
      v('sack', 'Sack stock ledger', 'Opening, receipts, issues and closing stock', true),
    ],
  },
  {
    id: 'machine',
    title: 'Machine and product',
    who: 'For process engineers',
    what: 'What each winder ran and how its cones weighed.',
    variants: [
      v('machine-product', W.reports.type['machine-product'], 'What each winder ran, shift by shift'),
      v('product', 'Product by machine, one product', 'The same report narrowed to one product', true),
      v('cone-weight', W.reports.type['cone-weight'], 'Average weight against target'),
      v('station', 'Cone weight by station', 'Each station against the line', true),
      v('calibration', W.reports.type.calibration, 'Station drift and recorded adjustments'),
    ],
  },
];

export const ALL_TYPES: readonly ReportType[] = CARDS.flatMap((c) => c.variants.map((x) => x.type));

export function isReportType(x: string | undefined): x is ReportType {
  return x !== undefined && (REPORT_TYPES as readonly string[]).includes(x);
}

export function cardOf(type: ReportType): ReportCard {
  return CARDS.find((c) => c.variants.some((x) => x.type === type)) ?? CARDS[0]!;
}

export function variantOf(type: ReportType): Variant {
  return cardOf(type).variants.find((x) => x.type === type)!;
}

/** Decision E-1: managers (rank 3 and up) land on the management summary, everyone else on the daily report. */
export function defaultType(rank: number): ReportType {
  return rank >= REPORT_MIN_RANK['management-summary'] ? 'management-summary' : 'daily';
}

/** The report the URL asks for: a valid legacy `rt` lands on its variant, anything else on the rank's default. */
export function typeFromKeys(keys: Record<string, string>, rank: number): ReportType {
  return isReportType(keys.rt) ? keys.rt : defaultType(rank);
}

export function canRead(type: ReportType, rank: number): boolean {
  return rank >= REPORT_MIN_RANK[type];
}

/**
 * Decision E-7: the machine-product report lists a row for every station even when nothing was weighed, so a
 * period with no cones on any station is an EMPTY report, not "0 machines, 0 products".
 */
export function isEmptyReport(type: ReportType, data: ReportResponse<ReportType> | null): boolean {
  if (type !== 'machine-product' || !data) return false;
  const d = (data as ReportResponse<'machine-product'>).report;
  return d.rows.length === 0 || (d.products.length === 0 && d.rows.every((r) => r.cones === 0));
}

export interface Coverage {
  daysWithData: number;
  daysInPeriod: number;
  complete: boolean;
  firstDayWithData: string | null;
  lastDayWithData: string | null;
}

/** Coverage block of a report, wherever its type keeps it; null when the type has none. */
export function coverageOf(type: ReportType, data: ReportResponse<ReportType>): Coverage | null {
  if (type === 'management-summary') return (data as ReportResponse<'management-summary'>).report.coverage.current as Coverage;
  if (type === 'shift') return ((data as ReportResponse<'shift'>).report.shifts?.[0]?.coverage ?? null) as Coverage | null;
  return (data.report as { coverage?: Coverage }).coverage ?? null;
}
