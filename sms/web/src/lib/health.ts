/**
 * "Can this screen be trusted right now?" — one rule, three answers, used by
 * the header sentence AND by the Line screen's headline.
 *
 * WHY THIS IS NOT COSMETIC. This software never sees the present: IFL's
 * acquisition layer writes a cone's row about a quarter of an hour after the
 * cone is weighed, so the newest reading on a perfectly healthy line is always
 * that far behind the clock. The line state is therefore judged against
 * `now - lag` rather than against `now`.
 *
 * That correction has a failure mode of its own. If the SYNC WORKER stops, the
 * newest reading keeps ageing while nothing arrives, and within two minutes the
 * same arithmetic reports "Stopped 3 min" about a line that is running flat
 * out. An amber dot in the corner does not undo a wrong headline — so when the
 * pipeline is in doubt the words themselves have to change, and no screen may
 * assert Running or Stopped at all.
 *
 * Hence three states, all derived from measured values and never from a
 * literal: healthy, sync stale, lag beyond the credible ceiling.
 */
import type { LiveLine, Meta } from '../api';

/**
 * The sync worker runs on a 60-second cadence. Three missed cadences is the
 * point at which "the next pass is just late" stops being the likely
 * explanation — and it is still well inside the 18-minute acquisition lag, so
 * this fires before a stale pipeline can ever be mistaken for a stopped line.
 */
export const SYNC_STALE_AFTER_SECONDS = 180;

/**
 * A measured acquisition lag beyond an hour is no longer an ingestion delay
 * worth explaining away: the figures on screen may be right, but the line state
 * derived from them cannot be relied on.
 */
export const LAG_CEILING_SECONDS = 3600;

export type Health =
  /** Everything current. `lagSeconds` is measured, never assumed. */
  | { kind: 'ok'; readingUtc: string; lagSeconds: number | null }
  /** The plant link has gone quiet. Nothing may claim the line is running. */
  | { kind: 'stale'; readingUtc: string | null; syncAgeSeconds: number | null }
  /** Readings are arriving, far too late to judge the line by. */
  | { kind: 'late'; readingUtc: string; lagSeconds: number }
  /** Nothing has ever arrived. */
  | { kind: 'none' };

/** True when the state of the line must not be asserted. */
export function stateIsKnowable(h: Health): boolean {
  return h.kind === 'ok';
}

export function assessHealth(line: LiveLine | null, meta: Meta | null): Health {
  if (!line || line.dataAsOfUtc == null) {
    // A replay always has data behind it; a genuinely empty database does not.
    return { kind: 'none' };
  }

  // A replay is pinned to a past instant on purpose, so sync freshness says
  // nothing about it and the lag ceiling is not a fault. It is always banner-ed
  // separately, so it can report itself healthy here.
  if (!line.replay) {
    const age = meta?.sourceAgeSeconds ?? null;
    if (age == null || age > SYNC_STALE_AFTER_SECONDS) {
      return { kind: 'stale', readingUtc: line.dataAsOfUtc, syncAgeSeconds: age };
    }
    if (line.ingestLagSeconds != null && line.ingestLagSeconds > LAG_CEILING_SECONDS) {
      return { kind: 'late', readingUtc: line.dataAsOfUtc, lagSeconds: line.ingestLagSeconds };
    }
  }

  return { kind: 'ok', readingUtc: line.dataAsOfUtc, lagSeconds: line.ingestLagSeconds };
}
