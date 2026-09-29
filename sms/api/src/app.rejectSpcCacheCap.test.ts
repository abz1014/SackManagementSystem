/**
 * 29 Sep 2026: /api/reject-spc's cache `.set()` lacked the
 * `largestKnownArray(env) <= MAX_RESPONSE_ROWS` guard `/api/events` already
 * has (app.ts, RT-014's own "never cache a page the response-cap middleware
 * would go on to refuse" rule — see /api/events's own comment, mirrored
 * verbatim onto /api/reject-spc's `.set()` by this same-day fix). This file
 * proves the mirrored guard's PREDICATE the same way `middleware/
 * responseCap.test.ts` proves `largestKnownArray` itself: directly, against
 * the exact envelope shape the guard is written to recognise
 * (`{ data: { rows: [...] }, metadata }`).
 *
 * Why not prove it by driving an oversized `/api/reject-spc` response
 * through the real HTTP route, the way `app.rt24.test.ts` proves the row cap
 * for `/api/events`: `getRejectSpc`'s own envelope (`services/rejectSpc.ts`)
 * carries its buckets under `data.buckets`, never `data.rows` — the one
 * shape `largestKnownArray` (`middleware/responseCap.ts`) recognises besides
 * a bare top-level array, `.rows`, or `.data` itself as an array (see that
 * file's own header: "a small, explicit set of shapes", written for
 * register.ts's `RegisterPage.rows`). So today, an oversized `/api/reject-spc`
 * payload is not one `largestKnownArray` can see — this mirrored guard is
 * therefore currently a no-op for THIS route's actual payload shape, exactly
 * as inert as it would be for any other non-`rows`-shaped envelope. That is
 * a pre-existing gap in `largestKnownArray`'s own shape list, not something
 * this fix introduces or can close (`middleware/responseCap.ts` and
 * `services/rejectSpc.ts` are both outside this fix's owned files —
 * `api/src/app.ts`'s `/api/reject-spc` cache `.set()` line only). What this
 * fix DOES guarantee, and what this file proves: the same predicate that
 * already protects /api/events now runs, byte-identical, on
 * /api/reject-spc's own envelope before every cache write, so the day that
 * envelope's shape grows a `rows`/`data`-array field (or `largestKnownArray`
 * itself learns to look at `.data.buckets`), the guard is already wired in
 * and needs no further change here.
 */
import { describe, it, expect } from 'vitest';
import { largestKnownArray } from './middleware/responseCap.js';
import { MAX_RESPONSE_ROWS } from './config.js';

/** The exact guard expression now used identically by both /api/events's and
 *  /api/reject-spc's cache `.set()` in app.ts:
 *    `if (largestKnownArray(env) <= MAX_RESPONSE_ROWS) prodCache.set(key, env);`
 *  Reproduced here, not imported, because it is a route-local statement, not
 *  an exported function — the same reason `middleware/responseCap.test.ts`
 *  tests `largestKnownArray` directly rather than through an HTTP route. */
function wouldCache(env: unknown): boolean {
  return largestKnownArray(env) <= MAX_RESPONSE_ROWS;
}

describe('/api/reject-spc cache guard (mirrors /api/events, app.ts)', () => {
  it('would NOT cache an envelope whose data.rows exceeds MAX_RESPONSE_ROWS', () => {
    const env = { data: { rows: new Array(MAX_RESPONSE_ROWS + 1).fill(0) }, metadata: {} };
    expect(wouldCache(env)).toBe(false);
  });

  it('WOULD cache an envelope at exactly the cap (not cap+1)', () => {
    const env = { data: { rows: new Array(MAX_RESPONSE_ROWS).fill(0) }, metadata: {} };
    expect(wouldCache(env)).toBe(true);
  });

  it("WOULD cache today's real reject-spc envelope shape (data.buckets, not data.rows) even when buckets is huge — documents the pre-existing largestKnownArray gap named above, not a regression from this fix", () => {
    const env = {
      data: {
        bucketSize: 'day',
        rejectTypeFilter: 'all',
        buckets: new Array(MAX_RESPONSE_ROWS + 1).fill({ bucketTs: '2026-08-01T00:00:00.000Z', generation: 1, produced: 1, inspected: 1, rejects: 0, rate: 0, ucl: null, lcl: null, outOfControl: false }),
        episodes: [],
        generations: [],
      },
      metadata: {},
    };
    // largestKnownArray only looks at a bare top-level array, `.rows`,
    // `.data` (as an array), or `.data.rows` — never `.data.buckets` — so
    // this huge, realistically-shaped payload is invisible to it.
    expect(largestKnownArray(env)).toBe(0);
    expect(wouldCache(env)).toBe(true);
  });

  it('would NOT cache a bare top-level array over the cap (the shape a differently-built envelope could still take)', () => {
    const env = new Array(MAX_RESPONSE_ROWS + 1).fill(0);
    expect(wouldCache(env)).toBe(false);
  });
});
