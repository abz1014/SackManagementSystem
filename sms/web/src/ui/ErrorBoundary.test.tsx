/**
 * Mounts the real `ErrorBoundary` (`./ErrorBoundary.tsx`) and forces a child
 * to throw — the DOM-dependent half `ErrorBoundary.test.ts` could not cover
 * (see that file's header). Runs under `jsdom` via `vitest.config.ts`'s
 * `environmentMatchGlobs`, keyed on this file's `.test.tsx` extension.
 *
 * UX Phase 8 Brief A (21 Sep 2026).
 */
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../testkit/render';
import { ErrorBoundary, WALL_RETRY_DELAY_MS } from './ErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

describe('ErrorBoundary — variant="default"', () => {
  it('renders the fallback headline, and "Back to Line" points at window.location.pathname (query dropped on purpose)', () => {
    // A real route with ?s=…&sheet=… on it, so the assertion below proves
    // the link drops the query rather than merely happening not to have one.
    window.history.pushState({}, '', '/?s=sacks&sheet=changeover:5');

    const { getByText, getByRole } = render(
      <ErrorBoundary variant="default">
        <Boom />
      </ErrorBoundary>,
    );

    expect(getByText('This screen failed.')).toBeTruthy();
    expect(getByText('boom')).toBeTruthy();

    // ErrorBoundary.tsx:141-146 — a REAL navigation back to the bare path,
    // deliberately dropping ?s=…&sheet=…: client-side routing is exactly the
    // code that just threw, so "Back to Line" cannot rely on it. Pinned here
    // as DELIBERATE (audit/IA-PROPOSAL.md:679-681 calls the drop a loss; the
    // code's own comment calls it the Wall's only way back) — this test must
    // never be "fixed" to expect the query preserved.
    const link = getByRole('link', { name: 'Back to Line' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(window.location.pathname);
    expect(link.getAttribute('href')).toBe('/');
  });

  it('never auto-recovers outside the wall — no retry timer, fallback stays put', () => {
    vi.useFakeTimers();
    try {
      const { getByText, queryByText } = render(
        <ErrorBoundary variant="default">
          <Boom />
        </ErrorBoundary>,
      );
      expect(getByText('This screen failed.')).toBeTruthy();
      expect(queryByText(/will try to recover/i)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(WALL_RETRY_DELAY_MS * 2);
      });

      // Still failed — nothing scheduled a remount.
      expect(getByText('This screen failed.')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ErrorBoundary — variant="wall"', () => {
  it('remounts once, automatically, after WALL_RETRY_DELAY_MS, and shows the child once it stops throwing', async () => {
    vi.useFakeTimers();
    try {
      let shouldThrow = true;
      function Flaky() {
        if (shouldThrow) throw new Error('wall boom');
        return <div>board recovered</div>;
      }

      const { getByText, queryByText } = render(
        <ErrorBoundary variant="wall">
          <Flaky />
        </ErrorBoundary>,
      );

      expect(getByText('This screen failed.')).toBeTruthy();
      // The retry is pending, not yet fired — the fallback says so.
      expect(getByText(/will try to recover/i)).toBeTruthy();

      // Let the child succeed on the boundary's one automatic remount.
      shouldThrow = false;
      await act(async () => {
        vi.advanceTimersByTime(WALL_RETRY_DELAY_MS);
      });

      expect(queryByText('This screen failed.')).toBeNull();
      expect(getByText('board recovered')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles on the plain fallback, with no second retry scheduled, if the remounted child throws again', async () => {
    vi.useFakeTimers();
    try {
      function AlwaysThrows(): never {
        throw new Error('wall boom, again');
      }

      const { getByText, queryByText } = render(
        <ErrorBoundary variant="wall">
          <AlwaysThrows />
        </ErrorBoundary>,
      );

      expect(getByText(/will try to recover/i)).toBeTruthy();

      // The one automatic remount fires — and throws again.
      await act(async () => {
        vi.advanceTimersByTime(WALL_RETRY_DELAY_MS);
      });

      expect(getByText('This screen failed.')).toBeTruthy();
      expect(getByText('wall boom, again')).toBeTruthy();
      // Settled: no second retry is pending.
      expect(queryByText(/will try to recover/i)).toBeNull();

      // Advancing further confirms no second timer was ever scheduled.
      await act(async () => {
        vi.advanceTimersByTime(WALL_RETRY_DELAY_MS * 3);
      });
      expect(getByText('This screen failed.')).toBeTruthy();
      expect(queryByText(/will try to recover/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
