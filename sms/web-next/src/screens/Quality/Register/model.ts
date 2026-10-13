/**
 * Pure rules for Quality > Register (task E8). TRACE A3-051, A3-052, A3-053, A6-07..A6-10, A6-17, A6-H04, A6-H06, A6-H10.
 *
 * URL keys (IA-MAP): rl listing (cones default | sacks | rejected | inspectionRejects | stock), rf the hop filter
 * (outsideLimits | inspectionRejects), rcs cone check results (comma list), rp how many pages are shown
 * (replace, not push), st station, pr product, su ledger unit. Everything else belongs to the shell.
 */
import { CONE_STATES, type ConeState, type RegisterQuery, type RegisterType } from '../../../bridge/api';
import { period as P } from '../../../bridge/lib';
import { fmt } from '../../../bridge/lib';
import type { Route } from '../../../route';
import { R } from './registerCopy';

export const LISTINGS = ['cones', 'sacks', 'rejected', 'inspectionRejects', 'stock'] as const;
export type Listing = (typeof LISTINGS)[number];
export type HopFilter = 'outsideLimits' | 'inspectionRejects' | null;

export const PAGE_SIZE = 100;
/** The most pages one list will show at once (5,000 rows); past it the reader narrows the period. */
export const MAX_PAGES = 50;

export const isListing = (v: string | undefined): v is Listing => !!v && (LISTINGS as readonly string[]).includes(v);

export function parseFilter(keys: Record<string, string>): HopFilter {
  const v = keys.rf;
  return v === 'outsideLimits' || v === 'inspectionRejects' ? v : null;
}

/** rl wins; with no rl, the inspection hop (rf) seeds its listing; otherwise cones. */
export function parseListing(keys: Record<string, string>): Listing {
  if (isListing(keys.rl)) return keys.rl;
  return parseFilter(keys) === 'inspectionRejects' ? 'inspectionRejects' : 'cones';
}

export function parseStates(keys: Record<string, string>): ConeState[] {
  if (!keys.rcs) return [];
  return keys.rcs.split(',').filter((x): x is ConeState => (CONE_STATES as readonly string[]).includes(x));
}

export function parsePages(keys: Record<string, string>): number {
  const n = keys.rp && /^\d{1,3}$/.test(keys.rp) ? Number(keys.rp) : 1;
  return Math.min(MAX_PAGES, Math.max(1, n));
}

export const intKey = (v: string | undefined): number | null => (v !== undefined && /^\d{1,9}$/.test(v) ? Number(v) : null);

export const rowType = (l: Listing): RegisterType => (l === 'sacks' ? 'sack' : l === 'inspectionRejects' ? 'reject' : 'cone');

export interface QueryOptions {
  station: number | null;
  product: number | null;
  states: ConeState[];
  outsideOnly: boolean;
  pages?: number;
  page?: number;
  batch?: string;
}

/** What each listing asks the register for. The weight-check fails are the scale's own bit (in_range = 0); the inspection fails are a different table. */
export function buildQuery(listing: Listing, period: P.Period, o: QueryOptions): RegisterQuery {
  const type = rowType(listing === 'stock' ? 'sacks' : listing);
  const pq = P.periodQuery(period);
  const q: RegisterQuery = {
    type,
    from: period.from,
    to: period.to,
    shift: period.shift,
    fromShift: pq.fromShift,
    toShift: pq.toShift,
    tsFrom: period.tsFrom,
    tsTo: period.tsTo,
    page: o.page ?? 1,
    pageSize: PAGE_SIZE,
    sort: 'time',
    dir: 'desc',
    batch: o.batch ?? 'auto',
  };
  if (listing === 'rejected') q.inRange = false;
  if (type !== 'sack') {
    if (o.station !== null) q.station = o.station;
    if (o.product !== null) q.product = o.product;
  }
  if (type === 'cone') {
    const wanted: ConeState[] = o.outsideOnly ? ['low', 'high'] : o.states;
    if (wanted.length > 0) q.state = wanted;
  }
  return q;
}

/** A stable string for the polling key. */
export function periodSig(p: P.Period): string {
  const q = P.periodQuery(p);
  return [p.key, p.from, p.to, p.shift ?? '', q.fromShift ?? '', q.toShift ?? ''].join('|');
}

/* ------------------------------------------------------------ the count */

/** One of the headline's counts. A count that has not arrived is 'pending', never 0. */
export type CountState = { kind: 'ok'; n: number } | { kind: 'pending' } | { kind: 'failed' };

export function countStateOf(error: string | null, n: number | undefined): CountState {
  if (n !== undefined && n !== null) return { kind: 'ok', n };
  return error ? { kind: 'failed' } : { kind: 'pending' };
}

const nf = (n: number): string => fmt.fmtInt(n);

export function periodWords(p: P.Period): string {
  if (p.shift || p.fromShift || p.toShift) return P.describePeriod(p);
  return p.from === p.to ? fmt.fmtDayLong(p.from) : `${p.from} to ${p.to}`;
}

export interface CountLineInput {
  what: string;
  listing: Listing;
  total: CountState;
  weightFails: CountState;
  outsideOnly: boolean;
  states: ConeState[];
}

/** The headline sentence. The "N weighed, M failed" form is reachable only when BOTH counts are real. */
export function countLine(i: CountLineInput): string {
  const { what, listing, total, weightFails } = i;
  if (total.kind === 'failed') return R.countFailed;
  if (total.kind === 'pending') return R.countPending(what);
  if (listing === 'sacks') return R.sacksWeighed(what, nf(total.n));
  if (listing === 'inspectionRejects') return R.inspectionFails(what, nf(total.n));
  if (listing === 'rejected') return R.weightFails(what, nf(total.n));
  if (i.outsideOnly) return R.outsideLimits(what, nf(total.n));
  if (i.states.length > 0) return R.filteredCones(what, nf(total.n), i.states.map((s) => R.states[s].toLowerCase()).join(' or '));
  if (weightFails.kind === 'failed') return R.weightFailsUnknown(what, nf(total.n));
  if (weightFails.kind === 'pending') return R.weightFailsPending(what, nf(total.n));
  return R.weightFailsNoRate(what, nf(total.n), nf(weightFails.n));
}

/* ------------------------------------------------------------ route edits */

const LEFT_ON_LISTING_CHANGE = ['rp', 'rcs', 'rf'] as const;

function without(keys: Record<string, string>, drop: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(keys).filter(([k]) => !drop.includes(k)));
}

/** Switch listing: the page, the cone check results and any hop filter go; period, station and product stay. */
export function withListing(route: Route, l: Listing): Route {
  const keys = without(route.keys, LEFT_ON_LISTING_CHANGE);
  if (l === 'cones') delete keys.rl;
  else keys.rl = l;
  return { ...route, sheet: null, keys };
}

/** Set or clear one filter key; the page returns to the first. */
export function withKey(route: Route, k: 'st' | 'pr' | 'rcs' | 'su', v: string | null): Route {
  const keys = without(route.keys, ['rp']);
  if (v === null || v === '') delete keys[k];
  else keys[k] = v;
  return { ...route, keys };
}

/** Clear the hop filter (rf). The listing it seeded stays what it is on screen. */
export function withoutHop(route: Route, listing: Listing): Route {
  const keys = without(route.keys, ['rf', 'rp']);
  if (listing !== 'cones') keys.rl = listing;
  return { ...route, keys };
}

export function withPages(route: Route, pages: number): Route {
  const keys = { ...route.keys };
  if (pages <= 1) delete keys.rp;
  else keys.rp = String(Math.min(MAX_PAGES, pages));
  return { ...route, keys };
}

/** Open a record sheet; the page, filters and scroll stay under it. */
export function sheetFor(route: Route, kind: 'cone' | 'sack' | 'reject' | 'stock', id: string | number): Route {
  return { ...route, sheet: { kind, id: String(id) } };
}

/* ------------------------------------------------------------ rows */

export function stateWord(s: ConeState): string {
  return R.states[s];
}

/** The row's one verdict line for the cone and weight-check listings. */
export function coneVerdict(row: { state?: ConeState; in_range: boolean | null }): { text: string; tone: 'ok' | 'fail' | 'note' } {
  if (row.state) {
    return { text: R.states[row.state], tone: row.state === 'within' ? 'ok' : row.state === 'unknown' ? 'note' : 'fail' };
  }
  return row.in_range === false ? { text: R.failedWeight, tone: 'fail' } : { text: R.passedWeight, tone: 'ok' };
}

/** Case-insensitive match over the cells a reader would type. */
export function matchesSearch(cells: ReadonlyArray<string | number | null | undefined>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === '') return true;
  return cells.some((c) => c !== null && c !== undefined && String(c).toLowerCase().includes(needle));
}
