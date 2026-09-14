/**
 * The API's logger and its per-request correlation id (roadmap Phase 2 item
 * 6, 14 Sep 2026).
 *
 * Every line the API writes goes through `@sms/shared`'s createLogger — one
 * JSON object per line on stdout, `svc: "api"` — instead of the template
 * strings to stderr it used before. The shape is the sync worker's, so one
 * `grep` over `api.log` and `sync.log` reads both.
 *
 * REQUEST ID. Each request gets an id at the first middleware and carries it
 * to the access log, the 500 handler and the auth warnings as `correlationId`;
 * the 500 body returns it too, so what a user pastes into a support message
 * finds the stack trace in the log. A client may supply its own in
 * `X-Request-Id` (a browser retry, a proxy) and it is honoured when it is
 * short and plain — anything else is replaced, never trusted: the log is
 * JSON, so a hostile value cannot break a line, but an unbounded one could
 * bloat it and a look-alike one could point an operator at the wrong request.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createLogger, type Logger } from '@sms/shared';

export const log: Logger = createLogger('api');

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Attaches the request id (honouring a well-formed inbound header, minting
 * one otherwise) and echoes it back so the client can quote it. Mounted
 * before anything that could log, including securityHeaders — a request that
 * fails there still gets an id.
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const given = Array.isArray(inbound) ? inbound[0] : inbound;
    const id = given && SAFE_REQUEST_ID.test(given) ? given : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

/** The id `requestId()` attached; undefined only if that middleware did not run. */
export function requestIdOf(req: Request): string | undefined {
  const id: unknown = req.res?.locals?.requestId;
  return typeof id === 'string' ? id : undefined;
}

/** A logger whose every line carries this request's id as `correlationId`. */
export function requestLog(req: Request): Logger {
  const id = requestIdOf(req);
  return id ? log.child({ correlationId: id }) : log;
}
