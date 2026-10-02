// C-141 / D-105: a GET that never answers must fail as an ApiError after 30 s,
// so the existing error/retry path shows instead of a skeleton forever.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getMe } from './api';

describe('api get() timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A fetch that never resolves on its own, but honours abort like the real one.
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: { signal?: AbortSignal }) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
      ),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects with ApiError after 30 s of silence', async () => {
    const p = getMe();
    const settled = p.then(() => 'ok', (e) => e);
    await vi.advanceTimersByTimeAsync(29_000);
    let early = true;
    void settled.then(() => { early = false; });
    await Promise.resolve();
    expect(early).toBe(true); // still pending before 30 s
    await vi.advanceTimersByTimeAsync(2_000);
    const err = await settled;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(408);
  });

  it('a prompt answer is unaffected and leaves no pending timer', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      new Response(JSON.stringify({ user: null }), { status: 200 }),
    );
    await expect(getMe()).resolves.toEqual({ user: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
