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
 *  (a) ROW CAP. `countRows` looks for the largest array in the handful of
 *      envelope shapes this app actually uses — a bare top-level array, or
 *      `.rows` / `.data` / `.data.rows` — and refuses with
 *      `{ error: 'result too large', limit, hint }` when it exceeds
 *      `maxRows`. This is deliberately a small, explicit set of shapes, not a
 *      recursive walk of the whole body: a recursive scan would also catch
 *      unrelated small arrays (`filters`, `codes`) nested arbitrarily deep and
 *      risk false positives on a legitimately large but harmless nested list;
 *      the shapes here are exactly where this app's row-listing/report
 *      services put their row data (register.ts's RegisterPage.rows,
 *      an envelope's own `.data`).
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
 * The largest array found at one of this app's known envelope shapes. Pure,
 * exported for the test. Returns 0 (never refuses) for a body with no array
 * in any of those shapes.
 */
export function largestKnownArray(body: unknown): number {
  if (body == null || typeof body !== 'object') return Array.isArray(body) ? body.length : 0;
  let max = 0;
  const consider = (v: unknown): void => {
    if (Array.isArray(v) && v.length > max) max = v.length;
  };
  const b = body as Record<string, unknown>;
  consider(b);
  consider(b.rows);
  consider(b.data);
  if (b.data != null && typeof b.data === 'object' && !Array.isArray(b.data)) {
    consider((b.data as Record<string, unknown>).rows);
  }
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
