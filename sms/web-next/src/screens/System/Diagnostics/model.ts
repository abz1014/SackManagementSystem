/**
 * Diagnostics model. Every state here is a lookup on a value the SERVER decided (live health kind, database.ok,
 * backup.warning, outcome); none is computed from a number in the client (guards.test rule 2).
 */
import { C, withFragments, FRAGMENTS } from '../../../copy';
import type { HealthReport, SourceGeneration, SyncStatus } from '../../../bridge/api';
import { health as healthLib } from '../../../bridge/lib';
import type { LiveLine } from '../../../bridge/api';
import type { UiState } from '../../../ui/StatusPill';
const SY = withFragments(C.system, FRAGMENTS.systemParts);

type FeedKind = ReturnType<typeof healthLib.assessHealth>['kind'];

const FEED_STATE: Record<FeedKind, UiState> = { ok: 'ok', stale: 'watch', late: 'watch', lag_unknown: 'watch', none: 'nodata' };
const FEED_VERDICT: Record<FeedKind, string> = {
  ok: SY.diag.feed.verdict.ok,
  stale: SY.diag.feed.verdict.stale,
  late: SY.diag.feed.verdict.late,
  lag_unknown: SY.diag.feed.verdict.unmeasured,
  none: SY.diag.feed.verdict.none,
};

export function feedKind(line: LiveLine | null): FeedKind {
  return healthLib.assessHealth(line).kind;
}
export const feedState = (k: FeedKind): UiState => FEED_STATE[k] ?? 'nodata';
export const feedVerdict = (k: FeedKind): string => FEED_VERDICT[k] ?? SY.diag.feed.verdict.unknown;

export function dbState(r: HealthReport): UiState {
  if (!r.database.ok) return 'act';
  return r.degradedReason ? 'watch' : 'ok';
}

export function backupState(r: HealthReport): UiState {
  const b = r.backup;
  if (b == null || b.newestFile == null) return 'nodata';
  if (b.warning) return 'watch';
  return b.verified ? 'ok' : 'watch';
}

/** The page sentence: SMS's own status first, then the feed. */
export function headline(r: HealthReport | null, kind: FeedKind, quietSpan: string | null): string {
  const own = r == null ? SY.diag.sentence.unreadable : { ok: SY.diag.sentence.working, degraded: SY.diag.sentence.attention, down: SY.diag.sentence.down }[r.status] ?? SY.diag.sentence.unreadable;
  const feed: Record<FeedKind, string> = {
    ok: SY.diag.sentence.feedOk,
    stale: quietSpan ? SY.diag.sentence.feedQuiet(quietSpan) : SY.diag.sentence.feedQuietNoSpan,
    late: SY.diag.sentence.feedLate,
    lag_unknown: SY.diag.sentence.feedUnmeasured,
    none: SY.diag.sentence.feedNone,
  };
  return `${own} ${feed[kind] ?? SY.diag.sentence.feedUnknown}`;
}

/** Feed names by the short raw table name the sync rows carry. */
const FEED_NAME: Record<string, string> = {
  cone_raw: SY.diag.feeds.cones,
  sack_raw: SY.diag.feeds.sacks,
  reject_qcs_raw: SY.diag.feeds.inspection,
  reject_weight_raw: SY.diag.feeds.weight,
};
export function feedName(targetTable: string): string {
  return FEED_NAME[targetTable] ?? SY.diag.feeds.other;
}
/** success is the one good outcome; anything else (failed, halted) is named as stopped. */
export const feedRowState = (s: SyncStatus): UiState => (s.outcome === 'success' ? 'ok' : 'act');

/** A finding's severity as the state kit shows it (the database's own CK_dq_severity values). */
const SEVERITY_STATE: Record<string, UiState | null> = { INFO: null, WARNING: 'watch', ERROR: 'act', CRITICAL: 'act' };
/** null = informational: shown as a plain word, not as a state. */
export const severityState = (sev: string): UiState | null => (sev in SEVERITY_STATE ? SEVERITY_STATE[sev]! : 'watch');

export type SourceKind = 'current' | 'older' | 'practice';
export interface SourceGroup {
  key: string;
  kind: SourceKind;
  cones: number | null;
  members: SourceGeneration[];
}

/**
 * One group per source database. Practice data (simulator) is named so; among the real databases the one with an
 * open generation is "current" and the rest are "older" history. Cone counts come from the cones table only.
 */
export function groupSources(gens: readonly SourceGeneration[]): SourceGroup[] {
  const byDb = new Map<string, SourceGeneration[]>();
  for (const g of gens) byDb.set(g.sourceDb, [...(byDb.get(g.sourceDb) ?? []), g]);
  const out: SourceGroup[] = [];
  for (const [db, members] of byDb) {
    const practice = members.every((m) => /_SIM$/i.test(m.sourceDb) || m.provenance === 'simulator');
    const open = members.some((m) => m.closedUtc == null);
    const coneRows = members.filter((m) => /^pack1/i.test(m.sourceTable));
    const cones = coneRows.length === 0 ? null : coneRows.reduce((n, m) => n + m.rawRowCount, 0);
    out.push({ key: db, kind: practice ? 'practice' : open ? 'current' : 'older', cones, members });
  }
  const order: Record<SourceKind, number> = { current: 0, older: 1, practice: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
