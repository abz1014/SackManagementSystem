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
 * **Update, same day:** when this file was first written, `largestKnownArray`
 * only recognised a small, explicit set of envelope shapes (a bare top-level
 * array, `.rows`, `.data` as an array, or `.data.rows`) and so could not see
 * `/api/reject-spc`'s real payload shape, `data.buckets` — this guard was a
 * documented no-op for this route. `middleware/responseCap.ts`'s
 * `largestKnownArray` now walks the body for the largest array anywhere
 * (bounded to depth 4), which does see `data.buckets`, so the gap this file
 * used to document is closed — see the third test below, updated to assert
 * the fixed behaviour rather than document the old gap.
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

  it("would NOT cache today's real reject-spc envelope shape (data.buckets, not data.rows) when buckets is huge — largestKnownArray's bounded walk now sees it", () => {
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
    expect(largestKnownArray(env)).toBe(MAX_RESPONSE_ROWS + 1);
    expect(wouldCache(env)).toBe(false);
  });

  it('would NOT cache a bare top-level array over the cap (the shape a differently-built envelope could still take)', () => {
    const env = new Array(MAX_RESPONSE_ROWS + 1).fill(0);
    expect(wouldCache(env)).toBe(false);
  });
});
