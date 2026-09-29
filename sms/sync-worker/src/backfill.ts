/**
 * R-17 — a safe tail backfill of historic rows into an already-CLOSED source
 * generation. `sms epoch:backfill` (cli/src/commands/backfill.ts) is the only
 * caller; this module holds the logic so it can be unit-tested with fake
 * pools, the same way epoch.ts and lock.ts are.
 *
 * BACKGROUND (CLAUDE.md, 28 Sep 2026; DEFECTS.md R-17). The 10 Jul - 5 Aug
 * archive IFL has not yet sent belongs to the SAME physical generation as the
 * July copy already registered here as epochs 1-4 (generation_ordinal 1,
 * seeded CLOSED by scripts/seed-dev-epochs.sql: the tables it describes were
 * dropped and recreated by IFL on 2026-08-05, ending that generation for
 * good). Its ids simply continue where the July sample's own ids stop — same
 * table, same create_date, same fingerprint. This is therefore a TAIL INSERT
 * into an existing closed epoch, never a new generation:
 *
 *   - generation_ordinal is NEVER written here. It is read only, to resolve
 *     which sibling tables share one physical generation for --all.
 *   - the epoch's own closed_utc, provenance, label and identity columns are
 *     NEVER written here.
 *   - sms.source_epoch's watermark-adjacent columns (last_seen_utc,
 *     archived_below_id) belong to resolveEpoch/observeArchivedFloor's LIVE
 *     read path and are never touched by this module either.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not run the transform — a backfilled
 * row lands in sms_raw.* exactly like a live-synced one and is picked up by
 * the worker's ordinary transform pass (or `sms rebuild --epoch=<id>` if an
 * operator wants it re-derived immediately). It does not open a new epoch: an
 * archive with no existing epoch row to extend is refused (see
 * `assertBackfillableEpoch`) — "insert a new historic generation" is a
 * different, deliberately deferred operation.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { createLogger } from '@sms/shared';
import { IflSqlAdapter } from './reader/IflSqlAdapter.js';
import { JULY_TABLE_SHAPES, rawShortName, type IflTableDef, type TableKind } from './reader/iflTables.js';
import { persistRaw } from './raw/persistRaw.js';
import type { EpochRow } from './epoch.js';

const log = createLogger('sync-worker');

/**
 * `epoch.ts`'s own `EpochRow` never selects `closed_utc` — `openEpoch`'s
 * query only ever matches `closed_utc IS NULL` rows, so it had no reason to.
 * This command's entire job is to tell an open epoch from a closed one, so
 * this local widening is that one extra column, read the same way every
 * other column on this row already is.
 */
export interface BackfillEpochRow extends EpochRow {
  closed_utc: Date | null;
}

const EPOCH_COLUMNS = `epoch_id, line_id, source_table, source_server, source_db,
              source_created_key, schema_fingerprint, provenance, generation_ordinal, label,
              closed_utc, archived_below_id, archived_observed_utc`;

/**
 * Fetch one epoch row by id, regardless of open/closed state — `openEpoch`
 * (epoch.ts) only ever returns the OPEN row for a table, which is exactly
 * the one this command must never touch. Returns null when the id does not
 * exist (an unknown epoch is a refusal, not a crash — see
 * `assertBackfillableEpoch`).
 */
export async function getEpochById(appPool: ConnectionPool, epochId: number): Promise<BackfillEpochRow | null> {
  const r = await appPool
    .request()
    .input('id', mssql.Int, epochId)
    .query<BackfillEpochRow>(`SELECT ${EPOCH_COLUMNS} FROM sms.source_epoch WHERE epoch_id = @id`);
  return r.recordset[0] ?? null;
}

/**
 * Every epoch (open or closed) sharing one physical generation with `anchor`
 * — the same (source_db, generation_ordinal) grouping
 * api/src/services/generation.ts already uses to scope reports across a
 * line's several source tables. This is what `--all` backfills: every
 * configured table's own epoch row for the SAME generation as the one the
 * operator named by id, not merely every table that happens to be at the
 * same ordinal number by coincidence. The caller still checks each one is
 * closed before writing to it (assertBackfillableEpoch) — this only groups.
 */
export async function siblingEpochs(
  appPool: ConnectionPool,
  lineId: number,
  anchor: BackfillEpochRow,
): Promise<BackfillEpochRow[]> {
  const r = await appPool
    .request()
    .input('line', mssql.Int, lineId)
    .input('db', mssql.NVarChar(128), anchor.source_db)
    .input('ord', mssql.Int, anchor.generation_ordinal)
    .query<BackfillEpochRow>(
      `SELECT ${EPOCH_COLUMNS} FROM sms.source_epoch
        WHERE line_id = @line AND source_db = @db AND generation_ordinal = @ord
        ORDER BY source_table`,
    );
  return r.recordset;
}

/**
 * The fingerprint value `scripts/seed-dev-epochs.sql` stores when the real
 * one could not be recovered (app_config never held one for that table). An
 * epoch carrying it has no genuine fingerprint to compare against, so the
 * OVERLAP PROOF (checksum equality on the ids both sides already hold) is the
 * only gate for it — never a silent skip of the schema check, which is what
 * every other epoch still gets.
 */
export const ALL_ZERO_FINGERPRINT = '00000000000000000000000000000000';

/** Build the July-shape `IflTableDef` for one physical source table. */
export function julyDefFor(sourceTable: string, kind: TableKind, systemCode = 'ifl_sql'): IflTableDef {
  return { key: kind, sourceTable, systemCode, ...JULY_TABLE_SHAPES[kind] };
}

/**
 * Refuse an epoch this command cannot safely write into: unknown, still
 * OPEN (the live sync pass reads and writes an open generation; a bulk
 * insert racing it is exactly what the transform lock below exists to
 * prevent for CLOSED generations, and an open one is out of scope
 * entirely — its watermark, not a backfill, is how it grows), or one whose
 * own `source_table` does not match what the operator named.
 */
export function assertBackfillableEpoch(
  epoch: BackfillEpochRow | null,
  epochId: number,
  expectSourceTable?: string,
): asserts epoch is BackfillEpochRow {
  if (!epoch) {
    throw new Error(
      `No such epoch: ${epochId}. 'sms epoch:list' shows what is registered. Inserting an entirely new ` +
        `historic generation — one with no epoch row at all yet — is a different, deliberately deferred ` +
        `operation; this command only extends an existing CLOSED one.`,
    );
  }
  if (epoch.closed_utc == null) {
    throw new Error(
      `Epoch ${epochId} ("${epoch.label}") for ${epoch.source_table} is OPEN. epoch:backfill only ever writes ` +
        `into a CLOSED generation: an open one is read and grown by the live sync pass, and a bulk insert racing ` +
        `it is exactly what this command must not do. Nothing has been changed.`,
    );
  }
  if (expectSourceTable && epoch.source_table !== expectSourceTable) {
    throw new Error(
      `Epoch ${epochId} belongs to ${epoch.source_table}, not ${expectSourceTable}. --table and --epoch must name ` +
        `the same physical source table. Nothing has been changed.`,
    );
  }
}

/**
 * The July shape check: `Source` present (cone/reject_qcs/reject_weight
 * only — sack1_TP1U2 never carried it, July or September) and `MaterialId`
 * absent. IFL's September rebuild added `MaterialId` to all four tables and
 * renamed `Source` to `MachineNo` on three of them — either signal alone is
 * enough to refuse the September shape outright, before a single data row is
 * read, rather than silently misreading a renamed/absent column.
 */
export async function assertJulyShape(sourcePool: ConnectionPool, sourceTable: string, kind: TableKind): Promise<void> {
  const r = await sourcePool
    .request()
    .input('t', mssql.NVarChar, sourceTable)
    .query<{ name: string }>(`SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('dbo.' + @t)`);
  const names = new Set(r.recordset.map((x) => x.name));
  if (names.size === 0) {
    throw new Error(`dbo.${sourceTable} was not found on this source (or the login cannot see it). Nothing has been changed.`);
  }
  if (names.has('MaterialId')) {
    throw new Error(
      `dbo.${sourceTable} carries a MaterialId column — that is the SEPTEMBER shape (IFL's 2026-08-05 rebuild), ` +
        `not the July one epoch:backfill reads. Refusing: reading it through the July column shape would silently ` +
        `drop MaterialId and, on the three tables that carry it, misread MachineNo under Source's old name. ` +
        `Nothing has been changed.`,
    );
  }
  if (kind !== 'sack' && !names.has('Source')) {
    throw new Error(
      `dbo.${sourceTable} has neither a MaterialId nor a Source column — this is neither shape this codebase ` +
        `knows how to read. Nothing has been changed.`,
    );
  }
}

export interface OverlapResult {
  /** ids on the source side that were compared (0 when there is nothing to overlap). */
  checkedIds: number;
  sourceChecksum: number;
  rawChecksum: number;
  match: boolean;
  mode: 'full' | 'sampled';
}

/**
 * OVERLAP PROOF. For every source id already held in sms_raw under this
 * epoch (id <= the epoch's current max there), an aggregate checksum of
 * (id, every column this shape reads) must agree between the source and
 * sms_raw. This is what makes the backfill safe to run more than once and
 * safe against an operator pointing --source-db at an archive that is NOT
 * actually a superset of what is already stored: any disagreement refuses
 * the whole command before a single row is written.
 *
 * `full` reads every overlapping id on both sides. `sampled` reads only ids
 * matching `id % sampleEvery = 0` on both sides — a legitimate speed trade
 * for a large overlap, at the honest cost of being unable to see a
 * corruption confined to the ids it skips; the CLI prints which mode ran.
 */
export async function overlapChecksum(
  sourcePool: ConnectionPool,
  appPool: ConnectionPool,
  def: IflTableDef,
  lineId: number,
  epochId: number,
  maxOverlapId: number,
  opts: { mode?: 'full' | 'sampled'; sampleEvery?: number } = {},
): Promise<OverlapResult> {
  const mode = opts.mode ?? 'full';
  if (maxOverlapId <= 0) {
    return { checkedIds: 0, sourceChecksum: 0, rawChecksum: 0, match: true, mode };
  }
  const sampleEvery = opts.sampleEvery ?? 50;
  const cols = def.columns.filter((c) => c.raw !== 'src_id');
  const srcExpr = ['[id]', ...cols.map((c) => `[${c.src}]`)].join(', ');
  const rawExpr = ['src_id', ...cols.map((c) => c.raw)].join(', ');
  const sampleSrc = mode === 'sampled' ? 'AND [id] % @every = 0' : '';
  const sampleRaw = mode === 'sampled' ? 'AND src_id % @every = 0' : '';

  const srcQ = await sourcePool
    .request()
    .input('hi', mssql.Int, maxOverlapId)
    .input('every', mssql.Int, sampleEvery)
    .query<{ n: number; agg: number | null }>(
      `SELECT COUNT(*) AS n, CHECKSUM_AGG(CHECKSUM(${srcExpr})) AS agg
         FROM [${def.sourceTable}] WHERE [id] <= @hi ${sampleSrc}`,
    );
  const rawQ = await appPool
    .request()
    .input('line', mssql.Int, lineId)
    .input('epoch', mssql.Int, epochId)
    .input('hi', mssql.Int, maxOverlapId)
    .input('every', mssql.Int, sampleEvery)
    .query<{ n: number; agg: number | null }>(
      `SELECT COUNT(*) AS n, CHECKSUM_AGG(CHECKSUM(${rawExpr})) AS agg
         FROM ${def.rawTable} WHERE line_id = @line AND source_epoch = @epoch AND src_id <= @hi ${sampleRaw}`,
    );

  const sN = Number(srcQ.recordset[0]?.n ?? 0);
  const sAgg = Number(srcQ.recordset[0]?.agg ?? 0);
  const rN = Number(rawQ.recordset[0]?.n ?? 0);
  const rAgg = Number(rawQ.recordset[0]?.agg ?? 0);

  return { checkedIds: sN, sourceChecksum: sAgg, rawChecksum: rAgg, match: sN === rN && sAgg === rAgg, mode };
}

export interface TableBackfillPlan {
  def: IflTableDef;
  epoch: BackfillEpochRow;
  /** MAX(id) the source currently reports, or null when the archive is empty for this table. */
  sourceMaxId: number | null;
  /** MAX(src_id) already held in sms_raw under this epoch, 0 when none. */
  existingMaxId: number;
  overlap: OverlapResult;
  /** ids strictly greater than existingMaxId, up to sourceMaxId. */
  tailFrom: number;
  tailTo: number | null;
  tailCount: number;
}

/**
 * Dry-run plan for one (table, epoch) pair. Never writes. Throws on a schema
 * fingerprint mismatch (unless the epoch carries the all-zeros placeholder,
 * in which case the overlap proof is the only gate) or on an overlap
 * mismatch — both refusals a caller should surface with 0 writes.
 */
export async function planTableBackfill(
  appPool: ConnectionPool,
  sourcePool: ConnectionPool,
  def: IflTableDef,
  lineId: number,
  epoch: BackfillEpochRow,
  overlapOpts: { mode?: 'full' | 'sampled'; sampleEvery?: number } = {},
): Promise<TableBackfillPlan> {
  assertBackfillableEpoch(epoch, epoch.epoch_id, def.sourceTable);
  await assertJulyShape(sourcePool, def.sourceTable, def.key);

  const adapter = new IflSqlAdapter(sourcePool, def);
  if (epoch.schema_fingerprint !== ALL_ZERO_FINGERPRINT) {
    const liveFp = await adapter.fingerprint();
    if (liveFp !== epoch.schema_fingerprint) {
      throw new Error(
        `Fingerprint mismatch on ${def.sourceTable}: epoch ${epoch.epoch_id} ("${epoch.label}") recorded ` +
          `${epoch.schema_fingerprint}, this source reports ${liveFp}. This archive's columns do not match ` +
          `what the epoch was registered against — refusing before reading any rows. Nothing has been changed.`,
      );
    }
  }

  const sourceMaxId = await adapter.maxSourceId();
  const existing = await appPool
    .request()
    .input('line', mssql.Int, lineId)
    .input('epoch', mssql.Int, epoch.epoch_id)
    .query<{ hi: number | null }>(
      `SELECT MAX(src_id) AS hi FROM ${def.rawTable} WHERE line_id = @line AND source_epoch = @epoch`,
    );
  const existingMaxId = Number(existing.recordset[0]?.hi ?? 0);

  const overlap = await overlapChecksum(sourcePool, appPool, def, lineId, epoch.epoch_id, existingMaxId, overlapOpts);
  if (!overlap.match) {
    throw new Error(
      `Overlap mismatch on ${def.sourceTable} (epoch ${epoch.epoch_id}): the ${overlap.checkedIds} id(s) up to ` +
        `${existingMaxId} that sms_raw already holds do not checksum-match what this source reports for the same ` +
        `ids (source agg ${overlap.sourceChecksum}, sms_raw agg ${overlap.rawChecksum}, mode ${overlap.mode}). This ` +
        `archive is not provably a superset of what is already stored. Refusing — 0 rows written.`,
    );
  }

  const tailFrom = existingMaxId + 1;
  const tailTo = sourceMaxId;
  const tailCount = tailTo !== null && tailTo >= tailFrom ? tailTo - tailFrom + 1 : 0;

  return { def, epoch, sourceMaxId, existingMaxId, overlap, tailFrom, tailTo, tailCount };
}

export interface TableBackfillOutcome {
  sourceTable: string;
  epochId: number;
  inserted: number;
}

/**
 * Execute one already-validated plan: read the tail rows and hand them to
 * `persistRaw` tagged with the plan's own epoch id, exactly the write path
 * `runner.ts` uses for a live pass. The caller is responsible for holding
 * `withTransformLock` around this (and any sibling plans in the same --all
 * run) — this function does not acquire it itself, so one lock can cover a
 * whole multi-table run rather than one per table.
 */
export async function executeTableBackfill(
  appPool: ConnectionPool,
  sourcePool: ConnectionPool,
  lineId: number,
  ingestRunId: string,
  plan: TableBackfillPlan,
): Promise<TableBackfillOutcome> {
  if (plan.tailCount === 0) {
    return { sourceTable: plan.def.sourceTable, epochId: plan.epoch.epoch_id, inserted: 0 };
  }
  const adapter = new IflSqlAdapter(sourcePool, plan.def);
  const records = await adapter.readSince(plan.existingMaxId);
  const result = await persistRaw(appPool, plan.def, lineId, ingestRunId, records, plan.epoch.epoch_id);
  log.info('epoch:backfill wrote tail rows', {
    table: plan.def.sourceTable,
    epoch: plan.epoch.epoch_id,
    read: result.read,
    written: result.written,
  });
  return { sourceTable: plan.def.sourceTable, epochId: plan.epoch.epoch_id, inserted: result.written };
}

/** `sms_raw.<kind>_raw` → short name, for printing — reuses the same convention as dq/sync_run. */
export const shortRawTable = (def: IflTableDef): string => rawShortName(def.rawTable);
