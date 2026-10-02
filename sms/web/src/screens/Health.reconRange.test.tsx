/**
 * C-175 (D-95): Health's reconciliation block resolved the period without the
 * URL's shift range, so a `p=range` page showed a different population than
 * every other screen. The request must carry fromShift/toShift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, OPERATIONS_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import { HealthScreen } from './Health';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const AGG = { n: 0, sumG: null, avgG: null, minG: null, maxG: null };
const REC = {
  data: {
    from: '2026-09-06', to: '2026-09-07', shift: null, total: AGG, plausible: AGG, implausible: AGG, noWeight: 0,
    byState: { within: AGG, low: AGG, high: AGG, rejected: AGG, unknown: AGG },
    plausibility: { loG: 0, hiG: 5000 }, limitWindows: 0, basis: 'as_recorded', note: 'test fixture',
  },
  metadata: META_FIXTURE,
};

describe('Health — reconciliation honours a shift range (C-175)', () => {
  it('requests fromShift/toShift when the URL carries a range', async () => {
    window.history.replaceState(null, '', '/?s=health&p=range&from=2026-09-06.evening&to=2026-09-07.night');
    const ff = installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/operations': OPERATIONS_FIXTURE,
      '/api/health': { status: 'ok', service: {}, database: {}, acquisition: { kind: 'ok' }, backup: {}, disk: {} },
      '/api/reconciliation': REC,
      '/api/system-history': { data: { generations: [], rebuilds: [], verifyRuns: [] }, metadata: META_FIXTURE },
    });
    renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await waitFor(() => expect(ff.requests.some((r) => r.startsWith('/api/reconciliation'))).toBe(true));
    const req = ff.requests.find((r) => r.startsWith('/api/reconciliation'))!;
    expect(req).toContain('fromShift=2026-09-06.evening');
    expect(req).toContain('toShift=2026-09-07.night');
  });
});
