/**
 * Sync runner (Step 2 scope: Reader -> raw). Source-agnostic orchestration:
 * fingerprint gate -> read since (watermark - overlap) -> idempotent raw insert
 * -> sync_run audit. Transform->canonical is Step 3.
 *
 * PER-TABLE ISOLATION (roadmap Phase 2 item 3, 14 Sep 2026). A halt on one
 * table used to end the pass: the tables after it were not read, each got a
 * "Not read this pass" row, and the transform did not run — so one stale
 * generation on rejectWeight1_TP1U2 (a table the plant writes a few rows an
 * hour to) stopped every cone and sack from reaching a screen. Now each
 * table's gates and read run inside their own try; a halt writes THAT table's
 * halt row and the loop carries on. At the end, if anything halted, one
 * aggregate error names every halted table and why, thrown AFTER the healthy
 * tables' rows were written — so the log and the CLI's exit code still say
 * the pass was not clean, and pipeline.ts still runs the transform for what
 * did arrive.
 *
 * Two halts remain pass-level, because there is nothing per-table to isolate:
 * the configuration itself being unreadable (no rows, unmigrated database),
 * and the source probe failing before any table is approached (pipeline.ts).
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionPool } from 'mssql';
import { createLogger, type Logger } from '@sms/shared';
import type { SyncConfig } from './config.js';
import { fallbackHaltTargets, rawShortName, type IflTableDef } from './reader/iflTables.js';
import { loadSourceTables } from './reader/sourceTables.js';
import { createAdapter, classifyError, isTransient, type ProbeResult } from './reader/SourceAdapter.js';
import { persistRaw } from './raw/persistRaw.js';
import { persistFindings } from './transform/dq.js';
import { resolveEpoch, checkColumnDrift } from './epoch.js';
import { withRetry } from './util/retry.js';
import { getWatermark, startSyncRun, finishSyncRun, recordHaltedRun } from './store.js';
import type { EpochRow } from './epoch.js';

const log: Logger = createLogger('sync-worker');

export interface TableOutcome {
  table: string;
  read: number;
  written: number;
  watermarkFrom: number;
}

/** One table that did not sync this pass, and the reason its halt row carries. */
export interface TableHalt {
  sourceTable: string;
  targetTable: string;
  reason: string;
}

/**
 * Thrown by runOnce when at least one table halted. Carries the outcomes of
 * the tables that DID sync so the caller (pipeline.ts) can still transform
 * them, and the halts so the log can list them. `message` is the aggregate:
 * one line per halted table.
 */
export class TableHaltsError extends Error {
  /** Set by pipeline.ts once the transform has run on the healthy tables, so the
   *  worker can log the pass summary as well as the halts. */
  partial: unknown = null;

  constructor(
    readonly halts: TableHalt[],
    readonly outcomes: TableOutcome[],
  ) {
    super(
      `${halts.length} of ${halts.length + outcomes.length} source table(s) did not sync this pass:\n` +
        halts.map((h) => `  - ${h.sourceTable} → ${h.targetTable}: ${h.reason}`).join('\n'),
    );
    this.name = 'TableHaltsError';
  }
}

/**
 * The source probe (roadmap Phase 2 item 5): one round trip through the
 * first configured table's adapter before any table is read. The adapter
 * classifies the failure; the caller (pipeline.ts) turns a failed probe into
 * the pass-level halt rows. Exposed so the pipeline can log the round trip.
 */
export async function probeSource(iflPool: ConnectionPool, tables: IflTableDef[]): Promise<ProbeResult> {
  const first = tables[0];
  if (!first) return { ok: false, error: 'no source tables to probe', classification: 'unknown' };
  return createAdapter(first.systemCode, iflPool, first).probe();
}

export async function runOnce(
  appPool: ConnectionPool,
  iflPool: ConnectionPool,
  cfg: SyncConfig,
): Promise<TableOutcome[]> {
  const runId = randomUUID();
  const passLog = log.child({ correlationId: runId });
  const outcomes: TableOutcome[] = [];
  const halts: TableHalt[] = [];

  // ---- configuration gate ------------------------------------------------------
  // Which tables this line reads is a fact of sms.source_table, loaded fresh
  // every pass so a change in Setup › Sources applies on the next tick
  // (roadmap Phase 1, 14 Sep 2026). A line with nothing configured halts here,
  // before any source is touched, and the halt leaves a row per raw table the
  // schema has — the configuration being unreadable is precisely the case in
  // which the tables it would have named are unknown.
  let tables: IflTableDef[];
  try {
    tables = await loadSourceTables(appPool, cfg.lineId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    for (const t of fallbackHaltTargets()) {
      await recordHaltedRun(appPool, {
        runId,
        adapter: t.adapter,
        targetTable: t.targetTable,
        lineId: cfg.lineId,
        sourceEpoch: null,
        watermarkFrom: null,
        error: reason,
      });
    }
    throw err;
  }

  for (const def of tables) {
    const targetTable = rawShortName(def.rawTable);

    // What the halt writer knows so far. Both are filled in as the gates pass,
    // so a halt row carries exactly as much as had been established when it
    // fired — and nothing invented.
    let epoch: EpochRow | null = null;
    let watermark: number | null = null;
    let runRowOpen = false;

    try {
      // Through the registry (Phase 2): an unregistered system code is a
      // halt for THIS table with a message naming it, not a crash of the pass.
      const adapter = createAdapter(def.systemCode, iflPool, def);

      // ---- generation gate ------------------------------------------------------
      // Resolve WHICH generation of this source table we are reading before doing
      // anything else. resolveEpoch halts on an unknown generation, on a changed
      // server/database, and on column drift within a live generation — the schema
      // fingerprint now lives on the epoch row, because it is a property of a
      // generation rather than of a table name.
      //
      // Order matters: the watermark is meaningless until the generation is known,
      // since `id` restarts with each one.
      const resolved = await resolveEpoch(appPool, iflPool, def, cfg.lineId, cfg.iflData);
      epoch = resolved.epoch;

      // ---- column-list drift (non-fatal) ---------------------------------------
      // The fingerprint above sees only the columns we READ. This compares the
      // FULL list to the one recorded for the generation and raises a WARNING
      // finding on a difference — a column IFL added that SMS might want, the
      // way MaterialId arrived. Stored on first sight; never a halt.
      //
      // `resolved.columnList` is the SAME live read resolveEpoch already made
      // (WS-PERF3, Job 1, 24 Sep 2026) — this used to call `adapter.columnList()`
      // a second time, identical statement, identical parameters, every table,
      // every pass. See epoch.ts's checkColumnDrift doc comment.
      const drift = await checkColumnDrift(appPool, resolved.columnList, epoch, def);
      if (drift) {
        await persistFindings(appPool, runId, [drift]);
        passLog.warn('source column list changed', { table: def.sourceTable, epoch: epoch.epoch_id, detail: drift.detail });
      }

      watermark = await getWatermark(appPool, def.rawTable, cfg.lineId, epoch.epoch_id);

      // ---- restore / reseed gate -----------------------------------------------
      // resolveEpoch catches a source that was REPLACED (new create_date). It
      // cannot catch a source RESTORED FROM BACKUP: same table, same create_date,
      // ids rewound. Nothing about the schema changes, so only the numbers betray
      // it — a watermark above everything the source holds cannot be produced by
      // inserting rows.
      //
      // Guarded on `watermark !== null`, not `> 0`: a freshly accepted generation
      // legitimately has no rows yet and must not be blocked, while 0 is itself a
      // real watermark (rejectWeight1_TP1U2 has a genuine row at src_id = 0).
      const sourceMax = await adapter.maxSourceId();
      if (watermark !== null && (sourceMax === null || sourceMax < watermark)) {
        throw new Error(
          `Source ${def.sourceTable} has gone backwards within generation ${epoch.epoch_id} ` +
            `("${epoch.label}"): our watermark is ${watermark} but the source's highest id is ` +
            `${sourceMax === null ? 'none (table empty)' : sourceMax}. The source was restored, ` +
            `purged or reseeded without being recreated. Reading on would ingest nothing and ` +
            `report success. Sync halted.`,
        );
      }

      // floor at -1, not 0: at least one IFL table (rejectWeight1_TP1U2) has a
      // legitimate row with id = 0, and `id > afterId` would otherwise skip it.
      const afterId = Math.max(-1, (watermark ?? 0) - cfg.overlapRows);
      const syncRunId = await startSyncRun(appPool, {
        runId,
        adapter: def.systemCode,
        targetTable,
        lineId: cfg.lineId,
        watermarkFrom: watermark ?? 0,
        sourceEpoch: epoch.epoch_id,
      });
      runRowOpen = true;

      try {
        // Retry ONLY what a retry can cure (Phase 2 item 2). A refused login or
        // a missing table fails on the first attempt, and the halt row below
        // carries its classification; the old behaviour retried those four
        // times with backoff and logged the same fact four times.
        const records = await withRetry(() => adapter.readSince(afterId), {
          retryOn: isTransient,
          onRetry: (n, err) =>
            passLog.warn('retrying source read', {
              attempt: n,
              table: def.sourceTable,
              classification: classifyError(err),
              error: err instanceof Error ? err.message : String(err),
            }),
        });
        const { read, written } = await persistRaw(
          appPool,
          def,
          cfg.lineId,
          runId,
          records,
          epoch.epoch_id,
        );
        // Read something, wrote nothing — every row was discarded as already-seen.
        //
        // Re-reading the overlap window and writing none of it is NORMAL: that is
        // exactly what the 500-row overlap is for. So only a batch that EXCEEDS the
        // overlap and still writes nothing is suspicious. Now that the dedupe probe
        // is epoch-scoped, that can only mean the id space was reused INSIDE one
        // generation — which is a real fault, not a curiosity, so it halts the
        // table's pass rather than logging and carrying on.
        //
        // Without this the discard is invisible: `written` simply comes back below
        // `read` and nothing compares the two.
        if (read > cfg.overlapRows && written === 0) {
          const detail =
            `${read} rows read from ${def.sourceTable} (generation ${epoch.epoch_id}) and none ` +
            `written — every row was already present by (line_id, source_epoch, src_id). Beyond ` +
            `the ${cfg.overlapRows}-row overlap this means the id space was reused within a ` +
            `single generation.`;
          await persistFindings(appPool, runId, [
            {
              check_name: 'raw_read_without_write',
              severity: 'ERROR',
              subject_table: targetTable,
              count: read,
              detail,
            },
          ]);
          throw new Error(detail);
        }

        const newWatermark = await getWatermark(appPool, def.rawTable, cfg.lineId, epoch.epoch_id);
        await finishSyncRun(appPool, syncRunId, {
          watermarkTo: newWatermark ?? 0,
          rowsRead: read,
          rowsWritten: written,
          outcome: 'success',
        });
        outcomes.push({ table: def.rawTable, read, written, watermarkFrom: watermark ?? 0 });
      } catch (err) {
        await finishSyncRun(appPool, syncRunId, {
          watermarkTo: watermark ?? 0,
          rowsRead: 0,
          rowsWritten: 0,
          outcome: 'failed',
          error: describe(err),
        });
        throw err;
      }
    } catch (err) {
      // ---- leave a row for THIS table, then carry on ----------------------
      // Whatever stopped this table, the others are still read (Phase 2
      // per-table isolation). The halting table gets a 'halted' row only if
      // it had not already opened one — the in-run failure above finishes its
      // own as 'failed'. The reason carries the error's classification
      // (transient / auth / schema / unknown) in front of the driver's text,
      // so Setup can say "permission" rather than quoting SQL Server.
      const reason = describe(err);
      if (!runRowOpen) {
        await recordHaltedRun(appPool, {
          runId,
          adapter: def.systemCode,
          targetTable,
          lineId: cfg.lineId,
          sourceEpoch: epoch?.epoch_id ?? null,
          watermarkFrom: watermark,
          error: reason,
        });
      }
      halts.push({ sourceTable: def.sourceTable, targetTable, reason });
      passLog.warn('source table did not sync', { table: def.sourceTable, target: targetTable, reason });
    }
  }

  if (halts.length > 0) throw new TableHaltsError(halts, outcomes);
  return outcomes;
}

/**
 * A halt reason as the sync_run row and the log carry it: the classification
 * first, when the error is a driver/server failure whose class is known, then
 * the message. A gate's own Error (generation changed, gone backwards) has no
 * driver code and classifies 'unknown'; those messages already say what to
 * do, so the prefix is left off rather than adding noise to them.
 */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cls = classifyError(err);
  return cls === 'unknown' ? message : `[${cls}] ${message}`;
}
