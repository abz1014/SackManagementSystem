/**
 * `Failed` (./bits.tsx) — the shared failure state every `usePolling` screen
 * renders. RT24-13/RT-014 (ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md): the
 * API now answers 413 `{error:'result too large', limit, hint}` instead of
 * letting an unbounded query run (RT-014, tracked open since the first
 * red-team pass). Before this test, a 413 read exactly like any other
 * outage — `W.couldNotLoad`, "the plant connection may be down" — which
 * sends a reader to check the plant link for a fault that is actually
 * "your own request asked for too much". `usePolling` (lib/live.tsx) now
 * encodes the status a thrown `ApiError` carries into the string it hands
 * `Failed` (`[<status>] <message>`), the same idea `Failed`'s existing
 * `refused` branch already used for "insufficient role"/"authentication
 * required" — this file proves the 413 branch the same way.
 *
 * UX Phase 8 Brief A's harness (`testkit/render.tsx`) is not needed here:
 * `Failed` takes its error as a plain prop, no `useLive()`/fetch involved.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../testkit/render';
import { Failed } from './bits';
import { W } from '../lib/words';

describe('Failed — 413 (RT-014, "too much data") reads as its own sentence, not the generic outage one', () => {
  it('error carrying a [413]-prefixed message: shows the plain-English "narrow your request" sentence, not "the plant connection may be down"', () => {
    const { getByRole, queryByText } = render(<Failed error="[413] result too large" />);
    const status = getByRole('status');
    expect(status.textContent).toContain(W.errorDisplay.tooMuchData);
    expect(status.textContent).not.toContain(W.couldNotLoad);
    expect(queryByText(W.notAllowed)).toBeNull();
  });

  it('two-sided partner: an ordinary error (no status prefix, e.g. a network failure) still reads as the generic outage sentence, not the 413 one — proves the 413 branch is not swallowing every error', () => {
    const { getByRole } = render(<Failed error="Failed to fetch" />);
    const status = getByRole('status');
    expect(status.textContent).toContain(W.couldNotLoad);
    expect(status.textContent).not.toContain(W.errorDisplay.tooMuchData);
  });

  it('two-sided partner: a 403/401 refusal still reads as "not allowed", not the 413 sentence', () => {
    const { getByRole } = render(<Failed error="insufficient role" />);
    const status = getByRole('status');
    expect(status.textContent).toContain(W.notAllowed);
    expect(status.textContent).not.toContain(W.errorDisplay.tooMuchData);
  });
});
