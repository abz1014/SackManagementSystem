/**
 * createLogger — one JSON line per event, the four fixed keys first, and the
 * child's bound fields (the worker's pass runId as `correlationId`) on every
 * line it writes (roadmap Phase 2 item 6, 14 Sep 2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './log.js';

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

const parsed = (i = 0) => JSON.parse(lines[i]!.trim()) as Record<string, unknown>;

describe('createLogger', () => {
  it('writes exactly one JSON line per event with ts, level, svc, msg and the extra fields', () => {
    createLogger('sync-worker').info('sync pass complete', { ms: 12, rawWritten: 3 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith('\n')).toBe(true);
    const line = parsed();
    expect(Object.keys(line).slice(0, 4)).toEqual(['ts', 'level', 'svc', 'msg']);
    expect(line).toMatchObject({ level: 'info', svc: 'sync-worker', msg: 'sync pass complete', ms: 12, rawWritten: 3 });
    expect(new Date(String(line.ts)).toISOString()).toBe(line.ts);
  });

  it('a child carries its correlationId on every line, and the parent stays unbound', () => {
    const log = createLogger('sync-worker');
    const pass = log.child({ correlationId: 'run-42' });
    pass.warn('retrying source read', { attempt: 1 });
    pass.error('source table did not sync', { table: 'pack1_TP1U2' });
    log.info('starting');
    expect(parsed(0)).toMatchObject({ level: 'warn', correlationId: 'run-42', attempt: 1 });
    expect(parsed(1)).toMatchObject({ level: 'error', correlationId: 'run-42', table: 'pack1_TP1U2' });
    expect(parsed(2)).not.toHaveProperty('correlationId');
  });

  it('serialises an Error by message rather than as {} (JSON.stringify of an Error)', () => {
    createLogger('cli').error('cli command failed', { error: new Error('Login failed for user sms_readonly') });
    const line = parsed();
    const err = line.error as Record<string, unknown>;
    expect(err.message).toBe('Login failed for user sms_readonly');
    expect(err.name).toBe('Error');
  });

  it('a caller cannot override the level or the service through extra', () => {
    createLogger('api').info('x', { level: 'error', svc: 'other' } as never);
    expect(parsed()).toMatchObject({ level: 'info', svc: 'api' });
  });
});
