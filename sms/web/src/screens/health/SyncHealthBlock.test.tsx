/**
 * UX Phase 8 Brief C: the failed-fetch-reads-as-zero defect class, locked
 * down for `SyncHealthBlock` (Health's own copy — `isAdmin={false}` so only
 * `/api/operations` and `/api/live` are in play; the admin-only
 * `/api/admin/sources` call is skipped by the component itself,
 * `SyncHealthBlock.tsx:112`).
 *
 * Every case here is two-sided on purpose (CLAUDE.md's own rule for this
 * phase): a test that only proves the failure sentence would pass equally
 * against a screen that prints "could not load" unconditionally, which is a
 * different bug from the one this phase exists to close. Each failure case
 * also asserts the ABSENCE of the specific false sentence it used to print,
 * naming the forbidden string rather than leaving it implicit.
 *
 * UX Phase 8 Brief C (21 Sep 2026).
 */
import { describe, expect, it } from 'vitest';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { renderWithLive } from '../../testkit/render';
import { LIVE_FIXTURE, OPERATIONS_FIXTURE } from '../../testkit/fixtures';
import { W } from '../../lib/words';
import { SyncHealthBlock } from './SyncHealthBlock';

describe('SyncHealthBlock — /api/operations blocking-findings figure', () => {
  it('REJECTS: reads dqBlockingCouldNotLoad, and the page never prints the bare "None" it used to show blind', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/operations': () => {
        throw new Error('network down');
      },
    });

    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);

    await findByText(W.health.dqBlockingCouldNotLoad);
    // words.ts:941 — W.sync.none is the literal string 'None'. Printing it
    // while the findings count could not be read was the worst defect in
    // the application (CLAUDE.md's "why this phase exists").
    expect(queryByText(W.sync.none)).toBeNull();
  });

  it('RESOLVES with zero findings: the SAME figure reads W.sync.none — a genuine zero must still read as a zero', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/operations': OPERATIONS_FIXTURE, // dq.findings: [] — a real, loaded zero
    });

    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);

    await findByText(W.sync.none);
    // The two-sided half of the case above: this must NOT read as "could not load".
    expect(queryByText(W.health.dqBlockingCouldNotLoad)).toBeNull();
  });
});

describe('SyncHealthBlock — the DQ-findings disclosure', () => {
  it('REJECTS: shows the Failed component, never "No data quality findings are open."', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/operations': () => {
        throw new Error('network down');
      },
    });

    const { findAllByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);

    // Failed (ui/bits.tsx:210-229) renders W.couldNotLoad on a total
    // failure — both this screen's Details disclosures (dq findings and
    // per-table) share the same ops.error, so at least one instance must
    // appear.
    const failed = await findAllByText(W.couldNotLoad);
    expect(failed.length).toBeGreaterThan(0);
    // SyncHealthBlock.tsx:211 — the honest-zero sentence, which a blind
    // fetch must never be confused with.
    expect(queryByText(W.health.dqFindingsNone)).toBeNull();
  });
});
