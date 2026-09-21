/**
 * A fake `fetch` for component tests, installed with `vi.stubGlobal` so it
 * replaces the real global exactly the way jsdom's own `fetch` would be
 * replaced — no module mock, no interception layer, because every client
 * call in this app funnels through exactly two functions, `get()`
 * (`web/src/api.ts:104-111`) and `post()` (`:113-126`), both of which call
 * the bare global `fetch`. One router at that one seam covers every screen.
 *
 * UX Phase 8 Brief A (21 Sep 2026).
 */
import { vi } from 'vitest';

/** What a route handler receives: the request's own pathname/search, so one
 *  handler can answer differently for `/api/events?type=cone` and
 *  `/api/events?type=sack` without string-splitting the URL itself. */
export interface RouteRequest {
  pathname: string;
  search: URLSearchParams;
  /** The full URL exactly as `fetch` was called with it. */
  url: string;
  init?: RequestInit;
}

export type RouteHandler = (req: RouteRequest) => unknown | Promise<unknown>;

/**
 * Keyed by pathname only (never the query string — handlers read `search`
 * themselves), each value is either a static JSON body, a function computing
 * one, or a real `Response` (for a route a test wants to answer with a
 * non-200 status, e.g. a 401 or a 503 `DISABLED` the way `/api/changeover/
 * execute` really does).
 */
export type Routes = Record<string, unknown | RouteHandler | Response>;

export interface FakeFetch {
  /** Every URL (`pathname + search`) requested through this fetch, in call
   *  order — so a test can assert what a screen actually asked for, not just
   *  that it rendered something plausible. */
  requests: string[];
  /** Undo `vi.stubGlobal('fetch', ...)`. `render.tsx`'s registered
   *  `afterEach(cleanup)` does NOT call this — a test that installs its own
   *  router must restore it itself (or rely on Vitest's own `vi.unstubAllGlobals`
   *  in a project-wide `afterEach`, which this repo does not configure), since
   *  two different fake-fetch instances stacking silently is worse than one
   *  leaking into the next test loudly.
   */
  restore: () => void;
}

function bodyToResponse(body: unknown): Response {
  if (body instanceof Response) return body;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Install a fake global `fetch` that answers only the given `routes`
 * (keyed by pathname). ANY other path throws — deliberately loud, never a
 * silent empty envelope. A silent default that happily returns `{}` for an
 * unregistered path is exactly how a test ends up "passing" while asserting
 * nothing about what the screen under test actually requested; this project
 * has a written rule against tests that manufacture that kind of false
 * confidence (see `reliability.guard.test.ts`'s own header).
 */
export function installFakeFetch(routes: Routes): FakeFetch {
  const requests: string[] = [];

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const url = new URL(rawUrl, 'http://localhost');
    const key = url.pathname + url.search;
    requests.push(key);

    if (!(url.pathname in routes)) {
      throw new Error(
        `installFakeFetch: no route registered for "${url.pathname}" (full request: ${rawUrl}). ` +
          `Add it to the routes object passed to installFakeFetch — an unregistered path is refused rather than ` +
          `answered with a silent empty envelope, so a test cannot pass while hiding a request it never accounted for.`,
      );
    }

    const entry = routes[url.pathname];
    const body = typeof entry === 'function' ? await (entry as RouteHandler)({ pathname: url.pathname, search: url.searchParams, url: rawUrl, init }) : entry;
    return bodyToResponse(body);
  };

  vi.stubGlobal('fetch', fakeFetch);

  return {
    requests,
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
}
