/*
 * Copy table for the redesign (design/redesign-2026-10/GLOSSARY.md, 13 Oct 2026).
 *
 *  - `C`        the new strings the redesign introduces. Plain words, sentence case,
 *               no pipeline vocabulary (GLOSSARY 1.7), no bare "rejected" (1.3).
 *  - `RESERVED` owner-reserved wording (GLOSSARY section 3.6 and rows 87, 88, 104,
 *               109). Re-exported BY REFERENCE to the live words.ts values, never
 *               copied, so the owner's pick (A keep / B proposal) is made in one place
 *               and an agent cannot change it here.
 *
 * Reserved rows with no words.ts key (docs-only, no UI string):
 *   row 165  DECISIONS-PENDING 14.5.1, the "about 3.8 hours" insert-lag wording
 *   row 166  DECISIONS-PENDING 14.5.2, PDAS write-path wording in CLAUDE.md and .env
 * Rows that share a key: row 141 is W.config.rules.basis; row 153 is the
 * W.reports.stockCol* set; row 164 is a family of four sentences (iflNotSaid).
 */
import { W } from './bridge/words';
import { stationLabel } from './bridge/api';

export const C = {
  /* Navigation (GLOSSARY 3.1, rows 1-10) */
  nav: {
    today: 'Today',
    quality: 'Quality',
    products: 'Products & PDAS',
    reports: 'Reports',
    system: 'System',
  },
  /* Keys match route.ts TABS 1:1 (APPROVAL / TRACE E-2). `history` is only a legacy alias of `limits`. */
  tabs: {
    quality: { weight: 'Weight', rejects: 'Rejects', stations: 'Stations', register: 'Register' },
    products: {
      board: 'Board',
      changeover: 'Changeover',
      catalogue: 'Catalogue',
      limits: 'Limits & History',
      history: 'Limits & History',
    },
    system: { diagnostics: 'Diagnostics', setup: 'Setup', account: 'Account' },
  },
  signOut: 'Sign out',
  plantTime: 'Plant time',

  /* The four state words (GLOSSARY 1.5). Colour is never the only cue. */
  state: {
    ok: 'OK',
    watch: 'Watch',
    act: 'Act',
    noData: 'No data',
  },

  /* Check vocabulary (GLOSSARY 1.3, rows 39-45). Always shown with a denominator. */
  checks: {
    passedWeight: 'Passed weight check',
    failedWeight: 'Failed weight check (scale)',
    failedInspection: 'Failed inspection',
    outsideLimits: 'Outside product limits (scale passed)',
    withinLimits: 'Within product limits',
    notChecked: 'Not checked (no product set)',
    /** "Failed weight check (scale): 123 of 8,402 cones weighed (1.5%)" */
    failedWeightOf: (n: string, total: string, pct: string) =>
      `Failed weight check (scale): ${n} of ${total} cones weighed (${pct})`,
    /** "Failed inspection: 87 of 8,402 cones weighed (1.0%)" */
    failedInspectionOf: (n: string, total: string, pct: string) =>
      `Failed inspection: ${n} of ${total} cones weighed (${pct})`,
  },

  /* Stations: "Station N" is the primary label (GLOSSARY 1.2). */
  station: (n: number) => `Station ${n}`,
  /** Decision E-9: "Station N · <name>", the existing name string verbatim. */
  stationWithName: (n: number, name: string) => `Station ${n} · ${name}`,
  noCones: 'No cones',
  noConesFor: (n: number, span: string) => `Station ${n}: no cones for ${span}`,

  /* Dates and clocks (GLOSSARY 1.4). Use formatDate / formatClock below. */
  dateNote: 'Dates read 1 Sep 2026. Times use the 24-hour clock, 14:30.',
  productionDay: (calendar: string, day: string) => `${calendar} - production day ${day}`,
  period: (from: string, to: string) => `${from} to ${to}`,
  shiftPeriod: (shift: string, date: string, from: string, to: string) =>
    `${shift}, ${date}, ${from} to ${to}`,

  /* Data age and empty / error phrasing (GLOSSARY 3.2, rows 25-38) */
  dataTo: (t: string) => `Data to ${t}.`,
  dataToWithLag: (t: string, lag: string) => `Data to ${t}. It arrives about ${lag} after weighing.`,
  noDataSince: (t: string) => `No data since ${t}. Check the plant connection.`,
  noDataYet: 'No data received yet.',
  lineStatusUnknown: (t: string) => `Line status unknown: no data since ${t}.`,
  nothingInPeriod: (newest: string) => `Nothing in this period. Newest data: ${newest}.`,
  nothingInPeriodNoNewest: 'Nothing in this period.',
  couldntLoad: (part: string) => `Couldn't load ${part}.`,
  couldntLoadCheck: (part: string) => `Couldn't load ${part}. Check the plant connection.`,
  tryAgain: 'Try again',
  stationListIncomplete: 'The station list did not fully load. A station may be missing.',
  attention: 'Needs attention',
  nothingNeedsAttention: 'Nothing needs attention.',

  /* Pre-rebuild data, said in effect words (GLOSSARY 1.7) */
  beforeRebuild: (date: string) => `Readings before ${date} are not counted (IFL rebuilt its database).`,

  /* Thresholds are written beside the state (GLOSSARY 1.5) */
  threshold: (state: string, rule: string) => `${state}: ${rule}`,

  /* Disclosure that holds the pipeline detail */
  howCalculated: 'How this is calculated',
} as const;

/* ---- helpers for the date and clock rule (GLOSSARY 1.4) ----------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "1 Sep 2026" from a plant-clock ISO string or millisecond value (plant wall clock, no UTC marker shown). */
export function formatDate(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14:30", or "14:30:05" when seconds are asked for. */
export function formatClock(at: string | number | Date, seconds = false): string {
  const d = at instanceof Date ? at : new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${seconds ? `:${p(d.getUTCSeconds())}` : ''}`;
}

/* ---- RESERVED wording, by reference ------------------------------------- */

export const RESERVED = {
  /* Station naming, DP-4 (rows 87, 88, 104) */
  stationLabel, // row 87: configured name, else "Station N" (lives in api.ts, not W)
  reportTypeStation: W.reports.type.station, // row 88
  stationDefaultLink: W.config.machines.defaultLink, // row 104

  /* Product limits reaching the scale (row 109) */
  changeLimitsPropagation: W.product.changeLimitsPropagation,

  /* Weight basis, DP-1 / Q4-5 (rows 139-141) */
  weightHeadlineUnconfirmed: W.weight.headlineUnconfirmed,
  weightHeadlineConfirmed: W.weight.headlineConfirmed,
  weightBasisLabel: W.config.rules.basis,

  /* "Assumed until IFL confirms" family (rows 142, 143, 164) */
  assumedHeading: W.iflReports.pendingHeading,
  definitionsNote: W.reports.definitionsNote,
  iflNotSaid: {
    oneLine: W.config.line.oneLine,
    defaultLink: W.config.machines.defaultLink,
    rejectCodesIntro: W.config.rejectCodes.intro,
    dayBasisCaveat: W.rejectsMore.dayBasisCaveat,
  },

  /* Sack-stock words (rows 144-155) */
  sackLedger: W.sacks.ledger,
  sackLedgerNote: W.sacks.ledgerNote,
  sackColOpening: W.sacks.colOpening,
  sackColReceipts: W.sacks.colReceipts,
  sackColIssues: W.sacks.colIssues,
  sackColConsumption: W.sacks.colConsumption,
  sackColAdjustments: W.sacks.colAdjustments,
  sackColClosing: W.sacks.colClosing,
  sackTypeName: W.sacks.typeName,
  reportStockColOpening: W.reports.stockColOpening,
  reportStockColReceipts: W.reports.stockColReceipts,
  reportStockColIssues: W.reports.stockColIssues,
  reportStockColConsumption: W.reports.stockColConsumption,
  reportStockColAdjustments: W.reports.stockColAdjustments,
  reportStockColClosing: W.reports.stockColClosing,
  sackPerMachine: W.sacks.perMachine,
  sackPerMachineNone: W.sacks.perMachineNone,
  sackLedgerCaveat: W.sacks.ledgerCaveat,

  /* IFL's eight report titles (rows 156-163), verbatim */
  iflReportTitles: {
    'shift-production': W.reports.type['shift-production'],
    'rejected-cones': W.reports.type['rejected-cones'],
    'rejected-sacks': W.reports.type['rejected-sacks'],
    'sps-packing': W.reports.type['sps-packing'],
    'sack-weight-range': W.reports.type['sack-weight-range'],
    'sack-weight-summary': W.reports.type['sack-weight-summary'],
    'rejected-hangers': W.reports.type['rejected-hangers'],
    'rejected-unknown-lifter': W.reports.type['rejected-unknown-lifter'],
  },
} as const;

/** Dotted path of each RESERVED leaf in W (used by copy.test.ts). */
export const RESERVED_SOURCES: Record<string, string> = {
  reportTypeStation: 'reports.type.station',
  stationDefaultLink: 'config.machines.defaultLink',
  changeLimitsPropagation: 'product.changeLimitsPropagation',
  weightHeadlineUnconfirmed: 'weight.headlineUnconfirmed',
  weightHeadlineConfirmed: 'weight.headlineConfirmed',
  weightBasisLabel: 'config.rules.basis',
  assumedHeading: 'iflReports.pendingHeading',
  definitionsNote: 'reports.definitionsNote',
  'iflNotSaid.oneLine': 'config.line.oneLine',
  'iflNotSaid.defaultLink': 'config.machines.defaultLink',
  'iflNotSaid.rejectCodesIntro': 'config.rejectCodes.intro',
  'iflNotSaid.dayBasisCaveat': 'rejectsMore.dayBasisCaveat',
  sackLedger: 'sacks.ledger',
  sackLedgerNote: 'sacks.ledgerNote',
  sackColOpening: 'sacks.colOpening',
  sackColReceipts: 'sacks.colReceipts',
  sackColIssues: 'sacks.colIssues',
  sackColConsumption: 'sacks.colConsumption',
  sackColAdjustments: 'sacks.colAdjustments',
  sackColClosing: 'sacks.colClosing',
  sackTypeName: 'sacks.typeName',
  reportStockColOpening: 'reports.stockColOpening',
  reportStockColReceipts: 'reports.stockColReceipts',
  reportStockColIssues: 'reports.stockColIssues',
  reportStockColConsumption: 'reports.stockColConsumption',
  reportStockColAdjustments: 'reports.stockColAdjustments',
  reportStockColClosing: 'reports.stockColClosing',
  sackPerMachine: 'sacks.perMachine',
  sackPerMachineNone: 'sacks.perMachineNone',
  sackLedgerCaveat: 'sacks.ledgerCaveat',
  'iflReportTitles.shift-production': 'reports.type.shift-production',
  'iflReportTitles.rejected-cones': 'reports.type.rejected-cones',
  'iflReportTitles.rejected-sacks': 'reports.type.rejected-sacks',
  'iflReportTitles.sps-packing': 'reports.type.sps-packing',
  'iflReportTitles.sack-weight-range': 'reports.type.sack-weight-range',
  'iflReportTitles.sack-weight-summary': 'reports.type.sack-weight-summary',
  'iflReportTitles.rejected-hangers': 'reports.type.rejected-hangers',
  'iflReportTitles.rejected-unknown-lifter': 'reports.type.rejected-unknown-lifter',
};
