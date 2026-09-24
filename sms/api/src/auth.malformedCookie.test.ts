/**
 * RT24-01 (CRITICAL): a malformed `sms_session` cookie value used to bind
 * straight into an `mssql.UniqueIdentifier` parameter. A non-GUID string
 * makes `mssql` throw `EPARAM` when the request is built; that throw
 * happened inside `authMiddleware`'s async handler, which Express 4 does not
 * forward to its error handler — the rejection went unhandled and, with
 * `installProcessGuards` wired in `index.ts`, would otherwise crash the
 * process on a single bad cookie.
 *
 * This file proves `authMiddleware` itself is now defensive on both fronts:
 * (a) a non-GUID cookie never reaches the database at all, and (b) even a
 * genuine lookup failure is caught, logged, and treated as anonymous rather
 * than thrown.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { ConnectionPool } from 'mssql';
import { authMiddleware, SESSION_COOKIE, type AuthedRequest } from './auth.js';

function fakeReqWithCookie(cookieValue: string): Request {
  return {
    headers: { cookie: `${SESSION_COOKIE}=${cookieValue}` },
  } as unknown as Request;
}

function fakeRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.cookie = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  return res;
}

describe('authMiddleware — malformed session cookie (RT24-01)', () => {
  it('a non-GUID cookie never reaches the database: next() is called, user is null, zero queries', async () => {
    const request = vi.fn();
    const pool = { request } as unknown as ConnectionPool;
    const mw = authMiddleware(pool);
    const req = fakeReqWithCookie('not-a-guid') as AuthedRequest;
    const res = fakeRes();
    const next = vi.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('a well-formed GUID that fails the lookup (DB error) still calls next() with an anonymous user', async () => {
    const input = vi.fn().mockReturnThis();
    const query = vi.fn().mockRejectedValue(new Error('EPARAM: simulated lookup failure'));
    const request = vi.fn().mockReturnValue({ input, query });
    const pool = { request } as unknown as ConnectionPool;
    const mw = authMiddleware(pool);
    const req = fakeReqWithCookie('11111111-2222-3333-4444-555555555555') as AuthedRequest;
    const res = fakeRes();
    const next = vi.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeNull();
  });
});
