import { describe, expect, it } from 'vitest';
import { keepDataAcrossKeyChange } from './live';

/**
 * usePolling(...) itself can't be rendered in this suite (vitest.config.ts
 * runs the `node` environment, no DOM). What it decides when a key changes
 * mid-flight is pulled out as `keepDataAcrossKeyChange` for exactly this
 * reason — see the defect this guards against in live.tsx's usePolling
 * doc comment: a failed refetch after a key change used to leave the
 * PREVIOUS key's data on screen under the NEW key's heading.
 */
describe('keepDataAcrossKeyChange', () => {
  it('same key (a poll tick, a manual refresh, a tab regaining focus): keep the last good data', () => {
    expect(keepDataAcrossKeyChange('line-totals:2026-09-07:2026-09-07:all:', 'line-totals:2026-09-07:2026-09-07:all:')).toBe(true);
  });

  it('changed key: discard, even though the only thing that happened is a failure', () => {
    expect(keepDataAcrossKeyChange('line-totals:2026-09-06:2026-09-06:all:', 'line-totals:2026-09-07:2026-09-07:all:')).toBe(false);
  });

  it('changed key with a successful fetch: the hook always applies the new data on success regardless of this decision, but the decision must still say discard so a fetch still in flight cannot render the old period', () => {
    expect(keepDataAcrossKeyChange('stations:1', 'stations:2')).toBe(false);
  });

  it('first load, no previous key yet: nothing to keep, so discard (a no-op against the initial null data)', () => {
    expect(keepDataAcrossKeyChange(null, 'live:now')).toBe(false);
  });
});
