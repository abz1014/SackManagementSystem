/**
 * Copy and small formatters for the new Health states added by W1-C (29 Sep
 * 2026, failure analysis F-15/F-13/F-11/F-36): whether the newest backup has
 * actually been proven restorable, free disk space on the two volumes the
 * app cares about, the last manual `sms verify` run, and the sync worker's
 * own heartbeat stated beside the newest reading's own time so a reader can
 * tell "the recorder stopped checking in" from "the recorder is fine, the
 * plant just has nothing new to report".
 *
 * Kept OUT of words.ts on this task's own instruction — Task K/W1-D owns
 * words.ts this same pass and a shared edit there would collide. If a later
 * pass wants this folded into `W.health`, that is a follow-up, not this one.
 */
import type { HealthReport } from '../api';

/** Mirrors api/src/services/health.ts's own FREE_DISK_WARN_MB — see that file's doc for why 2048. Kept as a literal rather than imported: the web bundle has no access to server-side modules, and the server's own number is what actually gates `status`, so the web copy states it rather than re-deriving it. */
export const FREE_DISK_WARN_MB = 2048;

/** "5:53 PM" in the VIEWER's own zone, for a genuine app-UTC instant (never
 *  the plant's wall-clock-labelled-UTC — see CLAUDE.md's TWO CLOCKS rule).
 *  fmt.ts's fmtClock deliberately pins UTC for the other kind of instant;
 *  this is the app-instant counterpart, HH:MM only, no date. */
export function fmtAppClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtGb(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`;
}

export const HW = {
  backup: {
    title: 'Backup verification',
    verified: 'This backup has been proven restorable — RESTORE VERIFYONLY passed and its size still matches.',
    notVerified: 'This backup has not been proven restorable. Do not rely on it until it verifies.',
    /** Shown alongside a reported OLDER backup when the physically newest .bak failed or has not yet passed verification. */
    newestUnverified: 'A newer backup file exists but has not verified yet; the figures on this page are the newest one that HAS.',
    noneVerified: 'No verified backup was found. Every .bak in the folder is missing its verification, or none exists at all.',
  },
  disk: {
    title: 'Disk space',
    appDataVolume: (freeMb: number | null) =>
      freeMb == null ? 'App/database volume: could not be read.' : `App/database volume: ${fmtGb(freeMb)} free.`,
    backupVolume: (freeMb: number | null) =>
      freeMb == null ? 'Backup volume: could not be read.' : `Backup volume: ${fmtGb(freeMb)} free.`,
    low: (freeMb: number) => `Only ${fmtGb(freeMb)} free — below the ${fmtGb(FREE_DISK_WARN_MB)} warning line.`,
  },
  verifyRun: {
    title: 'Last manual verification run',
    last: (when: string) => `Last "sms verify" run: ${when}.`,
    none: 'No manual "sms verify" run is on record. This is informational only — it does not affect the status above.',
    note: 'This is the record of a run someone chose to make by hand, not a live, ongoing check.',
  },
  recorder: {
    checkedInAt: (when: string) => `The recorder last checked in at ${when}.`,
    checkedInNever: 'The recorder has never checked in.',
    readingAt: (when: string) => `newest reading at ${when}`,
    /** The two times side by side, when both are known — the whole point of
     *  this pair: a worker that runs on schedule and correctly finds nothing
     *  new looks identical to a dead one under the reading's own age alone. */
    both: (checkedIn: string, reading: string) => `The recorder last checked in at ${checkedIn} — newest reading at ${reading}.`,
  },
  /**
   * Task W2-B (29 Sep 2026, failure analysis F-24): acknowledging a known
   * data-fact DQ finding so it stops holding Health at "degraded" forever.
   * See shared/src/dqAck.ts for exactly which checks this applies to.
   */
  dqAck: {
    /** The count sentence — shown whenever at least one acknowledgement exists, regardless of current status. */
    summary: (n: number) => `${n} known data finding${n === 1 ? '' : 's'} acknowledged.`,
    control: 'Acknowledge',
    cancel: 'Cancel',
    submit: 'Record acknowledgement',
    reasonPlaceholder: 'Why is this finding known and not actionable right now? (at least 10 characters)',
    reasonTooShort: 'Say a bit more — at least 10 characters.',
    acknowledgedBy: (who: string, when: string) => `Acknowledged by ${who} at ${when}.`,
    acknowledgedByUnknown: (when: string) => `Acknowledged at ${when}.`,
    submitting: 'Recording…',
    failed: 'Could not record the acknowledgement — try again.',
    alreadyAcknowledged: 'This finding was just acknowledged by someone else.',
  },
} as const;

/** True when `report.disk` shows either volume below the warning line — pure, so the screen and a test can agree on when to show the low-disk sentence without duplicating the arithmetic. */
export function anyDiskLow(disk: HealthReport['disk']): boolean {
  if (!disk) return false;
  return (disk.appDataFreeMb != null && disk.appDataFreeMb < FREE_DISK_WARN_MB) || (disk.backupFreeMb != null && disk.backupFreeMb < FREE_DISK_WARN_MB);
}
