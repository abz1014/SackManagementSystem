/**
 * PDF render tokens (see auth.ts's RENDER TOKEN block) — the in-process,
 * never-persisted stand-in for a database session that lets the PDF
 * renderer's own headless Edge instance act as the caller who asked for the
 * export, without ever writing to sms.session (CLAUDE.md's "no agent-created
 * accounts" rule) and without ever hitting the database at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { ConnectionPool } from 'mssql';
import {
  authMiddleware, mintRenderToken, revokeRenderToken, renderTokenCount, RENDER_TOKEN_COOKIE, type AuthUser, type AuthedRequest,
} from './auth.js';

const user: AuthUser = { userId: 9, username: 'manager', displayName: 'Manager', role: 'manager', rank: 3 };

/** A pool that throws on any query — proves the render-token path never touches the database at all. */
function poisonedPool(): ConnectionPool {
  return {
    request: () => ({
      input: () => ({ query: () => { throw new Error('render-token auth must never query the database'); } }),
    }),
  } as unknown as ConnectionPool;
}

function fakeReq(cookieHeader: string | undefined): Request {
  return { headers: { cookie: cookieHeader } } as unknown as Request;
}
function fakeRes(): Response {
  return {} as Response;
}

describe('mintRenderToken / revokeRenderToken', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('mints a distinct, high-entropy token each call', () => {
    const a = mintRenderToken(user);
    const b = mintRenderToken(user);
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThan(40);
    revokeRenderToken(a.token);
    revokeRenderToken(b.token);
  });

  it('revoking a token removes it — renderTokenCount proves the map does not leak', () => {
    const before = renderTokenCount();
    const { token } = mintRenderToken(user);
    expect(renderTokenCount()).toBe(before + 1);
    revokeRenderToken(token);
    expect(renderTokenCount()).toBe(before);
  });

  it('revoking an unknown token is a harmless no-op', () => {
    expect(() => revokeRenderToken('does-not-exist')).not.toThrow();
  });
});

describe('authMiddleware — the render-token branch', () => {
  it('a valid render-token cookie sets req.user WITHOUT any database call', async () => {
    const { token } = mintRenderToken(user);
    try {
      const pool = poisonedPool();
      const mw = authMiddleware(pool);
      const req = fakeReq(`${RENDER_TOKEN_COOKIE}=${token}`);
      const res = fakeRes();
      const next = vi.fn() as unknown as NextFunction;
      await mw(req, res, next);
      expect((req as AuthedRequest).user).toEqual(user);
      expect(next).toHaveBeenCalledOnce();
    } finally {
      revokeRenderToken(token);
    }
  });

  it('an unknown render-token cookie value authenticates as nobody, not as a fallback session lookup', async () => {
    const pool = poisonedPool();
    const mw = authMiddleware(pool);
    const req = fakeReq(`${RENDER_TOKEN_COOKIE}=not-a-real-token`);
    const res = fakeRes();
    const next = vi.fn() as unknown as NextFunction;
    await mw(req, res, next);
    expect((req as AuthedRequest).user).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('an expired render token is treated as unknown and is pruned from the map on read', async () => {
    vi.useFakeTimers();
    try {
      const { token } = mintRenderToken(user, 10); // 10ms TTL
      vi.advanceTimersByTime(50);
      const before = renderTokenCount();
      const pool = poisonedPool();
      const mw = authMiddleware(pool);
      const req = fakeReq(`${RENDER_TOKEN_COOKIE}=${token}`);
      const res = fakeRes();
      const next = vi.fn() as unknown as NextFunction;
      await mw(req, res, next);
      expect((req as AuthedRequest).user).toBeNull();
      expect(renderTokenCount()).toBe(before - 1); // pruned on read
    } finally {
      vi.useRealTimers();
    }
  });

  it('a render token minted for one user is never confused with another user\'s token', async () => {
    const other: AuthUser = { userId: 10, username: 'engineer', displayName: null, role: 'engineer', rank: 2 };
    const a = mintRenderToken(user);
    const b = mintRenderToken(other);
    try {
      const pool = poisonedPool();
      const mw = authMiddleware(pool);

      const reqA = fakeReq(`${RENDER_TOKEN_COOKIE}=${a.token}`);
      const nextA = vi.fn() as unknown as NextFunction;
      await mw(reqA, fakeRes(), nextA);
      expect((reqA as AuthedRequest).user).toEqual(user);

      const reqB = fakeReq(`${RENDER_TOKEN_COOKIE}=${b.token}`);
      const nextB = vi.fn() as unknown as NextFunction;
      await mw(reqB, fakeRes(), nextB);
      expect((reqB as AuthedRequest).user).toEqual(other);
    } finally {
      revokeRenderToken(a.token);
      revokeRenderToken(b.token);
    }
  });
});
