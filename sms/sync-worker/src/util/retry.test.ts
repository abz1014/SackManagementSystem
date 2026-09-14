/**
 * withRetry's `retryOn` (roadmap Phase 2 item 2, 14 Sep 2026): a failure the
 * predicate rejects is thrown on the first attempt, with no backoff and no
 * onRetry callback — the old behaviour retried a refused login four times.
 */
import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry.js';
import { isTransient } from '../reader/errorClass.js';

const transient = (): Error => Object.assign(new Error('socket hang up'), { code: 'ESOCKET' });
const refused = (): Error => Object.assign(new Error('Login failed'), { code: 'ELOGIN' });

describe('withRetry with retryOn', () => {
  it('retries a transient failure and returns the eventual success', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw transient();
        return 'ok';
      },
      { retries: 4, baseMs: 1, retryOn: isTransient, onRetry },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('gives up immediately on a non-transient failure: one call, no onRetry', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    await expect(
      withRetry(
        async () => {
          calls++;
          throw refused();
        },
        { retries: 4, baseMs: 1, retryOn: isTransient, onRetry },
      ),
    ).rejects.toThrow(/Login failed/);
    expect(calls).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('without retryOn the old behaviour holds: every error is retried', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw refused();
        },
        { retries: 2, baseMs: 1 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it('a transient failure that never clears is thrown after the last attempt', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw transient();
        },
        { retries: 2, baseMs: 1, retryOn: isTransient },
      ),
    ).rejects.toThrow(/socket hang up/);
    expect(calls).toBe(3);
  });
});
