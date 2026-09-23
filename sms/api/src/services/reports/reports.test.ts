/**
 * Roadmap Phase 8 (15 Sep 2026): the nine report services.
 *
 * Each report is COMPOSED from the services that already compute its
 * figures, so the thing to prove is delegation — that a report's number is
 * the service's number, obtained through the service, with the report's
 * period and filters — plus the shape the screen and the CSV read. The
 * delegated services are mocked with fixed answers; the two queries the
 * reports run themselves (per-product weights/states, per-station states,
 * the median, the adjustment ledger) run against a recording fake pool.
 *
 * Also pinned here: the prior-period arithmetic, the delta rules, the CSV
 * column order of every export, and the CSV escaping's agreement with the
 * register export's formula guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../report.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../report.js')>();
  return { ...actual, getReport: vi.fn() };
});
vi.mock('../register.js', () => ({ listEvents: vi.fn() }));
vi.mock('../production.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../production.js')>();
  return { ...actual, getProduction: vi.fn() };
});
vi.mock('../weights.js', () => ({ getWeights: vi.fn(), getConfiguredBasis: vi.fn() }));
vi.mock('../weightStations.js', () => ({ getWeightStations: vi.fn() }));
vi.mock('../rejects.js', () => ({ getRejectPareto: vi.fn(), getRejectsByDayCode: vi.fn() }));
vi.mock('../rejectSpc.js', () => ({ getRejectSpc: vi.fn() }));
vi.mock('../admin.js', () => ({ getPlausibilityRule: vi.fn() }));
vi.mock('../productLimits.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../productLimits.js')>();
  return { ...actual, loadProductCatalogue: vi.fn() };
});
vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn() }));
vi.mock('../coneState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../coneState.js')>();
  return { ...actual, loadStateContext: vi.fn() };
});

import { getReport, type ReportData } from '../report.js';
import { listEvents } from '../register.js';
import { getProduction } from '../production.js';
import { getWeights, getConfiguredBasis } from '../weights.js';
import { getWeightStations } from '../weightStations.js';
import { getRejectPareto, getRejectsByDayCode } from '../rejects.js';
import { getRejectSpc } from '../rejectSpc.js';
import { getPlausibilityRule } from '../admin.js';
import { loadProductCatalogue } from '../productLimits.js';
import { getLineIdentity } from '../lineConfig.js';
import { loadStateContext } from '../coneState.js';

import { priorPeriod, delta, daysIn, FILTERS_BY_TYPE, REPORT_TYPES, REPORT_RANK } from './common.js';
import { escapeCell, toCsv, csvDocument, attributionRows, csvFilename } from './csv.js';
import { buildHeader } from './header.js';
import { getDailyReport, dailyCsv, DAILY_CSV_HEADERS } from './daily.js';
import { getShiftReport, shiftCsv } from './shift.js';
import { getProductReport, productCsv, PRODUCT_CSV_HEADERS } from './product.js';
import { getStationReport, stationCsv, STATION_CSV_HEADERS } from './station.js';
import { getRejectReport, rejectCsv, REJECT_CSV_HEADERS } from './reject.js';
import { getConeWeightReport, coneWeightCsv, medianConeWeight, CONE_WEIGHT_CSV_HEADERS } from './coneWeight.js';
import { getSackReport, sackCsv, SACK_CSV_HEADERS } from './sack.js';
import { getCalibrationReport, calibrationCsv, periodAsUtcBounds, CALIBRATION_CSV_HEADERS } from './calibration.js';
import { getManagementSummary, summaryCsv, KPI_DEFINITIONS, SUMMARY_CSV_HEADERS } from './summary.js';
import { buildReport, reportCsv } from './index.js';

/* ------------------------------------------------------------- fixtures */

interface Captured { sql: string; params: Map<string, unknown> }

function fakePool(answer: (sql: string, params: Map<string, unknown>) => Record<string, unknown>[] = () => []): { pool: ConnectionPool; calls: Captured[] } {
  const calls: Captured[] = [];
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (name: string, _t: unknown, v: unknown) => { params.set(name, v); return req; },
        query: async (sql: string) => { calls.push({ sql, params }); return { recordset: answer(sql, params), rowsAffected: [0] }; },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  return { pool, calls };
}

const PERIOD = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-07' };
const line = (group: string, cones: number, rejected = 0, sacks = 10, kg = 470) => ({
  group, cones, rejectedCones: rejected, sacks, sackWeightKg: kg, conesInRangePct: 99.5,
});
const reportLine = (group: string, cones: number) => ({
  group, cones, rejectedCones: 20, rejectRatePct: 1.96, conesInRangePct: 99.5, sacks: 40, sackWeightKg: 1880, avgSackKg: 47, conesPerSack: 25,
});
const STATES = { within: 900, low: 10, high: 5, rejected: 3, unknown: 82 };

function fakeReport(over: Partial<ReportData> = {}): ReportData {
  return {
    period: PERIOD,
    shift: null,
    coverage: { daysInPeriod: 7, daysWithData: 7, firstDayWithData: '2026-09-01', lastDayWithData: '2026-09-07', complete: true },
    totals: reportLine('total', 1000),
    byShift: [reportLine('morning', 400), reportLine('evening', 300), reportLine('night', 300)],
    byDay: [reportLine('2026-09-01', 500), reportLine('2026-09-02', 500)],
    downtime: { stoppageCount: 3, stoppedSeconds: 900, thresholdSeconds: 120 },
    readings: { states: STATES, implausible: 4 },
    shiftCheck: { compared: 1000, mismatched: 23, mismatchPct: 2.3, topHour: 13 },
    ...over,
  };
}

const CTX = { plausibility: { loG: 1500, hiG: 2100 }, windows: [{ materialId: 21, fromMs: null, toMs: null, loG: 1930, hiG: 1990, assumedStart: false }] };

const stationRow = (station: number, flagged = false) => ({
  station, n: 500, meanG: 1958.2, vsLineG: 1.1, vsTargetG: -1.8, targetBasis: 'line_product' as const, daysHeld: 3, flagged, rejectRatePct: 2.1, lastAdjustedUtc: null,
  days: [{ date: '2026-09-05', n: 100, mean: 1958, nelson: flagged ? [2] : [] }, { date: '2026-09-06', n: 100, mean: 1959, nelson: [] }],
});
// U1/U2 (16 Sep 2026): the cone-weight report's target and the station
// table's own qualifier now come from these two fields.
const fakeStations = () => ({
  from: PERIOD.from, to: PERIOD.to, days: 7, lineMeanG: 1957.1, targetG: 1960, productId: 21, productLabel: '205-IL0-SD',
  targetEffectiveFromUtc: '2026-08-20T00:00:00.000Z', limitsChangedInWindow: 0, productChangesInWindow: 0,
  thresholdG: 3, minDaysHeld: 3, lineRejectRatePct: 2.16, stations: [stationRow(7, true), stationRow(3)],
});
// U1 (16 Sep 2026): coneWeight.ts no longer reads weights.ts's own nominal/
// giveaway fields (it takes its target from getWeightStations instead — see
// fakeStations() above), so this fixture no longer carries them; nothing
// left in reports/ consumes them.
const fakeWeights = () => ({
  basis: 'as_recorded' as const,
  cone: {
    count: 996, implausible: 4, avg: 1957.1, min: 1802, max: 2050, stdev: 12.3, unit: 'g' as const, bucketSize: 20,
    histogram: [{ bucket: 1940, count: 400 }, { bucket: 1960, count: 596 }], outliers: [],
  },
  sack: {
    count: 40, implausible: 1, avg: 47, min: 45, max: 49, stdev: 0.8, unit: 'kg' as const, bucketSize: 1,
    histogram: [{ bucket: 46, count: 20 }, { bucket: 47, count: 20 }], outliers: [],
  },
  note: '',
});

beforeEach(() => {
  vi.mocked(getReport).mockReset();
  vi.mocked(listEvents).mockReset();
  vi.mocked(getProduction).mockReset();
  vi.mocked(getWeights).mockReset();
  vi.mocked(getConfiguredBasis).mockReset();
  vi.mocked(getWeightStations).mockReset();
  vi.mocked(getRejectPareto).mockReset();
  vi.mocked(getRejectsByDayCode).mockReset();
  vi.mocked(getRejectSpc).mockReset();
  vi.mocked(getPlausibilityRule).mockReset();
  vi.mocked(loadProductCatalogue).mockReset();
  vi.mocked(getLineIdentity).mockReset();
  vi.mocked(loadStateContext).mockReset();

  vi.mocked(getReport).mockImplementation(async (_p, _l, resolved, shift) => fakeReport({ period: resolved, shift: shift ?? null, downtime: shift ? null : fakeReport().downtime }));
  vi.mocked(listEvents).mockResolvedValue({ rows: [], total: 17, page: 1, pageSize: 1 });
  vi.mocked(getProduction).mockImplementation(async (_p, _l, q) => {
    const rows =
      q.groupBy === 'none' ? [line('total', 1000, 20, 40, 1880)]
      : q.groupBy === 'shift' ? [line('night', 300), line('morning', 400), line('evening', 300)]
      : q.groupBy === 'day' ? [line('2026-09-01', 500), line('2026-09-02', 500)]
      : q.groupBy === 'station' ? [line('3', 480, 9), line('7', 520, 11)]
      : [line('21', 700, 14, 28, 1316), line('none', 300, 6, 12, 564)];
    // `dataIssues: []` — WS-P (23 Sep 2026): ProductionResult now always
    // carries this field (see production.ts). This mock's rows are all
    // hand-built and well-formed, so an empty array is correct here, not a
    // placeholder.
    return { groupBy: q.groupBy, rows, unattributed: null, states: q.withStates ? STATES : null, implausible: q.withStates ? 4 : null, dataIssues: [] };
  });
  // `as never`: Phase 9 is adding fields to these two shapes in the same wave; the report reads only what it names.
  vi.mocked(getWeights).mockResolvedValue(fakeWeights() as never);
  vi.mocked(getConfiguredBasis).mockResolvedValue('as_recorded');
  vi.mocked(getWeightStations).mockResolvedValue(fakeStations() as never);
  vi.mocked(getRejectPareto).mockResolvedValue({
    total: 20,
    reasons: [{ rejectCodeId: 1, rejectType: 'quality', tubeCode: 1, materialCode: 3, label: null, displayLabel: 'Tube 1 · Mat 3', count: 15, pct: 75, cumulativePct: 75 },
              { rejectCodeId: null, rejectType: 'weight', tubeCode: null, materialCode: null, label: null, displayLabel: 'Weight out of range', count: 5, pct: 25, cumulativePct: 100 }],
    unattributed: null,
  });
  vi.mocked(getRejectsByDayCode).mockResolvedValue({
    dayBasis: 'production_day', denominator: 'cones_plus_rejects', days: 2, total: 20,
    rows: [{ day: '2026-09-01', rejectType: 'quality', tubeCode: 1, materialCode: 3, rejectCodeId: 1, label: null, displayLabel: 'Tube 1 · Mat 3', isPass: null, count: 8, cones: 500, inspected: 510, ratePct: 1.6 }],
  });
  vi.mocked(getRejectSpc).mockResolvedValue({
    bucketSize: 'day', rejectTypeFilter: 'all', totalProduced: 1000, totalRejects: 20, pBar: 0.0196, spansGenerations: false, generations: [],
    outOfControlCount: 1, episodes: [],
    buckets: [{ bucketTs: '2026-09-01T00:00:00.000Z', generation: 2, produced: 500, inspected: 510, rejects: 10, rate: 0.0196, ucl: 0.038, lcl: 0.001, outOfControl: false },
              { bucketTs: '2026-09-02T00:00:00.000Z', generation: 2, produced: 500, inspected: 510, rejects: 10, rate: 0.045, ucl: 0.038, lcl: 0.001, outOfControl: true }],
  });
  vi.mocked(getPlausibilityRule).mockResolvedValue({ coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 });
  // U3 (16 Sep 2026): product.ts now also asks the catalogue for a product's
  // own versioned limits (versionAt/versionsAscending), so the fake here
  // carries one version for product 21 — effective well before PERIOD, so
  // the default fixture reports limitsChangedInPeriod: 0 unless a test
  // overrides it.
  const PRODUCT_21_VERSION = {
    productId: 21, setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30,
    effectiveFromMs: Date.parse('2026-08-20T00:00:00Z'), effectiveFromUtc: '2026-08-20T00:00:00.000Z',
    effectiveIsLowerBound: false, source: 'pdas_observed' as const,
  };
  vi.mocked(loadProductCatalogue).mockResolvedValue({
    product: (id: number) => (id === 21 ? { productId: 21, label: '205-IL0-SD', activeFlag: true } : null),
    distinctLabel: (id: number) => (id === 21 ? '205-IL0-SD' : `Product ${id}`),
    versionAt: (id: number, ms: number) => (id === 21 && ms >= PRODUCT_21_VERSION.effectiveFromMs ? PRODUCT_21_VERSION : null),
    versionsAscending: (id: number) => (id === 21 ? [PRODUCT_21_VERSION] : []),
    limitsAt: (id: number) => (id === 21 ? { targetG: 1960, loG: 1930, hiG: 1990, label: '1,960 ± 30 g' } : null),
    latest: (id: number) => (id === 21 ? PRODUCT_21_VERSION : null),
    productIds: () => [21],
    isEmpty: false,
  } as never);
  vi.mocked(getLineIdentity).mockResolvedValue({
    lineId: 1, code: 'L3', name: 'Line 3', displayName: 'TP1 · Line 3 · Unit 2', isActive: true,
    unit: { unitId: 1, code: 'U2', name: 'Unit 2' }, plant: { plantId: 1, code: 'TP1', name: 'TP1' },
  });
  vi.mocked(loadStateContext).mockResolvedValue(CTX);
});

/* ------------------------------------------------------ pure arithmetic */

describe('priorPeriod — the period of equal length immediately before', () => {
  it('a week is compared with the seven days before it', () => {
    expect(priorPeriod('2026-09-07', '2026-09-13')).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });
  it('a single day with the day before', () => {
    expect(priorPeriod('2026-09-01', '2026-09-01')).toEqual({ from: '2026-08-31', to: '2026-08-31' });
  });
  it('a 31-day month with the 31 days before it, not "the previous month"', () => {
    const p = priorPeriod('2026-08-01', '2026-08-31');
    expect(p).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(daysIn(p.from, p.to)).toBe(31);
    // 30-day September is compared with 30 days ending 31 Aug, i.e. from 2 Aug.
    expect(priorPeriod('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-02', to: '2026-08-31' });
  });
  it('crosses a year boundary', () => {
    expect(priorPeriod('2027-01-01', '2027-01-07')).toEqual({ from: '2026-12-25', to: '2026-12-31' });
  });
});

describe('delta', () => {
  it('is the change and its share of the prior', () => {
    expect(delta(110, 100)).toEqual({ abs: 10, pct: 10 });
    expect(delta(90, 100)).toEqual({ abs: -10, pct: -10 });
  });
  it('is null when either side is unknown — never "down 100 %"', () => {
    expect(delta(null, 100)).toBeNull();
    expect(delta(100, null)).toBeNull();
  });
  it('has no percentage against a prior of zero', () => {
    expect(delta(5, 0)).toEqual({ abs: 5, pct: null });
  });
});

/* -------------------------------------------------------------------- CSV */

describe('CSV escaping agrees with the register export', () => {
  it('prefixes formula-leading cells and quotes commas, quotes and newlines', () => {
    expect(escapeCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCell('+1')).toBe("'+1");
    expect(escapeCell('-5')).toBe("'-5");
    expect(escapeCell('@x')).toBe("'@x");
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(-5)).toBe("'-5"); // a negative NUMBER is a string starting with '-' once serialised
    expect(escapeCell(true)).toBe('true');
  });
  it('a document is one table, a blank line, then the attribution rows in a fixed order', async () => {
    const header = await buildHeader(fakePool().pool, 1, {
      reportType: 'daily', period: PERIOD, filters: { shift: 'night' }, user: { username: 'gm', displayName: 'The GM' }, lineNameFallback: 'x',
      plantNowMsOverride: Date.UTC(2026, 8, 15, 10, 0, 0),
    });
    const doc = csvDocument(['a', 'b'], [[1, 2]], header);
    const [table, blank, ...attr] = doc.split('\n');
    expect(table).toBe('a,b');
    expect(blank).toBe('1,2');
    expect(attr[0]).toBe('');
    expect(attr.slice(1).map((l) => l.split(',')[0])).toEqual([
      'report', 'line', 'period', 'filters', 'generated_at_plant_time', 'generated_by', 'sms_version', 'definitions', 'ifl_approval',
    ]);
    expect(attributionRows(header).find(([k]) => k === 'filters')![1]).toBe('shift=night');
    expect(attributionRows(header).find(([k]) => k === 'generated_by')![1]).toBe('The GM');
    expect(attributionRows(header).find(([k]) => k === 'ifl_approval')![1]).toBe('awaiting');
    expect(csvFilename(header)).toBe('sms-report-daily-2026-09-01_to_2026-09-07.csv');
    expect(toCsv([], [['k', 'v']])).toBe('k,v');
  });
});

describe('the header', () => {
  it('stamps the plant clock, the line display name and the author', async () => {
    const h = await buildHeader(fakePool().pool, 1, {
      reportType: 'reject', period: PERIOD, filters: {}, user: { username: 'ops', displayName: null }, lineNameFallback: 'fallback',
      plantNowMsOverride: Date.UTC(2026, 8, 15, 10, 0, 0),
    });
    expect(h.title).toBe('Reject report');
    expect(h.lineName).toBe('TP1 · Line 3 · Unit 2');
    expect(h.plantName).toBe('TP1');
    expect(h.generatedAtPlantUtc).toBe('2026-09-15T10:00:00.000Z');
    expect(h.generatedBy).toBe('ops');
    expect(h.period.days).toBe(7);
    expect(h.approval).toBe('awaiting');
    expect(typeof h.smsVersion).toBe('string');
  });
  it('falls back to the configured line name when sms.line has no row', async () => {
    vi.mocked(getLineIdentity).mockResolvedValueOnce(null);
    const h = await buildHeader(fakePool().pool, 1, { reportType: 'daily', period: PERIOD, filters: {}, user: null, lineNameFallback: 'LINE_NAME' });
    expect(h.lineName).toBe('LINE_NAME');
    expect(h.generatedBy).toBe('unknown');
  });
});

/* ------------------------------------------------------------ the reports */

describe('daily report', () => {
  it('delegates to getReport with the shift and names the two reject populations from the register', async () => {
    const d = await getDailyReport(fakePool().pool, 1, PERIOD, { shift: 'night' });
    expect(getReport).toHaveBeenCalledWith(expect.anything(), 1, PERIOD, 'night');
    expect(listEvents).toHaveBeenCalledWith(expect.anything(), 1, 'cone', expect.objectContaining({ from: PERIOD.from, to: PERIOD.to, shift: 'night', inRange: false, pageSize: 1 }));
    expect(d.rejectPopulations.byScale).toBe(17);
    expect(d.rejectPopulations.byScalePct).toBe(1.7);
    expect(d.rejectPopulations.atInspection).toBe(20);
    expect(d.rejectPopulations.atInspectionPct).toBe(1.96);
    expect(d.downtime).toBeNull(); // a shift filter drops time lost rather than printing the whole day's
  });
  it('CSV: column order, one row per scope, the scale figure only on the total', () => {
    const t = dailyCsv({ ...fakeReport(), rejectPopulations: { byScale: 17, byScalePct: 1.7, atInspection: 20, atInspectionPct: 1.96, note: '' } });
    expect(t.headers).toEqual(DAILY_CSV_HEADERS);
    expect(t.rows[0]).toEqual(['total', 'total', 1000, 99.5, 40, 1880, 47, 25, 20, 1.96, 17]);
    expect(t.rows[1]![0]).toBe('shift');
    expect(t.rows[1]![10]).toBeNull();
    expect(t.rows.map((r) => r[0])).toEqual(['total', 'shift', 'shift', 'shift', 'day', 'day', 'downtime', 'downtime', 'readings', 'state', 'state', 'state', 'state', 'state']);
  });
});

describe('shift report', () => {
  it('is getReport once per shift — all three when none is chosen', async () => {
    const d = await getShiftReport(fakePool().pool, 1, PERIOD, {});
    expect(vi.mocked(getReport).mock.calls.map((c) => c[3])).toEqual(['morning', 'evening', 'night']);
    expect(d.shifts.map((s) => s.shift)).toEqual(['morning', 'evening', 'night']);
    expect(d.shift).toBeNull();
    expect(d.timeLostNote).toMatch(/not split by shift/);
  });
  it('one call for the chosen shift, and the CSV carries the shift in the section', async () => {
    const d = await getShiftReport(fakePool().pool, 1, PERIOD, { shift: 'night' });
    expect(getReport).toHaveBeenCalledTimes(1);
    expect(d.shifts).toHaveLength(1);
    const t = shiftCsv(d);
    expect(t.headers).toEqual(DAILY_CSV_HEADERS);
    expect(t.rows.map((r) => r[0])).toEqual(['night:total', 'night:day', 'night:day']);
  });
});

describe('product report', () => {
  it('groups production by product, computes weights and states per product under the one population rule, and states the unattributed count', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('STDEV')) return [{ grp: '21', n: 690, avg: 1958.4, sd: 11.2, mn: 1900, mx: 2010, excluded: 10 }, { grp: 'none', n: 300, avg: 1950, sd: 9, mn: 1910, mx: 1990, excluded: 0 }];
      if (sql.includes('GROUP BY ISNULL') && sql.includes('CASE')) return [{ grp: '21', state: 'within', n: 680 }, { grp: '21', state: 'low', n: 20 }, { grp: 'none', state: 'unknown', n: 300 }];
      return [];
    });
    const d = await getProductReport(pool, 1, PERIOD, { shift: 'morning', station: 7 });
    expect(getProduction).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ groupBy: 'product', shift: 'morning', station: 7 }));
    expect(d.rows.map((r) => r.productId)).toEqual([21, null]);
    expect(d.rows[0]).toMatchObject({ productLabel: '205-IL0-SD', cones: 700, weight: { n: 690, avgG: 1958.4, sdG: 11.2 }, states: { within: 680, low: 20, high: 0, rejected: 0, unknown: 0 }, implausible: 10 });
    expect(d.rows[1]).toMatchObject({ productLabel: 'No product on the reading', states: { unknown: 300 } });
    // U3 (16 Sep 2026): each row's target comes from THAT product's own
    // versioned limits — never null for a real product, always null for the
    // "No product on the reading" row.
    expect(d.rows[0]!.target).toEqual({ setpointG: 1960, loG: 1930, hiG: 1990, inForceAtUtc: '2026-08-20T00:00:00.000Z', inForceIsLowerBound: false, limitsChangedInPeriod: 0 });
    expect(d.rows[0]!.vsTargetG).toBeCloseTo(1958.4 - 1960, 5);
    expect(d.rows[1]!.target).toBeNull();
    expect(d.rows[1]!.vsTargetG).toBeNull();
    expect(d.unattributed).toEqual({ cones: 300, rejects: 6, sacks: 12, ofCones: 1000, ofRejects: 20, ofSacks: 40 });
    // Both own queries bind the plausibility window and the same filters.
    const own = calls.filter((c) => c.sql.includes('FROM sms.cone_event'));
    expect(own).toHaveLength(2);
    for (const c of own) {
      expect(c.params.get('shift')).toBe('morning');
      expect(c.params.get('station')).toBe(7);
    }
    expect(own[0]!.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    expect(own[0]!.params.get('plausLo')).toBe(1500);
    expect(own[1]!.sql).toContain("WHEN in_range = 0 THEN 'rejected'");
    const t = productCsv(d);
    expect(t.headers).toEqual(PRODUCT_CSV_HEADERS);
    expect(t.rows[0]!.slice(0, 3)).toEqual([21, '205-IL0-SD', 700]);
  });

  it("product report resolves each row's target from that product's own limit version", async () => {
    // Two products, each with its own limits, one of which changed INSIDE
    // the period — pinning that the count is per-product, not the line-wide
    // qualifier, and that "changed" means began inside the period (mirrors
    // spc.getSpec.test.ts's own rule for the same arithmetic).
    vi.mocked(getProduction).mockResolvedValueOnce({
      groupBy: 'product', unattributed: null, states: null, implausible: null,
      rows: [
        { group: '21', cones: 700, rejectedCones: 14, rejectRatePct: 2, conesInRangePct: 99, sacks: 28, sackWeightKg: 1316, avgSackKg: 47, conesPerSack: 25 },
        { group: '22', cones: 300, rejectedCones: 6, rejectRatePct: 2, conesInRangePct: 99, sacks: 12, sackWeightKg: 564, avgSackKg: 47, conesPerSack: 25 },
      ],
    } as never);
    const V21 = { productId: 21, setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, effectiveFromMs: Date.parse('2026-08-20T00:00:00Z'), effectiveFromUtc: '2026-08-20T00:00:00.000Z', effectiveIsLowerBound: false, source: 'pdas_observed' as const };
    const V22_OLD = { productId: 22, setpointG: 1900, offsetMinusG: 20, offsetPlusG: 20, effectiveFromMs: Date.parse('2026-07-01T00:00:00Z'), effectiveFromUtc: '2026-07-01T00:00:00.000Z', effectiveIsLowerBound: false, source: 'pdas_observed' as const };
    const V22_NEW = { productId: 22, setpointG: 1905, offsetMinusG: 20, offsetPlusG: 20, effectiveFromMs: Date.parse('2026-09-03T00:00:00Z'), effectiveFromUtc: '2026-09-03T00:00:00.000Z', effectiveIsLowerBound: false, source: 'sms_local' as const };
    vi.mocked(loadProductCatalogue).mockResolvedValueOnce({
      product: (id: number) => (id === 21 ? { productId: 21, label: '205-IL0-SD', activeFlag: true } : id === 22 ? { productId: 22, label: 'Other blend', activeFlag: true } : null),
      distinctLabel: (id: number) => (id === 21 ? '205-IL0-SD' : id === 22 ? 'Other blend' : `Product ${id}`),
      versionAt: (id: number, ms: number) => (id === 21 ? V21 : id === 22 ? (ms >= V22_NEW.effectiveFromMs ? V22_NEW : V22_OLD) : null),
      versionsAscending: (id: number) => (id === 21 ? [V21] : id === 22 ? [V22_OLD, V22_NEW] : []),
      limitsAt: () => null,
      latest: () => null,
      productIds: () => [21, 22],
      isEmpty: false,
    } as never);
    const { pool } = fakePool((sql) => {
      if (sql.includes('STDEV')) return [{ grp: '21', n: 690, avg: 1958.4, sd: 11.2, mn: 1900, mx: 2010, excluded: 0 }, { grp: '22', n: 290, avg: 1902, sd: 9, mn: 1880, mx: 1930, excluded: 0 }];
      if (sql.includes('GROUP BY ISNULL') && sql.includes('CASE')) return [{ grp: '21', state: 'within', n: 690 }, { grp: '22', state: 'within', n: 290 }];
      return [];
    });
    const d = await getProductReport(pool, 1, PERIOD, {});
    const p21 = d.rows.find((r) => r.productId === 21)!;
    const p22 = d.rows.find((r) => r.productId === 22)!;
    expect(p21.target).toEqual({ setpointG: 1960, loG: 1930, hiG: 1990, inForceAtUtc: '2026-08-20T00:00:00.000Z', inForceIsLowerBound: false, limitsChangedInPeriod: 0 });
    // Product 22's newer version (2026-09-03) began INSIDE [2026-09-01, 2026-09-07]: one change.
    expect(p22.target).toEqual({ setpointG: 1905, loG: 1885, hiG: 1925, inForceAtUtc: '2026-09-03T00:00:00.000Z', inForceIsLowerBound: false, limitsChangedInPeriod: 1 });
    expect(p21.vsTargetG).toBeCloseTo(1958.4 - 1960, 5);
    expect(p22.vsTargetG).toBeCloseTo(1902 - 1905, 5);
  });
});

describe('station report', () => {
  it('takes bias, flags and reject rates from the one station table and counts from production', async () => {
    const { pool, calls } = fakePool((sql) => (sql.includes('GROUP BY source_station') ? [{ st: 7, state: 'within', n: 510 }, { st: 7, state: 'rejected', n: 10 }, { st: 3, state: 'within', n: 480 }] : []));
    const d = await getStationReport(pool, 1, PERIOD, {});
    expect(getWeightStations).toHaveBeenCalledWith(expect.anything(), 1, PERIOD.from, PERIOD.to);
    expect(getProduction).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ groupBy: 'station' }));
    expect(d.rows.map((r) => r.station)).toEqual([3, 7]);
    expect(d.rows[1]).toMatchObject({ station: 7, cones: 520, rejectedAtInspection: 11, meanG: 1958.2, vsLineG: 1.1, vsTargetG: -1.8, flagged: true, rejectRatePct: 2.1, states: { within: 510, rejected: 10 } });
    expect(d.lineRejectRatePct).toBe(2.16);
    expect(calls.find((c) => c.sql.includes('GROUP BY source_station'))!.sql).toContain('CASE');
    const t = stationCsv(d);
    expect(t.headers).toEqual(STATION_CSV_HEADERS);
    expect(t.rows[0]!.slice(0, 2)).toEqual([3, 480]);
  });
});

describe('reject report', () => {
  it('composes the Pareto, the per-day-per-code table and the daily trend with the same filters', async () => {
    const d = await getRejectReport(fakePool().pool, 1, PERIOD, { shift: 'evening', station: 2, product: 21 });
    const f = { from: PERIOD.from, to: PERIOD.to, shift: 'evening', station: 2, product: 21 };
    expect(getRejectPareto).toHaveBeenCalledWith(expect.anything(), 1, f);
    expect(getRejectsByDayCode).toHaveBeenCalledWith(expect.anything(), 1, f);
    expect(getRejectSpc).toHaveBeenCalledWith(expect.anything(), 1, PERIOD.from, PERIOD.to, 'day', 'all', { shift: 'evening', station: 2, product: 21 });
    expect(d.total).toBe(20);
    expect(d.trend[1]).toEqual({ day: '2026-09-02', produced: 500, inspected: 510, rejects: 10, ratePct: 4.5, uclPct: 3.8, lclPct: 0.1, outOfControl: true });
    expect(d.pBarPct).toBe(1.96);
    const t = rejectCsv(d);
    expect(t.headers).toEqual(REJECT_CSV_HEADERS);
    expect(t.rows.map((r) => r[0])).toEqual(['reason', 'reason', 'day_code', 'trend', 'trend']);
    expect(t.rows[0]!.slice(0, 9)).toEqual(['reason', null, 'quality', 1, 3, 'Tube 1 · Mat 3', 15, 75, 75]);
  });
});

describe('cone weight report', () => {
  it('takes mean/SD/histogram from weights.ts, states from production, stations from the station table, and computes the median over the same population', async () => {
    const { pool, calls } = fakePool((sql) => (sql.includes('PERCENTILE_CONT') ? [{ med: 1957.5 }] : []));
    const d = await getConeWeightReport(pool, 1, PERIOD, {});
    // H8 (15 Sep 2026): `undefined`, not a hardcoded 'as_recorded' — the report
    // must let getWeights resolve the basis Setup has on file, never assume one.
    expect(getWeights).toHaveBeenCalledWith(expect.anything(), 1, undefined, PERIOD.from, PERIOD.to);
    expect(d).toMatchObject({ basis: 'as_recorded', cones: 1000, weighed: 996, implausible: 4, meanG: 1957.1, medianG: 1957.5, medianSource: 'report_query', sdG: 12.3, bucketSizeG: 20, states: STATES });
    expect(d.byStation.map((s) => s.station)).toEqual([7, 3]);
    const med = calls.find((c) => c.sql.includes('PERCENTILE_CONT'))!;
    expect(med.sql).toContain('weight_g BETWEEN @plausLo AND @plausHi');
    expect(med.params.get('plausHi')).toBe(2100);
    const t = coneWeightCsv(d);
    expect(t.headers).toEqual(CONE_WEIGHT_CSV_HEADERS);
    expect(t.rows.map((r) => r[0]).filter((s, i, a) => a.indexOf(s) === i)).toEqual(['summary', 'station', 'histogram']);
    expect(t.rows.find((r) => r[1] === 'median_g')![2]).toBe(1957.5);
  });
  it('prefers the weights service’s median (Phase 9’s `cone.median`) when it reports one', async () => {
    vi.mocked(getWeights).mockResolvedValueOnce({ ...fakeWeights(), cone: { ...fakeWeights().cone, median: 1958 } } as never);
    const { pool, calls } = fakePool();
    const d = await getConeWeightReport(pool, 1, PERIOD, {});
    expect(d.medianG).toBe(1958);
    expect(d.medianSource).toBe('weights_service');
    expect(calls.some((c) => c.sql.includes('PERCENTILE_CONT'))).toBe(false);
  });
  it('medianConeWeight returns null on an empty period', async () => {
    expect(await medianConeWeight(fakePool().pool, 1, PERIOD.from, PERIOD.to, { loG: 1500, hiG: 2100 })).toBeNull();
  });
  it('H8 (15 Sep 2026): reports whatever basis getWeights resolves, never a hardcoded literal', async () => {
    vi.mocked(getWeights).mockResolvedValueOnce({ ...fakeWeights(), basis: 'net' } as never);
    const { pool } = fakePool();
    const d = await getConeWeightReport(pool, 1, PERIOD, {});
    expect(d.basis).toBe('net');
  });
  it('cone-weight report takes its target from the limits in force at the period end', async () => {
    // fakeStations() carries targetG 1960 / productId 21 — the station
    // table's own resolution — NOT weights.ts's nominal figure (fakeWeights
    // uses 1960 too, deliberately, so a bug that read the wrong field would
    // not be caught by a numeric mismatch alone; the shape below is the real
    // pin — no nominalSource/nominalLabel survive into the report).
    const { pool } = fakePool();
    const d = await getConeWeightReport(pool, 1, PERIOD, {});
    expect(d.target).toEqual({
      setpointG: 1960,
      productId: 21,
      label: '205-IL0-SD',
      inForceAtUtc: '2026-08-20T00:00:00.000Z',
      inForceIsLowerBound: false,
      limitsChangedInPeriod: 0,
      source: 'in_force_at_period_end',
      omittedReason: null,
    });
    const t = coneWeightCsv(d);
    expect(t.rows.find((r) => r[1] === 'target_source')![2]).toBe('in_force_at_period_end');
  });
  it('a period with no product in force reports target null, never 1950', async () => {
    vi.mocked(getWeightStations).mockResolvedValueOnce({
      ...fakeStations(), targetG: null, productId: null, productLabel: null, targetEffectiveFromUtc: null, limitsChangedInWindow: null,
    } as never);
    const { pool } = fakePool();
    const d = await getConeWeightReport(pool, 1, PERIOD, {});
    expect(d.target).toEqual({
      setpointG: null, productId: null, label: null, inForceAtUtc: null, inForceIsLowerBound: false,
      limitsChangedInPeriod: 0, source: 'none', omittedReason: null,
    });
    const t = coneWeightCsv(d);
    expect(t.rows.find((r) => r[1] === 'target_g')![2]).toBeNull();
    expect(t.rows.find((r) => r[1] === 'target_source')![2]).toBe('none');
  });
  // ----------------------------------------------------------------- F6
  it('F6: a version that begins AFTER the period is not published as "in force at period end"', async () => {
    // The real defect, with the real instants: every row in
    // sms.product_limit_version is a migration-027 bootstrap stamped
    // 2026-09-11 with effective_is_lower_bound = 1, and the period asked for
    // ends 2026-09-07. getWeightStations still resolves a 1960 g target from
    // it (weightStations.ts:196 drops the flag — a held file, reported not
    // edited), so this report resolves the version itself and refuses it.
    const AFTER = {
      productId: 21, setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30,
      effectiveFromMs: Date.parse('2026-09-11T15:03:15.957Z'), effectiveFromUtc: '2026-09-11T15:03:15.957Z',
      effectiveIsLowerBound: true, source: 'pdas_observed' as const,
    };
    vi.mocked(loadProductCatalogue).mockResolvedValueOnce({
      product: () => ({ productId: 21, label: '205-IL0-SD', activeFlag: true }),
      distinctLabel: () => '205-IL0-SD',
      versionAt: () => AFTER,
      versionsAscending: () => [AFTER],
      limitsAt: () => ({ targetG: 1960, loG: 1930, hiG: 1990, label: '1,960 ± 30 g' }),
      latest: () => AFTER,
      productIds: () => [21],
      isEmpty: false,
    } as never);
    const { pool } = fakePool();
    const d = await getConeWeightReport(pool, 1, PERIOD, {});
    expect(d.target.source).toBe('none');
    expect(d.target.setpointG).toBeNull();
    // NOT the old behaviour: an instant four days after the period, asserted
    // as the moment the target came into force.
    expect(d.target.inForceAtUtc).toBeNull();
    expect(d.target.omittedReason).toContain('2026-09-11');
    expect(d.target.omittedReason).toContain(PERIOD.to);
    // …and the page says so in words, not by going silently blank.
    expect(d.note).toContain('first recorded on 2026-09-11');
    const t = coneWeightCsv(d);
    expect(t.rows.find((r) => r[1] === 'target_omitted_reason')![2]).toContain('2026-09-11');
    expect(t.rows.find((r) => r[1] === 'target_in_force_at_utc')![2]).toBeNull();
  });
  it('F6: a lower-bound version that IS in force during the period is kept, and flagged as a lower bound', async () => {
    const SEEN = {
      productId: 21, setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30,
      effectiveFromMs: Date.parse('2026-08-20T00:00:00Z'), effectiveFromUtc: '2026-08-20T00:00:00.000Z',
      effectiveIsLowerBound: true, source: 'pdas_observed' as const,
    };
    vi.mocked(loadProductCatalogue).mockResolvedValueOnce({
      product: () => ({ productId: 21, label: '205-IL0-SD', activeFlag: true }),
      distinctLabel: () => '205-IL0-SD',
      versionAt: () => SEEN,
      versionsAscending: () => [SEEN],
      limitsAt: () => ({ targetG: 1960, loG: 1930, hiG: 1990, label: '1,960 ± 30 g' }),
      latest: () => SEEN,
      productIds: () => [21],
      isEmpty: false,
    } as never);
    const { pool } = fakePool();
    const d = await getConeWeightReport(pool, 1, PERIOD, {});
    expect(d.target.source).toBe('in_force_at_period_end');
    expect(d.target.setpointG).toBe(1960);
    expect(d.target.inForceIsLowerBound).toBe(true);
    expect(d.note).toContain('no later than');
    expect(coneWeightCsv(d).rows.find((r) => r[1] === 'target_in_force_is_lower_bound')![2]).toBe(true);
  });
});

describe('sack report', () => {
  it('counts through production, the scale-rejected share through the register, and labels cones per sack approximate', async () => {
    const d = await getSackReport(fakePool().pool, 1, PERIOD, {});
    expect(listEvents).toHaveBeenCalledWith(expect.anything(), 1, 'sack', expect.objectContaining({ inRange: false }));
    expect(d.totals.sacks).toBe(40);
    expect(d.rejectedByScale).toBe(17);
    expect(d.inRangePct).toBe(57.5);
    expect(d.conesPerSack).toBe(25);
    expect(d.byShift.map((s) => s.group)).toEqual(['morning', 'evening', 'night']);
    expect(d.byProduct.map((p) => p.productLabel)).toEqual(['205-IL0-SD', 'No product on the reading']);
    expect(d.distribution?.count).toBe(40);
    expect(d.caveats.conesPerSack).toMatch(/approximation/);
    const t = sackCsv(d);
    expect(t.headers).toEqual(SACK_CSV_HEADERS);
    // The 10th column is `sacks_passed_by_scale_pct` (23 Sep 2026), the
    // per-row SACK verdict share — null here because this fixture's totals
    // row is hand-built and carries no `sacksPassedScalePct`, which is
    // exactly the "missing means not stated" contract the field documents.
    expect(t.rows[0]).toEqual(['total', 'total', 40, 1880, 47, 1000, 25, 17, 57.5, null, null, null, null]);
    // F7 (23 Sep 2026): the product rows carry the PDAS id alongside the
    // name, because the sack CSV's `group` column is a NAME and a name that
    // happens to be unique on this dataset is not an identifier.
    const prodRow = t.rows.find((r) => r[0] === 'product')!;
    expect(prodRow[1]).toBe('205-IL0-SD');
    expect(prodRow[SACK_CSV_HEADERS.indexOf('material_id')]).toBe(21);
  });
  it('H8 (15 Sep 2026): weightBasis is whatever getWeights resolves, never a hardcoded literal', async () => {
    vi.mocked(getWeights).mockResolvedValueOnce({ ...fakeWeights(), basis: 'net' } as never);
    const d = await getSackReport(fakePool().pool, 1, PERIOD, {});
    expect(getWeights).toHaveBeenCalledWith(expect.anything(), 1, undefined, PERIOD.from, PERIOD.to);
    expect(d.weightBasis).toBe('net');
    expect(getConfiguredBasis).not.toHaveBeenCalled();
  });
  it('drops the whole-period distribution under a shift filter rather than printing it under a shift heading', async () => {
    const d = await getSackReport(fakePool().pool, 1, PERIOD, { shift: 'night' });
    expect(getWeights).not.toHaveBeenCalled();
    expect(d.distribution).toBeNull();
    for (const c of vi.mocked(getProduction).mock.calls) expect(c[2].shift).toBe('night');
  });
  it('H8: under a shift filter, weightBasis still comes from the configured basis (getConfiguredBasis), not a hardcoded fallback', async () => {
    vi.mocked(getConfiguredBasis).mockResolvedValueOnce('net');
    const d = await getSackReport(fakePool().pool, 1, PERIOD, { shift: 'night' });
    expect(getConfiguredBasis).toHaveBeenCalledWith(expect.anything(), 1);
    expect(d.weightBasis).toBe('net');
  });
});

describe('calibration report', () => {
  it('converts the plant-day period to genuine UTC before it meets adjusted_at_utc', () => {
    const { fromUtc, toUtc } = periodAsUtcBounds('2026-09-01', '2026-09-07');
    // The offset is the process's own plant offset; whatever it is, the
    // bounds are the plant midnight and the plant end-of-day re-expressed.
    expect(toUtc.getTime() - fromUtc.getTime()).toBe(7 * 86_400_000 - 1);
  });
  it('reads the ledger for the period and counts adjustments per station beside the drift status', async () => {
    const { pool, calls } = fakePool((sql) =>
      sql.includes('FROM sms.calibration_adjustment')
        ? [{ adjustment_id: 9, station_id: 7, adjusted_at_utc: new Date('2026-09-03T05:00:00Z'), recorded_at_utc: new Date('2026-09-03T05:01:00Z'), recorded_by: 'eng', reason: 'zero', note: null, amount_g: -3 },
           { adjustment_id: 10, station_id: null, adjusted_at_utc: new Date('2026-09-04T05:00:00Z'), recorded_at_utc: new Date('2026-09-04T05:01:00Z'), recorded_by: 'eng', reason: 'all', note: 'x', amount_g: null }]
        : [],
    );
    const d = await getCalibrationReport(pool, 1, PERIOD, { station: 7 });
    const q = calls.find((c) => c.sql.includes('FROM sms.calibration_adjustment'))!;
    expect(q.sql).toContain('a.adjusted_at_utc BETWEEN @fromUtc AND @toUtc');
    expect(q.sql).toContain('a.station_id = @station OR a.station_id IS NULL');
    expect(q.params.get('station')).toBe(7);
    expect(d.stations).toHaveLength(1);
    expect(d.stations[0]).toMatchObject({ station: 7, flagged: true, daysFlagged: 1, daysWithData: 2, adjustmentsInPeriod: 1 });
    expect(d.adjustments).toHaveLength(2);
    expect(d.flaggedStationCount).toBe(1);
    const t = calibrationCsv(d);
    expect(t.headers).toEqual(CALIBRATION_CSV_HEADERS);
    expect(t.rows.map((r) => r[0])).toEqual(['station', 'adjustment', 'adjustment']);
    expect(t.rows[1]!.slice(12, 15)).toEqual([9, '2026-09-03T05:00:00.000Z', -3]);
  });
});

describe('management summary', () => {
  it('computes both periods through the same services and lays each KPI beside its prior with a delta', async () => {
    vi.mocked(getReport).mockImplementation(async (_p, _l, resolved) =>
      resolved.from === PERIOD.from ? fakeReport() : fakeReport({ period: resolved, totals: reportLine('total', 800) }),
    );
    const d = await getManagementSummary(fakePool().pool, 1, PERIOD, {});
    expect(d.prior).toEqual({ from: '2026-08-25', to: '2026-08-31' });
    expect(vi.mocked(getReport).mock.calls.map((c) => c[2].from)).toEqual([PERIOD.from, '2026-08-25']);
    expect(getWeights).toHaveBeenCalledTimes(2);
    // H8 (15 Sep 2026): `undefined`, not a hardcoded 'as_recorded', for both periods.
    for (const c of vi.mocked(getWeights).mock.calls) expect(c[2]).toBeUndefined();
    expect(getWeightStations).toHaveBeenCalledTimes(2);
    expect(d.kpis.map((k) => k.key)).toEqual(KPI_DEFINITIONS.map((k) => k.key));
    const cones = d.kpis.find((k) => k.key === 'cones_weighed')!;
    expect(cones).toMatchObject({ current: 1000, prior: 800, delta: { abs: 200, pct: 25 }, approval: 'awaiting' });
    // U5 (16 Sep 2026): both periods here have equal coverage (7 of 7 days
    // each — fakeReport's default), so the coverage test finds no gap and
    // every KPI, count-shaped or not, is comparable.
    expect(cones.comparable).toBe(true);
    expect(cones.incomparableReason).toBeNull();
    expect(d.kpis.find((k) => k.key === 'cones_within_limits_pct')!.current).toBe(98); // 900 of 918 judged (unknown excluded)
    expect(d.kpis.find((k) => k.key === 'stations_flagged')!.current).toBe(1);
    expect(d.kpis.find((k) => k.key === 'cones_rejected_by_scale')!.current).toBe(17);
    expect(d.verdict).toEqual({ cones: 1000, sacks: 40, sackWeightKg: 1880 });
    expect(d.approval).toBe('awaiting');
    // U5's product mix: the same getProduction(groupBy:'product') fixture
    // used elsewhere ('21' and 'none'), labelled through loadProductCatalogue.
    expect(d.productMix.current).toEqual([
      { productId: 21, label: '205-IL0-SD', cones: 700 },
      { productId: null, label: 'No product on the reading', cones: 300 },
    ]);
    expect(d.productMix.prior).toEqual(d.productMix.current); // same fixture answers getProduction for both periods here
  });
  it('a prior period with no readings gives null priors and null deltas, never "up from 0"', async () => {
    vi.mocked(getReport).mockImplementation(async (_p, _l, resolved) =>
      resolved.from === PERIOD.from
        ? fakeReport()
        : fakeReport({ period: resolved, coverage: { daysInPeriod: 7, daysWithData: 0, firstDayWithData: null, lastDayWithData: null, complete: false }, totals: { ...reportLine('total', 0), cones: 0, sacks: 0 } }),
    );
    const d = await getManagementSummary(fakePool().pool, 1, PERIOD, {});
    const cones = d.kpis.find((k) => k.key === 'cones_weighed')!;
    expect(cones.prior).toBeNull();
    expect(cones.delta).toBeNull();
    // U5: 0 of 7 prior days against 7 of 7 current — a 100% coverage gap,
    // well past the threshold — so a count-shaped KPI is marked incomparable
    // even though its own delta happens to already be null here.
    expect(cones.comparable).toBe(false);
    expect(cones.incomparableReason).toMatch(/coverage gap/);
    // days_with_data is not count-shaped (it IS the coverage figure) and a
    // rate KPI is coverage-independent — both stay comparable regardless.
    const days = d.kpis.find((k) => k.key === 'days_with_data')!;
    expect(days).toMatchObject({ current: 7, prior: 0, delta: { abs: 7, pct: null }, comparable: true, incomparableReason: null });
    const rate = d.kpis.find((k) => k.key === 'inspection_reject_rate_pct')!;
    expect(rate.comparable).toBe(true);
  });
  it('H8 (15 Sep 2026): the weight KPIs relay whatever basis getWeights resolved, unchanged — the report does no arithmetic of its own', async () => {
    vi.mocked(getWeights).mockResolvedValue({ ...fakeWeights(), cone: { ...fakeWeights().cone, avg: 1887.1, stdev: 12.3 }, basis: 'net' } as never);
    const d = await getManagementSummary(fakePool().pool, 1, PERIOD, {});
    // 1887.1 is fakeWeights().cone.avg (1957.1) minus a 70 g tube — the figure
    // getWeights would report under 'net'; summary.ts must relay it exactly.
    expect(d.kpis.find((k) => k.key === 'mean_cone_weight_g')!.current).toBe(1887.1);
    expect(d.kpis.find((k) => k.key === 'cone_weight_sd_g')!.current).toBe(12.3);
  });
  it('CSV: one row per KPI with the approval column', () => {
    const t = summaryCsv({
      period: PERIOD, prior: { from: '2026-08-25', to: '2026-08-31' },
      coverage: { current: fakeReport().coverage, prior: fakeReport().coverage },
      attribution: { current: 1, prior: 1 },
      kpis: [{ ...KPI_DEFINITIONS[0]!, current: 10, prior: 8, delta: { abs: 2, pct: 25 }, comparable: true, incomparableReason: null, approval: 'awaiting' }],
      productMix: { current: [], prior: [] },
      verdict: { cones: 10, sacks: 1, sackWeightKg: 47 }, approval: 'awaiting', note: '',
    });
    expect(t.headers).toEqual(SUMMARY_CSV_HEADERS);
    expect(t.rows[0]).toEqual(['cones_weighed', 'Cones weighed', 'cones', 10, 8, 2, 25, 'higher', '2026-09-01 to 2026-09-07', '2026-08-25 to 2026-08-31', 'awaiting', true, null, 100, 100]);
  });
});

describe('the dispatcher and the tables', () => {
  it('every report type has a builder, a CSV serialiser, a rank and a filter list', async () => {
    const { pool } = fakePool((sql) => (sql.includes('PERCENTILE_CONT') ? [{ med: 1 }] : []));
    for (const type of REPORT_TYPES) {
      const data = await buildReport(pool, 1, type, PERIOD, {});
      const table = reportCsv(type, data);
      expect(table.headers.length, type).toBeGreaterThan(0);
      for (const row of table.rows) expect(row.length, `${type} row width`).toBe(table.headers.length);
      expect(REPORT_RANK[type]).toBeDefined();
      expect(FILTERS_BY_TYPE[type]).toBeDefined();
    }
    expect(REPORT_RANK['management-summary']).toBe(3);
  });
});
