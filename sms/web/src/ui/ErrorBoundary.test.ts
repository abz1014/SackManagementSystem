/**
 * `shouldAutoRecover` and `WALL_RETRY_DELAY_MS` are the only parts of
 * `ErrorBoundary.tsx` that do not need a DOM: the class itself is a real
 * React error boundary and can only be exercised by mounting it and forcing
 * a child to throw, which needs `environment: 'jsdom'` (or similar) on the
 * test file. This project's root `vitest.config.ts` runs `environment:
 * 'node'` and only collects `**\/src/**\/*.test.ts` — a `.tsx` component
 * test is not picked up at all — so the class's actual catch/remount/
 * fallback behaviour, and the two `window` handlers registered in
 * `main.tsx`, are UNTESTED by this suite. They were checked by hand instead:
 * a thrown error inside a screen shows the fallback with the top bar still
 * standing beside it; on Wall it remounts once on its own after
 * `WALL_RETRY_DELAY_MS` and shows the plain fallback if the throw recurs;
 * `window.onerror` and `unhandledrejection` both reach the console for an
 * uncaught throw and a rejected promise respectively.
 *
 * What IS pure — the decision of whether a catch should schedule Wall's one
 * automatic remount — is tested here in full.
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
