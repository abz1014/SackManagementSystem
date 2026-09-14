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
import type { DbConfig } from './config.js';
import { rawShortName, type IflTableDef } from './reader/iflTables.js';
import { createAdapter, type SourceAdapter } from './reader/SourceAdapter.js';
import type { Finding } from './transform/dq.js';

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
              source_created_key, schema_fingerprint, provenance, generation_ordinal, label
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

  return open;
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
