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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { renderWithLive } from '../../testkit/render';
import { LIVE_FIXTURE, OPERATIONS_FIXTURE } from '../../testkit/fixtures';
import { W } from '../../lib/words';
import { SyncHealthBlock } from './SyncHealthBlock';

// `fetchRouter.ts`'s own contract: "a test that installs its own router must
// restore it itself ... or rely on Vitest's own vi.unstubAllGlobals() in a
// project-wide afterEach, which this repo does not configure." This file
// calls installFakeFetch() fresh inside every `it()` without ever restoring
// it (found during the D-7 flake hunt, DEFECTS.md — not itself the D-7
// mechanism, but a real violation of the same contract). Harmless today
// because each `it()` reinstalls a full route set before rendering, but a
// stacked, never-restored fake fetch is exactly the kind of latent
// cross-test contamination that race was hard to diagnose because of.
afterEach(() => {
  vi.unstubAllGlobals();
});

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

/**
 * The verdict must be EXHAUSTIVE over LiveHealthKind (web/src/api.ts:1113:
 * 'ok'|'stale'|'late'|'lag_unknown'|'no_data'), found live 25 Sep 2026: the
 * verdict only branched on 'stale'/'late' and fell through to W.sync.ok for
 * anything else, so a real server response of 'lag_unknown' or 'no_data'
 * printed "The plant connection is healthy." — a false all-clear on the one
 * screen whose job is to report breakage. One case per real kind, plus an
 * unrecognised string standing in for a future kind this switch does not
 * know about yet, each asserting W.sync.ok is ABSENT (the two-sided partner
 * for the real 'ok' kind asserts the opposite: it is the only kind allowed
 * to print it).
 */
function liveWithHealthKind(kind: string): typeof LIVE_FIXTURE {
  const clone = JSON.parse(JSON.stringify(LIVE_FIXTURE)) as typeof LIVE_FIXTURE;
  clone.data.lines[0]!.health.kind = kind as never;
  return clone;
}

describe('SyncHealthBlock — the verdict is exhaustive over LiveHealthKind (found live, 25 Sep 2026)', () => {
  it('ok: prints the healthy sentence — the only kind allowed to', async () => {
    installFakeFetch({ '/api/live': liveWithHealthKind('ok'), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(W.sync.ok);
  });

  it('stale: never prints W.sync.ok', async () => {
    installFakeFetch({ '/api/live': liveWithHealthKind('stale'), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(W.sync.stale);
    expect(queryByText(W.sync.ok)).toBeNull();
  });

  it('late: never prints W.sync.ok', async () => {
    installFakeFetch({ '/api/live': liveWithHealthKind('late'), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(/Readings are arriving/);
    expect(queryByText(W.sync.ok)).toBeNull();
  });

  it('lag_unknown: a reading has arrived but its lag is unmeasured — never prints W.sync.ok', async () => {
    installFakeFetch({ '/api/live': liveWithHealthKind('lag_unknown'), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(W.sync.lagUnknown);
    expect(queryByText(W.sync.ok)).toBeNull();
  });

  it('no_data: nothing has arrived — never prints W.sync.ok', async () => {
    installFakeFetch({ '/api/live': liveWithHealthKind('no_data'), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(W.lag.noData);
    expect(queryByText(W.sync.ok)).toBeNull();
  });

  it('an unrecognised kind (a future value this switch does not know about yet): reads as "could not be read", never as OK', async () => {
    installFakeFetch({ '/api/live': liveWithHealthKind('something_new'), '/api/operations': OPERATIONS_FIXTURE });
    const { findByText, queryByText } = renderWithLive(<SyncHealthBlock isAdmin={false} />);
    await findByText(W.sync.unknownKind);
    expect(queryByText(W.sync.ok)).toBeNull();
  });
});
