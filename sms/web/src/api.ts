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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    handleStatus(res, path);
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
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
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---- auth ----
export interface AuthUser { username: string; displayName: string | null; role: string; }
export const ROLE_RANK: Record<string, number> = { operator: 1, supervisor: 2, manager: 3, admin: 4 };

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
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---- admin ----
export interface AdminUser { userId: number; username: string; displayName: string | null; role: string; active: boolean; createdAtUtc: string; }
export interface StationRow { stationId: number; name: string | null; machine: string | null; description: string | null; }
export interface Rules {
  weight: { basis: string; coneTubeWeightG: number; sackTareKg: number } | null;
  shift: { morningStart: string; eveningStart: string; nightStart: string; mode: string; nightBelongsTo: string } | null;
}
export function adminListUsers(): Promise<{ users: AdminUser[] }> { return get('/api/admin/users'); }
export function adminCreateUser(u: { username: string; password: string; role: string; displayName?: string }): Promise<{ ok: boolean }> { return post('/api/admin/users', u); }
export function adminUpdateUser(id: number, patch: { active?: boolean; role?: string }): Promise<{ ok: boolean }> { return send('PATCH', `/api/admin/users/${id}`, patch); }
export function adminListStations(): Promise<{ stations: StationRow[] }> { return get('/api/admin/stations'); }
export function adminSetStation(id: number, s: { name: string | null; machine: string | null; description: string | null }): Promise<{ ok: boolean }> { return send('PUT', `/api/admin/stations/${id}`, s); }
export function adminGetRules(): Promise<Rules> { return get('/api/admin/rules'); }
export function adminSetWeightRule(r: { basis: string; coneTubeWeightG: number; sackTareKg: number; reason?: string }): Promise<{ ok: boolean }> { return post('/api/admin/rules/weight', r); }
export function adminSetShiftRule(r: { mode: string; nightBelongsTo: string; reason?: string }): Promise<{ ok: boolean; note?: string }> { return post('/api/admin/rules/shift', r); }

// ---- current product (Q1) ----
export interface ProductOption { productId: number; description: string | null; lotCode: string | null; setpointG: number | null; }
export interface TimelineEntry {
  timelineId: number; productId: number; productLabel: string;
  effectiveFrom: string; changedAt: string; changedBy: string | null; reason: string | null;
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

export function getRange(): Promise<{ minDate: string | null; maxDate: string | null }> {
  return get('/api/range');
}

export interface ShiftCount {
  shift: string;
  cones: number;
}
export interface ShiftAnalysisData {
  corrected: ShiftCount[];
  legacy: ShiftCount[];
  mismatch: { differing: number; total: number; pct: number };
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
export interface Outlier { weight: number; shiftDate: string | null; sourceRowId: number | null; }
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

export function getShiftAnalysis(from?: string, to?: string): Promise<Envelope<ShiftAnalysisData>> {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  return get(`/api/shift-analysis?${p.toString()}`);
}

export function getProduction(q: ProductionQuery): Promise<Envelope<ProductionData>> {
  const p = new URLSearchParams();
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.shift) p.set('shift', q.shift);
  if (q.station != null) p.set('station', String(q.station));
  p.set('groupBy', q.groupBy ?? 'none');
  return get(`/api/production?${p.toString()}`);
}

// ---- Sack & Cone Register ----
export type RegisterType = 'cone' | 'sack';
export type RegisterSort = 'time' | 'weight';

export interface RegisterQuery {
  type: RegisterType;
  from?: string;
  to?: string;
  shift?: string;
  station?: number;
  inRange?: boolean;
  wMin?: number;
  wMax?: number;
  tsFrom?: string;
  tsTo?: string;
  sort?: RegisterSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface RegisterRow {
  source_row_id: string | number;
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
  if (q.wMin != null) p.set('wMin', String(q.wMin));
  if (q.wMax != null) p.set('wMax', String(q.wMax));
  if (q.tsFrom) p.set('tsFrom', q.tsFrom);
  if (q.tsTo) p.set('tsTo', q.tsTo);
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

export interface StoppagePatternData {
  from: string;
  to: string;
  thresholdSeconds: number;
  dayCount: number;
  stoppages: Stoppage[];
}
export function getStoppagePatterns(from: string, to: string, thresholdSeconds: number): Promise<Envelope<StoppagePatternData>> {
  const p = new URLSearchParams({ from, to, thresholdSeconds: String(thresholdSeconds) });
  return get(`/api/stoppage-patterns?${p.toString()}`);
}

// ---- Weight SPC ----
export type SpcType = 'cone' | 'sack';
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
}
export interface SpcData {
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
  return get(`/api/spc?${p.toString()}`);
}

// ---- Reject control chart (p-chart) ----
export type RejectBucketSize = 'hour' | 'day';
export type RejectTypeFilter = 'all' | 'quality' | 'weight';
export interface RejectBucket {
  bucketTs: string;
  produced: number;
  rejects: number;
  rate: number | null;
  ucl: number | null;
  lcl: number | null;
  outOfControl: boolean;
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
  pBar: number | null;
  outOfControlCount: number;
  buckets: RejectBucket[];
  episodes: RejectEpisode[];
}
export function getRejectSpc(from: string, to: string, rejectType: RejectTypeFilter, bucket?: RejectBucketSize): Promise<Envelope<RejectSpcData>> {
  const p = new URLSearchParams({ from, to, rejectType });
  if (bucket) p.set('bucket', bucket);
  return get(`/api/reject-spc?${p.toString()}`);
}

// ---- Inferred OEE ----
export interface OeeData {
  from: string;
  to: string;
  thresholdSeconds: number;
  plannedHoursPerDay: number;
  plannedSeconds: number;
  downSeconds: number;
  runSeconds: number;
  availabilityPct: number;
  idealCycleSeconds: number;
  idealCycleSource: 'inferred' | 'manual';
  producedCount: number;
  rejectedCount: number;
  performancePct: number;
  qualityPct: number;
  oeePct: number;
  stoppageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  headGapSeconds: number;
  tailGapSeconds: number;
  possiblyPartial: boolean;
}
export interface OeeQuery {
  from: string;
  to: string;
  thresholdSeconds?: number;
  plannedHoursPerDay?: number;
  idealCycleSeconds?: number;
  shift?: string;
}
export function getOee(q: OeeQuery): Promise<Envelope<OeeData>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.thresholdSeconds != null) p.set('thresholdSeconds', String(q.thresholdSeconds));
  if (q.plannedHoursPerDay != null) p.set('plannedHoursPerDay', String(q.plannedHoursPerDay));
  if (q.idealCycleSeconds != null) p.set('idealCycleSeconds', String(q.idealCycleSeconds));
  if (q.shift) p.set('shift', q.shift);
  return get(`/api/oee?${p.toString()}`);
}
