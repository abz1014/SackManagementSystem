/**
 * W1-C (29 Sep 2026, failure analysis F-15/F-13/F-11/F-36): the new Health
 * states this pass added to `api/src/services/health.ts` — backup verified
 * vs not, free disk, the last manual `sms verify` run, and the recorder's
 * own heartbeat beside the newest reading's time — must actually render on
 * the Health screen in plain words. Each case here is red-first in spirit:
 * before this pass, none of these facts existed on the wire at all, so a
 * regression that stops threading them through would have nothing here to
 * fail against except these assertions.
 *
 * Every network call HealthScreen makes with `isAdmin={false}` is stubbed —
 * `/api/admin/sources` is admin-only and skipped by SyncHealthBlock itself
 * (see SyncHealthBlock.test.tsx's own header comment).
 */
import { afterEach, describe, it, vi } from 'vitest';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, OPERATIONS_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import { HealthScreen } from './Health';
import type { Envelope, HealthReport, ReconciliationData, SystemHistoryData } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const RECONCILIATION_FIXTURE: Envelope<ReconciliationData> = {
  data: {
    from: '2026-09-07', to: '2026-09-07', shift: null,
    total: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    plausible: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    implausible: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    noWeight: 0,
    byState: {
      within: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      low: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      high: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      rejected: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
      unknown: { n: 0, sumG: null, avgG: null, minG: null, maxG: null },
    },
    plausibility: { loG: 0, hiG: 5000 },
    limitWindows: 0,
    basis: 'as_recorded',
    note: 'test fixture',
  },
  metadata: META_FIXTURE,
};

const SYSTEM_HISTORY_FIXTURE: Envelope<SystemHistoryData> = {
  data: { generations: [], rebuilds: [], verifyRuns: [] },
  metadata: META_FIXTURE,
};

const BASE_HEALTH: HealthReport = {
  status: 'ok',
  service: { version: '1.0.0', uptimeSeconds: 3600, startedAtUtc: '2026-09-07T00:00:00.000Z', pid: 1 },
  database: { ok: true, latencyMs: 4, sizeMb: 120, capMb: 10240, pctOfCap: 1.2 },
  acquisition: { kind: 'ok', ageSeconds: 42, cadenceSeconds: 60, halted: [], generation: null },
  backup: { dir: 'C:\\sms-backups', newestFile: 'sms-20260929-020000.bak', newestAtUtc: '2026-09-29T02:00:00.000Z', ageDays: 0.5, warning: false, verified: true, newestUnverified: false },
  degradedReason: null,
  pdasWrite: null,
  disk: { appDataFreeMb: 5000, backupFreeMb: 5000 },
  lastVerifyRunUtc: '2026-09-28T10:00:00.000Z',
  workerLastPassUtc: '2026-09-29T11:55:00.000Z',
  dqAcknowledged: 0,
};

function routesFor(health: HealthReport) {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/operations': OPERATIONS_FIXTURE,
    '/api/health': health, // api.ts's getHealth() returns HealthReport directly — no Envelope wrapper (unauthenticated monitor probe)
    '/api/reconciliation': RECONCILIATION_FIXTURE,
    '/api/system-history': SYSTEM_HISTORY_FIXTURE,
  };
}

describe('HealthScreen — backup verification state', () => {
  it('a verified backup reads as proven restorable', async () => {
    installFakeFetch(routesFor(BASE_HEALTH));
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/proven restorable/);
  });

  it('an unverified newest backup says so, and names that an older one is what the figures describe', async () => {
    installFakeFetch(
      routesFor({
        ...BASE_HEALTH,
        backup: { dir: 'C:\\sms-backups', newestFile: 'sms-20260928-020000.bak', newestAtUtc: '2026-09-28T02:00:00.000Z', ageDays: 1.5, warning: true, verified: true, newestUnverified: true },
      }),
    );
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/proven restorable/); // the OLDER, verified file's own status
    await findByText(/newer backup file exists but has not verified yet/);
  });

  it('no verified backup at all: never claims trustworthiness', async () => {
    installFakeFetch(
      routesFor({
        ...BASE_HEALTH,
        backup: { dir: 'C:\\sms-backups', newestFile: null, newestAtUtc: null, ageDays: null, warning: true, verified: false, newestUnverified: false },
      }),
    );
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/No verified backup was found/);
  });
});

describe('HealthScreen — free disk space', () => {
  it('states free space on both volumes when healthy', async () => {
    installFakeFetch(routesFor(BASE_HEALTH));
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/App\/database volume: 4\.9 GB free\./);
    await findByText(/Backup volume: 4\.9 GB free\./);
  });

  it('a low-disk volume prints the warning sentence naming the threshold', async () => {
    installFakeFetch(routesFor({ ...BASE_HEALTH, status: 'degraded', disk: { appDataFreeMb: 500, backupFreeMb: 9000 } }));
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/Only 0\.5 GB free — below the 2\.0 GB warning line\./);
  });
});

describe('HealthScreen — last manual verify run', () => {
  it('states the last run instant when one is on record', async () => {
    installFakeFetch(routesFor(BASE_HEALTH));
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/Last "sms verify" run:/);
  });

  it('states plainly when none is on record — informational, not a failure', async () => {
    installFakeFetch(routesFor({ ...BASE_HEALTH, lastVerifyRunUtc: null }));
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/No manual "sms verify" run is on record/);
  });
});

describe('HealthScreen — recorder heartbeat vs newest reading', () => {
  it('states both the recorder check-in time and the newest reading time', async () => {
    installFakeFetch(routesFor(BASE_HEALTH));
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/The recorder last checked in at .* — newest reading at /);
  });

  it('the recorder having never checked in is stated plainly', async () => {
    installFakeFetch(routesFor({ ...BASE_HEALTH, workerLastPassUtc: null }));
    const { findByText } = renderWithLive(<HealthScreen isAdmin={false} onOpenReading={() => {}} />);
    await findByText(/The recorder has never checked in\./);
  });
});
