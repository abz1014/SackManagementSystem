/**
 * API mocks for the web-next Playwright port (fix-wave T6).
 *
 * NO LOGIN, NO DATABASE. Every /api/* request is answered from `fixtures/api.json` through `page.route`; the
 * signed-in user is made up here (`/api/auth/me`) and no cookie or token is ever sent. The fixtures were recorded
 * from the read-only audit copy by `capture-fixtures.mjs` (small, operator names pseudonymised).
 *
 * Lookup order for a GET: an `overrides` entry for the pathname, the exact fixture key (pathname plus the query
 * with the period params removed), the pathname alone, then the first fixture whose key starts with the pathname.
 * Anything else is a 404 that is recorded in `api.missed` so a spec can say which call it could not answer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';

const HERE = __dirname;
type Fixture = { status: number; body: unknown };
let FIXTURES: Record<string, Fixture> | null = null;
export function fixtures(): Record<string, Fixture> {
  FIXTURES ??= JSON.parse(readFileSync(join(HERE, 'fixtures', 'api.json'), 'utf8')) as Record<string, Fixture>;
  return FIXTURES;
}
/** A deep copy of a recorded body, so a spec can edit it freely. */
export function fixtureBody<T = any>(key: string): T {
  const f = fixtures()[key];
  if (!f) throw new Error(`no recorded fixture ${key}`);
  return JSON.parse(JSON.stringify(f.body)) as T;
}

const PERIOD_KEYS = new Set(['from', 'to', 'tsTo', 'asOf', 'at', 'fromShift', 'toShift', 'shift', 'periodFrom', 'periodTo', 'p', 'cmp', 'compare']);
export function keyOf(pathname: string, search: string): string {
  const kept = [...new URLSearchParams(search).entries()].filter(([k]) => !PERIOD_KEYS.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return pathname + (kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '');
}

/** The recorded body a GET of `url` would get (exact key, pathname, or first key under the pathname), as a copy; null when none. */
export function recorded(url: URL): any | null {
  const all = fixtures();
  const hit = all[keyOf(url.pathname, url.search)] ?? all[url.pathname] ?? Object.entries(all).find(([k]) => k.startsWith(url.pathname + '?'))?.[1];
  return hit ? JSON.parse(JSON.stringify(hit.body)) : null;
}

export const ROLES = { 1: 'viewer', 2: 'engineer', 3: 'manager', 4: 'admin' } as const;
export type Rank = 1 | 2 | 3 | 4;

export type Handler = unknown | ((url: URL, method: string, body: string | null) => unknown | { status: number; body: unknown });
export interface ApiOptions {
  rank?: Rank;
  /** Milliseconds every /api answer is held back (skeleton timing). */
  delayMs?: number;
  /** Per-pathname replacement of the recorded body (value, or function returning a value / {status, body}). */
  overrides?: Record<string, Handler>;
  /** No session at all: /api/auth/me answers 401 (Login screen). */
  signedOut?: boolean;
}
export interface Api {
  requests: string[];
  missed: string[];
  /** Replace or add an override after install. */
  set(pathname: string, h: Handler): void;
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function installApi(page: Page, o: ApiOptions = {}): Promise<Api> {
  const rank = o.rank ?? 3;
  const overrides: Record<string, Handler> = { ...(o.overrides ?? {}) };
  const api: Api = { requests: [], missed: [], set: (p, h) => void (overrides[p] = h) };
  const all = fixtures();
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    api.requests.push(`${method} ${url.pathname}${url.search}`);
    if (o.delayMs && url.pathname !== '/api/auth/me') await new Promise((r) => setTimeout(r, o.delayMs));
    if (url.pathname === '/api/auth/me') {
      if (o.signedOut) return json(route, 401, { error: 'not signed in' });
      return json(route, 200, { user: { username: 'tester', displayName: 'Test User', role: ROLES[rank] } });
    }
    if (url.pathname === '/api/auth/logout') return json(route, 200, { ok: true });
    const ov = overrides[url.pathname];
    if (ov !== undefined) {
      const v = typeof ov === 'function' ? (ov as Function)(url, method, req.postData()) : ov;
      if (v && typeof v === 'object' && 'status' in (v as object) && 'body' in (v as object)) {
        const r = v as { status: number; body: unknown };
        return json(route, r.status, r.body);
      }
      return json(route, 200, v);
    }
    if (method !== 'GET') {
      api.missed.push(`${method} ${url.pathname}`);
      return json(route, 404, { error: 'no mock for this write (specs never write)' });
    }
    const exact = all[keyOf(url.pathname, url.search)];
    const bare = all[url.pathname];
    const prefix = Object.entries(all).find(([k]) => k.startsWith(url.pathname + '?'))?.[1];
    const hit = exact ?? bare ?? prefix;
    if (!hit) {
      api.missed.push(keyOf(url.pathname, url.search));
      return json(route, 404, { error: 'no fixture' });
    }
    return json(route, hit.status, hit.body);
  });
  return api;
}
