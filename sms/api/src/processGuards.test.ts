/**
 * RT24-01 (CRITICAL) fix, part 2: `installProcessGuards` installs
 * process-level `unhandledRejection`/`uncaughtException` handlers so a bug
 * class like the malformed-cookie EPARAM (auth.malformedCookie.test.ts)
 * cannot take the whole Node process down by itself.
 *
 * - unhandledRejection: logged with its stack, `markDegraded` called with a
 *   descriptive reason, process kept running (no exit).
 * - uncaughtException: logged, then `exit(1)` — NSSM restarts the service
 *   after 10 s (DEPLOY.md); an uncaught exception means state may be
 *   inconsistent so this process deliberately does not try to keep running.
 */
import { describe, it, expect, vi } from 'vitest';
import { installProcessGuards } from './processGuards.js';

function fakeLog() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
}

describe('installProcessGuards', () => {
  it('unhandledRejection: logs with stack, marks degraded, does not exit', () => {
    const log = fakeLog();
    const markDegraded = vi.fn();
    const exit = vi.fn();
    const proc = new (require('node:events').EventEmitter)();

    installProcessGuards(log as any, markDegraded, exit as any, proc);

    const err = new Error('simulated EPARAM: Validation failed for parameter');
    proc.emit('unhandledRejection', err, Promise.resolve());

    expect(log.error).toHaveBeenCalledTimes(1);
    const call = log.error.mock.calls[0] as [string, Record<string, any>];
    const meta = call[1];
    expect(meta?.err?.stack ?? meta?.stack).toBeTruthy();
    expect(markDegraded).toHaveBeenCalledTimes(1);
    const degradedCall = markDegraded.mock.calls[0] as [string];
    expect(degradedCall[0]).toMatch(/unhandled rejection/i);
    expect(degradedCall[0]).toMatch(/simulated EPARAM/);
    expect(exit).not.toHaveBeenCalled();
  });

  it('uncaughtException: logs, then exits with code 1', () => {
    const log = fakeLog();
    const markDegraded = vi.fn();
    const exit = vi.fn();
    const proc = new (require('node:events').EventEmitter)();

    installProcessGuards(log as any, markDegraded, exit as any, proc);

    const err = new Error('simulated uncaught crash');
    proc.emit('uncaughtException', err);

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
