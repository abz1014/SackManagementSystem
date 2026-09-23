/**
 * "Can this screen be trusted right now?" — read from the server, not guessed.
 *
 * WHY THIS IS NOT COSMETIC. This software never sees the present: IFL's
 * acquisition layer writes a cone's row about a quarter of an hour after the
 * cone is weighed, so the newest reading on a healthy line is always that far
 * behind the clock. The line state is judged against `now - lag` rather than
 * against `now`.
 *
 * That correction has a failure mode of its own. If the SYNC WORKER stops, the
 * newest reading keeps ageing while nothing arrives, and within two minutes the
 * same arithmetic reports "Stopped 3 min" about a line running flat out. An
 * amber dot in the corner does not undo a wrong headline — so when the pipeline
 * is in doubt the words themselves change, and no screen asserts Running or
 * Stopped.
 *
 * THE THRESHOLDS BELONG ON THE SERVER (api/src/services/live.ts), because they
 * have to be MEASURED. This module was briefly written with two literals of its
 * own and both were wrong: the stale point assumed a sixty-second sync cadence
 * rather than observing it, and the lag ceiling sat below the point at which
 * the server stopped reporting a lag at all — so the state meant to catch
 * "readings are arriving two hours late" could never fire. The server now
 * measures the cadence, takes freshness from the OLDEST source table rather
 * than the newest, and reports the lag as measured. This module only renders
 * that decision.
 */
import type { LiveLine } from '../api';

export type Health =
  /** Everything current. `lagSeconds` is measured, never assumed. */
  | { kind: 'ok'; readingUtc: string; lagSeconds: number | null }
  /** The plant link has gone quiet. Nothing may claim the line is running. */
  | { kind: 'stale'; readingUtc: string | null; syncAgeSeconds: number | null }
  /** Readings are arriving far too late to judge the line by. */
  | { kind: 'late'; readingUtc: string; lagSeconds: number }
  /**
   * RT-006 (23 Sep 2026 red-team audit): a reading exists but the
   * acquisition lag has not been measured yet — a zero-row lag sample,
   * exactly the state `sms epoch:accept` produces the instant it opens a
   * new generation. Until a lag sample exists, running/stopped cannot be
   * judged (the arithmetic would compare the reading to the wall clock with
   * no lag correction), so this is deliberately NOT folded into 'ok'.
   */
  | { kind: 'lag_unknown'; readingUtc: string }
  /** Nothing has ever arrived. */
  | { kind: 'none' };

/** True when the state of the line may be asserted on screen. */
export function stateIsKnowable(h: Health): boolean {
  return h.kind === 'ok';
}

export function assessHealth(line: LiveLine | null): Health {
  if (!line || line.dataAsOfUtc == null) return { kind: 'none' };
  switch (line.health?.kind) {
    case 'stale':
      return { kind: 'stale', readingUtc: line.dataAsOfUtc, syncAgeSeconds: line.health.ageSeconds };
    case 'late':
      return { kind: 'late', readingUtc: line.dataAsOfUtc, lagSeconds: line.ingestLagSeconds ?? 0 };
    case 'lag_unknown':
      return { kind: 'lag_unknown', readingUtc: line.dataAsOfUtc };
    case 'no_data':
      return { kind: 'none' };
    default:
      return { kind: 'ok', readingUtc: line.dataAsOfUtc, lagSeconds: line.ingestLagSeconds };
  }
}
