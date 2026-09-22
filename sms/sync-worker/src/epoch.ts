/**
 * Source generations ("epochs").
 *
 * WHY THIS EXISTS. IFL's `id` is not a stable key across time. They dropped and
 * recreated the four wide tables on 2026-08-05 (18:54:50-19:03:16) and every
 * identity restarted at 1. Measured: `DATA_TP1U2_SEP07.pack1_TP1U2` holds ids
 * 1..132,552 while `sms_raw.cone_raw` already held ids 1..204,076 under entirely
 * different physical cones.
 *
 * Nothing in the system could see that. The schema fingerprint hashes COLUMNS,
 * and a wipe changes none — verified: `sack1_TP1U2`'s fingerprint is
 * byte-identical across the rebuild. So the reader asked for `id > watermark-500`,
 * got nothing, and recorded outcome='success' — forever, while the plant ran
 * 3,000 cones a day.
 *
 * An epoch names one physical generation of one source table, identified by
 * (line, table, SERVER, DATABASE, create_date). Server and database are part of
 * the identity on purpose: a `create_date` alone cannot tell "the vendor rebuilt
 * the table" from "IFL_DB_NAME_DATA points at the wrong database", and those
 * need opposite responses.
 *
 * RESOLUTION NEVER GUESSES. An unrecognised generation HALTS the pass. There is
 * no safe default: defaulting to "the newest epoch" or to 1 reproduces the exact
 * bug this was built to kill, and auto-registering would have re-ingested the
 * simulator's rows a second time the moment its tables were rebuilt. Accepting a
 * new generation is a deliberate operator act — `sms epoch:accept`.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { createLogger, type Logger } from '@sms/shared';
import type { DbConfig } from './config.js';
import { rawShortName, type IflTableDef } from './reader/iflTables.js';
import { createAdapter, type SourceAdapter } from './reader/SourceAdapter.js';
import type { Finding } from './transform/dq.js';

const log: Logger = createLogger('sync-worker');

export interface EpochRow {
  epoch_id: number;
  line_id: number;
  source_table: string;
  source_server: string;
  source_db: string;
  source_created_key: string;
  schema_fingerprint: string;
  provenance: string;
  generation_ordinal: number;
  label: string;
  /** The archived floor (migration 037, 16 Sep 2026) — see observeArchivedFloor.
   *  NULL until this generation's first observation. */
  archived_below_id?: number | null;
  archived_observed_utc?: Date | null;
}

/** What the source itself currently reports, before any matching. */
export interface SourceIdentity {
  createdKey: string;
  fingerprint: string;
  server: string;
  database: string;
  /** The FULL column list, "name type" in ordinal order (Phase 2): stored on
   *  the epoch row at accept, compared on every pass by checkColumnDrift. */
  columnList: string[];
}

export async function readSourceIdentity(
  iflPool: ConnectionPool,
  def: IflTableDef,
  iflDb: DbConfig,
): Promise<SourceIdentity> {
  // Through the registry, never `new IflSqlAdapter` (roadmap Phase 2): the
  // system code on the configured row decides which reader answers.
  const adapter = createAdapter(def.systemCode, iflPool, def);
  const createdKey = await adapter.sourceEpoch();
  if (createdKey === null) {
    throw new Error(
      `Cannot read create_date for dbo.${def.sourceTable} on ` +
        `${iflDb.server}/${iflDb.database}. Without it the source generation cannot be ` +
        `identified, and guessing is what this check exists to prevent. Check the table ` +
        `exists and the login can see sys.tables.`,
    );
  }
  return {
    createdKey,
    fingerprint: await adapter.fingerprint(),
    server: iflDb.server,
    database: iflDb.database,
    columnList: await adapter.columnList(),
  };
}

/** The currently-open epoch for this table, or null if none is open. */
export async function openEpoch(
  appPool: ConnectionPool,
  lineId: number,
  sourceTable: string,
): Promise<EpochRow | null> {
  const r = await appPool
    .request()
    .input('line', mssql.Int, lineId)
    .input('tbl', mssql.VarChar(64), sourceTable)
    .query<EpochRow>(
      `SELECT epoch_id, line_id, source_table, source_server, source_db,
              source_created_key, schema_fingerprint, provenance, generation_ordinal, label,
              archived_below_id, archived_observed_utc
         FROM sms.source_epoch
        WHERE line_id = @line AND source_table = @tbl AND closed_utc IS NULL`,
    );
  return r.recordset[0] ?? null;
}

/**
 * Resolve the epoch the source currently represents, or throw with an error an
 * operator can act on.
 *
 * This replaces BOTH the old `app_config` gates: the schema fingerprint is a
 * property of a generation, not of a table name, so it lives on the epoch row.
 */
export async function resolveEpoch(
  appPool: ConnectionPool,
  iflPool: ConnectionPool,
  def: IflTableDef,
  lineId: number,
  iflDb: DbConfig,
): Promise<EpochRow> {
  const now = await readSourceIdentity(iflPool, def, iflDb);
  const open = await openEpoch(appPool, lineId, def.sourceTable);

  if (open === null) {
    throw new Error(
      `No open source generation for ${def.sourceTable} (line ${lineId}). The source reports ` +
        `${iflDb.server}/${iflDb.database} created ${now.createdKey}, fingerprint ${now.fingerprint}. ` +
        `Register it deliberately:\n` +
        `  sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"`,
    );
  }

  const sameSource =
    open.source_server === now.server &&
    open.source_db === now.database &&
    open.source_created_key === now.createdKey;

  if (!sameSource) {
    throw new Error(
      `Source generation changed for ${def.sourceTable}.\n` +
        `  open epoch ${open.epoch_id} ("${open.label}"): ${open.source_server}/${open.source_db} created ${open.source_created_key}\n` +
        `  source now:                 ${now.server}/${now.database} created ${now.createdKey}\n` +
        `The identity counter has almost certainly restarted, so the stored watermark is ` +
        `meaningless against these rows. Sync halted BEFORE reading. If this is a legitimate ` +
        `rebuild or a deliberate repoint:\n` +
        `  sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"\n` +
        `If it is NOT — check IFL_DB_SERVER / IFL_DB_NAME_DATA first. A wrong database looks ` +
        `exactly like this.`,
    );
  }

  if (open.schema_fingerprint !== now.fingerprint) {
    throw new Error(
      `Schema drift on ${def.sourceTable} within generation ${open.epoch_id} ("${open.label}"): ` +
        `expected ${open.schema_fingerprint}, got ${now.fingerprint}. The columns this app ` +
        `depends on changed underneath a live generation. Sync halted to protect canonical. ` +
        `Review the source schema, then re-accept the generation if the change is intended.`,
    );
  }

  // The archived floor (migration 037, 16 Sep 2026): reached only once the
  // identity/schema checks above have already proven the source IS this
  // generation, so the MIN(id) read here can only mean what it looks like it
  // means. See observeArchivedFloor for what a rise vs a fall does.
  await observeArchivedFloor(appPool, iflPool, def, open);

  // D-8 fix (22 Sep 2026): stamp last_seen_utc now that the identity and
  // schema checks above have proven the source is still this generation —
  // migration 025 defined the column but nothing ever wrote it, so
  // System History showed it as permanently blank. Reached once per table
  // per pass, so this is a cheap single-row UPDATE, not a hot-path cost.
  await appPool
    .request()
    .input('id', mssql.Int, open.epoch_id)
    .query(`UPDATE sms.source_epoch SET last_seen_utc = SYSUTCDATETIME() WHERE epoch_id = @id`);

  return open;
}

/**
 * The archived floor — Part 1 of "sms verify survives the day IFL prunes its
 * first row" (16 Sep 2026).
 *
 * WHY. verify's id-checksum reconciliation compares source ⇄ raw over the
 * WHOLE table. The sidecar's reason to exist is to keep what IFL discards
 * after about a month, so the day IFL prunes even its first row, verify fails
 * PERMANENTLY on exactly the rows the product is for. This is what lets it
 * stop doing that: a per-generation record of the lowest id the source has
 * actually been OBSERVED still holding, raised only when a pass sees it rise.
 *
 * A RISING min is archiving working as designed — the source's earliest id
 * has moved on, SMS still holds what came before it, and once recorded that
 * gap is an accounted-for fact rather than a discrepancy verify has to fail
 * on forever. The UPDATE is guarded (`archived_below_id IS NULL OR < @min`),
 * the same pattern as checkColumnDrift's column_list guard: two overlapping
 * passes raising the floor at once cannot leave it lower than either
 * observed, and a pass that observes the SAME min as last time issues no
 * UPDATE at all — archived_observed_utc stays the FIRST time this floor was
 * reached, not the most recent time it was merely re-confirmed.
 *
 * A FALLING min is not archiving — ids do not reappear once pruned. It can
 * only mean the table was reseeded, restored from backup, or rebuilt below a
 * floor SMS already observed the source holding, and every id-based fact this
 * app keeps about the generation (this floor, the worker's own watermark) is
 * meaningless against it. It HALTS — thrown, not swallowed — exactly like
 * resolveEpoch's identity and schema checks above it, rather than quietly
 * lowering the floor to match what the reseed now shows.
 *
 * A FAILURE TO READ the source's MIN this pass (a timeout, a permission
 * blip) is different from both, and is the one case this function does NOT
 * propagate: the identity/schema checks moments earlier already proved the
 * source is reachable and is this generation, so a failure on this
 * particular read is transient bookkeeping trouble, not evidence of
 * anything wrong with the data. Halting the whole table's pass over it would
 * block ingestion of rows the checks above already cleared, for no gain —
 * there is always a next pass. It is logged, never silently dropped, so a
 * *persistent* failure stays visible without being a *blocking* one — the
 * same non-fatal-by-design stance checkColumnDrift takes on column list
 * drift, for the same reason: this is enrichment, not a correctness gate.
 */
export async function observeArchivedFloor(
  appPool: ConnectionPool,
  iflPool: ConnectionPool,
  def: IflTableDef,
  epoch: EpochRow,
): Promise<void> {
  let sourceMin: number | null;
  try {
    const r = await iflPool.request().query<{ lo: unknown }>(`SELECT MIN([id]) lo FROM [${def.sourceTable}]`);
    const lo = r.recordset[0]?.lo;
    sourceMin = lo == null ? null : Number(lo);
  } catch (err) {
    log.warn('could not observe the archived floor this pass — not blocking on it', {
      table: def.sourceTable,
      epoch: epoch.epoch_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (sourceMin === null) return; // source table currently empty — nothing to floor

  const floor = epoch.archived_below_id ?? null;
  if (floor !== null && sourceMin < floor) {
    throw new Error(
      `${def.sourceTable}'s lowest id fell from ${floor} to ${sourceMin} within generation ` +
        `${epoch.epoch_id} ("${epoch.label}"). Ids do not come back once pruned: this is a reseed, a ` +
        `restore, or a rebuild BELOW a floor SMS already observed the source holding — not archiving. ` +
        `Sync halted before reading; the archived floor is not lowered automatically. If this really is ` +
        `a new generation:\n` +
        `  sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"`,
    );
  }
  if (floor === null || sourceMin > floor) {
    await appPool
      .request()
      .input('id', mssql.Int, epoch.epoch_id)
      .input('min', mssql.BigInt, sourceMin)
      .query(
        `UPDATE sms.source_epoch SET archived_below_id = @min, archived_observed_utc = SYSUTCDATETIME()
           WHERE epoch_id = @id AND (archived_below_id IS NULL OR archived_below_id < @min)`,
      );
  }
}

/** The dq check a column-list difference raises. Non-fatal, by design — see checkColumnDrift. */
export const SOURCE_COLUMNS_CHANGED = 'source_columns_changed';

/**
 * Column-list drift within an open generation (roadmap Phase 2 item 4,
 * 14 Sep 2026). NON-FATAL, and that is the point.
 *
 * The schema fingerprint hashes only the columns the reader DEPENDS ON, and
 * halts on a change to any of them — the right response, because a changed
 * dependency means the rows we would read are not the rows we think. But a
 * column IFL ADDS and we do not read is invisible to it: `MaterialId` itself,
 * the product key SCHEMA.md OQ-1 recorded as non-existent, would have arrived
 * unnoticed in August 2026 had IFL not also recreated the table. So every pass
 * reads the FULL list and compares it to what the generation had when it was
 * accepted (`sms.source_epoch.column_list`).
 *
 * On first sight the list is STORED, not compared: generations accepted
 * before migration 029 have no recorded list, and the worker filling it in on
 * its next pass is the migration's stated contract. The UPDATE is guarded
 * `AND column_list IS NULL` so two overlapping passes cannot each store a
 * different list, and a filled row is never overwritten by a later pass —
 * the recorded list is the generation's baseline, and only `epoch:accept`
 * sets a new one.
 *
 * On difference: one WARNING finding, deduplicated by its detail (which names
 * the added and removed columns, the table and the generation), so it is
 * recorded once and stands until someone reviews it. Ingestion continues,
 * because the fingerprint of the depended-on columns is unchanged — the rows
 * we read are still the rows we think — and the honest message is "there is
 * something new here you may want", not "stop".
 */
export async function checkColumnDrift(
  appPool: ConnectionPool,
  adapter: SourceAdapter,
  epoch: EpochRow,
): Promise<Finding | null> {
  const live = await adapter.columnList();
  const stored = await appPool
    .request()
    .input('id', mssql.Int, epoch.epoch_id)
    .query<{ column_list: string | null }>(`SELECT column_list FROM sms.source_epoch WHERE epoch_id = @id`);
  const recorded = stored.recordset[0]?.column_list ?? null;

  if (recorded === null) {
    await appPool
      .request()
      .input('id', mssql.Int, epoch.epoch_id)
      .input('json', mssql.NVarChar(mssql.MAX), JSON.stringify(live))
      .query(`UPDATE sms.source_epoch SET column_list = @json WHERE epoch_id = @id AND column_list IS NULL`);
    return null;
  }

  let baseline: string[];
  try {
    const parsed: unknown = JSON.parse(recorded);
    baseline = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    baseline = [];
  }
  const liveSet = new Set(live);
  const baseSet = new Set(baseline);
  const added = live.filter((c) => !baseSet.has(c));
  const removed = baseline.filter((c) => !liveSet.has(c));
  if (added.length === 0 && removed.length === 0) return null;

  return {
    check_name: SOURCE_COLUMNS_CHANGED,
    severity: 'WARNING',
    subject_table: rawShortName(adapter.def.rawTable),
    count: added.length + removed.length,
    detail:
      `columns added: [${added.join(', ')}]; removed: [${removed.join(', ')}] on ${adapter.def.sourceTable} ` +
      `(generation ${epoch.epoch_id}) — the fingerprint of the columns SMS reads is unchanged, so ingestion ` +
      `continues; review whether SMS should read the new columns`,
  };
}
