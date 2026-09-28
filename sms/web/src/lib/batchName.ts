/**
 * The one sentence-fragment naming a source generation to a reader who is
 * not debugging the sidecar — "IFL data batch 3", never the raw
 * `sms.source_epoch.label` string ("pack1_TP1U2 gen 4") that Health printed
 * verbatim before this (defect 4, Health labels).
 *
 * Deliberately the SAME two inputs `GenerationRef`/`GenerationTally` already
 * carry (`ordinal`, `simulator`) — never `label` or `sourceDb`, which are the
 * vendor table name and the raw database name and were exactly what made the
 * old strings unreadable. A null ordinal means the row predates generation
 * tracking (or the epoch id could not be resolved) — "Unregistered", not a
 * blank or an invented number, and simulator status is then moot: an
 * unregistered batch cannot be named as either the plant's or the
 * simulator's.
 *
 * Mirrored byte-for-byte at `api/src/services/batchName.ts` (no shared
 * package between the API and the client in this codebase) — the two files'
 * test suites share one literal case table so the two can never drift apart
 * silently; see either test file's header.
 */
export interface BatchNameInput {
  ordinal: number | null;
  simulator: boolean;
}

export function batchName(g: BatchNameInput): string {
  if (g.ordinal == null) return 'Unregistered data batch';
  return g.simulator ? `Simulator data batch ${g.ordinal}` : `IFL data batch ${g.ordinal}`;
}
