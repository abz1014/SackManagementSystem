import { describe, expect, it } from 'vitest';
import { assessHealth, stateIsKnowable, LAG_CEILING_SECONDS, SYNC_STALE_AFTER_SECONDS } from './health';
import type { LiveLine, Meta } from '../api';

const meta = (sourceAgeSeconds: number | null): Meta => ({
  generatedAtUtc: '2026-09-03T05:13:54.000Z',
  weightBasis: 'as_recorded',
  shiftMode: 'corrected',
  transformVersion: 3,
  lastSyncUtc: '2026-09-03T05:13:54.000Z',
  sourceAgeSeconds,
});

/** A healthy running line: newest reading one acquisition lag old. */
const line = (over: Partial<LiveLine> = {}): LiveLine =>
  ({
    lineId: 1,
    lineName: 'TP1 · Line 3 · Unit 2',
    plantNowUtc: '2026-09-03T10:13:54.000Z',
    replay: false,
    shift: {
      code: 'morning',
      shiftDate: '2026-09-03',
      startUtc: '2026-09-03T06:00:00.000Z',
      endUtc: '2026-09-03T14:00:00.000Z',
      elapsedSeconds: 15234,
      remainingSeconds: 13566,
    },
    dataAsOfUtc: '2026-09-03T09:57:36.000Z',
    ingestLagSeconds: 970,
    state: {
      status: 'running',
      sinceLastConeSeconds: 978,
      behindSeconds: 8,
      runStartUtc: '2026-09-03T06:02:00.000Z',
      stopThresholdSeconds: 120,
    },
    thisShift: {
      cones: 3408, conesInRange: 3397, conesInRangePct: 99.7,
      rejectedCones: 89, sacks: 148, sackWeightKg: 6987, conesPerHour: 812,
    },
    recent: { conesLast10Min: 132, conesLastHour: 798, sacksLastHour: 34 },
    lastSack: null,
    lastCone: null,
    lastReject: null,
    stations: [],
    ...over,
  }) as LiveLine;

describe('assessHealth', () => {
  it('reports healthy for a running line whose newest reading is one acquisition lag old', () => {
    // The whole point of the lag correction: 16 minutes behind is NORMAL.
    const h = assessHealth(line(), meta(0));
    expect(h).toEqual({ kind: 'ok', readingUtc: '2026-09-03T09:57:36.000Z', lagSeconds: 970 });
    expect(stateIsKnowable(h)).toBe(true);
  });

  it('reports stale as soon as the sync worker misses three cadences', () => {
    const h = assessHealth(line(), meta(SYNC_STALE_AFTER_SECONDS + 1));
    expect(h.kind).toBe('stale');
    expect(stateIsKnowable(h)).toBe(false);
  });

  it('is still healthy at exactly three cadences, so a slow pass is not an alarm', () => {
    expect(assessHealth(line(), meta(SYNC_STALE_AFTER_SECONDS)).kind).toBe('ok');
  });

  it('treats a sync that has never succeeded as stale, not as healthy', () => {
    expect(assessHealth(line(), meta(null)).kind).toBe('stale');
    expect(assessHealth(line(), null).kind).toBe('stale');
  });

  it('STALE OUTRANKS THE LINE STATE: a stopped sync must not be read as a stopped line', () => {
    // This is the regression the whole module exists for. The line reports
    // itself running; the pipeline has gone quiet; the screen must refuse to
    // assert either way rather than inherit the line's own claim.
    const h = assessHealth(line({ state: { ...line().state, status: 'running' } }), meta(600));
    expect(h.kind).toBe('stale');
    expect(stateIsKnowable(h)).toBe(false);
  });

  it('reports a lag beyond the credible ceiling, keeping the figures but not the state', () => {
    const h = assessHealth(line({ ingestLagSeconds: LAG_CEILING_SECONDS + 60 }), meta(10));
    expect(h).toMatchObject({ kind: 'late', lagSeconds: LAG_CEILING_SECONDS + 60 });
    expect(stateIsKnowable(h)).toBe(false);
  });

  it('does not treat a lag exactly at the ceiling as late', () => {
    expect(assessHealth(line({ ingestLagSeconds: LAG_CEILING_SECONDS }), meta(10)).kind).toBe('ok');
  });

  it('reports nothing-yet when no reading has ever arrived', () => {
    expect(assessHealth(line({ dataAsOfUtc: null }), meta(0))).toEqual({ kind: 'none' });
    expect(assessHealth(null, meta(0))).toEqual({ kind: 'none' });
  });

  it('a replay is healthy regardless of sync freshness, because it is pinned to a past instant', () => {
    // Otherwise every demo would open under a red "the plant link may be down"
    // banner that is true of the clock and false of the data being shown.
    const h = assessHealth(line({ replay: true }), meta(99_999));
    expect(h.kind).toBe('ok');
  });

  it('never invents a lag: an unmeasurable lag stays null rather than defaulting', () => {
    const h = assessHealth(line({ ingestLagSeconds: null }), meta(0));
    expect(h).toMatchObject({ kind: 'ok', lagSeconds: null });
  });
});
