/**
 * Chart overhaul, Task T9 — `/api/*` route mocks for the Playwright layout
 * harness.
 *
 * This harness NEVER signs in with a real login (see `support/auth.ts`'s own
 * header and `feedback-no-agent-created-accounts`). Every fixture shape below
 * is copied from — or built to the same wire contract as — the real vitest
 * fixtures already in `web/src/testkit/fixtures.ts` and the per-report-type
 * `web/src/screens/report/*.test.tsx` files (Station.test.tsx,
 * Calibration.test.tsx, ConeWeight.test.tsx, Shift.test.tsx,
 * Reject.test.tsx), so a defect this suite finds is a defect against the
 * same contract the app's own component tests already exercise — not a
 * shape this harness invented.
 *
 * `metadata` (the `Envelope<T>` wrapper's second field) is the same
 * `META_FIXTURE` shape `web/src/testkit/fixtures.ts` documents at length:
 * TWO CLOCKS, deliberately different values, kept here for the same reason.
 */
import type { Page } from '@playwright/test';

export const META = {
  generatedAtUtc: '2026-09-07T12:00:05Z',
  weightBasis: 'gross',
  shiftMode: 'measured',
  transformVersion: 7,
  lastSyncUtc: '2026-09-07T12:00:00Z',
  sourceAgeSeconds: 42,
};

function envelope<T>(data: T) {
  return { data, metadata: META };
}

const GENERATION = {
  generation: {
    key: 'DATA_TP1U2_SEP07#3',
    ordinal: 3,
    sourceDb: 'DATA_TP1U2_SEP07',
    provenance: 'ifl_copy',
    label: 'September copy - cones',
    simulator: false,
  },
  spansGenerations: false,
  otherGenerationExcluded: 0,
  newerElsewhereUtc: null,
  newerElsewhereSourceDb: null,
  newerElsewhereLabel: null,
  newerElsewhereSimulator: false,
};

const N_STATIONS = 14;

export const STATIONS = {
  stations: Array.from({ length: N_STATIONS }, (_, i) => ({
    stationId: i + 1,
    name: null,
    machine: null,
    description: null,
    machineId: null,
    machineNo: null,
    machineName: `M${i + 1}`,
    linkSource: null,
    isActive: true,
  })),
};

export const PRODUCTS = {
  products: [
    {
      productId: 12, description: '201-IH0-SD', lotCode: null, setpointG: 1960,
      blend: 'A', countText: '20', tubeType: 'std', tubeWeightG: 45,
      weightOffsetMinusG: 20, weightOffsetPlusG: 20, activeFlag: true, color: 'PARROT',
    },
    {
      productId: 231, description: '205-IL0-SD', lotCode: null, setpointG: 1955,
      blend: 'B', countText: '30', tubeType: 'std', tubeWeightG: 45,
      weightOffsetMinusG: 18, weightOffsetPlusG: 18, activeFlag: true, color: 'BLUE',
    },
  ],
};

function liveLine() {
  return {
    generation: GENERATION,
    lineId: 1,
    lineName: 'TP1 Line 3 · Unit 2',
    lineShortName: 'Line 3',
    plantName: 'TP1',
    unitName: 'Unit 2',
    plantNowUtc: '2026-09-07T17:00:00Z',
    replay: false,
    plantOffsetMinutes: 300,
    shift: {
      code: 'evening',
      shiftDate: '2026-09-07',
      startUtc: '2026-09-07T09:00:00Z',
      endUtc: '2026-09-07T17:00:00Z',
      elapsedSeconds: 28_800,
      remainingSeconds: 0,
    },
    dataAsOfUtc: '2026-09-07T16:41:00Z',
    ingestLagSeconds: 1140,
    health: {
      kind: 'ok',
      ageSeconds: 90,
      oldestTable: 'sack1_TP1U2',
      cadenceSeconds: 60,
      staleAfterSeconds: 300,
      lagCeilingSeconds: 1800,
    },
    state: {
      status: 'running',
      sinceLastReadingSeconds: 90,
      behindSeconds: 0,
      runStartUtc: '2026-09-07T09:02:00Z',
      stopThresholdSeconds: 120,
    },
    thisShift: {
      cones: 4820,
      conesInRange: 4715,
      conesInRangePct: 97.8,
      rejectedCones: 61,
      sacks: 96,
      sackWeightKg: 2649.6,
      conesPerHour: 602.5,
    },
    recent: { conesLast10Min: 98, conesLastHour: 596, sacksLastHour: 12 },
    lastSack: { ts: '2026-09-07T16:40:12Z', eventId: 88213, sourceRowId: 41207, sackNum: 96, weightKg: 27.6, inRange: true },
    lastCone: { ts: '2026-09-07T16:40:58Z', eventId: 512044, sourceRowId: 132551, station: 5, weightG: 1948.2, inRange: true },
    lastReject: { ts: '2026-09-07T16:22:03Z', rejectType: 'quality', station: 3 },
    stations: Array.from({ length: N_STATIONS }, (_, i) => ({ station: i + 1, cones: 800 + i * 3, lastTs: '2026-09-07T16:40:40Z' })),
  };
}

export const LIVE = envelope({ lines: [liveLine()] });

// ---------------------------------------------------------------------
// Line's station-deviation chart: getProduction(groupBy:'station')
// ---------------------------------------------------------------------
export function productionByStation() {
  const rows = Array.from({ length: N_STATIONS }, (_, i) => ({
    group: String(i + 1),
    cones: 700 + (i % 3 === 0 ? 220 : i * 11), // deliberately uneven so bars vary in height
    rejectedCones: 8 + i,
    sacks: 14,
    sackWeightKg: 380.5,
    conesInRangePct: 91.2,
    sacksPassedScalePct: 88.4,
  }));
  return envelope({ groupBy: 'station', rows, unattributed: null, states: null, implausible: null });
}

export function productionNone(groupBy: string) {
  return envelope({ groupBy, rows: [{ group: 'total', cones: 9800, rejectedCones: 120, sacks: 196, sackWeightKg: 5390, conesInRangePct: 92.1, sacksPassedScalePct: 90.2 }], unattributed: null, states: null, implausible: null });
}

export function productionBySpread(spread: 'day' | 'shift') {
  const n = 7;
  const rows = Array.from({ length: n }, (_, i) => ({
    group: spread === 'day' ? `2026-09-0${i + 1}` : ['morning', 'evening', 'night'][i % 3],
    cones: 1200 + i * 47,
    rejectedCones: 20 + i,
    sacks: 24,
    sackWeightKg: 660,
    conesInRangePct: 92,
    sacksPassedScalePct: 89,
  }));
  return envelope({ groupBy: spread, rows, unattributed: null, states: null, implausible: null });
}

// getProductAt() is NOT Envelope-wrapped on the wire (api.ts:1468 returns
// `Promise<ProductAtData>` directly) — unlike almost everything else here.
export const PRODUCT_AT = {
  at: '2026-09-07T16:41:00Z',
  // `effectiveFromUtc` added 29 Sep 2026 (a11y.tables.spec.ts): `ProductInForce`
  // (api.ts) has it as a required `string`, not optional — Product › Running's
  // `LineWideProduct` calls `fmtDayLong(data.product.effectiveFromUtc)`
  // unconditionally, and a `charts.spec.ts` screen never exercised that path,
  // so its absence here never crashed anything until Running did.
  product: {
    productId: 12, label: '201-IH0-SD', source: 'row',
    setpointG: 1960, weightOffsetMinusG: 20, weightOffsetPlusG: 20,
    effectiveFromUtc: '2026-08-05T00:00:00Z',
  },
  productActive: true,
  limits: { setpointG: 1960, offsetMinusG: 20, offsetPlusG: 20, label: '1940 g – 1980 g' },
  neverRecorded: false,
  attribution: 'row' as const,
  source: 'row',
  plausibility: { loG: 1500, hiG: 2100 },
};

export const ATTENTION = envelope({
  window: { from: '2026-08-25', to: '2026-09-07', days: 14 },
  period: { from: '2026-09-01', to: '2026-09-07', shift: null },
  findings: [],
  totalFindings: 0,
  thresholds: { driftG: 9, minDaysHeld: 2 },
});

export const MACHINES_RUNNING = envelope({
  asOfUtc: '2026-09-07T16:41:00Z',
  windowMs: 7_200_000,
  windowStartUtc: '2026-09-07T14:41:00Z',
  machines: [],
  materialsRunning: 0,
  generation: GENERATION,
});

/** Non-empty variant of `MACHINES_RUNNING` (accessibility fix, 29 Sep 2026,
 *  `a11y.tables.spec.ts`): Line's `MachinesBlock` and Product › Running's
 *  `ByProduct` pivot both render `<Empty/>` — no table at all — on an empty
 *  `machines` list, which is exactly the fixture above. One running machine
 *  (feeds the "in force now" table, both screens) and one quiet machine
 *  (feeds the "not running" table, Running only) populate every `<thead>`
 *  those two components draw. */
export const MACHINES_RUNNING_WITH_ROWS = envelope({
  asOfUtc: '2026-09-07T16:41:00Z',
  windowMs: 7_200_000,
  windowStartUtc: '2026-09-07T14:41:00Z',
  machines: [
    {
      station: 1, stationName: null, machineName: 'M1', materialId: 12, productName: '201-IH0-SD', productActive: true,
      cones: 820, conesOnMaterial: 820, newestUtc: '2026-09-07T16:40:40Z', sinceUtc: '2026-09-07T14:41:00Z',
      sinceIsWindowStart: true, quiet: false, lastSeenUtc: '2026-09-07T16:40:40Z', state: 'running',
    },
    {
      station: 2, stationName: null, machineName: 'M2', materialId: null, productName: null, productActive: null,
      cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null,
      sinceIsWindowStart: false, quiet: true, lastSeenUtc: '2026-09-05T09:00:00Z', state: 'stale',
    },
  ],
  materialsRunning: 1,
  generation: GENERATION,
});

// ---------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------
export function weightStations(): unknown {
  const stations = Array.from({ length: N_STATIONS }, (_, i) => {
    const vsLine = i % 2 === 0 ? (i + 1) * 1.4 : -(i + 1) * 1.4;
    return {
      station: i + 1,
      n: 620 + i * 4,
      meanG: 1950 + vsLine,
      medianG: 1950 + vsLine,
      vsLineG: vsLine,
      vsTargetG: vsLine - 2,
      daysHeld: 3,
      flagged: i === 5,
      rejectRatePct: 2.1,
      lastAdjustedUtc: null,
      days: Array.from({ length: 7 }, (_, d) => ({ date: `2026-09-0${d + 1}`, n: 90, mean: 1950 + vsLine + d, nelson: [] })),
      // StationSheet.tsx's own `Body` reads these unconditionally
      // (sdG.toFixed, centrelineG, sigmaDayToDay.toFixed, longestRun) —
      // they are on `WeightStationRow`'s declaration-merged block
      // (api.ts:2107), not the smaller `WeightStationRow` shape `Weight.tsx`
      // itself reads from the same endpoint.
      sdG: 7.5,
      restartedOn: null,
      centrelineG: 1950 + vsLine,
      sigmaDayToDay: 1.2,
      longestRun: 7,
      projection: null,
      targetBasis: 'station_material',
      materialsInWindow: undefined,
      targetProductActive: true,
      targetIsLowerBound: false,
      targetAfterWindowEnd: false,
    };
  });
  return envelope({
    from: '2026-09-01',
    to: '2026-09-07',
    days: 7,
    lineMeanG: 1950,
    targetG: 1960,
    productId: 12,
    productLabel: '201-IH0-SD',
    thresholdG: 9,
    minDaysHeld: 2,
    lineRejectRatePct: 2.1,
    stations,
    disagreement: { passedButOutside: 3, rejectedButInside: 1, judged: 4300, unjudged: 0 },
    // WeightStationsData's own declaration-merged block (api.ts:2149).
    limits: { loG: 1940, hiG: 1980 },
    rules: [],
    targetEffectiveFromUtc: '2026-08-05T00:00:00Z',
    targetEffectiveIsLowerBound: false,
    targetEffectiveAfterWindowEnd: false,
    targetOmittedReason: null,
    stationsWithTargetWithheld: 0,
    limitsChangedInWindow: 0,
    productChangesInWindow: 0,
    productActive: true,
  });
}

/**
 * chart overhaul wave 3, Task T9 red-team (29 Sep 2026): `subgroupShiftRange`
 * (`web/src/screens/Weight.tsx`) reads `firstShiftDate`/`firstShiftCode`/
 * `lastShiftDate`/`lastShiftCode` off every subgroup to snap a brush drag to
 * shift boundaries, and returns `null` — silently declining the drag — when
 * any of them is missing. The real `/api/spc` (`api/src/services/spc.ts`'s
 * `decodeShiftKey`) always populates all four ("a group always has at least
 * one row... minShiftKey/maxShiftKey are never null in practice", spc.ts's
 * own comment); this fixture previously omitted them entirely, which is why
 * `layout-tests/charts.spec.ts`'s "Weight over-time chart: brush drag zooms
 * to a shift range" test never committed a range and had to skip itself —
 * a FIXTURE GAP against this screen's real wire contract, confirmed by
 * driving the same drag against the live simulator-backed app (which snaps
 * correctly once real subgroups, which always carry these fields, are used).
 * `shiftFor` below is a small, self-contained re-derivation of the app's own
 * boundary rule (`web/src/lib/period.ts`'s `SHIFT_START_HOUR`:
 * 06:00/14:00/22:00, plant-clock hours labelled UTC per CLAUDE.md's TWO
 * CLOCKS rule) — good enough to produce internally-consistent shift refs for
 * a mock, not a claim that it matches `decodeShiftKey`'s SQL byte for byte.
 */
type MockShiftName = 'morning' | 'evening' | 'night';
function shiftFor(ts: string): { date: string; code: MockShiftName } {
  const d = new Date(ts);
  const h = d.getUTCHours();
  const code: MockShiftName = h >= 6 && h < 14 ? 'morning' : h >= 14 && h < 22 ? 'evening' : 'night';
  // The night shift (22:00-06:00) is dated by the day it STARTS on, so hours
  // 0-5 belong to the PREVIOUS calendar day's night shift.
  const dayOffsetMs = code === 'night' && h < 6 ? -86_400_000 : 0;
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + dayOffsetMs)
    .toISOString()
    .slice(0, 10);
  return { date, code };
}

export function spc(type: 'cone' | 'sack' = 'cone'): unknown {
  const n = 40;
  const grandMean = type === 'cone' ? 1950 : 27.6;
  const subgroups = Array.from({ length: n }, (_, i) => {
    const mean = grandMean + Math.sin(i / 5) * (type === 'cone' ? 6 : 0.6);
    const startTs = new Date(Date.UTC(2026, 8, 5, 0, 0, 0) + i * 60 * 60_000).toISOString();
    // Each subgroup here is exactly one hour wide (bucketMinutes: 60 below),
    // so its first and last row fall in the same shift almost always — the
    // end instant only matters for a bucket that straddles a shift boundary,
    // which an hour-wide bucket starting exactly on 06:00/14:00/22:00 never
    // does. Computed from both ends anyway so this stays correct if the
    // bucket width here ever changes.
    const endTs = new Date(Date.UTC(2026, 8, 5, 0, 0, 0) + (i + 1) * 60 * 60_000 - 1000).toISOString();
    const first = shiftFor(startTs);
    const last = shiftFor(endTs);
    return {
      ts: startTs,
      n: 40,
      mean,
      s: type === 'cone' ? 7.2 : 0.7,
      xUcl: grandMean + (type === 'cone' ? 24 : 2.4),
      xLcl: grandMean - (type === 'cone' ? 24 : 2.4),
      sUcl: type === 'cone' ? 14 : 1.4,
      sLcl: 0,
      xViolates: i === 30,
      sViolates: false,
      nelson: [] as string[],
      firstShiftDate: first.date,
      firstShiftCode: first.code,
      lastShiftDate: last.date,
      lastShiftCode: last.code,
    };
  });
  const stations =
    type === 'cone'
      ? Array.from({ length: N_STATIONS }, (_, i) => {
          const delta = i % 2 === 0 ? (i + 1) * 1.4 : -(i + 1) * 1.4;
          return { station: i + 1, n: 620, mean: grandMean + delta, stdev: 7.5, delta, distinguishable: Math.abs(delta) > 5, flagged: i === 5 };
        })
      : [];
  const histogram = Array.from({ length: 20 }, (_, i) => ({
    start: grandMean - 50 + i * 5,
    end: grandMean - 45 + i * 5,
    count: Math.round(50 * Math.exp(-((i - 10) ** 2) / 18)),
  }));
  return envelope({
    specAgreement: null,
    type,
    unit: type === 'cone' ? 'g' : 'kg',
    count: 4800,
    mean: grandMean,
    stdevOverall: type === 'cone' ? 8.4 : 0.9,
    stdevWithin: type === 'cone' ? 7.2 : 0.7,
    bucketMinutes: 60,
    bucketLabel: 'hour',
    grandMean,
    sChartCenter: type === 'cone' ? 7.2 : 0.7,
    xbarOutOfControl: 1,
    nelsonFlagged: 0,
    subgroups,
    stations,
    practicalThresholdG: 9,
    distinguishableStationCount: 3,
    flaggedStationCount: 1,
    histogram,
    spec: { usl: grandMean + 20, lsl: grandMean - 20, nominal: grandMean, source: 'product', productLabel: '201-IH0-SD' },
    capability: { cp: 1.2, cpk: 1.1, pp: 1.15, ppk: 1.05 },
    generation: { epochId: 3, ordinal: 3, label: 'September copy', provenance: 'ifl_copy' },
    otherGenerationExcluded: 0,
    spansGenerations: false,
    xLimits: { valid: true, mrBar: 6.1, sigmaBetween: 5.4, halfWidth: 16.2, pairs: n - 1 },
    median: grandMean,
  });
}

// ---------------------------------------------------------------------
// Rejects
// ---------------------------------------------------------------------
export const RANGE = envelope({ from: '2026-08-05', to: '2026-09-07' });

export function rejectSpc(kind: 'quality' | 'weight' | 'all' = 'all'): unknown {
  // RejectBucket.rate/ucl/lcl are FRACTIONS (0-1) on the wire — the chart
  // multiplies by 100 itself (`report/shared.tsx`'s `pct()`). A fixture
  // that writes "2.0" meaning "2.0%" here (rather than 0.02) is not a
  // small units slip: it inflates every plotted value ~100x, which is
  // exactly the defect this suite's first Rejects run surfaced (grid tick
  // labels and end-of-line legend both reading a wildly compressed/
  // exploded scale). Keep these as fractions.
  const n = 30;
  const buckets = Array.from({ length: n }, (_, i) => ({
    bucketTs: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    generation: 3,
    produced: 4000 + i * 10,
    inspected: 4100 + i * 10,
    rejects: 80 + (i % 7),
    rate: (2.0 + (i % 5) * 0.3) / 100,
    ucl: 3.5 / 100,
    lcl: 0.5 / 100,
    outOfControl: i === 12 || i === 20,
  }));
  return envelope({
    bucketSize: 'day',
    rejectTypeFilter: kind,
    totalProduced: 132_000,
    totalRejects: 3600,
    pBar: 2.16 / 100,
    spansGenerations: false,
    generations: [],
    outOfControlCount: 2,
    buckets,
    episodes: [],
  });
}

export const REJECTS = envelope({
  total: 3600,
  reasons: [
    { rejectCodeId: 1, rejectType: 'quality', tubeCode: 3, materialCode: 5, label: 'Bad tube', displayLabel: 'Bad tube', count: 1500, pct: 41.7, cumulativePct: 41.7 },
    { rejectCodeId: 2, rejectType: 'weight', tubeCode: null, materialCode: null, label: null, displayLabel: 'weight:0:0', count: 2100, pct: 58.3, cumulativePct: 100 },
  ],
});

export const REJECTS_BY_DAY_CODE = envelope({ rows: [] });

// ---------------------------------------------------------------------
// Sacks
// ---------------------------------------------------------------------
export function sackSummary(): unknown {
  const grp = (n: number) => ({ sacks: 90 + n, kg: (90 + n) * 27.6, avgKg: 27.6, inRangePct: 92, inRange: 85 + n, noFlag: 3, implausible: 0 });
  return envelope({
    from: '2026-09-01',
    to: '2026-09-07',
    shift: null,
    product: null,
    totals: { ...grp(0), cones: 9800, conesPerSack: 108 },
    byShift: [
      { ...grp(1), shift: 'morning' },
      { ...grp(2), shift: 'evening' },
      { ...grp(0), shift: 'night' },
    ],
    byProduct: [
      { ...grp(3), materialId: 12, productName: '201-IH0-SD' },
      { ...grp(5), materialId: 231, productName: '205-IL0-SD' },
    ],
    unattributed: { rows: 0, of: 630 },
    weightBasis: 'gross',
    tareKg: 0,
    plausibility: { loKg: 40, hiKg: 60 },
    sackTimeIsInsertTime: true,
    conesPerSackApproximate: true,
    machineLevel: { enabled: false, reason: 'not computable from IFL data' },
  });
}

function ledgerFlow(sacks: number, kgPer = 27.6): { sacks: number; kg: number } {
  return { sacks, kg: sacks * kgPer };
}

export function sackStock(): unknown {
  const days = Array.from({ length: 7 }, (_, i) => {
    const w = 90 + i * 4;
    return {
      day: `2026-09-0${i + 1}`,
      opening: ledgerFlow(200 + i * w),
      openingEntries: ledgerFlow(0),
      receipts: ledgerFlow(0),
      weighed: ledgerFlow(w),
      issues: ledgerFlow(Math.round(w * 0.4)),
      consumption: ledgerFlow(0),
      adjustments: ledgerFlow(0),
      closing: ledgerFlow(200 + (i + 1) * w - Math.round(w * 0.4)),
      movements: 2,
    };
  });
  const byMaterial = [
    { materialId: 12, productName: '201-IH0-SD', opening: ledgerFlow(300), openingEntries: ledgerFlow(0), receipts: ledgerFlow(0), weighed: ledgerFlow(320), issues: ledgerFlow(120), consumption: ledgerFlow(0), adjustments: ledgerFlow(0), closing: ledgerFlow(500), kgMissing: 0 },
    { materialId: 231, productName: '205-IL0-SD', opening: ledgerFlow(220), openingEntries: ledgerFlow(0), receipts: ledgerFlow(0), weighed: ledgerFlow(228), issues: ledgerFlow(90), consumption: ledgerFlow(0), adjustments: ledgerFlow(0), closing: ledgerFlow(358), kgMissing: 0 },
  ];
  return envelope({
    from: '2026-09-01',
    to: '2026-09-07',
    product: null,
    basis: 'line',
    machineLevel: { enabled: false, reason: 'not computable from IFL data' },
    dayBasis: 'production_day',
    sackTimeIsInsertTime: true,
    receiptMeaning: 'note',
    weightBasis: 'gross',
    tareKg: 0,
    opening: ledgerFlow(200),
    closing: ledgerFlow(858),
    totals: {
      openingEntries: ledgerFlow(0),
      receipts: ledgerFlow(0),
      weighed: ledgerFlow(658),
      issues: ledgerFlow(258),
      consumption: ledgerFlow(0),
      adjustments: ledgerFlow(0),
    },
    days,
    byMaterial,
    kgMissing: 0,
    countedSinceDay: '2026-08-05',
    manualMovementRows: 4,
  });
}

export const SACK_EVENTS = envelope({ rows: [], total: 0, page: 1, pageSize: 50 });

// ---------------------------------------------------------------------
// Reports (generic /api/reports/{type})
// ---------------------------------------------------------------------
const REPORT_HEADER_BASE = {
  lineName: 'TP1 Line 3 · Unit 2',
  plantName: 'TP1',
  unitName: 'Unit 2',
  period: { period: 'week', from: '2026-09-01', to: '2026-09-07', days: 7 },
  filters: {},
  generatedAtPlantUtc: '2026-09-07T17:00:05Z',
  generatedBy: 'test',
  smsVersion: 'test',
  definitions: 'KPI-DEFINITIONS.md',
  approval: 'awaiting',
  spansGenerations: false,
  sourceGeneration: 'DATA_TP1U2_SEP07',
};

function reportHeader(reportType: string, title: string) {
  return { ...REPORT_HEADER_BASE, reportType, title };
}

const STATES = { within: 90, low: 3, high: 3, rejected: 2, unknown: 2 };

function reportLine(group: string, cones: number): unknown {
  return {
    group,
    cones,
    rejectedCones: 5,
    rejectRatePct: 2,
    conesInRangePct: 92,
    sacks: Math.round(cones / 50),
    sackWeightKg: Math.round(cones / 50) * 27.6,
    avgSackKg: 27.6,
    conesPerSack: cones > 0 ? Math.round(cones / (cones / 50)) : null,
    sacksPassedScalePct: 90,
  };
}

function dailyReport(): unknown {
  const byDay = Array.from({ length: 7 }, (_, i) => reportLine(`2026-09-0${i + 1}`, 1200 + i * 55));
  const byShift = ['morning', 'evening', 'night'].map((s) => reportLine(s, 3200));
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    coverage: { daysInPeriod: 7, daysWithData: 7, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-07', complete: true },
    totals: reportLine('total', 9800),
    byShift,
    byDay,
    downtime: { stoppageCount: 3, stoppedSeconds: 5400, thresholdSeconds: 120 },
    readings: { states: STATES, implausible: 4 },
    shiftCheck: { compared: 9800, mismatched: 40, mismatchPct: 0.4, topHour: 14 },
    shift: null,
    rejectPopulations: { byScale: 3600, byScalePct: 36.7, atInspection: 900, atInspectionPct: 9.2, note: 'note' },
  };
}

function shiftReport(): unknown {
  const days = [500, 480, 510, 490, 505, 470, 520];
  const shiftSection = (shift: string) => ({
    shift,
    coverage: { daysInPeriod: 7, daysWithData: 7, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-07', complete: true },
    totals: reportLine('total', days.reduce((s, v) => s + v, 0)),
    byDay: days.map((c, i) => reportLine(`2026-09-0${i + 1}`, c)),
    readings: { states: STATES, implausible: 1 },
  });
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    shift: null,
    shifts: [shiftSection('morning'), shiftSection('evening'), shiftSection('night')],
    shiftCheck: { compared: 9800, mismatched: 40, mismatchPct: 0.4, topHour: 14 },
    timeLostNote: 'note',
  };
}

function rejectReport(): unknown {
  const trend = Array.from({ length: 40 }, (_, i) => {
    const day = `2026-0${i < 30 ? 8 : 9}-${String((i % 30) + 1).padStart(2, '0')}`;
    const flagged = i < 3;
    return {
      day,
      produced: 500,
      inspected: 512,
      rejects: 12,
      ratePct: flagged ? 5.1 : 2.0,
      uclPct: 3.5,
      lclPct: 0.2,
      outOfControl: flagged,
    };
  });
  return {
    period: { period: 'month', from: '2026-08-01', to: '2026-09-09' },
    filters: {},
    total: 480,
    reasons: [
      { rejectCodeId: 1, rejectType: 'quality', tubeCode: 3, materialCode: 5, label: 'Bad tube', displayLabel: 'Bad tube', count: 200, pct: 41.7, cumulativePct: 41.7 },
      { rejectCodeId: 2, rejectType: 'weight', tubeCode: null, materialCode: null, label: null, displayLabel: 'weight:0:0', count: 280, pct: 58.3, cumulativePct: 100 },
    ],
    unattributed: null,
    dayBasis: 'production_day',
    denominator: 'cones_plus_rejects',
    byDayCode: [],
    trend,
    pBarPct: 2.16,
    spansGenerations: false,
    note: 'note',
  };
}

function stationReport(): unknown {
  const rows = Array.from({ length: N_STATIONS }, (_, i) => ({
    station: i + 1,
    cones: 700 + i * 5,
    weighedPlausible: 700 + i * 5,
    meanG: 1950 + (i % 2 === 0 ? i + 1 : -(i + 1)),
    vsLineG: i % 2 === 0 ? i + 1 : -(i + 1),
    vsTargetG: (i % 2 === 0 ? i + 1 : -(i + 1)) - 2,
    daysHeld: 3,
    flagged: i === 5,
    rejectedAtInspection: 8,
    rejectRatePct: 2,
    conesInRangePct: 90,
    lastAdjustedUtc: null,
    states: STATES,
  }));
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    lineMeanG: 1950,
    targetG: 1960,
    productLabel: 'Blend A',
    thresholdG: 9,
    minDaysHeld: 2,
    lineRejectRatePct: 2.1,
    rows,
    note: 'note',
  };
}

function coneWeightReport(): unknown {
  const histogram = Array.from({ length: 20 }, (_, i) => ({ bucket: 1900 + i * 5, count: Math.round(50 * Math.exp(-((i - 10) ** 2) / 18)) }));
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    basis: 'gross',
    cones: 9800,
    weighed: 9780,
    implausible: 20,
    meanG: 1950.2,
    medianG: 1950,
    medianSource: 'weights_service',
    sdG: 8.4,
    minG: 1901,
    maxG: 2005,
    states: STATES,
    bucketSizeG: 5,
    histogram,
    target: { setpointG: 1960, productId: 12, label: '201-IH0-SD', inForceAtUtc: '2026-08-05T00:00:00Z', limitsChangedInPeriod: 0, source: 'in_force_at_period_end', productActive: true },
    byStation: Array.from({ length: N_STATIONS }, (_, i) => ({ station: i + 1, n: 700, meanG: 1950 + i, vsLineG: i, vsTargetG: i - 2, flagged: i === 4 })),
    lineMeanG: 1950.2,
    plausibility: { loG: 1500, hiG: 2100 },
    note: 'note',
  };
}

function sackReport(): unknown {
  const byDay = Array.from({ length: 7 }, (_, i) => reportLine(`2026-09-0${i + 1}`, 1200 + i * 40));
  const histogram = Array.from({ length: 15 }, (_, i) => ({ bucket: 25 + i, count: Math.round(40 * Math.exp(-((i - 7) ** 2) / 10)) }));
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    filters: {},
    weightBasis: 'gross',
    totals: reportLine('total', 9800),
    rejectedByScale: 60,
    inRangePct: 92,
    conesPerSack: 108,
    byShift: ['morning', 'evening', 'night'].map((s) => reportLine(s, 3200)),
    byDay,
    byProduct: [
      { productId: 12, productLabel: '201-IH0-SD', sacks: 320, sackWeightKg: 8832, avgSackKg: 27.6 },
      { productId: 231, productLabel: '205-IL0-SD', sacks: 220, sackWeightKg: 6072, avgSackKg: 27.6 },
    ],
    distribution: { count: 540, implausible: 2, avg: 27.6, min: 22.1, max: 33.4, stdev: 1.8, bucketSize: 1, histogram },
    caveats: { time: 'note', machine: 'note', conesPerSack: 'note' },
  };
}

function calibrationReport(): unknown {
  const stations = Array.from({ length: N_STATIONS }, (_, i) => {
    const v = i % 2 === 0 ? i + 1 : -(i + 1);
    return {
      station: i + 1,
      n: 100,
      meanG: 1950 + v,
      vsLineG: v - 1,
      vsTargetG: v,
      daysHeld: 3,
      flagged: i === 3,
      daysFlagged: i === 3 ? 2 : 0,
      daysWithData: 7,
      lastAdjustedUtc: null,
      adjustmentsInPeriod: 0,
    };
  });
  return {
    period: { period: 'week', from: '2026-09-01', to: '2026-09-07' },
    filters: {},
    lineMeanG: 1950,
    targetG: 1960,
    productLabel: 'Blend A',
    thresholdG: 9,
    minDaysHeld: 2,
    stations,
    flaggedStationCount: 1,
    adjustments: [],
    note: 'note',
  };
}

export type ReportKind = 'daily' | 'shift' | 'reject' | 'station' | 'cone-weight' | 'sack' | 'calibration';

const REPORT_BUILDERS: Record<ReportKind, { title: string; body: () => unknown }> = {
  daily: { title: 'Daily production', body: dailyReport },
  shift: { title: 'By shift', body: shiftReport },
  reject: { title: 'Rejects', body: rejectReport },
  station: { title: 'By station', body: stationReport },
  'cone-weight': { title: 'Cone weight', body: coneWeightReport },
  sack: { title: 'Sacks', body: sackReport },
  calibration: { title: 'Calibration', body: calibrationReport },
};

export function reportEnvelope(kind: ReportKind): unknown {
  const b = REPORT_BUILDERS[kind];
  return envelope({ header: reportHeader(kind, b.title), report: b.body() });
}

export const REPORT_HEADER_ONLY = envelope({ header: reportHeader('daily', 'Daily production') });

// listAdjustments() is NOT Envelope-wrapped on the wire (api.ts:2216 returns
// `Promise<AdjustmentList>` directly) — same non-wrapped shape as PRODUCT_AT.
// `AdjustmentList` also merges in `plantOffsetMinutes`/`from`/`to`/`station`
// (api.ts's declaration-merged block ~2205) — StationSheet's `Body` reads
// `log.plantOffsetMinutes` unconditionally (StationSheet.tsx:219).
export const CALIBRATION_ADJUSTMENTS = { adjustments: [], plantOffsetMinutes: 300, from: null, to: null, station: null };

// ---------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------

/**
 * Playwright runs the MOST RECENTLY REGISTERED matching `page.route` handler
 * first (LIFO), not the most specific one — a later, broader pattern shadows
 * an earlier, narrower one even within the same page. `mockAuth`/
 * `mockCommon`/the per-screen `mock*` functions below are therefore always
 * called in this fixed order — catch-all FIRST, specific endpoints AFTER —
 * so the specific mocks are the ones actually in effect. Getting this
 * backwards was this suite's own first defect: `/api/auth/me` came back as
 * the catch-all's empty envelope instead of `{ user }` and the whole app sat
 * on its `undefined`-user loading div forever. See `primeScreen` in
 * `charts.spec.ts` for the call order this depends on.
 */

/** Anything under `/api/*` not given a specific mock: a harmless empty 200,
 *  so a screen this suite doesn't target for a given fetch (e.g.
 *  `/api/operations` on the health block every `Chrome` renders) degrades
 *  to its own "no data" state instead of hanging on a real network request
 *  or a console-spamming 404. MUST be registered before any specific route. */
export async function mockCatchAll(page: Page) {
  await page.route('**/api/**', (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    return route.fulfill({ json: envelope({}) });
  });
}

/** Signs the app in as `role` (default: manager, rank 3) with no real login. */
export async function mockAuth(page: Page, role: string = 'manager') {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { user: { username: 'layout-test', displayName: 'Layout Test', role } } }),
  );
}

/** The handful of endpoints nearly every screen behind `<App/>` fetches. */
export async function mockCommon(page: Page) {
  await page.route('**/api/live**', (route) => route.fulfill({ json: LIVE }));
  await page.route('**/api/stations', (route) => route.fulfill({ json: STATIONS }));
  await page.route('**/api/products', (route) => route.fulfill({ json: PRODUCTS }));
  await page.route('**/api/machines/running**', (route) => route.fulfill({ json: MACHINES_RUNNING }));
  await page.route('**/api/product-at**', (route) => route.fulfill({ json: PRODUCT_AT }));
  await page.route('**/api/attention**', (route) => route.fulfill({ json: ATTENTION }));
  // SimulatorBanner.tsx polls this on every period-figures screen
  // (Line/Readings/Weight/Rejects/Sacks/Report) and reads `.data.batches`
  // unconditionally — a missing/shape-mismatched fixture here crashes the
  // whole screen, not just the banner.
  await page.route('**/api/data-batch**', (route) => route.fulfill({ json: envelope({ batches: [] }) }));
}

export async function mockLine(page: Page) {
  await page.route('**/api/production**', (route) => {
    const url = new URL(route.request().url());
    const groupBy = url.searchParams.get('groupBy') ?? 'none';
    if (groupBy === 'station') return route.fulfill({ json: productionByStation() });
    if (groupBy === 'day' || groupBy === 'shift') return route.fulfill({ json: productionBySpread(groupBy as 'day' | 'shift') });
    return route.fulfill({ json: productionNone(groupBy) });
  });
}

export async function mockWeight(page: Page) {
  await page.route('**/api/weight-stations**', (route) => route.fulfill({ json: weightStations() }));
  await page.route('**/api/spc**', (route) => {
    const url = new URL(route.request().url());
    const type = (url.searchParams.get('type') as 'cone' | 'sack' | null) ?? 'cone';
    return route.fulfill({ json: spc(type) });
  });
  await page.route('**/api/production**', (route) => route.fulfill({ json: productionNone('none') }));
}

export async function mockRejects(page: Page) {
  await page.route('**/api/range**', (route) => route.fulfill({ json: RANGE }));
  await page.route('**/api/reject-spc**', (route) => {
    const url = new URL(route.request().url());
    const kind = (url.searchParams.get('rejectType') as 'quality' | 'weight' | 'all' | null) ?? 'all';
    return route.fulfill({ json: rejectSpc(kind) });
  });
  await page.route('**/api/rejects**', (route) => {
    if (route.request().url().includes('by-day-code')) return route.fulfill({ json: REJECTS_BY_DAY_CODE });
    return route.fulfill({ json: REJECTS });
  });
}

export async function mockSacks(page: Page) {
  await page.route('**/api/sacks/summary**', (route) => route.fulfill({ json: sackSummary() }));
  await page.route('**/api/sacks/stock**', (route) => route.fulfill({ json: sackStock() }));
  await page.route('**/api/reports/sack**', (route) => route.fulfill({ json: reportEnvelope('sack') }));
  await page.route('**/api/events**', (route) => route.fulfill({ json: SACK_EVENTS }));
}

export async function mockReport(page: Page, kind: ReportKind) {
  await page.route(`**/api/reports/${kind}**`, (route) => route.fulfill({ json: reportEnvelope(kind) }));
  await page.route('**/api/reports/header**', (route) => route.fulfill({ json: REPORT_HEADER_ONLY }));
  await page.route('**/api/calibration/adjustments**', (route) => route.fulfill({ json: CALIBRATION_ADJUSTMENTS }));
  if (kind === 'sack') await mockSacks(page);
}

// ---------------------------------------------------------------------
// Product screens (accessibility fix, 29 Sep 2026, a11y.tables.spec.ts):
// Running/Changeover/Catalogue's own table-header fixtures. Shapes copied
// from `web/src/api.ts`'s own interfaces (`ChangeoverRefs`, `ChangeoverPlan`,
// `ChangeoverOutcome`, `ProductWriteStatus`, `PalletRow`), the same
// convention every fixture above this section follows.
// ---------------------------------------------------------------------
export const PRODUCT_WRITE_STATUS = {
  enabled: true, reason: null, canWrite: true, local: { canWrite: true },
};

export const PALLETS = {
  pallets: [
    {
      palletId: 101, productId: 12, productLabel: '201-IH0-SD', packSchemaId: 1, packSchemaLabel: 'Standard',
      lot: 'L-2026-09', active: true, sackColour: 'White', labelType: 1, steamProg: 1, routing: 1,
      pdasCreatedAt: '2026-08-05T00:00:00Z',
    },
  ],
};

export const CHANGEOVER_REFS = {
  blends: [{ id: 1, name: 'Blend A' }],
  counts: [{ id: 1, name: '20' }],
  tubeTypes: [{ id: 1, name: 'std', tubeWeightG: 45, tubeForm: 1 }],
  packSchemas: [{ packSchemaId: 1, description: 'Standard', conesPerLayer: 12, packTypeId: 1 }],
  pallets: PALLETS.pallets,
};

/** `writesEnabled: true`/no blockers so `PlanReview`'s Execute button is
 *  actually clickable — the test drives it to also populate the second,
 *  outcome table (`colResult`). */
export function changeoverPlan(): unknown {
  return {
    writesEnabled: true,
    disabledReason: null,
    steps: [
      { step: 'blend', action: 'reuse', proc: null, label: 'Blend A', id: 1, detail: {} },
      { step: 'material', action: 'create', proc: 'CreateMaterial', label: 'New material', id: null, detail: { blend: 1, count: 1, tube: 1 } },
    ],
    blockers: [],
    warnings: [],
    noRollback: 'This cannot be undone once executed.',
    limits: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, label: '1930 g - 1990 g' },
    reachesMachine: false,
    operatorNote: 'Nothing is written to a machine.',
  };
}

export function changeoverOutcome(): unknown {
  return {
    ok: true,
    done: [
      { step: 'blend', action: 'reuse', proc: null, label: 'Blend A', id: 1, detail: {}, resultId: 1 },
      { step: 'material', action: 'create', proc: 'CreateMaterial', label: 'New material', id: null, detail: {}, resultId: 1025 },
    ],
    failed: null,
    notDone: [],
    materialId: 1025,
    palletId: null,
    noRollback: 'This cannot be undone once executed.',
  };
}

export async function mockProductRunning(page: Page) {
  await page.route('**/api/machines/running**', (route) => route.fulfill({ json: MACHINES_RUNNING_WITH_ROWS }));
}

export async function mockProductChangeover(page: Page) {
  await page.route('**/api/changeover/refs**', (route) => route.fulfill({ json: CHANGEOVER_REFS }));
  await page.route('**/api/changeover/plan**', (route) => route.fulfill({ json: changeoverPlan() }));
  await page.route('**/api/changeover/execute**', (route) => route.fulfill({ json: changeoverOutcome() }));
}

export async function mockProductCatalogue(page: Page) {
  await page.route('**/api/pallets**', (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    return route.fulfill({ json: PALLETS });
  });
  await page.route('**/api/product-write/status**', (route) => route.fulfill({ json: PRODUCT_WRITE_STATUS }));
  // ProductLimitsBlock (mounted un-collapsed on this tab) reads this raw
  // (never Envelope-wrapped — api/src/routes/cone.ts's `res.json({ products:
  // ... })`), unlike almost everything else this file mocks. Without a
  // specific route it fell through to `mockCatchAll`'s `envelope({})`, whose
  // `.products` is `undefined` — `res.data.products.length` then threw
  // "Cannot read properties of undefined (reading 'length')" and took the
  // WHOLE Catalogue screen down through the error boundary, including the
  // PDAS products/pallets tables above it that this spec actually targets.
  await page.route('**/api/products/limits/history**', (route) => route.fulfill({ json: { products: [] } }));
}

/** The station sheet is a `?sheet=station:N` overlay on TOP OF Line — the
 *  base Line screen underneath still renders and still calls everything
 *  `mockLine` covers (`/api/production`); omitting it here crashed Line's
 *  own render before the sheet ever got a chance to mount. */
export async function mockStationSheet(page: Page) {
  await mockLine(page);
  await page.route('**/api/weight-stations**', (route) => route.fulfill({ json: weightStations() }));
  await page.route('**/api/stations', (route) => route.fulfill({ json: STATIONS }));
  await page.route('**/api/machines/running**', (route) => route.fulfill({ json: MACHINES_RUNNING }));
  await page.route('**/api/calibration/adjustments**', (route) => route.fulfill({ json: CALIBRATION_ADJUSTMENTS }));
}
