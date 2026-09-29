/**
 * RT-014 (HIGH, 23/24 Sep 2026 red-team audits): "no server-side response-
 * size/row-count cap independent of SQL." Pure `largestKnownArray` plus the
 * middleware itself against a hand-rolled fake Request/Response — no HTTP
 * server needed, same idiom as cache.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { largestKnownArray, responseCap } from './responseCap.js';

describe('largestKnownArray', () => {
  it('finds a bare top-level array', () => {
    expect(largestKnownArray([1, 2, 3])).toBe(3);
  });
  it('finds .rows', () => {
    expect(largestKnownArray({ rows: [1, 2] })).toBe(2);
  });
  it('finds .data as an array', () => {
    expect(largestKnownArray({ data: [1, 2, 3, 4] })).toBe(4);
  });
  it('finds .data.rows (the envelope-wrapped register shape)', () => {
    expect(largestKnownArray({ data: { rows: [1, 2, 3], total: 3 }, metadata: {} })).toBe(3);
  });
  it('is 0 for a body with no array in any known shape', () => {
    expect(largestKnownArray({ data: { total: 3 }, metadata: {} })).toBe(0);
  });
  it('is 0 for null/undefined/primitive bodies', () => {
    expect(largestKnownArray(null)).toBe(0);
    expect(largestKnownArray(undefined)).toBe(0);
    expect(largestKnownArray('x')).toBe(0);
  });

  // 29 Sep 2026: an envelope's rows can live under a key other than
  // `.rows`/`.data`/`.data.rows` — e.g. /api/reject-spc's `data.buckets` —
  // and the old fixed-shape check never saw them.
  it('finds an array under an arbitrary key, not just the known envelope shapes', () => {
    expect(largestKnownArray({ data: { buckets: new Array(7).fill(0), episodes: [] } })).toBe(7);
  });

  it('counts a nested array at depth 3', () => {
    // depth 0: body: { a }, depth 1: a: { b }, depth 2: b: { c }, depth 3: c: [...]
    expect(largestKnownArray({ a: { b: { c: new Array(9).fill(0) } } })).toBe(9);
  });

  it('ignores an array past depth 4 (bounded walk)', () => {
    // depth 0..4: a,b,c,d wrap an object; the array itself would land at
    // depth 5, past the walk's bound, so it must not be seen.
    const deep = { a: { b: { c: { d: { e: new Array(20).fill(0) } } } } };
    expect(largestKnownArray(deep)).toBe(0);
  });

  it('returns the length of the LARGEST array anywhere, not the first found', () => {
    expect(largestKnownArray({ small: [1, 2], data: { big: new Array(15).fill(0) } })).toBe(15);
  });
});

function fakeReqRes() {
  const state = { statusCode: 200, sentBody: undefined as unknown };
  const res = {
    setHeader: (_k: string, _v: string) => res,
    status: (code: number) => { state.statusCode = code; return res; },
    json: (body?: unknown) => { state.sentBody = body; return res; },
  } as unknown as Response;
  const req = { originalUrl: '/api/events?type=cone', headers: {} } as unknown as Request;
  return { req, res, state };
}

describe('responseCap middleware', () => {
  it('passes through a response under both caps unchanged', () => {
    const mw = responseCap({ maxRows: 10, maxBytes: 10_000 });
    const { req, res, state } = fakeReqRes();
    mw(req, res, () => {});
    res.json({ data: { rows: [1, 2, 3] } });
    expect(state.statusCode).toBe(200);
    expect(state.sentBody).toEqual({ data: { rows: [1, 2, 3] } });
  });

  it('refuses with 413 when the row cap is exceeded, cap+1 rows', () => {
    const mw = responseCap({ maxRows: 5, maxBytes: 10_000 });
    const { req, res, state } = fakeReqRes();
    mw(req, res, () => {});
    res.json({ data: { rows: new Array(6).fill(0) } });
    expect(state.statusCode).toBe(413);
    expect(state.sentBody).toMatchObject({ error: 'result too large', limit: 5, hint: expect.stringMatching(/shorter period or filter/) });
  });

  it('accepts exactly the cap (not cap+1)', () => {
    const mw = responseCap({ maxRows: 5, maxBytes: 10_000 });
    const { req, res, state } = fakeReqRes();
    mw(req, res, () => {});
    res.json({ data: { rows: new Array(5).fill(0) } });
    expect(state.statusCode).toBe(200);
  });

  it('refuses with 413 when the byte cap is exceeded even under the row cap', () => {
    const mw = responseCap({ maxRows: 1000, maxBytes: 50 });
    const { req, res, state } = fakeReqRes();
    mw(req, res, () => {});
    res.json({ data: { one: 'x'.repeat(200) } });
    expect(state.statusCode).toBe(413);
    expect((state.sentBody as { limit: number }).limit).toBe(50);
  });

  it('logs the refusal (does not throw) — request has no correlationId attached here', () => {
    const mw = responseCap({ maxRows: 1, maxBytes: 10_000 });
    const { req, res } = fakeReqRes();
    mw(req, res, () => {});
    expect(() => res.json({ rows: [1, 2] })).not.toThrow();
  });
});
