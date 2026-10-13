/** Small fixtures for the write-control rows of rank.matrix.test.tsx: just enough data for each control to be drawn. */
import { LIVE_FIXTURE, META_FIXTURE } from '../../web/src/testkit/fixtures';
import { boardRoutes } from './screens/Products/testkit/mock';

const META = LIVE_FIXTURE.metadata;
const env = (data: unknown) => ({ data, metadata: META });

/* ---- Register ---- */
const page = (rows: unknown[]) => env({ rows, total: rows.length, page: 1, pageSize: 100 });
const FLOW = { sacks: 0, kg: 0 };
export const REGISTER_ROUTES: Record<string, unknown> = {
  '/api/events': page([]),
  '/api/stations': { stations: [] },
  '/api/products': { products: [] },
  '/api/reports/header': env({ header: null }),
  '/api/sacks/stock': env({
    from: '2026-09-05', to: '2026-09-07', product: null, basis: 'line', machineLevel: { enabled: false, reason: '' }, dayBasis: 'production_day',
    sackTimeIsInsertTime: true, receiptMeaning: '', weightBasis: '', tareKg: 0, opening: FLOW, closing: FLOW,
    totals: { openingEntries: FLOW, receipts: FLOW, weighed: FLOW, issues: FLOW, consumption: FLOW, adjustments: FLOW }, days: [], byMaterial: [], kgMissing: 0,
  }),
  '/api/sacks/movements': env({ from: '2026-09-05', to: '2026-09-07', machineLevel: { enabled: false, reason: '' }, weighed: [], movements: [] }),
};

/* ---- Products ---- */
export const PALLETS = {
  pallets: [
    { palletId: 1023, productId: 1022, productLabel: '205-IL0-SD', packSchemaId: 1, packSchemaLabel: '30 kg', lot: 'L1', active: true, sackColour: 'White', labelType: null, steamProg: null, routing: null, pdasCreatedAt: null },
    { palletId: 1010, productId: 11, productLabel: '201-IH0-SD', packSchemaId: 1, packSchemaLabel: null, lot: null, active: false, sackColour: null, labelType: null, steamProg: null, routing: null, pdasCreatedAt: null },
  ],
};
export const PRODUCTS_ROUTES = (): Record<string, unknown> => ({ ...boardRoutes({ '/api/pallets': PALLETS }) });

const PRODUCT = (id: number, color: string) => ({
  productId: id, description: '205-IL0-SD', lotCode: null, setpointG: 1960, blend: '205-IL0', countText: '30', tubeType: 'AMBER', tubeWeightG: 118,
  weightOffsetMinusG: 50, weightOffsetPlusG: 50, activeFlag: true, color,
});
const STATUS_ON = { enabled: true, reason: null, canWrite: true, local: { canWrite: true } };

export const CHANGEOVER_ROUTES: Record<string, unknown> = {
  '/api/changeover/refs': {
    blends: [{ id: 1, name: '205-IL0' }], counts: [{ id: 3, name: '30' }],
    tubeTypes: [{ id: 5, name: 'AMBER', tubeWeightG: 118, tubeForm: 2 }],
    packSchemas: [{ packSchemaId: 1, description: null, conesPerLayer: null, packTypeId: null }], pallets: [],
  },
  '/api/products': { products: [PRODUCT(21, 'BLUE')] },
  '/api/product-write/status': STATUS_ON,
  '/api/changeover/plan': {
    writesEnabled: true, disabledReason: null, blockers: [], warnings: [],
    steps: [{ step: 'material', action: 'create', proc: 'CreateMaterial', label: 'Create product 205-IL0-SD Amber', id: null, detail: { name: 'x', active: true } }],
    noRollback: 'There is no automatic rollback: a step that has run stays run.',
    limits: { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, label: '1,960 ± 50 g' }, reachesMachine: false, operatorNote: 'Note.',
  },
};

const VERSION = {
  versionId: 2, setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, effectiveFromUtc: '2026-08-20T05:00:00.000Z', effectiveFromPlant: '2026-08-20T10:00:00.000Z',
  effectiveIsLowerBound: false, source: 'sms_local', changedBy: null, reason: null, recordedAtUtc: '2026-08-20T05:00:00.000Z', label: null,
};
export const LIMITS_ROUTES: Record<string, unknown> = {
  '/api/products/limits/history': { products: [{ productId: 20, label: '205-IL0-SD', activeFlag: true, versions: [VERSION] }] },
  '/api/products': { products: [PRODUCT(20, 'GREEN')] },
  '/api/product-write/status': STATUS_ON,
  '/api/product-changes': { entries: [], nextBefore: null },
  '/api/product-timeline': { timeline: [] },
};

/* ---- Reports ---- */
const COVERAGE = { daysWithData: 1, daysInPeriod: 1, complete: true, firstDayWithData: '2026-09-07', lastDayWithData: '2026-09-07' };
export const REPORTS_ROUTES: Record<string, unknown> = {
  '/api/stations': { stations: [] },
  '/api/products': { products: [] },
  '/api/reports/daily': env({
    header: {
      reportType: 'daily', title: 'daily', lineName: 'TP1 Line 3', plantName: null, unitName: null, period: { period: 'custom', from: '2026-09-07', to: '2026-09-07', days: 1 },
      filters: {}, generatedAtPlantUtc: '2026-09-07T12:00:00Z', generatedBy: 'u', smsVersion: '0', definitions: 'KPI-DEFINITIONS.md', approval: 'awaiting',
      spansGenerations: false, sourceGeneration: 'SEP07', otherGenerationExcluded: null,
    },
    report: { shift: null, coverage: COVERAGE, totals: { cones: 10, sacks: 1, sackWeightKg: 47 } },
  }),
};

/* ---- System ---- */
const FINDING = {
  findingId: 5, checkName: 'zero_weight', severity: 'WARNING', subjectTable: null, detail: 'Two readings weigh nothing.',
  subjectRef: null, acknowledgeable: true, acknowledgedBy: null, acknowledgedUtc: null, acknowledgedReason: null,
};
export const DIAGNOSTICS_ROUTES: Record<string, unknown> = {
  '/api/health': {
    status: 'ok', service: { version: '0.2.0', uptimeSeconds: 7200, startedAtUtc: '2026-09-07T10:00:00Z', pid: 1 },
    database: { ok: true, latencyMs: 7, sizeMb: 520, capMb: 10240, pctOfCap: 5.1 }, acquisition: { kind: 'ok', ageSeconds: 90, cadenceSeconds: 60, halted: null, generation: null },
    backup: { dir: 'D:\\b', newestFile: 'x.bak', newestAtUtc: '2026-09-29T02:00:00Z', ageDays: 1, warning: false, verified: true, newestUnverified: false },
    degradedReason: null, pdasWrite: null, disk: { appDataFreeMb: 90000, backupFreeMb: 72704 }, lastVerifyRunUtc: null, workerLastPassUtc: '2026-09-07T12:00:00Z', dqAcknowledged: 0,
  },
  '/api/operations': {
    data: {
      sync: [], shiftRuleRegimes: [], lifetime: { passes: 1, tableRuns: 1, failures: 0, firstRunUtc: null, lastRunUtc: null, medianMs: null, p95Ms: null, slowestMs: null, lastFailure: null },
      schema: [], dq: { latestRunId: null, bySeverity: {}, findings: [FINDING] }, source: { lastProbeOk: true, lastProbeAtUtc: '2026-09-07T12:00:00Z', lastHalt: null, halted: [] },
    },
    metadata: META_FIXTURE,
  },
  '/api/system-history': { data: { generations: [], rebuilds: [], verifyRuns: [] }, metadata: META_FIXTURE },
};
export const SETUP_ROUTES: Record<string, unknown> = {
  '/api/admin/users': { users: [{ userId: 1, username: 'u', displayName: 'U', role: 'admin', active: true, createdAtUtc: '2026-09-01T00:00:00Z' }] },
  '/api/admin/audit': { entries: [], nextBefore: null },
};
