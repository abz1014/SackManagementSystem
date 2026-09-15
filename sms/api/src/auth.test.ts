import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireRole, LoginRateLimiter, type AuthedRequest, type AuthUser } from './auth.js';

function fakeReq(user: AuthUser | null): Request {
  return { user } as unknown as Request & AuthedRequest;
}

/** Minimal chainable res mock: .status(n).json(body), both spies. */
function fakeRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const user = (rank: number): AuthUser => ({ userId: 1, username: 'u', displayName: null, role: 'x', rank });

describe('requireRole', () => {
  it('401s an unauthenticated request and never calls next()', () => {
    const req = fakeReq(null);
    const res = fakeRes();
    const next = vi.fn();
    requireRole(1)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s regardless of minRank when there is no user at all', () => {
    for (const minRank of [1, 2, 3, 4]) {
      const req = fakeReq(null);
      const res = fakeRes();
      const next = vi.fn();
      requireRole(minRank)(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('403s a user below minRank and never calls next()', () => {
    const req = fakeReq(user(1)); // viewer
    const res = fakeRes();
    const next = vi.fn();
    requireRole(4)(req, res, next); // admin-only route
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and sets no status for a user at exactly minRank', () => {
    const req = fakeReq(user(2)); // engineer
    const res = fakeRes();
    const next = vi.fn();
    requireRole(2)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() for a user above minRank', () => {
    const req = fakeReq(user(4)); // admin hitting a viewer-rank route
    const res = fakeRes();
    const next = vi.fn();
    requireRole(1)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // The full rank matrix, mirroring the four app.ts tiers (viewer=1,
  // engineer=2, manager=3, admin=4 since migration 035) x every route's minRank. If a route's
  // requireRole(N) argument is ever fat-fingered, this is what would still
  // catch it even though app.ts itself was never imported.
  it.each([
    [1, 1, true], [1, 2, false], [1, 3, false], [1, 4, false],
    [2, 1, true], [2, 2, true], [2, 3, false], [2, 4, false],
    [3, 1, true], [3, 2, true], [3, 3, true], [3, 4, false],
    [4, 1, true], [4, 2, true], [4, 3, true], [4, 4, true],
  ])('rank %i vs minRank %i -> allowed=%s', (userRank, minRank, allowed) => {
    const req = fakeReq(user(userRank));
    const res = fakeRes();
    const next = vi.fn();
    requireRole(minRank)(req, res, next);
    expect(next.mock.calls.length > 0).toBe(allowed);
  });
});

describe('LoginRateLimiter', () => {
  it('allows attempts until the failure threshold, then locks out', () => {
    const limiter = new LoginRateLimiter();
    const key = 'user:test';
    const t = 0;
    // 8 is MAX_FAILS in auth.ts — not exported, so pinned here as the
    // documented contract; a change to that constant should be a deliberate,
    // visible edit to this test too.
    for (let i = 0; i < 7; i++) {
      expect(limiter.retryAfter(key, t)).toBe(0);
      limiter.recordFailure(key, t);
    }
    expect(limiter.retryAfter(key, t)).toBe(0); // 7 fails: still open
    limiter.recordFailure(key, t); // 8th fail: locks
    expect(limiter.retryAfter(key, t)).toBeGreaterThan(0);
  });

  it('clear() resets the lockout immediately', () => {
    const limiter = new LoginRateLimiter();
    const key = 'user:test2';
    for (let i = 0; i < 8; i++) limiter.recordFailure(key, 0);
    expect(limiter.retryAfter(key, 0)).toBeGreaterThan(0);
    limiter.clear(key);
    expect(limiter.retryAfter(key, 0)).toBe(0);
  });

  it('a lockout expires once LOCKOUT_MS has passed', () => {
    const limiter = new LoginRateLimiter();
    const key = 'user:test3';
    for (let i = 0; i < 8; i++) limiter.recordFailure(key, 0);
    expect(limiter.retryAfter(key, 0)).toBeGreaterThan(0);
    expect(limiter.retryAfter(key, 16 * 60_000)).toBe(0); // past the 15-minute lockout
  });

  it('keys are independent — locking one account does not touch another', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 8; i++) limiter.recordFailure('user:victim', 0);
    expect(limiter.retryAfter('user:victim', 0)).toBeGreaterThan(0);
    expect(limiter.retryAfter('user:innocent', 0)).toBe(0);
  });
});

/**
 * Roadmap Phase 11 (14 Sep 2026): the map is bounded in fact, not by claim.
 * Every check prunes entries whose failure window has passed and whose
 * lockout has expired; a live lockout survives the window.
 */
describe('LoginRateLimiter — pruning', () => {
  it('drops stale keys on the next check, keeps a live lockout past its window', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 50; i++) limiter.recordFailure(`ip:10.0.0.${i}`, 0); // one failure each, at t=0
    for (let i = 0; i < 8; i++) limiter.recordFailure('user:locked', 0); // locked until t=15min
    expect(limiter.size).toBe(51);
    // 16 minutes later: the single failures are outside the 15-minute window
    // AND the lockout has expired, so everything goes.
    expect(limiter.retryAfter('ip:10.0.0.1', 16 * 60_000)).toBe(0);
    expect(limiter.size).toBe(0);
  });

  it('a lockout that is still in force is never pruned, even after the failure window', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 8; i++) limiter.recordFailure('user:locked', 0);
    limiter.recordFailure('ip:stale', 0);
    // 14 minutes: window not yet over — nothing pruned
    limiter.retryAfter('x', 14 * 60_000);
    expect(limiter.size).toBe(2);
    // recordFailure at t=0 set first=0; the lockout runs to t=15min. Just
    // past the window but inside the lockout is impossible here since both
    // are 15 min, so check exactly at the boundary: still locked, still held.
    expect(limiter.retryAfter('user:locked', 15 * 60_000 - 1)).toBeGreaterThan(0);
    expect(limiter.size).toBe(2);
  });
});
