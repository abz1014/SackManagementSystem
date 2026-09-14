/**
 * Setup › Sync health: placing the epoch register's per-SOURCE-table status
 * on the per-RAW-table sync rows (roadmap Phase 2, 14 Sep 2026).
 *
 * /api/operations names tables two ways, because the database does.
 * `sync[].targetTable` is sync_run.target_table — the raw short name, e.g.
 * `cone_raw` — while `schema[].table` is source_epoch.source_table, the
 * plant's own name, e.g. `pack1_TP1U2`. Nothing in that payload joins them.
 * The join is sms.source_table (Setup › Sources reads it as
 * `{ sourceTable, rawTable }`), so this takes that list and does the
 * matching here, where it can be tested without a DOM.
 *
 * A status that cannot be placed — the sources list did not load, or the
 * table has epoch rows but no sync row yet — is NOT dropped: it comes back
 * in `unplaced` and the screen lists it under the table by name. The point
 * of the status is that the worker is halted on that table and nothing else
 * on the screen says why the age is climbing; losing it to a failed join
 * would be the same silence with an extra step.
 */
import type { SchemaFingerprint, SourceTableRow } from '../api';

/** `sms_raw.cone_raw` → `cone_raw`: the form sync_run.target_table carries (the worker's rawShortName). */
export function rawShortName(rawTable: string): string {
  const i = rawTable.lastIndexOf('.');
  return i < 0 ? rawTable : rawTable.slice(i + 1);
}

export interface NoOpenEpochs {
  /** target table (raw short name) → source table with no open generation. */
  byTarget: Map<string, string>;
  /** Source tables with no open generation that no sync row could carry. */
  unplaced: string[];
}

export function noOpenEpochs(
  schema: readonly SchemaFingerprint[],
  tables: readonly SourceTableRow[] | null,
  syncTargets: readonly string[],
): NoOpenEpochs {
  const targetOf = new Map<string, string>();
  for (const t of tables ?? []) targetOf.set(t.sourceTable, rawShortName(t.rawTable));
  const present = new Set(syncTargets);

  const byTarget = new Map<string, string>();
  const unplaced: string[] = [];
  for (const s of schema) {
    if (s.status !== 'no-open-epoch') continue;
    const target = targetOf.get(s.table);
    if (target != null && present.has(target)) byTarget.set(target, s.table);
    else unplaced.push(s.table);
  }
  return { byTarget, unplaced };
}
