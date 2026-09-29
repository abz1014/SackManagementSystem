/**
 * RT-014 (HIGH, 23/24 Sep 2026 red-team audits): "no server-side response-
 * size/row-count cap independent of SQL." The decision (DEFECTS.md, CLAUDE.md
 * WS-* history): NO SILENT TRUNCATION, EVER. Rather than let a route cut a
 * result down and hope the caller notices a flag, this middleware wraps
 * `res.json` and refuses outright — 413 — whenever a response would exceed
 * either cap, independent of whatever the SQL layer already did. It is
 * mounted once, globally, in app.ts (createApp), so no individual route has
 * to remember to apply it.
 *
 * Two caps, checked in this order:
 *  (a) ROW CAP. `largestKnownArray` walks the body (objects and arrays only,
 *      bounded to depth 4) and returns the length of the LARGEST array found
 *      anywhere, refusing with `{ error: 'result too large', limit, hint }`
 *      when it exceeds `maxRows`. This used to check only a small, explicit
 *      set of shapes (a bare top-level array, or `.rows` / `.data` /
 *      `.data.rows`) — found (29 Sep 2026) to miss envelopes that carry their
 *      rows under another key, e.g. /api/reject-spc's `data.buckets`: the row
 *      cap never refused them and the cache guards that call
 *      `largestKnownArray` before caching were inert for that shape, leaving
 *      only the byte cap as protection. The bounded walk closes that gap. The
 *      depth cap (4) keeps this a cheap, terminating scan rather than an
 *      unbounded recursive walk of the whole body; every real row-array in
 *      this app's response shapes sits within that depth, and the small
 *      nested arrays it now also sees (`stations`, `machines`, `products`,
 *      `codes`, `filters`) are bounded by counts of physical things (stations,
 *      machines, products) — at most dozens, nowhere near `maxRows` — so they
 *      do not risk a false 413.
 *  (b) BYTE CAP. Independent backstop: even a response this middleware's row
 *      check waves through (e.g. one enormous non-array payload, or many
 *      moderately-sized rows with heavy per-row fields) is refused if its
 *      serialized JSON exceeds `maxBytes`.
 *
 * Both refusals are logged with the request's correlationId (log.ts) before
 * the 413 is sent, so an operator can find the exact request that tripped
 * the cap.
 *
 * `res.send` is NOT wrapped here for the CSV export route
 * (`/api/events/export`) — that route already enforces its own row cap
 * (register.ts's `CSV_ROW_CAP`, with an explicit `truncated`/`X-Export-
 * Truncated` flag) at a tighter default than `MAX_RESPONSE_ROWS`, which is a
 * different, already-labelled truncation contract this middleware would only
 * duplicate. A byte backstop for that route is out of this pass's scope.
 */
import type { NextFunction, Request, Response } from 'express';
import { MAX_RESPONSE_BYTES, MAX_RESPONSE_ROWS } from '../config.js';
import { requestLog } from '../log.js';

export interface ResponseCapOptions {
  maxRows?: number;
  maxBytes?: number;
}

/**
 * The length of the largest array found anywhere in the body, walking
 * objects and arrays only, bounded to depth 4 (the body itself is depth 0).
 * Pure, exported for the test. Returns 0 (never refuses) for a body with no
 * array at all within that depth.
 */
export function largestKnownArray(body: unknown): number {
  let max = 0;
  const walk = (v: unknown, depth: number): void => {
    if (v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (v.length > max) max = v.length;
      if (depth >= 4) return;
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (depth >= 4) return;
    for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
  };
  walk(body, 0);
  return max;
}

/**
 * Mounted once in createApp. Wraps `res.json` only — every route in this app
 * answers JSON through it (routes that answer CSV/PDF use `res.send`
 * directly and are outside this middleware's contract; see the module header
 * on why the CSV export route is a deliberate, separate exception).
 */
export function responseCap(opts: ResponseCapOptions = {}) {
  const maxRows = opts.maxRows ?? MAX_RESPONSE_ROWS;
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      // Both refusal branches call `originalJson` directly, never `res.json`:
      // `res.json` IS this wrapper (reassigned below), so calling it again on
      // the small error body would recheck that body against the same caps —
      // harmless in practice (the error body is tiny) but pointless, and it
      // was a real self-recursion bug in an earlier draft of this file.
      const rows = largestKnownArray(body);
      if (rows > maxRows) {
        requestLog(req).warn(`response row cap exceeded: ${rows} rows > limit ${maxRows}`, {
          rows, limit: maxRows, url: req.originalUrl,
        });
        res.status(413);
        return originalJson({
          error: 'result too large',
          limit: maxRows,
          hint: 'choose a shorter period or filter',
        });
      }
      let bytes = 0;
      try {
        bytes = Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8');
      } catch {
        bytes = 0; // a body that cannot be stringified (e.g. BigInt) is not this middleware's problem to diagnose
      }
      if (bytes > maxBytes) {
        requestLog(req).warn(`response byte cap exceeded: ${bytes} bytes > limit ${maxBytes}`, {
          bytes, limit: maxBytes, url: req.originalUrl,
        });
        res.status(413);
        return originalJson({
          error: 'result too large',
          limit: maxBytes,
          hint: 'choose a shorter period or filter',
        });
      }
      return originalJson(body);
    }) as typeof res.json;
    next();
  };
}
