/**
 * `shouldAutoRecover` and `WALL_RETRY_DELAY_MS` are the only parts of
 * `ErrorBoundary.tsx` that do not need a DOM, so they are tested here in
 * full, in the plain `node` environment (`vitest.config.ts`).
 *
 * The class's actual catch/remount/fallback behaviour — mounting the real
 * boundary and forcing a child to throw — is tested in
 * `ErrorBoundary.test.tsx` (UX Phase 8 Brief A, 21 Sep 2026), which runs
 * under `jsdom` via `vitest.config.ts`'s `environmentMatchGlobs` on the
 * `.test.tsx` extension. `window.onerror`/`unhandledrejection` (registered
 * in `main.tsx`, not this file) remain checked by hand only.
 */
import { describe, expect, it } from 'vitest';
import { shouldAutoRecover, WALL_RETRY_DELAY_MS } from './ErrorBoundary';

describe('shouldAutoRecover', () => {
  it('recovers automatically on the wall, on the first catch', () => {
    expect(shouldAutoRecover('wall', false)).toBe(true);
  });

  it('does not recover a second time once the one wall retry has already run', () => {
    expect(shouldAutoRecover('wall', true)).toBe(false);
  });

  it('never recovers automatically on any other screen, retried or not', () => {
    expect(shouldAutoRecover('default', false)).toBe(false);
    expect(shouldAutoRecover('default', true)).toBe(false);
  });

  it('never recovers automatically when no variant is given', () => {
    expect(shouldAutoRecover(undefined, false)).toBe(false);
  });

  it('caps the wall at exactly one attempt, never a remount loop', () => {
    // Simulates the sequence componentDidCatch actually runs: the first
    // catch asks whether to schedule a retry (yes), the retry lands and
    // flips `retried`, and if the same screen throws again immediately the
    // second catch must NOT schedule another timer.
    let retried = false;
    expect(shouldAutoRecover('wall', retried)).toBe(true);
    retried = true;
    expect(shouldAutoRecover('wall', retried)).toBe(false);
  });
});

describe('WALL_RETRY_DELAY_MS', () => {
  it('is long enough that the remount is not effectively instantaneous', () => {
    // Guards against a future edit collapsing this to 0 — a delay that
    // short would turn a genuine, repeating throw into a tight render loop
    // rather than one considered second chance.
    expect(WALL_RETRY_DELAY_MS).toBeGreaterThanOrEqual(1000);
  });
});
