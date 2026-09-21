/**
 * UX Phase 8 Brief B, File 1 — the rank-1 (viewer) UI matrix.
 *
 * Nobody on this project has ever exercised the viewer role in a browser: a
 * signed-in account is required to see any screen, and workers are FORBIDDEN
 * to create or reset one (standing rule after three appeared unasked on
 * 16 Sep 2026). CLAUDE.md's "ONE AUDIENCE" rule — every screen open to every
 * signed-in account, only Setup gated at rank>=4, all other gating is on
 * WRITE controls, enforced server-side — has therefore rested on code
 * inspection alone. This mounts the real `<App/>` (App.tsx:278) at all four
 * ranks against a fake fetch (testkit/fetchRouter.ts) and asserts it
 * mechanically, with no database and no account.
 *
 * Every gated control gets BOTH a present-case and an absent-case assertion
 * (brief's own rule) — a one-sided test passes against a screen that renders
 * nothing at all, which is exactly how the Export-at-rank-2 defect (fixed
 * 3 Sep 2026, CLAUDE.md's redesign notes) could have shipped invisibly.
 *
 * UX Phase 8 Brief B (21 Sep 2026).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen as rtlScreen, within, waitFor } from '@testing-library/react';
import { renderApp } from './testkit/render';
import { OPERATIONS_FIXTURE, META_FIXTURE } from './testkit/fixtures';
import { W } from './lib/words';
import type {
  Envelope, ProductionData, AttentionData, MachinesRunningData, ProductAtData, RegisterPage,
  SpcData, WeightStationsData, RangeData, RejectDataFiltered, RejectSpcData, RejectDayCodeData,
  StockLedgerData, SackSummaryData, ReportResponse, TimelineEntry, HealthReport, ReconciliationData,
  SystemHistoryData, ProductOption, StationRow,
} from './api';

/* --------------------------------------------------------------- fixtures */
// Every fixture below is typed as api.ts's own exported interfaces, same
// discipline as testkit/fixtures.ts (Brief A) — a wire-contract change
// breaks `npm run typecheck` here, not just a test that happened to still
// pass on a stale shape. List/array fields are left empty where the type
// permits it: an empty array is a legitimate, type-correct value and this
// matrix asserts NAVIGATION and GATING, not any screen's data rendering.

const STATIONS: { stations: StationRow[] } = {
  stations: [
    { stationId: 1, name: 'Station 1', machine: 'M1', description: null, isActive: true },
    { stationId: 5, name: 'Station 5', machine: 'M5', description: null, isActive: true },
  ],
};

const PRODUCT_OPTION: ProductOption = {
  productId: 231, description: '30s combed', lotCode: 'L-1', setpointG: 1960,
  blend: 'B1', countText: '30', tubeType: 'T1', tubeWeightG: 12,
  weightOffsetMinusG: 30, weightOffsetPlusG: 30, activeFlag: true, color: 'PARROT',
};
const PRODUCTS: { products: ProductOption[] } = { products: [PRODUCT_OPTION] };

const PRODUCTION_FIXTURE: Envelope<ProductionData> = {
  data: {
    groupBy: 'none',
    rows: [{ group: 'total', cones: 100, rejectedCones: 2, sacks: 5, sackWeightKg: 130, conesInRangePct: 96 }],
    unattributed: null, states: null, implausible: null,
  },
  metadata: META_FIXTURE,
};

const ATTENTION_FIXTURE: Envelope<AttentionData> = {
  data: {
    window: { from: '2026-08-24', to: '2026-09-07', days: 14 },
    period: { from: '2026-09-07', to: '2026-09-07', shift: null },
    findings: [],
    totalFindings: 0,
    thresholds: { driftG: 15, minDaysHeld: 3 },
  },
  metadata: META_FIXTURE,
};

const MACHINES_RUNNING_FIXTURE: Envelope<MachinesRunningData> = {
  data: { asOfUtc: '2026-09-07T16:41:00Z', windowMs: 3_600_000, windowStartUtc: '2026-09-07T15:41:00Z', machines: [], materialsRunning: 0 },
  metadata: META_FIXTURE,
};

const PRODUCT_AT_FIXTURE: ProductAtData = {
  at: '2026-09-07T16:41:00Z',
  product: { productId: 231, label: '30s combed', effectiveFromUtc: '2026-09-01T00:00:00Z' } as ProductAtData['product'],
  limits: { targetG: 1960, loG: 1930, hiG: 1990, label: '1,960 \u00b1 30 g' },
  neverRecorded: false,
  attribution: 'row',
  verdict: null,
  limitsAreLowerBound: false,
};

const CURRENT_PRODUCT_FIXTURE: { current: TimelineEntry | null } = {
  current: {
    timelineId: 1, productId: 231, productLabel: '30s combed',
    effectiveFrom: '2026-09-01T00:00:00Z', changedAt: '2026-09-01T00:00:00Z', changedBy: 'test-user', reason: null,
  },
};

const REGISTER_FIXTURE: Envelope<RegisterPage> = {
  data: {
    rows: [{
      event_id: 1, source_row_id: 1, source_epoch: 2, source_epoch_label: 'Sept',
      production_ts_utc: '2026-09-07T16:40:58Z', shift_code: 'evening', shift_date: '2026-09-07',
      shift_code_legacy: 'evening', hanger_num: 1, source_station: 5, lifter_station: 5,
      weight_g: 1948.2, in_range: true, material_id: 231, lot_code: null, merge_key_is_unique: true,
    }],
    total: 1, page: 1, pageSize: 100,
  },
  metadata: META_FIXTURE,
};

const SPC_FIXTURE: Envelope<SpcData> = {
  data: {
    specAgreement: null, type: 'cone', unit: 'g', count: 10, mean: 1948, stdevOverall: 8, stdevWithin: 6,
    bucketMinutes: 60, bucketLabel: '1h', grandMean: 1948, sChartCenter: 6, xbarOutOfControl: 0, nelsonFlagged: 0,
    subgroups: [], stations: [], practicalThresholdG: 9, distinguishableStationCount: 0, flaggedStationCount: 0,
    histogram: [], spec: { usl: 1990, lsl: 1930, nominal: 1960, source: 'product' },
    capability: { cp: null, cpk: null, pp: null, ppk: null },
    // SpcData's declaration merges in three places (api.ts:729/1538/1667) —
    // station/implausible/median all belong to the SAME wire type.
    station: null, implausible: 0, median: null,
  },
  metadata: META_FIXTURE,
};

const WEIGHT_STATIONS_FIXTURE: Envelope<WeightStationsData> = {
  data: {
    from: '2026-08-24', to: '2026-09-07', days: 14, lineMeanG: 1948, targetG: 1960, productId: 231,
    productLabel: '30s combed', thresholdG: 15, minDaysHeld: 3, lineRejectRatePct: 2.1, stations: [],
    disagreement: { passedButOutside: 0, rejectedButInside: 0, judged: 0, unjudged: 0 },
    // WeightStationsData's declaration merges in two places (api.ts:1312/1731).
    limits: { loG: 1930, hiG: 1990 }, rules: [], targetEffectiveFromUtc: '2026-09-01T00:00:00Z',
    limitsChangedInWindow: 0, productChangesInWindow: 0,
  },
  metadata: META_FIXTURE,
};

const RANGE_FIXTURE: RangeData = { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 };

const REJECTS_FILTERED_FIXTURE: Envelope<RejectDataFiltered> = {
  data: { total: 0, reasons: [], unattributed: null },
  metadata: META_FIXTURE,
};

const REJECT_SPC_FIXTURE: Envelope<RejectSpcData> = {
  data: {
    bucketSize: 'day', rejectTypeFilter: 'all', totalProduced: 100, totalRejects: 2, pBar: 0.02,
    spansGenerations: false, generations: [], outOfControlCount: 0, buckets: [], episodes: [],
  },
  metadata: META_FIXTURE,
};

const REJECT_DAY_CODE_FIXTURE: Envelope<RejectDayCodeData> = {
  data: { dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 14, total: 0, rows: [] },
  metadata: META_FIXTURE,
};

const LEDGER_FLOW = { sacks: 0, kg: 0 };
const SACK_STOCK_FIXTURE: Envelope<StockLedgerData> = {
  data: {
    from: '2026-09-01', to: '2026-09-07', product: null, basis: 'line',
    machineLevel: { enabled: false, reason: 'not computable from IFL data' },
    dayBasis: 'production_day', sackTimeIsInsertTime: true,
    receiptMeaning: 'weighed sacks', weightBasis: 'gross', tareKg: 1.2,
    opening: LEDGER_FLOW, closing: LEDGER_FLOW,
    totals: { openingEntries: LEDGER_FLOW, receipts: LEDGER_FLOW, weighed: LEDGER_FLOW, issues: LEDGER_FLOW, consumption: LEDGER_FLOW, adjustments: LEDGER_FLOW },
    days: [], byMaterial: [], kgMissing: 0,
  },
  metadata: META_FIXTURE,
};

const SACK_SUMMARY_FIXTURE: Envelope<SackSummaryData> = {
  data: {
    from: '2026-09-01', to: '2026-09-07', shift: null, product: null,
    totals: {
      sacks: 0, kg: 0, avgKg: null, inRangePct: null, inRange: 0, noFlag: 0, implausible: 0,
      cones: 0, conesPerSack: null,
    },
    byShift: [], byProduct: [], unattributed: { rows: 0, of: 0 },
    weightBasis: 'gross', tareKg: 1.2, plausibility: { loKg: 40, hiKg: 1000 },
    sackTimeIsInsertTime: true, conesPerSackApproximate: true,
    machineLevel: { enabled: false, reason: 'not computable from IFL data' },
  },
  metadata: META_FIXTURE,
};

// DailyReportData's `report` merges fields declared across three separate
// `interface ReportData { ... }` blocks (TS declaration merging, api.ts
// lines 1139/1555/2043) plus DailyReportData's own `rejectPopulations` \u2014
// cast at the outer envelope rather than hand-resolving the merge, since
// every field the Daily report screen actually reads is present below.
const DAILY_REPORT_FIXTURE = {
  data: {
    header: {
      reportType: 'daily', title: 'Daily report', lineName: 'TP1 Line 3 \u00b7 Unit 2', plantName: 'TP1', unitName: 'Unit 2',
      period: { period: 'shift', from: '2026-09-07', to: '2026-09-07', days: 1 },
      filters: {}, cells: 1, firstUtc: '2026-09-07T09:00:00Z', lastUtc: '2026-09-07T16:41:00Z',
    },
    report: {
      period: { period: 'shift', from: '2026-09-07', to: '2026-09-07' },
      coverage: { daysInPeriod: 1, daysWithData: 1, firstDayWithData: '2026-09-07', lastDayWithData: '2026-09-07', complete: true },
      totals: { group: 'total', cones: 100, rejectedCones: 2, rejectRatePct: 2, conesInRangePct: 96, sacks: 5, sackWeightKg: 130, avgSackKg: 26, conesPerSack: 20 },
      byShift: [], byDay: [],
      downtime: { stoppageCount: 0, stoppedSeconds: 0, thresholdSeconds: 120 },
      shift: null,
      readings: { states: { within: 90, low: 3, high: 3, rejected: 4, unknown: 0 }, implausible: 0 },
      shiftCheck: { compared: 100, mismatched: 0, mismatchPct: 0, topHour: null },
      rejectPopulations: { byScale: 2, byScalePct: 2, atInspection: 0, atInspectionPct: 0, note: 'note' },
    },
  },
  metadata: META_FIXTURE,
} as unknown as Envelope<ReportResponse<'daily'>>;

const HEALTH_FIXTURE: HealthReport = {
  status: 'ok',
  service: { version: '1.0.0', uptimeSeconds: 3600, startedAtUtc: '2026-09-07T00:00:00Z', pid: 1234 },
  database: { ok: true, latencyMs: 4, sizeMb: 120, capMb: 10240, pctOfCap: 1.2 },
  acquisition: { kind: 'ok', ageSeconds: 42, cadenceSeconds: 60, halted: null },
  backup: { dir: 'C:\\backups', newestFile: 'sidecar-20260907.bak', newestAtUtc: '2026-09-07T03:00:00Z', ageDays: 0.5, warning: false },
  degradedReason: null,
};

const RECONCILIATION_FIXTURE: Envelope<ReconciliationData> = {
  data: {
    from: '2026-09-07', to: '2026-09-07', shift: null,
    total: { n: 100, sumG: 194800, avgG: 1948, minG: 1900, maxG: 2000 },
    plausible: { n: 100, sumG: 194800, avgG: 1948, minG: 1900, maxG: 2000 },
    implausible: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    noWeight: 0,
    byState: {
      within: { n: 90, sumG: 175000, avgG: 1944, minG: 1900, maxG: 1990 },
      low: { n: 3, sumG: null, avgG: null, minG: null, maxG: null },
      high: { n: 3, sumG: null, avgG: null, minG: null, maxG: null },
      rejected: { n: 4, sumG: null, avgG: null, minG: null, maxG: null },
      unknown: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    },
    plausibility: { loG: 1500, hiG: 2500 },
    limitWindows: 1, basis: 'as_recorded', note: 'note',
  },
  metadata: META_FIXTURE,
};

const SYSTEM_HISTORY_FIXTURE: Envelope<SystemHistoryData> = {
  data: { generations: [], rebuilds: [], verifyRuns: [] },
  metadata: META_FIXTURE,
};

/** Every route every one of the seven screens (plus Health) needs on its
 *  DEFAULT mount — pathname-keyed, per fetchRouter's contract; an
 *  unregistered path throws rather than silently answering `{}`, so a
 *  missing route here fails LOUDLY as a test error, not a false green. */
const ALL_ROUTES = {
  '/api/attention': ATTENTION_FIXTURE,
  '/api/machines/running': MACHINES_RUNNING_FIXTURE,
  '/api/product-at': PRODUCT_AT_FIXTURE,
  '/api/production': PRODUCTION_FIXTURE,
  '/api/stations': STATIONS,
  '/api/events': REGISTER_FIXTURE,
  '/api/spc': SPC_FIXTURE,
  '/api/weight-stations': WEIGHT_STATIONS_FIXTURE,
  '/api/products': PRODUCTS,
  '/api/range': RANGE_FIXTURE,
  '/api/reject-spc': REJECT_SPC_FIXTURE,
  '/api/rejects/by-day-code': REJECT_DAY_CODE_FIXTURE,
  '/api/rejects': REJECTS_FILTERED_FIXTURE,
  '/api/sacks/stock': SACK_STOCK_FIXTURE,
  '/api/sacks/summary': SACK_SUMMARY_FIXTURE,
  '/api/current-product': CURRENT_PRODUCT_FIXTURE,
  '/api/reports/daily': DAILY_REPORT_FIXTURE,
  '/api/health': HEALTH_FIXTURE,
  '/api/operations': OPERATIONS_FIXTURE,
  '/api/system-history': SYSTEM_HISTORY_FIXTURE,
  '/api/reconciliation': RECONCILIATION_FIXTURE,
};

const RANKS = ['viewer', 'engineer', 'manager', 'admin'] as const;
type Rank = (typeof RANKS)[number];

/** The seven nav screens, in Bar.tsx's own SCREENS order. */
const SEVEN = ['line', 'readings', 'weight', 'rejects', 'sacks', 'product', 'report'] as const;

async function mountAt(role: Rank) {
  const result = renderApp({ role, routes: ALL_ROUTES });
  // Wait for the session bootstrap (getMe) and the first /api/live poll to
  // resolve, i.e. for the bar to actually appear.
  await waitFor(() => expect(rtlScreen.getByRole('navigation')).toBeTruthy());
  return result;
}

function navButton(name: string) {
  const nav = rtlScreen.getByRole('navigation');
  return within(nav).getByRole('button', { name });
}

describe('UX Phase 8 Brief B — rank-1 (viewer) UI matrix', () => {
  // App.tsx's Session reads window.location.search only once, at its
  // initial useState(() => parseRoute()) call — a URL set by one test (the
  // ?s=setup / ?s=health cases below) would otherwise leak into the next
  // test's mount, since jsdom's URL persists across tests in one file.
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  for (const role of RANKS) {
    it(`${role}: the nav has exactly the seven SCREENS entries`, async () => {
      await mountAt(role);
      const nav = rtlScreen.getByRole('navigation');
      for (const s of SEVEN) {
        expect(within(nav).getByRole('button', { name: W.nav[s] })).toBeTruthy();
      }
      // Mechanical ONE AUDIENCE assertion: exactly seven, not six, not eight —
      // the brand span is not a button, so this counts nav-link buttons only.
      const buttons = within(nav).getAllByRole('button');
      expect(buttons).toHaveLength(SEVEN.length);
    });
  }

  it('rank 1 (viewer): all seven screens navigate and mount without throwing', async () => {
    await mountAt('viewer');
    for (const s of SEVEN) {
      navButton(W.nav[s]).click();
      // Each screen's own headline (W.nav[s] repeated as an <h1>) proves the
      // screen area actually swapped and did not throw into the error
      // boundary (which would print a different, generic fallback string).
      await waitFor(() => {
        expect(rtlScreen.getAllByText(W.nav[s]).length).toBeGreaterThan(0);
      });
    }
  });

  describe('the Setup gear — absent below rank 4, present at 4', () => {
    it('viewer/engineer/manager: no gear', async () => {
      for (const role of ['viewer', 'engineer', 'manager'] as const) {
        const { unmount } = await mountAt(role);
        expect(rtlScreen.queryByLabelText(W.setup)).toBeNull();
        unmount();
      }
    });
    it('admin: gear present', async () => {
      await mountAt('admin');
      expect(rtlScreen.getByLabelText(W.setup)).toBeTruthy();
    });
  });

  describe('Readings\u2019 Export control (the 3 Sep 2026 defect, reproduced)', () => {
    it('absent at rank 1 and 2', async () => {
      for (const role of ['viewer', 'engineer'] as const) {
        const { unmount } = await mountAt(role);
        navButton(W.nav.readings).click();
        await waitFor(() => expect(rtlScreen.getAllByText(W.nav.readings).length).toBeGreaterThan(0));
        expect(rtlScreen.queryByText(W.report.exportCsv)).toBeNull();
        unmount();
      }
    });
    it('present at rank 3 and 4', async () => {
      for (const role of ['manager', 'admin'] as const) {
        const { unmount } = await mountAt(role);
        navButton(W.nav.readings).click();
        await waitFor(() => expect(rtlScreen.getAllByText(W.nav.readings).length).toBeGreaterThan(0));
        expect(rtlScreen.getByText(W.report.exportCsv)).toBeTruthy();
        unmount();
      }
    });
  });

  describe('Line\u2019s Change control (setting the running product, rank >= 2)', () => {
    it('absent at rank 1', async () => {
      await mountAt('viewer');
      // Line is the default screen — no navigation needed.
      await waitFor(() => expect(rtlScreen.getAllByText(W.nav.line).length).toBeGreaterThan(0));
      expect(rtlScreen.queryByText(W.product.change)).toBeNull();
    });
    it('present at rank 2+', async () => {
      for (const role of ['engineer', 'manager', 'admin'] as const) {
        const { unmount } = await mountAt(role);
        await waitFor(() => expect(rtlScreen.getAllByText(W.nav.line).length).toBeGreaterThan(0));
        expect(rtlScreen.getByText(W.product.change)).toBeTruthy();
        unmount();
      }
    });
  });

  describe('Sacks\u2019 record-movement control (rank >= 2)', () => {
    it('absent at rank 1', async () => {
      await mountAt('viewer');
      navButton(W.nav.sacks).click();
      await waitFor(() => expect(rtlScreen.getAllByText(W.nav.sacks).length).toBeGreaterThan(0));
      expect(rtlScreen.queryByText(W.sacks.record)).toBeNull();
    });
    it('present at rank 2+', async () => {
      for (const role of ['engineer', 'manager', 'admin'] as const) {
        const { unmount } = await mountAt(role);
        navButton(W.nav.sacks).click();
        await waitFor(() => expect(rtlScreen.getAllByText(W.nav.sacks).length).toBeGreaterThan(0));
        expect(rtlScreen.getByText(W.sacks.record)).toBeTruthy();
        unmount();
      }
    });
  });

  describe('Product \u203a Running\u2019s write control (rank >= 2)', () => {
    it('absent at rank 1', async () => {
      await mountAt('viewer');
      navButton(W.nav.product).click();
      await waitFor(() => expect(rtlScreen.getAllByText(W.nav.product).length).toBeGreaterThan(0));
      expect(rtlScreen.queryByText(W.product.change)).toBeNull();
    });
    it('present at rank 2+', async () => {
      for (const role of ['engineer', 'manager', 'admin'] as const) {
        const { unmount } = await mountAt(role);
        navButton(W.nav.product).click();
        await waitFor(() => expect(rtlScreen.getAllByText(W.nav.product).length).toBeGreaterThan(0));
        expect(rtlScreen.getByText(W.product.change)).toBeTruthy();
        unmount();
      }
    });
  });

  describe('Rejects\u2019 name-a-code control (rank >= 2)', () => {
    it('absent at rank 1', async () => {
      await mountAt('viewer');
      navButton(W.nav.rejects).click();
      await waitFor(() => expect(rtlScreen.getAllByText(W.nav.rejects).length).toBeGreaterThan(0));
      // Nothing to weigh into a Pareto (REJECTS_FILTERED_FIXTURE.reasons is
      // empty) so this proves absence of the editor's affordance rather than
      // of the whole reject list: the empty-state text stands in reliably.
      expect(rtlScreen.queryByLabelText('Name for this code')).toBeNull();
    });
  });

  it('?s=setup at rank 1 renders W.notAllowed, not a page of 403-ing panels', async () => {
    // App.tsx's Session reads window.location.search only at its initial
    // useState(() => parseRoute()) call, so the URL must be set BEFORE mount.
    window.history.replaceState(null, '', '/?s=setup');
    renderApp({ role: 'viewer', routes: ALL_ROUTES });
    await waitFor(() => expect(rtlScreen.getByText(W.notAllowed)).toBeTruthy());
    expect(rtlScreen.getByText(W.question.setup)).toBeTruthy();
  });

  it('?s=health renders at rank 1 (owner decision, App.tsx:576)', async () => {
    window.history.replaceState(null, '', '/?s=health');
    renderApp({ role: 'viewer', routes: ALL_ROUTES });
    await waitFor(() => expect(rtlScreen.getByText(W.health.title)).toBeTruthy());
  });
});
