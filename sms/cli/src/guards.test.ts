/** guards.ts (roadmap Phase 11 item 3, 14 Sep 2026): the --backup precondition, pure. */
import { describe, expect, it } from 'vitest';
import { inFlightProblem, requireBackupFlag } from './guards.js';

const exists = (p: string) => p === 'D:\\backups\\sms-20260914-0200.bak';

describe('requireBackupFlag', () => {
  it('refuses a missing or bare flag with the sentence that names the backup script', () => {
    for (const args of [{}, { backup: true }, { backup: '' }, { backup: '   ' }]) {
      const r = requireBackupFlag(args as Record<string, string | boolean>, 'sms cutover', exists);
      expect(r.ok).toBe(false);
      expect(r.path).toBeNull();
      expect(r.problem).toMatch(/requires --backup=<path to a \.bak file>/);
      expect(r.problem).toMatch(/backup-appdb\.ps1/);
      expect(r.problem).toMatch(/Nothing has been changed/);
    }
  });

  it('refuses a path that is not a .bak', () => {
    const r = requireBackupFlag({ backup: 'D:\\backups\\notes.txt' }, 'sms cutover', exists);
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/must name a \.bak file/);
  });

  it('refuses a .bak that does not exist', () => {
    const r = requireBackupFlag({ backup: 'D:\\backups\\missing.bak' }, 'sms epoch:purge', exists);
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/does not exist: D:\\backups\\missing\.bak/);
  });

  it('accepts an existing .bak (case-insensitive extension, surrounding whitespace trimmed)', () => {
    const r = requireBackupFlag({ backup: ' D:\\backups\\sms-20260914-0200.bak ' }, 'sms cutover', exists);
    expect(r).toEqual({ ok: true, path: 'D:\\backups\\sms-20260914-0200.bak', problem: null });
    expect(requireBackupFlag({ backup: 'X.BAK' }, 'c', () => true).ok).toBe(true);
  });
});

describe('inFlightProblem', () => {
  it('names the count, the service to stop, and the command to re-run', () => {
    const s = inFlightProblem(2, 'sms epoch:purge');
    expect(s).toMatch(/^REFUSED: 2 sync_run row\(s\) have no finished_at_utc/);
    expect(s).toMatch(/SMS-Sync/);
    expect(s).toMatch(/re-run sms epoch:purge/);
  });
});
