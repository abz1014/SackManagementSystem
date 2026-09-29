/**
 * F-04 (FAILURE-ANALYSIS-2026-09-29.md, Task W2-C): from SQL alone SMS
 * cannot tell a stopped line from a stopped data recorder — IFL's
 * acquisition layer could stop while the line keeps running. `W.state.stopped`
 * / `stoppedUnknownDuration` (words.ts) used to assert "has been stopped",
 * a claim the data cannot support. This pins the reworded sentences: they
 * must name BOTH possibilities (the line, or the recorder) and must never
 * assert the line itself has stopped.
 */
import { describe, it, expect } from 'vitest';
import { W } from './words.js';

describe('F-04: line-stopped wording allows for a stopped recorder too', () => {
  it('W.state.stopped names both the line and the data recorder as possible causes', () => {
    const text = W.state.stopped('20 min');
    expect(text).toContain('20 min');
    expect(text).toMatch(/line/i);
    expect(text).toMatch(/recorder/i);
    expect(text).toMatch(/may have stopped/i);
    // Never overclaim that the LINE has stopped as settled fact.
    expect(text).not.toMatch(/^has been stopped/i);
  });

  it('W.state.stoppedUnknownDuration also names both possibilities', () => {
    const text = W.state.stoppedUnknownDuration;
    expect(text).toMatch(/line/i);
    expect(text).toMatch(/recorder/i);
    expect(text).toMatch(/may have stopped/i);
    expect(text).not.toMatch(/^has been stopped/i);
  });
});
