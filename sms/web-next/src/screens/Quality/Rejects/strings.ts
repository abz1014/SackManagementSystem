/**
 * Words for Quality > Rejects and the reason sheet. Local to this screen (copy.ts has no
 * qualityRejects group yet; other workers have uncommitted edits there). GLOSSARY 1.3: the two
 * verdicts are always named in full, never a bare "rejected"; 1.5: an unnamed code reads
 * "Code 2/1 (not named yet)".
 */
import { fmt } from '../../../bridge/lib';

export const R = {
  question: 'How many cones failed a check, why, is it getting worse, and where?',
  failedInspection: 'Failed inspection',
  failedWeight: 'Failed weight check (scale)',
  weightRecords: 'Weight-reject records',
  topReasonShare: 'Top reason share',
  cones: 'cones',
  /** "6,048 of 132,665 cones checked" */
  ofChecked: (n: string, total: string) => `${n} of ${total} cones checked`,
  /** The two verdicts together: the one figure Today and Reports print as the line's failure rate. */
  together: (n: string, pct: string, total: string) =>
    `Together ${n} of ${total} cones checked (${pct}), the same rate Today and Reports use.`,
  rangeFromTo: (from: string, to: string) => `${from} to ${to}`,

  paretoTitle: 'Failed inspection by reason',
  paretoCaption: (period: string, total: string) => `Cones, ${period}. Share is of ${total} cones that failed inspection.`,
  colReason: 'Reason',
  colCones: 'Cones',
  colShare: 'Share',
  follow: 'Follow this reason',
  following: 'Following',
  showAll: (n: number) => `Show all ${n}`,
  showTop: (n: number) => `Show top ${n}`,
  coverTop: (k: number, pct: string) => `The ${k} biggest reasons cover ${pct} of cones that failed inspection.`,
  noReasons: 'No cones failed inspection in this period.',

  heatTitle: 'When each reason happened',
  heatCaption: "Share of the day's cones, by production day",
  heatLegendNone: 'none',
  heatLegendLabel: 'Share of the day\'s cones',
  heatCapped: (k: number, n: number) => `Top ${k} reasons shown. Use "Show all ${n}" above for the rest.`,
  heatOpen: (reason: string, day: string, pct: string) => `${reason}, ${day}: ${pct}. Open this day.`,
  heatNoRows: 'No cones failed inspection on any day in this period.',

  trendTitle: (days: number | null) => (days === null ? 'Daily failed-inspection rate' : `Daily failed-inspection rate, last ${days} production days`),
  trendTitleOne: (reason: string, days: number | null) => (days === null ? `Daily rate for ${reason}` : `Daily rate for ${reason}, last ${days} production days`),
  trendCaption: 'Percent of the day\'s cones. Fixed window: it does not follow the period, because a rise needs consecutive days.',
  trendUnit: '% of cones',
  seriesDaily: 'Daily rate',
  seriesMean: 'Window mean',
  trendPart: 'the failed-inspection trend',
  rising: (since: string) => `Failed inspection has been rising since ${since}.`,
  notRising: 'Not rising now.',
  notRisingAfter: (n: number, last: string) =>
    n === 1 ? `Not rising now, after one rise in this window that ended ${last}.` : `Not rising now, after ${n} rises in this window, the last ending ${last}.`,
  daysHold: (n: number, of: number) => `Only ${n} of those ${of} days hold readings.`,

  filterStation: 'Station',
  filterProduct: 'Product',
  all: 'All',
  reasonChip: (name: string) => `Reason: ${name}`,
  predateProduct: (n: string, of: string) =>
    `${n} of ${of} failures in this period were recorded before the plant began recording a product, and are not shown under a product filter.`,

  hopCones: 'See the cones',
  hopConesNote: 'opens the Register on cones that failed inspection, for this period',
  hopStations: 'By station',
  hopStationsNote: 'opens Stations, worst first',

  aboutTitle: 'About these figures',
  about: [
    'A cone that failed inspection and a cone the scale marked out of range are counted separately, each cone once.',
    'Reason codes are the plant\'s numbers (tube, material). IFL has not named them yet, so they show as codes until an engineer names them.',
    'Percentages use cones that were checked. Times are plant time and a production day runs 06:00 to 06:00.',
  ],
  aboutCounts: (inspection: string, weight: string) =>
    `In this period ${inspection} cones failed inspection and ${weight} weight-reject records were logged. The reason list holds the inspection failures only.`,
  aboutScale: (records: string) =>
    `Weight-reject records (${records}) are rows in the weight-reject log. "Failed weight check (scale)" on Today and Reports counts the cones the scale flagged out of range, which can be more: some flagged cones have no reject record.`,
  recordsOf: (n: string, total: string) => `${n} records over ${total} cones checked`,
  detectorFixed: (days: number) => `The trend and its rising verdict always look at the last ${days} production days.`,
  spansBatches: 'This window includes the 5 Aug 2026 database rebuild. The normal range is worked out for each side separately.',
  dayBasis: 'IFL has not confirmed whether reject reports should count by production day or by calendar date; this screen uses the production day.',
  periodGenerations: 'This period includes the 5 Aug 2026 database rebuild; the figures above are for one data batch.',

  nameIt: 'Name it',
  rename: 'Rename',
  nameLabel: 'Name for this reason',
  nameHint: 'A short name, then Save',
  save: 'Save',
  cancel: 'Cancel',
  saveFailed: "Couldn't save the name.",
  namesAwaited: 'Reason names have not been supplied yet. An engineer or manager can name a code here; the name applies to history.',

  /* reason sheet */
  sheetTitle: 'Failures for one reason',
  malformed: 'This link does not name a reason and a day.',
  dayBasisLine: (day: string) => `${day} · production day`,
  sheetCount: (n: string, reason: string) => `${n} cones failed inspection for ${reason}`,
  sheetCountWeight: (n: string) => `${n} weight-reject records`,
  stationNamesMissing: "Station names couldn't be loaded, so stations show as numbers.",
  perDayTitle: 'Day by day in this period',
  noDaysForReason: 'No cones failed for this reason in this period.',
  conesOnDay: (day: string) => `Cones on ${day}`,
  sheetEmpty: 'No cones failed for this reason on this day.',
  colDay: 'Day',
  colConesThatDay: 'Cones that day',
  colRate: 'Rate',
  colTimeStation: 'Time and station',
  colProductRecord: 'Product and record',
  colWeight: 'Weight',
  noProductThen: 'Product not recorded',
  notWeighed: 'Not weighed',
  hopDayRegister: 'See this day in the Register',
  hopDayRegisterNote: 'opens cones that failed inspection on this day; the reason itself is listed only here',
  hopDayReport: 'See this day on the reject report',
  hopDayReportNote: 'opens the reject report for this day',

  part: {
    thisReason: 'this reason',
    reasons: 'the reasons',
    figures: 'the failure rates',
    trend: 'the trend',
    byDay: 'the days by reason',
    stations: 'the station list',
    products: 'the product list',
    figureInspection: 'the failed-inspection rate',
    figureWeight: 'the weight-reject rate',
  },
} as const;

/** The number of a rate: two decimals under 1 % so a non-zero rate never reads 0.0 (C-110, D-89); one decimal otherwise. */
export function rateNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return n > 0 && n < 1 ? n.toFixed(2) : n.toFixed(1);
}
export const fmtRate = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '–' : `${rateNum(n)} %`);
export const fmtCount = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '–' : fmt.fmtInt(n));

/** Reason name by the glossary: the engineer's label, else "Code 2/1 (not named yet)". */
export function reasonName(r: { label: string | null; tubeCode: number | null; materialCode: number | null }): string {
  if (r.label) return r.label;
  if (r.tubeCode == null && r.materialCode == null) return 'No reason code';
  return `Code ${r.tubeCode ?? '–'}/${r.materialCode ?? '–'} (not named yet)`;
}
/** The short form for a chart axis. */
export function reasonShort(r: { label: string | null; tubeCode: number | null; materialCode: number | null }): string {
  if (r.label) return r.label;
  if (r.tubeCode == null && r.materialCode == null) return 'No code';
  return `Code ${r.tubeCode ?? '–'}/${r.materialCode ?? '–'}`;
}
