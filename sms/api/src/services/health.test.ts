/**
 * services/health.ts (roadmap Phase 11 item 2, 14 Sep 2026): the pure fold
 * from three facts to one word, the backup-age reader over a fake directory,
 * and getHealth's redaction with every probe stubbed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ConnectionPool } from 'mssql';
import {
  backupHealth,
  clearDegraded,
  degradedReasons,
  diskHealth,
  foldStatus,
  freeDiskMb,
  FREE_DISK_WARN_MB,
  getHealth,
  markDegraded,
  serviceHealth,
  SERVICE_VERSION,
  type AcquisitionFacts,
  type BackupFs,
  type DiskFs,
} from './health.js';

const okDb = { ok: true, latencyMs: 3, sizeMb: 500 };
const okAcq: AcquisitionFacts = {
  kind: 'ok',
  ageSeconds: 30,
  cadenceSeconds: 60,
  halted: [],
  // One generation, nothing newer elsewhere — the ordinary shape at IFL, and
  // the one the redaction cases below assert is withheld from an anonymous
  // caller (23 Sep 2026, D-11).
  generation: {
    generation: { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: 'September copy', simulator: false },
    spansGenerations: false,
    otherGenerationExcluded: 0,
    newerElsewhereUtc: null,
    newerElsewhereSourceDb: null,
    newerElsewhereLabel: null,
    newerElsewhereSimulator: false,
  },
};
/** foldStatus's own positional args beyond (db, acq, degradedNow): no
 *  blocking DQ findings, no backup warning — the "everything else is fine"
 *  baseline every other case in this describe block starts from. */
const clean = [0, false] as const;

beforeEach(() => clearDegraded());

describe('foldStatus', () => {
  it('down when the database did not answer, whatever else is true', () => {
    expect(foldStatus({ ok: false, latencyMs: null, sizeMb: null }, okAcq, false, ...clean)).toBe('down');
  });
  it('degraded when the pool reported an error since the last good probe', () => {
    expect(foldStatus(okDb, okAcq, true, ...clean)).toBe('degraded');
  });
  it('degraded at 80 % of the Express cap, ok just under', () => {
    expect(foldStatus({ ...okDb, sizeMb: 8192 }, okAcq, false, ...clean)).toBe('degraded');
    expect(foldStatus({ ...okDb, sizeMb: 8100 }, okAcq, false, ...clean)).toBe('ok');
  });
  it('degraded when the acquisition is stale, late or has a halted table', () => {
    expect(foldStatus(okDb, { ...okAcq, kind: 'stale' }, false, ...clean)).toBe('degraded');
    expect(foldStatus(okDb, { ...okAcq, kind: 'late' }, false, ...clean)).toBe('degraded');
    expect(foldStatus(okDb, { ...okAcq, halted: ['cone_raw'] }, false, ...clean)).toBe('degraded');
  });
  it('no_data is not a degradation — an empty database is not a broken one', () => {
    expect(foldStatus(okDb, { ...okAcq, kind: 'no_data' }, false, ...clean)).toBe('ok');
  });
  it('ok otherwise, including when acquisition could not be read', () => {
    expect(foldStatus(okDb, okAcq, false, ...clean)).toBe('ok');
    expect(foldStatus(okDb, null, false, ...clean)).toBe('ok');
  });

  /* THE DEFECT (21 Sep 2026, three independent audits): ?s=health printed
     "Everything is healthy." beside "Blocking findings: 2" and "Last backup
     8 days ago" in the same render, because foldStatus never read either
     fact. This is the regression case — it fails against the old two-arg
     foldStatus (TypeScript would refuse the call outright; the pre-fix
     *behaviour* it stands in for is foldStatus(okDb, okAcq, false) with
     these same blocking/backup facts silently discarded, which returned
     'ok') and passes now that both facts are folded in. */
  it('degraded when a standing ERROR/CRITICAL data-quality finding exists, even with nothing else wrong', () => {
    expect(foldStatus(okDb, okAcq, false, 2, false)).toBe('degraded');
  });
  it('ok when there are zero blocking findings and nothing else is wrong — proves the healthy path still exists', () => {
    expect(foldStatus(okDb, okAcq, false, 0, false)).toBe('ok');
  });
  it('degraded when the backup is stale, even with nothing else wrong', () => {
    expect(foldStatus(okDb, okAcq, false, 0, true)).toBe('degraded');
  });

  /* W1-C (29 Sep 2026, failure analysis F-36): free disk is a sixth signal,
     folded the same way as the others — a real number below the named
     threshold degrades; a null (could not be measured) or a number above it
     does not. Optional/defaulted so every OTHER case in this describe block,
     none of which passes a seventh argument, keeps meaning exactly what it
     meant before this signal existed. */
  it('degraded when free disk space is below FREE_DISK_WARN_MB, ok at or above it', () => {
    expect(foldStatus(okDb, okAcq, false, 0, false, FREE_DISK_WARN_MB - 1)).toBe('degraded');
    expect(foldStatus(okDb, okAcq, false, 0, false, FREE_DISK_WARN_MB)).toBe('ok');
  });
  it('an unmeasurable disk (null) never degrades on its own', () => {
    expect(foldStatus(okDb, okAcq, false, 0, false, null)).toBe('ok');
    expect(foldStatus(okDb, okAcq, false, ...clean)).toBe('ok'); // the un-extended call site still compiles and still means "clean"
  });
});

describe('backupHealth — verified backups only, ignoring anything this script did not produce', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0);

  /** Files keyed by basename; each optional `markerSize` becomes that
   *  basename's `.verified.json` (sizeBytes = markerSize) when present, and
   *  is left off entirely (no marker) when absent — the "never verified"
   *  case. `realSize` is what `size()` reports for the .bak itself. */
  const fakeFs = (
    files: Record<string, { mtimeMs: number; realSize?: number; markerSize?: number }>,
    opts: { failReaddir?: boolean } = {},
  ): BackupFs => {
    const names = Object.keys(files);
    return {
      readdir: () => {
        if (opts.failReaddir) throw new Error('ENOENT');
        const withMarkers = names.flatMap((n) => (files[n]!.markerSize != null ? [n, `${n}.verified.json`] : [n]));
        return withMarkers;
      },
      mtimeMs: (p) => {
        const name = p.split(/[\\/]/).pop()!.replace(/\.verified\.json$/, '');
        return files[name]!.mtimeMs;
      },
      size: (p) => {
        const name = p.split(/[\\/]/).pop()!;
        return files[name]?.realSize ?? 0;
      },
      readText: (p) => {
        const base = p.split(/[\\/]/).pop()!;
        if (!base.endsWith('.verified.json')) return null;
        const name = base.replace(/\.verified\.json$/, '');
        const f = files[name];
        if (f?.markerSize == null) return null;
        return JSON.stringify({ file: name, sizeBytes: f.markerSize, verifiedUtc: new Date(f.mtimeMs).toISOString(), method: 'RESTORE VERIFYONLY WITH CHECKSUM' });
      },
    };
  };

  it('picks the newest verified .bak, ignoring non-matching files, and is fine within two days', () => {
    const h = backupHealth(
      'C:\\sms-backups',
      fakeFs({
        'sms-20260913-020000.bak': { mtimeMs: now - 2.5 * 86_400_000, realSize: 100, markerSize: 100 },
        'sms-20260915-020000.bak': { mtimeMs: now - 10 * 3_600_000, realSize: 200, markerSize: 200 },
        'notes.txt': { mtimeMs: now },
        'sms-20260915-030000.BAK.tmp': { mtimeMs: now },
      }),
      now,
    );
    expect(h.newestFile).toBe('sms-20260915-020000.bak');
    expect(h.ageDays).toBe(0.4);
    expect(h.warning).toBe(false);
    expect(h.verified).toBe(true);
    expect(h.newestUnverified).toBe(false);
  });

  it('warns past two days on a verified backup', () => {
    const h = backupHealth('C:\\sms-backups', fakeFs({ 'sms-20260101-010000.bak': { mtimeMs: now - 2.1 * 86_400_000, realSize: 50, markerSize: 50 } }), now);
    expect(h.ageDays).toBe(2.1);
    expect(h.warning).toBe(true);
    expect(h.verified).toBe(true);
  });

  it('a missing directory or no matching .bak at all is the warning state, not an error', () => {
    expect(backupHealth('Z:\\none', fakeFs({}, { failReaddir: true }), now)).toEqual({
      dir: 'Z:\\none',
      newestFile: null,
      newestAtUtc: null,
      ageDays: null,
      warning: true,
      verified: false,
      newestUnverified: false,
    });
    expect(backupHealth('C:\\x', fakeFs({ 'readme.md': { mtimeMs: now } }), now).warning).toBe(true);
  });

  /* THE red-first case (W1-C brief): a newer .bak sits beside an older
     verified one. Before this pass, backupHealth picked by mtime alone and
     would have reported the newer, unverified file as if it were trustworthy. */
  it('a newer unverified .bak beside an older verified one: reports the older one, with a warning', () => {
    const h = backupHealth(
      'C:\\sms-backups',
      fakeFs({
        'sms-20260914-020000.bak': { mtimeMs: now - 1 * 86_400_000, realSize: 100, markerSize: 100 }, // older, verified
        'sms-20260915-020000.bak': { mtimeMs: now - 1 * 3_600_000, realSize: 999 }, // newer, no marker at all
      }),
      now,
    );
    expect(h.newestFile).toBe('sms-20260914-020000.bak');
    expect(h.verified).toBe(true);
    expect(h.newestUnverified).toBe(true);
    expect(h.warning).toBe(true);
  });

  /* Second red-first case: the newer file HAS a marker, but the marker's
     sizeBytes no longer matches the file's current size — a truncated or
     replaced backup must not be trusted just because a marker sits beside it. */
  it('a size-mismatch marker makes the newest .bak unverified; falls back to the older verified one', () => {
    const h = backupHealth(
      'C:\\sms-backups',
      fakeFs({
        'sms-20260914-020000.bak': { mtimeMs: now - 1 * 86_400_000, realSize: 100, markerSize: 100 },
        'sms-20260915-020000.bak': { mtimeMs: now - 1 * 3_600_000, realSize: 999, markerSize: 500 }, // marker present but wrong
      }),
      now,
    );
    expect(h.newestFile).toBe('sms-20260914-020000.bak');
    expect(h.newestUnverified).toBe(true);
    expect(h.warning).toBe(true);
  });

  it('nothing verified at all: reports the physically newest for context, never claims it is trustworthy', () => {
    const h = backupHealth(
      'C:\\sms-backups',
      fakeFs({
        'sms-20260914-020000.bak': { mtimeMs: now - 1 * 86_400_000, realSize: 100 },
        'sms-20260915-020000.bak': { mtimeMs: now - 1 * 3_600_000, realSize: 999 },
      }),
      now,
    );
    expect(h.newestFile).toBe('sms-20260915-020000.bak');
    expect(h.verified).toBe(false);
    expect(h.newestUnverified).toBe(true);
    expect(h.warning).toBe(true);
  });

  it('ignores a .bak not produced by this script — a PDAS backup or a manual dump, even one with a same-shaped marker beside it', () => {
    const h = backupHealth(
      'C:\\sms-backups',
      fakeFs({
        'PDAS_TP1U2_SEP07.bak': { mtimeMs: now, realSize: 100, markerSize: 100 }, // no date-time suffix: not our naming
        'sms_manual_dump.bak': { mtimeMs: now, realSize: 100, markerSize: 100 },
      }),
      now,
    );
    expect(h.newestFile).toBeNull();
    expect(h.warning).toBe(true);
  });

  /* Red-first (this pass): Windows PowerShell 5.1's `Set-Content -Encoding
     utf8` prepends a UTF-8 BOM (\uFEFF) to the marker file. JSON.parse
     rejects a leading BOM outright, so every marker backup-appdb.ps1 wrote
     was silently unparseable and backup.verified stayed false forever, even
     though the file itself is otherwise well-formed. This must parse the
     same as a BOM-less marker. */
  it('accepts a marker written with a leading UTF-8 BOM, same as a BOM-less one', () => {
    const bomFs: BackupFs = {
      readdir: () => ['sms-20260915-020000.bak', 'sms-20260915-020000.bak.verified.json'],
      mtimeMs: () => now - 10 * 3_600_000,
      size: () => 200,
      readText: (p) => {
        if (!p.endsWith('.verified.json')) return null;
        const marker = JSON.stringify({
          file: 'sms-20260915-020000.bak',
          sizeBytes: 200,
          verifiedUtc: new Date(now - 10 * 3_600_000).toISOString(),
          method: 'RESTORE VERIFYONLY WITH CHECKSUM',
        });
        return '\uFEFF' + marker; // the BOM PowerShell 5.1 prepends
      },
    };
    const h = backupHealth('C:\\sms-backups', bomFs, now);
    expect(h.newestFile).toBe('sms-20260915-020000.bak');
    expect(h.verified).toBe(true);
    expect(h.newestUnverified).toBe(false);
    expect(h.warning).toBe(false);
  });
});

describe('freeDiskMb / diskHealth — best-effort, never fatal', () => {
  it('MB from bavail × bsize', () => {
    const fs: DiskFs = { statfs: () => ({ availableBytes: 3 * 1024 * 1024 * 1024 }) }; // 3 GiB
    expect(freeDiskMb('C:\\', fs)).toBe(3072);
  });

  it('null when the platform/path cannot be statted, never throws', () => {
    const fs: DiskFs = { statfs: () => null };
    expect(freeDiskMb('Z:\\nope', fs)).toBeNull();
  });

  it('diskHealth measures both volumes independently — one failing does not blank the other', () => {
    const fs: DiskFs = {
      statfs: (p) => (p === 'C:\\app' ? { availableBytes: 5 * 1024 * 1024 * 1024 } : null),
    };
    const h = diskHealth('C:\\app', 'D:\\backups', fs);
    expect(h.appDataFreeMb).toBe(5120);
    expect(h.backupFreeMb).toBeNull();
  });
});

/**
 * RT24-12 (24 Sep 2026 red-team audit): `/api/health` used to answer
 * `status: "degraded"` with `degradedReason: null` even though
 * `acquisition.kind: "stale"` or `backup.warning` were true in the very
 * same payload — every degrading signal except a pool error (markDegraded)
 * left the field unpopulated. degradedReasons is the pure fold this pins.
 */
describe('degradedReasons — RT24-12', () => {
  it('a marked pool error wins outright, verbatim, over every other signal', () => {
    expect(degradedReasons(okDb, okAcq, 'pool error: x', 5, true, 'no backup found')).toBe('pool error: x');
  });

  it('null when nothing degraded', () => {
    expect(degradedReasons(okDb, okAcq, null, 0, false, null)).toBeNull();
  });

  it('names a stale/late acquisition with its age', () => {
    expect(degradedReasons(okDb, { ...okAcq, kind: 'stale', ageSeconds: 900 }, null, 0, false, null))
      .toBe('acquisition stale (age 900 s)');
    expect(degradedReasons(okDb, { ...okAcq, kind: 'late', ageSeconds: 400 }, null, 0, false, null))
      .toBe('acquisition late (age 400 s)');
  });

  it('names a halted table', () => {
    expect(degradedReasons(okDb, { ...okAcq, halted: ['cone_raw'] }, null, 0, false, null))
      .toBe('acquisition halted on cone_raw');
  });

  it('names blocking DQ findings, singular and plural', () => {
    expect(degradedReasons(okDb, okAcq, null, 1, false, null)).toBe('1 blocking data-quality finding');
    expect(degradedReasons(okDb, okAcq, null, 3, false, null)).toBe('3 blocking data-quality findings');
  });

  it('names a backup warning using the caller-supplied plain-English text', () => {
    expect(degradedReasons(okDb, okAcq, null, 0, true, 'no backup found')).toBe('backup: no backup found');
  });

  it('names the database size cap when over threshold', () => {
    expect(degradedReasons({ ...okDb, sizeMb: 8192 }, okAcq, null, 0, false, null))
      .toBe('database at 80% of its size cap');
  });

  it('joins more than one true signal with "; "', () => {
    expect(degradedReasons(okDb, { ...okAcq, kind: 'stale', ageSeconds: 900 }, null, 2, true, 'no backup found'))
      .toBe('acquisition stale (age 900 s); 2 blocking data-quality findings; backup: no backup found');
  });

  it('names the "newest backup not verified" text the same way as any other caller-supplied backup text', () => {
    expect(degradedReasons(okDb, okAcq, null, 0, true, 'newest backup not verified')).toBe('backup: newest backup not verified');
  });

  /* W1-C (29 Sep 2026): the sixth, optional signal. Every case above this
     one omits it and keeps meaning what it always meant (default null, no
     reason added). */
  it('names low disk space when supplied and below the threshold', () => {
    expect(degradedReasons(okDb, okAcq, null, 0, false, null, FREE_DISK_WARN_MB - 1))
      .toBe(`low disk space: ${FREE_DISK_WARN_MB - 1} MB free (below ${FREE_DISK_WARN_MB} MB)`);
    expect(degradedReasons(okDb, okAcq, null, 0, false, null, FREE_DISK_WARN_MB)).toBeNull();
    expect(degradedReasons(okDb, okAcq, null, 0, false, null, null)).toBeNull();
  });
});

describe('serviceHealth', () => {
  it('carries the package version and a non-negative uptime', () => {
    const s = serviceHealth();
    expect(s.version).toBe(SERVICE_VERSION);
    expect(s.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(s.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(s.pid).toBe(process.pid);
  });
});

describe('getHealth — redaction and the degraded marker', () => {
  const pool = {} as ConnectionPool;
  const deps = (over: Partial<Parameters<typeof getHealth>[2]> = {}) => ({
    probeDatabase: async () => okDb,
    acquisitionHealth: async () => okAcq,
    dqBlockingFindings: async () => 0,
    backupHealth: (dir: string) => ({ dir, newestFile: 'sms.bak', newestAtUtc: null, ageDays: 0.5, warning: false, verified: true, newestUnverified: false }),
    diskHealth: (appDataDir: string, backupDir: string) => ({ appDataFreeMb: 5000, backupFreeMb: 5000 }),
    workerLastPassUtc: async () => '2026-09-29T00:00:00.000Z',
    lastVerifyRunUtc: async () => null,
    now: () => Date.now(),
    ...over,
  });

  it('anonymous: status honest, details nulled', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: false }, deps());
    expect(h.status).toBe('ok');
    expect(h.database.sizeMb).toBeNull();
    expect(h.database.pctOfCap).toBeNull();
    expect(h.acquisition).toEqual({ kind: null, ageSeconds: null, generation: null, cadenceSeconds: null, halted: null });
    expect(h.backup).toBeNull();
    expect(h.disk).toBeNull();
    expect(h.lastVerifyRunUtc).toBeNull();
    expect(h.workerLastPassUtc).toBeNull();
  });

  /* THE DEFECT, at the getHealth level rather than the pure fold: the exact
     shape the live screen hit — a fully-reachable database, healthy
     acquisition, but 2 standing blocking findings and an 8-day-old backup.
     Before this fix neither fact reached `status`, so this returned 'ok'
     ("Everything is healthy.") beside the two contradicting facts the
     screen renders a few lines below. */
  it('a live-shaped case: healthy database and acquisition, but blocking DQ findings and a stale backup — status must not be ok', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: true },
      deps({
        dqBlockingFindings: async () => 2,
        backupHealth: (dir) => ({ dir, newestFile: 'sms-old.bak', newestAtUtc: null, ageDays: 8, warning: true, verified: true, newestUnverified: false }),
      }),
    );
    expect(h.status).toBe('degraded');
    expect(h.status).not.toBe('ok');
  });

  /* The other half of the same case, proven rather than assumed: with the
     blocking-findings count read back to zero and the backup fresh, the
     healthy status still appears — folding the new facts in did not just
     make everything permanently degraded. */
  it('the same shape with zero blocking findings and a fresh backup: status is ok', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: true },
      deps({ dqBlockingFindings: async () => 0, backupHealth: (dir) => ({ dir, newestFile: 'sms.bak', newestAtUtc: null, ageDays: 0.2, warning: false, verified: true, newestUnverified: false }) }),
    );
    expect(h.status).toBe('ok');
  });

  it('the DQ probe throwing (unmigrated database) does not fail the whole probe', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: true },
      deps({ dqBlockingFindings: async () => { throw new Error('Invalid object name sms.dq_finding'); } }),
    );
    expect(h.status).toBe('ok');
  });

  it('signed in: everything, and pctOfCap to one decimal', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: true }, deps());
    expect(h.database.sizeMb).toBe(500);
    expect(h.database.pctOfCap).toBe(4.9);
    expect(h.acquisition.halted).toEqual([]);
    expect(h.backup?.newestFile).toBe('sms.bak');
    expect(h.disk).toEqual({ appDataFreeMb: 5000, backupFreeMb: 5000 });
    expect(h.workerLastPassUtc).toBe('2026-09-29T00:00:00.000Z');
    expect(h.lastVerifyRunUtc).toBeNull();
  });

  it('the newest backup being unverified degrades status and names it in the plain-English reason', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: true },
      deps({
        backupHealth: (dir) => ({ dir, newestFile: 'sms-old.bak', newestAtUtc: null, ageDays: 0.1, warning: true, verified: true, newestUnverified: true }),
      }),
    );
    expect(h.status).toBe('degraded');
    expect(h.degradedReason).toBe('backup: newest backup not verified');
  });

  it('low disk space degrades status and names the volume figure', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: true },
      deps({ diskHealth: () => ({ appDataFreeMb: 500, backupFreeMb: 9000 }) }),
    );
    expect(h.status).toBe('degraded');
    expect(h.degradedReason).toBe(`low disk space: 500 MB free (below ${FREE_DISK_WARN_MB} MB)`);
    expect(h.disk).toEqual({ appDataFreeMb: 500, backupFreeMb: 9000 });
  });

  it('a missing sms.verify_run table (or the worker heartbeat query failing) does not fail the probe — both are informational only', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: true },
      deps({
        lastVerifyRunUtc: async () => { throw new Error("Invalid object name 'sms.verify_run'"); },
        workerLastPassUtc: async () => { throw new Error('Invalid object name sms.sync_run'); },
      }),
    );
    expect(h.status).toBe('ok');
    expect(h.lastVerifyRunUtc).toBeNull();
    expect(h.workerLastPassUtc).toBeNull();
  });

  it('lastVerifyRunUtc and workerLastPassUtc never move status, even when both report very old/never — informational only', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: true },
      deps({ lastVerifyRunUtc: async () => null, workerLastPassUtc: async () => null }),
    );
    expect(h.status).toBe('ok');
  });

  it('a pool error marks degraded until the next successful probe clears it', async () => {
    markDegraded('pool error: socket hang up');
    // The probe succeeding clears the marker: the pool recovered.
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: true }, deps());
    expect(h.status).toBe('ok');
    expect(h.degradedReason).toBeNull();
    // With the probe failing the marker stands and status is down anyway.
    markDegraded('pool error: again');
    const d = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: true }, deps({ probeDatabase: async () => ({ ok: false, latencyMs: null, sizeMb: null }) }));
    expect(d.status).toBe('down');
    expect(d.degradedReason).toMatch(/pool error: again/);
  });

  it('acquisition facts that cannot be read (unmigrated database) do not fail the probe', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: true }, deps({
      acquisitionHealth: async () => { throw new Error('Invalid object name sms.sync_run'); },
    }));
    expect(h.status).toBe('ok');
    expect(h.acquisition.kind).toBeNull();
  });

  /* RT24-12, at the getHealth level: before this fix, degradedReason stayed
     null here even though status read 'degraded' from the stale acquisition
     alone — the exact contradiction the finding names. */
  it('stale acquisition, authenticated: degraded with a non-null, descriptive reason', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: true }, deps({
      acquisitionHealth: async () => ({ ...okAcq, kind: 'stale', ageSeconds: 1234 }),
    }));
    expect(h.status).toBe('degraded');
    expect(h.degradedReason).toBe('acquisition stale (age 1234 s)');
  });

  it('stale acquisition, unauthenticated: status still degraded but degradedReason stays null', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: false }, deps({
      acquisitionHealth: async () => ({ ...okAcq, kind: 'stale', ageSeconds: 1234 }),
    }));
    expect(h.status).toBe('degraded');
    expect(h.degradedReason).toBeNull();
  });

  /* RT24-05: no `pdas` dep supplied at all (the shape every pre-existing
     test above uses) must behave exactly as before this fix — pdasWrite null,
     nothing else disturbed. */
  it('no pdas dep supplied: pdasWrite is null and nothing else changes', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: true }, deps());
    expect(h.pdasWrite).toBeNull();
    expect(h.status).toBe('ok');
  });

  it('anonymous caller: pdasWrite is redacted to null even when a pdas dep is supplied and enabled', async () => {
    const h = await getHealth(
      pool,
      { lineId: 1, backupDir: 'C:\\b', authenticated: false, pdas: { enabled: true, readbackStatus: () => ({ unverifiedSinceStartup: ['blend'], lastVerifiedUtc: null }), probePermissions: async () => ({ canReadBack: false, missingSelect: ['Blends'], missingExecute: [], checkedAtUtc: '2026-09-24T00:00:00.000Z' }) } },
      deps(),
    );
    expect(h.pdasWrite).toBeNull();
  });

  it('writes disabled: pdasWrite.enabled is false, the permission probe is never called, canReadBack null', async () => {
    let probed = false;
    const h = await getHealth(
      pool,
      {
        lineId: 1,
        backupDir: 'C:\\b',
        authenticated: true,
        pdas: {
          enabled: false,
          readbackStatus: () => ({ unverifiedSinceStartup: [], lastVerifiedUtc: null }),
          probePermissions: async () => {
            probed = true;
            return null;
          },
        },
      },
      deps(),
    );
    expect(probed).toBe(false);
    expect(h.pdasWrite).toEqual({ enabled: false, canReadBack: null, missingSelect: [], missingExecute: [], unverifiedSinceStartup: [], lastVerifiedUtc: null });
  });

  it('writes enabled, permission probe answers canReadBack:false with named tables — folded straight through', async () => {
    const h = await getHealth(
      pool,
      {
        lineId: 1,
        backupDir: 'C:\\b',
        authenticated: true,
        pdas: {
          enabled: true,
          readbackStatus: () => ({ unverifiedSinceStartup: ['blend', 'pallet'], lastVerifiedUtc: '2026-09-24T01:02:03.000Z' }),
          probePermissions: async () => ({ canReadBack: false, missingSelect: ['Blends', 'Pallets'], missingExecute: ['AddTubeType'], checkedAtUtc: '2026-09-24T00:00:00.000Z' }),
        },
      },
      deps(),
    );
    expect(h.pdasWrite).toEqual({
      enabled: true,
      canReadBack: false,
      missingSelect: ['Blends', 'Pallets'],
      missingExecute: ['AddTubeType'],
      unverifiedSinceStartup: ['blend', 'pallet'],
      lastVerifiedUtc: '2026-09-24T01:02:03.000Z',
    });
  });

  /* The permission probe is a live PDAS round trip — its own failure (e.g.
     the writer pool could not connect) must not fail the whole /api/health
     probe, same reasoning as acquisitionHealth/dqBlockingFindings above.
     canReadBack surfaces as null ("could not be determined"), never as
     false ("confirmed cannot read back") — those are different facts. */
  it('the permission probe throwing does not fail the whole health probe; canReadBack is null, not false', async () => {
    const h = await getHealth(
      pool,
      {
        lineId: 1,
        backupDir: 'C:\\b',
        authenticated: true,
        pdas: {
          enabled: true,
          readbackStatus: () => ({ unverifiedSinceStartup: [], lastVerifiedUtc: null }),
          probePermissions: async () => { throw new Error('ELOGIN: Login failed for user'); },
        },
      },
      deps(),
    );
    expect(h.status).toBe('ok');
    expect(h.pdasWrite?.canReadBack).toBeNull();
  });
});
