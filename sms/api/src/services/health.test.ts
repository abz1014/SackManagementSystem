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
  foldStatus,
  getHealth,
  markDegraded,
  serviceHealth,
  SERVICE_VERSION,
  type AcquisitionFacts,
  type BackupFs,
} from './health.js';

const okDb = { ok: true, latencyMs: 3, sizeMb: 500 };
const okAcq: AcquisitionFacts = { kind: 'ok', ageSeconds: 30, cadenceSeconds: 60, halted: [] };

beforeEach(() => clearDegraded());

describe('foldStatus', () => {
  it('down when the database did not answer, whatever else is true', () => {
    expect(foldStatus({ ok: false, latencyMs: null, sizeMb: null }, okAcq, false)).toBe('down');
  });
  it('degraded when the pool reported an error since the last good probe', () => {
    expect(foldStatus(okDb, okAcq, true)).toBe('degraded');
  });
  it('degraded at 80 % of the Express cap, ok just under', () => {
    expect(foldStatus({ ...okDb, sizeMb: 8192 }, okAcq, false)).toBe('degraded');
    expect(foldStatus({ ...okDb, sizeMb: 8100 }, okAcq, false)).toBe('ok');
  });
  it('degraded when the acquisition is stale, late or has a halted table', () => {
    expect(foldStatus(okDb, { ...okAcq, kind: 'stale' }, false)).toBe('degraded');
    expect(foldStatus(okDb, { ...okAcq, kind: 'late' }, false)).toBe('degraded');
    expect(foldStatus(okDb, { ...okAcq, halted: ['cone_raw'] }, false)).toBe('degraded');
  });
  it('no_data is not a degradation — an empty database is not a broken one', () => {
    expect(foldStatus(okDb, { ...okAcq, kind: 'no_data' }, false)).toBe('ok');
  });
  it('ok otherwise, including when acquisition could not be read', () => {
    expect(foldStatus(okDb, okAcq, false)).toBe('ok');
    expect(foldStatus(okDb, null, false)).toBe('ok');
  });
});

describe('backupHealth — newest .bak by mtime, read-only', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0);
  const fakeFs = (files: Record<string, number>, fail = false): BackupFs => ({
    readdir: () => {
      if (fail) throw new Error('ENOENT');
      return Object.keys(files);
    },
    mtimeMs: (p) => files[p.split(/[\\/]/).pop()!]!,
  });

  it('picks the newest .bak, ignoring other files, and is fine within two days', () => {
    const h = backupHealth('C:\\sms-backups', fakeFs({
      'sms-20260913-0200.bak': now - 2.5 * 86_400_000,
      'sms-20260915-0200.bak': now - 10 * 3_600_000,
      'notes.txt': now,
      'sms-20260915-0300.BAK.tmp': now,
    }), now);
    expect(h.newestFile).toBe('sms-20260915-0200.bak');
    expect(h.ageDays).toBe(0.4);
    expect(h.warning).toBe(false);
  });

  it('warns past two days', () => {
    const h = backupHealth('C:\\sms-backups', fakeFs({ 'sms-1.bak': now - 2.1 * 86_400_000 }), now);
    expect(h.ageDays).toBe(2.1);
    expect(h.warning).toBe(true);
  });

  it('a missing directory or no .bak at all is the warning state, not an error', () => {
    expect(backupHealth('Z:\\none', fakeFs({}, true), now)).toEqual({ dir: 'Z:\\none', newestFile: null, newestAtUtc: null, ageDays: null, warning: true });
    expect(backupHealth('C:\\x', fakeFs({ 'readme.md': now }), now).warning).toBe(true);
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
    backupHealth: (dir: string) => ({ dir, newestFile: 'sms.bak', newestAtUtc: null, ageDays: 0.5, warning: false }),
    now: () => Date.now(),
    ...over,
  });

  it('anonymous: status honest, details nulled', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: false }, deps());
    expect(h.status).toBe('ok');
    expect(h.database.sizeMb).toBeNull();
    expect(h.database.pctOfCap).toBeNull();
    expect(h.acquisition).toEqual({ kind: null, ageSeconds: null, cadenceSeconds: null, halted: null });
    expect(h.backup).toBeNull();
  });

  it('signed in: everything, and pctOfCap to one decimal', async () => {
    const h = await getHealth(pool, { lineId: 1, backupDir: 'C:\\b', authenticated: true }, deps());
    expect(h.database.sizeMb).toBe(500);
    expect(h.database.pctOfCap).toBe(4.9);
    expect(h.acquisition.halted).toEqual([]);
    expect(h.backup?.newestFile).toBe('sms.bak');
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
});
