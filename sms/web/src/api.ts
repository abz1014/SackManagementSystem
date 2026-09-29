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
  /** Share of the group's sacks the SCALE passed (api production.ts `sacksPassedScalePct`). */
  sacksPassedScalePct?: number | null;
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
  /** Encoded ShiftRef bounds (lib/period.ts periodQuery), for a chart
   *  drag-selected range (T0, 28 Sep 2026). The route does not read these
   *  yet — harmless extras until it does. */
  fromShift?: string;
  toShift?: string;
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
  /**
   * The SMS-local limit path (POST /api/products/limits/local) — a SEPARATE
   * gate from `canWrite` above, and independent of `enabled`: it never
   * touches PDAS, so it does not depend on PDAS_WRITE_ENABLED. Drive the
   * local editor's availability from this, never from a rank constant in
   * the client — a rank the server no longer honours must not still show a
   * button that only ever answers 403.
   */
  local: { canWrite: boolean };
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
export function updateProductLimits(
  productId: number,
  before: ProductFields,
  after: ProductFields,
  reason: string,
  // Task W1-D: the large-change confirmation checkbox (Catalogue.tsx's
  // two-step limits form); omitted (or false) for an ordinary change.
  largeChangeConfirmed?: boolean,
): Promise<{ productId: number; observedAfter: ProductFields; products: ProductOption[] }> {
  return post(`/api/products/${productId}/limits`, { before, after, reason, largeChangeConfirmed });
}

// ---- Pallets, mirrored from PDAS (roadmap Phase 6 Wave F; UI added Task L1, 28 Sep 2026) ----
export interface PalletRow {
  palletId: number;
  productId: number;
  productLabel: string | null;
  packSchemaId: number | null;
  packSchemaLabel: string | null;
  lot: string | null;
  active: boolean | null;
  sackColour: string | null;
  labelType: number | null;
  steamProg: number | null;
  routing: number | null;
  pdasCreatedAt: string | null;
}
export function getPallets(): Promise<{ pallets: PalletRow[] }> {
  return get('/api/pallets');
}
export function setPalletActive(palletId: number, active: boolean, reason: string): Promise<{ palletId: number; active: boolean; pallets: PalletRow[] }> {
  return post(`/api/pallets/${palletId}/active`, { active, reason });
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

export function getRejects(from?: string, to?: string, fromShift?: string, toShift?: string): Promise<Envelope<RejectData>> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
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
export function getWeights(basis: Basis, from?: string, to?: string, fromShift?: string, toShift?: string): Promise<Envelope<WeightsData>> {
  const p = new URLSearchParams();
  p.set('basis', basis);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
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
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
  /** Encoded ShiftRef bounds (lib/period.ts periodQuery). Harmless until the route reads them (T0, 28 Sep 2026). */
  fromShift?: string;
  toShift?: string;
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
  /**
   * Which source generation to read, overriding the default (the newest real
   * generation covering the window — resolveGenerationScope's own rule).
   * `'auto'` states that default explicitly; `'<sourceDb>#<ordinal>'` is a
   * GenerationTally.key; `'epoch:<id>'` names one `sms.source_epoch` row
   * directly. Optional: the route this drives does not exist yet.
   */
  batch?: string;
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
  /** `sms.source_epoch.epoch_id` this reading was ingested under — the key `RegisterQuery.batch`'s `epoch:<id>` form takes. */
  epochId: number | null;
  /**
   * The epoch's own generation number and simulator flag (Task B, 28 Sep
   * 2026, mirroring Health defect 4's `SyncStatus.epochOrdinal`/
   * `epochSimulator`) — the pair `batchName()` (lib/batchName.ts) takes, so
   * a sheet prints "IFL data batch 3" instead of the raw `epochLabel` table
   * name ("pack1_TP1U2 gen 4"). Optional: absent on a server built before
   * this field existed, never itself a claim of "not the simulator".
   */
  epochOrdinal?: number | null;
  epochSimulator?: boolean;
}

/**
 * WS-CN (23 Sep 2026), mirroring `api/src/services/register.ts`'s own
 * `RegisterDataIssue`. `field` is always `'total'` here — `listEvents`'s own
 * pooled tally, the only one `RegisterPage` carries; `'count'` is
 * `countEvents`'s scoped figure and belongs to `EventCount`, not this type.
 */
export interface RegisterDataIssue {
  field: 'total' | 'count';
  generation: string | null;
  reason: string;
}

/**
 * One physical source generation's share of a register page's `total` —
 * mirrors api/src/services/register.ts's `GenerationTally` (foldGenerationTally)
 * field for field. `key` is `${sourceDb}#${ordinal}`, the same key
 * `RegisterQuery.batch` takes.
 */
export interface GenerationTally {
  key: string;
  ordinal: number | null;
  sourceDb: string | null;
  label: string | null;
  /** Derived from sourceDb/provenance server-side, never from provenance alone. */
  simulator: boolean;
  /** Rows of this generation matching the register's filters. */
  rows: number;
}

export interface RegisterPage {
  rows: RegisterRow[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * What `total` is made of, newest generation first — mirrors the server's
   * `RegisterPage.generations` (register.ts). Optional for the same
   * back-compat reason as there: a caller must read a missing value as "not
   * stated", never as "one generation".
   */
  generations?: GenerationTally[];
  /**
   * The single generation a `batch`-scoped read resolved to, when the route
   * resolves one rather than pooling every generation present — same shape
   * as LiveGenerationNote's own `generation` field (see below), so one
   * vocabulary describes "which generation" everywhere in this client.
   */
  generation?: {
    generation: {
      key: string;
      ordinal: number;
      sourceDb: string | null;
      provenance: string | null;
      label: string | null;
      simulator: boolean;
    } | null;
    spansGenerations: boolean;
    otherGenerationExcluded: number;
    excludedSimulator?: number;
  };
  /**
   * See RegisterDataIssue. OPTIONAL and, when present, empty on a healthy
   * response — mirrors the server's own back-compat reasoning: a caller that
   * does not read this field must not treat its absence as "known healthy",
   * only as "not stated". Non-empty means `total` (and any zero it renders
   * as) may be a hole, not a genuine count — see Sacks.tsx's History block.
   */
  dataIssues?: RegisterDataIssue[];
}

function registerParams(q: RegisterQuery): URLSearchParams {
  const p = new URLSearchParams();
  p.set('type', q.type);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.shift) p.set('shift', q.shift);
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
  if (q.batch) p.set('batch', q.batch);
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

/**
 * One selectable source generation, for a batch picker — the same key
 * `RegisterQuery.batch` and `GenerationTally.key` use. The route this
 * client function calls (`GET /api/data-batch`) does not exist yet; this is
 * the client contract only, added ahead of it so the picker component and
 * the route can be built independently.
 */
export interface DataBatch {
  key: string;
  ordinal: number | null;
  sourceDb: string | null;
  label: string | null;
  simulator: boolean;
  /** Rows of this generation within the queried window, when the server states one. */
  rows?: number;
}
export interface DataBatchData {
  batches: DataBatch[];
}
export function getDataBatch(from?: string, to?: string, fromShift?: string, toShift?: string): Promise<Envelope<DataBatchData>> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
  const qs = p.toString();
  return get(qs ? `/api/data-batch?${qs}` : '/api/data-batch');
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
  /**
   * Chart overhaul wave 3, Task T6 (29 Sep 2026, commit 962a18b on the API
   * side): the shift(s) this subgroup's readings fall in, so a chart drag
   * across subgroups can snap the WHOLE PAGE period to shift boundaries
   * (`lib/period.ts`'s `snapToShifts`) without re-deriving it from `ts` and
   * `bucketMinutes`. A subgroup straddling a shift boundary carries its
   * first and last shift separately; `snapToShifts(first-of-selection,
   * last-of-selection)` already widens outward across both. Optional only
   * because this file cannot assume every caller's fixture/mock data has
   * been updated for it in the same pass — the API always sends it.
   */
  firstShiftDate?: string;
  firstShiftCode?: 'morning' | 'evening' | 'night';
  lastShiftDate?: string;
  lastShiftCode?: 'morning' | 'evening' | 'night';
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
  /**
   * Why the chart is drawing NO limit band, Cp/Cpk or scale-vs-product
   * agreement: the limits on record post-date the period, so applying them
   * would judge these readings by a tolerance that did not exist when they
   * were taken (719fbee). Composed SERVER-side, in `spc.ts`
   * (`CHART_LIMITS_WITHHELD`) — not a `words.ts` key, like
   * `weightStations.ts`'s `targetOmittedReason` before it. Absent means
   * nothing was withheld; it never means "no reason given".
   */
  limitsOmittedReason?: string;
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
  /** Encoded ShiftRef bounds (lib/period.ts periodQuery). Harmless until the route reads them (T0, 28 Sep 2026). */
  fromShift?: string;
  toShift?: string;
}
export function getSpc(q: SpcQuery): Promise<Envelope<SpcData>> {
  const p = new URLSearchParams({ type: q.type, from: q.from, to: q.to });
  if (q.productId != null) p.set('productId', String(q.productId));
  if (q.usl != null) p.set('usl', String(q.usl));
  if (q.lsl != null) p.set('lsl', String(q.lsl));
  if (q.shift) p.set('shift', q.shift);
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
export function getCalibration(from: string, to: string, fromShift?: string, toShift?: string): Promise<Envelope<CalibrationData>> {
  const p = new URLSearchParams({ from, to });
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
  return get(`/api/calibration?${p.toString()}`);
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
export function getRejectSpc(
  from: string,
  to: string,
  rejectType: RejectTypeFilter,
  bucket?: RejectBucketSize,
  fromShift?: string,
  toShift?: string,
): Promise<Envelope<RejectSpcData>> {
  const p = new URLSearchParams({ from, to, rejectType });
  if (bucket) p.set('bucket', bucket);
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
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
  /**
   * The epoch's own generation number and simulator flag, joined from
   * `sms.source_epoch` — the same pair `GenerationTally`/`GenerationRef`
   * carry, so Health can print a batch name instead of the raw `epochLabel`
   * table-name string. Optional: absent on a server built before this field
   * (or when `epochId` is null, since there is nothing to join).
   */
  epochOrdinal?: number | null;
  epochSimulator?: boolean;
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
export interface DqFinding {
  /** sms.dq_finding.finding_id (Task W2-B, 29 Sep 2026) — what ackDqFinding acts on. */
  findingId: number;
  checkName: string;
  severity: string;
  subjectTable: string | null;
  detail: string | null;
  /**
   * The raw_id of the first offending row — only the row-scoped checks ever
   * carry one; the other five (source_columns_changed,
   * raw_read_without_write, transform_zero_write, product_mirror_failed,
   * transform_failed) describe a pass or a table as a whole and this is null
   * for them by construction. null means "do not offer a link", never
   * "the link is broken" — see getDqDestination.
   */
  subjectRef: number | null;
  /** Task W2-B: whether this check is on the acknowledgeable allow-list at
   *  all — a system-state finding never renders an Acknowledge control. */
  acknowledgeable: boolean;
  acknowledgedBy: string | null;
  acknowledgedUtc: string | null;
  acknowledgedReason: string | null;
}
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

/**
 * Where a DQ finding's offending row landed — cone/sack/reject and its
 * canonical id, so a screen can go straight to the reading. `table` is the
 * RAW table's short name (`cone_raw` | `sack_raw` | `reject_qcs_raw` |
 * `reject_weight_raw`), matching `DqFinding.subjectTable` for the checks
 * that carry a `subjectRef` at all — never call this when `subjectRef` is
 * null. Throws ApiError(404) when the ref no longer resolves to a canonical
 * row (rebuilt away since the finding was recorded) and ApiError(400) for an
 * unrecognised table. UX Phase 7 Brief 2 (rank 1); not yet wired to a
 * screen — see web/src/api.callers.test.ts's ALLOW_LIST.
 */
export interface DqDestination { type: 'cone' | 'sack' | 'reject'; id: number }
export function getDqDestination(table: string, ref: number): Promise<DqDestination> {
  const p = new URLSearchParams({ table, ref: String(ref) });
  return get(`/api/dq-destination?${p.toString()}`);
}

/**
 * Task W2-B (29 Sep 2026): acknowledge one standing DQ finding by its
 * finding_id, with a reason of at least 10 characters. Rank 2 (engineer) on
 * the server; refused 409 for a finding whose check is not on the
 * acknowledgeable allow-list, 404 for an unknown finding_id, 409 if it is
 * already acknowledged — see api/src/services/dqAck.ts.
 */
export function ackDqFinding(findingId: number, reason: string): Promise<{ findingId: number; acknowledgedUtc: string; reason: string }> {
  return post(`/api/dq-findings/${findingId}/ack`, { reason });
}

/**
 * Source generations (`sms.source_epoch`, open AND closed — /api/operations'
 * `schema` block only ever shows the open one per table), canonical rebuilds
 * (`sms.rebuild_audit`, which had no reader anywhere before this), and `sms
 * verify` runs (`sms.verify_run`, migration 039 — the record `sms verify`
 * itself now writes, so the app can finally say whether and against WHICH
 * source it has ever been reconciled). UX Phase 7 Brief 2 (rank 1); not yet
 * wired to a screen — see web/src/api.callers.test.ts's ALLOW_LIST.
 */
export interface SourceGeneration {
  epochId: number;
  sourceTable: string;
  label: string;
  generationOrdinal: number;
  provenance: string;
  sourceServer: string;
  sourceDb: string;
  firstSeenUtc: string;
  lastSeenUtc: string | null;
  closedUtc: string | null;
  registeredBy: string;
  archivedBelowId: number | null;
  archivedObservedUtc: string | null;
  rawRowCount: number;
}
export interface RebuildRun {
  rebuildId: number;
  snapshotId: string;
  fromTransformVersion: number;
  toTransformVersion: number;
  targetTable: string;
  rowsRebuilt: number;
  startedAtUtc: string;
  finishedAtUtc: string | null;
  outcome: string;
  initiatedBy: number | null;
  errorMessage: string | null;
}
export interface VerifyRun {
  verifyRunId: number;
  startedAtUtc: string;
  finishedAtUtc: string | null;
  sourceServer: string;
  sourceDb: string;
  appServer: string;
  appDb: string;
  lineId: number;
  stops: number;
  weightsChecked: boolean;
  windowFrom: string | null;
  windowTo: string | null;
  verdict: 'clean' | 'stops';
  summary: string | null;
  smsVersion: string | null;
}
export interface SystemHistoryData {
  generations: SourceGeneration[];
  rebuilds: RebuildRun[];
  verifyRuns: VerifyRun[];
}
export function getSystemHistory(): Promise<Envelope<SystemHistoryData>> {
  return get('/api/system-history');
}

// ---- live line state — polled by the floor screens and the wall display ----

/**
 * Which SOURCE GENERATION a live answer was read from, and what it left out.
 *
 * The plant dropped and recreated its four weighing tables on 2026-08-05
 * (D-11). Since 23 Sep 2026 the live screens read ONE generation — the
 * newest real one — so a figure is never a total across two physically
 * different tables. The cost is that the newest real generation can end
 * while rows keep arriving under another one, and then these screens go
 * quiet. `newerElsewhereUtc` is what lets them say WHY instead of reporting
 * a stopped line: null means nothing newer exists anywhere, which is the
 * ordinary case and the case in which no sentence should be printed.
 */
export interface LiveGenerationNote {
  generation: {
    key: string;
    ordinal: number;
    sourceDb: string | null;
    provenance: string | null;
    label: string | null;
    simulator: boolean;
  } | null;
  spansGenerations: boolean;
  otherGenerationExcluded: number;
  newerElsewhereUtc: string | null;
  newerElsewhereSourceDb: string | null;
  newerElsewhereLabel: string | null;
  newerElsewhereSimulator: boolean;
}

export type LineStatus = 'running' | 'stopped' | 'idle' | 'no_data';
export type LiveHealthKind = "ok" | "stale" | "late" | "lag_unknown" | "no_data";
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
  /** Which source generation every figure below came from. Always sent. */
  generation: LiveGenerationNote;
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
  /** Share of the group's sacks the SCALE passed. Null when none carried a verdict. */
  sacksPassedScalePct?: number | null;
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
  /** RT-018: PDAS's own MaterialActive as last mirrored — current status, no retirement date exists. Null/absent when there is no product, or an older fixture predates this field. */
  productActive?: boolean | null;
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
  fromShift?: string;
  toShift?: string;
  trailingDays?: number;
}): Promise<Envelope<AttentionData>> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.shift) p.set('shift', q.shift);
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
  /** Encoded ShiftRef bounds (lib/period.ts periodQuery) for the SELECTED
   *  period — periodFrom/periodTo's own shift-precise form, not the trailing
   *  detector window's. Harmless until the route reads them (T0, 28 Sep 2026). */
  periodFromShift?: string;
  periodToShift?: string;
}): Promise<Envelope<WeightStationsData>> {
  const p = new URLSearchParams();
  if (q.trailingDays) p.set('trailingDays', String(q.trailingDays));
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.periodFrom) p.set('periodFrom', q.periodFrom);
  if (q.periodTo) p.set('periodTo', q.periodTo);
  if (q.shift) p.set('shift', q.shift);
  if (q.periodFromShift) p.set('periodFromShift', q.periodFromShift);
  if (q.periodToShift) p.set('periodToShift', q.periodToShift);
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
  /** Encoded ShiftRef bounds (lib/period.ts periodQuery). Harmless until the route reads them (T0, 28 Sep 2026). */
  fromShift?: string;
  toShift?: string;
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
  if (f.fromShift) p.set('fromShift', f.fromShift);
  if (f.toShift) p.set('toShift', f.toShift);
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
  /** Task B (28 Sep 2026): the pair `batchName()` takes — see Provenance's own fields above for the full reasoning. */
  epochOrdinal: number | null;
  epochSimulator: boolean;
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
  acquisition: {
    kind: LiveHealthKind | null;
    ageSeconds: number | null;
    cadenceSeconds: number | null;
    halted: string[] | null;
    /** Which source generation the acquisition figures describe. Null for an
     *  anonymous caller, like the rest of this block. */
    generation: LiveGenerationNote | null;
  };
  backup: {
    dir: string;
    newestFile: string | null;
    newestAtUtc: string | null;
    ageDays: number | null;
    warning: boolean;
    /** Whether `newestFile` carries a matching, size-consistent verification marker written by scripts/backup-appdb.ps1. */
    verified: boolean;
    /** True when the physically-newest .bak in the directory failed verification and an older verified one was reported instead (or, if nothing verified exists, when the newest itself is unverified). */
    newestUnverified: boolean;
  } | null;
  degradedReason: string | null;
  /**
   * RT24-05: whether the PDAS write login can read back what it just wrote.
   * Null for an anonymous caller, like backup/acquisition above, and also
   * null on a server build that predates this field (an older cached
   * response, or a rolling deploy) — treat null the same as "unknown", never
   * as "off" or "fine".
   */
  pdasWrite: {
    enabled: boolean;
    /** Null when the permission probe could not run — writes disabled, or the probe itself failed. */
    canReadBack: boolean | null;
    missingSelect: string[];
    missingExecute: string[];
    /** Subject tables (e.g. 'blend', 'product', 'pallet') with a standing CRITICAL finding — see pdasWrite.ts. */
    unverifiedSinceStartup: string[];
    lastVerifiedUtc: string | null;
  } | null;
  /** Free disk space, MB, on the app-data and backup volumes. Null for an anonymous caller. */
  disk: { appDataFreeMb: number | null; backupFreeMb: number | null } | null;
  /** `sms.verify_run`'s newest `started_at_utc` — informational only, never folded into `status`. Null when nothing has run, the table predates migration 039, or the caller is anonymous. */
  lastVerifyRunUtc: string | null;
  /** The sync worker's own heartbeat — newest `sms.sync_run.finished_at_utc`, regardless of rows written. Distinct from `acquisition.ageSeconds`, which measures DATA age, not whether the recorder is still checking in. Null when anonymous or no pass has run yet. */
  workerLastPassUtc: string | null;
  /** Task W2-B (29 Sep 2026): count of ERROR/CRITICAL findings acknowledged — informational only, never folded into `status`. Null when anonymous or the database was unreachable; 0 means reachable and genuinely none acknowledged. */
  dqAcknowledged: number | null;
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
/**
 * Whether the product-tolerance half of `states` — 'within', 'low', 'high' —
 * was judged against limits whose START DATE this system knows, and the one
 * sentence to print if it was not (api coneState.ts `limitProvenance`).
 *
 * The sentence is composed SERVER-SIDE and printed verbatim, the same way
 * `resolvePeriodTarget`'s refusal reason is: only the service knows which
 * limits versions were actually consulted, and a screen wording its own
 * version of this would be free to drift from what was computed. That is
 * also why there is no entry for it in words.ts.
 */
export interface LimitProvenance {
  ok: boolean;
  assumedWindows: number;
  totalWindows: number;
  note: string | null;
}
export interface ProductionData {
  /** Cones per state over the same filters as `rows`; null unless the route computed it. */
  states: StateCounts | null;
  /** Readings the population rule excluded as implausible. */
  implausible: number | null;
  /**
   * Present whenever `states` is. OPTIONAL on the wire, so an older API or a
   * test fake that omits it does not break a screen — a missing value means
   * "not stated", never "the start dates are known".
   */
  limitProvenance?: LimitProvenance;
}

/**
 * WS-P (23 Sep 2026 red-team remediation) — both fields have been on the
 * wire since `production.ts`'s WS-P commit (71757a3); this merge only
 * teaches the client TYPE about them, the same idiom `states`/`implausible`
 * above used for Phase 4. No new request, no new route.
 */
export interface ProductionRow {
  /**
   * `rejectedCones` with no matching cone_event row — the reject-rate
   * DENOMINATOR addend (api/src/services/production.ts's field of the same
   * name). Most rejects ARE an existing cone_event row and are already
   * counted once in `cones`; adding every reject again double-counts those.
   * A consumer computing a rate must use `cones + unmatchedRejects`, never
   * `cones + rejectedCones` — see `toReportLine` (services/report.ts) and
   * Line.tsx's `periodFigures`, which now mirrors it so Line and Report can
   * never print two different rates for the same period. Optional: falls
   * back to `rejectedCones` where absent, exactly as the server's own
   * `toReportLine` does.
   */
  unmatchedRejects?: number;
}
/** Which numeric field a data issue is about — mirrors production.ts's own `ProductionField`. */
export type ProductionField =
  | 'cones' | 'conesInRangePct' | 'rejectedCones'
  | 'sacks' | 'sackWeightKg' | 'sacksPassedScalePct'
  | 'unattributed.cones' | 'unattributed.rejects'
  | 'implausible';
/**
 * One (field, group) that could not be read as a number from its source row
 * — a SQL row that came back with a COLUMN ABSENT, not SQL NULL and not a
 * real zero (production.ts's own header, WS-P). The affected field still
 * reads as its placeholder (0, or null where null already means "not
 * applicable") so the response shape is unchanged; THIS is what tells a
 * consumer the difference between a genuine zero and one that was never
 * read.
 */
export interface ProductionDataIssue {
  field: ProductionField;
  group: string | null;
  reason: string;
}
export interface ProductionData {
  /**
   * Always an array on the wire, empty when nothing was affected. See
   * `ProductionDataIssue`. Declared OPTIONAL here for the same reason
   * `limitProvenance?` above is — a required field would break every
   * hand-built `ProductionData` fake across the test suite that predates
   * this merge. A CONSUMER must read a missing array as "not stated", never
   * as "nothing was affected" — Line.tsx's own read defaults it to `[]`,
   * which is the correct fallback only because an absent array here means
   * an older fixture, never a real response (the route always sets it).
   */
  dataIssues?: ProductionDataIssue[];
}
export interface ProductAtData {
  /** The plausibility window the state was judged with (roadmap Phase 4). */
  plausibility?: { loG: number; hiG: number };
}
export interface ReportData {
  readings: { states: StateCounts; implausible: number } | null;
  shiftCheck: { compared: number; mismatched: number; mismatchPct: number; topHour: number | null; hours?: { hour: number; mismatched: number }[] } | null;
}
export interface LimitHistoryVersion {
  versionId: number;
  setpointG: number | null;
  offsetMinusG: number | null;
  offsetPlusG: number | null;
  /** App instant (genuine UTC) — kept for completeness; render "in force from" from effectiveFromPlant instead (fmtDay/fmtClock), never this with fmtAppInstant. */
  effectiveFromUtc: string;
  /** The same instant on the production-time convention (Two Clocks) — the one to render, with the UTC-pinned formatters. */
  effectiveFromPlant: string;
  effectiveIsLowerBound: boolean;
  source: 'pdas_observed' | 'sms_write' | 'sms_local';
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
/** Append an SMS-local limit version — never touches PDAS. Engineer rank (2). */
export function setLocalLimitVersion(p: {
  productId: number; setpointG: number; offsetMinusG: number; offsetPlusG: number; effectiveFrom?: string; reason?: string | null;
}): Promise<{ versionId: number; label: string | null; products: LimitHistoryProduct[] }> {
  return post('/api/products/limits/local', p);
}

/** Mirrors api/src/services/machinesRunning.ts's MachineState (Task #8, 24 Sep 2026). */
export type MachineState = 'running' | 'quiet' | 'stale' | 'silent';

export interface MachineRunning {
  station: number;
  stationName: string | null;
  machineName: string | null;
  materialId: number | null;
  productName: string | null;
  /** RT-018: PDAS's own MaterialActive as last mirrored — current state, no retirement timestamp exists. Null/absent when no material is running, or an older fixture predates this field. */
  productActive?: boolean | null;
  cones: number;
  conesOnMaterial: number;
  newestUtc: string | null;
  sinceUtc: string | null;
  sinceIsWindowStart: boolean;
  quiet: boolean;
  /** The newest reading EVER at this station (this generation), independent of the window. Null when never seen. */
  lastSeenUtc: string | null;
  state: MachineState;
}
export interface MachinesRunningData {
  asOfUtc: string | null;
  windowMs: number;
  windowStartUtc: string | null;
  machines: MachineRunning[];
  materialsRunning: number;
  /** Which generation the anchor and the window belong to. Always sent. */
  generation: LiveGenerationNote;
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
export function getShiftCheck(from: string, to: string, fromShift?: string, toShift?: string): Promise<Envelope<ShiftCheckData>> {
  const p = new URLSearchParams({ from, to });
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
  return get(`/api/shift-check?${p.toString()}`);
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
/** Rank 1 — a read of SMS's own canonical aggregates, no more sensitive than /api/production (0d8b74a lowered this from rank 3). */
export function getReconciliation(
  from: string,
  to: string,
  shift?: string | null,
  fromShift?: string,
  toShift?: string,
): Promise<Envelope<ReconciliationData>> {
  const p = new URLSearchParams({ from, to });
  if (shift) p.set('shift', shift);
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
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

/**
 * The source generation the X̄ chart is drawn from, and the X̄ band itself
 * (api/src/services/spc.ts, 23 Sep 2026). Declared here as a separate merged
 * block, the convention this file already uses, so nothing above changes.
 *
 *  - `generation` / `otherGenerationExcluded` / `spansGenerations`: every
 *    query behind an /api/spc payload is scoped to ONE physical generation of
 *    the source tables (IFL dropped and recreated theirs on 5 Aug 2026).
 *    Readings in the requested period that belong to another generation are
 *    excluded, not pooled — and the screen must SAY so, or it implies the
 *    period is fully represented when it is not.
 *  - `xLimits.valid`: false when there are too few time-contiguous subgroup
 *    pairs to estimate MR̄ from. The server then also forces every
 *    `Subgroup.xViolates` to false. Nothing may draw the band or its marks
 *    when this is false.
 */
export interface SpcData {
  generation: { epochId: number; ordinal: number; label: string | null; provenance: string | null } | null;
  otherGenerationExcluded: number;
  spansGenerations: boolean;
  xLimits: { valid: boolean; mrBar: number; sigmaBetween: number; halfWidth: number; pairs: number };
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
  /** 0 = already beyond the limit; null = not moving toward one, or status is 'not_established'. */
  daysToLimit: number | null;
  /**
   * RT-020 (25 Sep 2026): a 90% confidence range on daysToLimit, from the
   * OLS slope's own confidence interval — null under the same conditions as
   * daysToLimit, or when 'not_established'.
   */
  daysLow: number | null;
  daysHigh: number | null;
  confidence: 0.9;
  /** How many daily points the slope (and its CI) were fitted over. */
  nPoints: number;
  /** 'not_established' when the slope's 90% CI includes zero (or disagrees
   *  in sign with the point estimate) — a real trend cannot be stated at
   *  that confidence, so no day count or range is given. `reason` explains why. */
  status: 'established' | 'not_established';
  reason?: string;
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
  /**
   * Where this row's target came from (UX Phase 5 Brief 1, unit U2, 16 Sep
   * 2026): up to six materials can run concurrently on different machines
   * (Sep 2026 data), so the line-wide target used to be applied to every
   * station regardless of what it actually ran.
   *  - 'station_material': this station ran exactly one material in the
   *    window; the target is THAT material's own limits, in force at the
   *    window's end.
   *  - 'mixed': more than one material ran here in the window — there is no
   *    single honest target, so `vsTargetG` is null and `materialsInWindow`
   *    says how many it ran instead of a number that would silently average
   *    two products' tolerances.
   *  - 'line_product': every reading at this station carries no material_id
   *    (the July generation). Falls back to the line-wide Current Product
   *    timeline, exactly as coneState.ts does for the same readings.
   */
  targetBasis: 'station_material' | 'mixed' | 'line_product';
  /** Only set when `targetBasis` is 'mixed' — how many distinct materials this station ran in the window. */
  materialsInWindow?: number;
  /** RT-018: whether the material this row's target came from is retired in PDAS, as last mirrored. Null/absent when 'mixed', unknown, or an older fixture predates this field. */
  targetProductActive?: boolean | null;
  /**
   * F6 (23 Sep 2026), optional for the same reason as the data-level flags
   * above: absent reads as "not flagged". `targetIsLowerBound` means this
   * row's target came from a version the app merely OBSERVED in place, so its
   * instant is a lower bound; `targetAfterWindowEnd` means the version begins
   * AFTER the window ended, in which case the server has already set
   * `vsTargetG` to null and this flag is the REASON the cell is blank.
   */
  targetIsLowerBound?: boolean;
  targetAfterWindowEnd?: boolean;
}

export interface WeightStationsData {
  limits: { loG: number; hiG: number } | null;
  rules: NelsonRuleInfo[];
  /** When the line-wide target (above) was last recorded (genuine UTC — fmtAppInstant). */
  targetEffectiveFromUtc: string | null;
  /**
   * THE FOUR FIELDS BELOW ARE OPTIONAL ON PURPOSE (F6, 23 Sep 2026). The
   * server always sends them; they are declared optional so a screen reads
   * them defensively and so the existing typed fixtures — several of them in
   * files this change does not own — keep compiling without being rewritten
   * to restate facts they are not testing. Absent is read as "not flagged",
   * which is the same thing an older payload meant.
   *
   * `targetEffectiveFromUtc` is a LOWER BOUND when this is true: the limits
   * were in place NO LATER THAN that instant. Print it as "no later than …",
   * never as a start date. Product › Catalogue already renders this case.
   */
  targetEffectiveIsLowerBound?: boolean;
  /**
   * The resolved version BEGINS AFTER the period ended — limits that
   * demonstrably did not exist while these readings were taken. When this is
   * true the server has ALREADY withheld `targetG` and every row's
   * `vsTargetG`; `targetOmittedReason` below is the sentence to print in
   * their place, so a screen never has to decide this for itself.
   */
  targetEffectiveAfterWindowEnd?: boolean;
  /** Why no target is stated, in words, from the server's one resolver. Null/absent when a target IS stated, or when there was simply no product. */
  targetOmittedReason?: string | null;
  /** How many station rows had their `vsTargetG` withheld for that reason. */
  stationsWithTargetWithheld?: number;
  /** How many times the line-wide product's own limits changed inside the window (a version that BEGAN inside it). Null when there is no line-wide product at all. */
  limitsChangedInWindow: number | null;
  /** How many times the line-wide Current Product itself changed inside the window (a new product_timeline entry, not just a limits revision). */
  productChangesInWindow: number;
  /** RT-018: the line-wide target's own retired flag, PDAS's MaterialActive as last mirrored. Optional/absent for the same reason as the other F6-style flags above — older fixtures keep compiling. */
  productActive?: boolean | null;
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
export function listAdjustments(
  q: { from?: string; to?: string; fromShift?: string; toShift?: string; station?: number | null } = {},
): Promise<AdjustmentList> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
  /** Encoded ShiftRef bounds (lib/period.ts periodQuery). Harmless until the route reads them (T0, 28 Sep 2026). */
  fromShift?: string;
  toShift?: string;
  tsTo?: string;
  product?: number;
}
export function getSackSummary(q: SackSummaryQuery): Promise<Envelope<SackSummaryData>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.shift) p.set('shift', q.shift);
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
  /** First production day the balance counts weighed sacks from (verification 25 Sep 2026, K8). */
  countedSinceDay?: string | null;
  /** Manual movement rows (opening counts, issues, consumption, adjustments) up to the period end. */
  manualMovementRows?: number;
}
export function getSackStock(
  q: { from: string; to: string; fromShift?: string; toShift?: string; product?: number; tsTo?: string },
): Promise<Envelope<StockLedgerData>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
export function getSackMovements(
  from: string,
  to: string,
  product?: number,
  fromShift?: string,
  toShift?: string,
): Promise<Envelope<SackMovementsData>> {
  const p = new URLSearchParams({ from, to });
  if (product != null) p.set('product', String(product));
  if (fromShift) p.set('fromShift', fromShift);
  if (toShift) p.set('toShift', toShift);
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
//
// The tenth type — product by machine and shift — added on IFL's answer of
// 15 Sep 2026 to Q28. Registered LAST, matching the server's order in
// api/src/services/reports/common.ts REPORT_TYPES, so the nine existing
// CSV/RBAC pins hold.

export type ReportType =
  | 'daily' | 'shift' | 'product' | 'station' | 'reject' | 'cone-weight' | 'sack' | 'calibration' | 'management-summary'
  | 'machine-product';
export const REPORT_TYPES: readonly ReportType[] = [
  'daily', 'shift', 'product', 'station', 'reject', 'cone-weight', 'sack', 'calibration', 'management-summary',
  'machine-product',
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
  /** F-07 (Task W2-C, 29 Sep 2026): the shift-derivation caveat, server-composed (common.ts's SHIFT_SOURCE_NOTE). Optional for the same back-compat reason as generationLine — a server built before this field simply omits it. */
  shiftNote?: string;
  /** RT24-03 (24 Sep 2026): whether this report's period crosses IFL's 2026-08-05 rebuild boundary and a source generation had to be excluded. */
  spansGenerations: boolean;
  sourceGeneration: string | null;
  otherGenerationExcluded: { count: number; percent: number | null; simulator?: number } | null;
  /** Server-composed disclosure sentence; names simulator data as the plant simulator (verification 25 Sep 2026). */
  generationLine?: string | null;
  /** True when `sourceGeneration` names a plant-simulator generation. Optional: absent on a server built before this field, never itself a claim of "no". */
  simulatorSource?: boolean;
}

export interface ReportQuery {
  period?: ReportPeriod;
  anchor?: string;
  from?: string;
  to?: string;
  shift?: string | null;
  /** Encoded ShiftRef bounds (lib/period.ts periodQuery). Harmless until the route reads them (T0, 28 Sep 2026). */
  fromShift?: string;
  toShift?: string;
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
  if (q.fromShift) p.set('fromShift', q.fromShift);
  if (q.toShift) p.set('toShift', q.toShift);
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
  /**
   * UX Phase 5 Brief 1, unit U3 (16 Sep 2026): this product's own limits, in
   * force at the period's end. Null for the NO_PRODUCT_GROUP row and for a
   * product whose version carries no usable limits — never a borrowed
   * line-wide or current-mirror number.
   */
  target: { setpointG: number; loG: number; hiG: number; inForceAtUtc: string; limitsChangedInPeriod: number } | null;
  /** Signed grams of this row's own mean weight against its own target; null when `target` is null or the mean is unknown. */
  vsTargetG: number | null;
  /** RT-018: PDAS's own MaterialActive as last mirrored. Null/absent for the "No product on the reading" row, or an older fixture. */
  productActive?: boolean | null;
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
  /** RT-018: the line-wide target's own retired flag. Null/absent when there was no target, or an older fixture. */
  productActive?: boolean | null;
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
  /** Above the upper limit. */
  outOfControl: boolean;
  /** Below the lower limit (an unusually good day). Absent on older payloads. */
  belowLower?: boolean;
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
  /** BUG FIX (UX Phase 5 Brief 2, 16 Sep 2026): the server relays `w.basis` from getWeights,
   * which is the full Basis union, not the single literal this field used to carry. */
  basis: Basis;
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
  /**
   * UX Phase 5 Brief 1, unit U1 (16 Sep 2026): the ONE target this report
   * prints, taken from the same resolution the station table below uses —
   * the line-wide product IN FORCE AT THE PERIOD'S END — never today's
   * current product applied backwards over the whole period. `source` is
   * 'none', never a fabricated number, when nothing was in force.
   */
  target: {
    setpointG: number | null;
    productId: number | null;
    label: string | null;
    /** When this target began applying (genuine UTC — fmtAppInstant). */
    inForceAtUtc: string | null;
    /** How many times this target's own limits changed inside the period. */
    limitsChangedInPeriod: number;
    /**
     * `inForceAtUtc` is the EARLIEST this target can be shown to have
     * applied, not necessarily when it began: all 14 rows of
     * `sms.product_limit_version` are migration-027 bootstraps stamped
     * 2026-09-11, so SMS holds no record of what was in force in August
     * (719fbee).
     */
    inForceIsLowerBound?: boolean;
    /** Why no target is stated, composed server-side. Null = nothing omitted. */
    omittedReason?: string | null;
    source: 'in_force_at_period_end' | 'none';
    /** RT-018: PDAS's own MaterialActive as last mirrored. Null/absent when no target is stated, or an older fixture. */
    productActive?: boolean | null;
  };
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
  /** Production days in the period; the drift rule cannot fire when fewer than minDaysHeld. */
  periodDays?: number;
  driftRuleCanFire?: boolean;
  targetOmittedReason?: string | null;
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
  /**
   * UX Phase 5 Brief 1, unit U5 (16 Sep 2026): whether `delta` is safe to
   * read as a trend. False for a count-shaped KPI when the two periods'
   * coverage differs materially (the record's 10 Jul - 5 Aug hole) — the
   * delta would measure the coverage gap, not a change in production.
   */
  comparable: boolean;
  /** Why `comparable` is false, printed rather than left for the reader to guess; null when comparable. */
  incomparableReason: string | null;
  approval: 'awaiting';
}

/** One product's share of a period, for the product-mix comparison on the summary. */
export interface ProductMixRow {
  /** material_id, or null for readings that predate product recording. */
  productId: number | null;
  label: string;
  cones: number;
  /** RT-018: PDAS's own MaterialActive as last mirrored. Null/absent for the "No product on the reading" row, or an older fixture. */
  productActive?: boolean | null;
}

export interface ManagementSummaryData {
  period: ReportData['period'];
  prior: { from: string; to: string };
  coverage: { current: ReportData['coverage']; prior: ReportData['coverage'] };
  kpis: KpiRow[];
  /** Which products each period actually ran (UX Phase 5 Brief 1, unit U5) — a KPI marked comparable can still be comparing different products. */
  productMix: { current: ProductMixRow[]; prior: ProductMixRow[] };
  verdict: { cones: number; sacks: number; sackWeightKg: number };
  approval: 'awaiting';
  note: string;
}

/*
 * Product by machine and shift — mirrors api/src/services/reports/
 * machineProduct.ts MachineProductReportData exactly (field for field: no
 * `totals` or `coverage` block exists on the server's response — the
 * per-product rollup is `products`, and there is no coverage block at all,
 * unlike the other nine types).
 */
export interface ShiftMaterial {
  /** material_id from the reading; null when the reading predates product recording (before 2026-08-05). */
  materialId: number | null;
  productName: string | null;
  cones: number;
  /** Plant wall clock labelled UTC, like every production time — fmtClock, never fmtAppInstant. */
  firstUtc: string;
  lastUtc: string;
}
export interface MachineShiftCell {
  station: number;
  stationName: string | null;
  machineName: string | null;
  day: string;
  shift: 'morning' | 'evening' | 'night';
  /** In order of first reading: materials[0] started the shift, materials[at(-1)] ended it. */
  materials: ShiftMaterial[];
  dominantMaterialId: number | null;
  cones: number;
  changedDuringShift: boolean;
}
export interface MachineProductColumn {
  day: string;
  shift: 'morning' | 'evening' | 'night';
  /** Cones across every machine in this day × shift. */
  cones: number;
}
export interface MachineProductRow {
  station: number;
  stationName: string | null;
  machineName: string | null;
  /** Indexed like `columns`; null where the machine weighed nothing (absence, not zero). */
  cells: (MachineShiftCell | null)[];
  cones: number;
  /** Distinct materials this machine ran in the period. */
  materials: number;
}
export interface MachineProductChange {
  station: number;
  machineName: string | null;
  /** The day and shift the NEW material was first read in. */
  day: string;
  shift: 'morning' | 'evening' | 'night';
  fromMaterialId: number | null;
  fromProductName: string | null;
  toMaterialId: number | null;
  toProductName: string | null;
  /** First reading of the new material at this station. */
  firstUtc: string;
  kind: 'within_shift' | 'between_shifts';
}
export interface MachineProductTotal {
  materialId: number | null;
  label: string;
  cones: number;
  /** Machines that ran it at least once in the period. */
  machines: number;
  /** (machine, day, shift) cells it appears in. */
  cells: number;
  firstUtc: string;
  lastUtc: string;
}
export interface MachineProductReportData {
  period: ReportData['period'];
  filters: ReportFilters;
  columns: MachineProductColumn[];
  rows: MachineProductRow[];
  changes: MachineProductChange[];
  products: MachineProductTotal[];
  /** materialId → the label the report prints (unique names plain, shared names with the id appended). */
  labels: Record<string, string>;
  conesWithoutStation: number;
  /** Machines that weighed at least one cone (rows also hold idle roster machines). Absent on older payloads. */
  machinesWeighing?: number;
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
  'machine-product': MachineProductReportData;
}

export interface ReportResponse<T extends ReportType> {
  header: ReportHeader;
  report: ReportDataByType[T];
}

/** One composed report. Rank 1; the management summary rank 3. */
export function getReportOf<T extends ReportType>(type: T, q: ReportQuery): Promise<Envelope<ReportResponse<T>>> {
  return get(`/api/reports/${type}?${reportParams(q).toString()}`);
}

/**
 * The export's address — rank 3 on the server, audited `export.csv` /
 * `export.xlsx` / `export.pdf`. A link, so the browser downloads it. `format`
 * defaults to `csv` and is omitted from the URL in that case, matching the
 * server's own default (`exportQuery` in routes/reports.ts) so existing CSV
 * links are unchanged byte-for-byte.
 */
export function reportExportUrl(type: ReportType, q: ReportQuery, format?: 'csv' | 'xlsx' | 'pdf'): string {
  const p = reportParams(q);
  if (format && format !== 'csv') p.set('format', format);
  return `/api/reports/${type}/export?${p.toString()}`;
}

/**
 * The print header on its own, for the register's Print button. `type` and
 * `batch` are optional and additive: the server's route defaults `type` to
 * `'daily'`/`'register'` and `batch` to the default generation, exactly as
 * before, when either is omitted.
 */
export function getReportHeader(q: { from?: string; to?: string; at?: string | null; type?: ReportType; batch?: string }): Promise<{ header: ReportHeader }> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.at) p.set('at', q.at);
  if (q.type) p.set('type', q.type);
  if (q.batch) p.set('batch', q.batch);
  const qs = p.toString();
  return get(qs ? `/api/reports/header?${qs}` : '/api/reports/header');
}

// ---- UX Phase 6 Brief 2: the changeover workflow ----
// Appended, not edited in place (the three-agent collision rule). Mirrors
// api/src/services/changeover.ts:100-147 exactly — the same plan/outcome
// shape the server computes, so Changeover.tsx renders it rather than
// re-deriving it. routes/changeover.ts: refs and plan are rank 1 (never open
// the PDAS writer pool — the dry run works with PDAS_WRITE_ENABLED=false);
// execute is rank 2 and answers 503 `code:'DISABLED'` or 409 `code:'BLOCKED'`
// on refusal, both surfaced here as a thrown ApiError (status 503/409,
// message = the server's own `error` string) rather than a resolved value —
// executeChangeover() below only ever resolves on a 200/207 body, which is
// the one thing allowed to say a write happened (CLAUDE.md, this brief).

/** GET /api/changeover/refs response — the form's pickers, read from the sidecar mirror. */
export interface ChangeoverRefs {
  blends: { id: number; name: string }[];
  counts: { id: number; name: string }[];
  // tubeForm added (migration 041): AddTubeType's own duplicate check is name
  // AND form together, so the picker shows form beside each tube type; null
  // = the reference mirror has not yet recorded this row's form.
  tubeTypes: { id: number; name: string; tubeWeightG: number | null; tubeForm: number | null }[];
  packSchemas: { packSchemaId: number; description: string | null; conesPerLayer: number | null; packTypeId: number | null }[];
  /** Already filtered to active pallets by the server (routes/changeover.ts). */
  pallets: {
    palletId: number; productId: number; productLabel: string | null;
    packSchemaId: number | null; packSchemaLabel: string | null; lot: string | null;
    active: boolean | null; sackColour: string | null;
    labelType: number | null; steamProg: number | null; routing: number | null; pdasCreatedAt: string | null;
  }[];
}
export function getChangeoverRefs(): Promise<ChangeoverRefs> {
  return get('/api/changeover/refs');
}

/** Mirrors routes/changeover.ts's changeoverBody / services/changeover.ts's ChangeoverRequest exactly. */
export type ChangeoverRefChoice = { id: number } | { name: string };
export type ChangeoverTubeChoice = { id: number } | { name: string; tubeWeightG: number; tubeForm?: 1 | 2 };
export interface ChangeoverRequestBody {
  blend: ChangeoverRefChoice;
  count: ChangeoverRefChoice;
  tubeType: ChangeoverTubeChoice;
  material: { setpointG: number; offsetMinusG: number; offsetPlusG: number; lot: string; ppColour: string | null };
  pallet: { packSchemaId: number; lot: string | null; sackColour: string | null };
  retire: { productIds: number[]; palletIds: number[] };
  reason: string;
}

export type ChangeoverStepKind = 'blend' | 'count' | 'tube_type' | 'material' | 'pallet' | 'retire_material' | 'retire_pallet';
export type ChangeoverStepAction = 'reuse' | 'add' | 'create' | 'retire';
/** services/changeover.ts's PlanStep, verbatim. */
export interface ChangeoverPlanStep {
  step: ChangeoverStepKind;
  action: ChangeoverStepAction;
  /** The vendor procedure this step executes; null when nothing is written (reuse). */
  proc: string | null;
  label: string;
  id: number | null;
  detail: Record<string, string | number | boolean | null>;
}

/** services/changeover.ts:104-123, verbatim — the dry-run response. */
export interface ChangeoverPlan {
  writesEnabled: boolean;
  /** Null when writesEnabled is true. Print verbatim — never a hardcoded sentence. */
  disabledReason: string | null;
  steps: ChangeoverPlanStep[];
  /** Empty = the plan can run. */
  blockers: string[];
  warnings: string[];
  /** Printed verbatim. */
  noRollback: string;
  limits: { setpointG: number; offsetMinusG: number; offsetPlusG: number; label: string };
  /** Always false: a changeover never selects anything on a machine (CLAUDE.md). */
  reachesMachine: false;
  /** Printed verbatim. */
  operatorNote: string;
}

/** POST /api/changeover/plan — rank 1. Never opens the PDAS writer pool, so it works with PDAS_WRITE_ENABLED=false. */
export function planChangeover(body: ChangeoverRequestBody): Promise<ChangeoverPlan> {
  return post('/api/changeover/plan', body);
}

export interface ChangeoverStepDone extends ChangeoverPlanStep {
  /** The id PDAS allocated (or confirmed, on reuse). */
  resultId: number;
}
export interface ChangeoverStepFailed extends ChangeoverPlanStep {
  error: { code: 'DISABLED' | 'CONFLICT' | 'IMPLAUSIBLE' | 'NOT_FOUND' | 'PDAS_ERROR' | 'ERROR'; message: string; pdasErrorCode: number | null };
}
/** services/changeover.ts:139-147, verbatim — the outcome of a run that actually reached PDAS (200 ok / 207 partial). */
export interface ChangeoverOutcome {
  ok: boolean;
  done: ChangeoverStepDone[];
  failed: ChangeoverStepFailed | null;
  notDone: ChangeoverPlanStep[];
  materialId: number | null;
  palletId: number | null;
  noRollback: string;
}

/**
 * POST /api/changeover/execute — rank 2 server-side. A refusal (the flag is
 * off, or the flag is on but the plan has blockers) is a 503/409 response,
 * which `post()` turns into a thrown `ApiError` (status 503 or 409, message
 * = the server's `error` field verbatim) rather than a resolved value — this
 * function only ever resolves on 200 (`ok`) or 207 (partial, `NO_ROLLBACK`
 * applies). Callers must catch and read `ApiError.status`/`.message`; there
 * is no other way to learn a refusal reason, and none should be invented.
 */
export function executeChangeover(body: ChangeoverRequestBody): Promise<ChangeoverOutcome> {
  return post('/api/changeover/execute', body);
}

// ---- UX Phase 6 Brief 3: the product-change trail ----
/**
 * services/productChanges.ts's ProductChangeEntry, verbatim. `changedAtUtc`
 * and `effectiveFromUtc` are APP-WRITTEN instants (genuine UTC) — render with
 * `fmtAppInstant`, never a plant-clock formatter (CLAUDE.md's two clocks).
 */
export interface ProductChangeEntry {
  changeId: number;
  productId: number | null;
  palletId: number | null;
  procName: string | null;
  operation: string;
  outcome: string;
  pdasErrorCode: number | null;
  message: string | null;
  reason: string | null;
  changedByName: string | null;
  changedAtUtc: string;
  effectiveFromUtc: string | null;
}
/** GET /api/product-changes — rank 1. One keyset page; pass `nextBefore` back to walk older, same idiom as adminGetAuditPage. */
export function getProductChanges(before: number | null, limit = 40): Promise<{ entries: ProductChangeEntry[]; nextBefore: number | null }> {
  const p = new URLSearchParams();
  if (before != null) p.set('before', String(before));
  p.set('limit', String(limit));
  return get(`/api/product-changes?${p.toString()}`);
}
