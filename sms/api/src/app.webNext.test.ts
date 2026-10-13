/**
 * The redesign build is served at /next beside the current UI (WEB_NEXT_DIST),
 * and the current UI at / is unchanged. Real createApp, a do-nothing fake pool
 * (static files and the /api 404 never touch the database).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Server } from 'http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createApp } from './app.js';
import type { ApiConfig } from './config.js';

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

const fakePool = {
  request: () => ({ input() { return this; }, async query() { return { recordset: [], rowsAffected: [0] }; } }),
} as unknown as import('mssql').ConnectionPool;

const OLD = '<html>OLD-UI</html>';
const NEXT = '<html>NEXT-UI</html>';
const tmp = mkdtempSync(join(tmpdir(), 'sms-webnext-'));
const oldDir = join(tmp, 'old');
const nextDir = join(tmp, 'next');
const savedEnv = { WEB_DIST: process.env.WEB_DIST, WEB_NEXT_DIST: process.env.WEB_NEXT_DIST };
const servers: Server[] = [];

async function start(): Promise<string> {
  const server = createApp(fakePool, cfg).listen(0);
  servers.push(server);
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('expected a network address');
  return `http://127.0.0.1:${addr.port}`;
}

beforeAll(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  mkdirSync(join(nextDir, 'assets'), { recursive: true });
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(nextDir, 'index.html'), NEXT);
  writeFileSync(join(nextDir, 'assets', 'x.js'), 'console.log("next");');
  writeFileSync(join(oldDir, 'index.html'), OLD);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('/next redesign build', () => {
  it('serves the redesign index, assets and client-route fallback; leaves / and /api alone', async () => {
    process.env.WEB_DIST = oldDir;
    process.env.WEB_NEXT_DIST = nextDir;
    const base = await start();

    const redirect = await fetch(`${base}/next`, { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/next/');

    expect(await (await fetch(`${base}/next/`)).text()).toBe(NEXT);
    const asset = await fetch(`${base}/next/assets/x.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('next');
    expect(await (await fetch(`${base}/next/quality?s=x`)).text()).toBe(NEXT);

    expect(await (await fetch(`${base}/`)).text()).toBe(OLD);
    expect(await (await fetch(`${base}/somewhere`)).text()).toBe(OLD);

    const api = await fetch(`${base}/api/nope`);
    // Unauthenticated, the API's own gate answers first (401); either way it is
    // a JSON refusal, never the SPA's HTML.
    expect([401, 404]).toContain(api.status);
    expect(api.headers.get('content-type')).toContain('application/json');
  });

  it('accepts a relative WEB_NEXT_DIST', async () => {
    process.env.WEB_DIST = oldDir;
    process.env.WEB_NEXT_DIST = relative(process.cwd(), nextDir);
    const base = await start();
    const res = await fetch(`${base}/next/deep/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(NEXT);
  });

  it('falls through to the old SPA when the redesign build is missing', async () => {
    process.env.WEB_DIST = oldDir;
    process.env.WEB_NEXT_DIST = join(tmp, 'does-not-exist');
    const base = await start();
    expect(await (await fetch(`${base}/next/`)).text()).toBe(OLD);
  });
});
