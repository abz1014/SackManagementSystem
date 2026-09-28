/**
 * Chart overhaul wave 2 (Task TB2, 28 Sep 2026): a shift-bounded period
 * clips the downtime RIBBON at its edges (`clipStoppagesToEdges`) rather
 * than filtering rows by `shift_date`/`shift_code` — see that function's
 * own doc for why. Pure, pool-free tests against the exported clipper.
 */
import { describe, expect, it } from 'vitest';
import { clipStoppagesToEdges, type Stoppage } from './downtime.js';

const EDGES = { fromMs: new Date('2026-09-02T06:00:00.000Z').getTime(), toMs: new Date('2026-09-03T06:00:00.000Z').getTime() };

describe('clipStoppagesToEdges', () => {
  it('a stoppage entirely inside the edges is returned unchanged', () => {
    const s: Stoppage = { startTs: '2026-09-02T10:00:00.000Z', endTs: '2026-09-02T10:05:00.000Z', durationSeconds: 300 };
    expect(clipStoppagesToEdges([s], EDGES)).toEqual([s]);
  });

  it('a stoppage straddling the START edge is clipped to it, duration shortened', () => {
    const s: Stoppage = { startTs: '2026-09-02T05:50:00.000Z', endTs: '2026-09-02T06:10:00.000Z', durationSeconds: 1200 };
    const [clipped] = clipStoppagesToEdges([s], EDGES);
    expect(clipped).toEqual({ startTs: '2026-09-02T06:00:00.000Z', endTs: '2026-09-02T06:10:00.000Z', durationSeconds: 600 });
  });

  it('a stoppage straddling the END edge is clipped to it, duration shortened', () => {
    const s: Stoppage = { startTs: '2026-09-03T05:50:00.000Z', endTs: '2026-09-03T06:10:00.000Z', durationSeconds: 1200 };
    const [clipped] = clipStoppagesToEdges([s], EDGES);
    expect(clipped).toEqual({ startTs: '2026-09-03T05:50:00.000Z', endTs: '2026-09-03T06:00:00.000Z', durationSeconds: 600 });
  });

  it('a stoppage entirely before or after the edges is dropped, not stubbed to zero length', () => {
    const before: Stoppage = { startTs: '2026-09-01T00:00:00.000Z', endTs: '2026-09-01T01:00:00.000Z', durationSeconds: 3600 };
    const after: Stoppage = { startTs: '2026-09-04T00:00:00.000Z', endTs: '2026-09-04T01:00:00.000Z', durationSeconds: 3600 };
    expect(clipStoppagesToEdges([before, after], EDGES)).toEqual([]);
  });

  it('a stoppage touching an edge exactly (zero overlap) is dropped', () => {
    const s: Stoppage = { startTs: '2026-09-01T05:00:00.000Z', endTs: EDGES_FROM_ISO(), durationSeconds: 3600 };
    expect(clipStoppagesToEdges([s], EDGES)).toEqual([]);
  });
});

function EDGES_FROM_ISO(): string {
  return new Date(EDGES.fromMs).toISOString();
}
