/**
 * WS-CN (23 Sep 2026, RT-002/RT-029/WS-R follow-up). `register.ts`'s
 * `listEvents` (410c179) now names, via `RegisterPage.dataIssues`, when its
 * own pooled tally could not read a generation's count row — the crash it
 * guards against is a malformed/absent `n` column turning into `NaN`, which
 * `JSON.stringify` serialises as `null`. `Sacks.tsx`'s History block used to
 * read `rows.data?.data.total ?? 0` and route straight to `<Empty>` on zero,
 * with no way to tell a genuine empty period apart from a hole in the tally
 * while `rows` (a separate query, unaffected by the tally's own
 * malformation) still held real data — `reliability.guard.test.ts`'s
 * `ALLOW_LIST_ZERO` held this open by name pending exactly this fix.
 *
 * Both sides of the contract are asserted: a genuine empty period still
 * reads as empty (never "count unknown"), and a hole reads as "count
 * unknown" (never `<Empty>`), whether or not `rows` itself came back empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from './testkit/fetchRouter';
import { renderWithLive } from './testkit/render';
import { LIVE_FIXTURE, META_FIXTURE, REGISTER_PAGE_FIXTURE } from './testkit/fixtures';
import { W } from './lib/words';
import type { Period } from './lib/period';
import { History } from './screens/Sacks';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift',
  from: '2026-09-07',
  to: '2026-09-07',
  tsFrom: '2026-09-07T09:00:00Z',
  tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening',
  live: true,
  days: 1,
};

const SAMPLE_ROW = REGISTER_PAGE_FIXTURE.data.rows[0]!;

function noop(): void {}

function baseProps() {
  return { period: PERIOD, page: 1, onPageChange: noop, onOpenReading: noop };
}

describe('Sacks — History (dataIssues consumption)', () => {
  it('RED 1 / two-sided (a): a hole in the tally — total: null-ish, dataIssues names it, rows still present — reads as "count unknown", never <Empty>', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/events': {
        data: {
          rows: [SAMPLE_ROW],
          // The wire shape WS-R's fix guards against: a malformed tally row
          // serialises `total` as `null` over JSON. `total: null as any`
          // reproduces exactly what a pre-fix server, or a stale client
          // reading a still-broken field, would have received.
          total: null as unknown as number,
          page: 1,
          pageSize: 50,
          dataIssues: [{ field: 'total', generation: 'DATA_TP1U2#1', reason: 'tally row is missing its count (n)' }],
        },
        metadata: META_FIXTURE,
      },
    });

    const { findAllByText, queryByText, container } = renderWithLive(<History {...baseProps()} />);

    await waitFor(async () => expect(await findAllByText(W.sacks.historyCountUnknown)).toHaveLength(1));
    expect(queryByText(W.readings.nothing)).toBeNull();
    // The real row that arrived must still be on screen — a hole in the
    // COUNT must never hide the LISTING that came back fine.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('two-sided (b): a genuine empty period — total: 0, no dataIssues — still reads as <Empty>, never "count unknown"', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/events': {
        data: { rows: [], total: 0, page: 1, pageSize: 50, dataIssues: [] },
        metadata: META_FIXTURE,
      },
    });

    const { findByText, queryByText } = renderWithLive(<History {...baseProps()} />);

    await findByText(W.readings.nothing);
    expect(queryByText(W.sacks.historyCountUnknown)).toBeNull();
  });
});
