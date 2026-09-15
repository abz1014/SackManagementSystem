/** Typed API client. The SPA only ever calls /api (proxied to Express in dev). */

export interface Meta {
  generatedAtUtc: string;
  weightBasis: string;
  shiftMode: string;
  transformVersion: number;
  lastSyncUtc: string | null;
  sourceAgeSeconds: number | null;
}

export interface ProductionRow {
  group: string;
  cones: number;
  rejectedCones: number;
  sacks: number | null;
  sackWeightKg: number | null;
  conesInRangePct: number | null;
}

export interface ProductionData {
  groupBy: string;
  rows: ProductionRow[];
  /**
   * Only on a product-filtered call, else null. Cones in the period carrying
   * no product at all (`rows`) out of every cone in it (`of`): readings from
   * before the source recorded a product are dropped by the filter, and the
   * screen must say so rather than narrow the period silently. Cones and
   * rejects separately since roadmap Phase 5 (14 Sep 2026) — the reject
   * count was product-filtered too and had no caveat of its own.
   */
  unattributed: { cones: { rows: number; of: number }; rejects: { rows: number; of: number } } | null;
}

export interface Envelope<T> {
  data: T;
  metadata: Meta;
}

export type GroupBy = 'day' | 'shift' | 'station' | 'none';

export interface ProductionQuery {
  from?: string;
  to?: string;
  shift?: string;
  station?: number;
  /** Instant cap, so a replay (?at=) counts only what existed at that moment. */
  tsTo?: string;
  /** material_id. Narrows cones and rejects only; see ProductionData.unattributed. */
  product?: number;
  groupBy?: GroupBy;
}

// Global 401 handler — set by App so an expired session bounces to login
// instead of surfacing as a data error. Not triggered for the login call itself.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}
function handleStatus(res: Response, path: string): void {
  if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized?.();
}

/**
 * An API failure that remembers its status.
 *
 * Without this every failure rendered as "the plant connection may be down",
 * including a 403 — so a supervisor opening an admin-only panel was told the
 * factory link was broken. A refusal and an outage are different sentences.
 */
export class ApiError extends Error {
  readonly status: number;
  /** Seconds from the server's Retry-After, so a lockout can state a number
   *  rather than saying "try again later" and leaving the reader guessing. */
  readonly retryAfter: number | null;
  /**
   * The server's `detail` when it sent one — the plausibility and shift
   * rule routes answer 400 with `error: 'invalid'` and put the actual reason
   * ("morning must start before evening") here. Without it a Setup form
   * could only say "invalid", which is the word the admin already knew.
   */
  readonly detail: string | null;
  constructor(status: number, message: string, retryAfter: number | null = null, detail: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

/** A 4xx body's `detail`, flattened to one sentence, or null. */
function detailOf(body: unknown): string | null {
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(String).join('; ') || null;
  return null;
}

/** Retry-After, in whole seconds, when the server sent one. */
function retryAfterOf(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    handleStatus(res, path);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`, null, detailOf(body));
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    handleStatus(res, path);
    const b = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (b as { error?: string }).error ?? `HTTP ${res.status}`, retryAfterOf(res), detailOf(b));
  }
  return res.json() as Promise<T>;
}

// ---- auth ----
export interface AuthUser { username: string; displayName: string | null; role: string; }
/** The four roles by rank — the names sms.role carries since migration 035
 *  (15 Sep 2026): viewer 1 · engineer 2 · manager 3 · admin 4. A name this
 *  map does not know ranks as 1 (view only), which is what an unmigrated
 *  database's old names now get — apply 035 before deploying this build. */
export const ROLE_RANK: Record<string, number> = { viewer: 1, engineer: 2, manager: 3, admin: 4 };

export function getMe(): Promise<{ user: AuthUser | null }> {
  return get('/api/auth/me');
}
export function login(username: string, password: string): Promise<{ user: AuthUser }> {
  return post('/api/auth/login', { username, password });
}
export function logout(): Promise<{ ok: boolean }> {
  return post('/api/auth/logout', {});
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    handleStatus(res, path);
    const b = await res.json().catch(() => ({}));
    // ApiError, not Error, since 14 Sep 2026: every Setup write goes through
    // here, and a form must tell a 409 ("machine number 3 already exists")
    // from a 403 from a dropped connection — three different sentences.
    throw new ApiError(res.status, (b as { error?: string }).error ?? `HTTP ${res.status}`, retryAfterOf(res), detailOf(b));
  }
  return res.json() as Promise<T>;
}

// ---- admin ----
export interface AdminUser { userId: number; username: string; displayName: string | null; role: string; active: boolean; createdAtUtc: string; }
/** How a station came to be linked to its machine (migration 028). */
export type StationLinkSource = 'default_by_number' | 'confirmed_by_ifl' | 'admin';
export interface StationRow {
  stationId: number; name: string | null; machine: string | null; description: string | null;
  /* The machine link and the active flag, since roadmap Phase 1 (14 Sep
     2026). Optional: /api/stations is read by every screen, and a screen
     built before these existed must keep working against an API that has
     not yet been redeployed with them. */
  machineId?: number | null;
  machineNo?: number | null;
  machineName?: string | null;
  linkSource?: StationLinkSource | null;
  isActive?: boolean;
}
export interface Rules {
  weight: { basis: string; coneTubeWeightG: number; sackTareKg: number } | null;
  shift: { morningStart: string; eveningStart: string; nightStart: string; mode: string; nightBelongsTo: string } | null;
  plausibility: { coneLoG: number; coneHiG: number; sackLoKg: number; sackHiKg: number } | null;
}
export function adminListUsers(): Promise<{ users: AdminUser[] }> { return get('/api/admin/users'); }
export function adminCreateUser(u: { username: string; password: string; role: string; displayName?: string }): Promise<{ ok: boolean }> { return post('/api/admin/users', u); }
export function adminUpdateUser(id: number, patch: { active?: boolean; role?: string }): Promise<{ ok: boolean }> { return send('PATCH', `/api/admin/users/${id}`, patch); }
export function adminListStations(): Promise<{ stations: StationRow[] }> { return get('/api/admin/stations'); }
/**
 * PUT /api/admin/stations/:id. `name`/`machine`/`description` are the route's
 * original, required-nullable body; `machineId` (null unlinks, and marks the
 * link as set here) and `isActive` are Phase 1's additions and are sent only
 * when the caller means to change them.
 */
export function adminSetStation(id: number, s: {
  name: string | null; machine: string | null; description: string | null;
  machineId?: number | null; isActive?: boolean;
}): Promise<{ ok: boolean }> { return send('PUT', `/api/admin/stations/${id}`, s); }
export function adminGetRules(): Promise<Rules> { return get('/api/admin/rules'); }

/* The three rule writers below were declared on 3 Sep 2026 and never called:
   Setup showed the rules as a read-only list, so the only way to change one
   was SQL on the plant PC. Wired to real forms in roadmap Phase 1 (14 Sep
   2026). The shift body carries the three boundary times now — the server
   used to hold '06:00','14:00','22:00' as literals. */
export type ShiftMode = 'corrected' | 'legacy';
export type NightBelongsTo = 'start_day' | 'calendar_day';
export function adminSetWeightRule(r: { basis: Basis; coneTubeWeightG: number; sackTareKg: number; reason?: string }): Promise<{ ok: boolean }> { return post('/api/admin/rules/weight', r); }
export function adminSetShiftRule(r: {
  morningStart: string; eveningStart: string; nightStart: string;
  mode: ShiftMode; nightBelongsTo: NightBelongsTo; reason?: string;
}): Promise<{ ok: boolean; rebuildRequired: boolean; note?: string }> { return post('/api/admin/rules/shift', r); }
export function adminSetPlausibilityRule(r: { coneLoG: number; coneHiG: number; sackLoKg: number; sackHiKg: number; reason?: string }): Promise<{ ok: boolean; note?: string }> { return post('/api/admin/rules/plausibility', r); }

// ---- roadmap Phase 1: the configurable platform (14 Sep 2026) ----
// Until migration 028 the installation's identity lived in an env string
// (LINE_NAME, parsed on '·' by two screens), a const array in the sync worker
// and `SELECT TOP (14)` in the station seed. Each of these is now a row an
// admin can edit in Setup; the functions below are that surface.

/** The line, with the unit and plant it belongs to. */
export interface ConfigLine {
  lineId: number; code: string; name: string; displayName: string; isActive: boolean;
  unit: { unitId: number; code: string; name: string };
  plant: { plantId: number; code: string; name: string };
}
export type MachineKind = 'winder' | 'packer' | 'other';
export interface MachineRow {
  machineId: number;
  /** The number the plant writes in MachineNo; null for a machine the readings never name (the packer). */
  machineNo: number | null;
  kind: MachineKind;
  make: string | null;
  model: string | null;
  name: string;
  isActive: boolean;
  notes: string | null;
}
/** /api/config's station: the same row as StationRow with the link fields guaranteed. */
export interface ConfigStation {
  stationId: number; name: string | null; description: string | null;
  machineId: number | null; machineNo: number | null; machineName: string | null;
  linkSource: StationLinkSource | null; isActive: boolean;
}
export interface ConfigData {
  line: ConfigLine;
  lines: { lineId: number; displayName: string; isActive: boolean }[];
  machines: MachineRow[];
  stations: ConfigStation[];
}
/** Any signed-in account. */
export function getConfig(): Promise<ConfigData> { return get('/api/config'); }

export function adminGetLine(): Promise<{ line: ConfigLine }> { return get('/api/admin/line'); }
export function adminSetLine(p: { plantName?: string; unitName?: string; lineName?: string; displayName?: string }): Promise<{ ok: boolean }> {
  return send('PUT', '/api/admin/line', p);
}

export function adminListMachines(): Promise<{ machines: MachineRow[] }> { return get('/api/admin/machines'); }
/**
 * 201 `{ machineId, stationCreated }`; 409 when the number is taken on this
 * line. A winder or 'other' WITH a number also gets its station row, linked,
 * when none exists — `stationCreated` says whether that happened.
 */
export function adminCreateMachine(m: {
  machineNo: number | null; kind: MachineKind; name: string; make?: string | null; model?: string | null; notes?: string | null;
}): Promise<{ machineId: number; stationCreated: boolean }> { return post('/api/admin/machines', m); }
export function adminUpdateMachine(id: number, patch: {
  name?: string; make?: string | null; model?: string | null; notes?: string | null; isActive?: boolean;
}): Promise<{ ok: boolean }> { return send('PUT', `/api/admin/machines/${id}`, patch); }

/** 201 `{ ok }`; 409 when the station exists; 400 when machineId is not a machine on this line. */
export function adminCreateStation(s: { stationId: number; name?: string | null; machineId?: number | null }): Promise<{ ok: boolean }> {
  return post('/api/admin/stations', s);
}

export type DataSourceRole = 'acquisition' | 'product_master' | 'sack_packing';
export interface DataSourceRow {
  dataSourceId: number; systemCode: string; role: DataSourceRole; label: string;
  /** Which .env block holds the connection — the server, database and login never leave the file. */
  connectionKey: string;
  isEnabled: boolean; notes: string | null;
}
export type SourceTableKind = 'cone' | 'sack' | 'reject_qcs' | 'reject_weight';
export interface SourceTableRow {
  sourceTableId: number; kind: SourceTableKind;
  /** dbo.<name> in the source database — IFL's names carry the line: pack1_TP1U2. */
  sourceTable: string;
  /** sms_raw.<name> it is copied into. Read-only: the raw shape is the vendor's schema, fingerprinted per generation. */
  rawTable: string;
  isEnabled: boolean; dataSourceId: number;
}
export function adminGetSources(): Promise<{ sources: DataSourceRow[]; tables: SourceTableRow[] }> { return get('/api/admin/sources'); }
export function adminUpdateSource(id: number, patch: { label?: string; isEnabled?: boolean; notes?: string | null }): Promise<{ ok: boolean }> {
  return send('PUT', `/api/admin/sources/${id}`, patch);
}
/** A SQL identifier: what the server accepts for a source table name. */
export const SOURCE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** The `note` says what happens next (the worker's next pass; a halt on a new generation) and is shown verbatim. */
export function adminUpdateSourceTable(id: number, patch: { sourceTable?: string; isEnabled?: boolean }): Promise<{ ok: boolean; note?: string }> {
  return send('PUT', `/api/admin/sources/tables/${id}`, patch);
}

export type RejectSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export interface RejectCodeRow {
  rejectCodeId: number; rejectType: 'quality' | 'weight';
  tubeCode: number | null; materialCode: number | null;
  label: string | null; isPass: boolean | null; severity: RejectSeverity | null;
}
/** Any signed-in account. */
export function getRejectCodes(): Promise<{ codes: RejectCodeRow[] }> { return get('/api/reject-codes'); }
/** Manager and above. Only the fields present are changed; null clears one. */
export function setRejectCode(id: number, patch: { label?: string | null; isPass?: boolean | null; severity?: RejectSeverity | null }): Promise<{ updated: number }> {
  return send('PUT', `/api/reject-codes/${id}`, patch);
}

export interface AuditEntry {
  auditId: number; atUtc: string; actorId: number | null; actorName: string | null;
  action: string; targetType: string; targetId: string | null; detail: string | null;
}
export function adminGetAudit(): Promise<{ entries: AuditEntry[] }> { return get('/api/admin/audit'); }

// ---- current product (Q1) ----
export interface ProductOption {
  productId: number; description: string | null; lotCode: string | null; setpointG: number | null;
  blend: string | null; countText: string | null; tubeType: string | null; tubeWeightG: number | null;
  weightOffsetMinusG: number | null; weightOffsetPlusG: number | null;
  /** PDAS MaterialActive — informational only, shown so a supervisor sees it
   *  before confirming a changeover, not to block the choice. */
  activeFlag: boolean | null;
  /** PDAS MaterialDesc2 — real color data on this line, e.g. 'PARROT'. */
  color: string | null;
}
export interface TimelineEntry {
  timelineId: number; productId: number; productLabel: string;
  effectiveFrom: string; changedAt: string; changedBy: string | null; reason: string | null;
}
export function getProductTimeline(): Promise<{ timeline: TimelineEntry[] }> {
  return get('/api/product-timeline');
}
export function getProducts(): Promise<{ products: ProductOption[] }> {
  return get('/api/products');
}
export function getCurrentProduct(): Promise<{ current: TimelineEntry | null }> {
  return get('/api/current-product');
}
export function setCurrentProduct(productId: number, reason?: string): Promise<{ current: TimelineEntry | null }> {
  return post('/api/current-product', { productId, reason });
}

// ---- PDAS write path: product Add / Retire / Change limits (§5) ----
/** The six fields an operator sees and may change on a product. */
export interface ProductFields {
  setpointG: number; offsetMinusG: number; offsetPlusG: number;
  desc1: string | null; desc2: string | null; active: boolean;
}
export interface ProductWriteStatus {
  /** Server-side flag + credentials present. */
  enabled: boolean;
  /** Why not, in words the operator can act on; null when enabled. */
  reason: string | null;
  /** enabled AND this user's rank allows it. */
  canWrite: boolean;
}
export interface ProductOptions {
  blends: { id: number; name: string }[];
  counts: { id: number; name: string }[];
  tubeTypes: { id: number; name: string; tubeWeightG: number | null }[];
}
export function getProductWriteStatus(): Promise<ProductWriteStatus> { return get('/api/product-write/status'); }
export function getProductOptions(): Promise<ProductOptions> { return get('/api/product-options'); }
export function createProduct(p: {
  blendId: number; countId: number; tubeTypeId: number; fields: ProductFields; reason: string;
}): Promise<{ productId: number; products: ProductOption[] }> {
  return post('/api/products', p);
}
export function setProductActive(productId: number, active: boolean, reason: string): Promise<{ productId: number; active: boolean; products: ProductOption[] }> {
  return post(`/api/products/${productId}/active`, { active, reason });
}
export function updateProductLimits(productId: number, before: ProductFields, after: ProductFields, reason: string): Promise<{ productId: number; observedAfter: ProductFields; products: ProductOption[] }> {
  return post(`/api/products/${productId}/limits`, { before, after, reason });
}

export interface ExcludedDay { date: string; rows: number; }
export interface RangeData {
  minDate: string | null;
  maxDate: string | null;
  /** Days held back because they carry too few readings to be production —
   *  reported rather than silently dropped. */
  excludedDays?: ExcludedDay[];
  minProductionRows?: number;
}
export function getRange(): Promise<RangeData> {
  return get('/api/range');
}

export interface RejectReason {
  rejectCodeId: number | null;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
  label: string | null;
  displayLabel: string;
  count: number;
  pct: number;
  cumulativePct: number;
}
export interface RejectData {
  total: number;
  reasons: RejectReason[];
}

export function getRejects(from?: string, to?: string): Promise<Envelope<RejectData>> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  return get(`/api/rejects?${p.toString()}`);
}

export async function setRejectLabel(id: number, label: string | null): Promise<void> {
  const path = `/api/reject-codes/${id}`;
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    handleStatus(res, path);
    throw new Error(`HTTP ${res.status}`);
  }
}

export type Basis = 'as_recorded' | 'gross' | 'net';
export interface Bucket { bucket: number; count: number; }
/** `eventId` is the register's row identity (the canonical PK), what a reading permalink takes. */
export interface Outlier { weight: number; shiftDate: string | null; eventId: number | null; }
export interface WeightStats {
  count: number; avg: number | null; min: number | null; max: number | null; stdev: number | null;
  unit: 'g' | 'kg'; bucketSize: number; histogram: Bucket[]; outliers: Outlier[];
}
export type NominalSource = 'current_product' | 'fallback';
export interface WeightsData {
  basis: Basis;
  cone: WeightStats & {
    nominalSetpointG: number;
    nominalSource: NominalSource;
    nominalLabel: string | null;
    /** Non-empty = the giveaway figure is not safe to quote externally. */
    provisionalReasons: string[];
    giveawayPerConeG: number | null;
    giveawayTotalKg: number | null;
  };
  sack: WeightStats;
  note: string;
}
export function getWeights(basis: Basis, from?: string, to?: string): Promise<Envelope<WeightsData>> {
  const p = new URLSearchParams();
  p.set('basis', basis);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  return get(`/api/weights?${p.toString()}`);
}

// getShiftAnalysis, getStoppagePatterns and getOee were deleted here on
// 15 Sep 2026 (roadmap Phase 8 item 3): their endpoints went with the
// Output/Shifts screens at f4b941a and the three wrappers had targeted 404s
// since. /api/shift-check (getShiftCheck, below) is the shift statistic's
// replacement.

export function getProduction(q: ProductionQuery): Promise<Envelope<ProductionData>> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.shift) p.set('shift', q.shift);
  if (q.station != null) p.set('station', String(q.station));
  if (q.tsTo) p.set('tsTo', q.tsTo);
  if (q.product != null) p.set('product', String(q.product));
  p.set('groupBy', q.groupBy ?? 'none');
  return get(`/api/production?${p.toString()}`);
}

// ---- Sack & Cone Register ----
export type RegisterType = 'cone' | 'sack' | 'reject';
export type RegisterSort = 'time' | 'weight';

export interface RegisterQuery {
  type: RegisterType;
  rejectType?: 'quality' | 'weight';
  from?: string;
  to?: string;
  shift?: string;
  station?: number;
  inRange?: boolean;
  wMin?: number;
  wMax?: number;
  tsFrom?: string;
  tsTo?: string;
  /** cone only — see api's register.ts OutsideLimitsSegment. */
  outsideProductLimits?: boolean;
  sort?: RegisterSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface RegisterRow {
  /**
   * THE row identity on every type — the canonical PK (cone_event_id /
   * sack_event_id / reject_event_id) under one name. Permalinks, list keys and
   * the CSV row id all use this, never source_row_id.
   */
  event_id: string | number;
  /**
   * IFL's own id, for display only. The plant's identities restarted at 1 on
   * 2026-08-05, so this number names two rows unless the epoch is beside it;
   * null on a reject, where the source records none.
   */
  source_row_id: string | number | null;
  source_epoch: number;
  /** Which generation of the source this reading came from, e.g. "July copy - cones". */
  source_epoch_label: string | null;
  reject_type?: 'quality' | 'weight';
  tube_inspect_code?: number | null;
  material_inspect_code?: number | null;
  reject_label?: string | null;
  /** The code's pass flag, once a manager has set it; null until then. */
  reject_is_pass?: boolean | null;
  production_ts_utc: string;
  shift_code: string;
  shift_date: string;
  shift_code_legacy: string | null;
  hanger_num?: number | null;
  source_station?: number | null;
  lifter_station?: number | null;
  weight_g?: number | null;
  weight_kg?: number | null;
  sack_num?: number | null;
  in_range: boolean | null;
  material_id: number | null;
  lot_code: string | null;
  merge_key_is_unique: boolean;
  production_ts_is_insert_time?: boolean;
  /**
   * Where the row came from (roadmap Phase 3, 14 Sep 2026). Optional because
   * an API built before it answers without one, and the sheet then says "not
   * available" rather than reconstructing lineage from the loose columns.
   */
  provenance?: Provenance;
}

/* Roadmap Phase 3 (14 Sep 2026): lineage reachable by a person. The canonical
   row already held every one of these facts, but `ingest_run_id` was a UUID
   minted per transform pass that joined to nothing, and no endpoint exposed
   raw_id — so "where did this reading come from" was answerable only in SQL
   on the plant PC. Mirrors shared/src/domain/canonical.ts's Provenance plus
   the joined epoch label and source table, by name. */
export type AttributionMethod = 'none' | 'source_column' | 'manual_entry';
export type AttributionConfidence = 'high' | 'low' | 'ambiguous';
export interface Provenance {
  /** sms.data_source.system_code the row was read through — 'ifl_sql' today. */
  sourceSystem: string;
  /** dbo.<name> in the source database, e.g. pack1_TP1U2. */
  sourceTable: string;
  /** The generation of that table the row was read from. Beside sourceRowId on purpose: the id alone names two rows since 5 Aug 2026. */
  epochLabel: string | null;
  sourceRowId: number | string | null;
  rawId: number | string | null;
  /** IFL's own insert time (their `Date` column) — PLANT clock labelled UTC, like every production timestamp. */
  sourceInsertUtc: string | null;
  /** When the sync worker read the raw row — a GENUINE UTC instant, five hours from the plant clock here. */
  ingestedAtUtc: string | null;
  /** sms.sync_run.run_id of the pass that read it. */
  ingestRunId: string | null;
  transformVersion: number | null;
  attributionMethod: AttributionMethod | null;
  attributionConfidence: AttributionConfidence | null;
  /** The night rule the row's shift_date was stamped under (migration 023). */
  nightBelongsTo: NightBelongsTo | null;
}

export interface RegisterPage {
  rows: RegisterRow[];
  total: number;
  page: number;
  pageSize: number;
}

function registerParams(q: RegisterQuery): URLSearchParams {
  const p = new URLSearchParams();
  p.set('type', q.type);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.shift) p.set('shift', q.shift);
  if (q.station != null) p.set('station', String(q.station));
  if (q.inRange != null) p.set('inRange', String(q.inRange));
  if (q.rejectType) p.set('rejectType', q.rejectType);
  if (q.wMin != null) p.set('wMin', String(q.wMin));
  if (q.wMax != null) p.set('wMax', String(q.wMax));
  if (q.tsFrom) p.set('tsFrom', q.tsFrom);
  if (q.tsTo) p.set('tsTo', q.tsTo);
  if (q.outsideProductLimits) p.set('outsideProductLimits', 'true');
  // roadmap Phase 4 (14 Sep 2026): the state filter and the product filter.
  if (q.state && q.state.length > 0) p.set('state', q.state.join(','));
  if (q.product != null) p.set('product', String(q.product));
  p.set('sort', q.sort ?? 'time');
  p.set('dir', q.dir ?? 'desc');
  if (q.page) p.set('page', String(q.page));
  if (q.pageSize) p.set('pageSize', String(q.pageSize));
  return p;
}

export function getEvents(q: RegisterQuery): Promise<Envelope<RegisterPage>> {
  return get(`/api/events?${registerParams(q).toString()}`);
}

export function getEventDetail(type: RegisterType, id: number | string): Promise<{ row: RegisterRow & Record<string, unknown> }> {
  return get(`/api/events/${type}/${id}`);
}

export function eventsExportUrl(q: RegisterQuery): string {
  return `/api/events/export?${registerParams(q).toString()}`;
}

// ---- Downtime & Throughput ----
export interface Stoppage {
  startTs: string;
  endTs: string;
  durationSeconds: number;
}
export interface HourBucket {
  hourTs: string;
  count: number;
}
export interface DowntimeData {
  date: string;
  thresholdSeconds: number;
  coneCount: number;
  firstTs: string | null;
  lastTs: string | null;
  totalSpanSeconds: number;
  totalDownSeconds: number;
  totalRunSeconds: number;
  availabilityPct: number | null;
  stoppageCount: number;
  mtbfSeconds: number | null;
  mttrSeconds: number | null;
  typicalGapSeconds: number | null;
  stoppages: Stoppage[];
  hourly: HourBucket[];
}
export function getDowntime(date: string, thresholdSeconds: number): Promise<Envelope<DowntimeData>> {
  const p = new URLSearchParams({ date, thresholdSeconds: String(thresholdSeconds) });
  return get(`/api/downtime?${p.toString()}`);
}

// ---- Weight SPC ----
export type SpcType = 'cone' | 'sack';
/** Nelson rules 2-8 — see api/src/services/nelson.ts. Rule 1 is xViolates. */
export type NelsonRuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const NELSON_RULE_LABEL: Record<NelsonRuleId, string> = {
  1: 'Point beyond 3σ',
  2: '9 in a row on one side',
  3: '6 in a row trending',
  4: '14 in a row alternating',
  5: '2 of 3 beyond 2σ, one side',
  6: '4 of 5 beyond 1σ, one side',
  7: '15 in a row within 1σ',
  8: '8 in a row beyond 1σ, both sides',
};
export interface Subgroup {
  ts: string;
  n: number;
  mean: number;
  s: number | null;
  xUcl: number;
  xLcl: number;
  sUcl: number | null;
  sLcl: number | null;
  xViolates: boolean;
  sViolates: boolean;
  nelson: NelsonRuleId[];
}
export interface StationStat {
  station: number;
  n: number;
  mean: number;
  stdev: number | null;
  delta: number;
  distinguishable: boolean;
  flagged: boolean;
}
export interface HistBin {
  start: number;
  end: number;
  count: number;
}
export interface SpecLimits {
  usl: number | null;
  lsl: number | null;
  nominal: number | null;
  source: 'product' | 'manual' | 'none';
  productLabel?: string;
  /** The limits version the chart is drawn against, and how many times the
   *  limits changed inside the period (0 = one tolerance applied throughout). */
  limitsEffectiveFromUtc?: string;
  limitsAreLowerBound?: boolean;
  limitsChangedInPeriod?: number;
}
export interface SpecAgreement {
  evaluated: number;
  plcPassedButOutOfTolerance: number;
  plcFailedButInTolerance: number;
  disagreementCount: number;
  disagreementPct: number;
  toleranceLabel: string;
  specSource: 'product' | 'manual' | 'none';
}
export interface SpcData {
  specAgreement: SpecAgreement | null;
  type: SpcType;
  unit: 'g' | 'kg';
  count: number;
  mean: number;
  stdevOverall: number;
  stdevWithin: number;
  bucketMinutes: number;
  bucketLabel: string;
  grandMean: number;
  sChartCenter: number;
  xbarOutOfControl: number;
  nelsonFlagged: number;
  subgroups: Subgroup[];
  stations: StationStat[];
  practicalThresholdG: number;
  distinguishableStationCount: number;
  flaggedStationCount: number;
  histogram: HistBin[];
  spec: SpecLimits;
  capability: { cp: number | null; cpk: number | null; pp: number | null; ppk: number | null };
}
export interface SpcQuery {
  type: SpcType;
  from: string;
  to: string;
  productId?: number;
  usl?: number;
  lsl?: number;
  shift?: string;
}
export function getSpc(q: SpcQuery): Promise<Envelope<SpcData>> {
  const p = new URLSearchParams({ type: q.type, from: q.from, to: q.to });
  if (q.productId != null) p.set('productId', String(q.productId));
  if (q.usl != null) p.set('usl', String(q.usl));
  if (q.lsl != null) p.set('lsl', String(q.lsl));
  if (q.shift) p.set('shift', q.shift);
  if (q.station != null) p.set('station', String(q.station)); // roadmap Phase 4
  return get(`/api/spc?${p.toString()}`);
}

// ---- Calibration advisory (Phase 5) ----
export interface StationDriftDay {
  date: string;
  n: number;
  mean: number;
  nelson: NelsonRuleId[];
}
export interface StationDrift {
  station: number;
  n: number;
  grandMean: number;
  stdevWithin: number;
  sigmaDayToDay: number;
  days: StationDriftDay[];
  flagged: boolean;
}
export interface CalibrationData {
  unit: 'g';
  from: string;
  to: string;
  days: number;
  stations: StationDrift[];
  flaggedStationCount: number;
}
export interface CalibrationAdjustment {
  adjustmentId: number;
  stationId: number | null;
  adjustedAtUtc: string;
  recordedAtUtc: string;
  recordedBy: string | null;
  reason: string | null;
  note: string | null;
  /** Signed grams the scale was moved by — positive = now reads heavier. */
  amountG: number | null;
}
export function getCalibration(from: string, to: string): Promise<Envelope<CalibrationData>> {
  return get(`/api/calibration?${new URLSearchParams({ from, to }).toString()}`);
}
export function getCalibrationAdjustments(): Promise<{ adjustments: CalibrationAdjustment[] }> {
  return get('/api/calibration/adjustments');
}
export function recordCalibrationAdjustment(a: {
  stationId?: number; adjustedAt?: string; reason?: string; note?: string; amountG?: number;
}): Promise<{ adjustmentId: number; adjustments: CalibrationAdjustment[] }> {
  return post('/api/calibration/adjustments', a);
}

// ---- Reject control chart (p-chart) ----
export type RejectBucketSize = 'hour' | 'day';
export type RejectTypeFilter = 'all' | 'quality' | 'weight';
export interface RejectBucket {
  bucketTs: string;
  /** Source generation (ordinal shared by cones and rejects); limits are per generation. */
  generation: number;
  produced: number;
  /** Cones + rejects of every type — the rate's denominator. */
  inspected: number;
  rejects: number;
  rate: number | null;
  ucl: number | null;
  lcl: number | null;
  outOfControl: boolean;
}
/** One source generation's share of a range, with its own p̄. */
export interface RejectGeneration {
  generation: number;
  totalProduced: number;
  totalRejects: number;
  totalInspected: number;
  pBar: number | null;
  firstBucketTs: string;
  lastBucketTs: string;
}
export interface RejectEpisode {
  startTs: string;
  endTs: string;
  bucketCount: number;
  totalRejects: number;
  totalProduced: number;
}
export interface RejectSpcData {
  bucketSize: RejectBucketSize;
  rejectTypeFilter: RejectTypeFilter;
  totalProduced: number;
  totalRejects: number;
  /** Pooled within one generation; across the 5 Aug 2026 rebuild it is the newest generation's. */
  pBar: number | null;
  /** True when the range crosses a source-generation boundary — limits are then per generation. */
  spansGenerations: boolean;
  generations: RejectGeneration[];
  outOfControlCount: number;
  buckets: RejectBucket[];
  episodes: RejectEpisode[];
}
export function getRejectSpc(from: string, to: string, rejectType: RejectTypeFilter, bucket?: RejectBucketSize): Promise<Envelope<RejectSpcData>> {
  const p = new URLSearchParams({ from, to, rejectType });
  if (bucket) p.set('bucket', bucket);
  return get(`/api/reject-spc?${p.toString()}`);
}

// ---- Operations: sync health, schema-drift guard, data-quality roll-up ----
export interface SyncStatus {
  targetTable: string;
  outcome: string;
  /** Source id bounds of the pass — meaningless without the epoch, whose ids restart at 1. */
  watermarkFrom: number | null;
  watermark: number | null;
  /** null = a pass recorded before epochs existed. */
  epochId: number | null;
  epochLabel: string | null;
  rowsRead: number;
  rowsWritten: number;
  finishedAtUtc: string | null;
  ageSeconds: number | null;
}
/**
 * Per SOURCE table: the fingerprint the sync worker is enforcing, from the
 * open epoch row. Never 'ok' — this API cannot reach the plant's database to
 * verify anything; 'enforced-by-worker' is what it can actually see.
 */
export interface SchemaFingerprint {
  table: string;
  fingerprint: string | null;
  status: 'enforced-by-worker' | 'no-open-epoch';
  epochId: number | null;
  epochLabel: string | null;
}
export interface DqFinding { checkName: string; severity: string; subjectTable: string | null; detail: string | null; }
export interface SyncLifetime {
  passes: number;
  tableRuns: number;
  failures: number;
  firstRunUtc: string | null;
  lastRunUtc: string | null;
  medianMs: number | null;
  p95Ms: number | null;
  slowestMs: number | null;
  lastFailure: { targetTable: string; startedAtUtc: string; error: string | null } | null;
}
/** Canonical tables holding rows under more than one night-attribution rule. */
export interface ShiftRuleRegimes {
  table: string;
  rules: { rule: string | null; rows: number }[];
  mixed: boolean;
}

/**
 * The acquisition source as the worker last saw it (roadmap Phase 2, 14 Sep
 * 2026). Derived server-side from sync_run rows: the worker probes the plant
 * connection once at the start of every pass, and a halted table's row
 * carries the reason in the worker's own words — which name the fix (the
 * `sms epoch:accept` line for a new generation, the .env keys for a wrong
 * database). The screen prints that reason verbatim rather than translating
 * it, because the translation is what used to lose the command.
 */
export interface OperationsSource {
  /** null = no pass has recorded a probe yet. */
  lastProbeOk: boolean | null;
  lastProbeAtUtc: string | null;
  lastProbeMs?: number | null;
  lastHalt: { table: string; reason: string; atUtc: string } | null;
  /** Target tables whose latest pass halted (outcome 'halted', not 'failed'). */
  halted: string[];
}

export interface OperationsData {
  sync: SyncStatus[];
  /** Non-empty only when a rebuild is due — see Setup's Sync health block. */
  shiftRuleRegimes: ShiftRuleRegimes[];
  lifetime: SyncLifetime;
  schema: SchemaFingerprint[];
  dq: {
    latestRunId: string | null;
    bySeverity: Record<string, number>;
    findings: DqFinding[];
  };
  /** Absent from an API built before Phase 2; the screen then says nothing about the probe. */
  source?: OperationsSource;
}
export function getOperations(): Promise<Envelope<OperationsData>> {
  return get('/api/operations');
}

// ---- live line state — polled by the floor screens and the wall display ----
export type LineStatus = 'running' | 'stopped' | 'idle' | 'no_data';
export type LiveHealthKind = "ok" | "stale" | "late" | "no_data";
export interface LiveHealth {
  kind: LiveHealthKind;
  /** Seconds since the OLDEST source table last synced — not the newest. */
  ageSeconds: number | null;
  oldestTable: string | null;
  /** The measured gap between successful passes, never an assumed 60 s. */
  cadenceSeconds: number | null;
  staleAfterSeconds: number;
  lagCeilingSeconds: number;
}

export interface LiveLine {
  lineId: number;
  /**
   * sms.line.display_name — what the screens print for this line, editable
   * in Setup › Line. (LINE_NAME in .env is only the fallback when the row is
   * missing.) The plant and unit come as their own names since 14 Sep 2026:
   * two screens used to recover them by parsing this string on '·'.
   */
  lineName: string;
  /** sms.line.name — what a headline calls the line ("Line 3"). */
  lineShortName: string;
  plantName: string;
  unitName: string;
  /** Plant wall clock at generation, in the production_ts convention (render in UTC). */
  plantNowUtc: string;
  /** True when the server clock was moved by ?asOf — a replay, never live. */
  replay: boolean;
  shift: {
    code: 'morning' | 'evening' | 'night';
    shiftDate: string;
    startUtc: string;
    endUtc: string;
    elapsedSeconds: number;
    remainingSeconds: number;
  };
  /** Newest production time on record, and how far behind the wall clock the
   *  plant's own acquisition runs. Every relative time is anchored here. */
  dataAsOfUtc: string | null;
  ingestLagSeconds: number | null;
  /** Whether the figures can be trusted, decided server-side. */
  health: LiveHealth;
  state: {
    status: LineStatus;
    /** Wall-clock age of the newest reading. */
    sinceLastReadingSeconds: number | null;
    /** How long the line has been down, net of the acquisition lag. */
    behindSeconds: number | null;
    runStartUtc: string | null;
    stopThresholdSeconds: number;
  };
  thisShift: {
    cones: number;
    conesInRange: number;
    conesInRangePct: number | null;
    rejectedCones: number;
    sacks: number;
    sackWeightKg: number;
    conesPerHour: number | null;
  };
  recent: { conesLast10Min: number; conesLastHour: number; sacksLastHour: number };
  lastSack: { ts: string; eventId: number; sourceRowId: number; sackNum: number | null; weightKg: number | null; inRange: boolean | null } | null;
  lastCone: { ts: string; eventId: number; sourceRowId: number; station: number | null; weightG: number | null; inRange: boolean | null } | null;
  lastReject: { ts: string; rejectType: string; station: number | null } | null;
  stations: { station: number; cones: number; lastTs: string }[];
}
export interface LiveData {
  lines: LiveLine[];
}
export function getLive(asOf?: string | null): Promise<Envelope<LiveData>> {
  return get(asOf ? `/api/live?asOf=${encodeURIComponent(asOf)}` : '/api/live');
}

// ---- production report — the period summary (IFL requirement: reporting) ----
export type ReportPeriod = 'day' | 'week' | 'month' | 'quarter' | 'custom';
export interface ReportLine {
  /** Day (YYYY-MM-DD), shift code, or 'total'. */
  group: string;
  cones: number;
  rejectedCones: number;
  rejectRatePct: number | null;
  conesInRangePct: number | null;
  sacks: number;
  sackWeightKg: number;
  avgSackKg: number | null;
  conesPerSack: number | null;
}
export interface ReportData {
  period: { period: ReportPeriod; from: string; to: string };
  /** How much of the period actually holds readings. Always stated on screen. */
  coverage: {
    daysInPeriod: number;
    daysWithData: number;
    firstDayWithData: string | null;
    lastDayWithData: string | null;
    complete: boolean;
  };
  totals: ReportLine;
  byShift: ReportLine[];
  byDay: ReportLine[];
  downtime: { stoppageCount: number; stoppedSeconds: number; thresholdSeconds: number };
}
export function getReport(q: {
  period: ReportPeriod;
  anchor?: string;
  from?: string;
  to?: string;
}): Promise<Envelope<ReportData>> {
  const p = new URLSearchParams();
  p.set('period', q.period);
  if (q.anchor) p.set('anchor', q.anchor);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  return get(`/api/report?${p.toString()}`);
}

/* ==================================================================== */
/* The redesign's additions (REDESIGN.md §12 step 2).                    */
/* ==================================================================== */

// ---- station names, for every reader ----
/**
 * Station labels. Previously readable only by admins, which is why every
 * screen could say nothing but "Station 7" and the count of fourteen was
 * hardcoded in this bundle. Writing them is still admin-only.
 */
export function getStations(): Promise<{ stations: StationRow[] }> {
  return get('/api/stations');
}

/** The station's plant name when it has one, else a plain numbered label. */
export function stationLabel(s: StationRow | undefined, n: number): string {
  return s?.name?.trim() || `Station ${n}`;
}

// ---- the product in force at a moment ----
export interface ProductInForce {
  productId: number;
  label: string;
  setpointG: number | null;
  weightOffsetMinusG: number | null;
  weightOffsetPlusG: number | null;
  effectiveFromUtc: string;
}
export interface ProductLimits {
  targetG: number;
  loG: number;
  hiG: number;
  /** "1,960 ± 40 g", ready to print. */
  label: string;
}
export interface ProductAtData {
  at: string;
  /** Null when nothing was in force then — the screen says so, and computes nothing. */
  product: ProductInForce | null;
  limits: ProductLimits | null;
  /** True when no product has ever been recorded for this line. */
  neverRecorded: boolean;
  /**
   * 'row' — the reading's own MaterialId (IFL's Sep 2026 schema), the plant's
   * own attribution. 'timeline' — the hand-entered line-wide product, the only
   * attribution rows from before that column existed can have. Null when none.
   */
  attribution: 'row' | 'timeline' | null;
  /**
   * Present only when a weight was sent: the server's judgement of that
   * weight against the limits in force then. `inside` null = unjudgeable,
   * and `reason` says why. `outsideByG` is signed: negative = under the
   * lower limit, positive = over the upper, 0 = inside.
   */
  verdict: {
    inside: boolean | null;
    outsideByG: number | null;
    reason: 'no_product_recorded' | 'no_setpoint' | null;
    /** roadmap Phase 4 (14 Sep 2026): the one classification, and the scale's bit as sent. */
    state?: ConeState;
    scalePassed?: boolean | null;
    unknownReason?: 'no_weight' | 'implausible' | 'no_limits' | null;
  } | null;
  /** The limits are the oldest version known and the reading predates it. */
  limitsAreLowerBound: boolean;
}
/**
 * `productId` is the reading's own material, when the row carries one. Pass it
 * whenever you have it: six materials run concurrently on different machines,
 * so "the product recorded on the line" is the wrong answer for a reading that
 * knows its own — it was judging September cones against a retired July product.
 * `weightG` asks the server to judge the reading too; the sheet no longer
 * carries its own copy of the comparison.
 */
export function getProductAt(at?: string | null, productId?: number | null, weightG?: number | null, inRange?: boolean | null): Promise<ProductAtData> {
  const p = new URLSearchParams();
  if (at) p.set('at', at);
  if (productId != null) p.set('productId', String(productId));
  if (weightG != null) p.set('weightG', String(weightG));
  if (inRange != null) p.set('inRange', String(inRange)); // roadmap Phase 4: the scale's bit, for the state
  const qs = p.toString();
  return get(qs ? `/api/product-at?${qs}` : '/api/product-at');
}

// ---- the attention list ----
export type FindingKind = 'station_drift' | 'reject_rise' | 'outside_product_limits';

export interface AttentionFinding {
  kind: FindingKind;
  /** The IFL requirement line this finding serves. Stated in Details. */
  requirement: 2 | 4 | 5;
  screen: 'weight' | 'rejects' | 'readings';
  station?: number;
  /** Signed grams against the line mean, over the run of days it names. */
  deltaG?: number;
  days?: number;
  rejectKind?: 'quality' | 'weight';
  sinceUtc?: string;
  ratePct?: number;
  usualPct?: number;
  count?: number;
}

export interface AttentionData {
  /** The FIXED trailing window the drift and reject rules used. */
  window: { from: string; to: string; days: number };
  /** The selected period, which only the outside-limits count uses. */
  period: { from: string; to: string; shift: string | null };
  findings: AttentionFinding[];
  /** Before the cap of three, so the screen can say "and 2 more". */
  totalFindings: number;
  thresholds: { driftG: number; minDaysHeld: number };
}

export function getAttention(q: {
  from?: string;
  to?: string;
  shift?: string | null;
  trailingDays?: number;
}): Promise<Envelope<AttentionData>> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.shift) p.set('shift', q.shift);
  if (q.trailingDays) p.set('trailingDays', String(q.trailingDays));
  return get(`/api/attention?${p.toString()}`);
}

// ---- the station table: the one station ranking in the application ----
export interface WeightStationRow {
  station: number;
  n: number;
  meanG: number;
  /** Signed grams against the line's own mean, over the run it names. */
  vsLineG: number;
  /** Signed grams against the product target, or null when none was recorded. */
  vsTargetG: number | null;
  daysHeld: number;
  flagged: boolean;
  rejectRatePct: number | null;
  lastAdjustedUtc: string | null;
  days: { date: string; n: number; mean: number; nelson: number[] }[];
}

export interface WeightStationsData {
  from: string;
  to: string;
  days: number;
  lineMeanG: number | null;
  targetG: number | null;
  productId: number | null;
  productLabel: string | null;
  thresholdG: number;
  minDaysHeld: number;
  lineRejectRatePct: number | null;
  stations: WeightStationRow[];
  /** Scale versus product over the SELECTED period, not the trailing window. */
  disagreement: {
    passedButOutside: number;
    rejectedButInside: number;
    judged: number;
    unjudged: number;
  };
}

/**
 * The trailing detector window (fixed length, `trailingDays`) ENDS at the
 * selected period's end (`to`) rather than at the newest production day —
 * finding H4, 15 Sep 2026. Omit `from` and let the server derive it from
 * `trailingDays`: that keeps the fixed-14-day rule defined in exactly ONE
 * place (`app.ts`, mirroring `trailingWindow` in `lib/period.ts`), not
 * re-derived here too. Sending `to` is what lets a reader pick June or July
 * and see that period's own product limits, not September's.
 */
export function getWeightStations(q: {
  trailingDays?: number;
  from?: string;
  to?: string;
  periodFrom?: string;
  periodTo?: string;
  shift?: string | null;
}): Promise<Envelope<WeightStationsData>> {
  const p = new URLSearchParams();
  if (q.trailingDays) p.set('trailingDays', String(q.trailingDays));
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.periodFrom) p.set('periodFrom', q.periodFrom);
  if (q.periodTo) p.set('periodTo', q.periodTo);
  if (q.shift) p.set('shift', q.shift);
  return get(`/api/weight-stations?${p.toString()}`);
}

// ---- roadmap Phase 5: reject management (14 Sep 2026) ----
//
// One filter shape for every reject endpoint, mirroring api's rejects.ts
// RejectFilters: the Pareto (/api/rejects), the trend (/api/reject-spc), the
// per-day breakdown (/api/rejects/by-day-code) and the reason sheet's list
// (/api/rejects/reason) all take it, so a control on the Rejects screen
// narrows all four identically. `code` is `weight` or `<tube>-<material>`.
export interface RejectFilters {
  from?: string;
  to?: string;
  shift?: string;
  /** Instant cap, so a replay (?at=) counts only what existed at that moment. */
  tsTo?: string;
  station?: number;
  /** material_id. Rows from before 5 Aug 2026 carry none — see `unattributed`. */
  product?: number;
  code?: string;
}

function rejectFilterParams(f: RejectFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.shift) p.set('shift', f.shift);
  if (f.tsTo) p.set('tsTo', f.tsTo);
  if (f.station != null) p.set('station', String(f.station));
  if (f.product != null) p.set('product', String(f.product));
  if (f.code) p.set('code', f.code);
  return p;
}

/** The URL form of a reason's code, as the API's parseCodeParam reads it. */
export function rejectCodeParam(r: { rejectType: string; tubeCode: number | null; materialCode: number | null }): string {
  return r.rejectType === 'weight' ? 'weight' : `${r.tubeCode ?? 'null'}-${r.materialCode ?? 'null'}`;
}

export interface RejectDataFiltered extends RejectData {
  /** Only on a product-filtered call: rejects in the range with no product, of every reject in it. */
  unattributed: { rows: number; of: number } | null;
}

export function getRejectsFiltered(f: RejectFilters): Promise<Envelope<RejectDataFiltered>> {
  return get(`/api/rejects?${rejectFilterParams(f).toString()}`);
}

export function getRejectSpcFiltered(
  q: RejectFilters & { from: string; to: string; rejectType: RejectTypeFilter; bucket?: RejectBucketSize },
): Promise<Envelope<RejectSpcData>> {
  const p = rejectFilterParams(q);
  p.set('rejectType', q.rejectType);
  if (q.bucket) p.set('bucket', q.bucket);
  return get(`/api/reject-spc?${p.toString()}`);
}

export interface RejectDayCodeRow {
  /** YYYY-MM-DD production day (06:00-06:00 under the line's shift rule). */
  day: string;
  rejectType: string;
  tubeCode: number | null;
  materialCode: number | null;
  rejectCodeId: number | null;
  label: string | null;
  displayLabel: string;
  isPass: boolean | null;
  count: number;
  /** Cones weighed that day under the same filters. */
  cones: number;
  /** Cones + every reject of the day — the rate's denominator. */
  inspected: number;
  ratePct: number | null;
}
export interface RejectDayCodeData {
  dayBasis: 'production_day';
  denominator: 'cones_plus_rejects';
  days: number;
  total: number;
  rows: RejectDayCodeRow[];
}
export function getRejectsByDayCode(f: RejectFilters & { from: string; to: string }): Promise<Envelope<RejectDayCodeData>> {
  return get(`/api/rejects/by-day-code?${rejectFilterParams(f).toString()}`);
}

export interface RejectReasonRow {
  eventId: number;
  productionTsUtc: string;
  shiftCode: string;
  station: number | null;
  materialId: number | null;
  productLabel: string | null;
  weightG: number | null;
  sourceRowId: number | null;
  epochLabel: string | null;
  attributionMethod: string | null;
}
export interface RejectReasonData {
  day: string;
  dayBasis: 'production_day';
  code: { rejectType: string; tubeCode: number | null; materialCode: number | null };
  rejectCodeId: number | null;
  label: string | null;
  displayLabel: string;
  isPass: boolean | null;
  total: number;
  page: number;
  pageSize: number;
  rows: RejectReasonRow[];
}
export function getRejectReason(q: {
  day: string; code: string; shift?: string; station?: number; product?: number; page?: number; pageSize?: number;
}): Promise<Envelope<RejectReasonData>> {
  const p = new URLSearchParams({ day: q.day, code: q.code });
  if (q.shift) p.set('shift', q.shift);
  if (q.station != null) p.set('station', String(q.station));
  if (q.product != null) p.set('product', String(q.product));
  if (q.page) p.set('page', String(q.page));
  if (q.pageSize) p.set('pageSize', String(q.pageSize));
  return get(`/api/rejects/reason?${p.toString()}`);
}

// ---- roadmap Phase 11: security, reliability and operations (14 Sep 2026) ----

/** What /api/health answers. Anonymous callers get `status` and `service` with the rest nulled. */
export type HealthStatus = 'ok' | 'degraded' | 'down';
export interface HealthReport {
  status: HealthStatus;
  service: { version: string; uptimeSeconds: number; startedAtUtc: string; pid: number };
  database: { ok: boolean; latencyMs: number | null; sizeMb: number | null; capMb: number; pctOfCap: number | null };
  acquisition: { kind: LiveHealthKind | null; ageSeconds: number | null; cadenceSeconds: number | null; halted: string[] | null };
  backup: { dir: string; newestFile: string | null; newestAtUtc: string | null; ageDays: number | null; warning: boolean } | null;
  degradedReason: string | null;
}
/** Unauthenticated on the server; the browser always has its cookie, so the full report comes back. */
export function getHealth(): Promise<HealthReport> {
  return get('/api/health');
}

/** The caller's own password. 403 = the current password was wrong; 400 carries the policy sentence in `detail`. */
export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; otherSessionsRevoked: number }> {
  return post('/api/auth/password', { currentPassword, newPassword });
}
/** Admin reset of another account; every session of that account is revoked. */
export function adminResetPassword(userId: number, newPassword: string): Promise<{ ok: boolean; sessionsRevoked: number }> {
  return post(`/api/admin/users/${userId}/password`, { newPassword });
}

/** One keyset page of the audit log; pass `nextBefore` back to walk older. */
export function adminGetAuditPage(before: number | null, limit = 40): Promise<{ entries: AuditEntry[]; nextBefore: number | null }> {
  const p = new URLSearchParams();
  if (before != null) p.set('before', String(before));
  p.set('limit', String(limit));
  return get(`/api/admin/audit?${p.toString()}`);
}

// ---- roadmap Phase 4: cone weight module (14 Sep 2026) ----
// Interface declaration merging adds the new fields to the existing types
// without editing them in place: the server emits `state` on every cone row
// (register list, detail, CSV), `product_name` on cones and rejects, counts
// per state on /api/production, and the station on /api/spc.

/** The ONE classification — shared/src/domain/classification.ts. */
export type ConeState = 'within' | 'low' | 'high' | 'rejected' | 'unknown';
export const CONE_STATES: readonly ConeState[] = ['within', 'low', 'high', 'rejected', 'unknown'];

export interface RegisterRow {
  /** Cones only, from the shared rule; absent on sacks and rejects. */
  state?: ConeState;
  /** The reading's own product by name (cones and rejects); null before 5 Aug 2026. */
  product_name?: string | null;
}
export interface RegisterQuery {
  /** Cone only: keep these states. */
  state?: ConeState[];
  /** The reading's own material_id (cones and rejects). */
  product?: number;
}
export interface SpcQuery {
  station?: number;
}
export interface SpcData {
  /** The station the chart is drawn for, or null for the line. */
  station: number | null;
  /** Readings the population rule excluded as implausible. */
  implausible: number;
}
export type StateCounts = Record<ConeState, number>;
export interface ProductionData {
  /** Cones per state over the same filters as `rows`; null unless the route computed it. */
  states: StateCounts | null;
  /** Readings the population rule excluded as implausible. */
  implausible: number | null;
}
export interface ProductAtData {
  /** The plausibility window the state was judged with (roadmap Phase 4). */
  plausibility?: { loG: number; hiG: number };
}
export interface ReportData {
  readings: { states: StateCounts; implausible: number } | null;
  shiftCheck: { compared: number; mismatched: number; mismatchPct: number; topHour: number | null } | null;
}
export interface LimitHistoryVersion {
  versionId: number;
  setpointG: number | null;
  offsetMinusG: number | null;
  offsetPlusG: number | null;
  /** App instant (genuine UTC) — format with fmtAppInstant, never the plant-clock formatters. */
  effectiveFromUtc: string;
  effectiveIsLowerBound: boolean;
  source: 'pdas_observed' | 'sms_write';
  changedBy: string | null;
  reason: string | null;
  recordedAtUtc: string;
  label: string | null;
}
export interface LimitHistoryProduct {
  productId: number;
  label: string;
  activeFlag: boolean | null;
  versions: LimitHistoryVersion[];
}
export function getProductLimitHistory(): Promise<{ products: LimitHistoryProduct[] }> {
  return get('/api/products/limits/history');
}

export interface MachineRunning {
  station: number;
  stationName: string | null;
  machineName: string | null;
  materialId: number | null;
  productName: string | null;
  cones: number;
  conesOnMaterial: number;
  newestUtc: string | null;
  sinceUtc: string | null;
  sinceIsWindowStart: boolean;
  quiet: boolean;
}
export interface MachinesRunningData {
  asOfUtc: string | null;
  windowMs: number;
  windowStartUtc: string | null;
  machines: MachineRunning[];
  materialsRunning: number;
}
export function getMachinesRunning(at?: string | null): Promise<Envelope<MachinesRunningData>> {
  const p = new URLSearchParams();
  if (at) p.set('at', at);
  const qs = p.toString();
  return get(qs ? `/api/machines/running?${qs}` : '/api/machines/running');
}

export interface ShiftCheckData {
  from: string;
  to: string;
  cones: number;
  mismatched: number;
  mismatchPct: number;
  noLegacyShift: number;
  byDay: { day: string; cones: number; mismatched: number; mismatchPct: number }[];
  topHours: { hour: number; mismatched: number }[];
  note: string;
}
export function getShiftCheck(from: string, to: string): Promise<Envelope<ShiftCheckData>> {
  return get(`/api/shift-check?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export interface WeightAggregate { n: number; sumG: number | null; avgG: number | null; minG: number | null; maxG: number | null }
export interface ReconciliationData {
  from: string;
  to: string;
  shift: string | null;
  total: WeightAggregate;
  plausible: WeightAggregate;
  implausible: WeightAggregate;
  noWeight: number;
  byState: Record<ConeState, WeightAggregate>;
  plausibility: { loG: number; hiG: number };
  limitWindows: number;
  basis: 'as_recorded';
  note: string;
}
/** Manager+ (rank 3). */
export function getReconciliation(from: string, to: string, shift?: string | null): Promise<Envelope<ReconciliationData>> {
  const p = new URLSearchParams({ from, to });
  if (shift) p.set('shift', shift);
  return get(`/api/reconciliation?${p.toString()}`);
}

// ---- roadmap Phase 9: calibration analytics (15 Sep 2026) ----
// Appended, not edited in place (the three-agent collision rule). The
// existing interfaces above are EXTENDED here by declaration merging: a
// second `export interface X { … }` in the same module adds its members to
// the first, so every screen sees the new fields on the same types.

/** Median of the same population as `avg` — /api/weights, cones (g) and sacks (kg). */
export interface WeightStats {
  median: number | null;
}

/** Median of the same population as `mean` — /api/spc, the figure Weight prints beside the mean. */
export interface SpcData {
  median: number | null;
}

/** The plant's UTC offset in minutes as the server sees it — the one the client converts with. */
export interface LiveLine {
  plantOffsetMinutes: number;
}

/** One pattern rule, with the run length it needs (nelson.ts). */
export interface NelsonRuleInfo {
  id: NelsonRuleId;
  label: string;
  minPoints: number;
}

/**
 * Where a flagged station's run reaches the product's limit if it keeps its
 * rate — a projection from recent readings under a stated linear assumption
 * (`assumption`), never a prediction. Null when no limits were in force or
 * the run is flat.
 */
export interface DriftProjection {
  slopeGPerDay: number;
  overDays: number;
  towards: 'upper' | 'lower';
  limitG: number;
  distanceG: number;
  /** 0 = already beyond the limit; null = not moving toward one. */
  daysToLimit: number | null;
  assumption: 'linear_over_run';
}

export interface WeightStationRow {
  medianG: number | null;
  /** Within-day standard deviation, pooled over the window — rendered at last (it was computed and dropped). */
  sdG: number;
  restartedOn: string | null;
  centrelineG: number;
  sigmaDayToDay: number;
  /** Longest calendar-contiguous run of days the pattern rules had; a rule needing more could never have fired. */
  longestRun: number;
  projection: DriftProjection | null;
}

export interface WeightStationsData {
  limits: { loG: number; hiG: number } | null;
  rules: NelsonRuleInfo[];
}

export interface AttentionFinding {
  projection?: DriftProjection | null;
}

export interface CalibrationAdjustment {
  /** The same instant on the production-time convention — render with the UTC formatters. */
  adjustedAtPlant: string;
  beforeG: number | null;
  afterG: number | null;
  referenceG: number | null;
  productId: number | null;
  productLabel: string | null;
}

export interface AdjustmentList {
  adjustments: CalibrationAdjustment[];
  /** The offset the plant-time fields were converted with — use it, never the browser's zone. */
  plantOffsetMinutes: number;
  from: string | null;
  to: string | null;
  station: number | null;
}

/**
 * The ledger with filters: production days on the plant clock, and one
 * station's rows PLUS the line-wide rows (station null), which apply to it.
 * The Calibration report (Phase 8) calls this with from/to.
 */
export function listAdjustments(q: { from?: string; to?: string; station?: number | null } = {}): Promise<AdjustmentList> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.station != null) p.set('station', String(q.station));
  const qs = p.toString();
  return get(qs ? `/api/calibration/adjustments?${qs}` : '/api/calibration/adjustments');
}

export interface AdjustmentInput {
  stationId?: number;
  /** Genuine UTC — convert a typed plant time with lib/plantClock.fromPlantLocal. */
  adjustedAt?: string;
  reason?: string;
  note?: string;
  amountG?: number;
  beforeG?: number;
  afterG?: number;
  referenceG?: number;
  productId?: number;
}

/** Supervisor+ (rank 2), the same gate as setting the running product. */
export function recordAdjustment(a: AdjustmentInput): Promise<{ adjustmentId: number } & AdjustmentList> {
  return post('/api/calibration/adjustments', a);
}

export interface CalibrationRulesData {
  rules: NelsonRuleInfo[];
  points: number | null;
  cannotFire: NelsonRuleId[] | null;
  approvedByIfl: boolean;
}
export function getCalibrationRules(points?: number): Promise<CalibrationRulesData> {
  return get(points == null ? '/api/calibration/rules' : `/api/calibration/rules?points=${points}`);
}

/** The product's target the projection's limit is relative to (null when the limit is stated absolutely). */
export interface DriftProjection {
  targetG: number | null;
}

// ---- roadmap Phase 7: sacks and the stock ledger (15 Sep 2026) ----
// Everything below mirrors api/src/services/sacks.ts and sackStock.ts. The
// ledger is LINE-level: `machineLevel.enabled` is false on every response and
// its `reason` is printed, never assumed away.

export interface SackGroup {
  sacks: number;
  /** Under the weight rule on file (basis + tare), like production.ts. */
  kg: number;
  /** Over the plausible population; null when none. */
  avgKg: number | null;
  /** Share the scale's own bit passed, of those carrying a bit. */
  inRangePct: number | null;
  inRange: number;
  noFlag: number;
  implausible: number;
}
export interface SackSummaryData {
  from: string;
  to: string;
  shift: string | null;
  product: number | null;
  totals: SackGroup & { cones: number; conesPerSack: number | null };
  byShift: (SackGroup & { shift: string })[];
  byProduct: (SackGroup & { materialId: number | null; productName: string | null })[];
  unattributed: { rows: number; of: number };
  weightBasis: string;
  tareKg: number;
  plausibility: { loKg: number; hiKg: number };
  sackTimeIsInsertTime: true;
  conesPerSackApproximate: true;
  machineLevel: { enabled: false; reason: string };
}
export interface SackSummaryQuery {
  from: string;
  to: string;
  shift?: string;
  tsTo?: string;
  product?: number;
}
export function getSackSummary(q: SackSummaryQuery): Promise<Envelope<SackSummaryData>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.shift) p.set('shift', q.shift);
  if (q.tsTo) p.set('tsTo', q.tsTo);
  if (q.product != null) p.set('product', String(q.product));
  return get(`/api/sacks/summary?${p.toString()}`);
}

export interface LedgerFlow { sacks: number; kg: number }
export interface LedgerDay {
  day: string;
  opening: LedgerFlow;
  openingEntries: LedgerFlow;
  receipts: LedgerFlow;
  weighed: LedgerFlow;
  issues: LedgerFlow;
  consumption: LedgerFlow;
  adjustments: LedgerFlow;
  closing: LedgerFlow;
  movements: number;
}
export interface MaterialLedger {
  materialId: number | null;
  productName: string | null;
  opening: LedgerFlow;
  openingEntries: LedgerFlow;
  receipts: LedgerFlow;
  weighed: LedgerFlow;
  issues: LedgerFlow;
  consumption: LedgerFlow;
  adjustments: LedgerFlow;
  closing: LedgerFlow;
  kgMissing: number;
}
export interface StockLedgerData {
  from: string;
  to: string;
  product: number | null;
  basis: 'line';
  machineLevel: { enabled: false; reason: string };
  dayBasis: 'production_day';
  sackTimeIsInsertTime: true;
  receiptMeaning: string;
  weightBasis: string;
  tareKg: number;
  opening: LedgerFlow;
  closing: LedgerFlow;
  totals: {
    openingEntries: LedgerFlow;
    receipts: LedgerFlow;
    weighed: LedgerFlow;
    issues: LedgerFlow;
    consumption: LedgerFlow;
    adjustments: LedgerFlow;
  };
  days: LedgerDay[];
  byMaterial: MaterialLedger[];
  kgMissing: number;
}
export function getSackStock(q: { from: string; to: string; product?: number; tsTo?: string }): Promise<Envelope<StockLedgerData>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.product != null) p.set('product', String(q.product));
  if (q.tsTo) p.set('tsTo', q.tsTo);
  return get(`/api/sacks/stock?${p.toString()}`);
}

export const MOVEMENT_TYPES = ['opening', 'receipt', 'issue', 'consumption', 'adjustment'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export interface SackMovement {
  movementId: number;
  materialId: number | null;
  productName: string | null;
  /** Always null: the ledger is line-level (migration 033). */
  machineId: null;
  movementType: MovementType;
  quantitySacks: number;
  quantityKg: number | null;
  /** Plant wall clock labelled UTC — the production-time formatters (fmtClock) apply. */
  occurredAtPlant: string;
  productionDay: string;
  /** Genuine UTC — fmtAppInstant. */
  recordedAtUtc: string;
  recordedBy: { userId: number; name: string } | null;
  source: 'derived' | 'manual';
  reason: string | null;
}
export interface SackMovementsData {
  from: string;
  to: string;
  movements: SackMovement[];
  weighed: { day: string; sacks: number; kg: number }[];
  machineLevel: { enabled: false; reason: string };
}
export function getSackMovements(from: string, to: string, product?: number): Promise<Envelope<SackMovementsData>> {
  const p = new URLSearchParams({ from, to });
  if (product != null) p.set('product', String(product));
  return get(`/api/sacks/movements?${p.toString()}`);
}
export interface SackMovementInput {
  movementType: MovementType;
  quantitySacks: number;
  quantityKg?: number | null;
  materialId?: number | null;
  /** Plant time as typed, "YYYY-MM-DDTHH:MM" — never converted from the browser's zone. */
  occurredAtPlant: string;
  reason?: string | null;
}
/** Manager+ (rank 3) — the developer's default until IFL sets the rank. */
export function recordSackMovement(m: SackMovementInput): Promise<{ movementId: number; productionDay: string; recordedAtUtc: string }> {
  return post('/api/sacks/movements', m);
}

// ---- roadmap Phase 8: dashboards and reports (15 Sep 2026) ----
// Appended, not edited in place (the three-agent collision rule). The nine
// report types on one surface: one composed response per type from
// /api/reports/<type>, one CSV from /api/reports/<type>/export (rank 3,
// audited), and the print header every report and the register print carry.
// Every KPI these print is defined in the repository-root KPI-DEFINITIONS.md,
// the sheet IFL signs; every row of it is "awaiting" until they do.

export type ReportType =
  | 'daily' | 'shift' | 'product' | 'station' | 'reject' | 'cone-weight' | 'sack' | 'calibration' | 'management-summary';
export const REPORT_TYPES: readonly ReportType[] = [
  'daily', 'shift', 'product', 'station', 'reject', 'cone-weight', 'sack', 'calibration', 'management-summary',
];

export interface ReportFilters {
  shift?: 'morning' | 'evening' | 'night';
  product?: number;
  station?: number;
}

/** What every report carries at the top, and every CSV in its trailing rows, and every printed page in its header. */
export interface ReportHeader {
  reportType: ReportType | 'register';
  title: string;
  lineName: string;
  plantName: string | null;
  unitName: string | null;
  period: { period: string; from: string; to: string; days: number };
  filters: ReportFilters;
  /** Plant wall clock on the production-time convention — render in UTC, like every reading time. */
  generatedAtPlantUtc: string;
  generatedBy: string;
  smsVersion: string;
  definitions: 'KPI-DEFINITIONS.md';
  approval: 'awaiting';
}

export interface ReportQuery {
  period?: ReportPeriod;
  anchor?: string;
  from?: string;
  to?: string;
  shift?: string | null;
  product?: number | null;
  station?: number | null;
  /** Replay instant — the header is stamped with it when the server allows replays. */
  at?: string | null;
}

function reportParams(q: ReportQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.period) p.set('period', q.period);
  if (q.anchor) p.set('anchor', q.anchor);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.shift) p.set('shift', q.shift);
  if (q.product != null) p.set('product', String(q.product));
  if (q.station != null) p.set('station', String(q.station));
  if (q.at) p.set('at', q.at);
  return p;
}

/* The report shapes, as api/src/services/reports/*.ts emit them. */

export interface RejectPopulations {
  byScale: number;
  byScalePct: number | null;
  atInspection: number;
  atInspectionPct: number | null;
  note: string;
}
/** report.ts gained `shift` in the same wave; `downtime` is null under a shift filter (report.ts says why). */
export interface ReportData {
  shift: 'morning' | 'evening' | 'night' | null;
}
export interface DailyReportData extends Omit<ReportData, 'downtime'> {
  downtime: ReportData['downtime'] | null;
  rejectPopulations: RejectPopulations;
}

export interface ShiftSection {
  shift: 'morning' | 'evening' | 'night';
  coverage: ReportData['coverage'];
  totals: ReportLine;
  byDay: ReportLine[];
  readings: ReportData['readings'];
}
export interface ShiftReportData {
  period: ReportData['period'];
  shift: 'morning' | 'evening' | 'night' | null;
  shifts: ShiftSection[];
  shiftCheck: ReportData['shiftCheck'];
  timeLostNote: string;
}

export interface ProductReportRow extends ReportLine {
  productId: number | null;
  productLabel: string;
  weight: { n: number; avgG: number | null; sdG: number | null; minG: number | null; maxG: number | null };
  states: StateCounts;
  implausible: number;
}
export interface ProductReportData {
  period: ReportData['period'];
  filters: ReportFilters;
  rows: ProductReportRow[];
  unattributed: { cones: number; rejects: number; sacks: number; ofCones: number; ofRejects: number; ofSacks: number };
  note: string;
}

export interface StationReportRow {
  station: number;
  cones: number;
  weighedPlausible: number;
  meanG: number | null;
  vsLineG: number | null;
  vsTargetG: number | null;
  daysHeld: number;
  flagged: boolean;
  rejectedAtInspection: number;
  rejectRatePct: number | null;
  conesInRangePct: number | null;
  lastAdjustedUtc: string | null;
  states: StateCounts;
}
export interface StationReportData {
  period: ReportData['period'];
  lineMeanG: number | null;
  targetG: number | null;
  productLabel: string | null;
  thresholdG: number;
  minDaysHeld: number;
  lineRejectRatePct: number | null;
  rows: StationReportRow[];
  note: string;
}

export interface RejectTrendPoint {
  day: string;
  produced: number;
  inspected: number;
  rejects: number;
  ratePct: number | null;
  uclPct: number | null;
  lclPct: number | null;
  outOfControl: boolean;
}
export interface RejectReportData {
  period: ReportData['period'];
  filters: ReportFilters;
  total: number;
  reasons: RejectReason[];
  unattributed: { rows: number; of: number } | null;
  dayBasis: 'production_day';
  denominator: 'cones_plus_rejects';
  byDayCode: RejectDayCodeRow[];
  trend: RejectTrendPoint[];
  pBarPct: number | null;
  spansGenerations: boolean;
  note: string;
}

export interface ConeWeightReportData {
  period: ReportData['period'];
  basis: 'as_recorded';
  cones: number;
  weighed: number;
  implausible: number;
  meanG: number | null;
  medianG: number | null;
  medianSource: 'weights_service' | 'report_query';
  sdG: number | null;
  minG: number | null;
  maxG: number | null;
  states: StateCounts | null;
  bucketSizeG: number;
  histogram: Bucket[];
  target: { setpointG: number; source: 'current_product' | 'fallback'; label: string | null };
  byStation: { station: number; n: number; meanG: number; vsLineG: number; vsTargetG: number | null; flagged: boolean }[];
  lineMeanG: number | null;
  plausibility: { loG: number; hiG: number };
  note: string;
}

export interface SackReportData {
  period: ReportData['period'];
  filters: ReportFilters;
  weightBasis: string;
  totals: ReportLine;
  rejectedByScale: number;
  inRangePct: number | null;
  conesPerSack: number | null;
  byShift: ReportLine[];
  byDay: ReportLine[];
  byProduct: { productId: number | null; productLabel: string; sacks: number; sackWeightKg: number; avgSackKg: number | null }[];
  distribution: { count: number; implausible: number; avg: number | null; min: number | null; max: number | null; stdev: number | null; bucketSize: number; histogram: Bucket[] } | null;
  caveats: { time: string; machine: string; conesPerSack: string };
}

export interface CalibrationStationRow {
  station: number;
  n: number;
  meanG: number;
  vsLineG: number;
  vsTargetG: number | null;
  daysHeld: number;
  flagged: boolean;
  daysFlagged: number;
  daysWithData: number;
  lastAdjustedUtc: string | null;
  adjustmentsInPeriod: number;
}
export interface CalibrationAdjustmentRow {
  adjustmentId: number;
  stationId: number | null;
  adjustedAtUtc: string;
  recordedAtUtc: string;
  recordedBy: string | null;
  reason: string | null;
  note: string | null;
  amountG: number | null;
}
export interface CalibrationReportData {
  period: ReportData['period'];
  filters: ReportFilters;
  lineMeanG: number | null;
  targetG: number | null;
  productLabel: string | null;
  thresholdG: number;
  minDaysHeld: number;
  stations: CalibrationStationRow[];
  flaggedStationCount: number;
  adjustments: CalibrationAdjustmentRow[];
  note: string;
}

export interface KpiRow {
  key: string;
  label: string;
  unit: 'cones' | 'sacks' | 'kg' | 'g' | '%' | 'days' | 'stations' | 'seconds' | 'stops' | 'readings';
  betterWhen: 'higher' | 'lower' | 'neither';
  definition: string;
  current: number | null;
  prior: number | null;
  delta: { abs: number; pct: number | null } | null;
  approval: 'awaiting';
}
export interface ManagementSummaryData {
  period: ReportData['period'];
  prior: { from: string; to: string };
  coverage: { current: ReportData['coverage']; prior: ReportData['coverage'] };
  kpis: KpiRow[];
  verdict: { cones: number; sacks: number; sackWeightKg: number };
  approval: 'awaiting';
  note: string;
}

export interface ReportDataByType {
  daily: DailyReportData;
  shift: ShiftReportData;
  product: ProductReportData;
  station: StationReportData;
  reject: RejectReportData;
  'cone-weight': ConeWeightReportData;
  sack: SackReportData;
  calibration: CalibrationReportData;
  'management-summary': ManagementSummaryData;
}

export interface ReportResponse<T extends ReportType> {
  header: ReportHeader;
  report: ReportDataByType[T];
}

/** One composed report. Rank 1; the management summary rank 3. */
export function getReportOf<T extends ReportType>(type: T, q: ReportQuery): Promise<Envelope<ReportResponse<T>>> {
  return get(`/api/reports/${type}?${reportParams(q).toString()}`);
}

/** The CSV's address — rank 3 on the server, audited `export.csv`. A link, so the browser downloads it. */
export function reportExportUrl(type: ReportType, q: ReportQuery): string {
  return `/api/reports/${type}/export?${reportParams(q).toString()}`;
}

/** The print header on its own, for the register's Print button. */
export function getReportHeader(q: { from?: string; to?: string; at?: string | null }): Promise<{ header: ReportHeader }> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.at) p.set('at', q.at);
  const qs = p.toString();
  return get(qs ? `/api/reports/header?${qs}` : '/api/reports/header');
}
