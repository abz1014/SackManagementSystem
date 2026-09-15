/**
 * Structured logging and the request id, against the REAL createApp (roadmap
 * Phase 2 item 6, 14 Sep 2026). Same shape as app.rbac.test.ts — a hand-
 * rolled fake pool, Node's fetch at an ephemeral port — but what is asserted
 * here is what the process WRITES: every line the API logs is one JSON
 * object on stdout with `ts, level, svc, msg` and, for anything about a
 * request, the request's id as `correlationId`. The logger writes through
 * process.stdout.write at call time, so a spy on it captures each line.
 *
 * Also the one gate the gap analysis flagged as missing: /api/operations
 * must answer 401 with no session. It sits behind the blanket
 * `app.use('/api', requireRole(1))` — this pins that it stays there.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'http';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

/**
 * A pool whose every query either answers "nothing" or, when `failing` is
 * set, throws — the latter turns POST /api/auth/login (public, one query)
 * into a 500 without needing a session. It used to be /api/health, which
 * since roadmap Phase 11 (14 Sep 2026) answers a dead database with 503
 * `status: 'down'` on purpose — a probe wants that word, not a stack — so
 * it can no longer stand in for "any route whose query throws".
 */
class FakeDb {
  failing: Error | null = null;
  request() {
    const req = {
      input: () => req,
      query: async () => {
        if (this.failing) throw this.failing;
        return { recordset: [], rowsAffected: [0] };
      },
    };
    return req;
  }
  transaction() {
    return { begin: async () => this, commit: async () => {}, rollback: async () => {}, request: () => this.request() };
  }
}

let server: Server;
let base: string;
let db: FakeDb;
let lines: string[] = [];

beforeAll(async () => {
  db = new FakeDb();
  const cfg: ApiConfig = {
    port: 0,
    lineId: 1,
    lineName: 'Test line',
    liveAllowAsOf: true,
    cacheTtlSeconds: 5,
    trustProxy: false,
    appDb: { server: 'unused', port: 1433, database: 'unused', user: 'unused', password: 'unused', encrypt: false, trustServerCertificate: true },
    pdasWrite: { enabled: false, db: null, disabledReason: 'PDAS_WRITE_ENABLED is not true.' },
  };
  const app = createApp(db as unknown as import('mssql').ConnectionPool, cfg);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  base = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
  lines = [];
  // Swallow so the test runner's own output stays clean; capture so the
  // shape can be asserted. Restored after each test by vi.restoreAllMocks.
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterAll(() => {
  vi.restoreAllMocks();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Every captured line, parsed — and every one MUST parse: that is the format. */
function logged(): Record<string, unknown>[] {
  return lines
    .flatMap((chunk) => chunk.split('\n'))
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('/api/operations is gated: no session → 401', () => {
  it('answers 401 unauthenticated, and 401 is what the access log records', async () => {
    const res = await fetch(`${base}/api/operations`);
    expect(res.status).toBe(401);
    // res.on('finish') fires after the response is written; give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    const entry = logged().find((l) => l.status === 401 && l.url === '/api/operations');
    expect(entry).toBeDefined();
    expect(entry!.level).toBe('warn');
    expect(entry!.svc).toBe('api');
    expect(entry!.msg).toBe('GET /api/operations -> 401 (' + entry!.durationMs + 'ms) user=anonymous');
    expect(entry!.user).toBe('anonymous');
    expect(typeof entry!.ts).toBe('string');
    expect(typeof entry!.correlationId).toBe('string');
    // The same id the client received, so the two can be matched.
    expect(entry!.correlationId).toBe(res.headers.get('x-request-id'));
  });
});

describe('the 500 handler writes one JSON line', () => {
  it("level 'error', the request, the user, the stack, and the request id — which the body returns too", async () => {
    db.failing = new Error('Login failed for user sms_api');
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'someone', password: 'something' }),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; requestId: string };
      expect(body.error).toBe('internal error');
      expect(body.requestId).toBe(res.headers.get('x-request-id'));

      const entry = logged().find((l) => l.level === 'error');
      expect(entry).toBeDefined();
      expect(entry!.svc).toBe('api');
      expect(entry!.msg).toBe('api error: POST /api/auth/login user=anonymous');
      expect(entry!.method).toBe('POST');
      expect(entry!.url).toBe('/api/auth/login');
      expect(entry!.user).toBe('anonymous');
      expect(entry!.correlationId).toBe(body.requestId);
      const err = entry!.err as { name: string; message: string; stack: string };
      expect(err.name).toBe('Error');
      expect(err.message).toBe('Login failed for user sms_api');
      expect(err.stack).toContain('Login failed for user sms_api');
      // Nothing about the cause reaches the client.
      expect(JSON.stringify(body)).not.toContain('Login failed');
    } finally {
      db.failing = null;
    }
  });

  it('every line the API wrote in this file parses as JSON with the four fixed keys', async () => {
    db.failing = new Error('boom');
    try {
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'someone', password: 'something' }),
      });
      await fetch(`${base}/api/operations`);
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      db.failing = null;
    }
    const all = logged();
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const l of all) {
      expect(Object.keys(l).slice(0, 4)).toEqual(['ts', 'level', 'svc', 'msg']);
      expect(['info', 'warn', 'error']).toContain(l.level);
    }
  });
});

describe('X-Request-Id', () => {
  it('a well-formed inbound id is honoured and echoed', async () => {
    const res = await fetch(`${base}/api/operations`, { headers: { 'X-Request-Id': 'proxy-7f3a.0042' } });
    expect(res.headers.get('x-request-id')).toBe('proxy-7f3a.0042');
    await new Promise((r) => setTimeout(r, 20));
    expect(logged().find((l) => l.url === '/api/operations')?.correlationId).toBe('proxy-7f3a.0042');
  });

  it('an inbound id that is too long or not plain is replaced, never trusted', async () => {
    for (const bad of ['a'.repeat(65), 'has space', '{"level":"info"}', '']) {
      const res = await fetch(`${base}/api/operations`, { headers: { 'X-Request-Id': bad } });
      const id = res.headers.get('x-request-id');
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
